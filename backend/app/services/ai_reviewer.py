"""
AI Code Review Service (Thai Language Feedback).

Strict guardrails:
1. AI NEVER decides or overrides deterministic Test Case pass/fail results.
2. AI qualitative rubric scores are returned separately and marked for teacher approval.
3. If LLM_API_KEY is not configured, returns an explicit `unconfigured` status rather than
   fabricating fake AI responses.
"""

from __future__ import annotations

import json
from typing import Any, Dict, List

import httpx

from app.core.config import get_settings


class AIReviewerService:
    def __init__(self) -> None:
        self.settings = get_settings()

    async def review_submission(
        self,
        problem_statement: str,
        student_code: str,
        ast_summary: Dict[str, Any],
        test_results_summary: List[Dict[str, Any]],
        qualitative_criteria: List[Dict[str, Any]],
    ) -> Dict[str, Any]:
        if not self.settings.llm_api_key:
            return {
                "status": "unconfigured",
                "summary_th": "ยังไม่ได้ตั้งค่า LLM_API_KEY ในระบบ จึงข้ามการวิเคราะห์ด้วย AI (ผลการตรวจ AST, Sandbox และ Test Cases ยังคงทำงานตามปกติ)",
                "error_explanation_th": None,
                "fix_suggestions_th": [],
                "readability_notes_th": [],
                "qualitative_scores": {},
            }

        system_prompt = (
            "คุณคือผู้ช่วยตรวจงานเขียนโปรแกรมภาษา Python สำหรับครูผู้สอน "
            "จงตอบกลับเป็น JSON ภาษาไทยเท่านั้น โดยมีคีย์: "
            "summary_th (สรุปภาพรวม), error_explanation_th (อธิบายข้อผิดพลาดถ้ามี), "
            "fix_suggestions_th (array ของคำแนะนำการแก้ไข), "
            "readability_notes_th (array ของข้อสังเกตเรื่องความอ่านง่ายและโครงสร้างโค้ด), "
            "qualitative_scores (object ที่ map ชื่อเกณฑ์เชิงคุณภาพ -> {\"score\": number, \"reason\": string}). "
            "ห้ามเปลี่ยนแปลงผลผ่าน/ไม่ผ่านของ Test Case ที่มีอยู่แล้วโดยเด็ดขาด"
        )

        user_payload = {
            "problem_statement": problem_statement,
            "student_code": student_code[:12000],
            "ast_summary": ast_summary,
            "test_results_summary": test_results_summary,
            "qualitative_criteria": qualitative_criteria,
        }

        url = f"{self.settings.llm_base_url.rstrip('/')}/chat/completions"
        headers = {
            "Authorization": f"Bearer {self.settings.llm_api_key}",
            "Content-Type": "application/json",
        }
        body = {
            "model": self.settings.llm_model,
            "temperature": 0.2,
            "response_format": {"type": "json_object"},
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": json.dumps(user_payload, ensure_ascii=False)},
            ],
        }

        try:
            async with httpx.AsyncClient(timeout=45.0) as client:
                resp = await client.post(url, json=body, headers=headers)
                resp.raise_for_status()
                data = resp.json()
            content = data["choices"][0]["message"]["content"]
            parsed = json.loads(content)
            return {
                "status": "completed",
                "model": self.settings.llm_model,
                "summary_th": parsed.get("summary_th", ""),
                "error_explanation_th": parsed.get("error_explanation_th"),
                "fix_suggestions_th": parsed.get("fix_suggestions_th", []),
                "readability_notes_th": parsed.get("readability_notes_th", []),
                "qualitative_scores": parsed.get("qualitative_scores", {}),
            }
        except Exception as exc:
            return {
                "status": "error",
                "summary_th": f"ไม่สามารถเรียกใช้บริการ AI Code Review ได้ในขณะนี้: {exc}",
                "error_explanation_th": None,
                "fix_suggestions_th": [],
                "readability_notes_th": [],
                "qualitative_scores": {},
            }
