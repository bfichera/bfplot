# Quick start

```python
import matplotlib.pyplot as plt
import mplot

fig, ax = plt.subplots()
ax.plot([1, 2, 3, 4], [1, 4, 9, 16], marker="o")

mplot.savefig("my_plot.mplot", fig)
```

This writes a `my_plot.mplot/` result directory. Open it with:

```console
$ mplot view my_plot.mplot
```

## Next

- [Installation](installation.md): the Python package, the CLI and the viewer.
- [Your first MPlot](first-plot.md): labels, metadata and choosing what to save.
- [Choosing a file type](../guides/file-types.md): directories or single files.
- [Using MPlot with Git](../guides/version-control.md): commit manifests, not arrays.
- [Example gallery](../guides/gallery.md): every supported plot type in one result.
