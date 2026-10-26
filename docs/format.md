# How MPlot files work

You do **not** need to understand the file format to use MPlot. If this is your first visit, go back to the [front page](../README.md), call `mplot.savefig()`, and make yourself an interactive plot!

Still here? Great. This page explains what MPlot puts on disk and why it looks a little different from a PDF.

> This is the friendly format guide. [`ARCHITECTURE.md`](../ARCHITECTURE.md) is the precise internal contract if you are implementing a reader or writer.

## The short version

When you run:

```python
mplot.savefig("experiment", fig)
```

MPlot creates:

```text
experiment.mplot.toml
.mplot/objects/sha256/ab/abcdef...
```

The TOML file is a small, readable manifest. The object directory contains the plot document and compressed numerical arrays. Every object is named using its SHA-256 hash.

Why split things up? Scientific arrays can be enormous, while manifests are small and useful to inspect in Git. Keeping those jobs separate works rather nicely.

## The manifest

The `*.mplot.toml` file is the front door to an artifact. It tells MPlot:

- which format and MPlot version created the output;
- which content-addressed object contains the plot document;
- what provenance was recorded when the figure was saved.

A manifest looks roughly like this:

```toml
format = "mplot"
version = "0.9.9"
schema_version = 1
document = "sha256:0123456789abcdef..."

[provenance]
python = "3.14.6"
script = "/path/to/analysis.py"
```

The manifest is intended to be small enough to read, diff, and commit.

## The plot document

The document is canonical JSON describing the figures, axes, artists, links, selections, plugin requirements, and references to numerical arrays.

“Canonical” sounds fancy, but it just means MPlot writes equivalent JSON in one predictable way:

- object keys are sorted;
- unnecessary whitespace is removed;
- text is encoded as UTF-8;
- numbers must be finite.

Predictable bytes give predictable hashes. That makes verification and deduplication possible.

## Artists

In Matplotlib, a line, scatter plot, image, and piece of text are all “artists.” MPlot uses the same general idea.

Every saved artist includes:

| Field | What it means |
| --- | --- |
| `type` | What kind of artist this is, such as `mplot.line`. |
| `schema_version` | Which version of that artist’s data layout is being used. |
| `id` | The artist’s identifier inside this document. |
| `axes_id` | The axes that owns the artist. |
| `props` | Colors, line widths, labels, and other display properties. |
| `data` | Inline values or references to larger arrays. |

MPlot 0.9.9 includes artists for lines, scatter plots, images, error bars, filled regions, histograms, contours, text, patches, and common 3D plots.

A viewer should never silently hide an artist it does not understand. It should show a useful placeholder instead. A missing curve can change the scientific meaning of a figure, and “I quietly ignored it” is not an acceptable rendering strategy.

## Numerical arrays

Large arrays are stored separately and referenced like this:

```json
{
  "object": "sha256:<64 hexadecimal digits>",
  "dtype": "f8",
  "shape": [1024],
  "codec": "zstd"
}
```

This says, “fetch this object, verify its hash, decompress it with Zstandard, and interpret it as 1,024 double-precision values.”

MPlot verifies the stored bytes *before* decoding them. Readers also check the dtype, shape, decoded length, and allocation limits. That may sound fussy, but scientific software should be fussy about corrupted data.

## What does the hash do?

An object’s filename is the lowercase SHA-256 digest of its exact stored bytes. If even one byte changes, verification fails:

```console
$ mplot verify experiment.mplot.toml
verified 12 objects (22907 bytes)
```

The hash provides integrity. It tells you whether the bytes still match their recorded identity. It does **not** tell you who created them; use an external signature if authorship matters.

## Packed files

Sometimes you do not want a manifest plus an object directory. You want one file that you can attach to an email or copy onto a drive:

```python
mplot.savefig("experiment.mplot", fig)
```

A packed `*.mplot` file contains the same manifest and objects in a deterministic binary container. Packing does not change object contents or hashes.

```console
$ mplot pack experiment.mplot.toml experiment.mplot
$ mplot unpack experiment.mplot restored/experiment.mplot.toml
```

A split → packed → split trip should preserve the scientific artifact. No numerical luggage should go missing along the way.

## Are MPlot files safe to open?

MPlot artifacts contain data, not executable Python or native code. A plugin requirement names separately installed software; it does not give the artifact permission to download or run anything.

Files are still untrusted input, so readers must validate hashes, paths, array sizes, and schemas. See the [security policy](../SECURITY.md) if you are writing a server or opening artifacts from strangers on the internet.

## Compatibility

MPlot 0.9.9 is pre-1.0. Producers record their version, and readers reject unsupported schemas instead of making a heroic—and potentially incorrect—guess.

The goal for 1.0 is a format that can be opened for a long time. The point of saving a scientific result is, after all, to be able to look at it later.
