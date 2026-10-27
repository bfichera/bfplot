from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any

import matplotlib.dates as mdates
import numpy as np
from matplotlib import colors
from matplotlib.artist import Artist
from matplotlib.collections import LineCollection, PathCollection, PolyCollection
from matplotlib.container import BarContainer, ErrorbarContainer
from matplotlib.image import AxesImage
from matplotlib.lines import Line2D
from matplotlib.patches import Patch, Polygon
from matplotlib.spines import Spine
from matplotlib.text import Text

from ..mir import MirBuilder, MirDocument


def _finite(value: Any) -> Any:
    if isinstance(value, np.generic):
        value = value.item()
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    if isinstance(value, (str, int, bool)) or value is None:
        return value
    if isinstance(value, dict):
        return {str(key): _finite(item) for key, item in value.items()}
    if isinstance(value, (list, tuple, np.ndarray)):
        return [_finite(item) for item in value]
    return str(value)


def _color(value: Any) -> list[float] | None:
    try:
        return [float(item) for item in colors.to_rgba(value)]
    except (TypeError, ValueError):
        return None


def _common(artist: Artist) -> dict[str, Any]:
    label = artist.get_label() if hasattr(artist, "get_label") else None
    return {
        "visible": bool(artist.get_visible()),
        "alpha": _finite(artist.get_alpha()),
        "zorder": _finite(artist.get_zorder()),
        "label": label if isinstance(label, str) and not label.startswith("_") else None,
    }


@dataclass
class ExtractionContext:
    builder: MirBuilder
    next_artist: int = 0
    artist_ids: dict[int, str] = field(default_factory=dict)

    def array(self, value: Any) -> dict[str, str]:
        return self.builder.buffer(value)

    def artist_id(self, source: Any = None) -> str:
        """A fresh artist ID, or the one already given to ``source`` (e.g. a colorbar mappable)."""
        if source is not None and id(source) in self.artist_ids:
            return self.artist_ids[id(source)]
        artist_id = f"artist-{self.next_artist}"
        self.next_artist += 1
        if source is not None:
            self.artist_ids[id(source)] = artist_id
        return artist_id

    def artist(
        self,
        type_name: str,
        axes_id: str,
        props: dict[str, Any],
        data: dict[str, Any],
        source: Any | None = None,
    ) -> dict[str, Any]:
        return {
            "type": type_name,
            "id": self.artist_id(source),
            "axes_id": axes_id,
            "props": _finite(props),
            "data": data,
        }


def translate_figures(
    figures: list[Any],
    metadata: dict[str, Any],
    *,
    names: list[str | None] | None = None,
    first_figure: int = 0,
    first_artist: int = 0,
) -> tuple[MirDocument, int]:
    """Translate Matplotlib figures into MIR and return the next unused artist number.

    ``first_figure`` and ``first_artist`` offset generated IDs so separately translated
    groups can be combined into one document without collisions.
    """
    names = names or [None] * len(figures)
    builder = MirBuilder(metadata=metadata)
    context = ExtractionContext(builder, next_artist=first_artist)
    records = []
    for index, (figure, name) in enumerate(zip(figures, names, strict=True)):
        record = _extract_figure(figure, f"figure-{first_figure + index}", context)
        if name is not None:
            record["name"] = name
        records.append(record)
    return builder.build({"figures": records}), context.next_artist


