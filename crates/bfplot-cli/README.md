# bfplot-cli

The `bfplot` app: opens [BFPlot](https://bfichera.github.io/bfplot/) results in your browser, and verifies, packs and unpacks them. The interactive viewer is built into the program, so it needs nothing else.

```console
$ bfplot view experiment.bfplot
$ bfplot verify experiment.bfplot
$ bfplot pack experiment.bfplot shared/experiment.bfplot
```

Install it on macOS or Linux from the GitHub release:

```console
$ curl -LsSf https://github.com/bfichera/bfplot/releases/latest/download/install.sh | sh
```

Or build it from a checkout with `cargo build --release -p bfplot-cli`.

See the [command reference](https://bfichera.github.io/bfplot/reference/cli/).

Licensed under either the Apache License, Version 2.0, or the MIT license, at your option.
