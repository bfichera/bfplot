"""Independent readers for BFPlot results, so tests check the on-disk format itself."""

from __future__ import annotations

import json
import struct
from pathlib import Path
from typing import Any

import numpy as np
import zstandard as zstd

try:
    import tomllib
except ModuleNotFoundError:  # Python 3.10
    import tomli as tomllib


def read_objects(path: Path) -> tuple[dict[str, Any], dict[str, bytes]]:
    """The manifest and all objects (by hex digest) of a directory or packed result."""
    if path.is_dir():
        manifest = tomllib.loads((path / "manifest.toml").read_text())
        objects = {item.name: item.read_bytes() for item in path.glob("objects/sha256/*/*")}
        return manifest, objects
    with path.open("rb") as handle:
        assert handle.read(8) == b"BFPLOT\0\0"
        (size,) = struct.unpack("<Q", handle.read(8))
        manifest = tomllib.loads(handle.read(size).decode())
        objects = {}
        for _ in range(struct.unpack("<Q", handle.read(8))[0]):
            digest = handle.read(32).hex()
            (size,) = struct.unpack("<Q", handle.read(8))
            objects[digest] = handle.read(size)
        assert handle.read() == b""
    return manifest, objects


def read_result(path: Path) -> tuple[dict[str, Any], dict[str, Any]]:
    """The manifest and the decoded document of a result."""
    manifest, objects = read_objects(path)
    return manifest, json.loads(objects[manifest["document"].removeprefix("sha256:")])


def read_array(path: Path, reference: dict[str, Any]) -> np.ndarray:
    _, objects = read_objects(path)
    raw = zstd.ZstdDecompressor().decompress(objects[reference["object"].removeprefix("sha256:")])
    dtype = np.dtype(reference["dtype"]).newbyteorder("<")
    return np.frombuffer(raw, dtype=dtype).reshape(reference["shape"])