def _extract_figure(figure: Any, figure_id: str, context: ExtractionContext) -> dict[str, Any]:
    width, height = figure.get_size_inches()
    result = {
        "id": figure_id,
        "size_inches": [float(width), float(height)],
        "dpi": float(figure.dpi),
        "facecolor": _color(figure.get_facecolor()),
        "axes": [],
    }
    suptitle = getattr(figure, "_suptitle", None)
    if suptitle is not None and suptitle.get_text():
        result["title"] = suptitle.get_text()
    axes_entries: list[tuple[Any, Any | None]] = []
    for axes in figure.axes:
        axes_entries.append((axes, None))
        axes_entries.extend((child, axes) for child in getattr(axes, "child_axes", []))
    subplot_axes = {id(axes) for axes, _ in axes_entries if _has_subplotspec(axes)}
    axes_ids = {
        id(axes): f"{figure_id}-axes-{index}" for index, (axes, _) in enumerate(axes_entries)
    }
    for index, (axes, explicit_parent) in enumerate(axes_entries):
        extracted_axes = _extract_axes(axes, axes_ids[id(axes)], context)
        if explicit_parent is not None and extracted_axes.get("role") != "colorbar":
            extracted_axes["role"] = "inset"
            extracted_axes["parent_axes_id"] = axes_ids[id(explicit_parent)]
        elif id(axes) not in subplot_axes and extracted_axes.get("role") != "colorbar":
            parent = _inset_parent(axes, [item for item, _ in axes_entries], subplot_axes)
            if parent is not None:
                extracted_axes["role"] = "inset"
                extracted_axes["parent_axes_id"] = axes_ids[id(parent)]
        result["axes"].append(extracted_axes)
    return result


def _has_subplotspec(axes: Any) -> bool:
    try:
        return axes.get_subplotspec() is not None
    except (AttributeError, TypeError):
        return False


def _inset_parent(axes: Any, candidates: list[Any], subplot_axes: set[int]) -> Any | None:
    left, bottom, width, height = axes.get_position().bounds
    center = (left + width / 2, bottom + height / 2)
    parents = []
    for candidate in candidates:
        if id(candidate) not in subplot_axes:
            continue
        candidate_left, candidate_bottom, candidate_width, candidate_height = (
            candidate.get_position().bounds
        )
        if (
            candidate_left <= center[0] <= candidate_left + candidate_width
            and candidate_bottom <= center[1] <= candidate_bottom + candidate_height
        ):
            overlap_width = max(
                0.0, min(left + width, candidate_left + candidate_width) - max(left, candidate_left)
            )
            overlap_height = max(
                0.0,
                min(bottom + height, candidate_bottom + candidate_height)
                - max(bottom, candidate_bottom),
            )
            parents.append((overlap_width * overlap_height, candidate))
    return max(parents, key=lambda item: item[0])[1] if parents else None


def _extract_axes(axes: Any, axes_id: str, context: ExtractionContext) -> dict[str, Any]:
    is_3d = getattr(axes, "name", "") == "3d"
    result: dict[str, Any] = {
        "id": axes_id,
        "projection": "3d" if is_3d else getattr(axes, "name", "rectilinear"),
        "bounds": [float(item) for item in axes.get_position().bounds],
        "title": axes.get_title(),
        "x": _axis(axes, "x"),
        "y": _axis(axes, "y"),
        "facecolor": _color(axes.get_facecolor()),
        "artists": [],
    }
    colorbar = getattr(axes, "_colorbar", None)
    if axes.get_label() == "<colorbar>" or colorbar is not None:
        result["role"] = "colorbar"
        if colorbar is not None:
            mappable = colorbar.mappable
            lower, upper = mappable.get_clim()
            result["colorbar"] = {
                "orientation": colorbar.orientation,
                "label": colorbar.ax.get_ylabel()
                if colorbar.orientation == "vertical"
                else colorbar.ax.get_xlabel(),
                "limits": [_finite(lower), _finite(upper)],
                "ticks": [_finite(item) for item in colorbar.get_ticks()],
                "ticklabels": [item.get_text() for item in colorbar.ax.get_yticklabels()]
                if colorbar.orientation == "vertical"
                else [item.get_text() for item in colorbar.ax.get_xticklabels()],
                "cmap": mappable.cmap.name,
                "colors": [_color(mappable.cmap(value)) for value in np.linspace(0, 1, 64)],
                "mappable": context.artist_id(mappable),
            }
        return result
    if is_3d:
        result["z"] = _axis(axes, "z")
        result["view"] = {
            "elev": float(axes.elev),
            "azim": float(axes.azim),
            "roll": float(getattr(axes, "roll", 0)),
        }

    consumed: set[int] = set()
    axes_text = {
        id(item)
        for item in (
            axes.title,
            getattr(axes, "_left_title", None),
            getattr(axes, "_right_title", None),
            axes.xaxis.label,
            axes.yaxis.label,
            getattr(getattr(axes, "zaxis", None), "label", None),
        )
        if item is not None
    }
    for container in axes.containers:
        extracted, children = _extract_container(container, axes_id, context)
        if extracted:
            result["artists"].append(extracted)
            consumed.update(id(child) for child in children if child is not None)

    for image in axes.images:
        if id(image) not in consumed:
            result["artists"].append(_extract_image(image, axes_id, context))
            consumed.add(id(image))

    for artist in axes.get_children():
        if (
            id(artist) in consumed
            or id(artist) in axes_text
            or not artist.get_visible()
            or artist is axes.patch
            or isinstance(artist, Spine)
        ):
            continue
        extracted = _extract_artist(artist, axes_id, context, is_3d)
        if extracted is not None:
            result["artists"].append(extracted)
    return result


