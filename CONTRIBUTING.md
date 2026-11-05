# How to contribute

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
