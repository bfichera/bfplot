# BFPlot architecture

BFPlot turns plots into self-contained, content-addressed results that a browser viewer can open.

## Pipeline

```text
plotting library -> adapter -> MIR -> writer -> result -> Rust CLI -> viewer
```

`bfplot.savefig()` is `bfplot.translate()` followed by `bfplot.compile()`.

| Part | Location | Responsibility |
| --- | --- | --- |
| Adapter | `src/bfplot/adapters/matplotlib.py` | Matplotlib figures to MIR. Knows nothing about hashes, compression or files. |
| MIR | `src/bfplot/mir.py`, `src/bfplot/mir.schema.json` | The language-neutral document model and its validator. |
| Writer | `src/bfplot/artifact.py` | Validates MIR, encodes buffers, writes and replaces results. Knows nothing about Matplotlib. |
| Results | `src/bfplot/result.py`, `src/bfplot/temporal.py` | `bfplot.result()` and animation recording. |
| Core | `crates/bfplot-core` | Reads, validates, verifies, packs and unpacks results. |
| CLI | `crates/bfplot-cli` | `verify`, `pack`, `unpack`, `manifest`, `serve`, `view`. |
| Viewer | `viewer/` | Browser UI and renderers. The built copy in `viewer/dist` is committed. |

## MIR

MIR is the boundary that other producers (Julia, C, ...) target. A MIR document has `metadata` (with a required `created_utc`), a `document` of figures, axes and artists, and typed numeric `buffers`. Arrays in the document are references to buffers:

```json
{"$buffer": "buffer-0"}
```

Validation checks unique IDs, unique non-empty figure names, artist ownership, parent axes and colorbar references, timeline updates, and that every buffer reference resolves and every buffer is used. MIR never contains hashes, codecs or paths.

An animation is one initial scene plus a timeline of frames. Each update names a `figure`, `axes` or `artist` target by ID and a path whose first element is in `mir.ANIMATABLE` (mirrored by `animatable()` in Rust). Structure cannot change during an animation.

## Results

One output path holds exactly one result. It is written exactly as given, and objects are never shared between results.

A directory result:

```text
<path>/manifest.toml
<path>/.gitignore                      /objects/
<path>/objects/sha256/<2 hex>/<digest>
```

A packed result (`layout="file"`) is one file: the magic `BFPLOT\0\0`, a u64 manifest length, the manifest, a u64 object count, then for each object its 32-byte SHA-256 digest, a u64 length and its bytes. Integers are little-endian and objects are sorted by digest, so packing is deterministic and both layouts convert losslessly.

The manifest is TOML:

```toml
format = "bfplot"
document = "sha256:<hex>"

[provenance]
created_utc = "2026-01-01T00:00:00Z"
```

Every object is named by the SHA-256 of its exact bytes. The document object is canonical JSON (sorted keys, compact separators, finite numbers). Arrays are little-endian, C-ordered and zstd-compressed, referenced as `{"object": "sha256:<hex>", "dtype": "f8", "shape": [N], "codec": "zstd"}`.

Writing builds the new result in a hidden sibling and swaps it in only when complete. An existing BFPlot result (either layout) or an empty directory at the path is replaced; anything else raises `FileExistsError` before any expensive work starts.

## Artists

Every artist has `type`, `id`, `axes_id`, `props` and `data`. Types use the `bfplot.*` namespace and are implemented in-tree: line, scatter, image, errorbar, fill_between, histogram, contour, contourf, text, patch, line3d, scatter3d, surface3d and mesh3d. The viewer shows a visible placeholder for anything it cannot draw.

## Safety

Results contain data, never code, and cannot load renderers. Object digests are verified before decoding. The server binds to loopback unless told otherwise.
