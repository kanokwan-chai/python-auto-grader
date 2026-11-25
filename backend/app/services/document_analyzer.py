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
        parsed_answers = extract_numbered_answers(self.extracted_text)
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
            "text_preview": self.extracted_text[:6000],
            "detected_question_count": len(parsed_answers),
            "notes_th": self.notes_th,
        }


THAI_DIGITS_TABLE = str.maketrans("๐๑๒๓๔๕๖๗๘๙", "0123456789")

# Matches question markers like: ข้อ 1, ข้อที่ 1., 1., 1), (1), Q1:, Q1.
# Carefully avoids decimal numbers like 3.14 by requiring non-digit after '.'
_QUESTION_MARKER_RE = re.compile(
    r"(?:^|[\r\n]+|[ \t]{2,})"
    r"(?:"
    r"(?:ข้อที่|ข้อ)\s*(\d{1,3})\s*[.):\-]?"
    r"|[Qq]\s*(\d{1,3})\s*[.):\-]"
    r"|\(\s*(\d{1,3})\s*\)"
    r"|(\d{1,3})\s*(?:[):]|\.(?!\d))"
    r")",
    re.MULTILINE,
)

_SINGLE_CHOICE_TOKENS = {"ก", "ข", "ค", "ง", "จ", "a", "b", "c", "d", "e"}


