# Installation

MPlot 0.9.9 is currently installed from a source checkout. Prebuilt packages are planned for 1.0; until then, installation is a little nerdier than we would ultimately like.

## What you need

- Python 3.10 or newer
- A Rust toolchain
- A modern browser
- Node.js only if you plan to develop the viewer

## Install from source

```console
$ git clone https://github.com/mplot-dev/mplot.git
$ cd mplot
$ python -m pip install -e .
$ cargo install --path crates/mplot-cli
```

Check that both pieces are available:

```console
$ python -c "import mplot; print(mplot.__version__)"
0.9.9

$ mplot --version
mplot-cli 0.9.9
```

## Finding the viewer

The browser viewer is included in `viewer/dist`. When you run the CLI from the repository, MPlot finds it automatically:

```console
$ mplot view my_plot.mplot
```

If you run the installed CLI elsewhere, tell it where the viewer lives:

=== "Command-line option"

    ```console
    $ mplot view my_plot.mplot --viewer-dir /path/to/mplot/viewer/dist
    ```

=== "Environment variable"

    ```console
    $ export MPLOT_VIEWER_DIR=/path/to/mplot/viewer/dist
    $ mplot view my_plot.mplot
    ```

!!! tip
    Add `MPLOT_VIEWER_DIR` to your shell configuration if you use MPlot frequently from several projects.

## Development installation

If you want to work on MPlot itself:

```console
$ python -m venv .venv
$ . .venv/bin/activate
$ python -m pip install -e '.[test]'
$ npm install --prefix viewer
$ ./scripts/smoke.sh
```

See [How to contribute](../project/contributing.md) for the repository layout and testing expectations.
