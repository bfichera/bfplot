"""BFPlot example gallery.

Builds seven Matplotlib figures that cover what BFPlot can save, and writes them
as one result: the first two figures are animated, the other five are static.

    python examples/gallery.py                    # writes gallery.bfplot/
    python examples/gallery.py out.bfplot --packed  # one packed file instead
    bfplot view gallery.bfplot

The output is deterministic: the data come from a fixed seed, and with
SOURCE_DATE_EPOCH set the provenance timestamp is fixed too.
"""

from __future__ import annotations

import argparse
from datetime import datetime, timedelta
from pathlib import Path

import matplotlib

matplotlib.use("Agg")  # Nothing is shown on screen, so this also runs headless.
import matplotlib.dates as mdates  # noqa: E402
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
from matplotlib.patches import Circle, Polygon, Rectangle  # noqa: E402

import bfplot  # noqa: E402

SEED = 20261026
NAMES = [
    "core-artists",
    "scalar-fields",
    "scales-and-time",
    "layout-and-patches",
    "three-dimensions",
    "dense-data",
    "dashboard",
]
FRAMES = 8


def core_artists(rng: np.random.Generator) -> plt.Figure:
    """Lines, markers, filled bands, scalar scatter, error bars, histograms and bars."""
    figure, axes = plt.subplots(2, 3, figsize=(13, 7.5), constrained_layout=True)
    figure.suptitle("Core two-dimensional artists")
    x = np.linspace(0, 2 * np.pi, 720)

    axis = axes[0, 0]
    axis.plot(x, np.sin(x), linewidth=1.8, label=r"$\sin(x)$")
    axis.plot(x, np.cos(x), "--", linewidth=1.4, label=r"$\cos(x)$")
    axis.plot(x[::36], np.sin(x[::36]), "o", markersize=3, label="samples")
    axis.set(title="Lines and markers", xlabel=r"phase $x$ (rad)", ylabel="amplitude")
    axis.grid(alpha=0.2)
    axis.legend(fontsize=8)

    axis = axes[0, 1]
    center = np.sin(x) * np.exp(-x / 10)
    spread = 0.10 + 0.03 * np.cos(2 * x)
    axis.fill_between(x, center - spread, center + spread, alpha=0.25, label="interval")
    axis.plot(x, center, color="C0", label="estimate")
    axis.axhline(0, color="0.25", linewidth=0.8)
    axis.set(title="Filled uncertainty", xlabel="time (s)", ylabel="response")
    axis.legend(fontsize=8)

    axis = axes[0, 2]
    cloud = rng.normal(size=(1_800, 2))
    radius = np.hypot(cloud[:, 0], cloud[:, 1])
    sizes = 7 + 24 * rng.random(len(cloud))
    scatter = axis.scatter(cloud[:, 0], cloud[:, 1], c=radius, s=sizes, alpha=0.55)
    axis.set(title="Scalar color and point size", xlabel=r"$x_1$", ylabel=r"$x_2$")
    figure.colorbar(scatter, ax=axis, label="radius")

    axis = axes[1, 0]
    dose = np.linspace(0, 6, 16)
    survival = np.exp(-dose / 3) + rng.normal(0, 0.025, dose.size)
    axis.errorbar(dose, survival, yerr=0.04 + 0.012 * dose, fmt="o-", label="measurement")
    axis.set(title="Error bars", xlabel="dose", ylabel="survival")
    axis.legend(fontsize=8)

    axis = axes[1, 1]
    samples = np.concatenate((rng.normal(-1.0, 0.5, 2_000), rng.normal(1.1, 0.75, 3_000)))
    axis.hist(samples, bins=38, color="C4", alpha=0.75, edgecolor="white")
    axis.set(title="Histogram", xlabel="value", ylabel="count")

    axis = axes[1, 2]
    categories = np.arange(4)
    scores = np.array([1.0, 1.42, 1.85, 1.62])
    axis.bar(categories, scores, color=["0.55", "C0", "C1", "C2"])
    axis.errorbar(categories, scores, yerr=[0.08, 0.11, 0.14, 0.10], fmt="none", color="0.2")
    axis.set_xticks(categories, ["control", "method A", "method B", "method C"], rotation=15)
    axis.set(title="Bars and categories", ylabel="score")
    return figure


