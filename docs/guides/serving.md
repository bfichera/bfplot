# Serving plots

```console
$ bfplot view result.bfplot
```

starts a local server and opens the viewer in your browser. `bfplot serve` does the same without opening a browser. Both take a result directory, verify it, and print its hash:

```console
$ bfplot serve result.bfplot
serving sha256:769fe0976cfeecf73414d7b467013c6cde561405bce6c5af5828836e03016e37 at http://127.0.0.1:8080
```

The viewer header shows the shortened hash; hover it for the full hash, or click **Copy**.

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

To listen on another address, pass `--bind`:

```console
$ bfplot serve result.bfplot --bind 0.0.0.0
```

On a shared machine, prefer keeping the server on loopback and reaching it through an SSH tunnel (`ssh -L 9000:localhost:9000 host`), since the server has no authentication.

## Endpoints

| Path | Returns |
| --- | --- |
| `/` | The viewer. |
| `/hash` | The result's hash, as plain text. |
| `/manifest` | `manifest.toml` exactly as stored. |
| `/document` | The document the viewer draws, with the hash. |
| `/objects/sha256/DIGEST` | One stored array object. |

For example, to check which result a remote server is showing:

```console
$ curl http://host:9000/hash
sha256:769fe0976cfeecf73414d7b467013c6cde561405bce6c5af5828836e03016e37
```
