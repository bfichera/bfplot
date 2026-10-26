from __future__ import annotations

import hashlib

import numpy as np
import pytest

from mplot.arrays import decode_array, encode_array
from mplot.store import ContentStore


def test_store_is_content_addressed_and_verifies_reads(tmp_path):
    store = ContentStore(tmp_path)
    reference = store.put(b"hello")
    assert reference == "sha256:" + hashlib.sha256(b"hello").hexdigest()
    assert store.get(reference) == b"hello"
    store.path_for(reference).write_bytes(b"corrupt")
    with pytest.raises(ValueError, match="digest mismatch"):
        store.get(reference)
    with pytest.raises(ValueError, match="existing object digest mismatch"):
        store.put(b"hello")


def test_typed_array_round_trip(tmp_path):
    store = ContentStore(tmp_path)
    original = np.arange(12, dtype=">f8").reshape(3, 4)
    reference = encode_array(original, store)
    assert reference["codec"] == "zstd"
    assert reference["dtype"] == "f8"
    np.testing.assert_array_equal(decode_array(reference, store), original)


def test_unsupported_array_rejected(tmp_path):
    with pytest.raises(TypeError, match="unsupported array dtype"):
        encode_array(np.array(["unsafe"], dtype=object), ContentStore(tmp_path))
