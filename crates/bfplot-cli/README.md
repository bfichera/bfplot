# bfplot-cli

The `bfplot` app: opens [BFPlot](https://bfichera.github.io/bfplot/) results in your browser, and verifies, packs and unpacks them. The interactive viewer is built into the program, so it needs nothing else.

```console
$ bfplot view experiment.bfplot
$ bfplot verify experiment.bfplot
$ bfplot pack experiment.bfplot shared/experiment.bfplot
```

Most people get it with `pip install bfplot`, which installs this app together with the Python library that writes results. You can also install the app on its own:

```console
$ pip install bfplot-cli      # or: uv tool install bfplot-cli
$ cargo install bfplot-cli
```

See the [command reference](https://bfichera.github.io/bfplot/reference/cli/).

Licensed under either the Apache License, Version 2.0, or the MIT license, at your option.
