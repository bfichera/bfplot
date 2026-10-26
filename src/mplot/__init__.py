"""Script-first, content-addressed interactive scientific plots."""

from .api import Stream, compile, savefig, show, stream, translate
from .mir import MIR_VERSION, MirBuffer, MirDocument, MirValidationError

__all__ = [
    "MIR_VERSION",
    "MirBuffer",
    "MirDocument",
    "MirValidationError",
    "Stream",
    "compile",
    "savefig",
    "show",
    "stream",
    "translate",
]
__version__ = "0.9.9"
