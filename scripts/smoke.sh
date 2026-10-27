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
  python_bin="${PYTHON:-python3}"
  if [[ -x .venv/bin/python ]]; then
    python_bin=.venv/bin/python
  fi
  section "Python lint and format"
  "$python_bin" -m ruff check src tests examples scripts
  "$python_bin" -m ruff format --check src tests examples scripts
  "$python_bin" scripts/check_versions.py
  section "Python tests"
  "$python_bin" -m compileall -q src
  if [[ -d tests ]]; then
    "$python_bin" -m pytest
  else
    printf 'No Python tests directory; compile check only.\n'
  fi
fi

if [[ -f viewer/package.json ]]; then
  section "Viewer toolchain"
  if [[ ! -x viewer/node_modules/.bin/tsc ]]; then
    printf 'Viewer dependencies are incomplete; run npm install --prefix viewer.\n' >&2
    exit 1
  fi
  section "Viewer typecheck"
  npm --prefix viewer run typecheck
  section "Viewer tests"
  if [[ -x viewer/node_modules/.bin/vitest ]]; then
    npm --prefix viewer test
  else
    printf 'Vitest is unavailable; skipping viewer runtime tests (typecheck still required).\n' >&2
  fi
  section "Viewer build"
  npm --prefix viewer run build
fi

section "Smoke checks passed"
