from __future__ import annotations

import matplotlib.pyplot as plt
import numpy as np
import pytest

import mplot
from helpers import read_result


def test_animation_exposes_defensive_initial_mir(tmp_path):
    figure, axes = plt.subplots()
    axes.plot([0, 1], [0, 1])
    recording = mplot.animation(tmp_path / "initial.mplot", figure, provenance=False)

    initial = recording.initial_mir
    initial.document["figures"].clear()

    assert len(recording.initial_mir.document["figures"]) == 1
    recording.abort()


def test_animation_records_semantic_buffer_updates(tmp_path):
    figure, axes = plt.subplots()
    x = np.linspace(0, 1, 5)
    (line,) = axes.plot(x, x)

    with mplot.animation(
        tmp_path / "wave.mplot", figure, fps=10, layout="file", provenance=False, loop=False
    ) as recording:
        line.set_ydata(x**2)
        recording.capture()
        line.set_ydata(x**3)
        recording.capture(time=0.25)

    assert recording.result is not None
    manifest, document = read_result(recording.result)
    timeline = document["timeline"]
    assert timeline == {
        "duration": 0.25,
        "fps": 10.0,
        "frames": timeline["frames"],
        "loop": False,
    }
    assert [frame["time"] for frame in timeline["frames"]] == [0.1, 0.25]
    assert all(frame["updates"] for frame in timeline["frames"])
    update = timeline["frames"][0]["updates"][0]
    assert update["target_kind"] == "artist"
    assert update["path"] == ["data", "y"]
    assert set(update["value"]) == {"object", "dtype", "shape", "codec"}
    assert manifest["provenance"]["created_utc"].endswith("Z")


def test_empty_animation_is_valid_and_has_zero_duration(tmp_path):
    figure, axes = plt.subplots()
    axes.plot([0, 1], [0, 1])
    recording = mplot.animation(tmp_path / "still.mplot", figure, layout="file", provenance=False)
    output = recording.close()
    _, document = read_result(output)
    assert document["timeline"]["duration"] == 0
    assert document["timeline"]["frames"] == []


def test_animation_rejects_structural_changes_and_bad_times(tmp_path):
    figure, axes = plt.subplots()
    (line,) = axes.plot([0, 1], [0, 1])
    recording = mplot.animation(tmp_path / "invalid.mplot", figure, fps=2)
    line.set_ydata([1, 0])
    recording.capture(time=0.5)
    with pytest.raises(ValueError, match="strictly increasing"):
        recording.capture(time=0.5)
    axes.plot([0, 1], [1, 1])
    with pytest.raises(ValueError, match="add or remove artists"):
        recording.capture(time=1)


def test_animation_records_property_and_axes_updates(tmp_path):
    figure, axes = plt.subplots()
    (line,) = axes.plot([0, 1], [0, 1], color="red")
    recording = mplot.animation(
        tmp_path / "properties.mplot", figure, fps=2, layout="file", provenance=False
    )
    line.set_color("blue")
    axes.set_title("Updated")
    recording.capture()
    output = recording.close()

    _, document = read_result(output)
    updates = document["timeline"]["frames"][0]["updates"]
    assert any(
        update["target_kind"] == "artist" and update["path"] == ["props", "color"]
        for update in updates
    )
    assert any(
        update["target_kind"] == "axes"
        and update["path"] == ["title"]
        and update["value"] == "Updated"
        for update in updates
    )


def test_save_animation_convenience_api(tmp_path):
    figure, axes = plt.subplots()
    x = np.linspace(0, 1, 4)
    (line,) = axes.plot(x, x)

    output = mplot.save_animation(
        tmp_path / "convenience.mplot",
        figure,
        [2, 3],
        lambda power: line.set_ydata(x**power),
        fps=5,
        layout="file",
        provenance=False,
    )

    _, document = read_result(output)
    assert [frame["time"] for frame in document["timeline"]["frames"]] == [0.2, 0.4]