def _normalize_text(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").translate(THAI_DIGITS_TABLE)).strip()


def extract_numbered_answers(text: str) -> Dict[str, str]:
    """
    Parse a student's PDF text into per-question segments keyed by normalized question number ("1", "2", ...).
    Supports Thai/English numbering (ข้อ 1, ข้อที่ 1, 1., 1), (1), Q1:) and Thai digits (๑, ๒, ๓).
    """
    if not text or not text.strip():
        return {}
    normalized = text.translate(THAI_DIGITS_TABLE)
    matches = list(_QUESTION_MARKER_RE.finditer(normalized))
    if not matches:
        return {}

    segments: Dict[str, str] = {}
    for idx, match in enumerate(matches):
        q_num = next((g for g in match.groups() if g is not None), None)
        if not q_num:
            continue
        q_key = str(int(q_num))  # normalize "01" -> "1"
        start = match.end()
        end = matches[idx + 1].start() if idx + 1 < len(matches) else len(normalized)
        body = _normalize_text(normalized[start:end])
        if q_key in segments and segments[q_key]:
            # Keep the richer segment if the question number appears twice (e.g., header + answer)
            if len(body) > len(segments[q_key]):
                segments[q_key] = body
        else:
            segments[q_key] = body
    return segments


def _normalize_expected_list(expected_raw: Any) -> List[str]:
    if isinstance(expected_raw, list):
        items = [str(x).strip() for x in expected_raw if str(x).strip()]
    elif isinstance(expected_raw, str):
        items = [p.strip() for p in re.split(r"[,;|/]", expected_raw) if p.strip()]
    elif expected_raw is not None:
        items = [str(expected_raw).strip()]
    else:
        items = []
    return items


def _match_single_choice(answer_text: str, choice: str) -> bool:
    """
    Match a single-letter multiple-choice answer (ก/ข/ค/ง/A/B/C/D) safely so 'ก' doesn't match inside 'การ'.
    """
    norm_ans = _normalize_text(answer_text).lower()
    norm_choice = _normalize_text(choice).lower()
    if not norm_ans or not norm_choice:
        return False

    # 1. Explicit "ตอบ ..." prefix (e.g. "ตอบ ก", "ตอบ: (A)", "Answer: B")
    explicit = re.search(
        r"(?:คำตอบ|ตอบ|answer|ans)\s*[:=\-]?\s*\(?([ก-จa-z0-9]+)\)?",
        norm_ans,
        re.IGNORECASE,
    )
    if explicit and explicit.group(1).lower() == norm_choice:
        return True

    # 2. Exact match after stripping punctuation/parentheses (e.g. "(ก).", "ก.", "A)")
    stripped = re.sub(r"^[\s(\[{:.\-]+|[\s)\]}:.\-]+$", "", norm_ans)
    if stripped == norm_choice:
        return True

    # 3. Leading choice token before explanation (e.g. "ก. ถูกต้อง", "B) because ...")
    leading = re.match(r"^\(?([ก-จa-z])\)?(?:[\s.):\-]|$)", norm_ans, re.IGNORECASE)
    if leading and leading.group(1).lower() == norm_choice:
        return True

    # 4. Standalone token bounded by non-Thai/non-ASCII word chars
    boundary = re.search(
        rf"(?<![a-z0-9ก-๙]){re.escape(norm_choice)}(?![a-z0-9ก-๙])",
        norm_ans,
        re.IGNORECASE,
    )
    return bool(boundary)


def _match_expected_answer(answer_text: str, expected_items: List[str], match_mode: str = "any") -> tuple[bool, List[str]]:
    if not expected_items:
        return bool(answer_text.strip()), []

    norm_ans = _normalize_text(answer_text).lower()
    matched: List[str] = []

    for exp in expected_items:
        norm_exp = _normalize_text(exp).lower()
        if not norm_exp:
            continue
        use_choice_matcher = match_mode == "exact_choice" or norm_exp in _SINGLE_CHOICE_TOKENS
        if use_choice_matcher:
            if _match_single_choice(norm_ans, norm_exp):
                matched.append(exp)
        else:
            if norm_exp in norm_ans:
                matched.append(exp)

    if match_mode == "all":
        return len(matched) == len(expected_items), matched
    return len(matched) > 0, matched


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
    - answer_key: List[Dict] for per-question answer checking:
        [{"question": "1", "prompt": "...", "expected": ["ก", "A"], "match_mode": "any"|"all"|"exact_choice", "points": 1}]
    - required_keywords: List[str] (case-insensitive substring match in extracted text/title)
    - min_pages: int
    - min_words: int
    - require_canva: bool
    """
    checks_total = 0.0
    checks_passed = 0.0
    reasons: List[str] = []
    evidence: Dict[str, Any] = {
        "page_count": doc.page_count,
        "word_count": doc.word_count,
        "is_canva_export": doc.is_canva_export,
    }

    full_doc_text = f"{doc.title or ''}\n{doc.extracted_text}"
    text_lower = full_doc_text.translate(THAI_DIGITS_TABLE).lower()

    answer_key = rule_config.get("answer_key") or []
    if isinstance(answer_key, list) and len(answer_key) > 0:
        numbered_answers = extract_numbered_answers(doc.extracted_text)
        question_results: List[Dict[str, Any]] = []
        correct_qs: List[str] = []
        wrong_qs: List[str] = []
        total_q_points = 0.0
        earned_q_points = 0.0

        for idx, item in enumerate(answer_key):
            if not isinstance(item, dict):
                continue
            q_num_raw = str(item.get("question") or (idx + 1)).translate(THAI_DIGITS_TABLE).strip()
            q_digits = re.search(r"\d+", q_num_raw)
            q_key = str(int(q_digits.group(0))) if q_digits else q_num_raw
            prompt = str(item.get("prompt") or "").strip()
            expected_list = _normalize_expected_list(item.get("expected"))
            match_mode = str(item.get("match_mode") or "any").strip().lower()
            pts = float(item.get("points") or 1.0)
            if pts <= 0:
                pts = 1.0

            student_segment = numbered_answers.get(q_key, "")
            used_fallback = False
            if not student_segment and not numbered_answers and match_mode != "exact_choice":
                # Fallback when PDF has no numbered structure: search full text for non-choice answers
                if not any(_normalize_text(e).lower() in _SINGLE_CHOICE_TOKENS for e in expected_list):
                    student_segment = _normalize_text(doc.extracted_text)
                    used_fallback = True

            is_correct, matched_items = _match_expected_answer(student_segment, expected_list, match_mode=match_mode)
            total_q_points += pts
            if is_correct:
                earned_q_points += pts
                correct_qs.append(q_key)
            else:
                wrong_qs.append(q_key)

            question_results.append(
                {
                    "question": q_key,
                    "prompt": prompt,
                    "expected": expected_list,
                    "match_mode": match_mode,
                    "student_answer": (student_segment[:240] if not used_fallback else "(ไม่พบเลขข้อ — ตรวจจากเนื้อหาทั้งเอกสาร)"),
                    "matched": matched_items,
                    "correct": is_correct,
                    "awarded_points": pts if is_correct else 0.0,
                    "max_points": pts,
                }
            )

        evidence["question_results"] = question_results
        evidence["correct_count"] = len(correct_qs)
        evidence["total_questions"] = len(question_results)
        evidence["earned_question_points"] = earned_q_points
        evidence["total_question_points"] = total_q_points

        checks_total += total_q_points
        checks_passed += earned_q_points

        summary_parts = [f"ตรวจเฉลย PDF ถูก {len(correct_qs)}/{len(question_results)} ข้อ"]
        if correct_qs:
            summary_parts.append(f"ข้อที่ถูก: {', '.join(correct_qs)}")
        if wrong_qs:
            summary_parts.append(f"ข้อที่ผิด: {', '.join(wrong_qs)}")
        reasons.append(" (".join([summary_parts[0], " | ".join(summary_parts[1:]) + ")"]) if len(summary_parts) > 1 else summary_parts[0])

    req_keywords = rule_config.get("required_keywords") or []
    if req_keywords:
        found = [kw for kw in req_keywords if str(kw).translate(THAI_DIGITS_TABLE).lower() in text_lower]
        missing = [kw for kw in req_keywords if str(kw).translate(THAI_DIGITS_TABLE).lower() not in text_lower]
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
    return checks_passed >= checks_total, ratio, " | ".join(reasons), evidence
