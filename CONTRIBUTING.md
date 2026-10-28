# How to contribute

Thank you! Bug reports, documentation fixes and small tests are just as welcome as features.

For a small fix, go ahead. For a new public API, artist type or format change, please open an issue first. Report security problems privately as described in `SECURITY.md`, not in the public tracker.

## Repository layout

```text
src/bfplot/       Python API, Matplotlib adapter, BFIR and result writer
crates/          Rust core library and the bfplot app
viewer/          Browser viewer (TypeScript); viewer/dist is the committed build
docs/            Documentation site (MkDocs)
tests/           Python tests
scripts/         Smoke checks, version tools and install scripts
```

`ARCHITECTURE.md` describes the format and how the parts fit together.

## Development setup

You need Python 3.10+ with pip 25.1 or newer, Rust and Node.js.

```console
$ python -m venv .venv
$ . .venv/bin/activate
$ python -m pip install --upgrade pip
$ python -m pip install ./crates/bfplot-cli -e . --group dev
$ npm install --prefix viewer
$ ./scripts/smoke.sh
```

The smoke script runs every formatter, linter and test suite and rebuilds the viewer. While working, the focused commands are faster:

```console
$ cargo test --workspace
$ python -m pytest
$ npm --prefix viewer test
$ mkdocs build --strict
```

The install command builds the compiled app from `crates/bfplot-cli` and installs it into the environment next to the Python package. The app embeds the built viewer: after changing Rust code or rebuilding the viewer, reinstall it with `python -m pip install ./crates/bfplot-cli` (or use `cargo run -p bfplot-cli -- view …`). To try viewer changes without rebuilding the app, point it at the build: `bfplot view result.bfplot --viewer-dir viewer/dist`.

Format with `cargo fmt --all` and `python -m ruff format src tests examples scripts`. Edit `viewer/src`, not `viewer/dist`; rebuild with `npm --prefix viewer run build`.

## Tests

A good test fails for the bug you fixed.

- Format changes need a directory → packed → directory round trip and malformed-input cases.
- New artist types need adapter and viewer tests.
- Renderer changes should cover the visible fallback for bad data.

## Rules

- Verify an object's SHA-256 before decoding it.
- Keep JSON canonical and packing deterministic.
- Never let a result execute code or load third-party renderers.
- Serve on loopback unless the user explicitly asks otherwise.
- Show unsupported artists instead of dropping them.

## Pull requests

Say what problem you solved, how, and which tests you ran. Contributions are licensed under Apache-2.0 or MIT, at the user's option.
