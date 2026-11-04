from __future__ import annotations

import importlib.util
from pathlib import Path

from helpers import read_result

EXAMPLES = Path(__file__).parent.parent / "examples"
SUPPORTED = {
    "bfplot.contour",
    "bfplot.contourf",
    "bfplot.errorbar",
    "bfplot.fill_between",
    "bfplot.histogram",
    "bfplot.image",
    "bfplot.line",
    "bfplot.line3d",
    "bfplot.mesh3d",
    "bfplot.patch",
    "bfplot.scatter",
    "bfplot.scatter3d",
    "bfplot.surface3d",
    "bfplot.text",
}


def load_example(name: str):
    spec = importlib.util.spec_from_file_location(name, EXAMPLES / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_gallery_covers_every_supported_artist(tmp_path):
    gallery = load_example("gallery")

    directory = gallery.write_gallery(tmp_path / "gallery.bfplot")

    assert directory.is_dir()
    manifest, document = read_result(directory)
    assert [figure["name"] for figure in document["figures"]] == gallery.NAMES
    assert all(figure["title"] for figure in document["figures"])
    ids = [figure["id"] for figure in document["figures"]]
    wave, image = document["timelines"]
    assert wave["figures"] == [ids[0]] and image["figures"] == [ids[1]]
    assert (len(wave["frames"]), wave["fps"], wave["loop"]) == (gallery.FRAMES, 4.0, True)
    assert (len(image["frames"]), image["fps"], image["loop"]) == (gallery.IMAGE_FRAMES, 6.0, False)
    assert set(manifest) == {"format", "version", "hash"}
    types = {
        artist["type"]
        for figure in document["figures"]
        for axes in figure["axes"]
        for artist in axes["artists"]
    }
    assert types == SUPPORTED
