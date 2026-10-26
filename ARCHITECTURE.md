# MPlot architecture contract

MPlot 0.9.9 is a script-first, content-addressed interactive scientific plot system.

## Production pipeline

There is one production path:

```text
Matplotlib -> MPlot Intermediate Representation (MIR) -> compiler -> artifact
```

`mplot.savefig()` is the convenience composition of `mplot.translate()` and `mplot.compile()`.

### Source adapters

Source adapters understand their plotting library and produce MIR. The Matplotlib adapter lives in `src/mplot/adapters/matplotlib.py`. An adapter may resolve source transforms, geometry, styles, and source-object relationships, but it must not import or understand content stores, hashes, compression, manifests, packing, or artifact array references.

### MIR

MIR is the language-neutral producer/compiler boundary. It has its own version (`mir_version = "1.0"`) independently of the artifact version. Its structural contract is published as JSON Schema 2020-12 in `src/mplot/mir-1.schema.json`; `src/mplot/mir.py` implements the in-process Python model and semantic validator.

A MIR document contains semantic figure, axes, artist, layout, scale, guide, and relationship records. Large numerical values are local typed buffers referenced as:

```json
{"$buffer": "buffer-0"}
```

The in-process Python producer uses immutable contiguous NumPy buffers. Other language producers can implement the same typed-buffer contract with native arrays or a portable interchange such as Arrow IPC. MIR never contains artifact object IDs, codecs, paths, or packing details.

MIR validation is mandatory. It checks its version, required processing metadata, unique IDs, axes/artist ownership, parent relationships, colorbar-to-mappable references, and local buffer references. Required processing metadata always includes `created_utc`. When the producer runs from a Git worktree, baseline processing metadata also records the producing `git_commit`; Git absence or lookup failure must not prevent artifact creation.

Temporal MIR uses one immutable initial scene plus a restricted timeline of stable-ID updates. Each timestamped update names a figure, axes, or artist target and an allow-listed semantic path such as `["data", "y"]`. Timeline values can reference the same local typed buffers as the initial scene. Arbitrary callbacks and unrestricted JSON Patch operations are not part of the format.

### Compiler

`src/mplot/lower.py` is the MIR compiler boundary. It validates MIR, encodes each local typed buffer into a compressed content-addressed artifact array, and emits the canonical artifact document. It does not import or understand Matplotlib. No unresolved `$buffer` reference may enter an artifact.

`src/mplot/artifact.py` owns final split/packed materialization and `src/mplot/store.py` owns content-addressed storage.

## Stable artifact layout

A split artifact consists of a UTF-8 TOML manifest (`*.mplot.toml`) and immutable blobs in `.mplot/objects/sha256/<first-two>/<digest>`. Every blob is addressed by SHA-256 of its exact stored bytes. Packed artifacts (`*.mplot`) preserve the same manifest and blob identities.

The manifest owns provenance and references one document blob. The document is JSON and contains figures, axes, artists, links, selections, and references to typed array blobs. JSON is used in 0.9.9 to keep the pre-1.0 format inspectable. Canonical JSON (recursive key sorting, compact separators, finite numbers) is required for hashes.

## Artist protocol

Every compiled artist has `type`, `schema_version`, `id`, `axes_id`, `props`, and `data`. Supported types use the `mplot.*` namespace and must be implemented in-tree. Compiled data values can contain inline JSON or array references of the form `{ "object": "sha256:<hex>", "dtype": "f8", "shape": [N], "codec": "zstd" }`.

Required built-ins: line, scatter, image, errorbar, fill_between, histogram, contour, contourf, text, patch, line3d, scatter3d, surface3d and mesh3d. The viewer must visibly degrade for unknown artists.

## Safety

Artifacts and MIR never embed executable Python/native code and cannot install or load artist implementations. Remote serving binds to loopback unless explicitly overridden. Paths are normalized and object digests are verified before decode.

## Ownership

- Producer adapters: source plotting library to MIR only.
- MIR: language-neutral semantic records, local typed buffers, schema, and validation.
- Compiler: MIR lowering, typed-array encoding, and artifact materialization.
- Rust: artifact format/store, validation, pack/unpack, verify, serve, stream primitives, and CLI.
- Viewer: dependency-light browser UI and renderers.
- Integration: fixtures, tests, docs, packaging, and visual regression coverage.
