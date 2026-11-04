from __future__ import annotations

import os
import shutil
import warnings

import matplotlib.pyplot as plt
import numpy as np
import pytest

import bfplot
from helpers import read_result


def _objects(path):
    return [item for item in (path / "objects").rglob("*") if item.is_file()]


def _line(label="line"):
    figure, axes = plt.subplots()
    axes.plot([0, 1], [0, 1], label=label)
    return figure


def test_directory_result_is_self_contained_and_ignores_its_objects(tmp_path):
    output = bfplot.savefig(tmp_path / "fit.bfplot", _line())

    assert output == tmp_path / "fit.bfplot"
    assert sorted(item.name for item in output.iterdir()) == [
        ".gitignore",
        "manifest.toml",
        "objects",
    ]
    assert (output / ".gitignore").read_text() == "/objects/\n"
    assert not (tmp_path / ".bfplot").exists()
    assert [item.name for item in tmp_path.iterdir()] == ["fit.bfplot"]
    manifest, document = read_result(output)
    assert set(manifest) == {"format", "version", "hash"}
    assert document["figures"]


def test_results_in_one_directory_do_not_share_objects(tmp_path):
    figure = _line()
    first = bfplot.savefig(tmp_path / "one.bfplot", figure)
    second = bfplot.savefig(tmp_path / "two.bfplot", figure)

    shutil.rmtree(first)

    _, document = read_result(second)
    assert document["figures"]
    assert _objects(second)


def test_path_is_used_exactly_as_given_with_a_warning(tmp_path):
    with pytest.warns(UserWarning, match="does not end in '.bfplot'"):
        output = bfplot.savefig(tmp_path / "results" / "fit", _line())
    assert output == tmp_path / "results" / "fit"
    assert (output / "manifest.toml").is_file()


def test_bfplot_suffix_does_not_warn(tmp_path):
    with warnings.catch_warnings():
        warnings.simplefilter("error")
        bfplot.savefig(tmp_path / "quiet.bfplot", _line())


def test_existing_results_are_replaced(tmp_path):
    path = tmp_path / "fit.bfplot"
    old = _line()
    old.axes[0].set_title("old")
    bfplot.savefig(path, old)
    new = _line()
    new.axes[0].set_title("new")

    output = bfplot.savefig(path, new)

    assert output.is_dir()
    _, document = read_result(output)
    assert document["figures"][0]["axes"][0]["title"] == "new"
    assert [item.name for item in tmp_path.iterdir()] == ["fit.bfplot"]


def test_replacing_a_directory_result_drops_stale_objects(tmp_path):
    path = tmp_path / "fit.bfplot"
    big, axes = plt.subplots()
    axes.plot(np.arange(1000), np.arange(1000))
    bfplot.savefig(path, big)
    before = {item.name for item in _objects(path)}

    bfplot.savefig(path, _line())
    after = {item.name for item in _objects(path)}

    manifest, document = read_result(path)
    referenced = {manifest["hash"].split(":", 1)[1]} | {
        value["object"].split(":", 1)[1]
        for axes in document["figures"][0]["axes"]
        for artist in axes["artists"]
        for value in artist["data"].values()
        if isinstance(value, dict) and "object" in value
    }
    assert before - after
    assert after == referenced


def test_refuses_to_replace_something_that_is_not_a_result_before_any_work(tmp_path):
    notes = tmp_path / "fit.bfplot"
    notes.mkdir()
    (notes / "notes.txt").write_text("keep me")
    with pytest.raises(FileExistsError, match="not a BFPlot result"):
        bfplot.result(notes)
    with pytest.raises(FileExistsError):
        bfplot.savefig(notes, _line())
    assert (notes / "notes.txt").read_text() == "keep me"

    plain = tmp_path / "plain.bfplot"
    plain.write_text("hello")
    with pytest.raises(FileExistsError):
        bfplot.animation(plain, _line())
    assert plain.read_text() == "hello"


def test_empty_directory_may_be_replaced(tmp_path):
    path = tmp_path / "fit.bfplot"
    path.mkdir()
    bfplot.savefig(path, _line())
    assert (path / "manifest.toml").is_file()


