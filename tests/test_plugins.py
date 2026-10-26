from __future__ import annotations

import json
import tomllib

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import Circle
import pytest

import mplot
from mplot.plugins import PluginRegistry


def test_plugin_registry_requires_reverse_dns_name():
    registry = PluginRegistry()
    with pytest.raises(ValueError):
        registry.register("circle", Circle, lambda artist, context: {})
    with pytest.raises(ValueError):
        registry.register("mplot.circle", Circle, lambda artist, context: {})
    registry.register("org.example.circle", Circle, lambda artist, context: {})
    with pytest.raises(ValueError, match="already registered"):
        registry.register("org.example.circle", Circle, lambda artist, context: {})


def test_custom_artist_and_requirement_are_extracted(tmp_path):
    plugin = mplot.register_artist(
        "org.example.circle",
        Circle,
        lambda circle, context: {"props": {"radius": circle.radius}, "data": {"center": list(circle.center)}},
        requirement="org.example.shapes>=1",
    )
    try:
        figure, axes = plt.subplots()
        axes.add_patch(Circle((.5, .5), .25))
        output = mplot.savefig(tmp_path / "plugin", figure, provenance=False)
        manifest = tomllib.loads(output.read_text())
        digest = manifest["document"][7:]
        document = json.loads((tmp_path / ".mplot" / "objects" / "sha256" / digest[:2] / digest).read_text())
        assert document["plugin_requirements"] == ["org.example.shapes>=1"]
        artists = document["figures"][0]["axes"][0]["artists"]
        assert any(artist["type"] == "org.example.circle" for artist in artists)
    finally:
        mplot.registry.unregister(plugin)
