"""
Static Code Analysis Engine using Python AST.

Strictly parses code via Python's `ast` module — never relies on naive substring
search (so comments or string literals containing 'append' or 'for' will NEVER
falsely satisfy structural requirements).
"""

from __future__ import annotations

import ast
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Set


@dataclass
class ASTAnalysisResult:
    syntax_valid: bool = True
    syntax_error: Optional[Dict[str, Any]] = None
    variables_assigned: Set[str] = field(default_factory=set)
    empty_list_variables: Set[str] = field(default_factory=set)
    list_literals_count: int = 0
    function_defs: List[str] = field(default_factory=list)
    function_calls: List[str] = field(default_factory=list)
    method_calls: List[Dict[str, Any]] = field(default_factory=list)  # {"method": "pop", "args": ["0"], "lineno": 12}
    for_loops_count: int = 0
    while_loops_count: int = 0
    if_statements_count: int = 0
    imports: List[str] = field(default_factory=list)
    classes: List[str] = field(default_factory=list)
    line_count: int = 0

    def to_dict(self) -> Dict[str, Any]:
        return {
            "syntax_valid": self.syntax_valid,
            "syntax_error": self.syntax_error,
            "variables_assigned": sorted(self.variables_assigned),
            "empty_list_variables": sorted(self.empty_list_variables),
            "list_literals_count": self.list_literals_count,
            "function_defs": self.function_defs,
            "function_calls": self.function_calls,
            "method_calls": self.method_calls,
            "for_loops_count": self.for_loops_count,
            "while_loops_count": self.while_loops_count,
            "if_statements_count": self.if_statements_count,
            "imports": self.imports,
            "classes": self.classes,
            "line_count": self.line_count,
        }


def _arg_repr(node: ast.AST) -> str:
    if isinstance(node, ast.Constant):
        return repr(node.value)
    if isinstance(node, ast.Name):
        return node.id
    return ast.dump(node, include_attributes=False)


def analyze_python_code(source_code: str) -> ASTAnalysisResult:
    result = ASTAnalysisResult(line_count=len(source_code.splitlines()))
    try:
        tree = ast.parse(source_code)
    except SyntaxError as exc:
        result.syntax_valid = False
        result.syntax_error = {
            "message": exc.msg,
            "lineno": exc.lineno,
            "offset": exc.offset,
            "text": (exc.text or "").rstrip("\n"),
        }
        return result

    for node in ast.walk(tree):
        if isinstance(node, ast.Assign):
            is_empty_list = isinstance(node.value, ast.List) and len(node.value.elts) == 0
            is_list_ctor = (
                isinstance(node.value, ast.Call)
                and isinstance(node.value.func, ast.Name)
                and node.value.func.id == "list"
                and len(node.value.args) == 0
            )
            for target in node.targets:
                if isinstance(target, ast.Name):
                    result.variables_assigned.add(target.id)
                    if is_empty_list or is_list_ctor:
                        result.empty_list_variables.add(target.id)
        elif isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
            result.variables_assigned.add(node.target.id)
            if isinstance(node.value, ast.List) and len(node.value.elts) == 0:
                result.empty_list_variables.add(node.target.id)
        elif isinstance(node, ast.List):
            result.list_literals_count += 1
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            result.function_defs.append(node.name)
        elif isinstance(node, ast.ClassDef):
            result.classes.append(node.name)
        elif isinstance(node, ast.For):
            result.for_loops_count += 1
        elif isinstance(node, ast.While):
            result.while_loops_count += 1
        elif isinstance(node, ast.If):
            result.if_statements_count += 1
        elif isinstance(node, ast.Import):
            for alias in node.names:
                result.imports.append(alias.name)
        elif isinstance(node, ast.ImportFrom):
            mod = node.module or ""
            for alias in node.names:
                result.imports.append(f"{mod}.{alias.name}" if mod else alias.name)
        elif isinstance(node, ast.Call):
            if isinstance(node.func, ast.Name):
                result.function_calls.append(node.func.id)
            elif isinstance(node.func, ast.Attribute):
                result.method_calls.append(
                    {
                        "method": node.func.attr,
                        "args": [_arg_repr(a) for a in node.args],
                        "lineno": getattr(node, "lineno", None),
                    }
                )

    return result


