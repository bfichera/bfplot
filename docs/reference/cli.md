# Command-line interface

Every command that reads a result accepts a result directory or a packed file. Run `bfplot COMMAND --help` for details.

| Command | What it does |
| --- | --- |
| `bfplot view RESULT` | Serve a result and open it in the browser. |
| `bfplot serve RESULT` | Serve a result without opening a browser. |
| `bfplot verify RESULT` | Check the manifest, document and every object hash. |
| `bfplot manifest RESULT` | Print the manifest exactly as stored. |
| `bfplot pack SOURCE OUTPUT` | Turn a result directory into one packed file. |
| `bfplot unpack PACKED DESTINATION` | Turn a packed file into a result directory. |

`pack` and `unpack` replace an existing result at the destination and refuse to replace anything else.

## `view` and `serve` options

| Option | Meaning |
| --- | --- |
| `--bind ADDRESS` | Listening address. Defaults to `127.0.0.1`. |
| `--port PORT` | Listening port. Defaults to `8080`. |
| `--viewer-dir PATH` | Directory with the built viewer. Defaults to `BFPLOT_VIEWER_DIR` or `./viewer/dist`. |

## Diffing packed files in Git

```text title=".gitattributes"
*.bfplot diff=bfplot
```

```console
$ git config diff.bfplot.textconv "bfplot manifest"
```

Result directories do not need this; Git diffs their `manifest.toml` directly.
