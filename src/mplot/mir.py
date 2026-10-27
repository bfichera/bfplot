"""MPlot Intermediate Representation: semantic plot records plus typed buffers.

MIR is the boundary between plotting-library adapters and the MPlot writer. Any
producer that builds a valid ``MirDocument`` can be compiled into an MPlot result.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any

import numpy as np

# Fields a timeline update may replace, by target kind.
ANIMATABLE = {
    "figure": {"title", "size_inches", "dpi", "facecolor"},
    "axes": {"title", "x", "y", "z", "view", "bounds", "facecolor"},
    "artist": {"data", "props"},
}


class MirValidationError(ValueError):
    """Raised when a MIR document violates the producer/compiler contract."""


@dataclass(frozen=True)
class MirBuffer:
    """An immutable, C-contiguous numeric array owned by a MIR document."""

    array: np.ndarray

    @classmethod
    def from_value(cls, value: Any) -> MirBuffer:
        source = np.asanyarray(value)
        if np.ma.isMaskedArray(source):
            source = source.filled(np.nan)
        if source.dtype.kind not in "biuf":
            raise TypeError(f"unsupported MIR buffer dtype: {source.dtype}")
        # Copy so later changes to the producer's array cannot leak into MIR.
        array = np.array(source, copy=True, order="C", subok=False)
        array.setflags(write=False)
        return cls(array)


@dataclass(frozen=True)
class MirDocument:
    """A plot document whose arrays are ``{"$buffer": id}`` references into ``buffers``."""

    document: dict[str, Any]
    buffers: dict[str, MirBuffer]
    metadata: dict[str, Any]

    def validate(self) -> None:
        errors = _errors(self)
        if errors:
            raise MirValidationError("invalid MIR:\n- " + "\n- ".join(errors))


@dataclass
class MirBuilder:
    """Collect buffers while building a document, then validate the result."""

    metadata: dict[str, Any]
    _buffers: dict[str, MirBuffer] = field(default_factory=dict)

    def buffer(self, value: Any) -> dict[str, str]:
        buffer_id = f"buffer-{len(self._buffers)}"
        self._buffers[buffer_id] = MirBuffer.from_value(value)
        return {"$buffer": buffer_id}

    def build(self, document: dict[str, Any]) -> MirDocument:
        mir = MirDocument(document, dict(self._buffers), dict(self.metadata))
        mir.validate()
        return mir


def _number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _errors(mir: MirDocument) -> list[str]:
    errors: list[str] = []
    if not isinstance(mir.metadata, dict) or not mir.metadata.get("created_utc"):
        errors.append("metadata.created_utc is required")
    document = mir.document if isinstance(mir.document, dict) else {}
    if not isinstance(mir.document, dict):
        errors.append("document must be an object")

    ids: dict[str, set[str]] = {"figure": set(), "axes": set(), "artist": set()}
    names: set[str] = set()
    references: list[tuple[str, str, str]] = []

    def register(kind: str, record: Any, location: str) -> bool:
        if not isinstance(record, dict):
            errors.append(f"{location} must be an object")
            return False
        value = record.get("id")
        if not isinstance(value, str) or not value:
            errors.append(f"{location}.id must be a non-empty string")
        elif any(value in known for known in ids.values()):
            errors.append(f"duplicate id {value!r} at {location}")
        else:
            ids[kind].add(value)
        return True

    def records(parent: dict[str, Any], key: str, location: str) -> list[Any]:
        value = parent.get(key)
        if not isinstance(value, list):
            errors.append(f"{location}.{key} must be an array")
            return []
        return value

    for f, figure in enumerate(records(document, "figures", "document")):
        location = f"document.figures[{f}]"
        if not register("figure", figure, location):
            continue
        if "name" in figure:
            name = figure["name"]
            if not isinstance(name, str) or not name:
                errors.append(f"{location}.name must be a non-empty string")
            elif name in names:
                errors.append(f"duplicate figure name {name!r} at {location}")
            names.add(name)
        for a, axes in enumerate(records(figure, "axes", location)):
            axes_location = f"{location}.axes[{a}]"
            if not register("axes", axes, axes_location):
                continue
            if "parent_axes_id" in axes:
                references.append(("axes", axes["parent_axes_id"], "parent_axes_id"))
            colorbar = axes.get("colorbar")
            if isinstance(colorbar, dict) and "mappable" in colorbar:
                references.append(("artist", colorbar["mappable"], "colorbar mappable"))
            for r, artist in enumerate(records(axes, "artists", axes_location)):
                artist_location = f"{axes_location}.artists[{r}]"
                if not register("artist", artist, artist_location):
                    continue
                if artist.get("axes_id") != axes.get("id"):
                    errors.append(f"{artist_location}.axes_id must reference its containing axes")
                if not isinstance(artist.get("type"), str):
                    errors.append(f"{artist_location}.type must be a string")
                if not isinstance(artist.get("props"), dict) or not isinstance(
                    artist.get("data"), dict
                ):
                    errors.append(f"{artist_location}.props and .data must be objects")

    for kind, target, what in references:
        if target not in ids[kind]:
            errors.append(f"dangling {what} {target!r}")

    if "timeline" in document:
        errors.extend(_timeline_errors(document["timeline"], ids))

    used: set[str] = set()

    def visit(value: Any, location: str) -> None:
        if isinstance(value, dict):
            if "$buffer" not in value:
                for key, item in value.items():
                    visit(item, f"{location}.{key}")
            elif set(value) != {"$buffer"} or not isinstance(value["$buffer"], str):
                errors.append(f"{location} must be a single string $buffer reference")
            elif value["$buffer"] not in mir.buffers:
                errors.append(f"dangling buffer reference {value['$buffer']!r} at {location}")
            else:
                used.add(value["$buffer"])
        elif isinstance(value, list):
            for index, item in enumerate(value):
                visit(item, f"{location}[{index}]")

    visit(document, "document")
    if unused := set(mir.buffers) - used:
        errors.append(f"unreferenced buffers: {', '.join(sorted(unused))}")
    for buffer_id, buffer in mir.buffers.items():
        if not isinstance(buffer, MirBuffer):
            errors.append(f"buffers[{buffer_id!r}] must be a MirBuffer")
    return errors


def _timeline_errors(timeline: Any, ids: dict[str, set[str]]) -> list[str]:
    if not isinstance(timeline, dict):
        return ["document.timeline must be an object"]
    errors: list[str] = []
    fps, duration, frames = timeline.get("fps"), timeline.get("duration"), timeline.get("frames")
    if not _number(fps) or fps <= 0:
        errors.append("document.timeline.fps must be a positive finite number")
    if not _number(duration) or duration < 0:
        errors.append("document.timeline.duration must be a non-negative finite number")
    if not isinstance(frames, list):
        return [*errors, "document.timeline.frames must be an array"]

    last = 0.0
    for f, frame in enumerate(frames):
        location = f"document.timeline.frames[{f}]"
        if not isinstance(frame, dict):
            errors.append(f"{location} must be an object")
            continue
        time = frame.get("time")
        if not _number(time) or time <= last:
            errors.append(f"{location}.time must be finite and strictly increasing")
        else:
            last = float(time)
        updates = frame.get("updates")
        if not isinstance(updates, list):
            errors.append(f"{location}.updates must be an array")
            continue
        for u, update in enumerate(updates):
            where = f"{location}.updates[{u}]"
            if not isinstance(update, dict):
                errors.append(f"{where} must be an object")
                continue
            kind, path = update.get("target_kind"), update.get("path")
            if kind not in ANIMATABLE:
                errors.append(f"{where}.target_kind is unsupported")
            elif update.get("target") not in ids[kind]:
                errors.append(f"{where}.target is dangling")
            if not (
                isinstance(path, list) and path and all(isinstance(p, str) and p for p in path)
            ):
                errors.append(f"{where}.path must be a non-empty string array")
            elif kind in ANIMATABLE and path[0] not in ANIMATABLE[kind]:
                errors.append(f"{where}.path is not allowed for {kind}")
            if "value" not in update:
                errors.append(f"{where}.value is required")
    if _number(duration) and float(duration) != last:
        errors.append("document.timeline.duration must equal the final frame time (or 0)")
    return errors
