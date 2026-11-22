"""
PDF & Canva Document Extraction and Analysis Service.

Supports:
- Extracting text, page count, word count, and metadata from PDF files (using pypdf).
- Detecting Canva-exported PDFs via PDF Producer/Creator metadata.
- Validating and inspecting public Canva design URLs (https://www.canva.com/design/...).
- Evaluating teacher-defined document rubric rules (required keywords, min pages, min words, Canva requirement).
"""

from __future__ import annotations

import io
import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

import httpx
from pypdf import PdfReader

CANVA_URL_PATTERN = re.compile(
    r"^https?://([a-z0-9-]+\.)*(canva\.com|canva\.site|canva\.link)/.+",
    re.IGNORECASE,
)


class DocumentParseError(ValueError):
    """Raised when a PDF or Canva link cannot be parsed or validated."""


@dataclass
class DocumentAnalysisResult:
    source_type: str  # pdf | canva_url
    title: Optional[str] = None
    page_count: int = 0
    word_count: int = 0
    char_count: int = 0
    is_canva_export: bool = False
    creator: Optional[str] = None
    producer: Optional[str] = None
    extracted_text: str = ""
    canva_url: Optional[str] = None
    accessible: bool = True
    notes_th: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "source_type": self.source_type,
            "title": self.title,
            "page_count": self.page_count,
            "word_count": self.word_count,
            "char_count": self.char_count,
            "is_canva_export": self.is_canva_export,
            "creator": self.creator,
            "producer": self.producer,
            "canva_url": self.canva_url,
            "accessible": self.accessible,
            "text_preview": self.extracted_text[:1500],
            "notes_th": self.notes_th,
        }


def is_canva_url(url: str) -> bool:
    return bool(CANVA_URL_PATTERN.match((url or "").strip()))


def validate_canva_url(url: str) -> str:
    cleaned = (url or "").strip()
    if not is_canva_url(cleaned):
        raise DocumentParseError(
            "รูปแบบลิงก์ Canva ไม่ถูกต้อง กรุณาใช้ลิงก์ที่ขึ้นต้นด้วย https://www.canva.com/design/ หรือ canva.site"
        )
    return cleaned


def analyze_pdf_bytes(pdf_bytes: bytes, filename: str = "document.pdf") -> DocumentAnalysisResult:
    if not pdf_bytes or not pdf_bytes.lstrip().startswith(b"%PDF"):
        raise DocumentParseError(f"ไฟล์ '{filename}' ไม่ใช่ไฟล์ PDF ที่ถูกต้อง")

    try:
        reader = PdfReader(io.BytesIO(pdf_bytes))
    except Exception as exc:
        raise DocumentParseError(f"ไม่สามารถอ่านไฟล์ PDF '{filename}' ได้: {exc}") from exc

    meta = reader.metadata or {}
    creator = str(meta.get("/Creator") or "").replace("\x00", "").strip() or None
    producer = str(meta.get("/Producer") or "").replace("\x00", "").strip() or None
    title = str(meta.get("/Title") or "").replace("\x00", "").strip() or filename

    is_canva = any("canva" in (val or "").lower() for val in (creator, producer))

    pages_text: List[str] = []
    for page in reader.pages:
        try:
            txt = (page.extract_text() or "").replace("\x00", "")
        except Exception:
            txt = ""
        if txt.strip():
            pages_text.append(txt.strip())

    full_text = "\n\n".join(pages_text).replace("\x00", "")
    words = re.findall(r"[\wก-๙]+", full_text)
    notes: List[str] = []
    if is_canva:
        notes.append("ตรวจพบไฟล์ PDF ที่ส่งออกจาก Canva โดยตรง (Metadata: Canva)")
    if len(reader.pages) > 0 and len(words) < 5:
        notes.append("ไฟล์ PDF มีข้อความน้อยมาก (อาจเป็นภาพสแกนหรือสไลด์ที่มีเฉพาะรูปภาพ)")

    return DocumentAnalysisResult(
        source_type="pdf",
        title=title,
        page_count=len(reader.pages),
        word_count=len(words),
        char_count=len(full_text),
        is_canva_export=is_canva,
        creator=creator,
        producer=producer,
        extracted_text=full_text,
        accessible=True,
        notes_th=notes,
    )


