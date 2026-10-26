from __future__ import annotations

import datetime as dt
import getpass
import os
import platform
import sys
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path
from typing import Any


def collect_provenance(*, extra: dict[str, Any] | None = None) -> dict[str, Any]:
    """Collect reproducibility metadata without reading source file contents."""
    packages: dict[str, str] = {}
    for package in ("mplot", "matplotlib", "numpy", "zstandard"):
        try:
            packages[package] = version(package)
        except PackageNotFoundError:
            if package == "mplot":
                packages[package] = "0.9.9"
    source_epoch = os.environ.get("SOURCE_DATE_EPOCH")
    if source_epoch is not None:
        timestamp = dt.datetime.fromtimestamp(int(source_epoch), dt.timezone.utc)
    else:
        timestamp = dt.datetime.now(dt.timezone.utc)
    result: dict[str, Any] = {
        "created_utc": timestamp.isoformat().replace("+00:00", "Z"),
        "python": platform.python_version(),
        "implementation": platform.python_implementation(),
        "platform": platform.platform(),
        "packages": packages,
        "argv": list(sys.argv),
        "script": str(Path(sys.argv[0]).resolve()) if sys.argv and sys.argv[0] else None,
        "working_directory": str(Path.cwd()),
        "user": getpass.getuser(),
    }
    if extra:
        result["extra"] = extra
    return result
