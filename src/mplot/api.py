from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
import time
from collections.abc import Iterable
from pathlib import Path
from typing import Any

import matplotlib.pyplot as plt
from matplotlib.figure import Figure

from .artifact import materialize_document
from .extract import extract_figures
from .provenance import collect_provenance
from .store import ContentStore


def _figures(figure: Figure | Iterable[Figure] | None) -> list[Figure]:
    if figure is None:
        return [plt.figure(number) for number in plt.get_fignums()]
    if isinstance(figure, Figure):
        return [figure]
    figures = list(figure)
    if not all(isinstance(item, Figure) for item in figures):
        raise TypeError("figure must be a Matplotlib Figure or iterable of Figures")
    return figures


def savefig(
    path: str | Path,
    figure: Figure | Iterable[Figure] | None = None,
    *,
    packed: bool | None = None,
    provenance: bool | dict[str, Any] = True,
) -> Path:
    """Extract Matplotlib figures into a content-addressed MPlot artifact.

    ``*.mplot`` paths are packed ZIP artifacts. Other paths produce a split
    ``*.mplot.toml`` manifest and a sibling ``.mplot/objects`` store.
    """
    output = Path(path)
    if packed is None:
        packed = output.suffix == ".mplot"
    with tempfile.TemporaryDirectory(prefix="mplot-") as temporary:
        store = ContentStore(Path(temporary) / "objects")
        document = extract_figures(_figures(figure), store)
        if provenance is True:
            provenance_data = collect_provenance()
        elif provenance is False:
            provenance_data = {}
        elif isinstance(provenance, dict):
            provenance_data = collect_provenance(extra=provenance)
        else:
            raise TypeError("provenance must be bool or a dictionary")
        return materialize_document(output, document, provenance_data, store, packed=packed)


def show(
    figure: Figure | Iterable[Figure] | None = None,
    *,
    path: str | Path | None = None,
    open_browser: bool = True,
    packed: bool | None = None,
) -> Path:
    """Save an artifact and ask an installed MPlot viewer to open it."""
    if path is None:
        path = Path(tempfile.mkdtemp(prefix="mplot-show-")) / "figure.mplot"
        packed = True
    artifact = savefig(path, figure, packed=packed)
    if open_browser:
        executable = shutil.which("mplot")
        if executable is None:
            raise RuntimeError("the mplot viewer executable is not installed; use open_browser=False")
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
        self.path = path if path.name.endswith(".mplot-stream") else path.with_name(path.name + ".mplot-stream")
        self.frames = self.path / "frames"
        self.provenance = provenance
        self._entries: list[dict[str, Any]] = []
        self._closed = False
        self.frames.mkdir(parents=True, exist_ok=True)
        self._write_index()

    def send(self, figure: Figure | Iterable[Figure] | None = None, *, timestamp: float | None = None) -> Path:
        if self._closed:
            raise RuntimeError("stream is closed")
        number = len(self._entries)
        frame = savefig(self.frames / f"{number:08d}.mplot", figure, packed=True, provenance=self.provenance)
        self._entries.append({"sequence": number, "timestamp": time.time() if timestamp is None else float(timestamp), "artifact": frame.name})
        self._write_index()
        return frame

    append = send

    def close(self) -> None:
        if not self._closed:
            self._closed = True
            self._write_index()

    def _write_index(self) -> None:
        data = json.dumps({"version": "0.9.9", "closed": self._closed, "frames": self._entries}, sort_keys=True, separators=(",", ":")).encode()
        temporary = self.path / ".index.json.tmp"
        temporary.write_bytes(data)
        temporary.replace(self.path / "index.json")

    def __enter__(self) -> Stream:
        return self

    def __exit__(self, *_: Any) -> None:
        self.close()


def stream(path: str | Path, *, provenance: bool | dict[str, Any] = True) -> Stream:
    return Stream(path, provenance=provenance)
