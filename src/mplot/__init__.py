"""Script-first, content-addressed interactive scientific plots."""

from .api import Stream, savefig, show, stream
from .plugins import Plugin, PluginRegistry, register_artist, registry

__all__ = [
    "Plugin",
    "PluginRegistry",
    "Stream",
    "register_artist",
    "registry",
    "savefig",
    "show",
    "stream",
]
__version__ = "0.9.9"
