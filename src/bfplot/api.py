from __future__ import annotations

import shutil
import subprocess
import tempfile
from collections.abc import Callable, Iterable
from pathlib import Path
from typing import Any, TypeVar

from matplotlib.figure import Figure

from .adapters.matplotlib import translate_figures
from .artifact import Layout, prepare_destination, write_result
from .mir import MirDocument
from .provenance import processing_metadata
from .result import Result, figures_from, provenance_metadata, result
from .temporal import Animation

Frame = TypeVar("Frame")


def translate(
    figure: Figure | Iterable[Figure] | None = None,
    *,
    metadata: dict[str, Any] | None = None,
) -> MirDocument:
    """Translate Matplotlib figures into validated, storage-independent MIR."""
    processing = processing_metadata()
    if metadata is not None:
        if not isinstance(metadata, dict):
            raise TypeError("metadata must be a dictionary")
        processing.update(metadata)
    return translate_figures(figures_from(figure), processing)[0]


def compile(
    document: MirDocument,
    path: str | Path,
    *,
    layout: Layout = "directory",
) -> Path:
    """Compile validated MIR into one content-addressed BFPlot result at exactly ``path``."""
    if not isinstance(document, MirDocument):
        raise TypeError("document must be a MirDocument")
    output = Path(path)
    layout = prepare_destination(output, layout)
    return write_result(output, document, layout)


def animation(
    path: str | Path,
    figure: Figure | Iterable[Figure] | None = None,
    *,
    fps: float = 30,
    layout: Layout = "directory",
    provenance: bool | dict[str, Any] = True,
    loop: bool = True,
) -> Animation:
    """Record mutable Matplotlib figures into one temporal BFPlot result."""
    output = Path(path)
    layout = prepare_destination(output, layout)
    metadata = provenance_metadata(provenance)

    return Animation(
        figure,
        fps=fps,
        loop=loop,
        translator=lambda source, meta: translate_figures(figures_from(source), meta)[0],
        metadata=metadata,
        finisher=lambda document: write_result(output, document, layout),
    )


def save_animation(
    path: str | Path,
    figure: Figure | Iterable[Figure],
    frames: Iterable[Frame],
    update: Callable[[Frame], Any],
    *,
    fps: float = 30,
    layout: Layout = "directory",
    provenance: bool | dict[str, Any] = True,
    loop: bool = True,
) -> Path:
    """Apply ``update(frame)`` and capture each resulting Matplotlib state."""
    recording = animation(path, figure, fps=fps, layout=layout, provenance=provenance, loop=loop)
    try:
        for frame in frames:
            update(frame)
            recording.capture()
        written = recording.close()
    except BaseException:
        recording.abort()
        raise
    assert written is not None
    return written


def savefig(
    path: str | Path,
    figure: Figure | Iterable[Figure] | None = None,
    *,
    name: str | Iterable[str | None] | None = None,
    layout: Layout = "directory",
    provenance: bool | dict[str, Any] = True,
) -> Path:
    """Save Matplotlib figures as one BFPlot result at exactly ``path``.

    The default ``layout="directory"`` writes a self-contained result directory whose
    numerical objects are ignored by Git. ``layout="file"`` writes one packed file. An
    existing BFPlot result at ``path`` is replaced. Passing ``provenance=False`` omits
    environment details but still records creation time and the Git commit.
    """
    output = Result(path, layout=layout, provenance=provenance, _stacklevel=2)
    output.add(figure, name=name)
    return output.close()


def show(
    figure: Figure | Iterable[Figure] | None = None,
    *,
    path: str | Path | None = None,
    open_browser: bool = True,
    layout: Layout = "directory",
) -> Path:
    """Save a result and open it with ``bfplot view`` (a temporary packed file by default)."""
    if path is None:
        path = Path(tempfile.mkdtemp(prefix="bfplot-show-")) / "figure.bfplot"
        layout = "file"
    output = savefig(path, figure, layout=layout)
    if open_browser:
        executable = shutil.which("bfplot")
        if executable is None:
            raise RuntimeError("the bfplot CLI is not installed; use open_browser=False")
        subprocess.Popen([executable, "view", str(output)], start_new_session=True)
    return output


__all__ = [
    "Animation",
    "Result",
    "animation",
    "compile",
    "result",
    "save_animation",
    "savefig",
    "show",
    "translate",
]
