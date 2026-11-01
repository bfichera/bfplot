# BFPlot architecture

BFPlot turns plots into self-contained, content-addressed results that a browser viewer can open. A result holds only what is needed to draw it, and is identified by one hash.

## Pipeline

```text
plotting library -> adapter -> BFIR -> writer -> result -> Rust CLI -> viewer
```

`bfplot.savefig()` is `bfplot.translate()` followed by `bfplot.compile()`.

| Part | Location | Responsibility |
| --- | --- | --- |
| Adapter | `src/bfplot/adapters/matplotlib.py` | Matplotlib figures to BFIR. Knows nothing about hashes, compression or files. |
| BFIR | `src/bfplot/bfir.py`, `src/bfplot/bfir.schema.json` | The language-neutral document model and its validator. |
| Writer | `src/bfplot/artifact.py` | Validates BFIR, encodes buffers, computes the hash, writes, reads and verifies results. Knows nothing about Matplotlib. |
| Preview | `src/bfplot/preview.py` | Draws BFIR as Braille/ASCII text, appended to the manifest as TOML comments. |
| Results | `src/bfplot/result.py`, `src/bfplot/temporal.py` | `bfplot.result()` and animation recording. |
| Core | `crates/bfplot-core` | Reads, validates, verifies and compares results. |
| App | `crates/bfplot-cli` | The `bfplot` program: `hash`, `compare`, `verify`, `manifest`, `serve`, `view`. Embeds the viewer. |
| Viewer | `viewer/` | Browser UI and renderers. The built copy in `viewer/dist` is committed and compiled into the app. |

## BFIR

BFIR is the boundary that other producers (Julia, C, ...) target. A BFIR document has a `document` of figures, axes and artists, and typed numeric `buffers`. It has no metadata. Arrays in the document are references to buffers:

```json
{"$buffer": "buffer-0"}
```

Validation checks unique IDs, unique non-empty figure names, artist ownership, parent axes and colorbar references, timeline updates, and that every buffer reference resolves and every buffer is used. BFIR never contains hashes, codecs or paths.

An animation is one initial scene plus a timeline of frames. Each update names a `figure`, `axes` or `artist` target by ID and a path whose first element is in `bfir.ANIMATABLE` (mirrored by `animatable()` in Rust). Structure cannot change during an animation.

## Results

One output path holds exactly one result. It is written exactly as given, and objects are never shared between results.

A result is a directory:

```text
<path>/manifest.toml
<path>/.gitignore                      /objects/
<path>/objects/sha256/<2 hex>/<digest>
```

The manifest is TOML:

```toml
format = "bfplot"
version = 2
hash = "sha256:<hex>"
```

These are the only keys; unknown keys are rejected. The Python writer ends the manifest with a text drawing of the figures in `#` comments. It does not affect parsing, the hash or the format version.

`format` and `version` always come first. `version` is the format version (currently 2, `FORMAT_VERSION` in `artifact.py` and `format.rs`); it is raised whenever a change would make an older reader misread a result. Readers reject newer versions with an "update bfplot" error, and version 1 (which carried provenance and hashed compressed array bytes) with a "save it again" error, before looking at anything else.

The document object is canonical JSON (sorted keys, compact separators, UTF-8, finite numbers), named by the SHA-256 of those bytes. Arrays are little-endian and C-ordered, referenced as `{"object": "sha256:<hex>", "dtype": "f8", "shape": [N], "codec": "zstd"}`, and named by the SHA-256 of their **raw, uncompressed** bytes; the stored object is compressed with zstd (or stored as is with codec `none`). Identical arrays are stored once.

### The hash

`hash` in the manifest is the digest of the document. Since the document names every array by digest, dtype and shape, the hash covers the entire result: equal hashes mean identical results, and it does not depend on the compressor, the preview, the machine or the time of writing. Nothing nondeterministic (timestamps, paths, users, versions) is ever written, so the same figures always give byte-identical results. `bfplot.hash(figure)` computes the hash without writing. `bfplot compare` (`compare.rs`) explains a difference by diffing the two documents, comparing arrays by digest.

Writing builds the new result in a hidden sibling and swaps it in only when complete. An existing BFPlot result or an empty directory at the path is replaced; anything else raises `FileExistsError` before any expensive work starts.

## Artists

Every artist has `type`, `id`, `axes_id`, `props` and `data`. Types use the `bfplot.*` namespace and are implemented in-tree: line, scatter, image, errorbar, fill_between, histogram, contour, contourf, text, patch, line3d, scatter3d, surface3d and mesh3d. The viewer shows a visible placeholder for anything it cannot draw.

## Distribution

The result format is the contract between writers and the app. Writers are native to their language (the Python writer never calls Rust) and only need to produce valid results; the `bfplot` app reads them.

Each GitHub release carries macOS and Linux archives of the app, with `install.sh` and `uninstall.sh` for installing them with curl. The Python writer is installed from a checkout or straight from GitHub. `crates/bfplot-cli/pyproject.toml` lets pip build the app from source (maturin, `bindings = "bin"`) and put it next to the Python package. `bfplot.show()` looks for the app in its Python environment's scripts directory before `PATH`.

The viewer is compiled into the app by `crates/bfplot-cli/build.rs` from `viewer/dist`. `--viewer-dir` (or `BFPLOT_VIEWER_DIR`) serves a different build for viewer development. Releasing is described in `RELEASING.md`.

## Safety

Results contain data, never code, and cannot load renderers. Array sizes are checked before decompression and object digests are verified before use.
