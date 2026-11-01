# Command-line interface

Every command that reads a result takes a result directory. Run `bfplot COMMAND --help` for details.

| Command | What it does |
| --- | --- |
| `bfplot view RESULT` | Serve a result and open it in the browser. |
| `bfplot serve RESULT` | Serve a result without opening a browser. |
| `bfplot hash RESULT...` | Print the hash of each result. |
| `bfplot compare A B` | Report whether two results are identical, and where they differ. |
| `bfplot verify RESULT` | Check the manifest, document and every object hash, then print the hash. |
| `bfplot manifest RESULT` | Print the manifest exactly as stored. |

## `view` and `serve` options

| Option | Meaning |
| --- | --- |
| `--bind ADDRESS` | Listening address. Defaults to `127.0.0.1`. |
| `--port PORT` | Listening port. Defaults to `8080`. |
| `--viewer-dir PATH` | Serve the viewer from this built directory instead of the copy inside `bfplot`. For viewer development. Also read from `BFPLOT_VIEWER_DIR`. |

`serve` and `view` verify the result before serving it and print its hash. Besides the viewer at `/`, the server answers `/hash` (the hash as plain text), `/manifest`, `/document` and `/objects/sha256/DIGEST`.

## `hash`

```console
$ bfplot hash fit.bfplot
sha256:769fe0976cfeecf73414d7b467013c6cde561405bce6c5af5828836e03016e37
$ bfplot hash fit.bfplot scan.bfplot
sha256:769fe0976cfeecf73414d7b467013c6cde561405bce6c5af5828836e03016e37  fit.bfplot
sha256:45a78207de0c593d5621a80774482b2ba8c23bce04b6264a84474147d47f1299  scan.bfplot
```

With one result, only the hash is printed; with several, one `HASH  PATH` line each. The hash is read from the manifest; `--verify` checks every object first.

## `compare`

```console
$ bfplot compare old.bfplot new.bfplot
```

Prints `identical HASH`, or `different` followed by both hashes and up to 50 differences, each a document path with the old and new values. Arrays are compared by dtype, shape and hash.

| Option | Meaning |
| --- | --- |
| `-q`, `--quiet` | Print nothing; only set the exit status. |
| `--verify` | Check every object of both results first. |

Exit status: 0 if identical, 1 if different, 2 on error.
