from __future__ import annotations

import json
import struct

import matplotlib
import tomllib
import zstandard as zstd

matplotlib.use("Agg")
from datetime import datetime, timedelta

import matplotlib.dates as mdates
import matplotlib.pyplot as plt
import numpy as np

import mplot


def _document_from_result(path):
    manifest = tomllib.loads((path / "manifest.toml").read_text())
    digest = manifest["document"].split(":", 1)[1]
    document_path = path / "objects" / "sha256" / digest[:2] / digest
    return manifest, json.loads(document_path.read_text())


def _decode_array(path, reference):
    digest = reference["object"].split(":", 1)[1]
    object_path = path / "objects" / "sha256" / digest[:2] / digest
    raw = zstd.ZstdDecompressor().decompress(object_path.read_bytes())
    return np.frombuffer(raw, dtype=np.dtype(reference["dtype"]).newbyteorder("<")).reshape(
        reference["shape"]
    )


def test_savefig_extracts_broad_artist_set(tmp_path):
    figure, axes = plt.subplots(2, 3)
    x = np.linspace(0, 1, 8)
    axes[0, 0].plot(x, x**2, marker="o")
    axes[0, 0].scatter(x, x)
    axes[0, 1].imshow(np.arange(9).reshape(3, 3))
    axes[0, 2].errorbar(x, x, yerr=0.1)
    axes[1, 0].fill_between(x, x, x**2)
    axes[1, 1].hist(x)
    axes[1, 2].contourf(np.arange(16).reshape(4, 4))
    axes[1, 2].set_title("Contours")
    axes[1, 2].set_xlabel("x")
    axes[1, 2].text(0.5, 0.5, "label")

    output = mplot.savefig(tmp_path / "all.mplot", figure, provenance=False)
    assert output == tmp_path / "all.mplot"
    assert output.is_dir()
    manifest, document = _document_from_result(output)
    assert manifest["version"] == "0.9.9"
    types = {
        artist["type"] for axis in document["figures"][0]["axes"] for artist in axis["artists"]
    }
    assert {
        "mplot.line",
        "mplot.scatter",
        "mplot.image",
        "mplot.errorbar",
        "mplot.fill_between",
        "mplot.histogram",
        "mplot.contourf",
        "mplot.text",
    } <= types
    assert all(
        len([artist for artist in axis["artists"] if artist["type"] == "mplot.patch"]) == 0
        for axis in document["figures"][0]["axes"]
    )
    for axis in document["figures"][0]["axes"]:
        for artist in axis["artists"]:
            assert {"type", "schema_version", "id", "axes_id", "props", "data"} == artist.keys()
    final_axis = document["figures"][0]["axes"][5]
    contour = next(artist for artist in final_axis["artists"] if artist["type"] == "mplot.contourf")
    text = [artist for artist in final_axis["artists"] if artist["type"] == "mplot.text"]
    assert "facecolors" in contour["props"]
    assert _decode_array(output, contour["data"]["path_codes"]).size > 0
    assert final_axis["title"] == "Contours"
    assert final_axis["x"]["label"] == "x"
    assert len(text) == 1
    assert text[0]["data"]["text"] == "label"


def test_savefig_always_records_processing_time(tmp_path):
    figure, axes = plt.subplots()
    axes.plot([0, 1], [0, 1])

    output = mplot.savefig(tmp_path / "minimal-metadata.mplot", figure, provenance=False)
    manifest = tomllib.loads((output / "manifest.toml").read_text())

    assert set(manifest["provenance"]) == {"created_utc", "git_commit"}
    assert manifest["provenance"]["created_utc"].endswith("Z")
    assert len(manifest["provenance"]["git_commit"]) == 40


def test_savefig_marks_colorbars_as_auxiliary_axes(tmp_path):
    figure, (image_axes, scatter_axes) = plt.subplots(1, 2)
    image = image_axes.imshow(np.arange(9).reshape(3, 3), cmap="magma")
    scatter = scatter_axes.scatter([0, 1], [0, 1], c=[2, 4], cmap="viridis")
    figure.colorbar(image, ax=image_axes, label="intensity")
    figure.colorbar(scatter, ax=scatter_axes, label="points")

    output = mplot.savefig(tmp_path / "colorbar.mplot", figure, provenance=False)
    _, document = _document_from_result(output)
    plots = [axis for axis in document["figures"][0]["axes"] if axis.get("role") != "colorbar"]
    colorbars = [axis for axis in document["figures"][0]["axes"] if axis.get("role") == "colorbar"]
    assert all(colorbar["artists"] == [] for colorbar in colorbars)
    assert [colorbar["colorbar"]["orientation"] for colorbar in colorbars] == [
        "vertical",
        "vertical",
    ]
    assert [colorbar["colorbar"]["label"] for colorbar in colorbars] == ["intensity", "points"]
    assert colorbars[0]["colorbar"]["limits"] == [0, 8]
    assert colorbars[0]["colorbar"]["mappable"] == plots[0]["artists"][0]["id"]
    assert colorbars[1]["colorbar"]["mappable"] == plots[1]["artists"][0]["id"]
    assert len(colorbars[0]["colorbar"]["colors"]) == 64


