"""Write a BFIR document as one self-contained BFPlot result.

A result is either a directory::

    <path>/manifest.toml
    <path>/.gitignore              # "/objects/": commit the manifest, not the data
    <path>/objects/sha256/<2 hex>/<digest>

or one packed file: magic, u64 manifest length, manifest, u64 object count, then
per object its 32-byte digest, u64 length and bytes (all integers little-endian).
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import struct
import uuid
import warnings
from pathlib import Path
from typing import Any, Literal

import numpy as np
import zstandard as zstd

from .bfir import BfirDocument
from .preview import render
from .provenance import processing_metadata

Layout = Literal["directory", "file"]
PACKED_MAGIC = b"BFPLOT\0\0"
MANIFEST_PREFIX = b'format = "bfplot"'
# The format version this writer produces; see docs/format.md.
FORMAT_VERSION = 1


def canonical_json(value: Any) -> bytes:
    """The canonical JSON encoding that object digests are computed over."""
    return json.dumps(
        value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False
    ).encode("utf-8")


# Manifest TOML


def _toml_string(value: str) -> str:
    return json.dumps(value, ensure_ascii=False).replace("\x7f", "\\u007f")


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
        items = ", ".join(f"{_toml_key(k)} = {_toml_value(v)}" for k, v in sorted(value.items()))
        return "{ " + items + " }" if value else "{}"
    raise TypeError(f"cannot represent {type(value).__name__} in TOML")


def metadata_value(value: Any) -> Any:
    """Convert a user metadata value (NumPy values, paths, ...) to plain TOML-ready data."""
    if isinstance(value, Path):
        value = str(value)
    elif hasattr(value, "tolist"):
        value = value.tolist()
    if isinstance(value, dict):
        for key in value:
            _toml_key(key)
        return {key: metadata_value(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [metadata_value(item) for item in value]
    _toml_value(value)
    return value


def _toml_table(name: str, table: dict[str, Any], lines: list[str]) -> None:
    lines += ["", f"[{name}]"]
    nested = []
    for key, value in sorted(table.items()):
        if isinstance(value, dict) and value:
            nested.append((key, value))
        else:
            lines.append(f"{_toml_key(key)} = {_toml_value(value)}")
    for key, value in nested:
        _toml_table(f"{name}.{_toml_key(key)}", value, lines)


def manifest_bytes(
    document: str, provenance: dict[str, Any], preview: list[str] | None = None
) -> bytes:
    lines = ['format = "bfplot"', f"version = {FORMAT_VERSION}", f'document = "{document}"']
    _toml_table("provenance", provenance, lines)
    if preview:
        # Comments, so readers ignore the drawing and it needs no format version.
        lines += ["", "# Preview (approximate; regenerated on every save)", "#"]
        lines += [f"# {line}".rstrip() for line in preview]
    return ("\n".join(lines) + "\n").encode("utf-8")


# Destinations


def _starts_with(path: Path, prefix: bytes) -> bool:
    try:
        with path.open("rb") as handle:
            return handle.read(len(prefix)) == prefix
    except OSError:
        return False


def is_result(path: Path) -> bool:
    """Whether ``path`` is a BFPlot result (or an empty directory) that may be replaced."""
    if path.is_dir() and not path.is_symlink():
        manifest = path / "manifest.toml"
        return _starts_with(manifest, MANIFEST_PREFIX) or not any(path.iterdir())
    return _starts_with(path, PACKED_MAGIC)


def _check_destination(path: Path) -> None:
    if os.path.lexists(path) and not is_result(path):
        raise FileExistsError(f"{path} exists and is not a BFPlot result; refusing to replace it")


def prepare_destination(path: Path, layout: Any, *, stacklevel: int = 2) -> Layout:
    """Check an output path and layout before any expensive work is done."""
    if layout not in ("directory", "file"):
        raise ValueError("layout must be one of 'directory', 'file'")
    if not path.name.endswith(".bfplot"):
        warnings.warn(
            f"BFPlot output {str(path)!r} does not end in '.bfplot'; writing it exactly as given",
            stacklevel=stacklevel + 1,
        )
    _check_destination(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    if not os.access(path.parent, os.W_OK | os.X_OK):
        raise PermissionError(f"cannot write BFPlot output into {path.parent}")
    return layout


# Writing


def _encode(array: np.ndarray) -> tuple[bytes, dict[str, Any]]:
    """Little-endian, C-ordered, zstd-compressed array bytes and their descriptor."""
    array = np.ascontiguousarray(array, dtype=array.dtype.newbyteorder("<"))
    descriptor = {"dtype": array.dtype.str[1:], "shape": list(array.shape), "codec": "zstd"}
    return zstd.ZstdCompressor(level=3).compress(array.tobytes()), descriptor


def write_result(path: Path, bfir: BfirDocument, layout: Layout, *, preview: bool = True) -> Path:
    """Write ``bfir`` as one result at exactly ``path``, replacing any previous result.

    With ``preview``, the manifest ends with a text drawing of the figures in comments.
    """
    bfir.validate()
    objects: dict[str, bytes] = {}

    def put(data: bytes) -> str:
        digest = hashlib.sha256(data).hexdigest()
        objects[digest] = data
        return f"sha256:{digest}"

    arrays = {}
    for buffer_id, buffer in bfir.buffers.items():
        data, descriptor = _encode(buffer.array)
        arrays[buffer_id] = {"object": put(data), **descriptor}

    def resolve(value: Any) -> Any:
        if isinstance(value, dict):
            if "$buffer" in value:
                return arrays[value["$buffer"]]
            return {key: resolve(item) for key, item in value.items()}
        if isinstance(value, list):
            return [resolve(item) for item in value]
        return value

    document = put(canonical_json(resolve(bfir.document)))
    drawing = render(bfir) if preview else None
    manifest = manifest_bytes(document, {**processing_metadata(), **bfir.metadata}, drawing)

    _check_destination(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    staging = path.with_name(f".{path.name}.{uuid.uuid4().hex[:8]}.partial")
    try:
        if layout == "file":
            _write_packed(staging, manifest, objects)
        else:
            _write_directory(staging, manifest, objects)
        _install(staging, path)
    finally:
        _remove(staging)
    return path


def _write(path: Path, data: bytes) -> None:
    with path.open("xb") as handle:
        handle.write(data)
        os.fsync(handle.fileno())


def _write_packed(path: Path, manifest: bytes, objects: dict[str, bytes]) -> None:
    parts = [PACKED_MAGIC, struct.pack("<Q", len(manifest)), manifest]
    parts.append(struct.pack("<Q", len(objects)))
    for digest, data in sorted(objects.items()):
        parts += [bytes.fromhex(digest), struct.pack("<Q", len(data)), data]
    _write(path, b"".join(parts))


def _write_directory(path: Path, manifest: bytes, objects: dict[str, bytes]) -> None:
    path.mkdir()
    for digest, data in objects.items():
        target = path / "objects" / "sha256" / digest[:2] / digest
        target.parent.mkdir(parents=True, exist_ok=True)
        _write(target, data)
    _write(path / "manifest.toml", manifest)
    _write(path / ".gitignore", b"/objects/\n")


def _install(staging: Path, path: Path) -> None:
    """Move ``staging`` to ``path``; a previous result is moved aside, then deleted."""
    if not os.path.lexists(path) or (staging.is_file() and path.is_file()):
        os.replace(staging, path)
        return
    previous = path.with_name(f".{path.name}.{uuid.uuid4().hex[:8]}.old")
    os.rename(path, previous)
    try:
        os.replace(staging, path)
    except BaseException:
        os.rename(previous, path)
        raise
    _remove(previous)


def _remove(path: Path) -> None:
    if path.is_dir() and not path.is_symlink():
        shutil.rmtree(path, ignore_errors=True)
    elif os.path.lexists(path):
        path.unlink()
