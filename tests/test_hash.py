from __future__ import annotations

import hashlib
import json
import shutil

import matplotlib.pyplot as plt
import numpy as np
import pytest
import zstandard as zstd

import bfplot
from bfplot.artifact import canonical_json, encode_result, read_hash
from helpers import read_objects, read_result


def _figure(y=(0, 1, 0), title="tent"):
    figure, axes = plt.subplots()
    axes.plot([0, 1, 2], list(y))
    axes.set_title(title)
    return figure


def _object_path(output, digest):
    hex_digest = digest.removeprefix("sha256:")
    return output / "objects" / "sha256" / hex_digest[:2] / hex_digest


def _array_digests(document):
    found = []

    def visit(value):
        if isinstance(value, dict):
            if "object" in value:
                found.append(value["object"])
            else:
                for item in value.values():
                    visit(item)
        elif isinstance(value, list):
            for item in value:
                visit(item)

    visit(document)
    return found


def test_hash_is_the_digest_of_the_canonical_document(tmp_path):
    output = bfplot.savefig(tmp_path / "tent.bfplot", _figure())
    manifest, document = read_result(output)
    stored = _object_path(output, manifest["hash"]).read_bytes()

    assert stored == canonical_json(document)
    assert manifest["hash"] == f"sha256:{hashlib.sha256(stored).hexdigest()}"
    assert bfplot.hash(output) == bfplot.hash(output / "manifest.toml") == manifest["hash"]


def test_arrays_are_named_by_the_digest_of_their_raw_bytes(tmp_path):
    output = bfplot.savefig(tmp_path / "tent.bfplot", _figure())
    _, document = read_result(output)
    digests = _array_digests(document)

    assert digests
    for digest in digests:
        raw = zstd.ZstdDecompressor().decompress(_object_path(output, digest).read_bytes())
        assert digest == f"sha256:{hashlib.sha256(raw).hexdigest()}"


def test_saving_twice_gives_identical_results(tmp_path):
    first = bfplot.savefig(tmp_path / "one.bfplot", _figure())
    second = bfplot.savefig(tmp_path / "two.bfplot", _figure())

    assert bfplot.hash(first) == bfplot.hash(second)
    assert bfplot.same(first, second)
    assert read_objects(first) == read_objects(second)
    assert (first / "manifest.toml").read_bytes() == (second / "manifest.toml").read_bytes()


def test_figures_are_hashed_without_writing_anything(tmp_path, monkeypatch):
    figure = _figure()
    monkeypatch.chdir(tmp_path)

    expected = bfplot.hash(figure)

    assert list(tmp_path.iterdir()) == []
    assert expected == bfplot.hash([figure]) == bfplot.hash()
    assert expected == bfplot.hash(bfplot.translate(figure))
    assert expected == bfplot.hash(bfplot.savefig(tmp_path / "tent.bfplot", figure))
    assert bfplot.same(figure, tmp_path / "tent.bfplot")


def test_any_change_to_the_content_changes_the_hash():
    reference = bfplot.hash(_figure())

    assert bfplot.hash(_figure()) == reference
    assert bfplot.hash(_figure(y=(0, 1, 1e-12))) != reference
    assert bfplot.hash(_figure(title="Tent")) != reference
    assert not bfplot.same(_figure(), _figure(y=(0, 2, 0)))
    figure = _figure()
    assert bfplot.hash(figure) != bfplot.hash([figure, _figure()])


def test_dtype_is_part_of_the_hash():
    def image(dtype):
        figure, axes = plt.subplots()
        axes.imshow(np.arange(9, dtype=dtype).reshape(3, 3))
        return figure

    assert bfplot.hash(image(np.float32)) != bfplot.hash(image(np.float64))


def test_preview_and_compression_do_not_affect_the_hash(tmp_path):
    figure = _figure()
    with_preview = bfplot.savefig(tmp_path / "a.bfplot", figure)
    without_preview = bfplot.savefig(tmp_path / "b.bfplot", figure, preview=False)
    bfir = bfplot.translate(figure)

    assert bfplot.hash(with_preview) == bfplot.hash(without_preview)
    assert encode_result(bfir)[0] == encode_result(bfir, compress=False)[0]


