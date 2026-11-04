from __future__ import annotations

import json

import matplotlib.pyplot as plt
import numpy as np
import pytest

import bfplot
from bfplot.artifact import FORMAT_VERSION
from bfplot.bfir import BfirBuilder
from helpers import read_array, read_result


def test_compile_resolves_all_bfir_buffers(tmp_path) -> None:
    figure, axes = plt.subplots()
    axes.plot([0, 1], [2, 3])
    bfir = bfplot.translate(figure)

    output = bfplot.compile(bfir, tmp_path / "compiled.bfplot")
    manifest, document = read_result(output)

    assert set(manifest) == {"format", "version", "hash"}
    assert manifest["hash"] == bfplot.hash(bfir) == bfplot.hash(output)
    assert "$buffer" not in json.dumps(document)
    line = document["figures"][0]["axes"][0]["artists"][0]
    assert set(line["data"]["x"]) == {"object", "dtype", "shape", "codec"}


def test_manifest_starts_with_format_and_version(tmp_path) -> None:
    figure, axes = plt.subplots()
    axes.plot([0, 1], [2, 3])
    output = bfplot.compile(bfplot.translate(figure), tmp_path / "compiled.bfplot")

    lines = (output / "manifest.toml").read_text().splitlines()
    assert lines[:3] == [
        'format = "bfplot"',
        f"version = {FORMAT_VERSION}",
        f'hash = "{bfplot.hash(output)}"',
    ]
    assert read_result(output)[0]["version"] == FORMAT_VERSION == 3


def test_explicit_translate_compile_matches_savefig_artifact_document(tmp_path) -> None:
    figure, axes = plt.subplots()
    x = np.linspace(0, 1, 8)
    scatter = axes.scatter(x, x**2, c=x, cmap="viridis")
    figure.colorbar(scatter, ax=axes, label="value")

    explicit = bfplot.compile(bfplot.translate(figure), tmp_path / "explicit.bfplot")
    composed = bfplot.savefig(tmp_path / "composed.bfplot", figure)
    explicit_manifest, explicit_document = read_result(explicit)
    composed_manifest, composed_document = read_result(composed)

    assert explicit_document == composed_document
    assert explicit_manifest == composed_manifest


def test_compile_stores_arrays_little_endian_and_rejects_non_numeric_buffers(tmp_path) -> None:
    builder = BfirBuilder()
    original = np.arange(12, dtype=">f8").reshape(3, 4)
    data = {"values": builder.buffer(original)}
    artist = {"id": "artist-0", "axes_id": "axes-0", "type": "bfplot.image", "props": {}}
    axes = {"id": "axes-0", "artists": [{**artist, "data": data}]}
    bfir = builder.build({"figures": [{"id": "figure-0", "axes": [axes]}]})

    output = bfplot.compile(bfir, tmp_path / "array.bfplot")
    _, document = read_result(output)
    reference = document["figures"][0]["axes"][0]["artists"][0]["data"]["values"]

    assert reference["dtype"] == "f8"
    assert reference["codec"] == "zstd"
    np.testing.assert_array_equal(read_array(output, reference), original)
    with pytest.raises(TypeError, match="unsupported BFIR buffer dtype"):
        builder.buffer(np.array(["text"], dtype=object))


def test_manifest_ends_with_a_commented_preview(tmp_path) -> None:
    figure, axes = plt.subplots()
    axes.plot([0, 1, 2], [0, 1, 0])
    axes.set_title("tent")
    output = bfplot.savefig(tmp_path / "tent.bfplot", figure, name="tent")

    text = (output / "manifest.toml").read_text()
    preview = text[text.index("# Preview") :].splitlines()
    assert all(line.startswith("#") for line in preview)
    assert "tent" in preview[2]
    assert any(chr(0x2800) < char <= chr(0x28FF) for line in preview for char in line)
    manifest, _ = read_result(output)
    assert set(manifest) == {"format", "version", "hash"}


def test_preview_can_be_disabled(tmp_path) -> None:
    figure, axes = plt.subplots()
    axes.plot([0, 1], [2, 3])
    output = bfplot.savefig(tmp_path / "plain.bfplot", figure, preview=False)
    assert "#" not in (output / "manifest.toml").read_text()


def test_preview_survives_unusable_axes(tmp_path) -> None:
    figure, axes = plt.subplots()
    axes.plot([0, 1], [2, 3])
    bfir = bfplot.translate(figure)
    bfir.document["figures"][0]["axes"][0]["x"]["limits"] = [None, None]
    output = bfplot.compile(bfir, tmp_path / "odd.bfplot")
    assert "# (no preview: ValueError" in (output / "manifest.toml").read_text()
