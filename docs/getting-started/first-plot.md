# Your first MPlot

Let’s make a slightly more realistic figure: a sine wave with an uncertainty band. Very scientific.

## 1. Make the Matplotlib figure

```python title="analysis.py"
import matplotlib.pyplot as plt
import numpy as np
import mplot

x = np.linspace(0, 2 * np.pi, 2_000)
y = np.sin(x)

fig, ax = plt.subplots()
ax.plot(x, y, label="signal")
ax.fill_between(
    x,
    y - 0.1,
    y + 0.1,
    alpha=0.2,
    label="uncertainty",
)
ax.set(
    xlabel="time (s)",
    ylabel="voltage (V)",
    title="A very scientific sine wave",
)
ax.legend()

output = mplot.savefig("results/sine_wave.mplot", fig)
print(f"Saved {output}")
```

Run it like any ordinary Python script:

```console
$ python analysis.py
Saved results/sine_wave.mplot
```

## 2. Open the saved plot

```console
$ mplot view results/sine_wave.mplot
```

MPlot starts a small local server and opens the viewer in your browser. The server binds to your own machine by default; it does not publish the plot to the internet.

## 3. Add useful scientific context

MPlot records basic provenance automatically. Add the experimental details that only you know:

```python
mplot.savefig(
    "results/sine_wave.mplot",
    fig,
    provenance={
        "sample": "crystal-17",
        "temperature_kelvin": 83.5,
        "note": "background-subtracted calibration run",
    },
)
```

If you do not want provenance for a particular output:

```python
mplot.savefig("anonymous_plot.mplot", fig, provenance=False)
```

## Which figure gets saved?

Passing the figure explicitly is clearest:

```python
mplot.savefig("result.mplot", fig)
```

If you leave it out, MPlot saves all currently open Matplotlib figures:

```python
mplot.savefig("all_my_figures.mplot")
```

That can be convenient, but explicit figure arguments usually make analysis scripts easier to understand later.

## One file or a Git-friendly output?

The example above creates a result directory, `results/sine_wave.mplot/`. To save one portable file instead, pass `layout="file"`:

```python
mplot.savefig("sine_wave.mplot", fig, layout="file")
```

Read [Choosing a file type](../guides/file-types.md) for the tradeoff. The short answer is: directories while you work, single files when you share.
