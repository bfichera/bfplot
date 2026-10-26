from __future__ import annotations

import os
import shutil
import struct
import tempfile
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
    objects: dict[str, bytes] = {}
    for object_path in source_store.root.glob("sha256/*/*"):
        data = object_path.read_bytes()
        digest = object_path.name
        if source_store.put(data).split(":", 1)[1] != digest:
            raise ValueError(f"object digest mismatch: {object_path}")
        objects[digest] = data
    fd, temporary = tempfile.mkstemp(prefix=".mplot-", suffix=".mplot", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(b"MPLOT\0\x09\x09")
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
