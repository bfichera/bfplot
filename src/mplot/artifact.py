from __future__ import annotations

import os
import shutil
import struct
import tempfile
import warnings
from pathlib import Path
from typing import Any, Literal

from ._json import canonical_json
from .store import ContentStore

Layout = Literal["directory", "file"]
LAYOUTS: tuple[Layout, ...] = ("directory", "file")
SCHEMA_VERSION = 2
PACKED_MAGIC = b"MPLOT\0\x09\x09"
_MANIFEST_PREFIX = b'format = "mplot"'
_RESULT_GITIGNORE = b"/objects/\n"


def _toml_string(value: str) -> str:
    escaped = value.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")
    return f'"{escaped}"'


def _toml_key(key: Any) -> str:
    if not isinstance(key, str):
        raise TypeError(f"metadata keys must be strings, not {type(key).__name__}")
    if key and all(char.isascii() and (char.isalnum() or char in "_-") for char in key):
        return key
    return _toml_string(key)


def _toml_value(value: Any) -> str:
    if value is None:
        return '""'
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        return repr(value)
    if isinstance(value, str):
        return _toml_string(value)
    if isinstance(value, (list, tuple)):
        return "[" + ", ".join(_toml_value(item) for item in value) + "]"
    if isinstance(value, dict):
        items = (f"{_toml_key(key)} = {_toml_value(item)}" for key, item in sorted(value.items()))
        return "{ " + ", ".join(items) + " }" if value else "{}"
    raise TypeError(f"cannot represent {type(value).__name__} in TOML")


def metadata_value(value: Any) -> Any:
    """Normalize a user metadata value into plain TOML-compatible Python data."""
    if hasattr(value, "item") and callable(value.item) and getattr(value, "shape", None) == ():
        value = value.item()
    elif hasattr(value, "tolist") and callable(value.tolist):
        value = value.tolist()
    elif isinstance(value, Path):
        value = str(value)
    if isinstance(value, dict):
        result = {}
        for key, item in value.items():
            _toml_key(key)
            result[key] = metadata_value(item)
        return result
    if isinstance(value, (list, tuple)):
        return [metadata_value(item) for item in value]
    _toml_value(value)
    return value


def _toml_table(name: str, table: dict[str, Any], lines: list[str]) -> None:
    lines.extend(("", f"[{name}]"))
    nested: list[tuple[str, dict[str, Any]]] = []
    for key in sorted(table):
        value = table[key]
        if isinstance(value, dict) and value:
            nested.append((key, value))
        else:
            lines.append(f"{_toml_key(key)} = {_toml_value(value)}")
    for key, value in nested:
        _toml_table(f"{name}.{_toml_key(key)}", value, lines)


def manifest_bytes(document: str, provenance: dict[str, Any]) -> bytes:
    lines = [
        'format = "mplot"',
        'version = "0.9.9"',
        f"schema_version = {SCHEMA_VERSION}",
        f"document = {_toml_string(document)}",
    ]
    _toml_table("provenance", provenance, lines)
    return ("\n".join(lines) + "\n").encode("utf-8")


def check_layout(layout: Any) -> Layout:
    if layout not in LAYOUTS:
        raise ValueError(f"layout must be one of {', '.join(map(repr, LAYOUTS))}")
    return layout


def is_result(path: Path) -> bool:
    """Whether ``path`` holds an MPlot result that a new result may replace."""
    if path.is_dir() and not path.is_symlink():
        manifest = path / "manifest.toml"
        if not manifest.exists():
            return not any(path.iterdir())
        return _starts_with(manifest, _MANIFEST_PREFIX)
    return _starts_with(path, PACKED_MAGIC) or _starts_with(path, _MANIFEST_PREFIX)


def check_destination(path: Path) -> None:
    if os.path.lexists(path) and not is_result(path):
        raise FileExistsError(f"{path} exists and is not an MPlot result; refusing to replace it")


