from __future__ import annotations

import json
import tomllib

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

import mplot


def _document_from_split(path):
    manifest = tomllib.loads(path.read_text())
    digest = manifest["document"].split(":", 1)[1]
    document_path = path.parent / ".mplot" / "objects" / "sha256" / digest[:2] / digest
    return manifest, json.loads(document_path.read_text())


def test_compile_resolves_all_mir_buffers_and_preserves_metadata(tmp_path) -> None:
    figure, axes = plt.subplots()
    axes.plot([0, 1], [2, 3])
    mir = mplot.translate(figure, metadata={"created_utc": "2026-01-01T00:00:00Z", "producer": "test"})

    output = mplot.compile(mir, tmp_path / "compiled")
    manifest, document = _document_from_split(output)

    assert manifest["provenance"] == {"created_utc": "2026-01-01T00:00:00Z", "producer": "test"}
    assert "$buffer" not in json.dumps(document)
    line = document["figures"][0]["axes"][0]["artists"][0]
    assert set(line["data"]["x"]) == {"object", "dtype", "shape", "codec"}


def test_explicit_translate_compile_matches_savefig_artifact_document(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("SOURCE_DATE_EPOCH", "1767225600")
    figure, axes = plt.subplots()
    x = np.linspace(0, 1, 8)
    scatter = axes.scatter(x, x**2, c=x, cmap="viridis")
    figure.colorbar(scatter, ax=axes, label="value")

    explicit = mplot.compile(mplot.translate(figure), tmp_path / "explicit")
    composed = mplot.savefig(tmp_path / "composed", figure, provenance=False)
    explicit_manifest, explicit_document = _document_from_split(explicit)
    composed_manifest, composed_document = _document_from_split(composed)

    assert explicit_document == composed_document
    assert explicit_manifest["document"] == composed_manifest["document"]
    assert explicit_manifest["provenance"] == composed_manifest["provenance"]
