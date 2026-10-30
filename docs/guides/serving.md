# Serving plots

```console
$ bfplot view result.bfplot
```

starts a local server and opens the viewer in your browser. `bfplot serve` does the same without opening a browser. Both accept a result directory or a packed file.

The server listens on `127.0.0.1:8080`. Use `--port` to pick another port:

```console
$ bfplot serve result.bfplot --port 9000
```

## The viewer

The viewer is built into the `bfplot` app and needs no internet connection. When working on the viewer itself, you can serve a build of it instead:

```console
$ bfplot view result.bfplot --viewer-dir viewer/dist
$ export BFPLOT_VIEWER_DIR=/path/to/bfplot/viewer/dist
```

## Remote access

Binding to another address is an explicit choice:

```console
$ bfplot serve result.bfplot --bind 0.0.0.0
```
