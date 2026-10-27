from __future__ import annotations

import datetime as dt
import getpass
import os
import platform
import subprocess
import sys
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path
from typing import Any


def _git_commit() -> str | None:
    """Return the producing checkout's commit without making Git a dependency."""
    candidates: list[Path] = []
    if sys.argv and sys.argv[0] and sys.argv[0].endswith(".py"):
        candidates.append(Path(sys.argv[0]).resolve().parent)
    candidates.append(Path.cwd())

    for directory in dict.fromkeys(candidates):
        try:
            result = subprocess.run(
                ["git", "-C", str(directory), "rev-parse", "--verify", "HEAD"],
                check=False,
                capture_output=True,
                text=True,
                timeout=2,
            )
        except (OSError, subprocess.SubprocessError):
            continue
        commit = result.stdout.strip()
        if (
            result.returncode == 0
            and len(commit) == 40
            and all(character in "0123456789abcdefABCDEF" for character in commit)
        ):
            return commit.lower()
    return None


def processing_metadata() -> dict[str, str]:
    """Return the creation time and Git commit recorded in every result."""
    source_epoch = os.environ.get("SOURCE_DATE_EPOCH")
    if source_epoch is not None:
        timestamp = dt.datetime.fromtimestamp(int(source_epoch), dt.timezone.utc)
    else:
        timestamp = dt.datetime.now(dt.timezone.utc)
    result = {"created_utc": timestamp.isoformat().replace("+00:00", "Z")}
    if commit := _git_commit():
        result["git_commit"] = commit
    return result


def collect_provenance(*, extra: dict[str, Any] | None = None) -> dict[str, Any]:
    """Collect reproducibility metadata without reading source file contents."""
    packages: dict[str, str] = {}
    for package in ("mplot", "matplotlib", "numpy", "zstandard"):
        try:
            packages[package] = version(package)
        except PackageNotFoundError:
            if package == "mplot":
                packages[package] = "0.9.9"
    result: dict[str, Any] = {
        **processing_metadata(),
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
