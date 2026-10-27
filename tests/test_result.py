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
    output = bfplot.savefig(tmp_path / "fit.bfplot", _line(), provenance=False)

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
    assert set(manifest) == {"format", "version", "document", "provenance"}
    assert document["figures"]


def test_results_in_one_directory_do_not_share_objects(tmp_path):
    figure = _line()
    first = bfplot.savefig(tmp_path / "one.bfplot", figure, provenance=False)
    second = bfplot.savefig(tmp_path / "two.bfplot", figure, provenance=False)

    shutil.rmtree(first)

    _, document = read_result(second)
    assert document["figures"]
    assert _objects(second)


def test_path_is_used_exactly_as_given_with_a_warning(tmp_path):
    with pytest.warns(UserWarning, match="does not end in '.bfplot'"):
        output = bfplot.savefig(tmp_path / "results" / "fit", _line(), provenance=False)
    assert output == tmp_path / "results" / "fit"
    assert (output / "manifest.toml").is_file()

    with pytest.warns(UserWarning):
        packed = bfplot.savefig(tmp_path / "fit.bin", _line(), layout="file", provenance=False)
    assert packed == tmp_path / "fit.bin"
    assert packed.is_file()


def test_bfplot_suffix_does_not_warn(tmp_path):
    with warnings.catch_warnings():
        warnings.simplefilter("error")
        bfplot.savefig(tmp_path / "quiet.bfplot", _line(), provenance=False)


def test_file_layout_writes_one_packed_file(tmp_path):
    output = bfplot.savefig(tmp_path / "fit.bfplot", _line(), layout="file", provenance=False)
    assert output.is_file()
    manifest, document = read_result(output)
    assert manifest["format"] == "bfplot"
    assert document["figures"][0]["axes"]


def test_rejects_unknown_layout(tmp_path):
    with pytest.raises(ValueError, match="layout must be one of"):
        bfplot.savefig(tmp_path / "fit.bfplot", _line(), layout="split")


@pytest.mark.parametrize(
    ("first", "second"),
    [
        ("directory", "directory"),
        ("directory", "file"),
        ("file", "directory"),
        ("file", "file"),
    ],
)
def test_existing_results_are_replaced_in_either_layout(tmp_path, first, second):
    path = tmp_path / "fit.bfplot"
    old = _line()
    old.axes[0].set_title("old")
    bfplot.savefig(path, old, layout=first, provenance=False)
    new = _line()
    new.axes[0].set_title("new")

    output = bfplot.savefig(path, new, layout=second, provenance=False)

    assert output.is_dir() == (second == "directory")
    _, document = read_result(output)
    assert document["figures"][0]["axes"][0]["title"] == "new"
    assert [item.name for item in tmp_path.iterdir()] == ["fit.bfplot"]


