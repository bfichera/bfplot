# Supported plots

MPlot 0.9.9 understands the common Matplotlib artists below.

| Plot | MPlot artist | Notes |
| --- | --- | --- |
| Lines | `mplot.line` | Coordinates, line style, markers, color, and labels |
| Scatter | `mplot.scatter` | Coordinates, sizes, values, and collection styling |
| Images | `mplot.image` | Numerical image arrays, extent, origin, and styling |
| Error bars | `mplot.errorbar` | Data line, error segments, and caps |
| Filled regions | `mplot.fill_between` | Exported polygon paths |
| Histograms/bars | `mplot.histogram` | Rectangle geometry and styling |
| Contours | `mplot.contour` | Contour path segments |
| Filled contours | `mplot.contourf` | Filled contour paths |
| Text | `mplot.text` | Position, text, font properties, and alignment |
| Patches | `mplot.patch` | Common Matplotlib patch geometry |
| 3D lines | `mplot.line3d` | X, Y, and Z coordinates |
| 3D scatter | `mplot.scatter3d` | X, Y, and Z coordinates |
| 3D surfaces | `mplot.surface3d` | Surface/mesh geometry |
| 3D meshes | `mplot.mesh3d` | Mesh geometry |

MPlot also records linear, logarithmic, symmetric-log, and common Matplotlib axis information.

## What happens to an unsupported artist?

MPlot does not silently remove unsupported data. The viewer displays a placeholder containing the artist type and ID, so it is clear that the saved figure contains something the current renderer cannot draw.

For another Matplotlib artist, please open an issue or submit a pull request that adds its exporter and viewer renderer to MPlot.

!!! note "Pre-1.0 reality check"
    Matplotlib has a wonderfully large and occasionally surprising artist ecosystem. Test MPlot against the exact plot types your analysis uses before relying on it for final archival output.
