"""Unit tests for Python AST Static Code Analysis Engine."""

from app.services.ast_analyzer import analyze_python_code, evaluate_ast_rule


def test_queue_assignment_ast_rules_pass():
    code = """
MAX_SIZE = 3
queue = []

def enqueue(item):
    if len(queue) >= MAX_SIZE:
        print("Overflow")
    else:
        queue.append(item)

enqueue("A")
enqueue("B")
print(queue)
first = queue.pop(0)
print(first)
"""
    analysis = analyze_python_code(code)
    assert analysis.syntax_valid is True
    assert "queue" in analysis.empty_list_variables

    assert evaluate_ast_rule(analysis, {"require_empty_list": True})["passed"] is True
    assert evaluate_ast_rule(analysis, {"require_method_calls": ["append"]})["passed"] is True
    assert (
        evaluate_ast_rule(analysis, {"require_method_calls": [{"method": "pop", "first_arg": "0"}]})["passed"] is True
    )
    assert evaluate_ast_rule(analysis, {"min_if_statements": 1})["passed"] is True
    assert evaluate_ast_rule(analysis, {"require_function_calls": ["print"]})["passed"] is True


def test_comments_and_strings_cannot_spoof_ast_rules():
    spoof_code = """
# queue = []
# queue.append("fake")
# queue.pop(0)
msg = "for i in range(10): queue.append(i); queue.pop(0)"
"""
    analysis = analyze_python_code(spoof_code)
    assert analysis.syntax_valid is True
    assert evaluate_ast_rule(analysis, {"require_empty_list": True})["passed"] is False
    assert evaluate_ast_rule(analysis, {"require_method_calls": ["append"]})["passed"] is False
    assert (
        evaluate_ast_rule(analysis, {"require_method_calls": [{"method": "pop", "first_arg": "0"}]})["passed"] is False
    )
    assert evaluate_ast_rule(analysis, {"min_loops": 1})["passed"] is False


def test_syntax_error_reported_cleanly():
    bad_code = "def broken(:\n    pass\n"
    analysis = analyze_python_code(bad_code)
    assert analysis.syntax_valid is False
    assert analysis.syntax_error is not None
    res = evaluate_ast_rule(analysis, {"require_empty_list": True})
    assert res["passed"] is False
    assert res["ratio"] == 0.0