def scalar_fields(rng: np.random.Generator) -> plt.Figure:
    """Images, contour lines, filled contours, colorbars and closed paths."""
    figure, axes = plt.subplots(2, 2, figsize=(10.5, 8.5), constrained_layout=True)
    figure.suptitle("Images, contours and colorbars")
    x = np.linspace(-3.2, 3.2, 140)
    y = np.linspace(-2.6, 2.6, 115)
    xx, yy = np.meshgrid(x, y)
    field = np.exp(-0.28 * (xx**2 + yy**2)) * np.cos(2.4 * xx) * np.sin(1.8 * yy)

    axis = axes[0, 0]
    image = axis.imshow(
        field,
        extent=[x.min(), x.max(), y.min(), y.max()],
        origin="lower",
        interpolation="bilinear",
        aspect="auto",
        cmap="magma",
    )
    axis.set(title="Raster image", xlabel="x", ylabel="y")
    figure.colorbar(image, ax=axis, label="intensity")

    axis = axes[0, 1]
    lines = axis.contour(xx, yy, field, levels=13, cmap="viridis")
    axis.clabel(lines, inline=True, fontsize=7)
    axis.set(title="Contour lines", xlabel="x", ylabel="y")

    axis = axes[1, 0]
    filled = axis.contourf(xx, yy, field, levels=19, cmap="coolwarm")
    axis.contour(xx, yy, field, levels=[0], colors="black", linewidths=0.8)
    axis.set(title="Filled contours", xlabel="x", ylabel="y")
    figure.colorbar(filled, ax=axis, label="field value", orientation="horizontal", pad=0.18)

    axis = axes[1, 1]
    theta = np.linspace(0, 2 * np.pi, 400)
    for radius, color in zip((0.45, 0.9, 1.35), ("C0", "C1", "C2"), strict=True):
        axis.plot(radius * np.cos(theta), radius * np.sin(theta), color=color)
    axis.fill(0.62 * np.cos(theta), 0.62 * np.sin(theta), color="C0", alpha=0.18)
    axis.set_aspect("equal")
    axis.set(title="Closed paths and equal aspect", xlabel="x", ylabel="y")
    return figure


def scales_and_time(rng: np.random.Generator) -> plt.Figure:
    """Logarithmic, symmetric-log and date scales, inverted axes and custom ticks."""
    figure, axes = plt.subplots(2, 3, figsize=(13, 7.5), constrained_layout=True)
    figure.suptitle("Scales, dates and ticks")

    positive = np.logspace(-3, 3, 600)
    axes[0, 0].loglog(positive, positive**1.5, color="C0")
    axes[0, 0].set(title="Log–log", xlabel="x", ylabel=r"$x^{3/2}$")

    axes[0, 1].semilogx(positive, np.log1p(positive), color="C1")
    axes[0, 1].set(title="Semilogarithmic x", xlabel="x", ylabel=r"$\log(1+x)$")

    signed = np.linspace(-1_000, 1_000, 1_200)
    axes[0, 2].plot(signed, np.sign(signed) * np.sqrt(np.abs(signed)), color="C2")
    axes[0, 2].set_xscale("symlog", linthresh=1)
    axes[0, 2].set_yscale("symlog", linthresh=1)
    axes[0, 2].set(title="Symmetric logarithmic", xlabel="signed input", ylabel="signed root")

    weeks = [datetime(2026, 1, 1) + timedelta(days=7 * index) for index in range(28)]
    trend = 4 + 0.035 * np.arange(28) + 0.3 * np.sin(np.linspace(0, 4 * np.pi, 28))
    axes[1, 0].plot(weeks, trend, "o-", markersize=3)
    axes[1, 0].xaxis.set_major_formatter(mdates.DateFormatter("%b %d"))
    axes[1, 0].tick_params(axis="x", rotation=30)
    axes[1, 0].set(title="Date axis", xlabel="week", ylabel="measurement")

    descending = np.linspace(100, 0, 240)
    axes[1, 1].plot(descending, np.sqrt(descending), color="C3")
    axes[1, 1].invert_xaxis()
    axes[1, 1].invert_yaxis()
    axes[1, 1].set(title="Inverted limits", xlabel="descending x", ylabel="inverted y")

    unit = np.linspace(0, 1, 400)
    axes[1, 2].plot(unit, np.cumsum(rng.normal(0, 0.035, unit.size)), color="C4")
    axes[1, 2].set_xticks(
        [0, 0.25, 0.5, 0.75, 1],
        ["0", r"$\frac{1}{4}$", r"$\frac{1}{2}$", r"$\frac{3}{4}$", "1"],
    )
    axes[1, 2].set(
        title="Custom ticks and math", xlabel=r"normalized time $t/T$", ylabel="random walk"
    )
    return figure


