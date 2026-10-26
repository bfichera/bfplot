from __future__ import annotations

import os
import shutil
import tempfile
import zipfile
from pathlib import Path
from typing import Any

from ._json import canonical_json
from .store import ContentStore


def _toml_string(value: str) -> str:
    escaped = value.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")
    return f'"{escaped}"'


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
    raise TypeError(f"cannot represent {type(value).__name__} in TOML")


def manifest_bytes(document: str, provenance: dict[str, Any]) -> bytes:
    lines = [
        'format = "mplot"',
        'version = "0.9.9"',
        'schema_version = 1',
        f"document = {_toml_string(document)}",
        "",
        "[provenance]",
    ]
    nested: list[tuple[str, dict[str, Any]]] = []
    for key in sorted(provenance):
        value = provenance[key]
        if isinstance(value, dict):
            nested.append((key, value))
        else:
            lines.append(f"{key} = {_toml_value(value)}")
    for name, table in nested:
        lines.extend(("", f"[provenance.{name}]"))
        for key in sorted(table):
            value = table[key]
            if isinstance(value, dict):
                raise TypeError("nested provenance dictionaries are limited to one level")
            lines.append(f"{key} = {_toml_value(value)}")
    return ("\n".join(lines) + "\n").encode("utf-8")


def write_split(path: Path, document: dict[str, Any], provenance: dict[str, Any]) -> Path:
    if path.name.endswith(".mplot"):
        path = path.with_name(path.name + ".toml")
    elif not path.name.endswith(".mplot.toml"):
        path = path.with_name(path.name + ".mplot.toml")
    path.parent.mkdir(parents=True, exist_ok=True)
    store = ContentStore(path.parent / ".mplot" / "objects")
    document_ref = store.put(canonical_json(document))
    _atomic_write(path, manifest_bytes(document_ref, provenance))
    return path


def write_packed(path: Path, document: dict[str, Any], provenance: dict[str, Any], source_store: ContentStore) -> Path:
    if path.suffix != ".mplot":
        path = path.with_suffix(path.suffix + ".mplot" if path.suffix else ".mplot")
    path.parent.mkdir(parents=True, exist_ok=True)
    document_ref = source_store.put(canonical_json(document))
    manifest = manifest_bytes(document_ref, provenance)
    fd, temporary = tempfile.mkstemp(prefix=".mplot-", suffix=".zip", dir=path.parent)
    os.close(fd)
    try:
        with zipfile.ZipFile(temporary, "w", compression=zipfile.ZIP_STORED) as archive:
            _zip_write(archive, "manifest.toml", manifest)
            for object_path in sorted(source_store.root.glob("sha256/*/*")):
                relative = object_path.relative_to(source_store.root).as_posix()
                _zip_write(archive, f"objects/{relative}", object_path.read_bytes())
        os.replace(temporary, path)
    finally:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass
    return path


def materialize_document(path: Path, document: dict[str, Any], provenance: dict[str, Any], store: ContentStore, *, packed: bool) -> Path:
    if packed:
        return write_packed(path, document, provenance, store)
    final = write_split(path, document, provenance)
    destination = ContentStore(final.parent / ".mplot" / "objects")
    for object_path in store.root.glob("sha256/*/*"):
        destination.put(object_path.read_bytes())
    return final


def _atomic_write(path: Path, data: bytes) -> None:
    fd, temporary = tempfile.mkstemp(prefix=".mplot-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass


def _zip_write(archive: zipfile.ZipFile, name: str, data: bytes) -> None:
    info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
    info.compress_type = zipfile.ZIP_STORED
    info.external_attr = 0o644 << 16
    archive.writestr(info, data)
