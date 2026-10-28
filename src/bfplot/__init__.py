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
from .bfir import BfirBuffer, BfirDocument, BfirValidationError

__all__ = [
    "Animation",
    "BfirBuffer",
    "BfirDocument",
    "BfirValidationError",
    "Result",
    "animation",
    "compile",
    "result",
    "save_animation",
    "savefig",
    "show",
    "translate",
]
__version__ = "1.0.0rc1"
