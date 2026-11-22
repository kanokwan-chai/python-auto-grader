"""Google OAuth 2.0, Classroom Import & Approved Grade Sync Endpoints."""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from typing import List

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import ActorContext, get_workspace_actor, require_teacher_or_owner, write_audit_log
from app.core.config import get_settings
from app.core.database import get_db
from app.core.security import encrypt_secret, verify_oauth_state
from app.models.models import (
    Assignment,
    AssignmentSubmissionSetting,
    Classroom,
    Enrollment,
    GoogleConnection,
    GradeSyncLog,
    Student,
    Submission,
    SubmissionArtifact,
    SubmissionVersion,
)
from app.schemas.schemas import ClassroomOut, GoogleConnectionOut
from app.services.document_analyzer import is_canva_url
from app.services.google_service import GoogleClassroomService, GoogleIntegrationError
from app.services.notebook_parser import NotebookParseError, extract_drive_file_id_from_colab_url

router = APIRouter(prefix="/google", tags=["Google Classroom"])


@router.get("/oauth/authorize")
async def google_oauth_authorize(
    scope_mode: str = Query(default="read", pattern="^(read|write)$"),
    actor: ActorContext = Depends(require_teacher_or_owner),
):
    svc = GoogleClassroomService()
    auth_url = svc.build_authorization_url(actor.workspace_id, actor.user_id, scope_mode=scope_mode)
    return {"authorization_url": auth_url, "scope_mode": scope_mode}


@router.get("/oauth/callback")
async def google_oauth_callback(
    code: str,
    state: str,
    db: AsyncSession = Depends(get_db),
):
    state_data = verify_oauth_state(state)
    workspace_id = state_data["workspace_id"]
    user_id = state_data["user_id"]

    svc = GoogleClassroomService()
    try:
        tokens = await svc.exchange_code_for_tokens(code)
    except GoogleIntegrationError as exc:
        raise HTTPException(status_code=exc.http_status, detail=exc.message) from exc

    existing = (
        await db.execute(
            select(GoogleConnection).where(
                GoogleConnection.workspace_id == workspace_id,
                GoogleConnection.google_subject_id == tokens["sub"],
            )
        )
    ).scalar_one_or_none()

    if existing:
        existing.encrypted_access_token = encrypt_secret(tokens["access_token"])
        if tokens.get("refresh_token"):
            existing.encrypted_refresh_token = encrypt_secret(tokens["refresh_token"])
        existing.token_expires_at = tokens["expires_at"]
        existing.scopes = tokens["scopes"]
        existing.has_write_scope = existing.has_write_scope or tokens["has_write_scope"]
        existing.status = "connected"
        existing.last_error = None
        conn = existing
    else:
        conn = GoogleConnection(
            workspace_id=workspace_id,
            user_id=user_id,
            google_account_email=tokens["email"],
            google_subject_id=tokens["sub"],
            encrypted_access_token=encrypt_secret(tokens["access_token"]),
            encrypted_refresh_token=encrypt_secret(tokens["refresh_token"]) if tokens.get("refresh_token") else None,
            token_expires_at=tokens["expires_at"],
            scopes=tokens["scopes"],
            has_write_scope=tokens["has_write_scope"],
            status="connected",
        )
        db.add(conn)
    await db.commit()
    await db.refresh(conn)
    frontend_origin = get_settings().cors_origin_list[0].rstrip("/")
    return RedirectResponse(url=f"{frontend_origin}/google-classroom?connected=1&email={conn.google_account_email}")


@router.get("/connections", response_model=List[GoogleConnectionOut])
async def list_google_connections(
    actor: ActorContext = Depends(get_workspace_actor),
    db: AsyncSession = Depends(get_db),
):
    rows = (
        await db.execute(
            select(GoogleConnection).where(GoogleConnection.workspace_id == actor.workspace_id)
        )
    ).scalars().all()
    return [GoogleConnectionOut.model_validate(c) for c in rows]


