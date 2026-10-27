"""Script-first, content-addressed interactive scientific plots."""

from .api import (
    Animation,
    Result,
    animation,
    compile,
    result,
    save_animation,
    savefig,
    show,
    translate,
)
from .mir import MirBuffer, MirDocument, MirValidationError

__all__ = [
    "Animation",
    "MirBuffer",
    "MirDocument",
    "MirValidationError",
    "Result",
    "animation",
    "compile",
    "result",
    "save_animation",
    "savefig",
    "show",
    "translate",
]
__version__ = "0.9.9"
