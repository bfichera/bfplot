# Installation

You need Python 3.10+ and a modern browser.

```console
$ python -m pip install bfplot
```

This installs the Python library, which saves your figures, and the `bfplot` app, which opens them. The app is a small compiled program with the viewer built in, so you don't need Rust, Node.js or anything else. It comes from the `bfplot-cli` package, which pip installs automatically at the same version.

Check both parts:

```console
$ python -c "import bfplot; print(bfplot.__version__)"
1.0.0
$ bfplot --version
bfplot-cli 1.0.0
```

Both print the same version.

If your shell can't find `bfplot`, the environment you installed into is probably not activated. `bfplot.show()` still works, because Python looks for the app in its own environment first.

## Just the app

To open results that someone else made, or that were written from another language, you only need the app. On macOS and Linux:

```console
$ curl -LsSf https://github.com/bfichera/bfplot/releases/latest/download/install.sh | sh
```

This puts `bfplot` in `~/.local/bin`, after checking the download's SHA-256. Set `BFPLOT_INSTALL_DIR` to put it elsewhere, or `BFPLOT_VERSION` (such as `1.0.0`) for a particular version. Run the same command again to update.

To remove it:

```console
$ curl -LsSf https://github.com/bfichera/bfplot/releases/latest/download/uninstall.sh | sh
```

On Windows, or if you prefer Python tools, install only the app with `uv tool install bfplot-cli` or `pipx install bfplot-cli`. Rust developers can also use `cargo install bfplot-cli`.

## Versions

Any `bfplot` app opens results written by the same or an older version of BFPlot. If a result is newer than your app, it says so:

```text
error: this result uses BFPlot format version 2, but this bfplot only reads up to version 1; please update bfplot
```

## From a source checkout

You need Rust as well, to build the app:

```console
$ git clone https://github.com/bfichera/bfplot.git
$ cd bfplot
$ python -m pip install ./crates/bfplot-cli -e .
```

To work on BFPlot itself, see [How to contribute](../project/contributing.md).
