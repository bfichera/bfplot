# Serving plots

```console
$ bfplot view result.bfplot
```

starts a local server and opens the viewer in your browser. `bfplot serve` does the same without opening a browser. Both accept a result directory or a packed file.

The server listens on `127.0.0.1:8080`. Use `--port` to pick another port:

```console
$ bfplot serve result.bfplot --port 9000
```

## Viewer assets

Outside the repository, tell the CLI where the built viewer is:

```console
$ bfplot view result.bfplot --viewer-dir /path/to/bfplot/viewer/dist
$ export BFPLOT_VIEWER_DIR=/path/to/bfplot/viewer/dist
```

## Remote access

Binding to another address is an explicit choice:

```console
$ bfplot serve result.bfplot --bind 0.0.0.0
```

!!! danger
    The server has no authentication or TLS. Put an authenticated reverse proxy in front of it and restrict network access. See the [security policy](../project/security.md).
