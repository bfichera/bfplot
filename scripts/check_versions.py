"""Check that every package in the repository declares the same version.

    python scripts/check_versions.py          # all versions agree
    python scripts/check_versions.py 1.0.0    # ... and equal 1.0.0 (or a v1.0.0 tag)

Cargo uses SemVer (1.0.0-rc.1) and Python PEP 440 (1.0.0rc1); both are compared
after PEP 440 normalization.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import tomllib
from packaging.version import Version

ROOT = Path(__file__).resolve().parent.parent


def declared() -> list[tuple[str, str]]:
    def toml(path: str) -> dict:
        return tomllib.loads((ROOT / path).read_text())

    cargo = toml("Cargo.toml")
    cli = toml("crates/bfplot-cli/Cargo.toml")
    pyproject = toml("pyproject.toml")
    init = (ROOT / "src/bfplot/__init__.py").read_text()
    provenance = (ROOT / "src/bfplot/provenance.py").read_text()
    lock = toml("Cargo.lock")
    return [
        ("Cargo.toml [workspace.package]", cargo["workspace"]["package"]["version"]),
        (
            "crates/bfplot-cli/Cargo.toml bfplot-core dependency",
            cli["dependencies"]["bfplot-core"]["version"].lstrip("=^"),
        ),
        *(
            (f"Cargo.lock {package['name']}", package["version"])
            for package in lock["package"]
            if package["name"] in {"bfplot-cli", "bfplot-core"}
        ),
        ("pyproject.toml", pyproject["project"]["version"]),
        ("src/bfplot/__init__.py", re.search(r'__version__ = "([^"]+)"', init).group(1)),
        ("viewer/package.json", json.loads((ROOT / "viewer/package.json").read_text())["version"]),
        (
            "src/bfplot/provenance.py fallback",
            re.search(r'packages\[package\] = "([^"]+)"', provenance).group(1),
        ),
    ]


def main() -> None:
    versions = declared()
    expected = Version(sys.argv[1].removeprefix("v")) if len(sys.argv) > 1 else None
    expected = expected or Version(versions[0][1])
    bad = [(where, found) for where, found in versions if Version(found) != expected]
    for where, found in bad:
        print(f"{where}: expected {expected}, found {found}", file=sys.stderr)
    if bad:
        raise SystemExit(1)
    print(f"all {len(versions)} declared versions are {expected}")


if __name__ == "__main__":
    main()
