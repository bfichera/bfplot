from __future__ import annotations

import json
import struct
import tomllib

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pytest

import mplot


def _packed_document(path):
    with path.open("rb") as handle:
        assert handle.read(8) == b"MPLOT\0\x09\x09"
        manifest_size = struct.unpack("<Q", handle.read(8))[0]
        manifest = tomllib.loads(handle.read(manifest_size).decode())
        object_count = struct.unpack("<Q", handle.read(8))[0]
        objects = {}
        for _ in range(object_count):
            digest = handle.read(32).hex()
            size = struct.unpack("<Q", handle.read(8))[0]
            objects[digest] = handle.read(size)
    digest = manifest["document"].split(":", 1)[1]
    return manifest, json.loads(objects[digest])


def test_animation_records_semantic_buffer_updates(tmp_path):
    figure, axes = plt.subplots()
    x = np.linspace(0, 1, 5)
    line, = axes.plot(x, x)

    with mplot.animation(tmp_path / "wave.mplot", figure, fps=10, provenance=False, loop=False) as recording:
        line.set_ydata(x**2)
        recording.capture()
        line.set_ydata(x**3)
        recording.capture(time=.25)

    assert recording.result is not None
    manifest, document = _packed_document(recording.result)
    timeline = document["timeline"]
    assert timeline == {
        "duration": .25,
        "fps": 10.0,
        "frames": timeline["frames"],
        "loop": False,
        "version": 1,
    }
    assert [frame["time"] for frame in timeline["frames"]] == [.1, .25]
    assert all(frame["updates"] for frame in timeline["frames"])
    update = timeline["frames"][0]["updates"][0]
    assert update["target_kind"] == "artist"
    assert update["path"] == ["data", "y"]
    assert set(update["value"]) == {"object", "dtype", "shape", "codec"}
    assert manifest["provenance"]["created_utc"].endswith("Z")


def test_empty_animation_is_valid_and_has_zero_duration(tmp_path):
    figure, axes = plt.subplots()
    axes.plot([0, 1], [0, 1])
    recording = mplot.animation(tmp_path / "still.mplot", figure, provenance=False)
    output = recording.close()
    _, document = _packed_document(output)
    assert document["timeline"]["duration"] == 0
    assert document["timeline"]["frames"] == []


def test_animation_rejects_structural_changes_and_bad_times(tmp_path):
    figure, axes = plt.subplots()
    line, = axes.plot([0, 1], [0, 1])
    recording = mplot.animation(tmp_path / "invalid", figure, fps=2)
    line.set_ydata([1, 0])
    recording.capture(time=.5)
    with pytest.raises(ValueError, match="strictly increasing"):
        recording.capture(time=.5)
    axes.plot([0, 1], [1, 1])
    with pytest.raises(ValueError, match="add or remove artists"):
        recording.capture(time=1)


def test_animation_records_property_and_axes_updates(tmp_path):
    figure, axes = plt.subplots()
    line, = axes.plot([0, 1], [0, 1], color="red")
    recording = mplot.animation(tmp_path / "properties.mplot", figure, fps=2, provenance=False)
    line.set_color("blue")
    axes.set_title("Updated")
    recording.capture()
    output = recording.close()

    _, document = _packed_document(output)
    updates = document["timeline"]["frames"][0]["updates"]
    assert any(update["target_kind"] == "artist" and update["path"] == ["props", "color"] for update in updates)
    assert any(update["target_kind"] == "axes" and update["path"] == ["title"] and update["value"] == "Updated" for update in updates)


def test_save_animation_convenience_api(tmp_path):
    figure, axes = plt.subplots()
    x = np.linspace(0, 1, 4)
    line, = axes.plot(x, x)

    output = mplot.save_animation(
        tmp_path / "convenience.mplot",
        figure,
        [2, 3],
        lambda power: line.set_ydata(x**power),
        fps=5,
        provenance=False,
    )

    _, document = _packed_document(output)
    assert [frame["time"] for frame in document["timeline"]["frames"]] == [.2, .4]
