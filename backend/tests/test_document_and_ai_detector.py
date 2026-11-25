"""Unit tests for PDF/Canva Document Analyzer and AI Usage % Estimator."""

import pytest
from pypdf import PdfWriter
import io

from app.services.ai_detector import estimate_ai_usage
from app.services.document_analyzer import (
    DocumentAnalysisResult,
    DocumentParseError,
    analyze_pdf_bytes,
    evaluate_document_rule,
    extract_numbered_answers,
    is_canva_url,
    validate_canva_url,
)


def _make_sample_pdf(producer: str = "Canva") -> bytes:
    writer = PdfWriter()
    writer.add_blank_page(width=200, height=200)
    writer.add_metadata({"/Producer": producer, "/Title": "Python Report"})
    buf = io.BytesIO()
    writer.write(buf)
    return buf.getvalue()


def test_canva_url_validation():
    assert is_canva_url("https://www.canva.com/design/DAG123456/view")
    assert is_canva_url("https://myproject.my.canva.site/slides")
    assert not is_canva_url("https://example.com/not-canva")
    assert validate_canva_url("https://www.canva.com/design/DAG123/edit").startswith("https://www.canva.com")
    with pytest.raises(DocumentParseError):
        validate_canva_url("https://google.com")


def test_pdf_canva_metadata_and_document_rule():
    pdf_bytes = _make_sample_pdf(producer="Canva")
    doc = analyze_pdf_bytes(pdf_bytes, filename="slides.pdf")
    assert doc.page_count == 1
    assert doc.is_canva_export is True

    passed, ratio, reason, _ev = evaluate_document_rule(doc, {"min_pages": 1, "require_canva": True})
    assert passed is True
    assert ratio == 1.0


@pytest.mark.asyncio
async def test_ai_usage_estimator_python_and_document():
    human_code = "x = [1, 2, 3]\nx.append(4)\nprint(x)\n"
    ai_like_code = (
        '"""Comprehensive queue implementation."""\n'
        "# Step 1: Initialize the queue\n"
        "def enqueue(q: list, val: str) -> list:\n"
        '    """Add an item to the queue and return it."""\n'
        "    # Step 2: Append value\n"
        "    q.append(val)\n"
        "    return q\n\n"
        'if __name__ == "__main__":\n'
        "    # Example usage\n"
        "    print('✅ Done:', enqueue([], 'A'))\n"
    )
    res_human = await estimate_ai_usage(human_code, content_type="python_code")
    res_ai = await estimate_ai_usage(ai_like_code, content_type="python_code")
    assert 0 <= res_human["estimated_ai_percent"] <= 100
    assert 0 <= res_ai["estimated_ai_percent"] <= 100
    assert res_ai["estimated_ai_percent"] > res_human["estimated_ai_percent"]

    ai_doc = (
        "ในยุคปัจจุบัน เทคโนโลยีมีบทบาทสำคัญอย่างยิ่ง ดังต่อไปนี้\n"
        "1. ช่วยลดเวลาในการทำงานประจำวัน\n"
        "2. เพิ่มความแม่นยำในการวิเคราะห์ข้อมูล\n"
        "3. นอกจากนี้ยังช่วยพัฒนาทักษะการคิดวิเคราะห์\n"
        "4. โดยสรุปแล้ว การนำเทคโนโลยีมาใช้เพื่อเพิ่มประสิทธิภาพจึงจำเป็นมาก\n"
        "5. กล่าวโดยสรุป ผู้เรียนควรฝึกฝนอย่างต่อเนื่องในทุกๆ ด้าน\n"
    )
    res_doc = await estimate_ai_usage(ai_doc, content_type="document_text")
    assert res_doc["estimated_ai_percent"] >= 35
    assert len(res_doc["signals_th"]) >= 1


def test_pdf_answer_key_per_question_grading():
    sample_pdf_text = (
        "ใบงานเรื่อง โครงสร้างข้อมูล\n"
        "ข้อ 1. ตอบ ก\n"
        "ข้อ 2. การทำงานของคิวคือ FIFO (เข้าก่อนออกก่อน)\n"
        "3. ตอบ การคำนวณค่าเฉลี่ย 3.14\n"
        "4) ตอบ B\n"
        "ข้อที่ ๕ ตอบ ผิด\n"
    )
    parsed = extract_numbered_answers(sample_pdf_text)
    assert set(parsed.keys()) == {"1", "2", "3", "4", "5"}
    assert "3.14" in parsed["3"]

    doc = DocumentAnalysisResult(
        source_type="pdf",
        title="worksheet.pdf",
        page_count=1,
        word_count=25,
        char_count=len(sample_pdf_text),
        extracted_text=sample_pdf_text,
    )

    rule = {
        "answer_key": [
            {"question": "1", "expected": ["ก"], "match_mode": "exact_choice", "points": 2},
            {"question": "2", "expected": ["FIFO", "เข้าก่อนออกก่อน"], "match_mode": "all", "points": 2},
            # 'ก' must NOT falsely match inside 'การคำนวณ'
            {"question": "3", "expected": ["ก"], "match_mode": "exact_choice", "points": 2},
            {"question": "4", "expected": ["B"], "match_mode": "exact_choice", "points": 2},
            {"question": "5", "expected": ["ถูก"], "match_mode": "any", "points": 2},
        ]
    }
    passed, ratio, reason, ev = evaluate_document_rule(doc, rule)
    assert passed is False
    assert ratio == pytest.approx(0.6)  # 3/5 questions correct (Q1, Q2, Q4)
    assert ev["correct_count"] == 3
    assert ev["total_questions"] == 5
    assert [q["correct"] for q in ev["question_results"]] == [True, True, False, True, False]
    assert "ถูก 3/5 ข้อ" in reason