def prepare_destination(path: Path, layout: Any, *, stacklevel: int = 2) -> Layout:
    """Validate an output before any expensive work so failures happen early."""
    layout = check_layout(layout)
    if not path.name.endswith(".mplot"):
        warnings.warn(
            f"MPlot output {str(path)!r} does not end in '.mplot'; writing it exactly as given",
            stacklevel=stacklevel + 1,
        )
    check_destination(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    if not os.access(path.parent, os.W_OK | os.X_OK):
        raise PermissionError(f"cannot write MPlot output into {path.parent}")
    return layout


def write_result(
    path: Path,
    document: dict[str, Any],
    provenance: dict[str, Any],
    source_store: ContentStore,
    *,
    layout: Layout,
) -> Path:
    """Write one self-contained result at exactly ``path``, replacing any previous result."""
    check_layout(layout)
    check_destination(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    manifest = manifest_bytes(source_store.put(canonical_json(document)), provenance)
    objects = _objects(source_store)
    staging = (
        _stage_file(path, manifest, objects)
        if layout == "file"
        else _stage_directory(path, manifest, objects)
    )
    try:
        _install(staging, path)
    finally:
        _remove(staging)
    return path


def _objects(store: ContentStore) -> dict[str, bytes]:
    objects: dict[str, bytes] = {}
    for object_path in store.root.glob("sha256/*/*"):
        data = object_path.read_bytes()
        digest = object_path.name
        if ContentStore.digest(data) != digest:
            raise ValueError(f"object digest mismatch: {object_path}")
        objects[digest] = data
    return objects


def _stage_file(path: Path, manifest: bytes, objects: dict[str, bytes]) -> Path:
    fd, temporary = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".partial", dir=path.parent)
    staging = Path(temporary)
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(PACKED_MAGIC)
            handle.write(struct.pack("<Q", len(manifest)))
            handle.write(manifest)
            handle.write(struct.pack("<Q", len(objects)))
            for digest in sorted(objects):
                data = objects[digest]
                handle.write(bytes.fromhex(digest))
                handle.write(struct.pack("<Q", len(data)))
                handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        _apply_umask(staging)
    except BaseException:
        _remove(staging)
        raise
    return staging


def _stage_directory(path: Path, manifest: bytes, objects: dict[str, bytes]) -> Path:
    staging = Path(tempfile.mkdtemp(prefix=f".{path.name}.", suffix=".partial", dir=path.parent))
    try:
        store = ContentStore(staging / "objects")
        for data in objects.values():
            store.put(data)
        _write_bytes(staging / "manifest.toml", manifest)
        _write_bytes(staging / ".gitignore", _RESULT_GITIGNORE)
        _apply_umask(staging)
    except BaseException:
        _remove(staging)
        raise
    return staging


def _install(staging: Path, path: Path) -> None:
    if not os.path.lexists(path) or (
        staging.is_file() and path.is_file() and not path.is_symlink()
    ):
        os.replace(staging, path)
        return
    aside = Path(tempfile.mkdtemp(prefix=f".{path.name}.", suffix=".old", dir=path.parent))
    previous = aside / path.name
    try:
        os.rename(path, previous)
        try:
            os.replace(staging, path)
        except BaseException:
            os.rename(previous, path)
            raise
    finally:
        shutil.rmtree(aside, ignore_errors=True)


def _apply_umask(path: Path) -> None:
    # mkstemp and mkdtemp create private entries; results should honor the user's umask.
    umask = os.umask(0)
    os.umask(umask)
    if path.is_file():
        os.chmod(path, 0o666 & ~umask)
        return
    for root, directories, files in os.walk(path):
        os.chmod(root, 0o777 & ~umask)
        for name in directories:
            os.chmod(os.path.join(root, name), 0o777 & ~umask)
        for name in files:
            os.chmod(os.path.join(root, name), 0o666 & ~umask)


def _write_bytes(path: Path, data: bytes) -> None:
    with path.open("wb") as handle:
        handle.write(data)
        handle.flush()
        os.fsync(handle.fileno())


def _remove(path: Path) -> None:
    if path.is_dir() and not path.is_symlink():
        shutil.rmtree(path, ignore_errors=True)
    else:
        try:
            path.unlink()
        except FileNotFoundError:
            pass


def _starts_with(path: Path, prefix: bytes) -> bool:
    try:
        with path.open("rb") as handle:
            return handle.read(len(prefix)) == prefix
    except OSError:
        return False
