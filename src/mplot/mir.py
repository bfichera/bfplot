from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import numpy as np


MIR_VERSION = "1.0"
_SUPPORTED_DTYPE_KINDS = {"b", "i", "u", "f"}


class MirValidationError(ValueError):
    """Raised when a MIR document violates the producer/compiler contract."""


@dataclass(frozen=True)
class MirBuffer:
    """A local typed buffer owned by MIR, before artifact encoding or storage."""

    array: np.ndarray

    @classmethod
    def from_value(cls, value: Any) -> MirBuffer:
        source = np.asanyarray(value)
        if np.ma.isMaskedArray(source):
            source = source.filled(np.nan)
        if source.dtype.kind not in _SUPPORTED_DTYPE_KINDS:
            raise TypeError(f"unsupported MIR buffer dtype: {source.dtype}")
        # MIR owns its buffers; translation must not freeze or alias producer arrays.
        array = np.array(source, copy=True, order="C", subok=False)
        array.setflags(write=False)
        return cls(array)

    @property
    def dtype(self) -> str:
        return self.array.dtype.str.removeprefix("<").removeprefix("|").removeprefix(">")

    @property
    def shape(self) -> tuple[int, ...]:
        return self.array.shape


@dataclass(frozen=True)
class MirDocument:
    """Language-neutral semantic plot records and process-local typed buffers."""

    document: dict[str, Any]
    buffers: dict[str, MirBuffer]
    metadata: dict[str, Any]
    mir_version: str = MIR_VERSION

    def validate(self) -> None:
        validate_mir(self)


@dataclass
class MirBuilder:
    """Construct MIR without exposing artifact hashes, codecs, or object stores."""

    metadata: dict[str, Any]
    _buffers: dict[str, MirBuffer] = field(default_factory=dict)
    _next_buffer: int = 0

    def buffer(self, value: Any) -> dict[str, str]:
        buffer_id = f"buffer-{self._next_buffer}"
        self._next_buffer += 1
        self._buffers[buffer_id] = MirBuffer.from_value(value)
        return {"$buffer": buffer_id}

    def build(self, document: dict[str, Any]) -> MirDocument:
        result = MirDocument(document=document, buffers=dict(self._buffers), metadata=dict(self.metadata))
        result.validate()
        return result


def validate_mir(mir: MirDocument) -> None:
    errors: list[str] = []
    if mir.mir_version != MIR_VERSION:
        errors.append(f"unsupported mir_version {mir.mir_version!r}; expected {MIR_VERSION!r}")
    if not isinstance(mir.document, dict):
        errors.append("document must be an object")
    if not isinstance(mir.metadata, dict) or not mir.metadata.get("created_utc"):
        errors.append("metadata.created_utc is required")

    figures = mir.document.get("figures") if isinstance(mir.document, dict) else None
    if not isinstance(figures, list):
        errors.append("document.figures must be an array")
        figures = []

    ids: set[str] = set()
    axes_ids: set[str] = set()
    artist_ids: set[str] = set()
    parent_refs: list[str] = []
    mappable_refs: list[str] = []

    def register(value: Any, location: str, target: set[str] | None = None) -> None:
        if not isinstance(value, str) or not value:
            errors.append(f"{location}.id must be a non-empty string")
        elif value in ids:
            errors.append(f"duplicate id {value!r} at {location}")
        else:
            ids.add(value)
            if target is not None:
                target.add(value)

    for figure_index, figure in enumerate(figures):
        location = f"document.figures[{figure_index}]"
        if not isinstance(figure, dict):
            errors.append(f"{location} must be an object")
            continue
        register(figure.get("id"), location)
        axes = figure.get("axes")
        if not isinstance(axes, list):
            errors.append(f"{location}.axes must be an array")
            continue
        for axes_index, axes_record in enumerate(axes):
            axes_location = f"{location}.axes[{axes_index}]"
            if not isinstance(axes_record, dict):
                errors.append(f"{axes_location} must be an object")
                continue
            register(axes_record.get("id"), axes_location, axes_ids)
            if "parent_axes_id" in axes_record:
                parent_refs.append(axes_record["parent_axes_id"])
            colorbar = axes_record.get("colorbar")
            if isinstance(colorbar, dict) and "mappable" in colorbar:
                mappable_refs.append(colorbar["mappable"])
            artists = axes_record.get("artists")
            if not isinstance(artists, list):
                errors.append(f"{axes_location}.artists must be an array")
                continue
            for artist_index, artist in enumerate(artists):
                artist_location = f"{axes_location}.artists[{artist_index}]"
                if not isinstance(artist, dict):
                    errors.append(f"{artist_location} must be an object")
                    continue
                register(artist.get("id"), artist_location, artist_ids)
                if artist.get("axes_id") != axes_record.get("id"):
                    errors.append(f"{artist_location}.axes_id must reference its containing axes")
                if not isinstance(artist.get("type"), str):
                    errors.append(f"{artist_location}.type must be a string")
                if not isinstance(artist.get("props"), dict) or not isinstance(artist.get("data"), dict):
                    errors.append(f"{artist_location}.props and .data must be objects")

    for parent in parent_refs:
        if parent not in axes_ids:
            errors.append(f"dangling parent_axes_id {parent!r}")
    for mappable in mappable_refs:
        if mappable not in artist_ids:
            errors.append(f"dangling colorbar mappable {mappable!r}")

    referenced_buffers: set[str] = set()

    def visit(value: Any, location: str) -> None:
        if isinstance(value, dict):
            if "$buffer" in value:
                if set(value) != {"$buffer"} or not isinstance(value["$buffer"], str):
                    errors.append(f"{location} must be a single string $buffer reference")
                    return
                buffer_id = value["$buffer"]
                referenced_buffers.add(buffer_id)
                if buffer_id not in mir.buffers:
                    errors.append(f"dangling buffer reference {buffer_id!r} at {location}")
                return
            for key, item in value.items():
                visit(item, f"{location}.{key}")
        elif isinstance(value, list):
            for index, item in enumerate(value):
                visit(item, f"{location}[{index}]")

    visit(mir.document, "document")
    unused = set(mir.buffers) - referenced_buffers
    if unused:
        errors.append(f"unreferenced buffers: {', '.join(sorted(unused))}")
    for buffer_id, buffer in mir.buffers.items():
        if not isinstance(buffer, MirBuffer):
            errors.append(f"buffers[{buffer_id!r}] must be a MirBuffer")

    if errors:
        raise MirValidationError("invalid MIR:\n- " + "\n- ".join(errors))
