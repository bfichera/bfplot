from __future__ import annotations

import json

import matplotlib.pyplot as plt
import numpy as np
import pytest

import mplot
from helpers import read_array, read_result
from mplot.mir import MirBuilder


def test_compile_resolves_all_mir_buffers_and_preserves_metadata(tmp_path) -> None:
    figure, axes = plt.subplots()
    axes.plot([0, 1], [2, 3])
    mir = mplot.translate(
        figure, metadata={"created_utc": "2026-01-01T00:00:00Z", "producer": "test"}
    )

    output = mplot.compile(mir, tmp_path / "compiled.mplot")
    manifest, document = read_result(output)

    assert manifest["provenance"] == {
        "created_utc": "2026-01-01T00:00:00Z",
        "git_commit": mir.metadata["git_commit"],
        "producer": "test",
    }
    assert "$buffer" not in json.dumps(document)
    line = document["figures"][0]["axes"][0]["artists"][0]
    assert set(line["data"]["x"]) == {"object", "dtype", "shape", "codec"}


def test_compile_adds_missing_baseline_git_metadata(tmp_path) -> None:
    figure, axes = plt.subplots()
    axes.plot([0, 1], [2, 3])
    mir = mplot.translate(figure)
    del mir.metadata["git_commit"]

    output = mplot.compile(mir, tmp_path / "compiled.mplot")
    manifest, _ = read_result(output)

    assert len(manifest["provenance"]["git_commit"]) == 40


def test_explicit_translate_compile_matches_savefig_artifact_document(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.setenv("SOURCE_DATE_EPOCH", "1767225600")
    figure, axes = plt.subplots()
    x = np.linspace(0, 1, 8)
    scatter = axes.scatter(x, x**2, c=x, cmap="viridis")
    figure.colorbar(scatter, ax=axes, label="value")

    explicit = mplot.compile(mplot.translate(figure), tmp_path / "explicit.mplot")
    composed = mplot.savefig(tmp_path / "composed.mplot", figure, provenance=False)
    explicit_manifest, explicit_document = read_result(explicit)
    composed_manifest, composed_document = read_result(composed)

    assert explicit_document == composed_document
    assert explicit_manifest["document"] == composed_manifest["document"]
    assert explicit_manifest["provenance"] == composed_manifest["provenance"]


def test_compile_stores_arrays_little_endian_and_rejects_non_numeric_buffers(tmp_path) -> None:
    builder = MirBuilder(metadata={"created_utc": "2026-01-01T00:00:00Z"})
    original = np.arange(12, dtype=">f8").reshape(3, 4)
    data = {"values": builder.buffer(original)}
    artist = {"id": "artist-0", "axes_id": "axes-0", "type": "mplot.image", "props": {}}
    axes = {"id": "axes-0", "artists": [{**artist, "data": data}]}
    mir = builder.build({"figures": [{"id": "figure-0", "axes": [axes]}]})

    output = mplot.compile(mir, tmp_path / "array.mplot")
    _, document = read_result(output)
    reference = document["figures"][0]["axes"][0]["artists"][0]["data"]["values"]

    assert reference["dtype"] == "f8"
    assert reference["codec"] == "zstd"
    np.testing.assert_array_equal(read_array(output, reference), original)
    with pytest.raises(TypeError, match="unsupported MIR buffer dtype"):
        builder.buffer(np.array(["text"], dtype=object))
