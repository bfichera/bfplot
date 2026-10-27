# Command-line interface

The `mplot` command verifies, converts, serves, and views results.

Every command that reads a result accepts a result directory, a packed file, or an older `*.mplot.toml` manifest.

## View a plot

```console
$ mplot view ARTIFACT
```

Serve a result and open it in the default browser.

```console
$ mplot view result.mplot --port 9000
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

## Verify a result

```console
$ mplot verify ARTIFACT
```

Verify a result’s hashes, schema, and references.

## Print the manifest

```console
$ mplot manifest ARTIFACT
```

Print the stored manifest TOML exactly as it is. This is handy for readable Git diffs of packed files:

```text title=".gitattributes"
*.mplot diff=mplot
```

```console
$ git config diff.mplot.textconv "mplot manifest"
```

Result directories do not need this; Git already diffs their `manifest.toml` as text.

## Pack a result

```console
$ mplot pack SOURCE OUTPUT
```

Convert a result directory (or an older manifest) into one packed file.

```console
$ mplot pack results/fit.mplot shared/fit.mplot
$ mplot pack old.mplot.toml new.mplot
```

## Unpack a result

```console
$ mplot unpack ARTIFACT DESTINATION
```

Turn a packed file into a result directory. An existing MPlot result at the destination is replaced; anything else is refused.

```console
$ mplot unpack shared/fit.mplot restored/fit.mplot
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
