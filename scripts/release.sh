#!/usr/bin/env bash
# Build every release artifact for this machine into release-dist/, without publishing.
#
#   scripts/release.sh 1.0.0
#
# CI builds the full set (all platforms) in .github/workflows/python-release.yml and
# release.yml; this is the local dry run. See RELEASING.md.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

usage() {
  printf 'Usage: %s <version>\n' "$0" >&2
  printf 'Checks versions and builds release artifacts without publishing.\n' >&2
  exit 2
}

[[ $# -eq 1 ]] || usage
version="${1#v}"

if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
  printf 'Release builds require a clean working tree.\n' >&2
  exit 1
fi

python_bin="${PYTHON:-python3}"
if [[ -x .venv/bin/python ]]; then
  python_bin=.venv/bin/python
fi
for module in build maturin twine packaging; do
  if ! "$python_bin" -c "import $module" 2>/dev/null; then
    printf 'Missing %s; run: %s -m pip install --group release\n' "$module" "$python_bin" >&2
    exit 1
  fi
done

"$python_bin" scripts/check_versions.py "$version"
./scripts/smoke.sh
bash scripts/stage-crates.sh

out="$root/release-dist"
rm -rf "$out"
mkdir -p "$out/python" "$out/crates" "$out/npm"

printf '\n==> bfplot-cli wheel and sdist\n'
"$python_bin" -m maturin build --release -m crates/bfplot-cli/Cargo.toml --out "$out/python"
"$python_bin" -m maturin sdist -m crates/bfplot-cli/Cargo.toml --out "$out/python"

printf '\n==> bfplot wheel and sdist\n'
"$python_bin" -m build --outdir "$out/python" .

"$python_bin" -m twine check --strict "$out"/python/*

printf '\n==> Test install\n'
venv="$(mktemp -d)"
trap 'rm -rf "$venv"' EXIT
"$python_bin" -m venv "$venv"
"$venv/bin/python" -m pip install -q --only-binary bfplot-cli --find-links "$out/python" "bfplot==$version"
"$venv/bin/bfplot" --version

printf '\n==> Crates\n'
# --allow-dirty: the staged license texts and viewer are ignored by Git.
cargo package --workspace --locked --allow-dirty
cp target/package/bfplot-core-"$version".crate target/package/bfplot-cli-"$version".crate "$out/crates/"

printf '\n==> Viewer npm package\n'
npm pack ./viewer --pack-destination "$out/npm"

printf '\nRelease artifacts are in %s\n' "$out"
printf 'Nothing was published. To release, push the v%s tag (see RELEASING.md).\n' "$version"