@router.delete("/connections/{connection_id}")
async def disconnect_google_account(
    connection_id: str,
    request: Request,
    actor: ActorContext = Depends(require_teacher_or_owner),
    db: AsyncSession = Depends(get_db),
):
    conn = (
        await db.execute(
            select(GoogleConnection).where(
                GoogleConnection.id == connection_id, GoogleConnection.workspace_id == actor.workspace_id
            )
        )
    ).scalar_one_or_none()
    if not conn:
        raise HTTPException(status_code=404, detail="Google connection not found")
    conn.status = "revoked"
    conn.encrypted_access_token = ""
    conn.encrypted_refresh_token = None
    await write_audit_log(db, actor, "google.disconnect", "google_connection", conn.id, {}, request)
    await db.commit()
    return {"status": "disconnected"}


async def _get_conn(db: AsyncSession, workspace_id: str, connection_id: str) -> GoogleConnection:
    conn = (
        await db.execute(
            select(GoogleConnection).where(
                GoogleConnection.id == connection_id, GoogleConnection.workspace_id == workspace_id
            )
        )
    ).scalar_one_or_none()
    if not conn:
        raise HTTPException(status_code=404, detail="Google connection not found")
    return conn


@router.get("/connections/{connection_id}/courses")
async def fetch_google_courses(
    connection_id: str,
    actor: ActorContext = Depends(get_workspace_actor),
    db: AsyncSession = Depends(get_db),
):
    conn = await _get_conn(db, actor.workspace_id, connection_id)
    svc = GoogleClassroomService()
    try:
        courses = await svc.list_courses(db, conn)
        return {"courses": courses}
    except GoogleIntegrationError as exc:
        raise HTTPException(status_code=exc.http_status, detail=exc.message) from exc


@router.post("/connections/{connection_id}/courses/{course_id}/import", response_model=ClassroomOut)
async def import_google_course(
    connection_id: str,
    course_id: str,
    actor: ActorContext = Depends(require_teacher_or_owner),
    db: AsyncSession = Depends(get_db),
):
    conn = await _get_conn(db, actor.workspace_id, connection_id)
    svc = GoogleClassroomService()
    try:
        courses = await svc.list_courses(db, conn)
        course = next((c for c in courses if c.get("id") == course_id), None)
        if not course:
            raise HTTPException(status_code=404, detail="Course not found in Google Classroom")
        roster = await svc.list_students(db, conn, course_id)
    except GoogleIntegrationError as exc:
        raise HTTPException(status_code=exc.http_status, detail=exc.message) from exc

    cls = (
        await db.execute(
            select(Classroom).where(
                Classroom.workspace_id == actor.workspace_id, Classroom.google_course_id == course_id
            )
        )
    ).scalar_one_or_none()
    if not cls:
        cls = Classroom(
            workspace_id=actor.workspace_id,
            google_connection_id=conn.id,
            google_course_id=course_id,
            name=course.get("name", f"Course {course_id}"),
            code=course.get("enrollmentCode") or f"GC-{course_id[:8]}",
            subject_name=course.get("section") or course.get("name", "Python"),
            source="google_classroom",
            created_by=actor.user_id,
        )
        db.add(cls)
        await db.flush()

    for s in roster:
        profile = s.get("profile") or {}
        email = profile.get("emailAddress") or f"{s.get('userId')}@classroom.google.local"
        full_name = (profile.get("name") or {}).get("fullName") or email
        student = (
            await db.execute(
                select(Student).where(Student.workspace_id == actor.workspace_id, Student.email == email)
            )
        ).scalar_one_or_none()
        if not student:
            student = Student(
                workspace_id=actor.workspace_id,
                full_name=full_name,
                email=email,
                google_user_id=s.get("userId"),
                avatar_url=profile.get("photoUrl"),
            )
            db.add(student)
            await db.flush()

        enr = (
            await db.execute(
                select(Enrollment).where(Enrollment.classroom_id == cls.id, Enrollment.student_id == student.id)
            )
        ).scalar_one_or_none()
        if not enr:
            db.add(Enrollment(workspace_id=actor.workspace_id, classroom_id=cls.id, student_id=student.id))

    conn.last_synced_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(cls)
    return ClassroomOut.model_validate(cls)


