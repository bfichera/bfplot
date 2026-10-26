#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

section() {
  printf '\n==> %s\n' "$1"
}

if [[ -f Cargo.toml ]]; then
  section "Rust format"
  cargo fmt --all -- --check
  section "Rust tests"
  cargo test --workspace --all-targets
  section "Rust lints"
  cargo clippy --workspace --all-targets --all-features -- -D warnings
fi

if [[ -f pyproject.toml ]]; then
  section "Python package"
  python -m compileall -q src
  if [[ -d tests ]]; then
    python -m pytest
  else
    printf 'No Python tests directory; compile check only.\n'
  fi
fi

if [[ -f viewer/package.json ]]; then
  section "Viewer typecheck"
  if [[ ! -d viewer/node_modules ]]; then
    printf 'viewer/node_modules is missing; run npm install --prefix viewer first.\n' >&2
    exit 1
  fi
  npm --prefix viewer run typecheck
  section "Viewer tests"
  npm --prefix viewer test
  section "Viewer build"
  npm --prefix viewer run build
fi

section "Smoke checks passed"
