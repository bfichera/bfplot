from __future__ import annotations

import matplotlib.pyplot as plt
import numpy as np
import pytest

import bfplot
from bfplot.bfir import BfirBuilder, BfirValidationError


def test_bfir_buffers_are_owned_immutable_copies() -> None:
    source = np.arange(4, dtype=float)
    builder = BfirBuilder(metadata={"created_utc": "2026-01-01T00:00:00Z"})
    reference = builder.buffer(source)
    document = {
        "figures": [
            {
                "id": "figure-0",
                "axes": [
                    {
                        "id": "axes-0",
                        "artists": [
                            {
                                "id": "artist-0",
                                "axes_id": "axes-0",
                                "type": "bfplot.line",
                                "props": {},
                                "data": {"x": reference},
                            }
                        ],
                    }
                ],
            }
        ],
    }
    bfir = builder.build(document)
    source[:] = -1

    buffer = next(iter(bfir.buffers.values())).array
    assert buffer.tolist() == [0, 1, 2, 3]
    assert not buffer.flags.writeable


def test_matplotlib_translation_produces_local_typed_buffers() -> None:
    figure, axes = plt.subplots()
    image = axes.imshow(np.arange(9).reshape(3, 3), cmap="magma")
    figure.colorbar(image, ax=axes, label="intensity")

    bfir = bfplot.translate(figure, metadata={"created_utc": "2026-01-01T00:00:00Z"})

    assert bfir.metadata["created_utc"] == "2026-01-01T00:00:00Z"
    assert bfir.buffers
    assert all(
        buffer.array.flags.c_contiguous and not buffer.array.flags.writeable
        for buffer in bfir.buffers.values()
    )
    plot = next(
        axis for axis in bfir.document["figures"][0]["axes"] if axis.get("role") != "colorbar"
    )
    colorbar = next(
        axis for axis in bfir.document["figures"][0]["axes"] if axis.get("role") == "colorbar"
    )
    extracted = next(artist for artist in plot["artists"] if artist["type"] == "bfplot.image")
    assert set(extracted["data"]["values"]) == {"$buffer"}
    assert colorbar["colorbar"]["mappable"] == extracted["id"]


def test_3d_scatter_translation_has_no_orphaned_buffers() -> None:
    figure = plt.figure()
    axes = figure.add_subplot(projection="3d")
    axes.scatter([0, 1], [1, 2], [2, 3], c=[0, 1])

    bfir = bfplot.translate(figure)

    referenced = set()
    for artist in bfir.document["figures"][0]["axes"][0]["artists"]:
        for value in artist["data"].values():
            if isinstance(value, dict) and "$buffer" in value:
                referenced.add(value["$buffer"])
    assert referenced == set(bfir.buffers)


def test_bfir_validation_rejects_dangling_buffers_and_references() -> None:
    builder = BfirBuilder(metadata={"created_utc": "2026-01-01T00:00:00Z"})
    document = {
        "figures": [
            {
                "id": "figure-0",
                "axes": [
                    {
                        "id": "axes-0",
                        "artists": [
                            {
                                "id": "artist-0",
                                "axes_id": "wrong-axes",
                                "type": "bfplot.line",
                                "props": {},
                                "data": {"x": {"$buffer": "missing"}},
                            }
                        ],
                        "colorbar": {"mappable": "missing-artist"},
                    }
                ],
            }
        ],
    }

    with pytest.raises(BfirValidationError, match="dangling buffer reference") as error:
        builder.build(document)
    assert "must reference its containing axes" in str(error.value)
    assert "dangling colorbar mappable" in str(error.value)


def test_bfir_validation_requires_processing_metadata() -> None:
    builder = BfirBuilder(metadata={})
    with pytest.raises(BfirValidationError, match="metadata.created_utc is required"):
        builder.build({"figures": []})


def test_bfir_validation_rejects_bad_and_duplicate_figure_names() -> None:
    builder = BfirBuilder(metadata={"created_utc": "2026-01-01T00:00:00Z"})
    document = {
        "figures": [
            {"id": "figure-0", "name": "spectrum", "axes": []},
            {"id": "figure-1", "name": "spectrum", "axes": []},
            {"id": "figure-2", "name": "", "axes": []},
        ],
    }
    with pytest.raises(BfirValidationError, match="duplicate figure name") as error:
        builder.build(document)
    assert "figures[2].name must be a non-empty string" in str(error.value)