def _axis(axes: Any, name: str) -> dict[str, Any]:
    axis = getattr(axes, f"{name}axis")
    lower, upper = getattr(axes, f"get_{name}lim")()
    converter = (
        axis.get_converter()
        if hasattr(axis, "get_converter")
        else getattr(axis, "_converter", None)
    )
    is_date = isinstance(converter, mdates.DateConverter) or isinstance(
        axis.get_major_locator(), mdates.DateLocator
    )
    formatter = axis.get_major_formatter()
    result = {
        "label": axis.get_label_text(),
        "scale": "date" if is_date else getattr(axes, f"get_{name}scale")(),
        "limits": [_finite(lower), _finite(upper)],
        "inverted": bool(getattr(axes, f"{name}axis_inverted")()),
        "ticks": [_finite(item) for item in axis.get_ticklocs()],
        "ticklabels": [item.get_text() for item in axis.get_ticklabels()],
    }
    if is_date:
        result["date_epoch"] = "matplotlib"
        result["date_format"] = getattr(formatter, "fmt", None) or "%b %d"
    return result


def _extract_container(
    container: Any, axes_id: str, context: ExtractionContext
) -> tuple[dict[str, Any] | None, list[Any]]:
    if isinstance(container, ErrorbarContainer):
        data_line, caplines, barcols = container.lines
        if data_line is not None:
            x, y = data_line.get_data()
            props = _line_props(data_line)
        else:
            x, y, props = [], [], {}
        segments = [segment for collection in barcols for segment in collection.get_segments()]
        cap_segments = [np.column_stack(cap.get_data()) for cap in caplines]
        data = {"x": context.array(x), "y": context.array(y)}
        if segments:
            data["error_segments"] = context.array(np.asarray(segments))
        if cap_segments:
            data["cap_segments"] = context.array(np.asarray(cap_segments))
        children = [data_line, *caplines, *barcols]
        return context.artist("mplot.errorbar", axes_id, props, data), children
    if isinstance(container, BarContainer):
        patches = list(container.patches)
        if not patches:
            return None, []
        data = {
            "left": context.array([patch.get_x() for patch in patches]),
            "bottom": context.array([patch.get_y() for patch in patches]),
            "width": context.array([patch.get_width() for patch in patches]),
            "height": context.array([patch.get_height() for patch in patches]),
        }
        props = _patch_props(patches[0])
        props["orientation"] = getattr(container, "orientation", None)
        return context.artist("mplot.histogram", axes_id, props, data), patches
    return None, []


