from __future__ import annotations

import copy
import math
from collections.abc import Callable, Iterable
from pathlib import Path
from typing import Any

import numpy as np
from matplotlib.figure import Figure

from .bfir import ANIMATABLE, BfirDocument

FigureSource = Figure | Iterable[Figure] | None
Translator = Callable[[FigureSource, dict[str, Any]], BfirDocument]


class Animation:
    """Record mutable Matplotlib figures as a timeline of semantic BFIR updates.

    Each ``capture()`` translates the figures again and stores only the fields that
    changed. Figures, axes and artists cannot be added or removed while recording.
    """

    def __init__(
        self,
        figure: FigureSource,
        *,
        fps: float = 30,
        loop: bool = True,
        translator: Translator,
        metadata: dict[str, Any],
        finisher: Callable[[BfirDocument], Path] | None = None,
    ):
        if not math.isfinite(fps) or fps <= 0:
            raise ValueError("fps must be a positive finite number")
        self.figure = figure
        self.fps = float(fps)
        self.loop = bool(loop)
        self._translator = translator
        self._finisher = finisher
        self._closed = False
        self._result: Path | None = None
        self._final: BfirDocument | None = None
        self._initial = translator(figure, metadata)
        self._previous = self._initial
        self._buffers = dict(self._initial.buffers)
        self._frames: list[dict[str, Any]] = []

    @property
    def result(self) -> Path | None:
        """The written result, or ``None`` while recording or inside ``bfplot.result()``."""
        return self._result

    @property
    def closed(self) -> bool:
        return self._closed

    @property
    def frame_count(self) -> int:
        return len(self._frames)

    @property
    def initial_bfir(self) -> BfirDocument:
        """A copy of the scene that playback starts from."""
        initial = self._initial
        return BfirDocument(
            copy.deepcopy(initial.document), dict(initial.buffers), copy.deepcopy(initial.metadata)
        )

    @property
    def finalized_bfir(self) -> BfirDocument:
        """The temporal BFIR document produced by ``close()``."""
        if self._final is None:
            raise RuntimeError("animation has not been closed")
        return self._final

    def capture(self, *, time: float | None = None) -> None:
        """Capture the current figure state at a strictly increasing time (default: next frame)."""
        if self._closed:
            raise RuntimeError("animation is closed")
        last = self._frames[-1]["time"] if self._frames else 0.0
        timestamp = last + 1 / self.fps if time is None else float(time)
        if not math.isfinite(timestamp):
            raise ValueError("frame time must be finite")
        if timestamp <= last:
            raise ValueError("frame times must be strictly increasing and greater than zero")
        current = self._translator(self.figure, self._previous.metadata)
        updates = _Diff(self._previous, current, self._buffers).updates
        self._frames.append({"time": timestamp, "updates": updates})
        self._previous = current

    def close(self) -> Path | None:
        """Finish recording; a standalone animation is written and its path returned."""
        if self._final is not None:
            return self._result
        if self._closed:
            raise RuntimeError("animation was aborted")
        self._closed = True
        duration = self._frames[-1]["time"] if self._frames else 0.0
        document = copy.deepcopy(self._initial.document)
        document["timeline"] = {
            "fps": self.fps,
            "duration": duration,
            "loop": self.loop,
            "frames": self._frames,
        }
        metadata = {
            **self._previous.metadata,
            "temporal": {"fps": self.fps, "duration": duration, "frames": len(self._frames)},
        }
        final = BfirDocument(document, self._buffers, metadata)
        final.validate()
        self._final = final
        if self._finisher is not None:
            self._result = self._finisher(final)
        return self._result

    def abort(self) -> None:
        """Stop recording without writing anything."""
        self._closed = True

    def __enter__(self) -> Animation:
        return self

    def __exit__(self, exception_type: Any, *_: Any) -> None:
        if exception_type is None:
            self.close()
        else:
            self.abort()


class _Diff:
    """The timeline updates that turn ``old`` into ``new``.

    Changed buffers are copied into ``buffers`` (the animation's buffer table) under
    fresh IDs so that every frame's arrays remain addressable.
    """

    def __init__(self, old: BfirDocument, new: BfirDocument, buffers: dict[str, Any]):
        self.old, self.new, self.buffers = old, new, buffers
        self.updates: list[dict[str, Any]] = []
        for old_figure, new_figure in self._pair(old.document, new.document, "figures"):
            self._fields("figure", old_figure, new_figure)
            for old_axes, new_axes in self._pair(old_figure, new_figure, "axes"):
                self._fields("axes", old_axes, new_axes)
                for old_artist, new_artist in self._pair(old_axes, new_axes, "artists"):
                    if old_artist["type"] != new_artist["type"]:
                        raise ValueError("animation cannot change an artist type")
                    for section in sorted(ANIMATABLE["artist"]):
                        before, after = old_artist[section], new_artist[section]
                        if before.keys() != after.keys():
                            raise ValueError(
                                f"animation cannot add or remove artist {section} fields"
                            )
                        for key in before:
                            self._compare("artist", old_artist["id"], [section, key], before, after)

    @staticmethod
    def _pair(old: dict[str, Any], new: dict[str, Any], key: str) -> list[tuple[Any, Any]]:
        before = {item["id"]: item for item in old[key]}
        after = {item["id"]: item for item in new[key]}
        if before.keys() != after.keys():
            hint = "; update visibility instead" if key == "artists" else ""
            raise ValueError(f"animation cannot add or remove {key}{hint}")
        return [(item, after[item_id]) for item_id, item in before.items()]

    def _fields(self, kind: str, old: dict[str, Any], new: dict[str, Any]) -> None:
        for field in sorted(ANIMATABLE[kind]):
            if (field in old) != (field in new):
                raise ValueError(f"animation cannot add or remove {kind} field {field!r}")
            if field in old:
                self._compare(kind, old["id"], [field], old, new)

    def _compare(
        self, kind: str, target: str, path: list[str], old: dict[str, Any], new: dict[str, Any]
    ) -> None:
        key = path[-1]
        if not self._equal(old[key], new[key]):
            value = self._import(new[key])
            self.updates.append(
                {"target_kind": kind, "target": target, "path": path, "value": value}
            )

    def _equal(self, left: Any, right: Any) -> bool:
        if isinstance(left, dict) and "$buffer" in left:
            if not (isinstance(right, dict) and "$buffer" in right):
                return False
            first = self.old.buffers[left["$buffer"]].array
            second = self.new.buffers[right["$buffer"]].array
            return (
                first.dtype == second.dtype
                and first.shape == second.shape
                and np.array_equal(first, second, equal_nan=True)
            )
        if type(left) is not type(right):
            return False
        if isinstance(left, dict):
            return left.keys() == right.keys() and all(
                self._equal(left[key], right[key]) for key in left
            )
        if isinstance(left, list):
            return len(left) == len(right) and all(map(self._equal, left, right))
        return left == right

    def _import(self, value: Any) -> Any:
        if isinstance(value, dict):
            if "$buffer" in value:
                buffer_id = f"buffer-{len(self.buffers)}"
                self.buffers[buffer_id] = self.new.buffers[value["$buffer"]]
                return {"$buffer": buffer_id}
            return {key: self._import(item) for key, item in value.items()}
        if isinstance(value, list):
            return [self._import(item) for item in value]
        return copy.deepcopy(value)
