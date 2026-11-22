"""
Rubric Scoring Engine.

Evaluates criteria across:
- ast: deterministic Python AST structural checks
- runtime: sandbox execution success (exit_code == 0, no timeout)
- test_case: deterministic test case pass ratio or specific named test cases
- ai_qualitative: qualitative suggestion (tracked separately from deterministic score)
- manual: pending teacher grading

Enforces strict bounds: 0 <= criterion_score <= criterion.max_score and
0 <= total_score <= assignment_max_score.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal, ROUND_HALF_UP
from typing import Any, Dict, List, Optional

from app.services.ast_analyzer import ASTAnalysisResult, evaluate_ast_rule
from app.services.document_analyzer import DocumentAnalysisResult, evaluate_document_rule
from app.services.sandbox_client import SandboxExecutionResult
from app.services.test_engine import EvaluatedTestResult


@dataclass
class RubricCriterionSpec:
    id: Optional[str]
    name: str
    description: Optional[str]
    max_score: Decimal
    check_method: str  # ast | runtime | test_case | ai_qualitative | manual
    rule_config: Dict[str, Any] = field(default_factory=dict)
    allow_partial_credit: bool = True


@dataclass
class EvaluatedCriterionResult:
    criterion_id: Optional[str]
    criterion_name: str
    check_method: str
    max_score: Decimal
    awarded_score: Decimal
    status: str  # passed | partial | failed | pending_review | error
    reason: str
    evidence: Dict[str, Any]
    is_ai_evaluated: bool = False


def _quantize(val: Decimal) -> Decimal:
    return val.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def clamp_score(score: Decimal, max_score: Decimal) -> Decimal:
    if score < Decimal("0"):
        return Decimal("0.00")
    if score > max_score:
        return _quantize(max_score)
    return _quantize(score)


def evaluate_rubric(
    criteria: List[RubricCriterionSpec],
    assignment_max_score: Decimal,
    ast_analysis: Optional[ASTAnalysisResult],
    runtime_result: Optional[SandboxExecutionResult],
    test_results: List[EvaluatedTestResult],
    ai_qualitative_scores: Optional[Dict[str, Dict[str, Any]]] = None,
    document_analysis: Optional[DocumentAnalysisResult] = None,
) -> Dict[str, Any]:
    """
    Evaluate all rubric criteria and compute:
    - criterion_results: List[EvaluatedCriterionResult]
    - automated_score: deterministic score (AST + Runtime + Test Cases only)
    - ai_suggested_score: qualitative AI score (kept strictly separate for teacher review)
    - final_score: initial final score (= automated_score, bounded to [0, assignment_max_score])
    """
    ai_map = ai_qualitative_scores or {}
    evaluated: List[EvaluatedCriterionResult] = []
    automated_total = Decimal("0.00")
    ai_total = Decimal("0.00")

    for c in criteria:
        if c.check_method == "ast":
            if ast_analysis is None:
                evaluated.append(
                    EvaluatedCriterionResult(
                        criterion_id=c.id,
                        criterion_name=c.name,
                        check_method=c.check_method,
                        max_score=c.max_score,
                        awarded_score=Decimal("0.00"),
                        status="failed",
                        reason="ไม่พบโค้ด Python สำหรับตรวจโครงสร้าง AST",
                        evidence={},
                    )
                )
                continue
            res = evaluate_ast_rule(ast_analysis, c.rule_config)
            ratio = Decimal(str(res["ratio"]))
            if res["passed"]:
                awarded = c.max_score
                status = "passed"
            elif c.allow_partial_credit and ratio > 0:
                awarded = clamp_score(c.max_score * ratio, c.max_score)
                status = "partial"
            else:
                awarded = Decimal("0.00")
                status = "failed"
            automated_total += awarded
            evaluated.append(
                EvaluatedCriterionResult(
                    criterion_id=c.id,
                    criterion_name=c.name,
                    check_method=c.check_method,
                    max_score=c.max_score,
                    awarded_score=awarded,
                    status=status,
                    reason=res["reason"],
                    evidence={"checks": res["checks"]},
                    is_ai_evaluated=False,
                )
            )

        elif c.check_method == "runtime":
            if runtime_result is None:
                evaluated.append(
                    EvaluatedCriterionResult(
                        criterion_id=c.id,
                        criterion_name=c.name,
                        check_method=c.check_method,
                        max_score=c.max_score,
                        awarded_score=Decimal("0.00"),
                        status="failed",
                        reason="ไม่สามารถรันโค้ดได้ (ไม่พบผลลัพธ์จาก Sandbox)",
                        evidence={},
                    )
                )
            else:
                ok = (not runtime_result.timed_out) and runtime_result.exit_code == 0
                must_contain = c.rule_config.get("stdout_contains")
                if ok and must_contain:
                    ok = str(must_contain) in runtime_result.stdout
                awarded = c.max_score if ok else Decimal("0.00")
                automated_total += awarded
                evaluated.append(
                    EvaluatedCriterionResult(
                        criterion_id=c.id,
                        criterion_name=c.name,
                        check_method=c.check_method,
                        max_score=c.max_score,
                        awarded_score=awarded,
                        status="passed" if ok else "failed",
                        reason="โปรแกรมทำงานสำเร็จไม่มีข้อผิดพลาด"
                        if ok
                        else f"โปรแกรมทำงานล้มเหลว (exit_code={runtime_result.exit_code}, timed_out={runtime_result.timed_out})",
                        evidence={
                            "exit_code": runtime_result.exit_code,
                            "timed_out": runtime_result.timed_out,
                            "execution_time_ms": runtime_result.execution_time_ms,
                            "stderr": runtime_result.stderr[:500],
                        },
                    )
                )

        elif c.check_method == "test_case":
            target_names = set(c.rule_config.get("test_names", []))
            scoped = [t for t in test_results if not target_names or t.test_name in target_names]
            if not scoped:
                evaluated.append(
                    EvaluatedCriterionResult(
                        criterion_id=c.id,
                        criterion_name=c.name,
                        check_method=c.check_method,
                        max_score=c.max_score,
                        awarded_score=Decimal("0.00"),
                        status="failed",
                        reason="ไม่พบ Test Case ที่เชื่อมโยงกับเกณฑ์นี้",
                        evidence={},
                    )
                )
            else:
                passed_cnt = sum(1 for t in scoped if t.passed)
                ratio = Decimal(passed_cnt) / Decimal(len(scoped))
                if passed_cnt == len(scoped):
                    awarded = c.max_score
                    status = "passed"
                elif c.allow_partial_credit and passed_cnt > 0:
                    awarded = clamp_score(c.max_score * ratio, c.max_score)
                    status = "partial"
                else:
                    awarded = Decimal("0.00")
                    status = "failed"
                automated_total += awarded
                evaluated.append(
                    EvaluatedCriterionResult(
                        criterion_id=c.id,
                        criterion_name=c.name,
                        check_method=c.check_method,
                        max_score=c.max_score,
                        awarded_score=awarded,
                        status=status,
                        reason=f"ผ่าน Test Case {passed_cnt}/{len(scoped)} ข้อ",
                        evidence={
                            "passed": passed_cnt,
                            "total": len(scoped),
                            "tests": [{"name": t.test_name, "passed": t.passed} for t in scoped],
                        },
                    )
                )

        elif c.check_method == "document":
            if document_analysis is None:
                evaluated.append(
                    EvaluatedCriterionResult(
                        criterion_id=c.id,
                        criterion_name=c.name,
                        check_method=c.check_method,
                        max_score=c.max_score,
                        awarded_score=Decimal("0.00"),
                        status="failed",
                        reason="ไม่พบไฟล์ PDF หรือลิงก์ Canva ในผลงานที่ส่งมา",
                        evidence={},
                    )
                )
            else:
                passed, ratio_f, reason, evidence = evaluate_document_rule(document_analysis, c.rule_config)
                ratio = Decimal(str(ratio_f))
                if passed:
                    awarded = c.max_score
                    status = "passed"
                elif c.allow_partial_credit and ratio > 0:
                    awarded = clamp_score(c.max_score * ratio, c.max_score)
                    status = "partial"
                else:
                    awarded = Decimal("0.00")
                    status = "failed"
                automated_total += awarded
                evaluated.append(
                    EvaluatedCriterionResult(
                        criterion_id=c.id,
                        criterion_name=c.name,
                        check_method=c.check_method,
                        max_score=c.max_score,
                        awarded_score=awarded,
                        status=status,
                        reason=reason,
                        evidence=evidence,
                    )
                )

        elif c.check_method == "ai_qualitative":
            ai_entry = ai_map.get(c.name) or ai_map.get(c.id or "")
            if ai_entry is not None:
                raw_score = Decimal(str(ai_entry.get("score", 0)))
                awarded = clamp_score(raw_score, c.max_score)
                ai_total += awarded
                evaluated.append(
                    EvaluatedCriterionResult(
                        criterion_id=c.id,
                        criterion_name=c.name,
                        check_method=c.check_method,
                        max_score=c.max_score,
                        awarded_score=awarded,
                        status="pending_review",
                        reason=str(ai_entry.get("reason", "ประเมินโดย AI (รอครูตรวจสอบก่อนอนุมัติ)")),
                        evidence={"ai_suggestion": True, "requires_teacher_approval": True},
                        is_ai_evaluated=True,
                    )
                )
            else:
                evaluated.append(
                    EvaluatedCriterionResult(
                        criterion_id=c.id,
                        criterion_name=c.name,
                        check_method=c.check_method,
                        max_score=c.max_score,
                        awarded_score=Decimal("0.00"),
                        status="pending_review",
                        reason="รอครูตรวจสอบหรือยังไม่ได้ตั้งค่า LLM API",
                        evidence={"ai_suggestion": False},
                        is_ai_evaluated=True,
                    )
                )

        else:  # manual
            evaluated.append(
                EvaluatedCriterionResult(
                    criterion_id=c.id,
                    criterion_name=c.name,
                    check_method=c.check_method,
                    max_score=c.max_score,
                    awarded_score=Decimal("0.00"),
                    status="pending_review",
                    reason="เกณฑ์ตรวจโดยครูผู้สอน",
                    evidence={},
                )
            )

    # If no rubric criteria were defined, derive deterministic score directly from test cases
    if not criteria and test_results:
        total_weight = sum((t.max_score for t in test_results), Decimal("0.00"))
        earned_weight = sum((t.score_awarded for t in test_results), Decimal("0.00"))
        if total_weight > 0:
            automated_total = clamp_score((earned_weight / total_weight) * assignment_max_score, assignment_max_score)

    automated_total = clamp_score(automated_total, assignment_max_score)
    ai_total = clamp_score(ai_total, assignment_max_score)

    return {
        "criterion_results": evaluated,
        "automated_score": automated_total,
        "ai_suggested_score": ai_total if ai_total > 0 else None,
        "final_score": automated_total,
    }
