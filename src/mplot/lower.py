from __future__ import annotations

from typing import Any

from .arrays import encode_array
from .mir import MirDocument
from .store import ContentStore


def lower_mir(mir: MirDocument, store: ContentStore) -> dict[str, Any]:
    """Compile validated MIR into the canonical artifact document schema."""
    mir.validate()
    encoded = {
        buffer_id: encode_array(buffer.array, store) for buffer_id, buffer in mir.buffers.items()
    }

    def lower(value: Any) -> Any:
        if isinstance(value, dict):
            if set(value) == {"$buffer"}:
                return encoded[value["$buffer"]]
            return {key: lower(item) for key, item in value.items()}
        if isinstance(value, list):
            return [lower(item) for item in value]
        return value

    document = lower(mir.document)
    if _contains_buffer_reference(document):
        raise ValueError("compiled artifact contains an unresolved MIR buffer reference")
    return document


def _contains_buffer_reference(value: Any) -> bool:
    if isinstance(value, dict):
        return "$buffer" in value or any(
            _contains_buffer_reference(item) for item in value.values()
        )
    if isinstance(value, list):
        return any(_contains_buffer_reference(item) for item in value)
    return False
