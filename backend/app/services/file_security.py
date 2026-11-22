"""
File & ZIP Security Validation Service.

Protects against:
- ZIP bombs (extreme compression ratio or excessive uncompressed size)
- Path traversal (../, absolute paths, Windows drive prefixes, symlinks)
- Oversized files
- Disallowed file types / extensions
- Excessive file count
- Malformed / corrupted archives
"""

from __future__ import annotations

import io
import os
import posixpath
import stat
import zipfile
from dataclasses import dataclass, field
from typing import Dict, List, Sequence

MAX_COMPRESSION_RATIO = 100.0


class FileSecurityError(ValueError):
    """Raised when an uploaded file or ZIP archive violates security constraints."""


@dataclass
class SafeZipResult:
    files: Dict[str, bytes] = field(default_factory=dict)
    total_uncompressed_bytes: int = 0
    file_count: int = 0
    manifest: List[Dict[str, object]] = field(default_factory=list)


def validate_single_file(
    filename: str,
    content: bytes,
    allowed_extensions: Sequence[str],
    max_size_mb: int,
) -> str:
    if not filename or "/" in filename or "\\" in filename or ".." in filename:
        base = os.path.basename(filename or "")
        if not base or ".." in base:
            raise FileSecurityError(f"Unsafe filename rejected: {filename!r}")
        filename = base

    ext = os.path.splitext(filename)[1].lower()
    normalized_allowed = {e.lower() if e.startswith(".") else f".{e.lower()}" for e in allowed_extensions}
    if ext not in normalized_allowed:
        raise FileSecurityError(
            f"File extension '{ext or '(none)'}' is not allowed. Permitted: {sorted(normalized_allowed)}"
        )

    max_bytes = max_size_mb * 1024 * 1024
    if len(content) > max_bytes:
        raise FileSecurityError(
            f"File '{filename}' exceeds maximum size of {max_size_mb} MB ({len(content)} bytes)."
        )

    return ext


def _is_safe_archive_member_path(member_name: str) -> str:
    """Validate and normalize a ZIP member path against path traversal."""
    if "\x00" in member_name:
        raise FileSecurityError(f"Null byte detected in ZIP entry: {member_name!r}")
    # Reject Windows drive letters or leading slashes
    if member_name.startswith("/") or member_name.startswith("\\") or (len(member_name) >= 2 and member_name[1] == ":"):
        raise FileSecurityError(f"Absolute path detected in ZIP archive: {member_name!r}")

    unified = member_name.replace("\\", "/")
    parts = [p for p in unified.split("/") if p not in ("", ".")]
    if any(p == ".." for p in parts):
        raise FileSecurityError(f"Path traversal detected in ZIP archive: {member_name!r}")

    normalized = posixpath.normpath(unified)
    if normalized.startswith("..") or normalized.startswith("/"):
        raise FileSecurityError(f"Unsafe normalized path in ZIP archive: {member_name!r}")
    return normalized


def inspect_and_extract_zip(
    zip_bytes: bytes,
    max_compressed_mb: int = 10,
    max_uncompressed_mb: int = 25,
    max_extracted_files: int = 50,
    allowed_extensions: Sequence[str] = (".py", ".ipynb", ".txt", ".json", ".csv"),
) -> SafeZipResult:
    """
    Inspect ZIP headers BEFORE extracting any bytes.
    Blocks ZIP bombs, symlinks, path traversal, disallowed extensions, and oversized archives.
    """
    if len(zip_bytes) > max_compressed_mb * 1024 * 1024:
        raise FileSecurityError(f"ZIP file exceeds maximum compressed size of {max_compressed_mb} MB.")

    normalized_allowed = {e.lower() if e.startswith(".") else f".{e.lower()}" for e in allowed_extensions}
    max_uncompressed_bytes = max_uncompressed_mb * 1024 * 1024

    try:
        zf = zipfile.ZipFile(io.BytesIO(zip_bytes), mode="r")
    except zipfile.BadZipFile as exc:
        raise FileSecurityError("Uploaded file is not a valid ZIP archive.") from exc

    result = SafeZipResult()

    with zf:
        infos = zf.infolist()
        if not infos:
            raise FileSecurityError("ZIP archive is empty.")

        declared_total = 0
        file_entries: List[zipfile.ZipInfo] = []

        for info in infos:
            # Skip directory entries after validating path
            if info.is_dir():
                _is_safe_archive_member_path(info.filename.rstrip("/"))
                continue

            # Ignore macOS metadata junk safely
            if info.filename.startswith("__MACOSX/") or os.path.basename(info.filename) == ".DS_Store":
                continue

            # Block symlinks inside ZIP (Unix mode stored in upper 16 bits of external_attr)
            unix_mode = info.external_attr >> 16
            if stat.S_ISLNK(unix_mode):
                raise FileSecurityError(f"Symbolic link detected and rejected in ZIP: {info.filename!r}")

            clean_path = _is_safe_archive_member_path(info.filename)
            ext = os.path.splitext(clean_path)[1].lower()
            if ext not in normalized_allowed:
                raise FileSecurityError(
                    f"Disallowed file type '{ext or '(none)'}' in ZIP entry '{clean_path}'. "
                    f"Allowed: {sorted(normalized_allowed)}"
                )

            # Check ZIP bomb ratio & declared size
            if info.file_size > max_uncompressed_bytes:
                raise FileSecurityError(
                    f"ZIP entry '{clean_path}' uncompressed size ({info.file_size} bytes) exceeds limit."
                )
            if info.compress_size > 0:
                ratio = info.file_size / info.compress_size
                if ratio > MAX_COMPRESSION_RATIO and info.file_size > 1024 * 1024:
                    raise FileSecurityError(
                        f"Potential ZIP bomb detected in '{clean_path}' (compression ratio {ratio:.1f}x)."
                    )

            declared_total += info.file_size
            if declared_total > max_uncompressed_bytes:
                raise FileSecurityError(
                    f"Total uncompressed ZIP size exceeds limit of {max_uncompressed_mb} MB."
                )

            file_entries.append(info)
            if len(file_entries) > max_extracted_files:
                raise FileSecurityError(
                    f"ZIP archive contains more than the allowed {max_extracted_files} files."
                )

        if not file_entries:
            raise FileSecurityError("ZIP archive contains no valid files.")

        # Stream-read with hard byte cap (protects against spoofed ZIP headers)
        actual_total = 0
        for info in file_entries:
            clean_path = _is_safe_archive_member_path(info.filename)
            chunks: List[bytes] = []
            with zf.open(info, "r") as member_stream:
                while True:
                    chunk = member_stream.read(65536)
                    if not chunk:
                        break
                    actual_total += len(chunk)
                    if actual_total > max_uncompressed_bytes:
                        raise FileSecurityError(
                            f"Actual uncompressed ZIP stream exceeded {max_uncompressed_mb} MB limit (possible ZIP bomb)."
                        )
                    chunks.append(chunk)
            file_bytes = b"".join(chunks)
            result.files[clean_path] = file_bytes
            result.manifest.append({"path": clean_path, "size_bytes": len(file_bytes)})

        result.total_uncompressed_bytes = actual_total
        result.file_count = len(result.files)

    return result
