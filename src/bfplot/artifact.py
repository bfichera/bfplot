"""Write and read BFPlot result directories::

    <path>/manifest.toml
    <path>/.gitignore              # "/objects/": commit the manifest, not the data
    <path>/objects/sha256/<2 hex>/<digest>

Every object is named by the SHA-256 of its content: the document by its exact JSON
bytes, an array by its raw little-endian bytes (stored zstd-compressed). The document
names every array by digest, so its digest, recorded as ``hash`` in the manifest, is
the hash of the whole result.
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import re
import shutil
import uuid
import warnings
from pathlib import Path
from typing import Any

import numpy as np
import zstandard as zstd

from .bfir import BfirDocument
from .preview import render

MANIFEST_PREFIX = b'format = "bfplot"'
# The format version this writer produces; see docs/format.md.
FORMAT_VERSION = 3

_HASH = re.compile(r"sha256:[0-9a-f]{64}")
_DTYPE = re.compile(r"[biuf]([1-9][0-9]*)")
CODECS = ("zstd", "none")


def canonical_json(value: Any) -> bytes:
    """The canonical JSON encoding that the document digest is computed over."""
    return json.dumps(
        value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False
    ).encode("utf-8")


def manifest_bytes(digest: str, preview: list[str] | None = None) -> bytes:
    lines = ['format = "bfplot"', f"version = {FORMAT_VERSION}", f'hash = "{digest}"']
    if preview:
        # Comments, so readers ignore the drawing and it is not part of the hash.
        lines += ["", "# Preview (approximate; regenerated on every save)", "#"]
        lines += [f"# {line}".rstrip() for line in preview]
    return ("\n".join(lines) + "\n").encode("utf-8")


# Destinations


def _starts_with(path: Path, prefix: bytes) -> bool:
    try:
        with path.open("rb") as handle:
            return handle.read(len(prefix)) == prefix
    except OSError:
        return False


def is_result(path: Path) -> bool:
    """Whether ``path`` is a BFPlot result (or an empty directory) that may be replaced."""
    if path.is_dir() and not path.is_symlink():
        manifest = path / "manifest.toml"
        return _starts_with(manifest, MANIFEST_PREFIX) or not any(path.iterdir())
    return False


def _check_destination(path: Path) -> None:
    if os.path.lexists(path) and not is_result(path):
        raise FileExistsError(f"{path} exists and is not a BFPlot result; refusing to replace it")


def prepare_destination(path: Path, *, stacklevel: int = 2) -> None:
    """Check an output path before any expensive work is done."""
    if not path.name.endswith(".bfplot"):
        warnings.warn(
            f"BFPlot output {str(path)!r} does not end in '.bfplot'; writing it exactly as given",
            stacklevel=stacklevel + 1,
        )
    _check_destination(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    if not os.access(path.parent, os.W_OK | os.X_OK):
        raise PermissionError(f"cannot write BFPlot output into {path.parent}")


# Writing


def _encode(array: np.ndarray) -> tuple[bytes, dict[str, Any]]:
    """Little-endian, C-ordered array bytes and their descriptor."""
    array = np.ascontiguousarray(array, dtype=array.dtype.newbyteorder("<"))
    descriptor = {"dtype": array.dtype.str[1:], "shape": list(array.shape), "codec": "zstd"}
    return array.tobytes(), descriptor


def encode_result(bfir: BfirDocument, *, compress: bool = True) -> tuple[str, dict[str, bytes]]:
    """The hash of ``bfir`` and its objects by hex digest (arrays compressed if ``compress``)."""
    bfir.validate()
    objects: dict[str, bytes] = {}
    compressor = zstd.ZstdCompressor(level=3)

    arrays = {}
    for buffer_id, buffer in bfir.buffers.items():
        raw, descriptor = _encode(buffer.array)
        digest = hashlib.sha256(raw).hexdigest()
        if digest not in objects:
            objects[digest] = compressor.compress(raw) if compress else raw
        arrays[buffer_id] = {"object": f"sha256:{digest}", **descriptor}

    def resolve(value: Any) -> Any:
        if isinstance(value, dict):
            if "$buffer" in value:
                return arrays[value["$buffer"]]
            return {key: resolve(item) for key, item in value.items()}
        if isinstance(value, list):
            return [resolve(item) for item in value]
        return value

    document = canonical_json(resolve(bfir.document))
    digest = hashlib.sha256(document).hexdigest()
    objects[digest] = document
    return f"sha256:{digest}", objects


def write_result(path: Path, bfir: BfirDocument, *, preview: bool = True) -> Path:
    """Write ``bfir`` as one result at exactly ``path``, replacing any previous result.

    With ``preview``, the manifest ends with a text drawing of the figures in comments.
    """
    digest, objects = encode_result(bfir)
    drawing = render(bfir) if preview else None
    manifest = manifest_bytes(digest, drawing)

    _check_destination(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    staging = path.with_name(f".{path.name}.{uuid.uuid4().hex[:8]}.partial")
    try:
        _write_directory(staging, manifest, objects)
        _install(staging, path)
    finally:
        _remove(staging)
    return path


def _write(path: Path, data: bytes) -> None:
    with path.open("xb") as handle:
        handle.write(data)
        os.fsync(handle.fileno())


def _write_directory(path: Path, manifest: bytes, objects: dict[str, bytes]) -> None:
    path.mkdir()
    for digest, data in objects.items():
        target = path / "objects" / "sha256" / digest[:2] / digest
        target.parent.mkdir(parents=True, exist_ok=True)
        _write(target, data)
    _write(path / "manifest.toml", manifest)
    _write(path / ".gitignore", b"/objects/\n")


def _install(staging: Path, path: Path) -> None:
    """Move ``staging`` to ``path``; a previous result is moved aside, then deleted."""
    if not os.path.lexists(path):
        os.replace(staging, path)
        return
    previous = path.with_name(f".{path.name}.{uuid.uuid4().hex[:8]}.old")
    os.rename(path, previous)
    try:
        os.replace(staging, path)
    except BaseException:
        os.rename(previous, path)
        raise
    _remove(previous)


def _remove(path: Path) -> None:
    if path.is_dir() and not path.is_symlink():
        shutil.rmtree(path, ignore_errors=True)
    elif os.path.lexists(path):
        path.unlink()


# Reading


class ResultError(ValueError):
    """Raised when a path is not a valid, intact BFPlot result."""


def _result_dir(path: str | os.PathLike[str]) -> Path:
    path = Path(path)
    return path.parent if path.name == "manifest.toml" else path


def read_hash(path: str | os.PathLike[str]) -> str:
    """The ``hash`` recorded in a result's manifest, without checking any objects."""
    manifest = _result_dir(path) / "manifest.toml"
    try:
        text = manifest.read_text(encoding="utf-8")
    except OSError as error:
        raise ResultError(f"cannot read {manifest}: {error.strerror or error}") from error
    if not text.startswith(MANIFEST_PREFIX.decode()):
        raise ResultError(f"{manifest} is not a BFPlot manifest")
    version = re.search(r"^version = (\d+)$", text, re.MULTILINE)
    if version is None:
        raise ResultError(f"{manifest} has no format version")
    if int(version.group(1)) != FORMAT_VERSION:
        raise ResultError(
            f"{manifest} uses BFPlot format version {version.group(1)}; "
            f"this bfplot reads version {FORMAT_VERSION}"
        )
    found = re.search(r'^hash = "([^"]*)"$', text, re.MULTILINE)
    if found is None or not _HASH.fullmatch(found.group(1)):
        raise ResultError(f"{manifest} has no valid hash")
    return found.group(1)


