# bfplot-core

Reads, validates, verifies and compares [BFPlot](https://bfichera.github.io/bfplot/) results: a directory holding a `manifest.toml` plus content-addressed objects. It is the library behind the `bfplot` app (`crates/bfplot-cli`).

```rust
let report = bfplot_core::verify_artifact(std::path::Path::new("experiment.bfplot"))?;
println!("verified {} objects, hash {}", report.object_count, report.hash);
```

The format is described in the [format reference](https://bfichera.github.io/bfplot/format/).

Licensed under the MIT License.
