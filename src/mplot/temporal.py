from __future__ import annotations

import copy
import math
from collections.abc import Callable, Iterable
from pathlib import Path
from typing import Any, TypeAlias

import numpy as np
from matplotlib.figure import Figure

from .mir import MirBuffer, MirDocument

FigureSource: TypeAlias = Figure | Iterable[Figure] | None
Translator: TypeAlias = Callable[[FigureSource, dict[str, Any]], MirDocument]
Finisher: TypeAlias = Callable[[MirDocument], Path | None]

_ALLOWED_ARTIST_SECTIONS = {"data", "props"}
_ALLOWED_AXES_FIELDS = {"title", "x", "y", "z", "view", "bounds", "facecolor"}
_ALLOWED_FIGURE_FIELDS = {"title", "size_inches", "dpi", "facecolor"}


class Animation:
    """Record mutable Matplotlib figures as validated semantic MIR updates."""

    def __init__(
        self,
        figure: FigureSource,
        *,
        fps: float = 30,
        loop: bool = True,
        translator: Translator,
        finisher: Finisher,
        metadata: dict[str, Any],
    ):
        if not math.isfinite(fps) or fps <= 0:
            raise ValueError("fps must be a positive finite number")
        self.figure = figure
        self.fps = float(fps)
        self.loop = bool(loop)
        self._translator = translator
        self._finisher = finisher
        self._closed = False
        self._finished = False
        self._result: Path | None = None
        self._final: MirDocument | None = None
        self._next_time = 1 / self.fps
        self._initial = translator(figure, metadata)
        self._previous = self._initial
        self._document = copy.deepcopy(self._initial.document)
        self._buffers = dict(self._initial.buffers)
        self._next_buffer = len(self._buffers)
        self._frames: list[dict[str, Any]] = []

    @property
    def result(self) -> Path | None:
        """The written artifact, or ``None`` while recording or inside a larger result."""
        return self._result

    @property
    def closed(self) -> bool:
        return self._closed

    @property
    def frame_count(self) -> int:
        """Number of captured timeline frames."""
        return len(self._frames)

    @property
    def initial_mir(self) -> MirDocument:
        """A defensive copy of the immutable scene used to start playback."""
        return MirDocument(
            document=copy.deepcopy(self._initial.document),
            buffers=dict(self._initial.buffers),
            metadata=copy.deepcopy(self._initial.metadata),
        )

    @property
    def finalized_mir(self) -> MirDocument:
        """The validated temporal MIR produced by ``close()``."""
        if self._final is None:
            raise RuntimeError("animation has not been closed")
        return self._final

    def capture(self, *, time: float | None = None) -> None:
        """Capture the current Matplotlib state at a strictly increasing time."""
        if self._closed:
            raise RuntimeError("animation is closed")
        timestamp = self._next_time if time is None else float(time)
        if not math.isfinite(timestamp):
            raise ValueError("frame time must be finite")
        previous_time = self._frames[-1]["time"] if self._frames else 0.0
        if timestamp <= previous_time:
            raise ValueError("frame times must be strictly increasing and greater than zero")

        current = self._translator(self.figure, self._previous.metadata)
        updates = self._diff_documents(self._previous, current)
        self._frames.append({"time": timestamp, "updates": updates})
        self._previous = current
        self._next_time = timestamp + 1 / self.fps

    def close(self) -> Path | None:
        """Validate the finalized temporal MIR document and hand it to its destination.

        Standalone animations return the written artifact. Animations recorded inside
        ``mplot.result()`` return ``None``; the result writes them when it closes.
        """
        if self._finished:
            return self._result
        if self._closed:
            raise RuntimeError("animation was aborted")
        self._closed = True
        duration = self._frames[-1]["time"] if self._frames else 0.0
        self._document["timeline"] = {
            "version": 1,
            "fps": self.fps,
            "duration": duration,
            "loop": self.loop,
            "frames": self._frames,
        }
        mir = MirDocument(
            document=self._document,
            buffers=self._buffers,
            metadata={
                **self._previous.metadata,
                "temporal": {"fps": self.fps, "duration": duration, "frames": len(self._frames)},
            },
        )
        mir.validate()
        self._final = mir
        self._result = self._finisher(mir)
        self._finished = True
        return self._result

    def __enter__(self) -> Animation:
        return self

    def __exit__(self, exception_type: Any, *_: Any) -> None:
        if exception_type is None:
            self.close()
        else:
            self.abort()

    def abort(self) -> None:
        """Stop recording without writing an artifact."""
        self._closed = True

    def _diff_documents(self, previous: MirDocument, current: MirDocument) -> list[dict[str, Any]]:
        updates: list[dict[str, Any]] = []
        old_figures = {item["id"]: item for item in previous.document["figures"]}
        new_figures = {item["id"]: item for item in current.document["figures"]}
        if old_figures.keys() != new_figures.keys():
            raise ValueError("animation cannot add or remove figures")

        for figure_id, old_figure in old_figures.items():
            new_figure = new_figures[figure_id]
            self._diff_fields(
                "figure",
                figure_id,
                old_figure,
                new_figure,
                _ALLOWED_FIGURE_FIELDS,
                previous,
                current,
                updates,
            )
            old_axes = {item["id"]: item for item in old_figure["axes"]}
            new_axes = {item["id"]: item for item in new_figure["axes"]}
            if old_axes.keys() != new_axes.keys():
                raise ValueError("animation cannot add or remove axes")
            for axes_id, old_axis in old_axes.items():
                new_axis = new_axes[axes_id]
                self._diff_fields(
                    "axes",
                    axes_id,
                    old_axis,
                    new_axis,
                    _ALLOWED_AXES_FIELDS,
                    previous,
                    current,
                    updates,
                )
                old_artists = {item["id"]: item for item in old_axis["artists"]}
                new_artists = {item["id"]: item for item in new_axis["artists"]}
                if old_artists.keys() != new_artists.keys():
                    raise ValueError(
                        "animation cannot add or remove artists; update visibility instead"
                    )
                for artist_id, old_artist in old_artists.items():
                    new_artist = new_artists[artist_id]
                    if old_artist["type"] != new_artist["type"]:
                        raise ValueError("animation cannot change an artist type")
                    for section in _ALLOWED_ARTIST_SECTIONS:
                        old_values, new_values = old_artist[section], new_artist[section]
                        if old_values.keys() != new_values.keys():
                            raise ValueError(
                                f"animation cannot add or remove artist {section} fields"
                            )
                        for field in old_values:
                            if not self._equal(
                                old_values[field], new_values[field], previous, current
                            ):
                                updates.append(
                                    {
                                        "target_kind": "artist",
                                        "target": artist_id,
                                        "path": [section, field],
                                        "value": self._import_value(new_values[field], current),
                                    }
                                )
        return updates

    def _diff_fields(
        self,
        target_kind: str,
        target: str,
        old: dict[str, Any],
        new: dict[str, Any],
        fields: set[str],
        previous: MirDocument,
        current: MirDocument,
        updates: list[dict[str, Any]],
    ) -> None:
        for field in fields:
            if field not in old and field not in new:
                continue
            if field not in old or field not in new:
                raise ValueError(f"animation cannot add or remove {target_kind} field {field!r}")
            if not self._equal(old[field], new[field], previous, current):
                updates.append(
                    {
                        "target_kind": target_kind,
                        "target": target,
                        "path": [field],
                        "value": self._import_value(new[field], current),
                    }
                )

    def _equal(self, left: Any, right: Any, left_mir: MirDocument, right_mir: MirDocument) -> bool:
        if (
            isinstance(left, dict)
            and set(left) == {"$buffer"}
            and isinstance(right, dict)
            and set(right) == {"$buffer"}
        ):
            first = left_mir.buffers[left["$buffer"]].array
            second = right_mir.buffers[right["$buffer"]].array
            return (
                first.dtype == second.dtype
                and first.shape == second.shape
                and np.array_equal(first, second, equal_nan=True)
            )
        if type(left) is not type(right):
            return False
        if isinstance(left, dict):
            return left.keys() == right.keys() and all(
                self._equal(left[key], right[key], left_mir, right_mir) for key in left
            )
        if isinstance(left, list):
            return len(left) == len(right) and all(
                self._equal(a, b, left_mir, right_mir) for a, b in zip(left, right, strict=True)
            )
        return left == right

    def _import_value(self, value: Any, source: MirDocument) -> Any:
        if isinstance(value, dict):
            if set(value) == {"$buffer"}:
                buffer = source.buffers[value["$buffer"]]
                buffer_id = f"buffer-{self._next_buffer}"
                self._next_buffer += 1
                self._buffers[buffer_id] = MirBuffer.from_value(buffer.array)
                return {"$buffer": buffer_id}
            return {key: self._import_value(item, source) for key, item in value.items()}
        if isinstance(value, list):
            return [self._import_value(item, source) for item in value]
        return copy.deepcopy(value)