def _extract_artist(
    artist: Any, axes_id: str, context: ExtractionContext, is_3d: bool
) -> dict[str, Any] | None:
    class_name = artist.__class__.__name__
    if isinstance(artist, Line2D) and artist.axes is not None:
        x, y = artist.get_data(orig=False)
        if is_3d and hasattr(artist, "get_data_3d"):
            x, y, z = artist.get_data_3d()
            return context.artist(
                "mplot.line3d",
                axes_id,
                _line_props(artist),
                {"x": context.array(x), "y": context.array(y), "z": context.array(z)},
            )
        return context.artist(
            "mplot.line",
            axes_id,
            _line_props(artist),
            {"x": context.array(x), "y": context.array(y)},
        )
    if isinstance(artist, PathCollection):
        type_name = "mplot.scatter"
        if is_3d and hasattr(artist, "_offsets3d"):
            x, y, z = artist._offsets3d
            data: dict[str, Any] = {
                "x": context.array(x),
                "y": context.array(y),
                "z": context.array(z),
            }
            type_name = "mplot.scatter3d"
        else:
            offsets = np.asarray(artist.get_offsets())
            data = {"xy": context.array(offsets)}
        sizes = artist.get_sizes()
        if len(sizes):
            data["sizes"] = context.array(sizes)
        values = artist.get_array()
        if values is not None:
            data["values"] = context.array(values)
        return context.artist(type_name, axes_id, _collection_props(artist), data, source=artist)
    if class_name == "FillBetweenPolyCollection":
        return _extract_paths("mplot.fill_between", artist, axes_id, context)
    if class_name in {"QuadContourSet", "ContourSet"}:
        return _extract_contour(artist, axes_id, context)
    if is_3d and class_name == "Poly3DCollection":
        faces = _poly3d_faces(artist)
        return _extract_3d_paths("mplot.surface3d", faces, artist, axes_id, context)
    if is_3d and isinstance(artist, LineCollection) and hasattr(artist, "_segments3d"):
        return _extract_3d_paths("mplot.mesh3d", list(artist._segments3d), artist, axes_id, context)
    if isinstance(artist, PolyCollection):
        return _extract_paths("mplot.patch", artist, axes_id, context)
    if isinstance(artist, LineCollection):
        return context.artist(
            "mplot.contour",
            axes_id,
            _collection_props(artist),
            {"segments": context.array(np.asarray(artist.get_segments()))},
        )
    if isinstance(artist, AxesImage):
        return _extract_image(artist, axes_id, context)
    if isinstance(artist, Text) and artist.axes is not None and artist.get_text():
        position = artist.get_position()
        data = {"position": [_finite(position[0]), _finite(position[1])], "text": artist.get_text()}
        props = _common(artist) | {
            "color": _color(artist.get_color()),
            "size": float(artist.get_fontsize()),
            "rotation": float(artist.get_rotation()),
            "horizontalalignment": artist.get_horizontalalignment(),
            "verticalalignment": artist.get_verticalalignment(),
        }
        return context.artist("mplot.text", axes_id, props, data)
    if isinstance(artist, Patch) and artist.axes is not None:
        data: dict[str, Any] = {}
        if isinstance(artist, Polygon):
            data["vertices"] = context.array(artist.get_xy())
        else:
            data["path"] = context.array(artist.get_path().vertices)
            data["transform"] = _finite(artist.get_patch_transform().get_matrix())
        return context.artist("mplot.patch", axes_id, _patch_props(artist), data)
    return None


def _line_props(line: Any) -> dict[str, Any]:
    return _common(line) | {
        "color": _color(line.get_color()),
        "linewidth": float(line.get_linewidth()),
        "linestyle": line.get_linestyle(),
        "marker": line.get_marker(),
        "markersize": float(line.get_markersize()),
        "drawstyle": line.get_drawstyle(),
    }


def _patch_props(patch: Any) -> dict[str, Any]:
    return _common(patch) | {
        "facecolor": _color(patch.get_facecolor()),
        "edgecolor": _color(patch.get_edgecolor()),
        "linewidth": float(patch.get_linewidth()),
        "linestyle": patch.get_linestyle(),
        "hatch": patch.get_hatch(),
    }


def _collection_props(collection: Any) -> dict[str, Any]:
    result = _common(collection)
    for name, getter in (
        ("facecolors", "get_facecolors"),
        ("edgecolors", "get_edgecolors"),
        ("linewidths", "get_linewidths"),
    ):
        value = getattr(collection, getter)()
        if len(value):
            result[name] = _finite(value)
    cmap = getattr(collection, "cmap", None)
    norm = getattr(collection, "norm", None)
    if cmap is not None:
        result["cmap"] = cmap.name
    if norm is not None:
        result["clim"] = [_finite(norm.vmin), _finite(norm.vmax)]
    return result


