# Quick start

```python
import matplotlib.pyplot as plt
import bfplot

fig, ax = plt.subplots()
ax.plot([1, 2, 3, 4], [1, 4, 9, 16], marker="o")

bfplot.savefig("my_plot.bfplot", fig)
```

This writes a `my_plot.bfplot/` result directory. Open it with:

```console
$ bfplot view my_plot.bfplot
```

## Next

- [Installation](installation.md): the Python package, the CLI and the viewer.
- [Your first BFPlot](first-plot.md): labels, metadata and choosing what to save.
- [Choosing a file type](../guides/file-types.md): directories or single files.
- [Using BFPlot with Git](../guides/version-control.md): commit manifests, not arrays.
- [Example gallery](../guides/gallery.md): every supported plot type in one result.
