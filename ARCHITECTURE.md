# MPlot architecture contract

MPlot 0.9.9 is a script-first, content-addressed interactive scientific plot system.

## Stable artifact layout

A split artifact consists of a UTF-8 TOML manifest (`*.mplot.toml`) and immutable blobs in `.mplot/objects/sha256/<first-two>/<digest>`. Every blob is addressed by SHA-256 of its exact stored bytes. Packed artifacts (`*.mplot`) preserve the same manifest and blob identities.

The manifest owns provenance and references one document blob. The document is JSON and contains figures, axes, artists, links, selections, and references to typed array blobs. JSON is used in 0.9.9 to keep the pre-1.0 format inspectable. Canonical JSON (recursive key sorting, compact separators, finite numbers) is required for hashes.

## Artist protocol

Every artist has `type`, `schema_version`, `id`, `axes_id`, `props`, and `data`. Supported types use the `mplot.*` namespace and must be implemented in-tree. Data values can contain inline JSON or array references of the form `{ "object": "sha256:<hex>", "dtype": "f8", "shape": [N], "codec": "zstd" }`.

Required built-ins: line, scatter, image, errorbar, fill_between, histogram, contour, contourf, text, patch, line3d, scatter3d, surface3d and mesh3d. The viewer must visibly degrade for unknown artists.

## Safety

Artifacts never embed executable Python/native code and cannot install or load artist implementations. Remote serving binds to loopback unless explicitly overridden. Paths are normalized and object digests are verified before decode.

## Ownership for parallel implementation

- Rust: format/store, validation, pack/unpack, verify, serve, stream primitives and CLI.
- Python: Matplotlib extraction, provenance, typed-array encoding and public API.
- Viewer: dependency-light browser UI and renderers.
- Integration: fixtures, tests, docs and packaging.
