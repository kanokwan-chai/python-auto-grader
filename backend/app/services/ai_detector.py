"""
AI Usage Percentage Estimator Service.

Estimates the likelihood/percentage (0-100%) of AI-assisted generation in:
1. Python source code (.py, .ipynb, Colab)
2. Document text (PDF, Canva exports)

Design principles:
- Transparent, evidence-based Thai signals (`signals_th`) so teachers can inspect WHY.
- Uses deterministic linguistic/structural heuristics (always available offline) and
  optionally blends with LLM forensic estimation when `LLM_API_KEY` is configured.
- NEVER automatically penalizes or zeros a student's score — advisory metric for teachers only.
"""

from __future__ import annotations

import json
import re
import statistics
from typing import Any, Dict, List, Optional

import httpx

from app.core.config import get_settings

AI_THAI_PHRASES = [
    "ดังต่อไปนี้",
    "โดยสรุปแล้ว",
    "ในยุคปัจจุบัน",
    "มีบทบาทสำคัญอย่างยิ่ง",
    "นอกจากนี้ยัง",
    "กล่าวโดยสรุป",
    "สามารถแบ่งออกเป็น",
    "เพื่อเพิ่มประสิทธิภาพ",
]

AI_EN_PHRASES = [
    "in conclusion",
    "furthermore",
    "moreover",
    "it is important to note",
    "delve into",
    "comprehensive overview",
    "plays a crucial role",
    "let's break down",
]

AI_CODE_COMMENT_PATTERNS = [
    r"#\s*step\s*\d+\s*:",
    r"#\s*ขั้นตอนที่\s*\d+",
    r"#\s*(initialize|define|create|check|display|print)\s+the\s+",
    r"#\s*example\s+usage",
    r"#\s*ตัวอย่างการใช้งาน",
]


def _estimate_python_code_ai_usage(code: str) -> Dict[str, Any]:
    lines = [ln for ln in code.splitlines() if ln.strip()]
    total_lines = len(lines)
    if total_lines < 4:
        return {
            "estimated_ai_percent": 5,
            "risk_level": "low",
            "confidence": "low",
            "content_type": "python_code",
            "signals_th": ["โค้ดสั้นมาก (น้อยกว่า 4 บรรทัด) ข้อมูลยังไม่เพียงพอต่อการประเมินสูง"],
            "disclaimer_th": "ค่านี้เป็นการประเมินเบื้องต้นจากโครงสร้างโค้ดเท่านั้น ครูผู้สอนควรใช้ประกอบการพิจารณา",
        }

    score = 8
    signals: List[str] = []

    comment_lines = [ln for ln in lines if ln.strip().startswith("#")]
    comment_ratio = len(comment_lines) / max(total_lines, 1)
    if comment_ratio >= 0.30 and len(comment_lines) >= 4:
        score += 22
        signals.append(f"สัดส่วนคอมเมนต์อธิบายทีละบรรทัดสูงผิดปกติ ({int(comment_ratio * 100)}% ของโค้ด)")
    elif comment_ratio >= 0.18 and len(comment_lines) >= 3:
        score += 10
        signals.append(f"มีคอมเมนต์อธิบายอย่างเป็นระบบ ({len(comment_lines)} บรรทัด)")

    # Check step-by-step LLM comment patterns
    step_hits = sum(
        1 for pat in AI_CODE_COMMENT_PATTERNS if re.search(pat, code, re.IGNORECASE)
    )
    if step_hits > 0:
        score += min(28, step_hits * 14)
        signals.append("พบรูปแบบคอมเมนต์เรียงขั้นตอนแบบ AI (เช่น Step 1:, ขั้นตอนที่ 1, Example usage)")

    # Triple-quoted docstrings + type hints in short student exercises
    has_docstring = bool(re.search(r'"""[\s\S]{20,}?"""', code))
    has_type_hints = bool(re.search(r"def\s+\w+\([^)]*:\s*[A-Za-z\[\]]+[^)]*\)\s*->", code))
    if has_docstring:
        score += 15
        signals.append("มี Docstring อธิบายฟังก์ชันแบบทางการ (\"\"\"...\"\"\")")
    if has_type_hints:
        score += 14
        signals.append("มีการระบุ Type Hints ครบทั้งพารามิเตอร์และค่าคืนกลับ (def f(x: ...) -> ...)")

    # Boilerplate `if __name__ == "__main__":` + `try/except` in short homework
    if 'if __name__ == "__main__"' in code or "if __name__ == '__main__'" in code:
        score += 12
        signals.append('มีโครงสร้างมาตรฐาน `if __name__ == "__main__":`')

    # Emoji or bullet formatting inside print statements
    if re.search(r"[✅❌⚠️🚀✨📌]", code):
        score += 10
        signals.append("พบการใช้ Emoji ในข้อความแสดงผลซึ่งพบบ่อยในโค้ดที่สร้างจาก AI")

    if not signals:
        signals.append("รูปแบบการเขียนโค้ดเป็นธรรมชาติ ไม่พบสัญญาณโครงสร้างสำเร็จรูปจาก AI ชัดเจน")

    pct = max(0, min(98, int(round(score))))
    risk = "high" if pct >= 65 else ("moderate" if pct >= 35 else "low")
    confidence = "medium" if total_lines >= 12 else "low"

    return {
        "estimated_ai_percent": pct,
        "risk_level": risk,
        "confidence": confidence,
        "content_type": "python_code",
        "signals_th": signals,
        "disclaimer_th": "ค่านี้เป็นการประเมินเบื้องต้นจากรูปแบบและโครงสร้างโค้ดเท่านั้น ครูผู้สอนควรใช้ประกอบการพิจารณา",
    }