def test_result_collects_named_figures(tmp_path):
    spectrum = _line("spectrum line")
    residuals = _line("residual line")

    with bfplot.result(tmp_path / "fit.bfplot") as result:
        assert result.hash is None
        result.add(spectrum, name="spectrum")
        result.add(residuals, name="residuals")

    manifest, document = read_result(tmp_path / "fit.bfplot")
    assert [figure["name"] for figure in document["figures"]] == ["spectrum", "residuals"]
    assert [figure["id"] for figure in document["figures"]] == ["figure-0", "figure-1"]
    artist_ids = [
        artist["id"]
        for figure in document["figures"]
        for axes in figure["axes"]
        for artist in axes["artists"]
    ]
    assert len(artist_ids) == len(set(artist_ids))
    assert result.hash == manifest["hash"] == bfplot.hash(tmp_path / "fit.bfplot")
    assert not hasattr(result, "metadata")
    assert result.names == ["spectrum", "residuals"]


def test_result_captures_figures_when_added(tmp_path):
    figure, axes = plt.subplots()
    (line,) = axes.plot([0, 1], [0, 1])
    with bfplot.result(tmp_path / "fit.bfplot") as result:
        result.add(figure, name="before")
        line.set_ydata([5, 5])

    _, document = read_result(tmp_path / "fit.bfplot")
    assert len(document["figures"]) == 1


def test_matplotlib_labels_become_names_when_unique(tmp_path):
    first = plt.figure("spectrum")
    first.add_subplot().plot([0, 1])
    second = plt.figure("spectrum-copy")
    second.add_subplot().plot([0, 1])
    unnamed = plt.figure()
    unnamed.add_subplot().plot([0, 1])

    output = bfplot.savefig(tmp_path / "labels.bfplot", [first, second, unnamed])

    _, document = read_result(output)
    assert [figure.get("name") for figure in document["figures"]] == [
        "spectrum",
        "spectrum-copy",
        None,
    ]


def test_savefig_accepts_names_for_several_figures(tmp_path):
    output = bfplot.savefig(tmp_path / "pair.bfplot", [_line(), _line()], name=["left", "right"])
    _, document = read_result(output)
    assert [figure["name"] for figure in document["figures"]] == ["left", "right"]


def test_invalid_names_fail_when_added_not_when_written(tmp_path):
    result = bfplot.result(tmp_path / "fit.bfplot")
    result.add(_line(), name="spectrum")
    with pytest.raises(ValueError, match="already used"):
        result.add(_line(), name="spectrum")
    with pytest.raises(ValueError, match="exactly one figure"):
        result.add([_line(), _line()], name="pair")
    with pytest.raises(ValueError, match="one name per figure"):
        result.add([_line(), _line()], name=["only-one"])
    with pytest.raises(ValueError, match="non-empty"):
        result.add(_line(), name="")
    result.close()
    _, document = read_result(tmp_path / "fit.bfplot")
    assert [figure.get("name") for figure in document["figures"]] == ["spectrum"]


def test_failed_result_writes_nothing_and_keeps_previous_result(tmp_path):
    path = tmp_path / "fit.bfplot"
    bfplot.savefig(path, _line())
    before = (path / "manifest.toml").read_bytes()

    with pytest.raises(RuntimeError, match="boom"):
        with bfplot.result(path) as result:
            result.add(_line(), name="partial")
            raise RuntimeError("boom")

    assert (path / "manifest.toml").read_bytes() == before
    assert [item.name for item in tmp_path.iterdir()] == ["fit.bfplot"]


def test_empty_result_is_an_error(tmp_path):
    with pytest.raises(ValueError, match="at least one figure"):
        with bfplot.result(tmp_path / "empty.bfplot"):
            pass
    assert not (tmp_path / "empty.bfplot").exists()


def test_result_mixes_static_figures_with_one_animation(tmp_path):
    static = _line("static")
    moving, axes = plt.subplots()
    x = np.linspace(0, 1, 4)
    (wave,) = axes.plot(x, x)

    with bfplot.result(tmp_path / "mixed.bfplot") as result:
        result.add(static, name="overview")
        with result.animation(moving, name="evolution", fps=4) as recording:
            for power in (2, 3):
                wave.set_ydata(x**power)
                recording.capture()
        result.add(_line("after"), name="summary")

    manifest, document = read_result(tmp_path / "mixed.bfplot")
    assert [figure["name"] for figure in document["figures"]] == [
        "overview",
        "evolution",
        "summary",
    ]
    timeline = document["timelines"][0]
    assert [frame["time"] for frame in timeline["frames"]] == [0.25, 0.5]
    animated_artists = {
        artist["id"] for axes in document["figures"][1]["axes"] for artist in axes["artists"]
    }
    targets = {update["target"] for frame in timeline["frames"] for update in frame["updates"]}
    assert targets <= animated_artists
    assert set(manifest) == {"format", "version", "hash"}


