"""
End-to-End Grading Pipeline Orchestrator.

Responsibilities:
1. Loads submission artifacts for the target version (Colab URL -> Drive API, .ipynb, .py, .zip).
2. Does NOT auto-merge unrelated .py files unless explicitly configured; selects entry file clearly.
3. If an artifact cannot be fetched/parsed (e.g., Drive permission denied or deleted file), marks the
   GradingRun as `unreadable_artifact` with clear reason and DOES NOT auto-grade as 0.
4. Runs Python AST static analysis, Sandbox execution, Test Case Engine, AI Code Review (optional),
   and Rubric Engine.
5. Persists immutable `GradingRun`, `CriterionResult`, and `TestResult` records.
"""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import (
    Assignment,
    AssignmentSubmissionSetting,
    Classroom,
    CriterionResult,
    GoogleConnection,
    GradingRun,
    NotebookCell,
    RubricCriterion,
    Submission,
    SubmissionArtifact,
    TestCase,
    TestResult,
)
from app.services.ai_detector import estimate_ai_usage
from app.services.ai_reviewer import AIReviewerService
from app.services.ast_analyzer import analyze_python_code
from app.services.document_analyzer import (
    DocumentAnalysisResult,
    DocumentParseError,
    analyze_canva_url,
    analyze_pdf_bytes,
    refine_open_ended_with_llm,
)
from app.services.file_security import FileSecurityError, inspect_and_extract_zip
from app.services.google_service import GoogleClassroomService, GoogleIntegrationError
from app.services.notebook_parser import NotebookParseError, parse_ipynb_bytes
from app.services.rubric_engine import RubricCriterionSpec, evaluate_rubric
from app.services.sandbox_client import SandboxClient, SandboxExecutionResult
from app.services.storage import StorageService
from app.services.test_engine import TestCaseSpec, run_test_cases


