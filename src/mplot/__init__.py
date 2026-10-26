"""Script-first, content-addressed interactive scientific plots."""

from .api import (
    Animation,
    Stream,
    animation,
    compile,
    save_animation,
    savefig,
    show,
    stream,
    translate,
)
from .mir import MIR_VERSION, MirBuffer, MirDocument, MirValidationError

__all__ = [
    "Animation",
    "MIR_VERSION",
    "MirBuffer",
    "MirDocument",
    "MirValidationError",
    "Stream",
    "animation",
    "compile",
    "save_animation",
    "savefig",
    "show",
    "stream",
    "translate",
]
__version__ = "0.9.9"
