from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
import time
from collections.abc import Callable, Iterable
from pathlib import Path
from typing import Any, TypeVar

from matplotlib.figure import Figure

from .adapters.matplotlib import translate_figures
from .artifact import Layout, prepare_destination
from .mir import MirDocument
from .provenance import processing_metadata
from .result import Result, compile_document, figures_from, provenance_metadata, result
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
    return translate_figures(figures_from(figure), processing)


def compile(
    document: MirDocument,
    path: str | Path,
    *,
    layout: Layout = "directory",
) -> Path:
    """Compile validated MIR into one content-addressed MPlot result at exactly ``path``."""
    if not isinstance(document, MirDocument):
        raise TypeError("document must be a MirDocument")
    output = Path(path)
    layout = prepare_destination(output, layout)
    return compile_document(document, output, layout)


def animation(
    path: str | Path,
    figure: Figure | Iterable[Figure] | None = None,
    *,
    fps: float = 30,
    layout: Layout = "directory",
    provenance: bool | dict[str, Any] = True,
    loop: bool = True,
) -> Animation:
    """Record mutable Matplotlib figures into one temporal MPlot result."""
    output = Path(path)
    layout = prepare_destination(output, layout)
    metadata = provenance_metadata(provenance)

    def translator(
        source: Figure | Iterable[Figure] | None, frame_metadata: dict[str, Any]
    ) -> MirDocument:
        return translate_figures(figures_from(source), frame_metadata)

    return Animation(
        figure,
        fps=fps,
        loop=loop,
        translator=translator,
        finisher=lambda document: compile_document(document, output, layout),
        metadata=metadata,
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
    """Save Matplotlib figures as one MPlot result at exactly ``path``.

    The default ``layout="directory"`` writes a self-contained result directory whose
    numerical objects are ignored by Git. ``layout="file"`` writes one packed file. An
    existing MPlot result at ``path`` is replaced. Passing ``provenance=False`` omits
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
    """Save an artifact and ask an installed MPlot viewer to open it."""
    if path is None:
        path = Path(tempfile.mkdtemp(prefix="mplot-show-")) / "figure.mplot"
        layout = "file"
    artifact = savefig(path, figure, layout=layout)
    if open_browser:
        executable = shutil.which("mplot")
        if executable is None:
            raise RuntimeError(
                "the mplot viewer executable is not installed; use open_browser=False"
            )
        subprocess.Popen([executable, "view", str(artifact)], start_new_session=True)
    return artifact


class Stream:
    """Append-only stream of immutable MPlot frame artifacts.

    Frames are written to ``<path>.mplot-stream/frames`` and an atomic JSON
    index advertises committed frames. A viewer can watch the index without
    observing partially written frames.
    """

    def __init__(self, path: str | Path, *, provenance: bool | dict[str, Any] = True):
        path = Path(path)
        self.path = (
            path
            if path.name.endswith(".mplot-stream")
            else path.with_name(path.name + ".mplot-stream")
        )
        self.frames = self.path / "frames"
        self.provenance = provenance
        self._entries: list[dict[str, Any]] = []
        self._closed = False
        self.frames.mkdir(parents=True, exist_ok=True)
        self._write_index()

    def send(
        self, figure: Figure | Iterable[Figure] | None = None, *, timestamp: float | None = None
    ) -> Path:
        if self._closed:
            raise RuntimeError("stream is closed")
        number = len(self._entries)
        frame = savefig(
            self.frames / f"{number:08d}.mplot", figure, layout="file", provenance=self.provenance
        )
        self._entries.append(
            {
                "sequence": number,
                "timestamp": time.time() if timestamp is None else float(timestamp),
                "artifact": frame.name,
            }
        )
        self._write_index()
        return frame

    append = send

    def close(self) -> None:
        if not self._closed:
            self._closed = True
            self._write_index()

    def _write_index(self) -> None:
        data = json.dumps(
            {"version": "0.9.9", "closed": self._closed, "frames": self._entries},
            sort_keys=True,
            separators=(",", ":"),
        ).encode()
        temporary = self.path / ".index.json.tmp"
        temporary.write_bytes(data)
        temporary.replace(self.path / "index.json")

    def __enter__(self) -> Stream:
        return self

    def __exit__(self, *_: Any) -> None:
        self.close()


def stream(path: str | Path, *, provenance: bool | dict[str, Any] = True) -> Stream:
    return Stream(path, provenance=provenance)


__all__ = [
    "Animation",
    "Result",
    "Stream",
    "animation",
    "compile",
    "result",
    "save_animation",
    "savefig",
    "show",
    "stream",
    "translate",
]