def _strip_nulls(value: Any) -> Any:
    """Recursively remove NUL bytes (\\x00) which PostgreSQL TEXT/JSONB rejects."""
    if isinstance(value, str):
        return value.replace("\x00", "")
    if isinstance(value, dict):
        return {k: _strip_nulls(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_strip_nulls(v) for v in value]
    return value


async def _resolve_code_from_artifacts(
    db: AsyncSession,
    assignment: Assignment,
    settings_row: Optional[AssignmentSubmissionSetting],
    artifacts: List[SubmissionArtifact],
    storage: StorageService,
) -> Tuple[Optional[str], Dict[str, str], str, Optional[DocumentAnalysisResult], Optional[str]]:
    """
    Returns (primary_code, extra_files, entry_file_name, document_analysis, unreadable_reason).
    Never auto-merges multiple .py files unless explicitly configured.
    Supports Python (.py, .ipynb, Colab, .zip) as well as PDF & Canva URLs.
    """
    if not artifacts:
        return None, {}, "main.py", None, "ไม่พบไฟล์หรือลิงก์ผลงานใน Submission นี้"

    google_svc = GoogleClassroomService()
    classroom = await db.get(Classroom, assignment.classroom_id)
    google_conn = (
        await db.get(GoogleConnection, classroom.google_connection_id)
        if classroom and classroom.google_connection_id
        else None
    )

    preferred_entry = (settings_row.entry_file_name or "").strip() if settings_row else ""
    py_files: Dict[str, str] = {}
    notebook_bundle: Optional[str] = None
    doc_result: Optional[DocumentAnalysisResult] = None

    for art in artifacts:
        if art.fetch_status in ("permission_denied", "file_deleted", "security_blocked", "invalid_format"):
            return None, {}, "main.py", None, art.fetch_error or f"ไม่สามารถอ่านไฟล์ได้ ({art.fetch_status})"

        if art.artifact_type == "colab_url":
            if art.storage_bucket and art.storage_path:
                raw_bytes = await storage.download_bytes(art.storage_bucket, art.storage_path)
            else:
                if not google_conn or not art.google_drive_file_id:
                    art.fetch_status = "permission_denied"
                    art.fetch_error = "ยังไม่ได้เชื่อมต่อบัญชี Google ที่มีสิทธิ์ดาวน์โหลดไฟล์ Colab จาก Google Drive"
                    return None, {}, "main.py", None, art.fetch_error
                try:
                    raw_bytes, _meta = await google_svc.download_drive_file(db, google_conn, art.google_drive_file_id)
                    bucket, spath, sha = await storage.upload_bytes(
                        art.workspace_id, art.submission_id, f"{art.google_drive_file_id}.ipynb", raw_bytes
                    )
                    art.storage_bucket = bucket
                    art.storage_path = spath
                    art.sha256_hash = sha
                    art.file_size_bytes = len(raw_bytes)
                    art.fetch_status = "ready"
                except GoogleIntegrationError as exc:
                    art.fetch_status = "file_deleted" if exc.code in ("not_found", "file_deleted") else "permission_denied"
                    art.fetch_error = exc.message
                    return None, {}, "main.py", None, exc.message

            try:
                parsed_nb = parse_ipynb_bytes(raw_bytes)
                notebook_bundle = parsed_nb.code_bundle
                existing_cells = (
                    await db.execute(select(NotebookCell).where(NotebookCell.artifact_id == art.id))
                ).scalars().all()
                if not existing_cells:
                    for cell in parsed_nb.cells:
                        db.add(
                            NotebookCell(
                                workspace_id=art.workspace_id,
                                artifact_id=art.id,
                                cell_index=cell.cell_index,
                                cell_type=cell.cell_type,
                                source_code=cell.source_code,
                                saved_outputs=cell.saved_outputs,
                                execution_count=cell.execution_count,
                            )
                        )
            except NotebookParseError as exc:
                art.fetch_status = "invalid_format"
                art.fetch_error = str(exc)
                return None, {}, "main.py", None, str(exc)

        elif art.artifact_type == "ipynb":
            if not art.storage_bucket or not art.storage_path:
                return None, {}, "main.py", None, "ไม่พบไฟล์ .ipynb ใน Storage"
            raw_bytes = await storage.download_bytes(art.storage_bucket, art.storage_path)
            try:
                parsed_nb = parse_ipynb_bytes(raw_bytes)
                notebook_bundle = parsed_nb.code_bundle
            except NotebookParseError as exc:
                art.fetch_status = "invalid_format"
                art.fetch_error = str(exc)
                return None, {}, "main.py", None, str(exc)

        elif art.artifact_type == "py":
            if art.storage_bucket and art.storage_path:
                raw_bytes = await storage.download_bytes(art.storage_bucket, art.storage_path)
            elif google_conn and art.google_drive_file_id:
                try:
                    raw_bytes, _meta = await google_svc.download_drive_file(db, google_conn, art.google_drive_file_id)
                    bucket, spath, sha = await storage.upload_bytes(
                        art.workspace_id, art.submission_id, art.original_filename or "main.py", raw_bytes
                    )
                    art.storage_bucket, art.storage_path, art.sha256_hash = bucket, spath, sha
                    art.file_size_bytes = len(raw_bytes)
                    art.fetch_status = "ready"
                except GoogleIntegrationError as exc:
                    art.fetch_status = "permission_denied"
                    art.fetch_error = exc.message
                    return None, {}, "main.py", None, exc.message
            else:
                return None, {}, "main.py", None, "ไม่พบไฟล์ .py ใน Storage"
            fname = art.original_filename or "main.py"
            py_files[fname] = raw_bytes.decode("utf-8", errors="replace")

        elif art.artifact_type == "pdf":
            if art.storage_bucket and art.storage_path:
                raw_bytes = await storage.download_bytes(art.storage_bucket, art.storage_path)
            elif google_conn and art.google_drive_file_id:
                try:
                    raw_bytes, _meta = await google_svc.download_drive_file(db, google_conn, art.google_drive_file_id)
                    bucket, spath, sha = await storage.upload_bytes(
                        art.workspace_id, art.submission_id, art.original_filename or "submission.pdf", raw_bytes, "application/pdf"
                    )
                    art.storage_bucket, art.storage_path, art.sha256_hash = bucket, spath, sha
                    art.file_size_bytes = len(raw_bytes)
                    art.fetch_status = "ready"
                except GoogleIntegrationError as exc:
                    art.fetch_status = "permission_denied"
                    art.fetch_error = exc.message
                    return None, {}, "main.py", None, exc.message
            else:
                return None, {}, "main.py", None, "ไม่พบไฟล์ .pdf ใน Storage"
            try:
                doc_result = analyze_pdf_bytes(raw_bytes, filename=art.original_filename or "document.pdf")
            except DocumentParseError as exc:
                art.fetch_status = "invalid_format"
                art.fetch_error = str(exc)
                return None, {}, "main.py", None, str(exc)

        elif art.artifact_type == "canva_url":
            if not art.colab_url:
                return None, {}, "main.py", None, "ไม่พบลิงก์ Canva"
            try:
                canva_res = await analyze_canva_url(art.colab_url)
                if doc_result is None:
                    doc_result = canva_res
                else:
                    doc_result.canva_url = canva_res.canva_url
                    doc_result.is_canva_export = True
            except DocumentParseError as exc:
                art.fetch_status = "invalid_format"
                art.fetch_error = str(exc)
                return None, {}, "main.py", None, str(exc)

        elif art.artifact_type == "zip":
            if not art.storage_bucket or not art.storage_path:
                return None, {}, "main.py", None, "ไม่พบไฟล์ .zip ใน Storage"
            raw_bytes = await storage.download_bytes(art.storage_bucket, art.storage_path)
            try:
                safe_zip = inspect_and_extract_zip(
                    raw_bytes,
                    max_compressed_mb=settings_row.max_file_size_mb if settings_row else 10,
                    max_uncompressed_mb=settings_row.max_zip_uncompressed_mb if settings_row else 25,
                    max_extracted_files=settings_row.max_zip_extracted_files if settings_row else 50,
                    allowed_extensions=settings_row.allowed_zip_extensions
                    if settings_row
                    else [".py", ".ipynb", ".txt", ".json", ".csv", ".pdf"],
                )
            except FileSecurityError as exc:
                art.fetch_status = "security_blocked"
                art.fetch_error = str(exc)
                return None, {}, "main.py", None, str(exc)

            for rel_path, fbytes in safe_zip.files.items():
                if rel_path.endswith(".py"):
                    py_files[rel_path] = fbytes.decode("utf-8", errors="replace")
                elif rel_path.endswith(".ipynb") and notebook_bundle is None:
                    notebook_bundle = parse_ipynb_bytes(fbytes).code_bundle
                elif rel_path.endswith(".pdf") and doc_result is None:
                    try:
                        doc_result = analyze_pdf_bytes(fbytes, filename=rel_path)
                    except DocumentParseError:
                        pass

    if py_files:
        if preferred_entry and preferred_entry in py_files:
            entry = preferred_entry
        elif "main.py" in py_files:
            entry = "main.py"
        elif len(py_files) == 1:
            entry = next(iter(py_files.keys()))
        else:
            entry = sorted(py_files.keys())[0]
        primary_code = py_files[entry]
        extra = {k: v for k, v in py_files.items() if k != entry}
        return primary_code, extra, entry, doc_result, None

    if notebook_bundle is not None:
        return notebook_bundle, {}, "notebook_bundle.py", doc_result, None

    if doc_result is not None:
        return None, {}, "document.pdf", doc_result, None

    return None, {}, "main.py", None, "ไม่พบโค้ด Python หรือเอกสาร PDF/Canva ที่สามารถตรวจได้ในไฟล์ที่ส่งมา"


async def execute_grading_run(
    db: AsyncSession,
    grading_run_id: str,
    sandbox_client: Optional[SandboxClient] = None,
    ai_reviewer: Optional[AIReviewerService] = None,
    storage: Optional[StorageService] = None,
    selected_artifact_ids: Optional[List[str]] = None,
) -> GradingRun:
    run = await db.get(GradingRun, grading_run_id)
    if not run:
        raise ValueError(f"GradingRun {grading_run_id} not found")
    if run.status == "cancelled":
        return run

    submission = await db.get(Submission, run.submission_id)
    assignment = await db.get(Assignment, submission.assignment_id)
    settings_row = (
        await db.execute(
            select(AssignmentSubmissionSetting).where(AssignmentSubmissionSetting.assignment_id == assignment.id)
        )
    ).scalar_one_or_none()
    artifacts = (
        await db.execute(select(SubmissionArtifact).where(SubmissionArtifact.version_id == run.version_id))
    ).scalars().all()
    if selected_artifact_ids:
        sel_set = set(selected_artifact_ids)
        filtered_arts = [a for a in artifacts if a.id in sel_set]
        if filtered_arts:
            artifacts = filtered_arts
    criteria_rows = (
        await db.execute(
            select(RubricCriterion)
            .where(RubricCriterion.assignment_id == assignment.id)
            .order_by(RubricCriterion.order_index)
        )
    ).scalars().all()
    test_rows = (
        await db.execute(
            select(TestCase).where(TestCase.assignment_id == assignment.id).order_by(TestCase.order_index)
        )
    ).scalars().all()

    run.status = "running"
    run.started_at = datetime.now(timezone.utc)
    submission.status = "grading"
    await db.commit()

    storage_svc = storage or StorageService()
    sbx = sandbox_client or SandboxClient()
    reviewer = ai_reviewer or AIReviewerService()

    try:
        primary_code, extra_files, entry_file, doc_result, unreadable_reason = await _resolve_code_from_artifacts(
            db, assignment, settings_row, list(artifacts), storage_svc
        )

        if unreadable_reason or (primary_code is None and doc_result is None):
            # Explicitly do NOT award 0 automatically when file cannot be read
            run.status = "unreadable_artifact"
            run.error_message = unreadable_reason or "ไม่สามารถอ่านผลงานได้"
            run.completed_at = datetime.now(timezone.utc)
            submission.status = "needs_review"
            submission.latest_grading_run_id = run.id
            await db.commit()
            return run

        # 1. Static Code Analysis (AST) & Document Summary (PDF/Canva)
        ast_res = analyze_python_code(primary_code) if primary_code is not None else None
        ast_summary: Dict[str, Any] = ast_res.to_dict() if ast_res else {"mode": "document_only"}
        if doc_result is not None:
            ast_summary["document_analysis"] = doc_result.to_dict()
        run.ast_summary = ast_summary

        # 2. Sandbox Runtime & Test Cases (only when Python code exists)
        runtime_res: Optional[SandboxExecutionResult] = None
        evaluated_tests = []

        if primary_code is not None and ast_res and ast_res.syntax_valid:
            if test_rows:
                specs = [
                    TestCaseSpec(
                        id=t.id,
                        name=t.name,
                        stdin_input=t.stdin_input,
                        expected_output=t.expected_output,
                        comparator=t.comparator,
                        comparator_config=t.comparator_config or {},
                        score_weight=Decimal(str(t.score_weight)),
                        timeout_seconds=t.timeout_seconds,
                        is_hidden=t.is_hidden,
                    )
                    for t in test_rows
                ]
                evaluated_tests = await run_test_cases(
                    student_code=primary_code,
                    test_cases=specs,
                    sandbox=sbx,
                    extra_files=extra_files,
                    entry_file=entry_file,
                )
                if evaluated_tests:
                    first = evaluated_tests[0]
                    runtime_res = SandboxExecutionResult(
                        execution_id="test-0",
                        stdout=first.actual_output,
                        stderr=first.stderr,
                        exit_code=first.exit_code,
                        timed_out=first.timed_out,
                        execution_time_ms=first.execution_time_ms,
                        memory_usage_kb=first.memory_usage_kb,
                        runtime_used="sandbox",
                    )
            else:
                runtime_res = await sbx.execute(
                    code=primary_code, stdin="", timeout_seconds=5, extra_files=extra_files, entry_file=entry_file
                )

        # 2b. AI Usage Percentage Estimator (Python code OR PDF/Canva text)
        if primary_code is not None:
            ai_usage_info = await estimate_ai_usage(primary_code, content_type="python_code")
        else:
            ai_usage_info = await estimate_ai_usage(
                doc_result.extracted_text if doc_result else "",
                content_type="document_text",
            )

        runtime_summary: Dict[str, Any] = (
            {
                "exit_code": runtime_res.exit_code,
                "timed_out": runtime_res.timed_out,
                "execution_time_ms": runtime_res.execution_time_ms,
                "memory_usage_kb": runtime_res.memory_usage_kb,
                "stdout_preview": runtime_res.stdout[:1000],
                "stderr_preview": runtime_res.stderr[:1000],
            }
            if runtime_res
            else (
                {"skipped": True, "reason": "Document-only submission (PDF/Canva)"}
                if primary_code is None
                else {"skipped": True, "reason": "Syntax error prevented execution"}
            )
        )
        runtime_summary["ai_usage"] = ai_usage_info
        runtime_summary["graded_artifacts"] = [
            {
                "id": a.id,
                "artifact_type": a.artifact_type,
                "filename": a.original_filename or a.colab_url or a.artifact_type,
            }
            for a in artifacts
        ]
        run.runtime_summary = runtime_summary

        # 3. AI Code / Document Review (Thai Feedback & Qualitative Criteria)
        ai_feedback: Optional[Dict[str, Any]] = None
        if assignment.enable_ai_review:
            qual_criteria = [
                {"name": c.name, "description": c.description, "max_score": float(c.max_score)}
                for c in criteria_rows
                if c.check_method == "ai_qualitative"
            ]
            review_payload = primary_code if primary_code is not None else (doc_result.extracted_text if doc_result else "")
            ai_feedback = await reviewer.review_submission(
                problem_statement=assignment.problem_statement,
                student_code=review_payload,
                ast_summary=run.ast_summary,
                test_results_summary=[
                    {"name": t.test_name, "passed": t.passed, "timed_out": t.timed_out} for t in evaluated_tests
                ],
                qualitative_criteria=qual_criteria,
            )
            run.ai_feedback = ai_feedback

        # 4. Rubric Evaluation (AST + Runtime + Test Cases + Document PDF/Canva + AI Qualitative)
        rubric_specs = [
            RubricCriterionSpec(
                id=c.id,
                name=c.name,
                description=c.description,
                max_score=Decimal(str(c.max_score)),
                check_method=c.check_method,
                rule_config=c.rule_config or {},
                allow_partial_credit=c.allow_partial_credit,
            )
            for c in criteria_rows
        ]
        rubric_eval = evaluate_rubric(
            criteria=rubric_specs,
            assignment_max_score=Decimal(str(assignment.max_score)),
            ast_analysis=ast_res,
            runtime_result=runtime_res,
            test_results=evaluated_tests,
            ai_qualitative_scores=(ai_feedback or {}).get("qualitative_scores", {}),
            document_analysis=doc_result,
        )

        # Optional LLM semantic refinement for open-ended PDF questions when LLM_API_KEY is configured
        recompute_total = False
        for cr in rubric_eval["criterion_results"]:
            if cr.check_method == "document" and isinstance(cr.evidence, dict):
                q_res = cr.evidence.get("question_results")
                if isinstance(q_res, list) and await refine_open_ended_with_llm(q_res):
                    total_q_pts = sum(float(q.get("max_points", 1.0)) for q in q_res)
                    earned_q_pts = sum(float(q.get("awarded_points", 0.0)) for q in q_res)
                    if total_q_pts > 0:
                        ratio_dec = Decimal(str(earned_q_pts / total_q_pts))
                        new_awarded = (cr.max_score * ratio_dec).quantize(Decimal("0.01"))
                        if new_awarded > cr.max_score:
                            new_awarded = cr.max_score
                        cr.awarded_score = new_awarded
                        cr.status = "passed" if new_awarded >= cr.max_score else ("partial" if new_awarded > 0 else "failed")
                        cr.evidence["earned_question_points"] = round(earned_q_pts, 2)
                        recompute_total = True
        if recompute_total:
            new_auto = sum((cr.awarded_score for cr in rubric_eval["criterion_results"] if not cr.is_ai_evaluated), Decimal("0.00"))
            max_asg = Decimal(str(assignment.max_score))
            if new_auto > max_asg:
                new_auto = max_asg
            rubric_eval["automated_score"] = new_auto.quantize(Decimal("0.01"))
            rubric_eval["final_score"] = rubric_eval["automated_score"]

        # Persist TestResult & CriterionResult rows
        for tr in evaluated_tests:
            db.add(
                TestResult(
                    workspace_id=run.workspace_id,
                    grading_run_id=run.id,
                    test_case_id=tr.test_case_id,
                    test_name=tr.test_name,
                    is_hidden=tr.is_hidden,
                    passed=tr.passed,
                    comparator=tr.comparator,
                    expected_output=tr.expected_output,
                    actual_output=tr.actual_output,
                    stderr=tr.stderr,
                    exit_code=tr.exit_code,
                    timed_out=tr.timed_out,
                    execution_time_ms=tr.execution_time_ms,
                    memory_usage_kb=tr.memory_usage_kb,
                    score_awarded=tr.score_awarded,
                    max_score=tr.max_score,
                )
            )

        for cr in rubric_eval["criterion_results"]:
            db.add(
                CriterionResult(
                    workspace_id=run.workspace_id,
                    grading_run_id=run.id,
                    criterion_id=cr.criterion_id,
                    criterion_name=cr.criterion_name,
                    check_method=cr.check_method,
                    max_score=cr.max_score,
                    awarded_score=cr.awarded_score,
                    status=cr.status,
                    reason=cr.reason,
                    evidence=cr.evidence,
                    is_ai_evaluated=cr.is_ai_evaluated,
                )
            )

        run.ast_summary = _strip_nulls(run.ast_summary)
        run.runtime_summary = _strip_nulls(run.runtime_summary)
        if run.ai_feedback is not None:
            run.ai_feedback = _strip_nulls(run.ai_feedback)
        run.automated_score = rubric_eval["automated_score"]
        run.ai_suggested_score = rubric_eval["ai_suggested_score"]
        run.final_score = rubric_eval["final_score"]
        run.status = "completed"
        run.completed_at = datetime.now(timezone.utc)

        submission.latest_grading_run_id = run.id
        submission.final_score = run.final_score
        submission.status = "graded"
        await db.commit()
        return run

    except Exception as exc:
        await db.rollback()
        run = await db.get(GradingRun, grading_run_id)
        if run:
            run.status = "failed"
            run.error_message = str(exc).replace("\x00", "")[:2000]
            run.completed_at = datetime.now(timezone.utc)
            sub = await db.get(Submission, run.submission_id)
            if sub:
                sub.status = "error"
            await db.commit()
        return run
