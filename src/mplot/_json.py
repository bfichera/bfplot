from __future__ import annotations

import json
import math
from typing import Any


def canonical_json(value: Any) -> bytes:
    """Return the canonical JSON representation used for content identities."""
    _ensure_finite(value)
    return json.dumps(
        value,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
        allow_nan=False,
    ).encode("utf-8")


def _ensure_finite(value: Any, path: str = "$") -> None:
    if isinstance(value, float) and not math.isfinite(value):
        raise ValueError(f"non-finite number at {path}")
    if isinstance(value, dict):
        for key, item in value.items():
            _ensure_finite(item, f"{path}.{key}")
    elif isinstance(value, (list, tuple)):
        for index, item in enumerate(value):
            _ensure_finite(item, f"{path}[{index}]")
