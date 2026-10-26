# Welcome to MPlot!

> **[Read the full, searchable MPlot documentation →](https://mplot-dev.github.io/mplot/)**

MPlot saves Matplotlib figures as interactive files. You can zoom, pan, inspect your data, and pass the result to somebody else—without turning your beautiful plot into a sad, motionless PNG.

Here is the important part:

```python
import matplotlib.pyplot as plt
import mplot

x = [1, 2, 3, 4]
y = [1, 4, 9, 16]

fig, ax = plt.subplots()
ax.plot(x, y, marker="o")

mplot.savefig("my_plot", fig)
```

That creates `my_plot.mplot.toml`. Open it with:

```console
$ mplot view my_plot.mplot.toml
```

That’s it! If you already know Matplotlib, you already know almost everything you need to start using MPlot.

> **Current version:** MPlot 0.9.9 is our release candidate for 1.0. Please try it on real plots and tell us what behaves strangely!

## What is MPlot?

Matplotlib’s interactive window is great. You can zoom into a suspicious bump, pan across a long time trace, and inspect details that disappear in a static image. Unfortunately, the usual way to save a figure is something like this:

```python
plt.savefig("my_plot.pdf")
```

PDFs and PNGs are useful, but they only save the *picture*. MPlot saves the plot structure and numerical arrays too. The result is a real interactive scientific output that you can open later.

MPlot also records useful information about how the output was made, including the MPlot, Python, Matplotlib, NumPy, and Zstandard versions; the command-line arguments; the script path; the working directory; the platform; and the creation time. This metadata does not magically make an analysis reproducible, but it is much nicer than finding `final_plot_REAL_v2.png` six months later and having no idea where it came from.

Under the hood, MPlot uses Python to understand your Matplotlib figure, Rust to validate and serve the saved artifact, and a browser-based viewer for the graphical interface. You do not need to care about any of that to call `mplot.savefig()`.

## Installation

MPlot 0.9.9 is currently installed from a source checkout. You will need Python 3.10 or newer and a Rust toolchain.

```console
$ git clone <mplot-repository-url>
$ cd mplot
$ python -m pip install -e .
$ cargo install --path crates/mplot-cli
```

The browser viewer is included in the repository. From the repository directory, MPlot finds it automatically. If you run the CLI elsewhere, point it at the built viewer with `--viewer-dir` or set `MPLOT_VIEWER_DIR`:

```console
$ mplot view my_plot.mplot.toml --viewer-dir /path/to/mplot/viewer/dist
```

Prebuilt packages are planned for the 1.0 release. Until then, this slightly nerdier installation is the price of admission. Sorry!

## Getting started

Here is a more realistic example:

```python
import matplotlib.pyplot as plt
import numpy as np
import mplot

x = np.linspace(0, 2 * np.pi, 2_000)
y = np.sin(x)

fig, ax = plt.subplots()
ax.plot(x, y, label="signal")
ax.fill_between(x, y - 0.1, y + 0.1, alpha=0.2, label="uncertainty")
ax.set(xlabel="time (s)", ylabel="voltage (V)", title="A very scientific sine wave")
ax.legend()

output = mplot.savefig("results/sine_wave", fig)
print(f"Saved {output}")
```

Then:

```console
$ mplot view results/sine_wave.mplot.toml
```

MPlot currently understands lines, scatter plots, images, error bars, filled regions, histograms, contours, text, patches, and common 3D plots. New artist types must be implemented in MPlot itself so artifacts remain portable and use one reviewed renderer set.

### Which figure gets saved?

Pass a figure explicitly when you can:

```python
mplot.savefig("result", fig)
```

If you leave out `fig`, MPlot saves all currently open Matplotlib figures:

```python
mplot.savefig("all_my_figures")
```

Passing the figure explicitly usually makes a script easier to read, so that is what we recommend.

## Saving one file instead

The default output is split into a small manifest and a hidden object directory:

```text
results/
├── sine_wave.mplot.toml
└── .mplot/
    └── objects/
```

This layout is useful during development because the readable manifest can live in Git while the large numerical blobs can stay out of it.

If you want one file for emailing, archiving, or copying to another machine, use a `.mplot` filename:

```python
mplot.savefig("sine_wave.mplot", fig)
```

You can also convert between the two forms:

```console
$ mplot pack sine_wave.mplot.toml sine_wave.mplot
$ mplot unpack sine_wave.mplot unpacked/sine_wave.mplot.toml
```

The data hashes stay the same when you pack and unpack the artifact.

## A nice Git workflow

Commit the small manifests and ignore the object store:

```gitignore
.mplot/objects/
.mplot/cache/
```

Then a project can look like this:

```text
analysis.py
results/
└── sine_wave.mplot.toml
```

Before trusting an artifact, verify it:

```console
$ mplot verify results/sine_wave.mplot.toml
verified 12 objects (22907 bytes)
```

The SHA-256 hashes tell MPlot whether any stored bytes changed or became corrupted. They provide integrity, not proof of who created the artifact.

## Adding your own metadata

MPlot gathers basic provenance automatically. You can add the details that only *you* know:

```python
mplot.savefig(
    "results/calibration",
    fig,
    provenance={
        "sample": "crystal-17",
        "temperature_kelvin": 83.5,
        "note": "background-subtracted calibration run",
    },
)
```

To omit environment and user details while retaining the artifact's required creation timestamp:

```python
mplot.savefig("anonymous_plot", fig, provenance=False)
```

MPlot 0.9.9 records source and working-directory paths, but it does **not** copy your source code into the artifact. Full Git patches and source snapshots are planned work, not a feature we want to pretend already exists.

## Live plots

For an analysis that updates over time, save a sequence of frames:

```python
import mplot

with mplot.stream("runs/detector") as stream:
    for batch in experiment:
        update_figure(batch)
        stream.append(fig)
```

This creates an append-only `runs/detector.mplot-stream` directory with an atomic index. Readers only see completely written frames.

## What MPlot is not

MPlot is not a replacement for Matplotlib. Matplotlib still does the plotting; MPlot saves the result in a form that remains interactive.

MPlot is also not a notebook system. It is designed for ordinary Python scripts, command-line workflows, saved outputs, and version control.

Finally, provenance is not a time machine. MPlot can record useful context, but it cannot reproduce an analysis if the input data, code, or environment were never preserved. Think of it as a very helpful lab assistant—not an omniscient one.

## Where should I go next?

- Curious about the files? Read [How MPlot files work](docs/format.md).
- Need another artist type? Please propose or contribute it through [How to contribute](CONTRIBUTING.md).
- Want to help? Wonderful! Read [How to contribute](CONTRIBUTING.md).
- Found a security problem? Please read the [security policy](SECURITY.md).
- Working on MPlot itself? The precise internal contract lives in [`ARCHITECTURE.md`](ARCHITECTURE.md).

## License

MPlot is available under either the [Apache License 2.0](LICENSE-APACHE) or the [MIT License](LICENSE-MIT), at your option.