def evaluate_ast_rule(analysis: ASTAnalysisResult, rule_config: Dict[str, Any]) -> Dict[str, Any]:
    """
    Evaluate a declarative AST rule against ASTAnalysisResult.
    Supported rule_config keys:
      - require_syntax_valid: bool (default True)
      - require_empty_list: bool
      - require_variables: List[str]
      - require_function_defs: List[str]
      - require_function_calls: List[str]
      - require_method_calls: List[str | {"method": "pop", "first_arg": "0"}]
      - min_loops: int
      - min_for_loops: int
      - min_while_loops: int
      - min_if_statements: int
      - require_list_usage: bool
    Returns {"passed": bool, "ratio": float (0..1), "checks": [...], "reason": str}
    """
    if not analysis.syntax_valid:
        return {
            "passed": False,
            "ratio": 0.0,
            "checks": [{"rule": "syntax_valid", "passed": False, "detail": analysis.syntax_error}],
            "reason": f"Syntax Error at line {analysis.syntax_error.get('lineno') if analysis.syntax_error else '?'}: "
            f"{analysis.syntax_error.get('message') if analysis.syntax_error else 'invalid syntax'}",
        }

    checks: List[Dict[str, Any]] = []

    if rule_config.get("require_empty_list"):
        ok = len(analysis.empty_list_variables) > 0
        checks.append(
            {
                "rule": "require_empty_list",
                "passed": ok,
                "found": sorted(analysis.empty_list_variables),
            }
        )

    if rule_config.get("require_list_usage"):
        ok = analysis.list_literals_count > 0 or "list" in analysis.function_calls
        checks.append({"rule": "require_list_usage", "passed": ok, "list_literals": analysis.list_literals_count})

    for var in rule_config.get("require_variables", []):
        ok = var in analysis.variables_assigned
        checks.append({"rule": f"variable:{var}", "passed": ok})

    for fn in rule_config.get("require_function_defs", []):
        ok = fn in analysis.function_defs
        checks.append({"rule": f"function_def:{fn}", "passed": ok})

    for call in rule_config.get("require_function_calls", []):
        ok = call in analysis.function_calls
        checks.append({"rule": f"function_call:{call}", "passed": ok})

    for mspec in rule_config.get("require_method_calls", []):
        if isinstance(mspec, str):
            matched = [m for m in analysis.method_calls if m["method"] == mspec]
            checks.append({"rule": f"method_call:{mspec}", "passed": len(matched) > 0, "matches": matched})
        elif isinstance(mspec, dict):
            mname = mspec.get("method", "")
            first_arg = mspec.get("first_arg")
            matched = [
                m
                for m in analysis.method_calls
                if m["method"] == mname and (first_arg is None or (len(m["args"]) > 0 and m["args"][0] == str(first_arg)))
            ]
            label = f"{mname}({first_arg})" if first_arg is not None else mname
            checks.append({"rule": f"method_call:{label}", "passed": len(matched) > 0, "matches": matched})

    if "min_loops" in rule_config:
        total_loops = analysis.for_loops_count + analysis.while_loops_count
        checks.append(
            {"rule": f"min_loops>={rule_config['min_loops']}", "passed": total_loops >= int(rule_config["min_loops"]), "found": total_loops}
        )
    if "min_for_loops" in rule_config:
        checks.append(
            {"rule": f"min_for_loops>={rule_config['min_for_loops']}", "passed": analysis.for_loops_count >= int(rule_config["min_for_loops"]), "found": analysis.for_loops_count}
        )
    if "min_while_loops" in rule_config:
        checks.append(
            {"rule": f"min_while_loops>={rule_config['min_while_loops']}", "passed": analysis.while_loops_count >= int(rule_config["min_while_loops"]), "found": analysis.while_loops_count}
        )
    if "min_if_statements" in rule_config:
        checks.append(
            {"rule": f"min_if_statements>={rule_config['min_if_statements']}", "passed": analysis.if_statements_count >= int(rule_config["min_if_statements"]), "found": analysis.if_statements_count}
        )

    if not checks:
        return {"passed": True, "ratio": 1.0, "checks": [{"rule": "syntax_valid", "passed": True}], "reason": "Syntax is valid."}

    passed_count = sum(1 for c in checks if c["passed"])
    ratio = passed_count / len(checks)
    all_passed = passed_count == len(checks)
    failed_rules = [c["rule"] for c in checks if not c["passed"]]
    reason = "ผ่านเงื่อนไข AST ครบทุกข้อ" if all_passed else f"ไม่พบโครงสร้างที่กำหนด: {', '.join(failed_rules)}"
    return {"passed": all_passed, "ratio": ratio, "checks": checks, "reason": reason}
