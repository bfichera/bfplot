# Installation

BFPlot 0.9.9 is installed from a source checkout. You need Python 3.10+, a Rust toolchain and a modern browser.

```console
$ git clone https://github.com/bfplot-dev/bfplot.git
$ cd bfplot
$ python -m pip install -e .
$ cargo install --path crates/bfplot-cli
```

Check both parts:

```console
$ python -c "import bfplot; print(bfplot.__version__)"
0.9.9
$ bfplot --version
bfplot-cli 0.9.9
```

## The viewer

The built viewer is in `viewer/dist`, and the CLI finds it when run from the repository. Elsewhere, point it there:

```console
$ bfplot view my_plot.bfplot --viewer-dir /path/to/bfplot/viewer/dist
$ export BFPLOT_VIEWER_DIR=/path/to/bfplot/viewer/dist
```

## Working on BFPlot

See [How to contribute](../project/contributing.md).
