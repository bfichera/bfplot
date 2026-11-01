#!/bin/sh
# Install the bfplot app on macOS or Linux:
#
#   curl -LsSf https://github.com/bfichera/bfplot/releases/latest/download/install.sh | sh
#
# Settings (environment variables):
#   BFPLOT_VERSION      version to install, such as 1.0.0 (default: the latest release)
#   BFPLOT_INSTALL_DIR  where to put the program (default: ~/.local/bin)
#
# Remove it again with uninstall.sh from the same release page.
set -eu

repo="https://github.com/bfichera/bfplot"
install_dir="${BFPLOT_INSTALL_DIR:-$HOME/.local/bin}"
if [ -n "${BFPLOT_VERSION:-}" ]; then
  base="$repo/releases/download/v${BFPLOT_VERSION#v}"
else
  base="$repo/releases/latest/download"
fi
# Where the release files are; overridden to test the script against local builds.
base="${BFPLOT_DOWNLOAD_URL:-$base}"

say() { printf 'bfplot: %s\n' "$*"; }
fail() {
  printf 'bfplot: error: %s\n' "$*" >&2
  exit 1
}

case "$(uname -s)" in
  Darwin) os=apple-darwin ;;
  # Statically linked, so it runs on any distribution.
  Linux) os=unknown-linux-musl ;;
  *) fail "this script supports macOS and Linux; elsewhere build from source (see https://github.com/bfichera/bfplot)" ;;
esac
case "$(uname -m)" in
  x86_64 | amd64) arch=x86_64 ;;
  arm64 | aarch64) arch=aarch64 ;;
  *) fail "no prebuilt bfplot for $(uname -m); build from source (see https://github.com/bfichera/bfplot)" ;;
esac
# A shell running under Rosetta reports x86_64 on Apple silicon; use the native build.
if [ "$os" = apple-darwin ] && [ "$arch" = x86_64 ] &&
  [ "$(sysctl -n hw.optional.arm64 2>/dev/null || true)" = 1 ]; then
  arch=aarch64
fi
archive="bfplot-$arch-$os.tar.gz"

download() {
  if command -v curl >/dev/null 2>&1; then
    curl --proto '=https,file' --tlsv1.2 -fsSL "$1" -o "$2"
  elif command -v wget >/dev/null 2>&1; then
    wget -q -O "$2" "$1"
  else
    fail "curl or wget is required"
  fi
}

sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d ' ' -f 1
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | cut -d ' ' -f 1
  else
    fail "sha256sum or shasum is required to check the download"
  fi
}

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
trap 'exit 130' INT TERM

say "downloading $base/$archive"
download "$base/$archive" "$tmp/$archive" || fail "could not download $base/$archive"
download "$base/$archive.sha256" "$tmp/$archive.sha256" ||
  fail "could not download $base/$archive.sha256"
expected="$(cut -d ' ' -f 1 <"$tmp/$archive.sha256")"
actual="$(sha256 "$tmp/$archive")"
[ "$expected" = "$actual" ] || fail "checksum mismatch for $archive (expected $expected, got $actual)"

tar -xzf "$tmp/$archive" -C "$tmp"
[ -f "$tmp/bfplot" ] || fail "$archive does not contain bfplot"

mkdir -p "$install_dir"
# Copy next to the destination and rename, so a running bfplot is replaced safely.
cp "$tmp/bfplot" "$install_dir/.bfplot.$$"
chmod 755 "$install_dir/.bfplot.$$"
mv -f "$install_dir/.bfplot.$$" "$install_dir/bfplot"
installed="$("$install_dir/bfplot" --version)" || fail "the installed bfplot does not run"
say "installed $installed to $install_dir/bfplot"

case ":$PATH:" in
  *":$install_dir:"*)
    found="$(command -v bfplot || true)"
    if [ -n "$found" ] && [ "$found" != "$install_dir/bfplot" ]; then
      say "note: $found comes first on your PATH and will be used instead"
    fi
    ;;
  *)
    say "$install_dir is not on your PATH; add this line to your shell profile:"
    printf '\n    export PATH="%s:$PATH"\n\n' "$install_dir"
    ;;
esac
