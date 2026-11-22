"""Unit tests for File & ZIP Security Validation (ZIP Bomb, Path Traversal, Disallowed Types)."""

import io
import zipfile

import pytest

from app.services.file_security import FileSecurityError, inspect_and_extract_zip, validate_single_file


def _make_zip(entries: dict[str, bytes], compress_type=zipfile.ZIP_DEFLATED) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression=compress_type) as zf:
        for name, data in entries.items():
            zf.writestr(name, data)
    return buf.getvalue()


def test_valid_zip_passes():
    zbytes = _make_zip({"main.py": b"print('hello')\n", "utils/helper.py": b"x = 1\n"})
    res = inspect_and_extract_zip(zbytes)
    assert res.file_count == 2
    assert "main.py" in res.files
    assert "utils/helper.py" in res.files


def test_path_traversal_blocked():
    zbytes = _make_zip({"../../etc/passwd.py": b"malicious"})
    with pytest.raises(FileSecurityError, match="Path traversal"):
        inspect_and_extract_zip(zbytes)


def test_disallowed_extension_blocked():
    zbytes = _make_zip({"payload.exe": b"MZ..."})
    with pytest.raises(FileSecurityError, match="Disallowed file type"):
        inspect_and_extract_zip(zbytes)


def test_zip_bomb_blocked():
    # 5 MB of repeated zeroes compresses to ~5 KB (> 100x compression ratio)
    bomb_payload = b"\x00" * (5 * 1024 * 1024)
    zbytes = _make_zip({"huge.txt": bomb_payload})
    with pytest.raises(FileSecurityError, match="ZIP bomb|exceeds limit"):
        inspect_and_extract_zip(zbytes, max_uncompressed_mb=25)


def test_single_file_size_and_ext_validation():
    assert validate_single_file("solution.py", b"print(1)", [".py"], max_size_mb=1) == ".py"
    with pytest.raises(FileSecurityError):
        validate_single_file("hack.sh", b"rm -rf /", [".py", ".ipynb"], max_size_mb=1)
