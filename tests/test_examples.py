from __future__ import annotations

import importlib.util
from pathlib import Path

from helpers import read_result

EXAMPLES = Path(__file__).parent.parent / "examples"
SUPPORTED = {
    "mplot.contour",
    "mplot.contourf",
    "mplot.errorbar",
    "mplot.fill_between",
    "mplot.histogram",
    "mplot.image",
    "mplot.line",
    "mplot.line3d",
    "mplot.mesh3d",
    "mplot.patch",
    "mplot.scatter",
    "mplot.scatter3d",
    "mplot.surface3d",
    "mplot.text",
}


def load_example(name: str):
    spec = importlib.util.spec_from_file_location(name, EXAMPLES / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_gallery_covers_every_supported_artist_in_both_layouts(tmp_path):
    gallery = load_example("gallery")

    directory = gallery.write_gallery(tmp_path / "gallery.mplot")
    packed = gallery.write_gallery(tmp_path / "packed.mplot", packed=True)

    assert directory.is_dir() and packed.is_file()
    manifest, document = read_result(directory)
    packed_manifest, _ = read_result(packed)
    # The same seed gives the same document, whatever the layout.
    assert manifest["document"] == packed_manifest["document"]
    assert [figure["name"] for figure in document["figures"]] == gallery.NAMES
    assert all(figure["title"] for figure in document["figures"])
    assert len(document["timeline"]["frames"]) == gallery.FRAMES
    assert manifest["provenance"]["extra"] == {"example": "gallery", "seed": gallery.SEED}
    types = {
        artist["type"]
        for figure in document["figures"]
        for axes in figure["axes"]
        for artist in axes["artists"]
    }
    assert types == SUPPORTED
