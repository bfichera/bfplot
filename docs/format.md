# MPlot 0.9.9 artifact format

This guide expands the invariants in [`ARCHITECTURE.md`](../ARCHITECTURE.md). The architecture contract takes precedence if this guide and the contract disagree.

MPlot is pre-1.0. Producers should record their format version, and consumers should reject unsupported major or schema versions rather than guessing.

## Split artifacts

A split artifact has a UTF-8 TOML manifest named `*.mplot.toml`. Objects shared by artifacts live below the artifact workspace:

```text
.mplot/objects/sha256/<first-two-hex-digits>/<64-hex-digit-digest>
```

The filename is the lowercase SHA-256 digest of the object's **exact stored bytes**. Compression is part of those bytes: verification occurs before decompression or decoding. An existing object at a digest path is immutable and must never be silently replaced with different bytes.

Paths read from manifests or archives must be normalized and confined to their intended root. Consumers must reject traversal, absolute-path injection, malformed digests, and links that escape the object store.

## Manifest and document

The manifest owns artifact-level provenance and references exactly one document object. The document is UTF-8 JSON containing figures, axes, artists, links, selections, plugin requirements, and typed-array references.

Whenever JSON bytes participate in identity, they are canonicalized using:

- recursively sorted object keys;
- compact separators (no insignificant whitespace);
- finite JSON numbers only;
- deterministic UTF-8 serialization.

NaN and positive or negative infinity are not valid JSON values. Producers must encode missing or exceptional scientific values according to the applicable artist/array schema rather than emitting non-standard JSON.

## Artists

Every artist object has these fields:

| Field | Meaning |
| --- | --- |
| `type` | Artist type. Built-ins begin with `mplot.`; plugins use reverse-DNS names. |
| `schema_version` | Version of this artist's data and property schema. |
| `id` | Stable identifier within the document. |
| `axes_id` | Identifier of the owning axes. |
| `props` | Rendering properties. |
| `data` | Inline JSON values and/or typed-array references. |

The required built-ins are line, scatter, image, errorbar, fill-between, histogram, contour, filled contour, text, patch, 3D line, 3D scatter, surface, and 3D mesh artists. Consumers should preserve artists they do not understand and must show a visible unsupported-artist placeholder rather than silently omitting them.

## Typed arrays

Array data may be referenced as:

```json
{
  "object": "sha256:<64 lowercase hexadecimal digits>",
  "dtype": "f8",
  "shape": [1024],
  "codec": "zstd"
}
```

`object` identifies the exact stored bytes. `dtype`, `shape`, and `codec` describe safe decoding. Decoders must validate these values, apply allocation and decompression limits, verify that decoded byte length agrees with dtype and shape, and fail closed on overflow or mismatch.

## Packed artifacts

A `*.mplot` packed artifact carries the same manifest, document, and content-addressed object identities as the split representation. Packing must not alter object contents or hashes. Unpacking must validate all entry paths and digests before making data available.

A split-to-packed-to-split round trip is semantically lossless: verification of the same manifest and referenced objects must produce the same identities.

## Provenance and trust

Provenance is metadata, not proof. Digests detect accidental or malicious byte changes after identity is established, but do not establish who created an artifact. Applications needing authenticity should sign and distribute the artifact through a trusted mechanism external to the 0.9.9 format.

Artifacts do not contain executable Python or native code. Plugin requirements name separately installed viewer software; they do not authorize fetching or executing it.
