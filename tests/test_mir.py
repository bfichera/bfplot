from __future__ import annotations

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pytest

import mplot
from mplot.mir import MirBuilder, MirValidationError


def test_mir_buffers_are_owned_immutable_copies() -> None:
    source = np.arange(4, dtype=float)
    builder = MirBuilder(metadata={"created_utc": "2026-01-01T00:00:00Z"})
    reference = builder.buffer(source)
    document = {
        "schema_version": 1,
        "figures": [{
            "id": "figure-0",
            "axes": [{
                "id": "axes-0",
                "artists": [{
                    "id": "artist-0",
                    "axes_id": "axes-0",
                    "type": "mplot.line",
                    "props": {},
                    "data": {"x": reference},
                }],
            }],
        }],
        "links": [],
        "selections": [],
    }
    mir = builder.build(document)
    source[:] = -1

    buffer = next(iter(mir.buffers.values())).array
    assert buffer.tolist() == [0, 1, 2, 3]
    assert not buffer.flags.writeable


def test_matplotlib_translation_produces_local_typed_buffers() -> None:
    figure, axes = plt.subplots()
    image = axes.imshow(np.arange(9).reshape(3, 3), cmap="magma")
    figure.colorbar(image, ax=axes, label="intensity")

    mir = mplot.translate(figure, metadata={"created_utc": "2026-01-01T00:00:00Z"})

    assert mir.mir_version == "1.0"
    assert mir.metadata["created_utc"] == "2026-01-01T00:00:00Z"
    assert mir.buffers
    assert all(buffer.array.flags.c_contiguous and not buffer.array.flags.writeable for buffer in mir.buffers.values())
    plot = next(axis for axis in mir.document["figures"][0]["axes"] if axis.get("role") != "colorbar")
    colorbar = next(axis for axis in mir.document["figures"][0]["axes"] if axis.get("role") == "colorbar")
    extracted = next(artist for artist in plot["artists"] if artist["type"] == "mplot.image")
    assert set(extracted["data"]["values"]) == {"$buffer"}
    assert colorbar["colorbar"]["mappable"] == extracted["id"]


def test_3d_scatter_translation_has_no_orphaned_buffers() -> None:
    figure = plt.figure()
    axes = figure.add_subplot(projection="3d")
    axes.scatter([0, 1], [1, 2], [2, 3], c=[0, 1])

    mir = mplot.translate(figure)

    referenced = set()
    for artist in mir.document["figures"][0]["axes"][0]["artists"]:
        for value in artist["data"].values():
            if isinstance(value, dict) and "$buffer" in value:
                referenced.add(value["$buffer"])
    assert referenced == set(mir.buffers)


def test_mir_validation_rejects_dangling_buffers_and_references() -> None:
    builder = MirBuilder(metadata={"created_utc": "2026-01-01T00:00:00Z"})
    document = {
        "schema_version": 1,
        "figures": [{
            "id": "figure-0",
            "axes": [{
                "id": "axes-0",
                "artists": [{
                    "id": "artist-0",
                    "axes_id": "wrong-axes",
                    "type": "mplot.line",
                    "props": {},
                    "data": {"x": {"$buffer": "missing"}},
                }],
                "colorbar": {"mappable": "missing-artist"},
            }],
        }],
        "links": [],
        "selections": [],
    }

    with pytest.raises(MirValidationError, match="dangling buffer reference") as error:
        builder.build(document)
    assert "must reference its containing axes" in str(error.value)
    assert "dangling colorbar mappable" in str(error.value)


def test_mir_validation_requires_processing_metadata() -> None:
    builder = MirBuilder(metadata={})
    with pytest.raises(MirValidationError, match="metadata.created_utc is required"):
        builder.build({"schema_version": 1, "figures": [], "links": [], "selections": []})
