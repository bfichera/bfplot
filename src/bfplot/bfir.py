"""BFPlot Intermediate Representation: semantic plot records plus typed buffers.

BFIR is the boundary between plotting-library adapters and the BFPlot writer. Any
producer that builds a valid ``BfirDocument`` can be compiled into a BFPlot result.
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


class BfirValidationError(ValueError):
    """Raised when a BFIR document violates the producer/compiler contract."""


@dataclass(frozen=True)
class BfirBuffer:
    """An immutable, C-contiguous numeric array owned by a BFIR document."""

    array: np.ndarray

    @classmethod
    def from_value(cls, value: Any) -> BfirBuffer:
        source = np.asanyarray(value)
        if np.ma.isMaskedArray(source):
            source = source.filled(np.nan)
        if source.dtype.kind not in "biuf":
            raise TypeError(f"unsupported BFIR buffer dtype: {source.dtype}")
        # Copy so later changes to the producer's array cannot leak into BFIR.
        array = np.array(source, copy=True, order="C", subok=False)
        array.setflags(write=False)
        return cls(array)


@dataclass(frozen=True)
class BfirDocument:
    """A plot document whose arrays are ``{"$buffer": id}`` references into ``buffers``."""

    document: dict[str, Any]
    buffers: dict[str, BfirBuffer]

    def validate(self) -> None:
        errors = _errors(self)
        if errors:
            raise BfirValidationError("invalid BFIR:\n- " + "\n- ".join(errors))


@dataclass
class BfirBuilder:
    """Collect buffers while building a document, then validate the result."""

    _buffers: dict[str, BfirBuffer] = field(default_factory=dict)

    def buffer(self, value: Any) -> dict[str, str]:
        buffer_id = f"buffer-{len(self._buffers)}"
        self._buffers[buffer_id] = BfirBuffer.from_value(value)
        return {"$buffer": buffer_id}

    def build(self, document: dict[str, Any]) -> BfirDocument:
        bfir = BfirDocument(document, dict(self._buffers))
        bfir.validate()
        return bfir


def _number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _errors(bfir: BfirDocument) -> list[str]:
    errors: list[str] = []
    document = bfir.document if isinstance(bfir.document, dict) else {}
    if not isinstance(bfir.document, dict):
        errors.append("document must be an object")

    ids: dict[str, set[str]] = {"figure": set(), "axes": set(), "artist": set()}
    owners: dict[str, str] = {}
    names: set[str] = set()
    references: list[tuple[str, str, str]] = []
    current_figure = ""

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
            owners[value] = value if kind == "figure" else current_figure
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
        current_figure = figure.get("id")
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
        errors.append("document.timeline is no longer supported; use document.timelines")
    if "timelines" in document:
        errors.extend(_timelines_errors(document["timelines"], ids, owners))

    used: set[str] = set()

    def visit(value: Any, location: str) -> None:
        if isinstance(value, dict):
            if "$buffer" not in value:
                for key, item in value.items():
                    visit(item, f"{location}.{key}")
            elif set(value) != {"$buffer"} or not isinstance(value["$buffer"], str):
                errors.append(f"{location} must be a single string $buffer reference")
            elif value["$buffer"] not in bfir.buffers:
                errors.append(f"dangling buffer reference {value['$buffer']!r} at {location}")
            else:
                used.add(value["$buffer"])
        elif isinstance(value, list):
            for index, item in enumerate(value):
                visit(item, f"{location}[{index}]")

    visit(document, "document")
    if unused := set(bfir.buffers) - used:
        errors.append(f"unreferenced buffers: {', '.join(sorted(unused))}")
    for buffer_id, buffer in bfir.buffers.items():
        if not isinstance(buffer, BfirBuffer):
            errors.append(f"buffers[{buffer_id!r}] must be a BfirBuffer")
    return errors


def _timelines_errors(
    timelines: Any, ids: dict[str, set[str]], owners: dict[str, str]
) -> list[str]:
    if not isinstance(timelines, list):
        return ["document.timelines must be an array"]
    errors: list[str] = []
    claimed: set[str] = set()
    for t, timeline in enumerate(timelines):
        location = f"document.timelines[{t}]"
        if not isinstance(timeline, dict):
            errors.append(f"{location} must be an object")
            continue
        figures = timeline.get("figures")
        if not (isinstance(figures, list) and figures and all(isinstance(f, str) for f in figures)):
            errors.append(f"{location}.figures must be a non-empty string array")
            figures = []
        for figure in figures:
            if figure not in ids["figure"]:
                errors.append(f"{location}.figures references unknown figure {figure!r}")
            elif figure in claimed:
                errors.append(f"figure {figure!r} belongs to more than one timeline")
            claimed.add(figure)
        errors.extend(_timeline_errors(timeline, location, ids, owners, set(figures)))
    return errors


def _timeline_errors(
    timeline: dict[str, Any],
    prefix: str,
    ids: dict[str, set[str]],
    owners: dict[str, str],
    figures: set[str],
) -> list[str]:
    errors: list[str] = []
    fps, duration, frames = timeline.get("fps"), timeline.get("duration"), timeline.get("frames")
    if not _number(fps) or fps <= 0:
        errors.append(f"{prefix}.fps must be a positive finite number")
    if not _number(duration) or duration < 0:
        errors.append(f"{prefix}.duration must be a non-negative finite number")
    if "loop" in timeline and not isinstance(timeline["loop"], bool):
        errors.append(f"{prefix}.loop must be a boolean")
    if not isinstance(frames, list):
        return [*errors, f"{prefix}.frames must be an array"]

    last = 0.0
    for f, frame in enumerate(frames):
        location = f"{prefix}.frames[{f}]"
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
            elif owners[update["target"]] not in figures:
                errors.append(f"{where}.target is outside this timeline's figures")
            if not (
                isinstance(path, list) and path and all(isinstance(p, str) and p for p in path)
            ):
                errors.append(f"{where}.path must be a non-empty string array")
            elif kind in ANIMATABLE and path[0] not in ANIMATABLE[kind]:
                errors.append(f"{where}.path is not allowed for {kind}")
            if "value" not in update:
                errors.append(f"{where}.value is required")
    if _number(duration) and float(duration) != last:
        errors.append(f"{prefix}.duration must equal the final frame time (or 0)")
    return errors
