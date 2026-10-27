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

mplot.savefig("my_plot.mplot", fig)
```

That creates a `my_plot.mplot/` result directory. Open it with:

```console
$ mplot view my_plot.mplot
```

That’s it! If you already know Matplotlib, you already know almost everything you need to start using MPlot.

> **Current version:** MPlot 0.9.9 is our release candidate for 1.0. Please try it on real plots and tell us what behaves strangely!

## What is MPlot?

Matplotlib’s interactive window is great. You can zoom into a suspicious bump, pan across a long time trace, and inspect details that disappear in a static image. Unfortunately, the usual way to save a figure is something like this:

```python
plt.savefig("my_plot.pdf")
```

PDFs and PNGs are useful, but they only save the *picture*. MPlot saves the plot structure and numerical arrays too. The result is a real interactive scientific output that you can open later.

MPlot also records useful information about how the output was made, including the MPlot, Python, Matplotlib, NumPy, and Zstandard versions; the command-line arguments; the script path; the working directory; the platform; the creation time; and, when available, the Git commit that produced the artifact. This metadata does not magically make an analysis reproducible, but it is much nicer than finding `final_plot_REAL_v2.png` six months later and having no idea where it came from.

Under the hood, the Python Matplotlib adapter translates a figure into MPlot's language-neutral intermediate representation (MIR), and the compiler turns validated MIR into the content-addressed artifact that Rust validates and serves to the browser viewer. You do not need to care about any of that to call `mplot.savefig()`.

The boundary is public when you do need it:

```python
mir = mplot.translate(fig)       # Matplotlib -> generic MIR
mplot.compile(mir, "my_plot.mplot")   # generic MIR -> artifact
```

Adapters never handle hashes, compression, manifests, object stores, or packing. The compiler never imports or understands Matplotlib, which makes MIR the common target for future R, Julia, and other producers.

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
$ mplot view my_plot.mplot --viewer-dir /path/to/mplot/viewer/dist
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

output = mplot.savefig("results/sine_wave.mplot", fig)
print(f"Saved {output}")
```

Then:

```console
$ mplot view results/sine_wave.mplot
```

MPlot uses the path exactly as you give it. If the name does not end in `.mplot`, MPlot warns you but still writes exactly that path. Saving again replaces an existing MPlot result at the same path, so a long script never fails at the very end because last week's output is in the way. If something else lives there—say, a folder of your own files—MPlot refuses to touch it and raises `FileExistsError` before doing any expensive work.

MPlot currently understands lines, scatter plots, images, error bars, filled regions, histograms, contours, text, patches, and common 3D plots. New artist types must be implemented in MPlot itself so artifacts remain portable and use one reviewed renderer set.

### Which figure gets saved?

Pass a figure explicitly when you can:

```python
mplot.savefig("result.mplot", fig)
```

If you leave out `fig`, MPlot saves all currently open Matplotlib figures:

```python
mplot.savefig("all_my_figures.mplot")
```

Passing the figure explicitly usually makes a script easier to read, so that is what we recommend.

## Several figures in one result

One output holds one result: every figure you save together, an optional animation, and your metadata. Use `mplot.result()` to build one up step by step:

```python
with mplot.result("results/fit.mplot") as result:
    result.add(fig_spectrum, name="spectrum")
    result.add(fig_residuals, name="residuals")
    result.metadata["chi2"] = chi2
```

`add()` captures the figure as it looks at that moment. Nothing is written until the `with` block ends, and if the block raises an error, nothing is written at all. Names must be unique within a result; the viewer uses them as headings for figures without a title.

## Saving one file instead

By default, a result is a small directory:

```text
results/
└── sine_wave.mplot/
    ├── manifest.toml
    ├── .gitignore
    └── objects/
```

Everything belongs to this one result, so copying, zipping, or deleting the folder copies, zips, or deletes the whole thing.

If you want one file for emailing, archiving, or copying to another machine, ask for the file layout:

```python
mplot.savefig("sine_wave.mplot", fig, layout="file")
```

You can also convert between the two forms:

```console
$ mplot pack results/sine_wave.mplot shared/sine_wave.mplot
$ mplot unpack shared/sine_wave.mplot restored/sine_wave.mplot
```

The data hashes stay the same when you pack and unpack the result.

## A nice Git workflow

No `.gitignore` setup is needed. MPlot writes a `.gitignore` inside each result directory that ignores its `objects/`, so:

```console
$ git add results/
```

stages only the small, readable manifests. A project can look like this:

```text
analysis.py
results/
└── sine_wave.mplot/
    └── manifest.toml
```

Git keeps the manifest but not the numerical data, so a fresh clone has manifests without data. Re-run your analysis, or share the result directory or a packed file another way.

Before trusting a result, verify it:

```console
$ mplot verify results/sine_wave.mplot
verified 12 objects (22907 bytes)
```

The SHA-256 hashes tell MPlot whether any stored bytes changed or became corrupted. They provide integrity, not proof of who created the artifact.

## Adding your own metadata

MPlot gathers basic provenance automatically. You can add the details that only *you* know:

```python
mplot.savefig(
    "results/calibration.mplot",
    fig,
    provenance={
        "sample": "crystal-17",
        "temperature_kelvin": 83.5,
        "note": "background-subtracted calibration run",
    },
)
```

To omit environment and user details while retaining baseline processing metadata (creation time and the producing Git commit when available):

```python
mplot.savefig("anonymous_plot.mplot", fig, provenance=False)
```

MPlot 0.9.9 records source and working-directory paths, but it does **not** copy your source code into the artifact. Full Git patches and source snapshots are planned work, not a feature we want to pretend already exists.

## Animated plots

Record changes to an existing Matplotlib figure as one interactive temporal artifact:

```python
import numpy as np
import matplotlib.pyplot as plt
import mplot

x = np.linspace(0, 2 * np.pi, 500)
fig, ax = plt.subplots()
line, = ax.plot(x, np.sin(x))

with mplot.animation("wave.mplot", fig, fps=30) as recording:
    for phase in np.linspace(0, 2 * np.pi, 180, endpoint=False):
        line.set_ydata(np.sin(x + phase))
        recording.capture()
```

The artifact stores one initial scene and timestamped semantic updates rather than complete copies of every figure. Its viewer provides playback, frame stepping, scrubbing, looping, and playback speed. Artists and plot structure must remain stable while recording; update existing artist data, styles, and axes state rather than adding, removing, or hiding Matplotlib objects.

For iterable-driven code, `mplot.save_animation(path, figure, frames, update, fps=...)` provides the same pipeline as a convenience function.

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
