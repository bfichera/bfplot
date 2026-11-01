# Your first BFPlot

## Save a figure

```python
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

## Compare it

Every result has a hash. Saving the same figure again gives the same hash; any change to the plot or its data gives a different one:

```python
bfplot.hash("results/sine_wave.bfplot")  # 'sha256:...'
bfplot.same(fig, "results/sine_wave.bfplot")  # True
```

```console
$ bfplot hash results/sine_wave.bfplot
```

See [Comparing results](../guides/comparing.md).

## Which figures are saved?

Pass the figure explicitly. Without one, BFPlot saves every open figure as one result:

```python
bfplot.savefig("all_my_figures.bfplot")
```

To save several figures with names, use [`bfplot.result()`](../reference/python-api.md#bfplotresult).