async def analyze_canva_url(url: str) -> DocumentAnalysisResult:
    cleaned = validate_canva_url(url)
    title: Optional[str] = None
    description = ""
    accessible = True
    notes: List[str] = []

    try:
        async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
            resp = await client.get(
                cleaned,
                headers={"User-Agent": "Mozilla/5.0 (compatible; PythonAutoGrader/1.0)"},
            )
            if resp.status_code == 200:
                html = resp.text[:40000]
                og_title = re.search(r'<meta[^>]+property=["\']og:title["\'][^>]+content=["\']([^"\']+)["\']', html, re.I)
                og_desc = re.search(r'<meta[^>]+property=["\']og:description["\'][^>]+content=["\']([^"\']+)["\']', html, re.I)
                tag_title = re.search(r"<title>(.*?)</title>", html, re.I | re.S)
                title = (og_title.group(1) if og_title else (tag_title.group(1) if tag_title else None))
                if title:
                    title = title.strip()
                if og_desc:
                    description = og_desc.group(1).strip()
                notes.append("ตรวจสอบลิงก์ Canva สำเร็จ (สามารถเปิดดูได้)")
            else:
                accessible = False
                notes.append(f"ลิงก์ Canva ตอบกลับสถานะ HTTP {resp.status_code} (อาจตั้งค่าเป็นส่วนตัว — แนะนำให้นักเรียนส่งไฟล์ PDF จาก Canva แนบมาด้วย)")
    except Exception:
        accessible = False
        notes.append("ไม่สามารถดึงข้อมูลพรีวิวจากลิงก์ Canva ได้โดยตรง (แนะนำให้นักเรียน Export เป็น PDF แนบคู่กันเพื่อตรวจข้อความครบถ้วน)")

    combined = "\n".join(p for p in (title or "", description) if p).strip()
    words = re.findall(r"[\wก-๙]+", combined)
    return DocumentAnalysisResult(
        source_type="canva_url",
        title=title or "Canva Design",
        page_count=1 if accessible else 0,
        word_count=len(words),
        char_count=len(combined),
        is_canva_export=True,
        creator="Canva",
        extracted_text=combined,
        canva_url=cleaned,
        accessible=accessible,
        notes_th=notes,
    )


def evaluate_document_rule(doc: DocumentAnalysisResult, rule_config: Dict[str, Any]) -> tuple[bool, float, str, Dict[str, Any]]:
    """
    Evaluate a document-based rubric criterion (PDF / Canva).
    Supported rule_config keys:
    - required_keywords: List[str] (case-insensitive substring match in extracted text/title)
    - min_pages: int
    - min_words: int
    - require_canva: bool
    """
    checks_total = 0
    checks_passed = 0
    reasons: List[str] = []
    evidence: Dict[str, Any] = {
        "page_count": doc.page_count,
        "word_count": doc.word_count,
        "is_canva_export": doc.is_canva_export,
    }

    text_lower = f"{doc.title or ''}\n{doc.extracted_text}".lower()

    req_keywords = rule_config.get("required_keywords") or []
    if req_keywords:
        found = [kw for kw in req_keywords if str(kw).lower() in text_lower]
        missing = [kw for kw in req_keywords if str(kw).lower() not in text_lower]
        checks_total += len(req_keywords)
        checks_passed += len(found)
        evidence["keywords_found"] = found
        evidence["keywords_missing"] = missing
        if missing:
            reasons.append(f"ไม่พบคำสำคัญในเอกสาร: {', '.join(missing)}")
        else:
            reasons.append(f"พบคำสำคัญครบถ้วน ({len(found)} คำ)")

    min_pages = rule_config.get("min_pages")
    if min_pages is not None:
        checks_total += 1
        if doc.page_count >= int(min_pages):
            checks_passed += 1
            reasons.append(f"จำนวนหน้าผ่านเกณฑ์ ({doc.page_count} >= {min_pages} หน้า)")
        else:
            reasons.append(f"จำนวนหน้าไม่ถึงเกณฑ์ ({doc.page_count} < {min_pages} หน้า)")

    min_words = rule_config.get("min_words")
    if min_words is not None:
        checks_total += 1
        if doc.word_count >= int(min_words):
            checks_passed += 1
            reasons.append(f"จำนวนคำผ่านเกณฑ์ ({doc.word_count} >= {min_words} คำ)")
        else:
            reasons.append(f"จำนวนคำไม่ถึงเกณฑ์ ({doc.word_count} < {min_words} คำ)")

    if rule_config.get("require_canva"):
        checks_total += 1
        if doc.is_canva_export:
            checks_passed += 1
            reasons.append("ยืนยันว่าเป็นงานจาก Canva")
        else:
            reasons.append("ไม่พบข้อมูลว่าเป็นไฟล์หรือลิงก์จาก Canva")

    if checks_total == 0:
        # Default check: document is readable and has content
        passed = doc.accessible and (doc.page_count > 0 or doc.word_count > 0)
        ratio = 1.0 if passed else 0.0
        reason = "เอกสารสามารถเปิดอ่านและมีเนื้อหาครบถ้วน" if passed else "ไม่พบเนื้อหาที่อ่านได้ในเอกสาร"
        return passed, ratio, reason, evidence

    ratio = checks_passed / checks_total
    return checks_passed == checks_total, ratio, " | ".join(reasons), evidence
