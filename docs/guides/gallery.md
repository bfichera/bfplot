# Example gallery

`examples/gallery.py` in the repository builds seven Matplotlib figures that cover everything MPlot can save, and writes them as one result. Use it to see what the viewer can do, or as a starting point for your own scripts.

```console
$ python examples/gallery.py
Wrote gallery.mplot. Open it with: mplot view gallery.mplot
$ mplot view gallery.mplot
```

Pass a path to write somewhere else, and `--packed` for a [single packed file](file-types.md) instead of a directory:

```console
$ python examples/gallery.py shared/gallery.mplot --packed
```

## What's in it

| Figure | Shows |
| --- | --- |
| `core-artists` | Lines, markers, filled bands, scalar scatter with a colorbar, error bars, a histogram and labelled bars. **Animated:** the sine wave travels. |
| `scalar-fields` | A raster image, contour lines, filled contours, vertical and horizontal colorbars, and equal-aspect paths. **Animated:** the image scrolls. |
| `scales-and-time` | Log–log, semilog and symmetric-log axes, a date axis, inverted limits, and custom TeX tick labels. |
| `layout-and-patches` | An irregular grid layout, a shared y axis, rectangle, circle and polygon patches, and text. |
| `three-dimensions` | A 3D line, a scalar 3D scatter, a surface and a wire mesh. Drag to rotate them. |
| `dense-data` | A 220,000-point line, a 65,000-point scatter, a long random walk and a large image, for trying panning and zooming with real amounts of data. |
| `dashboard` | Thirty small panels sharing an x axis. |

The figure names come from `name=`; the headings in the viewer come from each figure's `suptitle()`.

## How it works

Each figure is built by its own function, from one seeded random generator, so the data are the same on every run. Set `SOURCE_DATE_EPOCH` to fix the provenance timestamp too.

`write_gallery()` shows the main parts of the Python API in one place:

- [`mplot.result()`](../reference/python-api.md) collects every figure into one output, and adds `example` and `seed` to the [provenance](provenance.md).
- `result.animation()` records the first two figures as an animation. Each `capture()` saves the figures as they are at that moment.
- `result.add()` adds the other five figures as static plots.

??? example "Full source of `examples/gallery.py`"

    ```python
    --8<-- "examples/gallery.py"
    ```
