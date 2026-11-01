# BFPlot

> **[Read the documentation →](https://bfichera.github.io/bfplot/)**

BFPlot is a language-independent format for interactive plots: it defines its own graphics representation (BFIR) and a viewer for it, so plots can be zoomed, panned and inspected later, or handed to someone else, instead of keeping only a static PNG. The Python package binds BFPlot to Matplotlib, so you can save Matplotlib figures directly.

```python
import matplotlib.pyplot as plt
import bfplot

fig, ax = plt.subplots()
ax.plot([1, 2, 3, 4], [1, 4, 9, 16], marker="o")

bfplot.savefig("my_plot.bfplot", fig)
```

```console
$ bfplot view my_plot.bfplot
```

BFPlot is new. Please try it on real plots and tell us what behaves strangely.

## Installation

Install the `bfplot` app, which opens results and has the viewer built in, on macOS or Linux:

```console
$ curl -LsSf https://github.com/bfichera/bfplot/releases/latest/download/install.sh | sh
```

Then install the Python library (Python 3.10+) from GitHub:

```console
$ python -m pip install "bfplot @ git+https://github.com/bfichera/bfplot"
```

See [Installation](https://bfichera.github.io/bfplot/getting-started/installation/) for uninstalling and other options.

## Results

Each output is one result: the figures saved together and an optional animation. A result holds the objects and data needed to draw the plots, and nothing else: no timestamps, paths, user names or other metadata.

```python
with bfplot.result("results/fit.bfplot") as result:
    result.add(fig_spectrum, name="spectrum")
    result.add(fig_residuals, name="residuals")
```

`add()` captures a figure as it is at that moment. Nothing is written until the block ends, and nothing at all if it raises.

A result is a small directory. Its own `.gitignore` keeps the data out of Git, so committing it commits only the manifest:

```text
results/fit.bfplot/
├── manifest.toml
├── .gitignore
└── objects/
```

By default, `manifest.toml` ends with a rough ASCII/Braille drawing of each figure, written as `#` comments. It lets you see the plot in a diff or commit without opening the viewer. It is only a preview: it does not affect parsing or the hash, and the real data lives in `objects/`. Pass `preview=False` to leave it out.

The path is used exactly as given (BFPlot warns if it does not end in `.bfplot`). An existing result at the path is replaced; anything else raises `FileExistsError` before any work is done.

## Animations

```python
with bfplot.animation("wave.bfplot", fig, fps=30) as recording:
    for phase in np.linspace(0, 2 * np.pi, 180, endpoint=False):
        line.set_ydata(np.sin(x + phase))
        recording.capture()
```

Only what changes between frames is stored. Update existing artists rather than adding or removing them.

## Hashes

Every result has one hash, recorded in its manifest. Two results have the same hash exactly when everything in them is identical: every figure, axis, artist, style, animation frame and array. Saving the same figures twice gives the same hash on any machine, since nothing about the machine, time or user is stored. (Different Matplotlib versions may lay out the same script slightly differently; the hash then changes, because the plots really differ.)

```python
bfplot.hash("results/fit.bfplot")         # 'sha256:769fe097...'
bfplot.hash(fig)                           # the same figure, hashed without writing
bfplot.same("old/fit.bfplot", "new/fit.bfplot")
bfplot.verify("results/fit.bfplot")        # check every object, return the hash
```

```console
$ bfplot hash results/fit.bfplot
sha256:769fe0976cfeecf73414d7b467013c6cde561405bce6c5af5828836e03016e37
$ bfplot compare old/fit.bfplot new/fit.bfplot
different
  sha256:769fe097...  old/fit.bfplot
  sha256:45a78207...  new/fit.bfplot
figures[0].axes[0].title: "Tent" -> "Tall tent"
```

BFPlot records no provenance; keep track of where results came from with a separate tool, keyed by the hash.

## Other producers

The Matplotlib adapter produces BFPlot's intermediate representation (BFIR), and a separate writer turns BFIR into a result:

```python
bfir = bfplot.translate(fig)
bfplot.compile(bfir, "my_plot.bfplot")
```

BFIR is described by `src/bfplot/bfir.schema.json`, so producers for other languages can target it. See [`ARCHITECTURE.md`](https://github.com/bfichera/bfplot/blob/main/ARCHITECTURE.md).

## Serving

`bfplot view` serves a result and opens it in your browser. `bfplot serve` does the same without opening a browser. By default the server listens on `127.0.0.1:8080`; use `--port` to change the port. The viewer shows the result's hash, and the server returns it at `/hash`.

To serve remotely, bind to another address explicitly:

```console
$ bfplot serve my_plot.bfplot --bind 0.0.0.0 --port 9000
```

### Using BFPlot with psana (SLAC S3DF)

To view a result stored on psana, keep the server on loopback and reach it through an SSH tunnel. Nothing is exposed to the network.

On S3DF (`ssh <username>@s3df.slac.stanford.edu`, then to your psana node), start the server without a browser:

```console
$ bfplot serve /path/to/my_plot.bfplot --port 9000
```

On your own machine, forward the port through S3DF to the node running the server:

```console
$ ssh -L 9000:<psana-node>:9000 <username>@s3df.slac.stanford.edu
```

Then open <http://127.0.0.1:9000> in your local browser. If you run the server on the login node itself, use `localhost` in place of `<psana-node>`. Pick a port that other users are not using.

## Supported plots

Lines, scatter plots, images, error bars, filled regions, histograms, contours, text, patches and common 3D plots. Anything else is shown as a visible placeholder, never silently dropped.

To see them all, run the [example gallery](https://github.com/bfichera/bfplot/blob/main/examples/gallery.py): `python examples/gallery.py`, then `bfplot view gallery.bfplot`.

## More

- [Contributing](https://github.com/bfichera/bfplot/blob/main/CONTRIBUTING.md)
- [Architecture](https://github.com/bfichera/bfplot/blob/main/ARCHITECTURE.md)

## License

Apache License 2.0 or MIT License, at your option: [LICENSE-APACHE](https://github.com/bfichera/bfplot/blob/main/LICENSE-APACHE), [LICENSE-MIT](https://github.com/bfichera/bfplot/blob/main/LICENSE-MIT).
