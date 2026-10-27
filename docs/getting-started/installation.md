# Installation

You need Python 3.10+ and a modern browser.

```console
$ python -m pip install bfplot
```

This installs the Python library, which saves your figures, and the `bfplot` app, which opens them. The app is a small compiled program with the viewer built in, so you don't need Rust, Node.js or anything else. It comes from the `bfplot-cli` package, which pip installs automatically at the same version.

Check both parts:

```console
$ python -c "import bfplot; print(bfplot.__version__)"
0.9.9
$ bfplot --version
bfplot-cli 0.9.9
```

If your shell can't find `bfplot`, the environment you installed into is probably not activated. `bfplot.show()` still works, because Python looks for the app in its own environment first.

## Just the app

To open results that someone else made, or that were written from another language, you only need the app:

=== "pip / uv"

    ```console
    $ uv tool install bfplot-cli
    $ pipx install bfplot-cli
    ```

=== "Homebrew"

    ```console
    $ brew install bfplot-dev/tap/bfplot
    ```

=== "Installer script"

    ```console
    $ curl --proto '=https' --tlsv1.2 -LsSf https://github.com/bfplot-dev/bfplot/releases/latest/download/bfplot-cli-installer.sh | sh
    ```

    On Windows, in PowerShell:

    ```powershell
    PS> powershell -ExecutionPolicy Bypass -c "irm https://github.com/bfplot-dev/bfplot/releases/latest/download/bfplot-cli-installer.ps1 | iex"
    ```

=== "Cargo"

    ```console
    $ cargo install bfplot-cli
    ```

Every release also attaches ready-made archives for Linux, macOS and Windows to its [GitHub release](https://github.com/bfplot-dev/bfplot/releases).

## Versions

Any `bfplot` app opens results written by the same or an older version of BFPlot. If a result is newer than your app, it says so:

```text
error: this result uses BFPlot format version 2, but this bfplot only reads up to version 1; please update bfplot
```

## From a source checkout

You need Rust as well, to build the app:

```console
$ git clone https://github.com/bfplot-dev/bfplot.git
$ cd bfplot
$ python -m pip install ./crates/bfplot-cli -e .
```

To work on BFPlot itself, see [How to contribute](../project/contributing.md).
