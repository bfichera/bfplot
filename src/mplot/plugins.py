from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from importlib.metadata import entry_points
from typing import Any

Extractor = Callable[[Any, Any], dict[str, Any] | None]


@dataclass(frozen=True)
class Plugin:
    type_name: str
    artist_class: type
    extractor: Extractor
    requirement: str | None = None


class PluginRegistry:
    """Registry for custom Matplotlib artist serializers.

    Custom type names must be reverse-DNS names and cannot claim the ``mplot``
    namespace. Entry points in ``mplot.plugins`` may return a Plugin, an
    iterable of Plugins, or a callable accepting this registry.
    """

    def __init__(self) -> None:
        self._plugins: list[Plugin] = []
        self._entry_points_loaded = False

    def register(
        self,
        type_name: str,
        artist_class: type,
        extractor: Extractor,
        *,
        requirement: str | None = None,
    ) -> Plugin:
        if type_name.startswith("mplot.") or "." not in type_name:
            raise ValueError("plugin artist types must use a non-mplot reverse-DNS name")
        if any(plugin.type_name == type_name for plugin in self._plugins):
            raise ValueError(f"plugin artist type is already registered: {type_name}")
        plugin = Plugin(type_name, artist_class, extractor, requirement)
        self._plugins.insert(0, plugin)
        return plugin

    def unregister(self, plugin: Plugin) -> None:
        self._plugins.remove(plugin)

    def match(self, artist: Any) -> Plugin | None:
        return next((p for p in self._plugins if isinstance(artist, p.artist_class)), None)

    def load_entry_points(self) -> None:
        if self._entry_points_loaded:
            return
        self._entry_points_loaded = True
        for entry_point in entry_points(group="mplot.plugins"):
            loaded = entry_point.load()
            if isinstance(loaded, Plugin):
                self._plugins.append(loaded)
            elif callable(loaded):
                result = loaded(self)
                if isinstance(result, Plugin):
                    self._plugins.append(result)
            else:
                for plugin in loaded:
                    if not isinstance(plugin, Plugin):
                        raise TypeError(f"invalid mplot plugin from {entry_point.name}")
                    self._plugins.append(plugin)


registry = PluginRegistry()


def register_artist(
    type_name: str,
    artist_class: type,
    extractor: Extractor,
    *,
    requirement: str | None = None,
) -> Plugin:
    return registry.register(type_name, artist_class, extractor, requirement=requirement)
