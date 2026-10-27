# Serving plots

The MPlot viewer is a browser application served by a small Rust server. For ordinary local viewing, use:

```console
$ mplot view result.mplot
```

This starts the server, opens your default browser, and keeps the plot on your own machine. `view` and `serve` accept a result directory, a packed file, or an older `*.mplot.toml` manifest.

## Serve without opening a browser

```console
$ mplot serve result.mplot
```

By default, the server listens at `127.0.0.1:8080`.

Choose another port if needed:

```console
$ mplot serve result.mplot --port 9000
```

## Find the viewer assets

If the CLI cannot locate `viewer/dist`, provide it explicitly:

```console
$ mplot view result.mplot --viewer-dir /path/to/mplot/viewer/dist
```

or:

```console
$ export MPLOT_VIEWER_DIR=/path/to/mplot/viewer/dist
```

## Remote access

Binding to a non-loopback address is an explicit choice:

```console
$ mplot serve result.mplot --bind 0.0.0.0 --port 8080
```

!!! danger "Please do not put this naked on the public internet"
    MPlot 0.9.9 does not provide built-in authentication or TLS. Put a properly configured authenticated reverse proxy in front of it, restrict network access, and apply appropriate resource limits.

The server exposes the plot document and numerical objects to connected clients. Read the [security guide](../project/security.md) before operating a remote service.
