from __future__ import annotations

import hashlib
import os
import tempfile
from pathlib import Path


class ContentStore:
    """Immutable SHA-256 object store with atomic writes and verified reads."""

    def __init__(self, root: str | os.PathLike[str]):
        self.root = Path(root)

    @staticmethod
    def digest(data: bytes) -> str:
        return hashlib.sha256(data).hexdigest()

    def path_for(self, digest: str) -> Path:
        digest = digest.removeprefix("sha256:")
        if len(digest) != 64 or any(c not in "0123456789abcdef" for c in digest):
            raise ValueError("invalid SHA-256 digest")
        return self.root / "sha256" / digest[:2] / digest

    def put(self, data: bytes) -> str:
        digest = self.digest(data)
        target = self.path_for(digest)
        if target.exists():
            if self.digest(target.read_bytes()) != digest:
                raise ValueError(f"existing object digest mismatch: {digest}")
            return f"sha256:{digest}"
        target.parent.mkdir(parents=True, exist_ok=True)
        fd, temporary = tempfile.mkstemp(prefix=".mplot-", dir=target.parent)
        try:
            with os.fdopen(fd, "wb") as handle:
                handle.write(data)
                handle.flush()
                os.fsync(handle.fileno())
            try:
                os.replace(temporary, target)
            except OSError:
                if not target.exists():
                    raise
        finally:
            try:
                os.unlink(temporary)
            except FileNotFoundError:
                pass
        return f"sha256:{digest}"

    def get(self, digest: str) -> bytes:
        expected = digest.removeprefix("sha256:")
        data = self.path_for(expected).read_bytes()
        if self.digest(data) != expected:
            raise ValueError(f"object digest mismatch: {expected}")
        return data
