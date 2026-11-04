"""Script-first, content-addressed interactive scientific plots."""

from .api import (
    Animation,
    Result,
    ResultError,
    animation,
    compile,
    hash,
    result,
    same,
    save_animation,
    savefig,
    show,
    translate,
    verify,
)
from .bfir import BfirBuffer, BfirDocument, BfirValidationError

__all__ = [
    "Animation",
    "BfirBuffer",
    "BfirDocument",
    "BfirValidationError",
    "Result",
    "ResultError",
    "animation",
    "compile",
    "hash",
    "result",
    "same",
    "save_animation",
    "savefig",
    "show",
    "translate",
    "verify",
]
__version__ = "1.0.0rc3"
