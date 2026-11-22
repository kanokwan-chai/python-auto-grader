"""Unit tests for Test Case Comparators & Rubric Scoring Engine."""

from decimal import Decimal

from app.services.ast_analyzer import analyze_python_code
from app.services.rubric_engine import RubricCriterionSpec, evaluate_rubric
from app.services.sandbox_client import SandboxExecutionResult
from app.services.test_engine import EvaluatedTestResult, compare_outputs


def test_comparators():
    assert compare_outputs("Hello\n", "Hello\n", "exact") is True
    assert compare_outputs("Hello  \r\n", "Hello\n", "exact") is False
    assert compare_outputs("Hello  \r\n", "Hello\n", "normalized") is True
    assert compare_outputs("3.14159", "3.1416", "numeric_tolerance", {"abs_tol": 1e-3}) is True
    assert compare_outputs("3.50", "3.1416", "numeric_tolerance", {"abs_tol": 1e-3}) is False
    assert compare_outputs('{"b": 2, "a": 1}', '{"a": 1, "b": 2}', "json") is True


def test_rubric_engine_bounds_and_ai_separation():
    code = """
q = []
q.append("item1")
print(q)
q.pop(0)
if len(q) >= 5:
    print("Overflow")
"""
    ast_res = analyze_python_code(code)
    runtime_res = SandboxExecutionResult(
        execution_id="e1",
        stdout="['item1']\n",
        stderr="",
        exit_code=0,
        timed_out=False,
        execution_time_ms=22,
        memory_usage_kb=8192,
        runtime_used="docker",
    )
    test_res = [
        EvaluatedTestResult(
            test_case_id="t1",
            test_name="Queue Basic",
            is_hidden=False,
            passed=True,
            comparator="normalized",
            expected_output="['item1']",
            actual_output="['item1']\n",
            stderr="",
            exit_code=0,
            timed_out=False,
            execution_time_ms=22,
            memory_usage_kb=8192,
            score_awarded=Decimal("2.00"),
            max_score=Decimal("2.00"),
        )
    ]
    criteria = [
        RubricCriterionSpec("c1", "สร้างคิวว่าง", None, Decimal("2"), "ast", {"require_empty_list": True}),
        RubricCriterionSpec("c2", "ใช้ append()", None, Decimal("2"), "ast", {"require_method_calls": ["append"]}),
        RubricCriterionSpec("c3", "แสดงข้อมูลในคิว", None, Decimal("2"), "test_case", {"test_names": ["Queue Basic"]}),
        RubricCriterionSpec("c4", "ใช้ pop(0)", None, Decimal("2"), "ast", {"require_method_calls": [{"method": "pop", "first_arg": "0"}]}),
        RubricCriterionSpec("c5", "ความอ่านง่าย (AI)", None, Decimal("2"), "ai_qualitative", {}),
    ]

    result = evaluate_rubric(
        criteria=criteria,
        assignment_max_score=Decimal("10"),
        ast_analysis=ast_res,
        runtime_result=runtime_res,
        test_results=test_res,
        ai_qualitative_scores={"ความอ่านง่าย (AI)": {"score": 1.8, "reason": "โค้ดอ่านง่าย"}},
    )
    # Deterministic score = 2+2+2+2 = 8.00; AI suggestion = 1.80 (kept strictly separate!)
    assert result["automated_score"] == Decimal("8.00")
    assert result["ai_suggested_score"] == Decimal("1.80")
    assert result["final_score"] == Decimal("8.00")
    ai_crit = [c for c in result["criterion_results"] if c.is_ai_evaluated][0]
    assert ai_crit.status == "pending_review"