def test_replacing_a_directory_result_drops_stale_objects(tmp_path):
    path = tmp_path / "fit.bfplot"
    big, axes = plt.subplots()
    axes.plot(np.arange(1000), np.arange(1000))
    bfplot.savefig(path, big, provenance=False)
    before = {item.name for item in _objects(path)}

    bfplot.savefig(path, _line(), provenance=False)
    after = {item.name for item in _objects(path)}

    manifest, document = read_result(path)
    referenced = {manifest["document"].split(":", 1)[1]} | {
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
    bfplot.savefig(path, _line(), provenance=False)
    assert (path / "manifest.toml").is_file()


def test_result_collects_named_figures_and_metadata(tmp_path):
    spectrum = _line("spectrum line")
    residuals = _line("residual line")

    with bfplot.result(tmp_path / "fit.bfplot", provenance=False) as result:
        result.add(spectrum, name="spectrum")
        result.add(residuals, name="residuals")
        result.metadata["chi2"] = np.float64(1.25)
        result.metadata["fit"] = {"model": "gaussian", "parameters": np.array([1.0, 2.0])}

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
    assert manifest["provenance"]["extra"] == {
        "chi2": 1.25,
        "fit": {"model": "gaussian", "parameters": [1.0, 2.0]},
    }
    assert result.names == ["spectrum", "residuals"]


def test_result_captures_figures_when_added(tmp_path):
    figure, axes = plt.subplots()
    (line,) = axes.plot([0, 1], [0, 1])
    with bfplot.result(tmp_path / "fit.bfplot", provenance=False) as result:
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

    output = bfplot.savefig(tmp_path / "labels.bfplot", [first, second, unnamed], provenance=False)

    _, document = read_result(output)
    assert [figure.get("name") for figure in document["figures"]] == [
        "spectrum",
        "spectrum-copy",
        None,
    ]


def test_savefig_accepts_names_for_several_figures(tmp_path):
    output = bfplot.savefig(
        tmp_path / "pair.bfplot", [_line(), _line()], name=["left", "right"], provenance=False
    )
    _, document = read_result(output)
    assert [figure["name"] for figure in document["figures"]] == ["left", "right"]


def test_invalid_names_fail_when_added_not_when_written(tmp_path):
    result = bfplot.result(tmp_path / "fit.bfplot", provenance=False)
    result.add(_line(), name="spectrum")
    with pytest.raises(ValueError, match="already used"):
        result.add(_line(), name="spectrum")
    with pytest.raises(ValueError, match="exactly one figure"):
        result.add([_line(), _line()], name="pair")
    with pytest.raises(ValueError, match="one name per figure"):
        result.add([_line(), _line()], name=["only-one"])
    with pytest.raises(ValueError, match="non-empty"):
        result.add(_line(), name="")
    with pytest.raises(TypeError, match="cannot represent"):
        result.metadata["bad"] = object()
    result.close()
    _, document = read_result(tmp_path / "fit.bfplot")
    assert [figure.get("name") for figure in document["figures"]] == ["spectrum"]


def test_failed_result_writes_nothing_and_keeps_previous_result(tmp_path):
    path = tmp_path / "fit.bfplot"
    bfplot.savefig(path, _line(), provenance=False)
    before = (path / "manifest.toml").read_bytes()

    with pytest.raises(RuntimeError, match="boom"):
        with bfplot.result(path, provenance=False) as result:
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

    with bfplot.result(tmp_path / "mixed.bfplot", provenance=False) as result:
        result.add(static, name="overview")
        with result.animation(moving, name="evolution", fps=4) as recording:
            for power in (2, 3):
                wave.set_ydata(x**power)
                recording.capture()
        result.add(_line("after"), name="summary")
        with pytest.raises(RuntimeError, match="only one animation"):
            result.animation(_line())

    manifest, document = read_result(tmp_path / "mixed.bfplot")
    assert [figure["name"] for figure in document["figures"]] == [
        "overview",
        "evolution",
        "summary",
    ]
    timeline = document["timeline"]
    assert [frame["time"] for frame in timeline["frames"]] == [0.25, 0.5]
    animated_artists = {
        artist["id"] for axes in document["figures"][1]["axes"] for artist in axes["artists"]
    }
    targets = {update["target"] for frame in timeline["frames"] for update in frame["updates"]}
    assert targets <= animated_artists
    assert manifest["provenance"]["temporal"]["frames"] == 2


def test_result_closes_an_unclosed_animation(tmp_path):
    figure, axes = plt.subplots()
    (line,) = axes.plot([0, 1], [0, 1])
    with bfplot.result(tmp_path / "auto.bfplot", provenance=False) as result:
        recording = result.animation(figure, fps=2)
        line.set_ydata([1, 0])
        recording.capture()
    _, document = read_result(tmp_path / "auto.bfplot")
    assert len(document["timeline"]["frames"]) == 1


def test_standalone_animation_writes_a_directory_by_default(tmp_path):
    figure, axes = plt.subplots()
    (line,) = axes.plot([0, 1], [0, 1])
    with bfplot.animation(tmp_path / "wave.bfplot", figure, fps=2, provenance=False) as recording:
        line.set_ydata([1, 0])
        recording.capture()
    assert recording.result == tmp_path / "wave.bfplot"
    assert (recording.result / "manifest.toml").is_file()


def test_written_results_honor_the_umask(tmp_path):
    output = bfplot.savefig(tmp_path / "fit.bfplot", _line(), provenance=False)
    umask = os.umask(0)
    os.umask(umask)
    assert (output / "manifest.toml").stat().st_mode & 0o777 == 0o666 & ~umask
    assert output.stat().st_mode & 0o777 == 0o777 & ~umask


def test_nested_metadata_round_trips_through_toml(tmp_path):
    with bfplot.result(tmp_path / "nested.bfplot", provenance={"run": {"seed": 4}}) as result:
        result.add(_line())
        result.metadata["fit"] = {"model": {"kind": "gaussian", "order": 2}, "odd key": [1, 2]}
        result.metadata["path"] = tmp_path / "input.npz"

    manifest, _ = read_result(tmp_path / "nested.bfplot")
    extra = manifest["provenance"]["extra"]
    assert extra["run"] == {"seed": 4}
    assert extra["fit"] == {"model": {"kind": "gaussian", "order": 2}, "odd key": [1, 2]}
    assert extra["path"] == str(tmp_path / "input.npz")
