# How to contribute

Thank you! Bug reports, documentation fixes and small tests are just as welcome as features.

For a small fix, go ahead. For a new public API, artist type or format change, please open an issue first.

## Repository layout

```text
src/bfplot/       Python API, Matplotlib adapter, BFIR and result writer
crates/          Rust core library and the bfplot app
viewer/          Browser viewer (TypeScript); viewer/dist is the committed build
docs/            Documentation site (MkDocs)
tests/           Python tests
scripts/         Smoke checks, version tools and install scripts
```

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