def test_result_holds_independent_animations(tmp_path):
    first, first_axes = plt.subplots()
    (a,) = first_axes.plot([0, 1], [0, 1])
    second, second_axes = plt.subplots()
    (b,) = second_axes.plot([0, 1], [0, 1])

    with bfplot.result(tmp_path / "two.bfplot") as result:
        result.add(_line("static"), name="overview")
        with result.animation(first, name="fast", fps=10) as recording:
            a.set_ydata([1, 0])
            recording.capture()
        with result.animation(second, name="slow", fps=1, loop=False) as recording:
            for value in (2, 3, 4):
                b.set_ydata([value, 0])
                recording.capture()

    _, document = read_result(tmp_path / "two.bfplot")
    ids = {figure["name"]: figure["id"] for figure in document["figures"]}
    fast, slow = document["timelines"]
    assert fast["figures"] == [ids["fast"]] and slow["figures"] == [ids["slow"]]
    assert (fast["fps"], fast["duration"], fast["loop"]) == (10.0, 0.1, True)
    assert (slow["fps"], slow["duration"], slow["loop"]) == (1.0, 3.0, False)
    assert len(fast["frames"]) == 1 and len(slow["frames"]) == 3


def test_timeline_updates_must_stay_within_their_figures():
    from bfplot.bfir import BfirDocument, BfirValidationError

    def figure(index):
        artist = {"id": f"line-{index}", "axes_id": f"axes-{index}", "type": "bfplot.line"}
        axes = {"id": f"axes-{index}", "artists": [artist | {"props": {}, "data": {}}]}
        return {"id": f"figure-{index}", "axes": [axes]}

    def timeline(figures, target):
        update = {"target_kind": "artist", "target": target, "path": ["props"], "value": {}}
        return {
            "figures": figures,
            "fps": 1,
            "duration": 1,
            "frames": [{"time": 1, "updates": [update]}],
        }

    def errors(timelines):
        document = BfirDocument({"figures": [figure(0), figure(1)], "timelines": timelines}, {})
        with pytest.raises(BfirValidationError) as error:
            document.validate()
        return str(error.value)

    BfirDocument(
        {
            "figures": [figure(0), figure(1)],
            "timelines": [timeline(["figure-0"], "line-0"), timeline(["figure-1"], "line-1")],
        },
        {},
    ).validate()
    assert "outside this timeline's figures" in errors([timeline(["figure-0"], "line-1")])
    assert "more than one timeline" in errors(
        [timeline(["figure-0"], "line-0"), timeline(["figure-0"], "line-0")]
    )
    assert "unknown figure" in errors([timeline(["nope"], "line-0")])


def test_result_closes_an_unclosed_animation(tmp_path):
    figure, axes = plt.subplots()
    (line,) = axes.plot([0, 1], [0, 1])
    with bfplot.result(tmp_path / "auto.bfplot") as result:
        recording = result.animation(figure, fps=2)
        line.set_ydata([1, 0])
        recording.capture()
    _, document = read_result(tmp_path / "auto.bfplot")
    assert len(document["timelines"][0]["frames"]) == 1


def test_standalone_animation_writes_a_directory_by_default(tmp_path):
    figure, axes = plt.subplots()
    (line,) = axes.plot([0, 1], [0, 1])
    with bfplot.animation(tmp_path / "wave.bfplot", figure, fps=2) as recording:
        line.set_ydata([1, 0])
        recording.capture()
    assert recording.result == tmp_path / "wave.bfplot"
    assert (recording.result / "manifest.toml").is_file()


def test_written_results_honor_the_umask(tmp_path):
    output = bfplot.savefig(tmp_path / "fit.bfplot", _line())
    umask = os.umask(0)
    os.umask(umask)
    assert (output / "manifest.toml").stat().st_mode & 0o777 == 0o666 & ~umask
    assert output.stat().st_mode & 0o777 == 0o777 & ~umask
