"""
Test Case Execution & Comparison Engine.

Supports:
- exact: byte-for-byte string match
- normalized: trims trailing spaces per line, normalizes CRLF -> LF, strips leading/trailing blank lines
- numeric_tolerance: extracts numeric values (or compares float per line) within abs/rel tolerance
- json: deep structural JSON equality
- function: wraps student code to invoke a target Python function with JSON arguments and compare return value
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from decimal import Decimal
from typing import Any, Dict, List, Optional

from app.services.sandbox_client import SandboxClient, SandboxExecutionResult


@dataclass
class TestCaseSpec:
    id: Optional[str]
    name: str
    stdin_input: str
    expected_output: str
    comparator: str  # exact | normalized | numeric_tolerance | json | function
    comparator_config: Dict[str, Any]
    score_weight: Decimal
    timeout_seconds: int
    is_hidden: bool


@dataclass
class EvaluatedTestResult:
    test_case_id: Optional[str]
    test_name: str
    is_hidden: bool
    passed: bool
    comparator: str
    expected_output: str
    actual_output: str
    stderr: str
    exit_code: int
    timed_out: bool
    execution_time_ms: int
    memory_usage_kb: Optional[int]
    score_awarded: Decimal
    max_score: Decimal


def normalize_text(text: str) -> str:
    lines = [line.rstrip() for line in text.replace("\r\n", "\n").replace("\r", "\n").split("\n")]
    return "\n".join(lines).strip()


def compare_outputs(
    actual: str,
    expected: str,
    comparator: str,
    config: Optional[Dict[str, Any]] = None,
) -> bool:
    cfg = config or {}
    if comparator == "exact":
        return actual == expected

    if comparator == "normalized":
        if cfg.get("case_insensitive"):
            return normalize_text(actual).lower() == normalize_text(expected).lower()
        return normalize_text(actual) == normalize_text(expected)

    if comparator == "numeric_tolerance":
        abs_tol = float(cfg.get("abs_tol", 1e-4))
        rel_tol = float(cfg.get("rel_tol", 1e-4))
        actual_tokens = normalize_text(actual).split()
        expected_tokens = normalize_text(expected).split()
        if len(actual_tokens) != len(expected_tokens) or not expected_tokens:
            return False
        try:
            for a_tok, e_tok in zip(actual_tokens, expected_tokens):
                if not math.isclose(float(a_tok), float(e_tok), rel_tol=rel_tol, abs_tol=abs_tol):
                    return False
            return True
        except ValueError:
            return False

    if comparator in ("json", "function"):
        try:
            actual_obj = json.loads(normalize_text(actual))
            expected_obj = json.loads(normalize_text(expected))
            return actual_obj == expected_obj
        except json.JSONDecodeError:
            return False

    return normalize_text(actual) == normalize_text(expected)


def build_function_test_harness(student_code: str, config: Dict[str, Any]) -> str:
    """Wrap student code to call a specific function with args/kwargs and print JSON result."""
    fn_name = str(config.get("function_name", "")).strip()
    if not fn_name.isidentifier():
        raise ValueError(f"Invalid function_name in test comparator_config: {fn_name!r}")
    args_json = json.dumps(config.get("args", []))
    kwargs_json = json.dumps(config.get("kwargs", {}))
    harness = f"""
{student_code}

# --- AutoGrader Function Test Harness ---
import json as _ag_json
_ag_args = _ag_json.loads({args_json!r})
_ag_kwargs = _ag_json.loads({kwargs_json!r})
_ag_res = {fn_name}(*_ag_args, **_ag_kwargs)
print(_ag_json.dumps(_ag_res))
"""
    return harness


async def run_test_cases(
    student_code: str,
    test_cases: List[TestCaseSpec],
    sandbox: SandboxClient,
    extra_files: Optional[Dict[str, str]] = None,
    entry_file: str = "main.py",
) -> List[EvaluatedTestResult]:
    results: List[EvaluatedTestResult] = []
    for tc in test_cases:
        code_to_run = student_code
        if tc.comparator == "function":
            try:
                code_to_run = build_function_test_harness(student_code, tc.comparator_config)
            except ValueError as exc:
                results.append(
                    EvaluatedTestResult(
                        test_case_id=tc.id,
                        test_name=tc.name,
                        is_hidden=tc.is_hidden,
                        passed=False,
                        comparator=tc.comparator,
                        expected_output=tc.expected_output,
                        actual_output="",
                        stderr=str(exc),
                        exit_code=1,
                        timed_out=False,
                        execution_time_ms=0,
                        memory_usage_kb=None,
                        score_awarded=Decimal("0.00"),
                        max_score=tc.score_weight,
                    )
                )
                continue

        exec_res: SandboxExecutionResult = await sandbox.execute(
            code=code_to_run,
            stdin=tc.stdin_input,
            timeout_seconds=tc.timeout_seconds,
            extra_files=extra_files,
            entry_file=entry_file,
        )
        passed = (
            not exec_res.timed_out
            and exec_res.exit_code == 0
            and compare_outputs(exec_res.stdout, tc.expected_output, tc.comparator, tc.comparator_config)
        )
        results.append(
            EvaluatedTestResult(
                test_case_id=tc.id,
                test_name=tc.name,
                is_hidden=tc.is_hidden,
                passed=passed,
                comparator=tc.comparator,
                expected_output=tc.expected_output,
                actual_output=exec_res.stdout,
                stderr=exec_res.stderr,
                exit_code=exec_res.exit_code,
                timed_out=exec_res.timed_out,
                execution_time_ms=exec_res.execution_time_ms,
                memory_usage_kb=exec_res.memory_usage_kb,
                score_awarded=tc.score_weight if passed else Decimal("0.00"),
                max_score=tc.score_weight,
            )
        )
    return results
