"""
Google Colab URL & Jupyter Notebook (.ipynb) Parser Service.

- Validates Google Colab / Google Drive URLs
- Extracts Google Drive File ID
- Parses .ipynb files using nbformat
- Separates Markdown cells, Code cells, and saved outputs (for display only, never trusted as execution proof)
- Preserves cell order and builds an executable Code Bundle for the grading engine
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

import nbformat

# Supported Colab & Drive URL patterns
_COLAB_PATTERNS = [
    re.compile(r"^https?://colab\.research\.google\.com/drive/([A-Za-z0-9_-]{10,})"),
    re.compile(r"^https?://drive\.google\.com/file/d/([A-Za-z0-9_-]{10,})"),
    re.compile(r"^https?://drive\.google\.com/open\?id=([A-Za-z0-9_-]{10,})"),
    re.compile(r"^https?://colab\.research\.google\.com/.*?[?&]id=([A-Za-z0-9_-]{10,})"),
]


class NotebookParseError(ValueError):
    """Raised when a Colab URL or .ipynb file is invalid or unreadable."""


@dataclass
class ParsedCell:
    cell_index: int
    cell_type: str  # "code" | "markdown" | "raw"
    source_code: str
    saved_outputs: List[Dict[str, Any]] = field(default_factory=list)
    execution_count: Optional[int] = None


@dataclass
class ParsedNotebook:
    cells: List[ParsedCell] = field(default_factory=list)
    markdown_cells: List[ParsedCell] = field(default_factory=list)
    code_cells: List[ParsedCell] = field(default_factory=list)
    code_bundle: str = ""
    nbformat_version: int = 4


def extract_drive_file_id_from_colab_url(url: str) -> str:
    """Validate Colab/Drive URL and extract the Google Drive File ID."""
    cleaned = (url or "").strip()
    if not cleaned:
        raise NotebookParseError("Colab URL is empty.")
    for pattern in _COLAB_PATTERNS:
        match = pattern.search(cleaned)
        if match:
            return match.group(1)
    raise NotebookParseError(
        "Invalid Google Colab or Google Drive URL format. Expected e.g. "
        "https://colab.research.google.com/drive/<FILE_ID>"
    )


def _strip_ipython_magics(source: str) -> str:
    """Comment out Jupyter/Colab line magics (%...) and shell escapes (!...) so Python AST & Sandbox can run cleanly."""
    cleaned_lines: List[str] = []
    for line in source.splitlines():
        stripped = line.lstrip()
        if stripped.startswith("%") or stripped.startswith("!"):
            cleaned_lines.append(f"# [notebook-magic-disabled] {line}")
        else:
            cleaned_lines.append(line)
    return "\n".join(cleaned_lines)


def _normalize_outputs(raw_outputs: Any) -> List[Dict[str, Any]]:
    normalized: List[Dict[str, Any]] = []
    if not isinstance(raw_outputs, list):
        return normalized
    for out in raw_outputs:
        if not isinstance(out, dict):
            continue
        output_type = str(out.get("output_type", "unknown"))
        entry: Dict[str, Any] = {"output_type": output_type}
        if "text" in out:
            text_val = out["text"]
            entry["text"] = "".join(text_val) if isinstance(text_val, list) else str(text_val)
        if "data" in out and isinstance(out["data"], dict):
            if "text/plain" in out["data"]:
                plain = out["data"]["text/plain"]
                entry["text_plain"] = "".join(plain) if isinstance(plain, list) else str(plain)
        if output_type == "error":
            entry["ename"] = str(out.get("ename", ""))
            entry["evalue"] = str(out.get("evalue", ""))
        normalized.append(entry)
    return normalized


def parse_ipynb_bytes(content: bytes) -> ParsedNotebook:
    """Parse raw .ipynb JSON bytes into structured cells and an ordered Python code bundle."""
    try:
        text = content.decode("utf-8")
        nb = nbformat.reads(text, as_version=4)
    except Exception as exc:
        raise NotebookParseError(f"Failed to parse .ipynb notebook: {exc}") from exc

    parsed = ParsedNotebook(nbformat_version=int(nb.get("nbformat", 4)))
    code_segments: List[str] = []

    for idx, cell in enumerate(nb.get("cells", [])):
        ctype = str(cell.get("cell_type", "raw"))
        if ctype not in ("code", "markdown", "raw"):
            ctype = "raw"
        src = cell.get("source", "")
        if isinstance(src, list):
            src = "".join(src)
        saved_outputs = _normalize_outputs(cell.get("outputs", [])) if ctype == "code" else []
        exec_count = cell.get("execution_count") if ctype == "code" else None

        pcell = ParsedCell(
            cell_index=idx,
            cell_type=ctype,
            source_code=src,
            saved_outputs=saved_outputs,
            execution_count=exec_count if isinstance(exec_count, int) else None,
        )
        parsed.cells.append(pcell)

        if ctype == "markdown":
            parsed.markdown_cells.append(pcell)
        elif ctype == "code":
            parsed.code_cells.append(pcell)
            sanitized = _strip_ipython_magics(src)
            if sanitized.strip():
                code_segments.append(f"# --- Cell {idx} ---\n{sanitized}")

    parsed.code_bundle = "\n\n".join(code_segments)
    return parsed
