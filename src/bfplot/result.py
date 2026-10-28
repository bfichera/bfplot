from __future__ import annotations

import copy
from collections.abc import Iterable
from pathlib import Path
from typing import Any

import matplotlib.pyplot as plt
from matplotlib.figure import Figure

from .adapters.matplotlib import translate_figures
from .artifact import Layout, metadata_value, prepare_destination, write_result
from .mir import MirDocument
from .provenance import collect_provenance, processing_metadata
from .temporal import Animation, FigureSource


def figures_from(figure: FigureSource) -> list[Figure]:
    if figure is None:
        return [plt.figure(number) for number in plt.get_fignums()]
    if isinstance(figure, Figure):
        return [figure]
    figures = list(figure)
    if not all(isinstance(item, Figure) for item in figures):
        raise TypeError("figure must be a Matplotlib Figure or iterable of Figures")
    return figures


def provenance_metadata(provenance: bool | dict[str, Any]) -> dict[str, Any]:
    if provenance is True:
        return collect_provenance()
    if provenance is False:
        return processing_metadata()
    if isinstance(provenance, dict):
        return collect_provenance(extra=metadata_value(provenance))
    raise TypeError("provenance must be bool or a dictionary")


class Metadata(dict[str, Any]):
    """User metadata, checked as it is set so bad values fail early, not at write time."""

    def __setitem__(self, key: str, value: Any) -> None:
        super().__setitem__(key, metadata_value({key: value})[key])

    def update(self, *args: Any, **kwargs: Any) -> None:
        for key, value in dict(*args, **kwargs).items():
            self[key] = value

    def setdefault(self, key: str, default: Any = None) -> Any:
        if key not in self:
            self[key] = default
        return self[key]


