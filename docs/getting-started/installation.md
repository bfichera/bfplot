# Installation

BFPlot has two parts: the `bfplot` app, which opens results, and the Python library, which saves your figures.

## The app

On macOS and Linux:

```console
$ curl -LsSf https://github.com/bfichera/bfplot/releases/latest/download/install.sh | sh
```

This puts `bfplot` in `~/.local/bin`. Set `BFPLOT_INSTALL_DIR` to put it elsewhere, or `BFPLOT_VERSION` (such as `1.0.0`) for a particular version. Run the same command again to update.

To remove it:

```console
$ curl -LsSf https://github.com/bfichera/bfplot/releases/latest/download/uninstall.sh | sh
```

## The Python library

You need Python 3.10+:

```console
$ python -m pip install "bfplot @ git+https://github.com/bfichera/bfplot"
```

Add `@v1.0.0` to the URL for a particular version. Check both parts:

```console
$ python -c "import bfplot; print(bfplot.__version__)"
1.0.0
$ bfplot --version
bfplot-cli 1.0.0
```

If your shell can't find `bfplot`, check that `~/.local/bin` (or your `BFPLOT_INSTALL_DIR`) is on your `PATH`.

## From a source checkout

On other platforms, or to build everything yourself, you need Rust as well:

```console
$ git clone https://github.com/bfichera/bfplot.git
$ cd bfplot
$ python -m pip install ./crates/bfplot-cli -e .
```

This builds the app and installs it into the same environment as the Python library, where `bfplot.show()` finds it even if the environment is not activated.
