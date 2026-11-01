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
from .artifact import (
    ResultError,
    encode_result,
    prepare_destination,
    read_hash,
    verify_result,
    write_result,
)
from .bfir import BfirDocument
from .result import Collection, Result, figures_from, result
from .temporal import Animation

Frame = TypeVar("Frame")
Source = str | os.PathLike[str] | BfirDocument | Figure | Iterable[Figure] | None


def translate(
    figure: Figure | Iterable[Figure] | None = None,
    *,
    name: str | Iterable[str | None] | None = None,
) -> BfirDocument:
    """Translate Matplotlib figures into validated, storage-independent BFIR."""
    collection = Collection()
    collection.add(figure, name=name)
    return collection._finish()


def compile(
    document: BfirDocument,
    path: str | Path,
    *,
    preview: bool = True,
) -> Path:
    """Compile validated BFIR into one content-addressed BFPlot result at exactly ``path``."""
    if not isinstance(document, BfirDocument):
        raise TypeError("document must be a BfirDocument")
    output = Path(path)
    prepare_destination(output)
    return write_result(output, document, preview=preview)


def animation(
    path: str | Path,
    figure: Figure | Iterable[Figure] | None = None,
    *,
    fps: float = 30,
    loop: bool = True,
    preview: bool = True,
) -> Animation:
    """Record mutable Matplotlib figures into one temporal BFPlot result."""
    output = Path(path)
    prepare_destination(output)

    return Animation(
        figure,
        fps=fps,
        loop=loop,
        translator=lambda source: translate_figures(figures_from(source))[0],
        finisher=lambda document: write_result(output, document, preview=preview),
    )


def save_animation(
    path: str | Path,
    figure: Figure | Iterable[Figure],
    frames: Iterable[Frame],
    update: Callable[[Frame], Any],
    *,
    fps: float = 30,
    loop: bool = True,
    preview: bool = True,
) -> Path:
    """Apply ``update(frame)`` and capture each resulting Matplotlib state."""
    recording = animation(path, figure, fps=fps, loop=loop, preview=preview)
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
    preview: bool = True,
) -> Path:
    """Save Matplotlib figures as one BFPlot result at exactly ``path``.

    The result is a self-contained directory whose numerical objects are ignored by Git.
    An existing BFPlot result at ``path`` is replaced. ``bfplot.hash(path)`` returns its
    hash. With ``preview=True`` the manifest ends with a rough text drawing of the figures.
    """
    output = Result(path, preview=preview, _stacklevel=2)
    output.add(figure, name=name)
    return output.close()


def hash(source: Source = None, *, verify: bool = False) -> str:
    """The hash of a result, as ``"sha256:<64 hex digits>"``.

    ``source`` is a result path, a ``BfirDocument``, or Matplotlib figures (default: all
    open figures), which are hashed without writing anything. Two results have the same
    hash exactly when their figures, animations and every array are identical. For a
    path, ``verify=True`` first checks that no object of the result is missing or changed.
    """
    if isinstance(source, (str, os.PathLike)):
        return verify_result(source) if verify else read_hash(source)
    document = source if isinstance(source, BfirDocument) else translate(source)
    return encode_result(document, compress=False)[0]


def same(first: Source, second: Source) -> bool:
    """Whether two results (paths, BFIR or figures, as for ``hash``) are identical."""
    return hash(first) == hash(second)


def verify(path: str | os.PathLike[str]) -> str:
    """Check every object of the result at ``path`` against its digest and return the hash.

    Raises ``bfplot.ResultError`` if the result is incomplete or has been modified.
    """
    return verify_result(path)


def show(
    figure: Figure | Iterable[Figure] | None = None,
    *,
    path: str | Path | None = None,
    open_browser: bool = True,
) -> Path:
    """Save a result and open it with ``bfplot view`` (a temporary result by default)."""
    if path is None:
        path = Path(tempfile.mkdtemp(prefix="bfplot-show-")) / "figure.bfplot"
    output = savefig(path, figure)
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
    "ResultError",
    "animation",
    "compile",
    "hash",
    "result",
    "same",
    "save_animation",
    "savefig",
    "show",
    "translate",
    "verify",
]
