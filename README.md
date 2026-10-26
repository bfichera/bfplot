# MPlot

MPlot is a script-first, content-addressed format and viewer for interactive scientific plots. It records a plot as inspectable metadata plus immutable data blobs so the result can be verified, moved, packed, and viewed without executing the script that produced it.

> **Status:** MPlot 0.9.9 is pre-1.0. The format is usable for development, but compatibility may change between minor releases.

## Why MPlot?

- **Inspectability:** plot structure is canonical JSON and artifact metadata is TOML.
- **Reproducibility:** every stored object is identified by the SHA-256 digest of its exact bytes.
- **Safety:** artifacts contain data, not executable Python or native code.
- **Portability:** keep a split artifact under version control or pack it into one `*.mplot` file.
- **Extensibility:** built-in artists cover common 2D and 3D plots; explicitly installed viewer plugins can add namespaced artist types.

## Artifact forms

A split artifact consists of:

```text
experiment.mplot.toml
.mplot/objects/sha256/ab/abcdef...   # immutable content-addressed blobs
```

A packed artifact (`experiment.mplot`) preserves the same manifest and object identities in one file. See [the format guide](docs/format.md) for the normative 0.9.9 invariants.

## Getting started

MPlot is a mixed Rust, Python, and browser project. Until prebuilt packages are published, install or run each component from a source checkout.

```sh
# Rust CLI
cargo run -p mplot-cli -- --help

# Python package (when working on Python extraction)
python -m pip install -e .

# Run repository-wide smoke checks
./scripts/smoke.sh
```

Use `mplot --help` for the commands supported by your build. A normal workflow is to export a Matplotlib figure from Python, verify the resulting artifact with the CLI, and serve or open it in the browser viewer. Because the public interfaces are evolving before 1.0, command help and package docstrings are the source of truth for exact invocation syntax.

## Security model

Opening an artifact must not execute code from it. Viewer plugins are separately installed software and should only be installed from trusted sources. Servers bind to loopback by default; exposing one on another interface is an explicit trust decision. Read [SECURITY.md](SECURITY.md) before processing untrusted artifacts or operating a public service.

## Documentation

- [Architecture contract](ARCHITECTURE.md)
- [Artifact format and invariants](docs/format.md)
- [Plugin authoring and compatibility](docs/plugins.md)
- [Contributing](CONTRIBUTING.md)
- [Security policy](SECURITY.md)

## License

MPlot is available under either the [Apache License 2.0](LICENSE-APACHE) or the [MIT License](LICENSE-MIT), at your option.
