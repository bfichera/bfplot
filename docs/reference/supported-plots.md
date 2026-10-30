# Supported plots

BFPlot understands the common Matplotlib artists below.

| Plot | BFPlot artist | Notes |
| --- | --- | --- |
| Lines | `bfplot.line` | Coordinates, line style, markers, color, and labels |
| Scatter | `bfplot.scatter` | Coordinates, sizes, values, and collection styling |
| Images | `bfplot.image` | Numerical image arrays, extent, origin, and styling |
| Error bars | `bfplot.errorbar` | Data line, error segments, and caps |
| Filled regions | `bfplot.fill_between` | Exported polygon paths |
| Histograms/bars | `bfplot.histogram` | Rectangle geometry and styling |
| Contours | `bfplot.contour` | Contour path segments |
| Filled contours | `bfplot.contourf` | Filled contour paths |
| Text | `bfplot.text` | Position, text, font properties, and alignment |
| Patches | `bfplot.patch` | Common Matplotlib patch geometry |
| 3D lines | `bfplot.line3d` | X, Y, and Z coordinates |
| 3D scatter | `bfplot.scatter3d` | X, Y, and Z coordinates |
| 3D surfaces | `bfplot.surface3d` | Surface/mesh geometry |
| 3D meshes | `bfplot.mesh3d` | Mesh geometry |

BFPlot also records linear, logarithmic, symmetric-log, and common Matplotlib axis information.

The [example gallery](../guides/gallery.md) uses every artist in this table.

## What happens to an unsupported artist?

BFPlot does not silently remove unsupported data. The viewer displays a placeholder containing the artist type and ID, so it is clear that the saved figure contains something the current renderer cannot draw.

For another Matplotlib artist, please open an issue or submit a pull request that adds its exporter and viewer renderer to BFPlot.

> Matplotlib has a wonderfully large and occasionally surprising artist ecosystem. Test BFPlot against the exact plot types your analysis uses before relying on it for final archival output.
