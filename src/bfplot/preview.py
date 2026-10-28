"""Rough text drawings of a BFIR document, written into the manifest so commits show the plot.

Lines, markers and outlines are drawn with Braille dots (2x4 per character), images
and colorbars with an ASCII shade ramp, and axes are placed where their figure bounds
put them. The drawing is approximate by design; the document stays the source of truth.
"""

from __future__ import annotations

import math
from collections.abc import Callable
from datetime import datetime, timedelta
from typing import Any

import numpy as np

from .bfir import BfirDocument

WIDTH = 72
SHADES = " .:-=+*#%@"
_DOTS = np.array([[0x01, 0x08], [0x02, 0x10], [0x04, 0x20], [0x40, 0x80]], dtype=np.uint8)
_NO_LINE = {None, "None", "none", "", " "}
_CHUNK = 1 << 21  # rasterized points per batch, to bound memory on dense data

Project = Callable[..., np.ndarray]


def render(bfir: BfirDocument, width: int = WIDTH) -> list[str]:
    """Text lines (without comment markers) drawing every figure in ``bfir``."""

    def array(value: Any) -> np.ndarray:
        if isinstance(value, dict) and "$buffer" in value:
            return bfir.buffers[value["$buffer"]].array
        return np.asarray(value)

    document = bfir.document
    timeline = document.get("timeline")
    lines: list[str] = []
    for index, figure in enumerate(document.get("figures", [])):
        if index:
            lines.append("")
        lines.append(_heading(figure, index, width, animated=timeline is not None))
        try:
            lines += _figure(figure, array, width)
        except Exception as error:  # a preview must never stop a result from being written
            lines.append(f"(no preview: {type(error).__name__}: {_clean(str(error))})")
    return lines


def _clean(text: Any) -> str:
    return "".join(char if char.isprintable() else " " for char in str(text or ""))


def _heading(figure: dict[str, Any], index: int, width: int, *, animated: bool) -> str:
    parts = [_clean(figure.get("name") or f"figure {index + 1}")]
    if figure.get("title"):
        parts.append(_clean(figure["title"]))
    text = "── " + " · ".join(parts) + (" (first frame)" if animated else "") + " "
    return text + "─" * max(0, width - len(text))


# Canvas


class _Canvas:
    def __init__(self, rows: int, cols: int):
        self.rows, self.cols = rows, cols
        self.cells = [[" "] * cols for _ in range(rows)]

    def put(self, row: int, col: int, text: str, *, stop: int | None = None) -> None:
        stop = self.cols if stop is None else min(stop, self.cols)
        if 0 <= row < self.rows:
            for offset, char in enumerate(text):
                if 0 <= col + offset < stop:
                    self.cells[row][col + offset] = char

    def label(self, row: int, col: int, text: str) -> None:
        """Write ``text`` only if all of it fits in blank cells, so labels never cut or overlap."""
        if (
            text
            and 0 <= row < self.rows
            and 0 <= col
            and col + len(text) <= self.cols
            and all(char == " " for char in self.cells[row][col : col + len(text)])
        ):
            self.put(row, col, text)

    def lines(self) -> list[str]:
        lines = ["".join(row).rstrip() for row in self.cells]
        while lines and not lines[-1]:
            lines.pop()
        while lines and not lines[0]:
            lines.pop(0)
        return lines