def test_savefig_links_filled_contour_colorbar_to_mappable(tmp_path):
    figure, axes = plt.subplots()
    contour = axes.contourf(np.arange(16).reshape(4, 4), levels=[0, 4, 8, 12, 16], cmap="viridis")
    figure.colorbar(contour, ax=axes, label="level")

    output = mplot.savefig(tmp_path / "contour-colorbar.mplot", figure, provenance=False)
    _, document = _document_from_result(output)
    plot = next(axis for axis in document["figures"][0]["axes"] if axis.get("role") != "colorbar")
    colorbar = next(
        axis for axis in document["figures"][0]["axes"] if axis.get("role") == "colorbar"
    )
    extracted = next(artist for artist in plot["artists"] if artist["type"] == "mplot.contourf")

    assert colorbar["colorbar"]["mappable"] == extracted["id"]
    path_values = _decode_array(output, extracted["data"]["path_values"])
    path_lengths = _decode_array(output, extracted["data"]["path_lengths"])
    assert len(path_values) == len(path_lengths) > 0


def test_savefig_preserves_dates_insets_and_public_labels(tmp_path):
    figure, axes = plt.subplots()
    dates = [datetime(2026, 1, 1) + timedelta(days=index) for index in range(3)]
    axes.plot(dates, [1, 2, 3])
    axes.xaxis.set_major_formatter(mdates.DateFormatter("%b %d"))
    inset = axes.inset_axes([0.6, 0.6, 0.2, 0.2])
    inset.plot([0, 1], [0, 1], label="_child0")

    output = mplot.savefig(tmp_path / "semantic-axes.mplot", figure, provenance=False)
    _, document = _document_from_result(output)
    primary, extracted_inset = document["figures"][0]["axes"]
    assert primary["x"]["scale"] == "date"
    assert primary["x"]["date_format"] == "%b %d"
    assert primary["x"]["ticklabels"]
    assert extracted_inset["role"] == "inset"
    assert extracted_inset["parent_axes_id"] == primary["id"]
    assert extracted_inset["artists"][0]["props"]["label"] is None


def test_savefig_preserves_true_3d_surface_and_wire_geometry(tmp_path):
    figure = plt.figure()
    surface_axes = figure.add_subplot(1, 2, 1, projection="3d")
    wire_axes = figure.add_subplot(1, 2, 2, projection="3d")
    values = np.linspace(-1, 1, 6)
    x, y = np.meshgrid(values, values)
    z = np.sin(x) * np.cos(y)
    surface_axes.plot_surface(x, y, z)
    wire_axes.plot_wireframe(x, y, z)

    output = mplot.savefig(tmp_path / "three-dimensional.mplot", figure, provenance=False)
    _, document = _document_from_result(output)
    surface = next(
        artist
        for artist in document["figures"][0]["axes"][0]["artists"]
        if artist["type"] == "mplot.surface3d"
    )
    wire = next(
        artist
        for artist in document["figures"][0]["axes"][1]["artists"]
        if artist["type"] == "mplot.mesh3d"
    )
    surface_vertices = _decode_array(output, surface["data"]["vertices"])
    wire_vertices = _decode_array(output, wire["data"]["vertices"])
    assert surface_vertices.shape[1] == wire_vertices.shape[1] == 3
    assert np.ptp(surface_vertices[:, 0]) > 1
    assert np.ptp(wire_vertices[:, 1]) > 1
    assert len(_decode_array(output, surface["data"]["path_lengths"])) > 1
    assert len(_decode_array(output, wire["data"]["path_lengths"])) > 1


def test_savefig_preserves_large_multi_figure_collections(tmp_path):
    figures = []
    for figure_index in range(10):
        figure, axes = plt.subplots(2, 2)
        for axis_index, axis in enumerate(axes.flat):
            axis.plot([0, 1, 2], [figure_index, axis_index, figure_index + axis_index])
            axis.set_title(f"Figure {figure_index + 1}, plot {axis_index + 1}")
        figures.append(figure)

    output = mplot.savefig(tmp_path / "many.mplot", figures, provenance=False)
    _, document = _document_from_result(output)
    assert len(document["figures"]) == 10
    assert sum(len(figure["axes"]) for figure in document["figures"]) == 40
    positions = [axis["bounds"] for figure in document["figures"] for axis in figure["axes"]]
    assert all(len(position) == 4 for position in positions)
    assert len({tuple(position) for position in positions}) == 4
    plt.close("all")


def test_packed_artifact_contains_manifest_and_all_objects(tmp_path):
    figure, axes = plt.subplots()
    axes.plot([1, 2], [3, 4])
    output = mplot.savefig(tmp_path / "figure.mplot", figure, layout="file", provenance=False)
    with output.open("rb") as handle:
        assert handle.read(8) == b"MPLOT\0\x09\x09"
        manifest_size = struct.unpack("<Q", handle.read(8))[0]
        manifest = tomllib.loads(handle.read(manifest_size).decode())
        object_count = struct.unpack("<Q", handle.read(8))[0]
        objects = {}
        for _ in range(object_count):
            digest = handle.read(32).hex()
            size = struct.unpack("<Q", handle.read(8))[0]
            objects[digest] = handle.read(size)
        assert handle.read() == b""
    assert manifest["document"].split(":", 1)[1] in objects
    assert len(objects) >= 3


def test_show_can_avoid_viewer_side_effect(tmp_path):
    figure, axes = plt.subplots()
    axes.plot([0, 1])
    assert mplot.show(figure, path=tmp_path / "shown.mplot", open_browser=False).exists()


def test_stream_commits_frames_and_closes(tmp_path):
    figure, axes = plt.subplots()
    axes.plot([0, 1])
    with mplot.stream(tmp_path / "live", provenance=False) as session:
        frame = session.send(figure, timestamp=10)
        assert frame.exists()
    index = json.loads((tmp_path / "live.mplot-stream" / "index.json").read_text())
    assert index["closed"] is True
    assert index["frames"] == [{"sequence": 0, "timestamp": 10.0, "artifact": "00000000.mplot"}]