def test_identical_arrays_are_stored_once(tmp_path):
    figure, axes = plt.subplots()
    axes.plot([0, 1, 2], [0, 1, 2])
    axes.plot([0, 1, 2], [0, 1, 2])
    output = bfplot.savefig(tmp_path / "twice.bfplot", figure)
    manifest, document = read_result(output)
    digests = _array_digests(document)
    _, objects = read_objects(output)

    assert len(digests) > len(set(digests))
    assert set(objects) == {
        digest.removeprefix("sha256:") for digest in [manifest["hash"], *digests]
    }


def test_animations_are_hashed(tmp_path):
    def record(path, powers):
        figure, axes = plt.subplots()
        x = np.linspace(0, 1, 5)
        (line,) = axes.plot(x, x)
        return bfplot.save_animation(path, figure, powers, lambda p: line.set_ydata(x**p))

    first = record(tmp_path / "a.bfplot", [2, 3])
    second = record(tmp_path / "b.bfplot", [2, 3])
    different = record(tmp_path / "c.bfplot", [2, 4])

    assert bfplot.same(first, second)
    assert not bfplot.same(first, different)
    assert bfplot.verify(first) == bfplot.hash(first)


def test_verify_accepts_an_intact_result_and_returns_its_hash(tmp_path):
    output = bfplot.savefig(tmp_path / "tent.bfplot", _figure())
    assert bfplot.verify(output) == bfplot.hash(output) == bfplot.hash(output, verify=True)


def test_verify_detects_a_changed_array(tmp_path):
    output = bfplot.savefig(tmp_path / "tent.bfplot", _figure())
    _, document = read_result(output)
    target = _object_path(output, _array_digests(document)[0])
    raw = bytearray(zstd.ZstdDecompressor().decompress(target.read_bytes()))
    raw[0] ^= 1
    target.chmod(0o644)
    target.write_bytes(zstd.ZstdCompressor().compress(bytes(raw)))

    assert bfplot.hash(output)  # the manifest alone is not checked
    with pytest.raises(bfplot.ResultError, match="does not match its digest"):
        bfplot.verify(output)
    with pytest.raises(bfplot.ResultError):
        bfplot.hash(output, verify=True)


def test_verify_detects_a_changed_document(tmp_path):
    output = bfplot.savefig(tmp_path / "tent.bfplot", _figure())
    manifest, document = read_result(output)
    document["figures"][0]["axes"][0]["title"] = "changed"
    target = _object_path(output, manifest["hash"])
    target.chmod(0o644)
    target.write_bytes(canonical_json(document))

    with pytest.raises(bfplot.ResultError, match="document .* does not match"):
        bfplot.verify(output)


def test_verify_detects_missing_objects(tmp_path):
    output = bfplot.savefig(tmp_path / "tent.bfplot", _figure())
    _, document = read_result(output)
    _object_path(output, _array_digests(document)[0]).unlink()

    with pytest.raises(bfplot.ResultError, match="object not found"):
        bfplot.verify(output)

    shutil.rmtree(output / "objects")
    with pytest.raises(bfplot.ResultError, match="object not found"):
        bfplot.verify(output)


def test_read_hash_rejects_what_is_not_a_current_result(tmp_path):
    with pytest.raises(bfplot.ResultError, match="cannot read"):
        bfplot.hash(tmp_path / "absent.bfplot")

    other = tmp_path / "other.bfplot"
    other.mkdir()
    (other / "manifest.toml").write_text('name = "something else"\n')
    with pytest.raises(bfplot.ResultError, match="not a BFPlot manifest"):
        read_hash(other)

    old = tmp_path / "old.bfplot"
    old.mkdir()
    (old / "manifest.toml").write_text(
        'format = "bfplot"\nversion = 1\ndocument = "sha256:' + "0" * 64 + '"\n'
    )
    with pytest.raises(bfplot.ResultError, match="format version 1"):
        bfplot.hash(old)

    broken = tmp_path / "broken.bfplot"
    broken.mkdir()
    (broken / "manifest.toml").write_text('format = "bfplot"\nversion = 2\nhash = "sha256:12"\n')
    with pytest.raises(bfplot.ResultError, match="no valid hash"):
        bfplot.hash(broken)


def test_document_json_is_canonical(tmp_path):
    output = bfplot.savefig(tmp_path / "tent.bfplot", _figure())
    manifest, document = read_result(output)
    stored = _object_path(output, manifest["hash"]).read_bytes()
    assert (
        stored
        == json.dumps(document, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
    )
