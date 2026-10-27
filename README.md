# MPlot

> **[Read the documentation →](https://mplot-dev.github.io/mplot/)**

MPlot saves Matplotlib figures as interactive results. You can zoom, pan and inspect your data later, or hand it to someone else, instead of keeping only a static PNG.

```python
import matplotlib.pyplot as plt
import mplot

fig, ax = plt.subplots()
ax.plot([1, 2, 3, 4], [1, 4, 9, 16], marker="o")

mplot.savefig("my_plot.mplot", fig)
```

```console
$ mplot view my_plot.mplot
```

MPlot 0.9.9 is the release candidate for 1.0. Please try it on real plots and tell us what behaves strangely.

## Installation

Install from a source checkout. You need Python 3.10+ and Rust.

```console
$ git clone https://github.com/mplot-dev/mplot.git
$ cd mplot
$ python -m pip install -e .
$ cargo install --path crates/mplot-cli
```

The viewer is in `viewer/dist`. Outside the repository, point the CLI at it with `--viewer-dir` or `MPLOT_VIEWER_DIR`.

## Results

Each output is one result: the figures saved together, an optional animation, and metadata.

```python
with mplot.result("results/fit.mplot") as result:
    result.add(fig_spectrum, name="spectrum")
    result.add(fig_residuals, name="residuals")
    result.metadata["chi2"] = chi2
```

`add()` captures a figure as it is at that moment. Nothing is written until the block ends, and nothing at all if it raises.

By default a result is a small directory. Its own `.gitignore` keeps the data out of Git, so committing it commits only the manifest:

```text
results/fit.mplot/
├── manifest.toml
├── .gitignore
└── objects/
```

Pass `layout="file"` for one packed file instead. `mplot pack` and `mplot unpack` convert between the two.

The path is used exactly as given (MPlot warns if it does not end in `.mplot`). An existing result at the path is replaced; anything else raises `FileExistsError` before any work is done.

## Animations

```python
with mplot.animation("wave.mplot", fig, fps=30) as recording:
    for phase in np.linspace(0, 2 * np.pi, 180, endpoint=False):
        line.set_ydata(np.sin(x + phase))
        recording.capture()
```

Only what changes between frames is stored. Update existing artists rather than adding or removing them.

## Provenance

Every result records its creation time and, when available, the Git commit that produced it. By default MPlot also records versions, the platform, the command line, the script path and the working directory. Add your own values with `provenance={...}` or `result.metadata`, or pass `provenance=False` to keep only the time and commit.

## Other producers

The Matplotlib adapter produces MPlot's intermediate representation (MIR), and a separate writer turns MIR into a result:

```python
mir = mplot.translate(fig)
mplot.compile(mir, "my_plot.mplot")
```

MIR is described by `src/mplot/mir.schema.json`, so producers for other languages can target it. See [`ARCHITECTURE.md`](ARCHITECTURE.md).

## Supported plots

Lines, scatter plots, images, error bars, filled regions, histograms, contours, text, patches and common 3D plots. Anything else is shown as a visible placeholder, never silently dropped.

To see them all, run the [example gallery](examples/gallery.py): `python examples/gallery.py`, then `mplot view gallery.mplot`.

## More

- [Contributing](CONTRIBUTING.md)
- [Security policy](SECURITY.md)
- [Architecture](ARCHITECTURE.md)

## License

Apache License 2.0 or MIT License, at your option: [LICENSE-APACHE](LICENSE-APACHE), [LICENSE-MIT](LICENSE-MIT).
