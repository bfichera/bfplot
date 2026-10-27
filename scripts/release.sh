#!/usr/bin/env bash
# Build every release artifact for this machine into release-dist/, without publishing.
#
#   scripts/release.sh
#
# A local dry run of the current version. Real releases are made by the Release workflow
# on GitHub, which builds every platform; see RELEASING.md.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

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

"$python_bin" scripts/check_versions.py
version="$("$python_bin" -c 'import tomllib; print(tomllib.load(open("Cargo.toml", "rb"))["workspace"]["package"]["version"])')"
./scripts/smoke.sh
bash scripts/stage-crates.sh

out="$root/release-dist"
rm -rf "$out"
mkdir -p "$out/python" "$out/github" "$out/crates" "$out/npm"

printf '\n==> bfplot-cli wheel and sdist\n'
"$python_bin" -m maturin build --release -m crates/bfplot-cli/Cargo.toml --out "$out/python"
"$python_bin" -m maturin sdist -m crates/bfplot-cli/Cargo.toml --out "$out/python"

printf '\n==> bfplot wheel and sdist\n'
"$python_bin" -m build --outdir "$out/python" .

"$python_bin" -m twine check --strict "$out"/python/*

printf '\n==> Test install\n'
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
"$python_bin" -m venv "$work/venv"
"$work/venv/bin/python" -m pip install -q --only-binary bfplot-cli --find-links "$out/python" "bfplot==$("$python_bin" -c 'import tomllib; print(tomllib.load(open("pyproject.toml", "rb"))["project"]["version"])')"
"$work/venv/bin/bfplot" --version

printf '\n==> App archive, install.sh and uninstall.sh\n'
# The binary from the wheel, packaged the way CI does for this machine's platform.
case "$(uname -s)-$(uname -m)" in
  Darwin-arm64) target=aarch64-apple-darwin ;;
  Darwin-x86_64) target=x86_64-apple-darwin ;;
  Linux-x86_64) target=x86_64-unknown-linux-musl ;;
  Linux-aarch64) target=aarch64-unknown-linux-musl ;;
  *) target="" ;;
esac
if [[ -n "$target" ]]; then
  # CI builds Linux archives for musl; a local glibc build is only a stand-in.
  mkdir -p "$work/app"
  cp "$work/venv/bin/bfplot" LICENSE-APACHE LICENSE-MIT "$work/app/"
  archive="bfplot-$target.tar.gz"
  tar -czf "$out/github/$archive" -C "$work/app" bfplot LICENSE-APACHE LICENSE-MIT
  (cd "$out/github" && shasum -a 256 "$archive" >"$archive.sha256")
  cp scripts/install.sh scripts/uninstall.sh "$out/github/"
  BFPLOT_DOWNLOAD_URL="file://$out/github" BFPLOT_INSTALL_DIR="$work/bin" sh scripts/install.sh
  BFPLOT_INSTALL_DIR="$work/bin" sh scripts/uninstall.sh
  [[ ! -e "$work/bin/bfplot" ]]
fi

printf '\n==> Crates\n'
# --allow-dirty: the staged license texts and viewer are ignored by Git.
cargo package --workspace --locked --allow-dirty
cp target/package/bfplot-core-"$version".crate target/package/bfplot-cli-"$version".crate "$out/crates/"

printf '\n==> Viewer npm package\n'
npm pack ./viewer --pack-destination "$out/npm"

printf '\nRelease artifacts are in %s\n' "$out"
printf 'Nothing was published. To release, run the Release workflow on GitHub (see RELEASING.md).\n'
