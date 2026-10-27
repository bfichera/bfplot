# Your first MPlot

## Save a figure

```python title="analysis.py"
import matplotlib.pyplot as plt
import numpy as np
import mplot

x = np.linspace(0, 2 * np.pi, 2_000)
y = np.sin(x)

fig, ax = plt.subplots()
ax.plot(x, y, label="signal")
ax.fill_between(x, y - 0.1, y + 0.1, alpha=0.2, label="uncertainty")
ax.set(xlabel="time (s)", ylabel="voltage (V)", title="Sine wave")
ax.legend()

output = mplot.savefig("results/sine_wave.mplot", fig)
print(f"Saved {output}")
```

```console
$ python analysis.py
Saved results/sine_wave.mplot
```

## Open it

```console
$ mplot view results/sine_wave.mplot
```

This starts a local server, bound to your own machine, and opens the viewer in your browser.

## Add context

MPlot records [provenance](../guides/provenance.md) automatically. Add the details only you know:

```python
mplot.savefig(
    "results/sine_wave.mplot",
    fig,
    provenance={"sample": "crystal-17", "temperature_kelvin": 83.5},
)
```

`provenance=False` keeps only the creation time and Git commit.

## Which figures are saved?

Pass the figure explicitly. Without one, MPlot saves every open figure as one result:

```python
mplot.savefig("all_my_figures.mplot")
```

To save several figures with names, use [`mplot.result()`](../reference/python-api.md#mplotresult).

## One file instead of a directory

```python
mplot.savefig("sine_wave.mplot", fig, layout="file")
```

See [Choosing a file type](../guides/file-types.md).
