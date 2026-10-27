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

Every object is named by the SHA-256 hash of its bytes. Objects belong to this result only.

## The manifest

```toml
format = "bfplot"
version = 1
document = "sha256:0123456789abcdef…"

[provenance]
created_utc = "2026-01-01T00:00:00Z"
git_commit = "98b821a316dd0a54f3e9d7bdd72c6e6007c1bbbf"
python = "3.14.6"
```

The manifest names the document object and records [provenance](guides/provenance.md). It is small and meant to be read, diffed and committed.

`version` is the format version. Every writer, in any language, records the version it writes, and the `bfplot` app refuses a result whose version is newer than it understands:

```console
$ bfplot verify experiment.bfplot
error: this result uses BFPlot format version 2, but this bfplot only reads up to version 1; please update bfplot
```

Newer versions of `bfplot` keep reading older versions.

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

That means: fetch the object, check its hash, decompress it with Zstandard and read 1,024 little-endian doubles.

## Hashes

`bfplot verify` checks the manifest, the document and the hash of every object:

```console
$ bfplot verify experiment.bfplot
verified 12 objects (22907 bytes)
```

A hash proves the bytes have not changed. It does not prove who made them; use an external signature for that.

## Packed files

```python
bfplot.savefig("experiment.bfplot", fig, layout="file")
```

writes the same manifest and objects into one file. Packing does not change any object or hash, and with `SOURCE_DATE_EPOCH` set the file is byte-for-byte reproducible.

```console
$ bfplot pack experiment.bfplot shared/experiment.bfplot
$ bfplot unpack shared/experiment.bfplot restored/experiment.bfplot
```

## Safety

Results contain data, never code, and cannot load extra renderers. Treat files from strangers as untrusted input anyway; see the [security policy](project/security.md).

BFPlot is pre-1.0, so the format may still change before 1.0.