def _read_object(directory: Path, digest: str) -> bytes:
    hex_digest = digest.removeprefix("sha256:")
    try:
        return (directory / "objects" / "sha256" / hex_digest[:2] / hex_digest).read_bytes()
    except FileNotFoundError:
        raise ResultError(f"object not found: {digest}") from None


def _array_refs(value: Any, found: list[dict[str, Any]]) -> None:
    if isinstance(value, dict):
        if "object" in value:
            found.append(value)
            return
        for item in value.values():
            _array_refs(item, found)
    elif isinstance(value, list):
        for item in value:
            _array_refs(item, found)


def _check_array(directory: Path, reference: dict[str, Any]) -> int:
    digest = reference.get("object")
    dtype, shape, codec = reference.get("dtype"), reference.get("shape"), reference.get("codec")
    if set(reference) != {"object", "dtype", "shape", "codec"} or not (
        isinstance(digest, str) and _HASH.fullmatch(digest)
    ):
        raise ResultError(f"invalid array reference: {reference!r}")
    size = _DTYPE.fullmatch(dtype) if isinstance(dtype, str) else None
    dimensions_ok = isinstance(shape, list) and all(
        isinstance(item, int) and not isinstance(item, bool) and item >= 0 for item in shape
    )
    if size is None or codec not in CODECS or not dimensions_ok:
        raise ResultError(f"invalid array reference: {reference!r}")
    expected = math.prod(shape) * int(size.group(1))
    stored = _read_object(directory, digest)
    if codec == "zstd":
        try:
            declared = zstd.frame_content_size(stored)
            if declared not in (-1, expected):
                raise ResultError(f"object {digest} holds {declared} bytes, expected {expected}")
            raw = zstd.ZstdDecompressor().decompress(stored, max_output_size=expected)
        except zstd.ZstdError as error:
            raise ResultError(f"object {digest} cannot be decompressed: {error}") from None
    else:
        raw = stored
    if len(raw) != expected:
        raise ResultError(f"object {digest} holds {len(raw)} bytes, expected {expected}")
    if f"sha256:{hashlib.sha256(raw).hexdigest()}" != digest:
        raise ResultError(f"object {digest} does not match its digest")
    return len(stored)


def verify_result(path: str | os.PathLike[str]) -> str:
    """Check the document and every array of a result against their digests.

    Returns the result's hash. Raises ``ResultError`` if anything is missing or changed.
    """
    directory = _result_dir(path)
    digest = read_hash(directory)
    document = _read_object(directory, digest)
    if f"sha256:{hashlib.sha256(document).hexdigest()}" != digest:
        raise ResultError(f"document {digest} does not match its digest")
    try:
        content = json.loads(document)
    except ValueError as error:
        raise ResultError(f"document {digest} is not valid JSON: {error}") from None
    if not isinstance(content, dict) or not isinstance(content.get("figures"), list):
        raise ResultError(f"document {digest} has no figure list")
    references: list[dict[str, Any]] = []
    _array_refs(content, references)
    checked: set[str] = set()
    for reference in references:
        key = canonical_json(reference).decode()
        if key not in checked:
            _check_array(directory, reference)
            checked.add(key)
    return digest
