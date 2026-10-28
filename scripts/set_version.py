"""Set the version of every package in the repository.

    python scripts/set_version.py 1.0.0
    python scripts/set_version.py 1.0.0-rc.1    # a pre-release (1.0.0rc1 for Python)

The release workflow runs this; there is no need to edit versions by hand.
"""

from __future__ import annotations

import json
import re
import sys

from check_versions import ROOT, declared
from packaging.version import Version

SEMVER = re.compile(r"\d+\.\d+\.\d+(-(alpha|beta|rc)\.\d+)?")


def substitute(path: str, pattern: str, value: str, count: int = 1) -> None:
    """Replace the `version` group of `pattern` in `path`, which must match `count` times."""
    file = ROOT / path
    text = file.read_text()
    matches = list(re.finditer(pattern, text, flags=re.MULTILINE))
    if len(matches) != count:
        raise SystemExit(
            f"{path}: expected {count} match(es) for {pattern!r}, found {len(matches)}"
        )
    for match in reversed(matches):
        start, end = match.span("version")
        text = text[:start] + value + text[end:]
    file.write_text(text)


def set_json(path: str, *keys: tuple[str, ...], value: str) -> None:
    file = ROOT / path
    data = json.loads(file.read_text())
    for key in keys:
        target = data
        for part in key[:-1]:
            target = target[part]
        target[key[-1]] = value
    file.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")


def main() -> None:
    if len(sys.argv) != 2 or not SEMVER.fullmatch(sys.argv[1].removeprefix("v")):
        raise SystemExit("usage: set_version.py X.Y.Z  (or X.Y.Z-rc.N, -beta.N, -alpha.N)")
    cargo = sys.argv[1].removeprefix("v")
    python = str(Version(cargo))
    any_version = r'(?P<version>[^"]+)'

    substitute("Cargo.toml", rf'^version = "{any_version}"', cargo)
    substitute(
        "crates/bfplot-cli/Cargo.toml", rf'^bfplot-core = {{ version = "{any_version}"', cargo
    )
    for crate in ("bfplot-cli", "bfplot-core"):
        substitute("Cargo.lock", rf'^name = "{crate}"\nversion = "{any_version}"', cargo)
    substitute("pyproject.toml", rf'^version = "{any_version}"', python)
    substitute("src/bfplot/__init__.py", rf'^__version__ = "{any_version}"', python)
    substitute("src/bfplot/provenance.py", rf'packages\[package\] = "{any_version}"', python)
    set_json("viewer/package.json", ("version",), value=cargo)
    set_json("viewer/package-lock.json", ("version",), ("packages", "", "version"), value=cargo)

    stale = [where for where, found in declared() if Version(found) != Version(python)]
    if stale:
        raise SystemExit(f"not updated: {', '.join(stale)}")
    print(f"set every version to {cargo} (Python: {python})")


if __name__ == "__main__":
    main()