class Result:
    """One BFPlot output: named figures, at most one animation, and shared metadata.

    Figures are captured when they are added. Nothing is written until the result
    closes, and a result whose ``with`` block raises writes nothing. An existing BFPlot
    result at the same path is replaced; any other existing file or directory is
    reported when the result is created, before the script does expensive work.
    """

    def __init__(
        self,
        path: str | Path,
        *,
        layout: Layout = "directory",
        provenance: bool | dict[str, Any] = True,
        preview: bool = True,
        _stacklevel: int = 1,
    ):
        self.path = Path(path)
        self.preview = bool(preview)
        self.layout = prepare_destination(self.path, layout, stacklevel=_stacklevel + 1)
        self.metadata = Metadata()
        self._base_metadata = provenance_metadata(provenance)
        self._groups: list[MirDocument | Animation] = []
        self._names: set[str] = set()
        self._next_figure = 0
        self._next_artist = 0
        self._animation: Animation | None = None
        self._closed = False
        self._written: Path | None = None

    @property
    def names(self) -> list[str]:
        """Names of the figures captured so far, in result order."""
        names: list[str] = []
        for group in self._groups:
            document = group.initial_mir if isinstance(group, Animation) else group
            names.extend(
                figure["name"] for figure in document.document["figures"] if "name" in figure
            )
        return names

    def add(
        self,
        figure: FigureSource = None,
        *,
        name: str | Iterable[str | None] | None = None,
    ) -> None:
        """Capture the current state of one or more figures.

        ``name`` labels a single figure, or gives one name per figure for several. When
        omitted, a figure's Matplotlib label (``plt.figure("spectrum")``) is used if it
        is unique within the result.
        """
        self._check_open()
        figures = figures_from(figure)
        names = self._claim_names(figures, name)
        document, self._next_artist = translate_figures(
            figures,
            self._base_metadata,
            names=names,
            first_figure=self._next_figure,
            first_artist=self._next_artist,
        )
        self._next_figure += len(figures)
        self._groups.append(document)

    def animation(
        self,
        figure: FigureSource = None,
        *,
        name: str | Iterable[str | None] | None = None,
        fps: float = 30,
        loop: bool = True,
    ) -> Animation:
        """Record a timeline for some figures of this result.

        A result holds one timeline. Its figures appear where the animation started;
        other figures in the result stay static.
        """
        self._check_open()
        if any(isinstance(group, Animation) for group in self._groups):
            raise RuntimeError("a result can contain only one animation")
        figures = figures_from(figure)
        names = self._claim_names(figures, name)
        first_figure, first_artist = self._next_figure, self._next_artist
        next_artist = first_artist

        def translator(source: FigureSource, metadata: dict[str, Any]) -> MirDocument:
            nonlocal next_artist
            document, next_artist = translate_figures(
                figures_from(source),
                metadata,
                names=names,
                first_figure=first_figure,
                first_artist=first_artist,
            )
            return document

        recording = Animation(
            figures,
            fps=fps,
            loop=loop,
            translator=translator,
            metadata=self._base_metadata,
        )
        self._next_figure += len(figures)
        self._next_artist = next_artist
        self._groups.append(recording)
        return recording

    def close(self) -> Path:
        """Write the result and return its path."""
        if self._written is not None:
            return self._written
        self._check_open()
        for group in self._groups:
            if isinstance(group, Animation):
                group.close()
        self._closed = True
        if not self._groups:
            raise ValueError("a result needs at least one figure")
        self._written = write_result(self.path, self._document(), self.layout, preview=self.preview)
        return self._written

    def abort(self) -> None:
        """Discard the result without writing anything."""
        self._closed = True
        for group in self._groups:
            if isinstance(group, Animation) and not group.closed:
                group.abort()

    def __enter__(self) -> Result:
        return self

    def __exit__(self, exception_type: Any, *_: Any) -> None:
        if exception_type is None:
            self.close()
        else:
            self.abort()

    def _check_open(self) -> None:
        if self._closed:
            raise RuntimeError("result is closed")

    def _claim_names(
        self, figures: list[Figure], name: str | Iterable[str | None] | None
    ) -> list[str | None]:
        if isinstance(name, str):
            if len(figures) != 1:
                raise ValueError("a single name needs exactly one figure; pass a list of names")
            requested: list[str | None] = [name]
        elif name is None:
            requested = [None] * len(figures)
        else:
            requested = list(name)
            if len(requested) != len(figures):
                raise ValueError("pass one name per figure")
        claimed: list[str | None] = []
        pending = set(self._names)
        for figure, explicit in zip(figures, requested, strict=True):
            if explicit is not None:
                if not isinstance(explicit, str) or not explicit:
                    raise ValueError("figure names must be non-empty strings")
                if explicit in pending:
                    raise ValueError(f"figure name {explicit!r} is already used in this result")
                chosen: str | None = explicit
            else:
                label = figure.get_label()
                chosen = label if label and label not in pending else None
            if chosen is not None:
                pending.add(chosen)
            claimed.append(chosen)
        self._names = pending
        return claimed

    def _document(self) -> MirDocument:
        figures: list[dict[str, Any]] = []
        buffers: dict[str, Any] = {}
        metadata = copy.deepcopy(self._base_metadata)
        timeline: dict[str, Any] | None = None
        for group in self._groups:
            document = group.finalized_mir if isinstance(group, Animation) else group
            renamed: dict[str, str] = {}
            for buffer_id, buffer in document.buffers.items():
                renamed[buffer_id] = f"buffer-{len(buffers)}"
                buffers[renamed[buffer_id]] = buffer
            content = _rename_buffers(document.document, renamed)
            figures.extend(content["figures"])
            if "timeline" in content:
                timeline = content["timeline"]
                metadata["temporal"] = document.metadata["temporal"]
        if self.metadata:
            extra = dict(metadata.get("extra", {}))
            extra.update(self.metadata)
            metadata["extra"] = extra
        content: dict[str, Any] = {"figures": figures}
        if timeline is not None:
            content["timeline"] = timeline
        return MirDocument(content, buffers, metadata)


def _rename_buffers(value: Any, renamed: dict[str, str]) -> Any:
    if isinstance(value, dict):
        if set(value) == {"$buffer"}:
            return {"$buffer": renamed[value["$buffer"]]}
        return {key: _rename_buffers(item, renamed) for key, item in value.items()}
    if isinstance(value, list):
        return [_rename_buffers(item, renamed) for item in value]
    return value


def result(
    path: str | Path,
    *,
    layout: Layout = "directory",
    provenance: bool | dict[str, Any] = True,
    preview: bool = True,
) -> Result:
    """Collect figures, an optional animation, and metadata into one output at ``path``."""
    return Result(path, layout=layout, provenance=provenance, preview=preview, _stacklevel=2)