def layout_and_patches(rng: np.random.Generator) -> plt.Figure:
    """An irregular grid layout, shared axes, patches and text."""
    figure = plt.figure(figsize=(12, 7))
    figure.suptitle("Irregular layout and patches")
    grid = figure.add_gridspec(2, 3, width_ratios=[1.45, 1, 1], hspace=0.42, wspace=0.34)
    x = np.linspace(0, 8, 700)

    tall = figure.add_subplot(grid[:, 0])
    signal = np.sin(x) * np.exp(-x / 8)
    tall.plot(x, signal, label="damped signal")
    tall.fill_between(x, 0, signal, alpha=0.15)
    tall.set(title="Tall panel", xlabel="time", ylabel="response")
    tall.legend(fontsize=8)

    wide = figure.add_subplot(grid[0, 1:])
    for harmonic in (1, 2, 3, 4):
        wide.plot(x, np.sin(harmonic * x) / harmonic, label=f"n={harmonic}")
    wide.set(title="Wide panel: Fourier terms", xlabel="x", ylabel="component", xlim=(0, 8))
    wide.legend(ncols=4, fontsize=7)

    patches = figure.add_subplot(grid[1, 1])
    patches.add_patch(Rectangle((0.08, 0.12), 0.42, 0.45, color="C0", alpha=0.28))
    patches.add_patch(Circle((0.70, 0.57), 0.19, color="C1", alpha=0.32))
    patches.add_patch(Polygon([[0.18, 0.76], [0.48, 0.93], [0.58, 0.70]], color="C2", alpha=0.38))
    patches.text(0.5, 0.04, "patch geometry", ha="center", va="bottom")
    patches.set(xlim=(0, 1), ylim=(0, 1), title="Patches and text")

    distribution = figure.add_subplot(grid[1, 2], sharey=patches)
    distribution.hist(
        rng.beta(2, 5, 2_400), bins=26, orientation="horizontal", color="C4", alpha=0.75
    )
    distribution.set(title="Shared y axis", xlabel="count", ylabel="value")
    return figure


def three_dimensions(rng: np.random.Generator) -> plt.Figure:
    """A 3D line, a scalar 3D scatter, a surface and a wire mesh."""
    figure = plt.figure(figsize=(12, 9), constrained_layout=True)
    figure.suptitle("Three-dimensional geometry")

    axis = figure.add_subplot(2, 2, 1, projection="3d")
    t = np.linspace(0, 8 * np.pi, 900)
    axis.plot3D(np.cos(t), np.sin(t), t / (4 * np.pi), linewidth=1.4)
    axis.set(title="Helix", xlabel="x", ylabel="y", zlabel="z")

    axis = figure.add_subplot(2, 2, 2, projection="3d")
    points = rng.normal(size=(2_200, 3))
    scatter = axis.scatter(*points.T, c=points[:, 2], cmap="coolwarm", s=5, alpha=0.6)
    axis.set(title="Scalar 3D scatter", xlabel="x", ylabel="y", zlabel="z")
    figure.colorbar(scatter, ax=axis, label="z value", shrink=0.72)

    coordinates = np.linspace(-2.5, 2.5, 54)
    xx, yy = np.meshgrid(coordinates, coordinates)
    zz = np.sin(2 * np.hypot(xx, yy)) / (1 + 0.25 * (xx**2 + yy**2))

    axis = figure.add_subplot(2, 2, 3, projection="3d")
    axis.plot_surface(xx, yy, zz, cmap="viridis", linewidth=0)
    axis.set(title="Surface", xlabel="x", ylabel="y", zlabel="z")

    axis = figure.add_subplot(2, 2, 4, projection="3d")
    axis.plot_wireframe(xx[::2, ::2], yy[::2, ::2], zz[::2, ::2], color="C0", linewidth=0.5)
    axis.set(title="Wire mesh", xlabel="x", ylabel="y", zlabel="z")
    return figure