def _extract_paths(
    type_name: str, artist: Any, axes_id: str, context: ExtractionContext
) -> dict[str, Any]:
    paths = [path.vertices for path in artist.get_paths()]
    lengths = np.asarray([len(path) for path in paths], dtype=np.int64)
    vertices = np.concatenate(paths) if paths else np.empty((0, 2))
    data = {"vertices": context.array(vertices), "path_lengths": context.array(lengths)}
    values = artist.get_array() if hasattr(artist, "get_array") else None
    if values is not None:
        data["values"] = context.array(values)
    return context.artist(type_name, axes_id, _collection_props(artist), data, source=artist)


def _poly3d_faces(artist: Any) -> list[np.ndarray]:
    faces = getattr(artist, "_faces", None)
    if isinstance(faces, np.ndarray) and faces.ndim == 3 and faces.shape[-1] == 3:
        # Matplotlib pads faces to a common length; the padding vertices are garbage.
        invalid = getattr(artist, "_invalid_vertices", None)
        if isinstance(invalid, np.ndarray) and invalid.shape == faces.shape[:2]:
            return [face[~mask] for face, mask in zip(faces, invalid, strict=True)]
        return [face for face in faces]
    vector = getattr(artist, "_vec", None)
    slices = getattr(artist, "_segslices", None)
    if vector is not None and slices is not None:
        values = np.asarray(vector)
        if values.ndim == 2 and values.shape[0] >= 3:
            return [values[:3, segment].T for segment in slices]
    return []


def _extract_3d_paths(
    type_name: str, paths: list[Any], artist: Any, axes_id: str, context: ExtractionContext
) -> dict[str, Any]:
    arrays = [np.asarray(path, dtype=float) for path in paths]
    arrays = [path for path in arrays if path.ndim == 2 and path.shape[1] == 3 and len(path)]
    lengths = np.asarray([len(path) for path in arrays], dtype=np.int64)
    vertices = np.concatenate(arrays) if arrays else np.empty((0, 3))
    data = {"vertices": context.array(vertices), "path_lengths": context.array(lengths)}
    values = artist.get_array() if hasattr(artist, "get_array") else None
    if values is not None:
        data["values"] = context.array(values)
    return context.artist(type_name, axes_id, _collection_props(artist), data, source=artist)


def _extract_contour(artist: Any, axes_id: str, context: ExtractionContext) -> dict[str, Any]:
    paths = []
    path_values = []
    cvalues = np.asarray(getattr(artist, "cvalues", []), dtype=float)
    collections = getattr(artist, "collections", [])
    for index, collection in enumerate(collections):
        collection_paths = collection.get_paths()
        paths.extend(collection_paths)
        path_values.extend(
            [cvalues[index] if index < len(cvalues) else float(index)] * len(collection_paths)
        )
    if not paths and hasattr(artist, "get_paths"):
        paths.extend(artist.get_paths())
        path_values.extend(cvalues[: len(paths)])
    lengths = np.asarray([len(path.vertices) for path in paths], dtype=np.int64)
    vertices = np.concatenate([path.vertices for path in paths]) if paths else np.empty((0, 2))
    codes = (
        np.concatenate(
            [
                path.codes
                if path.codes is not None
                else np.full(len(path.vertices), 2, dtype=np.uint8)
                for path in paths
            ]
        )
        if paths
        else np.empty(0, dtype=np.uint8)
    )
    filled = bool(getattr(artist, "filled", False))
    data = {
        "vertices": context.array(vertices),
        "path_codes": context.array(codes),
        "path_lengths": context.array(lengths),
        "path_values": context.array(np.asarray(path_values, dtype=float)),
        "levels": context.array(artist.levels),
    }
    props = _collection_props(artist)
    props["cmap"] = artist.cmap.name
    return context.artist(
        "mplot.contourf" if filled else "mplot.contour", axes_id, props, data, source=artist
    )


def _extract_image(image: Any, axes_id: str, context: ExtractionContext) -> dict[str, Any]:
    data = {
        "values": context.array(image.get_array()),
        "extent": [_finite(item) for item in image.get_extent()],
    }
    props = _common(image) | {
        "cmap": image.get_cmap().name,
        "clim": [_finite(item) for item in image.get_clim()],
        "origin": image.origin,
        "interpolation": image.get_interpolation(),
    }
    return context.artist("mplot.image", axes_id, props, data, source=image)