@router.get("/connections/{connection_id}/courses/{course_id}/coursework")
async def fetch_google_coursework(
    connection_id: str,
    course_id: str,
    actor: ActorContext = Depends(get_workspace_actor),
    db: AsyncSession = Depends(get_db),
):
    conn = await _get_conn(db, actor.workspace_id, connection_id)
    svc = GoogleClassroomService()
    try:
        items = await svc.list_coursework(db, conn, course_id)
        return {"coursework": items}
    except GoogleIntegrationError as exc:
        raise HTTPException(status_code=exc.http_status, detail=exc.message) from exc


@router.post("/connections/{connection_id}/courses/{course_id}/coursework/{coursework_id}/import-submissions")
async def import_google_submissions(
    connection_id: str,
    course_id: str,
    coursework_id: str,
    actor: ActorContext = Depends(require_teacher_or_owner),
    db: AsyncSession = Depends(get_db),
):
    conn = await _get_conn(db, actor.workspace_id, connection_id)
    cls = (
        await db.execute(
            select(Classroom).where(
                Classroom.workspace_id == actor.workspace_id, Classroom.google_course_id == course_id
            )
        )
    ).scalar_one_or_none()
    if not cls:
        raise HTTPException(status_code=400, detail="Import the Google Classroom course first before importing submissions.")

    svc = GoogleClassroomService()
    try:
        cw_list = await svc.list_coursework(db, conn, course_id)
        cw = next((w for w in cw_list if w.get("id") == coursework_id), None)
        if not cw:
            raise HTTPException(status_code=404, detail="Coursework not found")
        gc_subs = await svc.list_student_submissions(db, conn, course_id, coursework_id)
    except GoogleIntegrationError as exc:
        raise HTTPException(status_code=exc.http_status, detail=exc.message) from exc

    asg = (
        await db.execute(
            select(Assignment).where(
                Assignment.workspace_id == actor.workspace_id,
                Assignment.google_coursework_id == coursework_id,
            )
        )
    ).scalar_one_or_none()
    if not asg:
        asg = Assignment(
            workspace_id=actor.workspace_id,
            classroom_id=cls.id,
            google_coursework_id=coursework_id,
            title=cw.get("title", "Imported Assignment"),
            description=cw.get("description"),
            problem_statement=cw.get("description") or cw.get("title", "Python Assignment"),
            max_score=Decimal(str(cw.get("maxPoints") or 10)),
            subject_name=cls.subject_name,
            created_by=actor.user_id,
        )
        db.add(asg)
        await db.flush()
        db.add(AssignmentSubmissionSetting(workspace_id=actor.workspace_id, assignment_id=asg.id, allow_zip=True))

    imported_count = 0
    for gs in gc_subs:
        g_uid = gs.get("userId")
        student = (
            await db.execute(
                select(Student).where(Student.workspace_id == actor.workspace_id, Student.google_user_id == g_uid)
            )
        ).scalar_one_or_none()
        if not student:
            continue

        state = gs.get("state", "NEW")
        mapped_status = (
            "not_submitted"
            if state in ("NEW", "CREATED", "RECLAIMED_BY_STUDENT")
            else ("returned" if state == "RETURNED" else "submitted")
        )

        sub = (
            await db.execute(
                select(Submission).where(Submission.assignment_id == asg.id, Submission.student_id == student.id)
            )
        ).scalar_one_or_none()
        if not sub:
            sub = Submission(
                workspace_id=actor.workspace_id,
                assignment_id=asg.id,
                student_id=student.id,
                google_submission_id=gs.get("id"),
                google_submission_state=state,
                source="google_classroom",
                status=mapped_status,
                submitted_at=datetime.now(timezone.utc) if mapped_status == "submitted" else None,
            )
            db.add(sub)
            await db.flush()
        else:
            sub.google_submission_state = state
            if mapped_status == "submitted" and sub.status == "not_submitted":
                sub.status = "submitted"

        attachments = (gs.get("assignmentSubmission") or {}).get("attachments", [])
        if attachments:
            ver = SubmissionVersion(
                workspace_id=actor.workspace_id,
                submission_id=sub.id,
                version_number=sub.latest_version_number,
                submitted_by=actor.user_id,
            )
            db.add(ver)
            await db.flush()

            for att in attachments:
                if "driveFile" in att:
                    df = att["driveFile"]
                    title = df.get("title", "file")
                    low = title.lower()
                    if low.endswith(".ipynb"):
                        art_type = "colab_url"
                    elif low.endswith(".zip"):
                        art_type = "zip"
                    elif low.endswith(".pdf"):
                        art_type = "pdf"
                    else:
                        art_type = "py"
                    db.add(
                        SubmissionArtifact(
                            workspace_id=actor.workspace_id,
                            submission_id=sub.id,
                            version_id=ver.id,
                            artifact_type=art_type,
                            original_filename=title,
                            google_drive_file_id=df.get("id"),
                            fetch_status="pending",
                        )
                    )
                elif "link" in att:
                    url = att["link"].get("url", "")
                    if is_canva_url(url):
                        db.add(
                            SubmissionArtifact(
                                workspace_id=actor.workspace_id,
                                submission_id=sub.id,
                                version_id=ver.id,
                                artifact_type="canva_url",
                                original_filename=att["link"].get("title") or "Canva Design",
                                colab_url=url,
                                fetch_status="ready",
                            )
                        )
                    else:
                        try:
                            fid = extract_drive_file_id_from_colab_url(url)
                            db.add(
                                SubmissionArtifact(
                                    workspace_id=actor.workspace_id,
                                    submission_id=sub.id,
                                    version_id=ver.id,
                                    artifact_type="colab_url",
                                    colab_url=url,
                                    google_drive_file_id=fid,
                                    fetch_status="pending",
                                )
                            )
                        except NotebookParseError:
                            pass
        imported_count += 1

    await db.commit()
    return {"assignment_id": asg.id, "imported_submissions": imported_count}


