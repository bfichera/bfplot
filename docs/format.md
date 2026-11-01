# File format

You do not need this page to use BFPlot. It explains what BFPlot writes to disk. The [architecture page](project/architecture.md) is the precise reference.

## A result

```python
bfplot.savefig("experiment.bfplot", fig)
```

creates one result directory:

```text
experiment.bfplot/
├── manifest.toml
├── .gitignore                ← "/objects/"
└── objects/sha256/ab/abcdef…
```

Every object is named by the SHA-256 hash of its content. Objects belong to this result only. A result holds only what is needed to draw its plots: there is no metadata or provenance.

## The manifest

```toml
format = "bfplot"
version = 2
hash = "sha256:0123456789abcdef…"
```

The manifest holds exactly these three keys. `hash` is the hash of the whole result (see [Hashes](#hashes)) and names its document object. The manifest is small and meant to be read, diffed and committed. Python-written manifests end with a text preview of the figures in TOML comments (see [Using BFPlot with Git](guides/version-control.md)). Readers ignore the preview, and it is not part of the hash.

`version` is the format version. Every writer, in any language, records the version it writes, and the `bfplot` app refuses a result whose version is newer than it understands:

```console
$ bfplot verify experiment.bfplot
error: this result uses BFPlot format version 3, but this bfplot only reads up to version 2; please update bfplot
```

Version 1 results recorded provenance and hashed arrays differently. They are no longer read; save them again with the current `bfplot`.

## The document

The document is canonical JSON (sorted keys, no extra whitespace, finite numbers) describing figures, axes and artists. A figure may have a `name` that is unique within the result. An animated result also has a `timeline`.

Every artist has:

| Field | Meaning |
| --- | --- |
| `type` | The kind of artist, such as `bfplot.line`. |
| `id` | Its identifier in the document. |
| `axes_id` | The axes it belongs to. |
| `props` | Colors, line widths, labels and other styling. |
| `data` | Inline values or references to arrays. |

## Arrays

Arrays are separate objects, referenced like this:

```json
{"object": "sha256:<64 hex digits>", "dtype": "f8", "shape": [1024], "codec": "zstd"}
```

That means: fetch the object, decompress it with Zstandard (codec `zstd`; `none` means stored as is), check that the SHA-256 of the decompressed bytes matches, and read 1,024 little-endian doubles. Because an array is named by the hash of its decoded bytes, its name does not depend on how it was compressed. Identical arrays are stored once.

## Hashes

The hash of a result is the SHA-256 of its canonical document JSON. The document names every array by the hash of its raw bytes, together with its dtype and shape, so the result hash covers everything: two results have the same hash exactly when all of their figures, artists, animation frames and arrays are identical. Writing the same figures twice gives byte-identical results with the same hash.

```console
$ bfplot hash experiment.bfplot
sha256:769fe0976cfeecf73414d7b467013c6cde561405bce6c5af5828836e03016e37
```

`bfplot hash` only reads the manifest. `bfplot verify` (or `bfplot hash --verify`) also checks the document and every array against their hashes:

```console
$ bfplot verify experiment.bfplot
verified 12 objects (22907 bytes)
sha256:769fe0976cfeecf73414d7b467013c6cde561405bce6c5af5828836e03016e37
```

See [Comparing results](guides/comparing.md). A hash proves the content has not changed. It does not prove who made it; use an external signature for that.

## Safety

Results contain data, never code, and cannot load extra renderers.

BFPlot is pre-1.0, so the format may still change before 1.0.
