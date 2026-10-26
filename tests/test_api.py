from __future__ import annotations

import json
import tomllib
import zipfile

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


def test_savefig_extracts_broad_artist_set(tmp_path):
    figure, axes = plt.subplots(2, 3)
    x = np.linspace(0, 1, 8)
    axes[0, 0].plot(x, x**2, marker="o")
    axes[0, 0].scatter(x, x)
    axes[0, 1].imshow(np.arange(9).reshape(3, 3))
    axes[0, 2].errorbar(x, x, yerr=.1)
    axes[1, 0].fill_between(x, x, x**2)
    axes[1, 1].hist(x)
    axes[1, 2].contourf(np.arange(16).reshape(4, 4))
    axes[1, 2].text(.5, .5, "label")

    output = mplot.savefig(tmp_path / "all", figure, provenance=False)
    assert output.name == "all.mplot.toml"
    manifest, document = _document_from_split(output)
    assert manifest["version"] == "0.9.9"
    types = {artist["type"] for axis in document["figures"][0]["axes"] for artist in axis["artists"]}
    assert {"mplot.line", "mplot.scatter", "mplot.image", "mplot.errorbar", "mplot.fill_between", "mplot.histogram", "mplot.contourf", "mplot.text"} <= types
    for axis in document["figures"][0]["axes"]:
        for artist in axis["artists"]:
            assert {"type", "schema_version", "id", "axes_id", "props", "data"} == artist.keys()


def test_packed_artifact_contains_manifest_and_all_objects(tmp_path):
    figure, axes = plt.subplots()
    axes.plot([1, 2], [3, 4])
    output = mplot.savefig(tmp_path / "figure.mplot", figure, provenance=False)
    with zipfile.ZipFile(output) as archive:
        names = archive.namelist()
        assert "manifest.toml" in names
        manifest = tomllib.loads(archive.read("manifest.toml").decode())
        assert f"objects/sha256/{manifest['document'][7:9]}/{manifest['document'][7:]}" in names
        assert len([name for name in names if name.startswith("objects/")]) >= 3


def test_show_can_avoid_viewer_side_effect(tmp_path):
    figure, axes = plt.subplots()
    axes.plot([0, 1])
    assert mplot.show(figure, path=tmp_path / "shown", open_browser=False).exists()


def test_stream_commits_frames_and_closes(tmp_path):
    figure, axes = plt.subplots()
    axes.plot([0, 1])
    with mplot.stream(tmp_path / "live", provenance=False) as session:
        frame = session.send(figure, timestamp=10)
        assert frame.exists()
    index = json.loads((tmp_path / "live.mplot-stream" / "index.json").read_text())
    assert index["closed"] is True
    assert index["frames"] == [{"sequence": 0, "timestamp": 10.0, "artifact": "00000000.mplot"}]
