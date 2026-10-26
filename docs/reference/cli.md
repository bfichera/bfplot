# Command-line interface

The `mplot` command verifies, converts, serves, and views artifacts.

## View a plot

```console
$ mplot view ARTIFACT
```

Serve a split artifact and open it in the default browser.

```console
$ mplot view result.mplot.toml --port 9000
```

## Serve a plot

```console
$ mplot serve ARTIFACT
```

Serve without launching a browser. The default address is `127.0.0.1:8080`.

Options shared by `view` and `serve`:

| Option | Meaning |
| --- | --- |
| `--bind ADDRESS` | Listening address. Defaults to loopback. |
| `--port PORT` | Listening port. Defaults to `8080`. |
| `--viewer-dir PATH` | Directory containing built viewer assets. |

!!! note
    MPlot 0.9.9 serves split `*.mplot.toml` artifacts. Unpack a packed artifact before serving it.

## Verify an artifact

```console
$ mplot verify ARTIFACT
```

Verify a split or packed artifact’s hashes, schema, and references.

## Pack an artifact

```console
$ mplot pack MANIFEST OUTPUT
```

```console
$ mplot pack result.mplot.toml result.mplot
```

## Unpack an artifact

```console
$ mplot unpack ARTIFACT MANIFEST
```

```console
$ mplot unpack result.mplot restored/result.mplot.toml
```

## Stream framing utilities

Convert newline-delimited JSON stream frames to MPlot’s binary framing:

```console
$ mplot stream encode < frames.jsonl > frames.bin
```

Decode them again:

```console
$ mplot stream decode < frames.bin > frames.jsonl
```

Run `mplot --help` or `mplot COMMAND --help` for the exact options supported by your installed build.
