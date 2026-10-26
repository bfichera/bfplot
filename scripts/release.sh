#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

# Some newer Command Line Tools SDKs require a newer linker than the bundled one.
# Respect an explicit SDKROOT; otherwise prefer the broadly compatible SDK when present.
if [[ "$(uname -s)" == Darwin && -z "${SDKROOT:-}" && -d /Library/Developer/CommandLineTools/SDKs/MacOSX15.4.sdk ]]; then
  export SDKROOT=/Library/Developer/CommandLineTools/SDKs/MacOSX15.4.sdk
fi

usage() {
  printf 'Usage: %s <version>\n' "$0" >&2
  printf 'Validates version metadata and builds release artifacts without publishing.\n' >&2
  exit 2
}

[[ $# -eq 1 ]] || usage
version="${1#v}"
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?$ ]] || usage

if [[ -n "$(git status --porcelain)" ]]; then
  printf 'Release builds require a clean working tree.\n' >&2
  exit 1
fi

python_bin="${PYTHON:-python3}"
if [[ -x .venv/bin/python ]]; then
  python_bin=.venv/bin/python
fi

"$python_bin" - "$version" <<'PY'
from pathlib import Path
import json
import re
import sys
import tomllib

expected = sys.argv[1]
checks = []

cargo = Path("Cargo.toml")
if cargo.exists():
    checks.append(("Cargo.toml", tomllib.loads(cargo.read_text())["workspace"]["package"]["version"]))

pyproject = Path("pyproject.toml")
if pyproject.exists():
    checks.append(("pyproject.toml", tomllib.loads(pyproject.read_text())["project"]["version"]))

package = Path("viewer/package.json")
if package.exists():
    checks.append(("viewer/package.json", json.loads(package.read_text())["version"]))

architecture = Path("ARCHITECTURE.md")
if architecture.exists():
    match = re.search(r"MPlot ([0-9]+\.[0-9]+\.[0-9]+)", architecture.read_text())
    if not match:
        raise SystemExit("ARCHITECTURE.md does not declare an MPlot version")
    checks.append(("ARCHITECTURE.md", match.group(1)))

bad = [(path, actual) for path, actual in checks if actual != expected]
if bad:
    for path, actual in bad:
        print(f"{path}: expected {expected}, found {actual}", file=sys.stderr)
    raise SystemExit(1)
PY

./scripts/smoke.sh
rm -rf release-dist
mkdir -p release-dist

if [[ -f pyproject.toml ]]; then
  if "$python_bin" -c 'import build' 2>/dev/null; then
    "$python_bin" -m build --outdir release-dist
  else
    "$python_bin" -m pip wheel --no-deps --wheel-dir release-dist .
  fi
fi

if [[ -f viewer/package.json ]]; then
  npm pack ./viewer --pack-destination "$root/release-dist"
fi

if [[ -f Cargo.toml ]]; then
  cargo package --workspace --allow-dirty
  find target/package -maxdepth 1 -type f -name '*.crate' -exec cp {} release-dist/ \;
fi

printf '\nRelease artifacts are in %s/release-dist\n' "$root"
printf 'Nothing was published. Inspect and sign artifacts before upload.\n'
