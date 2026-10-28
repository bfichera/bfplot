# bfplot-core

Reads, validates, packs and unpacks [BFPlot](https://bfichera.github.io/bfplot/) results: a `manifest.toml` plus content-addressed objects, in a directory or a single packed file. It is the library behind the `bfplot` app (`crates/bfplot-cli`).

```rust
let report = bfplot_core::verify_artifact(std::path::Path::new("experiment.bfplot"))?;
println!("verified {} objects", report.object_count);
```

The format is described in the [format reference](https://bfichera.github.io/bfplot/format/).

Licensed under either the Apache License, Version 2.0, or the MIT license, at your option.