def _estimate_document_text_ai_usage(text: str) -> Dict[str, Any]:
    cleaned = (text or "").strip()
    words = re.findall(r"[\wก-๙]+", cleaned)
    if len(words) < 15:
        return {
            "estimated_ai_percent": 10,
            "risk_level": "low",
            "confidence": "low",
            "content_type": "document_text",
            "signals_th": ["ข้อความในเอกสารมีน้อย (น้อยกว่า 15 คำ) จึงยังไม่สามารถประเมินการใช้ AI ได้ชัดเจน"],
            "disclaimer_th": "ค่านี้เป็นการประเมินเบื้องต้นจากรูปแบบภาษาเท่านั้น ครูผู้สอนควรใช้ประกอบการพิจารณา",
        }

    score = 10
    signals: List[str] = []
    lower = cleaned.lower()

    th_hits = [p for p in AI_THAI_PHRASES if p in cleaned]
    en_hits = [p for p in AI_EN_PHRASES if p in lower]
    total_phrase_hits = len(th_hits) + len(en_hits)
    if total_phrase_hits > 0:
        score += min(35, total_phrase_hits * 12)
        sample = ", ".join((th_hits + en_hits)[:4])
        signals.append(f"พบสำนวนเชื่อมข้อความที่พบบ่อยในงานสร้างจาก AI ({sample})")

    # Numbered / bulleted list density
    lines = [ln.strip() for ln in cleaned.splitlines() if ln.strip()]
    bullet_lines = [ln for ln in lines if re.match(r"^(\d+[\.\)]|[-•●▪\*])\s+", ln)]
    if len(lines) >= 6 and (len(bullet_lines) / len(lines)) >= 0.45:
        score += 18
        signals.append("โครงสร้างเนื้อหาเรียงเป็นข้อ/หัวข้อย่อยสม่ำเสมอในสัดส่วนสูง")

    # Sentence length uniformity (low burstiness -> more AI-like)
    sentences = [s.strip() for s in re.split(r"[.!?\n]+", cleaned) if len(s.strip()) > 12]
    if len(sentences) >= 5:
        lengths = [len(s) for s in sentences]
        mean_len = statistics.mean(lengths)
        stdev_len = statistics.pstdev(lengths)
        cv = stdev_len / mean_len if mean_len > 0 else 1.0
        if cv < 0.35:
            score += 20
            signals.append("ความยาวประโยคมีความสม่ำเสมอสูงผิดปกติ (Low Burstiness)")

    if not signals:
        signals.append("สำนวนและความหลากหลายของประโยคดูเป็นธรรมชาติ ไม่พบสัญญาณการใช้ AI ชัดเจน")

    pct = max(0, min(98, int(round(score))))
    risk = "high" if pct >= 65 else ("moderate" if pct >= 35 else "low")
    confidence = "medium" if len(words) >= 60 else "low"

    return {
        "estimated_ai_percent": pct,
        "risk_level": risk,
        "confidence": confidence,
        "content_type": "document_text",
        "signals_th": signals,
        "disclaimer_th": "ค่านี้เป็นการประเมินเบื้องต้นจากรูปแบบภาษาและโครงสร้างเอกสารเท่านั้น ครูผู้สอนควรใช้ประกอบการพิจารณา",
    }


async def estimate_ai_usage(
    content: str,
    content_type: str = "python_code",
) -> Dict[str, Any]:
    """
    Estimate AI usage percentage (0-100%).
    Runs deterministic heuristic analysis and optionally enriches with LLM API if configured.
    """
    base = (
        _estimate_python_code_ai_usage(content)
        if content_type == "python_code"
        else _estimate_document_text_ai_usage(content)
    )

    settings = get_settings()
    if not settings.llm_api_key or len((content or "").strip()) < 40:
        return base

    # Optional LLM forensic refinement when LLM_API_KEY is set
    try:
        prompt = (
            "ประเมินเปอร์เซ็นต์ความเป็นไปได้ที่ผลงานต่อไปนี้ถูกสร้างหรือช่วยเหลือโดย AI (0 ถึง 100) "
            'ตอบเป็น JSON เท่านั้น: {"estimated_ai_percent": <int 0-100>, "reason_th": "<เหตุผลสั้นๆ ภาษาไทย>"}\n\n'
            f"ประเภทงาน: {content_type}\nเนื้อหา:\n{content[:3500]}"
        )
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.post(
                f"{settings.llm_base_url.rstrip('/')}/chat/completions",
                headers={
                    "Authorization": f"Bearer {settings.llm_api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": settings.llm_model,
                    "temperature": 0.1,
                    "response_format": {"type": "json_object"},
                    "messages": [{"role": "user", "content": prompt}],
                },
            )
            if resp.status_code == 200:
                parsed = json.loads(resp.json()["choices"][0]["message"]["content"])
                llm_pct = max(0, min(100, int(parsed.get("estimated_ai_percent", base["estimated_ai_percent"]))))
                blended = int(round((base["estimated_ai_percent"] * 0.4) + (llm_pct * 0.6)))
                base["estimated_ai_percent"] = blended
                base["risk_level"] = "high" if blended >= 65 else ("moderate" if blended >= 35 else "low")
                base["confidence"] = "high"
                if parsed.get("reason_th"):
                    base["signals_th"].insert(0, f"AI Forensic: {parsed['reason_th']}")
    except Exception:
        pass

    return base
