# Your first BFPlot

## Save a figure

```python title="analysis.py"
import matplotlib.pyplot as plt
import numpy as np
import bfplot

x = np.linspace(0, 2 * np.pi, 2_000)
y = np.sin(x)

fig, ax = plt.subplots()
ax.plot(x, y, label="signal")
ax.fill_between(x, y - 0.1, y + 0.1, alpha=0.2, label="uncertainty")
ax.set(xlabel="time (s)", ylabel="voltage (V)", title="Sine wave")
ax.legend()

output = bfplot.savefig("results/sine_wave.bfplot", fig)
print(f"Saved {output}")
```

```console
$ python analysis.py
Saved results/sine_wave.bfplot
```

## Open it

```console
$ bfplot view results/sine_wave.bfplot
```

This starts a local server, bound to your own machine, and opens the viewer in your browser.

## Add context

BFPlot records [provenance](../guides/provenance.md) automatically. Add the details only you know:

```python
bfplot.savefig(
    "results/sine_wave.bfplot",
    fig,
    provenance={"sample": "crystal-17", "temperature_kelvin": 83.5},
)
```

`provenance=False` keeps only the creation time and Git commit.

## Which figures are saved?

Pass the figure explicitly. Without one, BFPlot saves every open figure as one result:

```python
bfplot.savefig("all_my_figures.bfplot")
```

To save several figures with names, use [`bfplot.result()`](../reference/python-api.md#bfplotresult).

## One file instead of a directory

```python
bfplot.savefig("sine_wave.bfplot", fig, layout="file")
```

See [Choosing a file type](../guides/file-types.md).
