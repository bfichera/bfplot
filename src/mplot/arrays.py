from __future__ import annotations

from typing import Any

import numpy as np
import zstandard as zstd

from .store import ContentStore


_JSON_DTYPES = {"b", "i", "u", "f"}


def encode_array(value: Any, store: ContentStore) -> dict[str, Any]:
    """Encode an array as little-endian contiguous bytes compressed with zstd."""
    array = np.asanyarray(value)
    if np.ma.isMaskedArray(array):
        array = array.filled(np.nan)
    if array.dtype.kind not in _JSON_DTYPES:
        raise TypeError(f"unsupported array dtype: {array.dtype}")
    if array.dtype.kind == "f":
        array = np.asarray(array, dtype=np.dtype(f"<f{array.dtype.itemsize}"))
    else:
        array = np.asarray(array, dtype=array.dtype.newbyteorder("<"))
    array = np.ascontiguousarray(array)
    compressed = zstd.ZstdCompressor(level=3).compress(array.tobytes(order="C"))
    return {
        "object": store.put(compressed),
        "dtype": array.dtype.str.removeprefix("<").removeprefix("|"),
        "shape": list(array.shape),
        "codec": "zstd",
    }


def decode_array(reference: dict[str, Any], store: ContentStore) -> np.ndarray:
    if reference.get("codec") != "zstd":
        raise ValueError("unsupported array codec")
    raw = zstd.ZstdDecompressor().decompress(store.get(reference["object"]))
    dtype = np.dtype(reference["dtype"]).newbyteorder("<")
    shape = tuple(int(item) for item in reference["shape"])
    expected = dtype.itemsize * int(np.prod(shape, dtype=np.int64))
    if len(raw) != expected:
        raise ValueError("array byte length does not match shape and dtype")
    return np.frombuffer(raw, dtype=dtype).reshape(shape)