@router.post("/grade-sync/{assignment_id}")
async def sync_approved_grades_to_classroom(
    assignment_id: str,
    request: Request,
    actor: ActorContext = Depends(require_teacher_or_owner),
    db: AsyncSession = Depends(get_db),
):
    asg = (
        await db.execute(
            select(Assignment).where(Assignment.id == assignment_id, Assignment.workspace_id == actor.workspace_id)
        )
    ).scalar_one_or_none()
    if not asg or not asg.google_coursework_id:
        raise HTTPException(status_code=400, detail="Assignment is not linked to Google Classroom coursework")

    cls = await db.get(Classroom, asg.classroom_id)
    if not cls or not cls.google_connection_id or not cls.google_course_id:
        raise HTTPException(status_code=400, detail="Classroom is not linked to a Google Classroom course")

    conn = await _get_conn(db, actor.workspace_id, cls.google_connection_id)
    svc = GoogleClassroomService()

    approved_subs = (
        await db.execute(
            select(Submission).where(
                Submission.assignment_id == asg.id,
                Submission.workspace_id == actor.workspace_id,
                Submission.is_approved.is_(True),
                Submission.google_submission_id.is_not(None),
                Submission.final_score.is_not(None),
            )
        )
    ).scalars().all()

    synced, failed = 0, 0
    for sub in approved_subs:
        try:
            payload = await svc.patch_student_grade(
                db,
                conn,
                cls.google_course_id,
                asg.google_coursework_id,
                sub.google_submission_id,
                float(sub.final_score),
            )
            db.add(
                GradeSyncLog(
                    workspace_id=actor.workspace_id,
                    assignment_id=asg.id,
                    submission_id=sub.id,
                    google_connection_id=conn.id,
                    synced_by=actor.user_id,
                    synced_score=sub.final_score,
                    status="success",
                    response_payload=payload,
                )
            )
            synced += 1
        except GoogleIntegrationError as exc:
            db.add(
                GradeSyncLog(
                    workspace_id=actor.workspace_id,
                    assignment_id=asg.id,
                    submission_id=sub.id,
                    google_connection_id=conn.id,
                    synced_by=actor.user_id,
                    synced_score=sub.final_score,
                    status="failed",
                    error_message=exc.message,
                )
            )
            failed += 1

    await write_audit_log(
        db, actor, "google.grade_sync", "assignment", asg.id, {"synced": synced, "failed": failed}, request
    )
    await db.commit()
    return {"synced": synced, "failed": failed}