class _Plot:
    """A Braille dot grid over an axes interior, in unit coordinates (0, 0) bottom left."""

    def __init__(self, rows: int, cols: int):
        self.rows, self.cols = rows, cols
        self.dots = np.zeros((rows, cols), dtype=np.uint8)
        self.shade: list[list[str | None]] = [[None] * cols for _ in range(rows)]
        self.labels: list[tuple[int, int, str]] = []

    def _pixels(self, uv: np.ndarray) -> np.ndarray:
        uv = np.asarray(uv, dtype=float).reshape(-1, 2)
        return np.column_stack([uv[:, 0] * 2 * self.cols, (1 - uv[:, 1]) * 4 * self.rows])

    def _set(self, pixels: np.ndarray) -> None:
        pixels = pixels[np.all(np.isfinite(pixels), axis=1)]
        x, y = np.floor(pixels[:, 0]).astype(np.int64), np.floor(pixels[:, 1]).astype(np.int64)
        inside = (x >= 0) & (x < 2 * self.cols) & (y >= 0) & (y < 4 * self.rows)
        x, y = x[inside], y[inside]
        np.bitwise_or.at(self.dots, (y // 4, x // 2), _DOTS[y % 4, x % 2])

    def points(self, uv: np.ndarray) -> None:
        self._set(self._pixels(uv))

    def segments(self, starts: np.ndarray, ends: np.ndarray) -> None:
        if not len(starts):
            return
        size = (2 * self.cols - 1e-9, 4 * self.rows - 1e-9)
        a, b = _clip(self._pixels(starts), self._pixels(ends), *size)
        steps = np.ceil(np.max(np.abs(b - a), axis=1)).astype(np.int64) + 1
        bounds = np.searchsorted(np.cumsum(steps), np.arange(_CHUNK, steps.sum(), _CHUNK))
        for first, last in zip(np.r_[0, bounds], np.r_[bounds, len(steps)], strict=True):
            if last <= first:
                continue
            count = steps[first:last]
            segment = np.repeat(np.arange(first, last), count)
            offset = np.arange(count.sum()) - np.repeat(np.cumsum(count) - count, count)
            t = offset / np.maximum(np.repeat(count - 1, count), 1)
            self._set(a[segment] + t[:, None] * (b - a)[segment])

    def paths(
        self,
        uv: np.ndarray,
        lengths: np.ndarray | None = None,
        *,
        closed: bool = False,
        codes: np.ndarray | None = None,
    ) -> None:
        starts, ends = _path_segments(np.asarray(uv, dtype=float), lengths, closed, codes)
        self.segments(starts, ends)

    def fill(self, sample: Callable[[np.ndarray, np.ndarray], np.ndarray]) -> None:
        """Shade cells by ``sample(u, v)`` at their centers (values in [0, 1], NaN for none)."""
        u = (np.arange(self.cols) + 0.5) / self.cols
        v = 1 - (np.arange(self.rows) + 0.5) / self.rows
        grid_u, grid_v = np.meshgrid(u, v)
        values = np.asarray(sample(grid_u, grid_v), dtype=float)
        for row in range(self.rows):
            for col in range(self.cols):
                value = values[row, col]
                if math.isfinite(value):
                    level = round(min(max(value, 0.0), 1.0) * (len(SHADES) - 1))
                    self.shade[row][col] = SHADES[level]

    def text(self, uv: np.ndarray, text: str) -> None:
        u, v = np.asarray(uv, dtype=float).ravel()[:2]
        if math.isfinite(u) and math.isfinite(v) and 0 <= u <= 1 and 0 <= v <= 1:
            row = min(int((1 - v) * self.rows), self.rows - 1)
            self.labels.append((row, min(int(u * self.cols), self.cols - 1), _clean(text)))

    def blit(self, canvas: _Canvas, row: int, col: int, *, opaque: bool) -> None:
        for r in range(self.rows):
            for c in range(self.cols):
                bits = int(self.dots[r, c])
                char = chr(0x2800 + bits) if bits else (self.shade[r][c] or " ")
                if opaque or char != " ":
                    canvas.put(row + r, col + c, char)
        for r, c, text in self.labels:
            canvas.put(row + r, col + c, text, stop=col + self.cols)


def _clip(a: np.ndarray, b: np.ndarray, xmax: float, ymax: float) -> tuple[np.ndarray, np.ndarray]:
    """Liang-Barsky clipping of segments ``a -> b`` to ``[0, xmax] x [0, ymax]``."""
    keep = np.all(np.isfinite(a), axis=1) & np.all(np.isfinite(b), axis=1)
    a = np.where(keep[:, None], a, 0.0)
    d = np.where(keep[:, None], b - a, 0.0)
    low, high = np.zeros(len(a)), np.ones(len(a))
    for p, q in (
        (-d[:, 0], a[:, 0]),
        (d[:, 0], xmax - a[:, 0]),
        (-d[:, 1], a[:, 1]),
        (d[:, 1], ymax - a[:, 1]),
    ):
        parallel = p == 0
        keep &= ~(parallel & (q < 0))
        with np.errstate(divide="ignore", invalid="ignore"):
            ratio = q / p
        low = np.where(~parallel & (p < 0), np.maximum(low, ratio), low)
        high = np.where(~parallel & (p > 0), np.minimum(high, ratio), high)
    keep &= low <= high
    return (a + low[:, None] * d)[keep], (a + high[:, None] * d)[keep]


def _path_segments(
    points: np.ndarray,
    lengths: np.ndarray | None,
    closed: bool,
    codes: np.ndarray | None,
) -> tuple[np.ndarray, np.ndarray]:
    """Segments of polylines stored back to back, split by ``lengths`` and MOVETO codes."""
    count = len(points)
    if count < 2:
        return np.empty((0, 2)), np.empty((0, 2))
    starts = np.zeros(count, dtype=bool)
    starts[0] = True
    if lengths is not None:
        offsets = np.cumsum(np.asarray(lengths, dtype=np.int64))[:-1]
        starts[offsets[offsets < count]] = True
    closing = np.zeros(count, dtype=bool)
    if codes is not None:
        codes = np.asarray(codes)[:count]
        starts[: len(codes)] |= codes == 1
        closing[: len(codes)] = codes == 79
    linked = ~starts[1:] & ~closing[1:]
    first, last = [points[:-1][linked]], [points[1:][linked]]
    group_start = np.flatnonzero(starts)[np.cumsum(starts) - 1]
    if closed:
        ends = np.r_[np.flatnonzero(starts)[1:] - 1, count - 1]
        ends = ends[~closing[ends]]
        first.append(points[ends])
        last.append(points[group_start[ends]])
    close_at = np.flatnonzero(closing[1:]) + 1
    first.append(points[close_at - 1])
    last.append(points[group_start[close_at]])
    return np.concatenate(first), np.concatenate(last)


# Scales and projections


class _Scale:
    """Maps one axis between data values and unit coordinates along the axes."""

    TRANSFORMS: dict[str, tuple[Callable[[Any], Any], Callable[[Any], Any]]] = {
        "log": (lambda v: np.log10(np.where(v > 0, v, np.nan)), lambda w: 10.0**w),
        "symlog": (
            lambda v: np.sign(v) * np.log10(1 + np.abs(v)),
            lambda w: np.sign(w) * (10.0 ** np.abs(w) - 1),
        ),
        "logit": (
            lambda v: np.log10(np.where((v > 0) & (v < 1), v, np.nan) / (1 - v)),
            lambda w: 1 / (1 + 10.0 ** (-w)),
        ),
        "asinh": (np.arcsinh, np.sinh),
    }

    def __init__(self, axis: dict[str, Any]):
        self.axis = axis
        self._forward, self._inverse = self.TRANSFORMS.get(
            axis.get("scale", "linear"), (lambda v: v, lambda w: w)
        )
        limits = axis.get("limits") or [None, None]
        with np.errstate(all="ignore"):
            low, high = (
                self._forward(np.asarray(item, dtype=float)) if item is not None else np.nan
                for item in limits[:2]
            )
        if not (np.isfinite(low) and np.isfinite(high)) or low == high:
            raise ValueError(f"axis has unusable limits {limits!r}")
        self.low, self.high = float(low), float(high)

    def unit(self, values: Any) -> np.ndarray:
        with np.errstate(all="ignore"):
            return (self._forward(np.asarray(values, dtype=float)) - self.low) / (
                self.high - self.low
            )

    def value(self, unit: np.ndarray) -> np.ndarray:
        with np.errstate(all="ignore"):
            return self._inverse(self.low + unit * (self.high - self.low))

    def label(self, index: int) -> str:
        value = self.axis["limits"][index]
        if self.axis.get("scale") == "date":
            try:
                return (datetime(1970, 1, 1) + timedelta(days=float(value))).strftime("%Y-%m-%d")
            except (OverflowError, ValueError):
                pass
        return f"{value:.3g}"


def _projection(axes: dict[str, Any]) -> tuple[Project, Callable[[_Plot], None]]:
    """A function from data coordinates to unit coordinates, and one drawing the axes frame."""
    kind = axes.get("projection", "rectilinear")
    if kind == "3d":
        scales = [_Scale(axes[name]) for name in "xyz"]
        view = axes.get("view") or {}
        azim, elev = math.radians(view.get("azim", -60)), math.radians(view.get("elev", 30))

        def rotate(x: Any, y: Any, z: Any) -> np.ndarray:
            u = -x * math.sin(azim) + y * math.cos(azim)
            v = -(x * math.cos(azim) + y * math.sin(azim)) * math.sin(elev) + z * math.cos(elev)
            return np.column_stack([np.ravel(u) / 1.5 + 0.5, np.ravel(v) / 1.8 + 0.5])

        def project_3d(x: Any, y: Any, z: Any) -> np.ndarray:
            return rotate(*(scale.unit(item) - 0.5 for scale, item in zip(scales, (x, y, z))))

        def floor(plot: _Plot) -> None:
            corners = rotate(
                np.array([-0.5, 0.5, 0.5, -0.5]), np.array([-0.5, -0.5, 0.5, 0.5]), -0.5
            )
            plot.paths(corners, closed=True)

        return project_3d, floor
    x_scale, y_scale = _Scale(axes["x"]), _Scale(axes["y"])
    if kind == "polar":

        def project_polar(theta: Any, radius: Any) -> np.ndarray:
            theta, r = np.ravel(np.asarray(theta, dtype=float)), np.ravel(y_scale.unit(radius))
            r = np.where(r >= 0, r, np.nan)
            return np.column_stack([0.5 + 0.5 * r * np.cos(theta), 0.5 + 0.5 * r * np.sin(theta)])

        def rim(plot: _Plot) -> None:
            angles = np.linspace(0, 2 * np.pi, 97)
            plot.paths(np.column_stack([0.5 + 0.5 * np.cos(angles), 0.5 + 0.5 * np.sin(angles)]))

        return project_polar, rim

    def project(x: Any, y: Any) -> np.ndarray:
        return np.column_stack([np.ravel(x_scale.unit(x)), np.ravel(y_scale.unit(y))])

    return project, lambda plot: None


# Figures, axes and artists


def _figure(figure: dict[str, Any], array: Callable[[Any], np.ndarray], width: int) -> list[str]:
    size = figure.get("size_inches") or [6.4, 4.8]
    rows = int(np.clip(round(width * size[1] / size[0] * 0.45), 8, 60))
    canvas = _Canvas(rows, width)
    drawn: list[tuple[float, ...]] = []
    for axes in figure.get("axes", []):
        bounds = tuple(axes.get("bounds") or (0.125, 0.11, 0.775, 0.77))
        _axes(canvas, axes, bounds, array, twin=bounds in drawn)
        drawn.append(bounds)
    return canvas.lines()


def _axes(
    canvas: _Canvas,
    axes: dict[str, Any],
    bounds: tuple[float, ...],
    array: Callable[[Any], np.ndarray],
    *,
    twin: bool,
) -> None:
    left, bottom, width, height = bounds
    c0, c1 = round(left * canvas.cols), round((left + width) * canvas.cols) - 1
    r0, r1 = round((1 - bottom - height) * canvas.rows), round((1 - bottom) * canvas.rows) - 1
    c0, r0 = max(c0, 0), max(r0, 0)
    c1, r1 = min(c1, canvas.cols - 1), min(r1, canvas.rows - 1)
    if c1 - c0 < 3 or r1 - r0 < 2:
        return
    if axes.get("role") == "colorbar":
        _colorbar(canvas, axes.get("colorbar") or {}, r0, r1, c0, c1)
        return
    kind = axes.get("projection", "rectilinear")
    framed = kind not in ("3d", "polar")
    title = _clean(axes.get("title"))
    if framed:
        plot = _Plot(r1 - r0 - 1, c1 - c0 - 1)
        _frame(canvas, r0, r1, c0, c1, title)
    else:
        plot = _Plot(r1 - r0, c1 - c0 + 1)
        if title:
            canvas.put(r0, c0 + max(0, (c1 - c0 + 1 - len(title)) // 2), title, stop=c1 + 1)
    project, decorate = _projection(axes)
    decorate(plot)
    for artist in sorted(
        axes.get("artists", []), key=lambda item: item["props"].get("zorder") or 0
    ):
        if artist.get("props", {}).get("visible") is not False:
            _artist(plot, artist, project, array, axes)
    if framed:
        plot.blit(canvas, r0 + 1, c0 + 1, opaque=axes.get("role") == "inset")
        _limits(canvas, axes, r0, r1, c0, c1, twin=twin)
    else:
        plot.blit(canvas, r0 + (1 if title else 0), c0, opaque=False)


def _frame(canvas: _Canvas, r0: int, r1: int, c0: int, c1: int, title: str) -> None:
    span = c1 - c0 - 1
    top = "─" * span
    if title and span >= 5:
        label = f" {title[: span - 2]} "
        start = (span - len(label)) // 2
        top = top[:start] + label + top[start + len(label) :]
    canvas.put(r0, c0, "┌" + top + "┐")
    canvas.put(r1, c0, "└" + "─" * span + "┘")
    for row in range(r0 + 1, r1):
        canvas.put(row, c0, "│")
        canvas.put(row, c1, "│")


def _limits(
    canvas: _Canvas, axes: dict[str, Any], r0: int, r1: int, c0: int, c1: int, *, twin: bool
) -> None:
    x_scale, y_scale = _Scale(axes["x"]), _Scale(axes["y"])
    for row, index in ((r0, 1), (r1, 0)):
        label = y_scale.label(index)
        canvas.label(row, c1 + 1 if twin else c0 - len(label), label)
    if not twin:
        low, high = x_scale.label(0), x_scale.label(1)
        canvas.label(r1 + 1, c0, low)
        canvas.label(r1 + 1, max(c1 + 1 - len(high), c0 + len(low) + 1), high)
        xlabel = _clean(axes["x"].get("label"))[: c1 - c0 + 1]
        canvas.label(r1 + 2, c0 + (c1 - c0 + 1 - len(xlabel)) // 2, xlabel)
    ylabel = _clean(axes["y"].get("label"))
    room = r1 - r0 - 1
    if ylabel and room > 0:
        column = c1 + 2 if twin else c0 - 2
        text = ylabel[:room]
        first = r0 + 1 + (room - len(text)) // 2
        for offset, char in enumerate(text):
            canvas.label(first + offset, column, char)


def _colorbar(
    canvas: _Canvas, colorbar: dict[str, Any], r0: int, r1: int, c0: int, c1: int
) -> None:
    vertical = colorbar.get("orientation", "vertical") == "vertical"
    _frame(canvas, r0, r1, c0, c1, "")
    plot = _Plot(r1 - r0 - 1, c1 - c0 - 1)
    plot.fill(lambda u, v: v if vertical else u)
    plot.blit(canvas, r0 + 1, c0 + 1, opaque=True)
    limits = [f"{item:.3g}" if item is not None else "" for item in colorbar.get("limits", [])]
    if len(limits) == 2:
        if vertical:
            canvas.label(r0, c1 + 1, limits[1])
            canvas.label(r1, c1 + 1, limits[0])
        else:
            canvas.label(r1 + 1, c0, limits[0])
            canvas.label(r1 + 1, max(c1 + 1 - len(limits[1]), c0), limits[1])


def _artist(
    plot: _Plot,
    artist: dict[str, Any],
    project: Project,
    array: Callable[[Any], np.ndarray],
    axes: dict[str, Any],
) -> None:
    kind = artist["type"].removeprefix("bfplot.")
    data, props = artist.get("data", {}), artist.get("props", {})

    def values(key: str) -> np.ndarray:
        return np.asarray(array(data[key]), dtype=float)

    if kind in ("line", "line3d", "errorbar"):
        uv = project(*(values(key) for key in ("x", "y", "z") if key in data))
        if props.get("linestyle") not in _NO_LINE:
            plot.paths(uv)
        if props.get("marker") not in _NO_LINE or props.get("linestyle") in _NO_LINE:
            plot.points(uv)
        if "error_segments" in data:
            segments = values("error_segments").reshape(-1, 2, 2)
            plot.segments(
                project(segments[:, 0, 0], segments[:, 0, 1]),
                project(segments[:, 1, 0], segments[:, 1, 1]),
            )
        if "cap_segments" in data:
            caps = values("cap_segments").reshape(-1, 2)
            plot.points(project(caps[:, 0], caps[:, 1]))
    elif kind == "scatter":
        xy = values("xy").reshape(-1, 2)
        plot.points(project(xy[:, 0], xy[:, 1]))
    elif kind == "scatter3d":
        plot.points(project(values("x"), values("y"), values("z")))
    elif kind == "histogram":
        x0, y0 = values("left"), values("bottom")
        x1, y1 = x0 + values("width"), y0 + values("height")
        corners = np.stack(
            [np.stack(pair, axis=-1) for pair in ((x0, y0), (x1, y0), (x1, y1), (x0, y1))], axis=1
        )
        flat = corners.reshape(-1, 2)
        plot.paths(project(flat[:, 0], flat[:, 1]), np.full(len(x0), 4), closed=True)
    elif kind in ("surface3d", "mesh3d"):
        vertices = values("vertices").reshape(-1, 3)
        uv = project(vertices[:, 0], vertices[:, 1], vertices[:, 2])
        plot.paths(uv, array(data["path_lengths"]), closed=kind == "surface3d")
    elif kind in ("fill_between", "patch", "contour", "contourf") and "vertices" in data:
        vertices = values("vertices").reshape(-1, 2)
        lengths = array(data["path_lengths"]) if "path_lengths" in data else None
        codes = array(data["path_codes"]) if "path_codes" in data else None
        plot.paths(
            project(vertices[:, 0], vertices[:, 1]),
            lengths,
            closed=kind in ("fill_between", "patch"),
            codes=codes,
        )
    elif kind == "patch" and "path" in data:
        vertices = values("path").reshape(-1, 2)
        matrix = np.asarray(data.get("transform") or np.eye(3), dtype=float)
        moved = np.column_stack([vertices, np.ones(len(vertices))]) @ matrix.T
        plot.paths(project(moved[:, 0], moved[:, 1]), closed=True)
    elif kind == "contour" and "segments" in data:
        segments = values("segments")
        if segments.ndim == 3 and segments.shape[1]:
            flat = segments.reshape(-1, 2)
            plot.paths(project(flat[:, 0], flat[:, 1]), np.full(len(segments), segments.shape[1]))
    elif kind == "image" and axes.get("projection", "rectilinear") == "rectilinear":
        _image(plot, values("values"), data.get("extent"), props, axes)
    elif kind == "text":
        position = data.get("position") or [None, None]
        if None not in position:
            plot.text(project(*position), data.get("text", ""))


def _image(
    plot: _Plot,
    pixels: np.ndarray,
    extent: list[float] | None,
    props: dict[str, Any],
    axes: dict[str, Any],
) -> None:
    if pixels.ndim == 3:
        rgb = pixels[..., :3] / (255.0 if pixels.max(initial=0) > 1 else 1.0)
        intensity = rgb @ np.array([0.2126, 0.7152, 0.0722])
        if pixels.shape[-1] == 4:
            intensity = np.where(pixels[..., 3] > 0, intensity, np.nan)
    else:
        low, high = props.get("clim") or [None, None]
        low = np.nanmin(pixels) if low is None else low
        high = np.nanmax(pixels) if high is None else high
        intensity = (pixels - low) / (high - low) if high != low else np.zeros_like(pixels)
    if intensity.ndim != 2 or not intensity.size:
        return
    image_rows, image_cols = intensity.shape
    x0, x1, y0, y1 = extent or (-0.5, image_cols - 0.5, image_rows - 0.5, -0.5)
    x_scale, y_scale = _Scale(axes["x"]), _Scale(axes["y"])
    upper = props.get("origin", "upper") == "upper"

    def sample(u: np.ndarray, v: np.ndarray) -> np.ndarray:
        with np.errstate(all="ignore"):
            col = (x_scale.value(u) - x0) / (x1 - x0) * image_cols
            frac = (y_scale.value(v) - y0) / (y1 - y0)
            row = (1 - frac if upper else frac) * image_rows
        inside = (col >= 0) & (col < image_cols) & (row >= 0) & (row < image_rows)
        col = np.clip(np.nan_to_num(col), 0, image_cols - 1).astype(np.int64)
        row = np.clip(np.nan_to_num(row), 0, image_rows - 1).astype(np.int64)
        return np.where(inside, intensity[row, col], np.nan)

    plot.fill(sample)
