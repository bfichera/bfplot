# Installation

MPlot 0.9.9 is installed from a source checkout. You need Python 3.10+, a Rust toolchain and a modern browser.

```console
$ git clone https://github.com/mplot-dev/mplot.git
$ cd mplot
$ python -m pip install -e .
$ cargo install --path crates/mplot-cli
```

Check both parts:

```console
$ python -c "import mplot; print(mplot.__version__)"
0.9.9
$ mplot --version
mplot-cli 0.9.9
```

## The viewer

The built viewer is in `viewer/dist`, and the CLI finds it when run from the repository. Elsewhere, point it there:

```console
$ mplot view my_plot.mplot --viewer-dir /path/to/mplot/viewer/dist
$ export MPLOT_VIEWER_DIR=/path/to/mplot/viewer/dist
```

## Working on MPlot

See [How to contribute](../project/contributing.md).
