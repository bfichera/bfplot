#!/bin/sh
# Remove the bfplot app installed by install.sh:
#
#   curl -LsSf https://github.com/bfichera/bfplot/releases/latest/download/uninstall.sh | sh
#
# Set BFPLOT_INSTALL_DIR if you installed somewhere other than ~/.local/bin.
# bfplot keeps no other files, so this removes everything install.sh added.
set -eu

install_dir="${BFPLOT_INSTALL_DIR:-$HOME/.local/bin}"
app="$install_dir/bfplot"

say() { printf 'bfplot: %s\n' "$*"; }

if [ -f "$app" ]; then
  # Only remove the bfplot app, never an unrelated program with the same name.
  case "$("$app" --version 2>/dev/null || true)" in
    bfplot-cli\ *) ;;
    *)
      printf 'bfplot: error: %s is not the bfplot app; leaving it alone\n' "$app" >&2
      exit 1
      ;;
  esac
  rm -f "$app"
  say "removed $app"
else
  say "no bfplot in $install_dir (set BFPLOT_INSTALL_DIR if you installed elsewhere)"
fi

if other="$(command -v bfplot 2>/dev/null)" && [ -n "$other" ]; then
  say "another bfplot is still on your PATH: $other"
  say "if pip installed it, remove it with: pip uninstall bfplot bfplot-cli"
fi
