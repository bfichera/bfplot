# Quick start

You have a Matplotlib figure. You want to save it without throwing away everything interactive about it. Excellent—you are in the right place.

## Save a figure

```python
import matplotlib.pyplot as plt
import mplot

fig, ax = plt.subplots()
ax.plot([1, 2, 3, 4], [1, 4, 9, 16], marker="o")

mplot.savefig("my_plot.mplot", fig)
```

MPlot creates a `my_plot.mplot/` result directory. Open it with:

```console
$ mplot view my_plot.mplot
```

You now have a saved plot that can still zoom and pan. Not bad for one new line!

## Where to go next

<div class="grid cards" markdown>

-   :material-download-circle:{ .lg .middle } **Install MPlot**

    ---

    Set up the Python package, Rust CLI, and browser viewer.

    [:octicons-arrow-right-24: Installation](installation.md)

-   :material-chart-line:{ .lg .middle } **Make a real plot**

    ---

    Add labels, uncertainty, metadata, and save the result.

    [:octicons-arrow-right-24: Your first MPlot](first-plot.md)

-   :material-file-tree:{ .lg .middle } **Choose an output style**

    ---

    Learn when to keep a result directory and when to save one file.

    [:octicons-arrow-right-24: Choosing a file type](../guides/file-types.md)

-   :material-git:{ .lg .middle } **Put results in Git**

    ---

    Commit small manifests while large arrays stay out of the repository.

    [:octicons-arrow-right-24: Version control](../guides/version-control.md)

</div>
