"""
Mixed Submission Endpoints.

Supports in a single assignment and single submission:
- Google Colab URL
- Jupyter Notebook (.ipynb)
- Python File (.py)
- ZIP Project (.zip) — strictly inspected against ZIP bomb, path traversal, disallowed extensions

Multiple artifacts can be attached to the same submission simultaneously.
"""

from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import ActorContext, get_workspace_actor
from app.core.database import get_db
from app.models.models import (
    Assignment,
    AssignmentSubmissionSetting,
    GradingRun,
    NotebookCell,
    Student,
    Submission,
    SubmissionArtifact,
    SubmissionVersion,
    TeacherFeedback,
)
from app.schemas.schemas import ArtifactOut, NotebookCellOut, SubmissionOut
from app.services.document_analyzer import DocumentParseError, validate_canva_url
from app.services.file_security import FileSecurityError, inspect_and_extract_zip, validate_single_file
from app.services.notebook_parser import (
    NotebookParseError,
    extract_drive_file_id_from_colab_url,
    parse_ipynb_bytes,
)
from app.services.storage import StorageService

router = APIRouter(tags=["Submissions"])


@router.get("/assignments/{assignment_id}/submissions")
async def list_assignment_submissions(
    assignment_id: str,
    actor: ActorContext = Depends(get_workspace_actor),
    db: AsyncSession = Depends(get_db),
):
    asg = (
        await db.execute(
            select(Assignment).where(Assignment.id == assignment_id, Assignment.workspace_id == actor.workspace_id)
        )
    ).scalar_one_or_none()
    if not asg:
        raise HTTPException(status_code=404, detail="Assignment not found")

    rows = (
        await db.execute(
            select(Submission, Student)
            .join(Student, Student.id == Submission.student_id)
            .where(Submission.assignment_id == assignment_id, Submission.workspace_id == actor.workspace_id)
            .order_by(Submission.updated_at.desc())
        )
    ).all()

    output = []
    for sub, stu in rows:
        artifacts = (
            await db.execute(
                select(SubmissionArtifact).where(SubmissionArtifact.submission_id == sub.id)
            )
        ).scalars().all()
        artifact_types = sorted({a.artifact_type for a in artifacts})
        ai_usage_percent = None
        if sub.latest_grading_run_id:
            latest_run = await db.get(GradingRun, sub.latest_grading_run_id)
            if latest_run and isinstance(latest_run.runtime_summary, dict):
                ai_info = latest_run.runtime_summary.get("ai_usage")
                if isinstance(ai_info, dict):
                    ai_usage_percent = ai_info.get("estimated_ai_percent")
        output.append(
            {
                "submission": SubmissionOut.model_validate(sub),
                "student": {
                    "id": stu.id,
                    "full_name": stu.full_name,
                    "email": stu.email,
                    "student_code": stu.student_code,
                },
                "artifact_types": artifact_types,
                "ai_usage_percent": ai_usage_percent,
            }
        )
    return output


