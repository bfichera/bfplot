# Serving plots

```console
$ mplot view result.mplot
```

starts a local server and opens the viewer in your browser. `mplot serve` does the same without opening a browser. Both accept a result directory or a packed file.

The server listens on `127.0.0.1:8080`. Use `--port` to pick another port:

```console
$ mplot serve result.mplot --port 9000
```

## Viewer assets

Outside the repository, tell the CLI where the built viewer is:

```console
$ mplot view result.mplot --viewer-dir /path/to/mplot/viewer/dist
$ export MPLOT_VIEWER_DIR=/path/to/mplot/viewer/dist
```

## Remote access

Binding to another address is an explicit choice:

```console
$ mplot serve result.mplot --bind 0.0.0.0
```

!!! danger
    The server has no authentication or TLS. Put an authenticated reverse proxy in front of it and restrict network access. See the [security policy](../project/security.md).