def dense_data(rng: np.random.Generator) -> plt.Figure:
    """Large arrays, to try loading, panning and zooming with real amounts of data."""
    figure, axes = plt.subplots(2, 2, figsize=(12, 8), constrained_layout=True)
    figure.suptitle("Dense data")

    count = 220_000
    x = np.linspace(0, 240, count)
    signal = np.sin(x) + 0.2 * np.sin(13 * x) + 0.035 * rng.normal(size=count)
    axes[0, 0].plot(x, signal, linewidth=0.65)
    axes[0, 0].set(title=f"Line ({count:,} points)", xlabel="time", ylabel="signal")

    count = 65_000
    sx = rng.normal(size=count)
    sy = 0.65 * sx + rng.normal(0, 0.7, count)
    axes[0, 1].scatter(sx, sy, s=2, alpha=0.24)
    axes[0, 1].set(title=f"Scatter ({count:,} points)", xlabel="x", ylabel="y")

    count = 100_000
    walk = np.cumsum(rng.normal(size=count))
    axes[1, 0].plot(np.arange(count), walk, linewidth=0.55, color="C2")
    axes[1, 0].set(title="Long random walk", xlabel="sample", ylabel="cumulative value")

    raster = np.cumsum(np.cumsum(rng.normal(size=(320, 480)), axis=0), axis=1)
    image = axes[1, 1].imshow(raster, cmap="cividis", origin="lower", aspect="auto")
    axes[1, 1].set(title="Large image", xlabel="column", ylabel="row")
    figure.colorbar(image, ax=axes[1, 1], label="accumulated value")
    return figure


def dashboard(rng: np.random.Generator) -> plt.Figure:
    """Thirty small panels sharing an x axis."""
    rows, columns = 5, 6
    figure, axes = plt.subplots(
        rows, columns, figsize=(15, 11), constrained_layout=True, sharex=True
    )
    figure.suptitle(f"Dashboard of {rows * columns} panels")
    x = np.linspace(0, 2 * np.pi, 260)
    for index, axis in enumerate(axes.flat, start=1):
        axis.plot(x, np.sin((1 + index % 5) * x + index * np.pi / 17), linewidth=0.8)
        axis.set_title(f"Panel {index}", fontsize=8)
        axis.tick_params(labelsize=6)
    return figure


def build_gallery(seed: int = SEED) -> list[plt.Figure]:
    """The seven gallery figures, in order. The same seed always gives the same data."""
    rng = np.random.default_rng(seed)
    builders = [
        core_artists,
        scalar_fields,
        scales_and_time,
        layout_and_patches,
        three_dimensions,
        dense_data,
        dashboard,
    ]
    figures = [build(rng) for build in builders]
    for figure in figures:
        # Run the layout engine, so saved axes positions and ticks match a rendered figure.
        figure.canvas.draw()
    return figures


def write_gallery(path: str | Path, *, packed: bool = False) -> Path:
    """Write the gallery as one result and return its path."""
    figures = build_gallery()
    try:
        wave = figures[0].axes[0].lines[0]
        image = figures[1].axes[0].images[0]
        initial = np.asarray(image.get_array()).copy()

        with bfplot.result(path, layout="file" if packed else "directory") as result:
            result.metadata.update(example="gallery", seed=SEED)
            # The sine wave travels and the raster image scrolls sideways.
            with result.animation(figures[:2], name=NAMES[:2], fps=4) as recording:
                for frame in range(1, FRAMES + 1):
                    phase = 2 * np.pi * frame / FRAMES
                    wave.set_ydata(np.sin(np.asarray(wave.get_xdata()) + phase))
                    shift = round(initial.shape[1] * frame / FRAMES)
                    image.set_data(np.roll(initial, shift, axis=1))
                    recording.capture()
            result.add(figures[2:], name=NAMES[2:])
        return result.close()
    finally:
        for figure in figures:
            plt.close(figure)


def main() -> None:
    parser = argparse.ArgumentParser(description="Write the BFPlot example gallery.")
    parser.add_argument("output", nargs="?", default="gallery.bfplot", help="default: %(default)s")
    parser.add_argument("--packed", action="store_true", help="write one packed file")
    args = parser.parse_args()
    output = write_gallery(args.output, packed=args.packed)
    print(f"Wrote {output}. Open it with: bfplot view {output}")


if __name__ == "__main__":
    main()