@router.post("/assignments/{assignment_id}/submissions", status_code=status.HTTP_201_CREATED)
async def create_mixed_submission(
    assignment_id: str,
    student_id: str = Form(...),
    colab_url: Optional[str] = Form(default=None),
    canva_url: Optional[str] = Form(default=None),
    notes: Optional[str] = Form(default=None),
    files: List[UploadFile] = File(default=[]),
    actor: ActorContext = Depends(get_workspace_actor),
    db: AsyncSession = Depends(get_db),
):
    asg = (
        await db.execute(
            select(Assignment).where(Assignment.id == assignment_id, Assignment.workspace_id == actor.workspace_id)
        )
    ).scalar_one_or_none()
    if not asg:
        raise HTTPException(status_code=404, detail="Assignment not found")

    student = (
        await db.execute(
            select(Student).where(Student.id == student_id, Student.workspace_id == actor.workspace_id)
        )
    ).scalar_one_or_none()
    if not student:
        raise HTTPException(status_code=404, detail="Student not found in this workspace")

    settings_row = (
        await db.execute(
            select(AssignmentSubmissionSetting).where(AssignmentSubmissionSetting.assignment_id == assignment_id)
        )
    ).scalar_one_or_none()
    if not settings_row:
        raise HTTPException(status_code=400, detail="Submission settings missing for this assignment")

    has_colab = bool(colab_url and colab_url.strip())
    has_canva = bool(canva_url and canva_url.strip())
    total_items = (1 if has_colab else 0) + (1 if has_canva else 0) + len(files)
    if total_items == 0:
        raise HTTPException(status_code=400, detail="Please attach at least one file, Colab URL, or Canva URL.")

    if not settings_row.allow_multiple_files and total_items > 1:
        raise HTTPException(status_code=400, detail="Multiple files/artifacts are disabled for this assignment.")
    if total_items > settings_row.max_files_per_submission:
        raise HTTPException(
            status_code=400,
            detail=f"Maximum {settings_row.max_files_per_submission} artifacts allowed per submission.",
        )

    # Check existing submission (resubmission creates a new SubmissionVersion)
    sub = (
        await db.execute(
            select(Submission).where(Submission.assignment_id == assignment_id, Submission.student_id == student_id)
        )
    ).scalar_one_or_none()

    if sub:
        if not asg.allow_resubmission:
            raise HTTPException(status_code=400, detail="Resubmission is not allowed for this assignment.")
        sub.latest_version_number += 1
        sub.status = "submitted"
        sub.submitted_at = datetime.now(timezone.utc)
        version_num = sub.latest_version_number
    else:
        version_num = 1
        sub = Submission(
            workspace_id=actor.workspace_id,
            assignment_id=assignment_id,
            student_id=student_id,
            source="portal",
            status="submitted",
            latest_version_number=1,
            submitted_at=datetime.now(timezone.utc),
        )
        db.add(sub)
        await db.flush()

    version = SubmissionVersion(
        workspace_id=actor.workspace_id,
        submission_id=sub.id,
        version_number=version_num,
        notes=notes,
        submitted_by=actor.user_id,
    )
    db.add(version)
    await db.flush()

    storage = StorageService()
    created_artifacts: List[SubmissionArtifact] = []

    # 1. Handle Google Colab URL
    if has_colab:
        if not settings_row.allow_colab_url:
            raise HTTPException(status_code=400, detail="Google Colab URL submissions are disabled for this assignment.")
        try:
            drive_file_id = extract_drive_file_id_from_colab_url(colab_url or "")
        except NotebookParseError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

        art = SubmissionArtifact(
            workspace_id=actor.workspace_id,
            submission_id=sub.id,
            version_id=version.id,
            artifact_type="colab_url",
            original_filename=f"colab_{drive_file_id}.ipynb",
            colab_url=(colab_url or "").strip(),
            google_drive_file_id=drive_file_id,
            fetch_status="pending",
        )
        db.add(art)
        created_artifacts.append(art)

    # 1b. Handle Canva URL
    if has_canva:
        if not getattr(settings_row, "allow_canva_url", True):
            raise HTTPException(status_code=400, detail="Canva URL submissions are disabled for this assignment.")
        try:
            valid_canva = validate_canva_url(canva_url or "")
        except DocumentParseError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

        art = SubmissionArtifact(
            workspace_id=actor.workspace_id,
            submission_id=sub.id,
            version_id=version.id,
            artifact_type="canva_url",
            original_filename="Canva Design",
            colab_url=valid_canva,
            fetch_status="ready",
        )
        db.add(art)
        created_artifacts.append(art)

    # 2. Handle uploaded files (.ipynb, .py, .zip, .pdf)
    allowed_exts = []
    if settings_row.allow_ipynb:
        allowed_exts.append(".ipynb")
    if settings_row.allow_py:
        allowed_exts.append(".py")
    if settings_row.allow_zip:
        allowed_exts.append(".zip")
    if getattr(settings_row, "allow_pdf", True):
        allowed_exts.append(".pdf")

    for upload in files:
        raw_bytes = await upload.read()
        fname = upload.filename or "untitled"
        try:
            ext = validate_single_file(fname, raw_bytes, allowed_exts, settings_row.max_file_size_mb)
        except FileSecurityError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

        extracted_manifest = None
        if ext == ".zip":
            try:
                safe_zip = inspect_and_extract_zip(
                    raw_bytes,
                    max_compressed_mb=settings_row.max_file_size_mb,
                    max_uncompressed_mb=settings_row.max_zip_uncompressed_mb,
                    max_extracted_files=settings_row.max_zip_extracted_files,
                    allowed_extensions=settings_row.allowed_zip_extensions,
                )
                extracted_manifest = {"files": safe_zip.manifest, "file_count": safe_zip.file_count}
            except FileSecurityError as exc:
                raise HTTPException(status_code=400, detail=f"ZIP security check failed: {exc}") from exc

        bucket, spath, sha = await storage.upload_bytes(
            actor.workspace_id, sub.id, fname, raw_bytes, upload.content_type or "application/octet-stream"
        )
        art_type = ext.lstrip(".")  # ipynb | py | zip
        art = SubmissionArtifact(
            workspace_id=actor.workspace_id,
            submission_id=sub.id,
            version_id=version.id,
            artifact_type=art_type,
            original_filename=os.path.basename(fname),
            storage_bucket=bucket,
            storage_path=spath,
            file_size_bytes=len(raw_bytes),
            sha256_hash=sha,
            mime_type=upload.content_type,
            fetch_status="ready",
            extracted_manifest=extracted_manifest,
        )
        db.add(art)
        await db.flush()
        created_artifacts.append(art)

        # Immediately parse .ipynb into notebook_cells
        if art_type == "ipynb":
            try:
                parsed = parse_ipynb_bytes(raw_bytes)
                for cell in parsed.cells:
                    db.add(
                        NotebookCell(
                            workspace_id=actor.workspace_id,
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

    await db.commit()
    await db.refresh(sub)
    return {
        "submission": SubmissionOut.model_validate(sub),
        "version_number": version_num,
        "artifacts": [ArtifactOut.model_validate(a) for a in created_artifacts],
    }


@router.get("/submissions/{submission_id}")
async def get_submission_detail(
    submission_id: str,
    actor: ActorContext = Depends(get_workspace_actor),
    db: AsyncSession = Depends(get_db),
):
    sub = (
        await db.execute(
            select(Submission).where(Submission.id == submission_id, Submission.workspace_id == actor.workspace_id)
        )
    ).scalar_one_or_none()
    if not sub:
        raise HTTPException(status_code=404, detail="Submission not found")

    student = await db.get(Student, sub.student_id)
    assignment = await db.get(Assignment, sub.assignment_id)
    artifacts = (
        await db.execute(
            select(SubmissionArtifact)
            .where(SubmissionArtifact.submission_id == sub.id)
            .order_by(SubmissionArtifact.created_at.desc())
        )
    ).scalars().all()

    # Load code previews for .py artifacts and notebook cells for .ipynb/colab
    storage = StorageService()
    code_files = []
    notebook_cells_out = []
    for art in artifacts:
        if art.artifact_type == "py" and art.storage_bucket and art.storage_path:
            try:
                content = (await storage.download_bytes(art.storage_bucket, art.storage_path)).decode("utf-8", errors="replace")
                code_files.append({"artifact_id": art.id, "filename": art.original_filename, "content": content})
            except Exception:
                pass
        elif art.artifact_type in ("ipynb", "colab_url"):
            cells = (
                await db.execute(
                    select(NotebookCell)
                    .where(NotebookCell.artifact_id == art.id)
                    .order_by(NotebookCell.cell_index)
                )
            ).scalars().all()
            notebook_cells_out.extend([NotebookCellOut.model_validate(c) for c in cells])

    feedbacks = (
        await db.execute(
            select(TeacherFeedback)
            .where(TeacherFeedback.submission_id == sub.id)
            .order_by(TeacherFeedback.created_at.desc())
        )
    ).scalars().all()

    runs = (
        await db.execute(
            select(GradingRun)
            .where(GradingRun.submission_id == sub.id)
            .order_by(GradingRun.run_number.desc())
        )
    ).scalars().all()

    return {
        "submission": SubmissionOut.model_validate(sub),
        "student": {
            "id": student.id,
            "full_name": student.full_name,
            "email": student.email,
            "student_code": student.student_code,
        }
        if student
        else None,
        "assignment": {
            "id": assignment.id,
            "title": assignment.title,
            "max_score": float(assignment.max_score),
            "classroom_id": assignment.classroom_id,
        }
        if assignment
        else None,
        "artifacts": [ArtifactOut.model_validate(a) for a in artifacts],
        "code_files": code_files,
        "notebook_cells": notebook_cells_out,
        "grading_runs_count": len(runs),
        "teacher_feedback": [
            {
                "id": f.id,
                "comment": f.comment,
                "is_visible_to_student": f.is_visible_to_student,
                "created_at": f.created_at,
            }
            for f in feedbacks
        ],
    }
