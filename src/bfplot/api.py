from __future__ import annotations

import os
import shutil
import subprocess
import sysconfig
import tempfile
from collections.abc import Callable, Iterable
from pathlib import Path
from typing import Any, TypeVar

from matplotlib.figure import Figure

from .adapters.matplotlib import translate_figures
from .artifact import Layout, prepare_destination, write_result
from .bfir import BfirDocument
from .provenance import processing_metadata
from .result import Result, figures_from, provenance_metadata, result
from .temporal import Animation

Frame = TypeVar("Frame")


def translate(
    figure: Figure | Iterable[Figure] | None = None,
    *,
    metadata: dict[str, Any] | None = None,
) -> BfirDocument:
    """Translate Matplotlib figures into validated, storage-independent BFIR."""
    processing = processing_metadata()
    if metadata is not None:
        if not isinstance(metadata, dict):
            raise TypeError("metadata must be a dictionary")
        processing.update(metadata)
    return translate_figures(figures_from(figure), processing)[0]


def compile(
    document: BfirDocument,
    path: str | Path,
    *,
    layout: Layout = "directory",
    preview: bool = True,
) -> Path:
    """Compile validated BFIR into one content-addressed BFPlot result at exactly ``path``."""
    if not isinstance(document, BfirDocument):
        raise TypeError("document must be a BfirDocument")
    output = Path(path)
    layout = prepare_destination(output, layout)
    return write_result(output, document, layout, preview=preview)


def animation(
    path: str | Path,
    figure: Figure | Iterable[Figure] | None = None,
    *,
    fps: float = 30,
    layout: Layout = "directory",
    provenance: bool | dict[str, Any] = True,
    loop: bool = True,
    preview: bool = True,
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
        finisher=lambda document: write_result(output, document, layout, preview=preview),
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
    preview: bool = True,
) -> Path:
    """Apply ``update(frame)`` and capture each resulting Matplotlib state."""
    recording = animation(
        path,
        figure,
        fps=fps,
        layout=layout,
        provenance=provenance,
        loop=loop,
        preview=preview,
    )
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
    preview: bool = True,
) -> Path:
    """Save Matplotlib figures as one BFPlot result at exactly ``path``.

    The default ``layout="directory"`` writes a self-contained result directory whose
    numerical objects are ignored by Git. ``layout="file"`` writes one packed file. An
    existing BFPlot result at ``path`` is replaced. Passing ``provenance=False`` omits
    environment details but still records creation time and the Git commit. With
    ``preview=True`` the manifest ends with a rough text drawing of the figures.
    """
    output = Result(path, layout=layout, provenance=provenance, preview=preview, _stacklevel=2)
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
        executable = _find_executable()
        if executable is None:
            raise RuntimeError(
                "the bfplot app is not installed (see the installation docs); use open_browser=False"
            )
        subprocess.Popen([executable, "view", str(output)], start_new_session=True)
    return output


def _find_executable() -> str | None:
    """The ``bfplot`` app, preferring the one installed in this Python environment.

    A source install (``pip install ./crates/bfplot-cli``) puts it next to this interpreter's
    scripts, which may not be on ``PATH`` when the environment is not activated.
    """
    name = "bfplot.exe" if os.name == "nt" else "bfplot"
    for scheme in dict.fromkeys(
        [sysconfig.get_default_scheme(), sysconfig.get_preferred_scheme("user")]
    ):
        candidate = Path(sysconfig.get_path("scripts", scheme)) / name
        if candidate.is_file() and os.access(candidate, os.X_OK):
            return str(candidate)
    return shutil.which("bfplot")


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
