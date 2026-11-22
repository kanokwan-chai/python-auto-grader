"""SQLAlchemy 2.0 ORM Models for all 21 core tables of Python Auto Grader."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Dict, List, Optional

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    JSON,
    Numeric,
    String,
    Text,
    TypeDecorator,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class UUIDStr(TypeDecorator):
    """PostgreSQL native UUID (as string) with automatic String(36) fallback on SQLite."""

    impl = String(36)
    cache_ok = True

    def load_dialect_impl(self, dialect):
        if dialect.name == "postgresql":
            return dialect.type_descriptor(PG_UUID(as_uuid=False))
        return dialect.type_descriptor(String(36))

    def process_bind_param(self, value, dialect):
        if value is None:
            return None
        return str(value)

    def process_result_value(self, value, dialect):
        if value is None:
            return None
        return str(value)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _uuid_str() -> str:
    return str(uuid.uuid4())


class Workspace(Base):
    __tablename__ = "workspaces"

    id: Mapped[str] = mapped_column(UUIDStr(), primary_key=True, default=_uuid_str)
    name: Mapped[str] = mapped_column(String(150), nullable=False)
    slug: Mapped[str] = mapped_column(String(120), nullable=False, unique=True)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    owner_user_id: Mapped[str] = mapped_column(UUIDStr(), nullable=False)
    plan_tier: Mapped[str] = mapped_column(String(32), default="standard", nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    settings: Mapped[Dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, onupdate=_utcnow, nullable=False)

    members: Mapped[List["WorkspaceMember"]] = relationship(back_populates="workspace", cascade="all, delete-orphan")


class WorkspaceMember(Base):
    __tablename__ = "workspace_members"
    __table_args__ = (
        UniqueConstraint("workspace_id", "user_id", name="uq_wm_workspace_user"),
        UniqueConstraint("workspace_id", "email", name="uq_wm_workspace_email"),
    )

    id: Mapped[str] = mapped_column(UUIDStr(), primary_key=True, default=_uuid_str)
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id: Mapped[str] = mapped_column(UUIDStr(), nullable=False, index=True)
    email: Mapped[str] = mapped_column(String(255), nullable=False)
    full_name: Mapped[Optional[str]] = mapped_column(String(150), nullable=True)
    role: Mapped[str] = mapped_column(String(32), nullable=False)
    can_edit_grades: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    can_approve_grades: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    can_sync_classroom: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    status: Mapped[str] = mapped_column(String(24), default="active", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, onupdate=_utcnow, nullable=False)

    workspace: Mapped["Workspace"] = relationship(back_populates="members")


class GoogleConnection(Base):
    __tablename__ = "google_connections"
    __table_args__ = (UniqueConstraint("workspace_id", "google_subject_id", name="uq_gc_workspace_sub"),)

    id: Mapped[str] = mapped_column(UUIDStr(), primary_key=True, default=_uuid_str)
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id: Mapped[str] = mapped_column(UUIDStr(), nullable=False)
    google_account_email: Mapped[str] = mapped_column(String(255), nullable=False)
    google_subject_id: Mapped[str] = mapped_column(String(128), nullable=False)
    encrypted_access_token: Mapped[str] = mapped_column(Text, nullable=False)
    encrypted_refresh_token: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    token_expires_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    scopes: Mapped[List[str]] = mapped_column(JSON, default=list, nullable=False)
    has_write_scope: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="connected", nullable=False)
    last_synced_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    last_error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, onupdate=_utcnow, nullable=False)


class Classroom(Base):
    __tablename__ = "classrooms"
    __table_args__ = (UniqueConstraint("workspace_id", "code", name="uq_classroom_ws_code"),)

    id: Mapped[str] = mapped_column(UUIDStr(), primary_key=True, default=_uuid_str)
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True)
    google_connection_id: Mapped[Optional[str]] = mapped_column(ForeignKey("google_connections.id", ondelete="SET NULL"), nullable=True)
    google_course_id: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    code: Mapped[str] = mapped_column(String(64), nullable=False)
    grade_level: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    major: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    academic_year: Mapped[Optional[str]] = mapped_column(String(16), nullable=True)
    semester: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    subject_name: Mapped[str] = mapped_column(String(200), nullable=False)
    status: Mapped[str] = mapped_column(String(24), default="active", nullable=False)
    source: Mapped[str] = mapped_column(String(24), default="manual", nullable=False)
    created_by: Mapped[str] = mapped_column(UUIDStr(), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, onupdate=_utcnow, nullable=False)


class Student(Base):
    __tablename__ = "students"
    __table_args__ = (UniqueConstraint("workspace_id", "email", name="uq_student_ws_email"),)

    id: Mapped[str] = mapped_column(UUIDStr(), primary_key=True, default=_uuid_str)
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True)
    student_code: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    full_name: Mapped[str] = mapped_column(String(200), nullable=False)
    email: Mapped[str] = mapped_column(String(255), nullable=False)
    google_user_id: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    avatar_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, onupdate=_utcnow, nullable=False)


class Enrollment(Base):
    __tablename__ = "enrollments"
    __table_args__ = (UniqueConstraint("classroom_id", "student_id", name="uq_enrollment_cls_stu"),)

    id: Mapped[str] = mapped_column(UUIDStr(), primary_key=True, default=_uuid_str)
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True)
    classroom_id: Mapped[str] = mapped_column(ForeignKey("classrooms.id", ondelete="CASCADE"), nullable=False, index=True)
    student_id: Mapped[str] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(24), default="active", nullable=False)
    enrolled_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)


class Assignment(Base):
    __tablename__ = "assignments"

    id: Mapped[str] = mapped_column(UUIDStr(), primary_key=True, default=_uuid_str)
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True)
    classroom_id: Mapped[str] = mapped_column(ForeignKey("classrooms.id", ondelete="CASCADE"), nullable=False, index=True)
    google_coursework_id: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    title: Mapped[str] = mapped_column(String(250), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    instructions: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    problem_statement: Mapped[str] = mapped_column(Text, nullable=False)
    programming_requirements: Mapped[Dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    max_score: Mapped[Decimal] = mapped_column(Numeric(6, 2), nullable=False)
    start_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    due_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    subject_name: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    python_version: Mapped[str] = mapped_column(String(16), default="3.11", nullable=False)
    execution_mode: Mapped[str] = mapped_column(String(24), default="script", nullable=False)
    allow_resubmission: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    enable_ai_review: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    status: Mapped[str] = mapped_column(String(24), default="published", nullable=False)
    cloned_from_id: Mapped[Optional[str]] = mapped_column(ForeignKey("assignments.id", ondelete="SET NULL"), nullable=True)
    created_by: Mapped[str] = mapped_column(UUIDStr(), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, onupdate=_utcnow, nullable=False)


class AssignmentSubmissionSetting(Base):
    __tablename__ = "assignment_submission_settings"

    id: Mapped[str] = mapped_column(UUIDStr(), primary_key=True, default=_uuid_str)
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True)
    assignment_id: Mapped[str] = mapped_column(ForeignKey("assignments.id", ondelete="CASCADE"), nullable=False, unique=True)
    allow_colab_url: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    allow_ipynb: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    allow_py: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    allow_zip: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    allow_pdf: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    allow_canva_url: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    allow_multiple_files: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    max_file_size_mb: Mapped[int] = mapped_column(Integer, default=10, nullable=False)
    max_files_per_submission: Mapped[int] = mapped_column(Integer, default=5, nullable=False)
    max_zip_extracted_files: Mapped[int] = mapped_column(Integer, default=50, nullable=False)
    max_zip_uncompressed_mb: Mapped[int] = mapped_column(Integer, default=25, nullable=False)
    allowed_zip_extensions: Mapped[List[str]] = mapped_column(JSON, default=lambda: [".py", ".ipynb", ".txt", ".json", ".csv"], nullable=False)
    entry_file_name: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    portal_enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, onupdate=_utcnow, nullable=False)


class RubricCriterion(Base):
    __tablename__ = "rubric_criteria"

    id: Mapped[str] = mapped_column(UUIDStr(), primary_key=True, default=_uuid_str)
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True)
    assignment_id: Mapped[str] = mapped_column(ForeignKey("assignments.id", ondelete="CASCADE"), nullable=False, index=True)
    order_index: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    max_score: Mapped[Decimal] = mapped_column(Numeric(6, 2), nullable=False)
    check_method: Mapped[str] = mapped_column(String(32), nullable=False)  # ast | runtime | test_case | ai_qualitative | manual
    rule_config: Mapped[Dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    pass_condition: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    allow_partial_credit: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, onupdate=_utcnow, nullable=False)


class TestCase(Base):
    __tablename__ = "test_cases"

    id: Mapped[str] = mapped_column(UUIDStr(), primary_key=True, default=_uuid_str)
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True)
    assignment_id: Mapped[str] = mapped_column(ForeignKey("assignments.id", ondelete="CASCADE"), nullable=False, index=True)
    order_index: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    stdin_input: Mapped[str] = mapped_column(Text, default="", nullable=False)
    expected_output: Mapped[str] = mapped_column(Text, default="", nullable=False)
    comparator: Mapped[str] = mapped_column(String(32), default="normalized", nullable=False)
    comparator_config: Mapped[Dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    score_weight: Mapped[Decimal] = mapped_column(Numeric(6, 2), default=Decimal("1.00"), nullable=False)
    timeout_seconds: Mapped[int] = mapped_column(Integer, default=5, nullable=False)
    is_hidden: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, onupdate=_utcnow, nullable=False)


class Submission(Base):
    __tablename__ = "submissions"
    __table_args__ = (UniqueConstraint("assignment_id", "student_id", name="uq_submission_asg_stu"),)

    id: Mapped[str] = mapped_column(UUIDStr(), primary_key=True, default=_uuid_str)
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True)
    assignment_id: Mapped[str] = mapped_column(ForeignKey("assignments.id", ondelete="CASCADE"), nullable=False, index=True)
    student_id: Mapped[str] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), nullable=False, index=True)
    google_submission_id: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    google_submission_state: Mapped[Optional[str]] = mapped_column(String(48), nullable=True)
    source: Mapped[str] = mapped_column(String(32), default="portal", nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="submitted", nullable=False)
    latest_version_number: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    latest_grading_run_id: Mapped[Optional[str]] = mapped_column(UUIDStr(), nullable=True)
    final_score: Mapped[Optional[Decimal]] = mapped_column(Numeric(6, 2), nullable=True)
    is_approved: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    approved_by: Mapped[Optional[str]] = mapped_column(UUIDStr(), nullable=True)
    approved_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    submitted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, onupdate=_utcnow, nullable=False)


class SubmissionVersion(Base):
    __tablename__ = "submission_versions"
    __table_args__ = (UniqueConstraint("submission_id", "version_number", name="uq_sub_version"),)

    id: Mapped[str] = mapped_column(UUIDStr(), primary_key=True, default=_uuid_str)
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True)
    submission_id: Mapped[str] = mapped_column(ForeignKey("submissions.id", ondelete="CASCADE"), nullable=False, index=True)
    version_number: Mapped[int] = mapped_column(Integer, nullable=False)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    submitted_by: Mapped[Optional[str]] = mapped_column(UUIDStr(), nullable=True)
    submitted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)


class SubmissionArtifact(Base):
    __tablename__ = "submission_artifacts"

    id: Mapped[str] = mapped_column(UUIDStr(), primary_key=True, default=_uuid_str)
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True)
    submission_id: Mapped[str] = mapped_column(ForeignKey("submissions.id", ondelete="CASCADE"), nullable=False, index=True)
    version_id: Mapped[str] = mapped_column(ForeignKey("submission_versions.id", ondelete="CASCADE"), nullable=False, index=True)
    artifact_type: Mapped[str] = mapped_column(String(24), nullable=False)  # colab_url | ipynb | py | zip
    original_filename: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    colab_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    google_drive_file_id: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    storage_bucket: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    storage_path: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    file_size_bytes: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    sha256_hash: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    mime_type: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    fetch_status: Mapped[str] = mapped_column(String(32), default="ready", nullable=False)
    fetch_error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    extracted_manifest: Mapped[Optional[Dict[str, Any]]] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)


class NotebookCell(Base):
    __tablename__ = "notebook_cells"
    __table_args__ = (UniqueConstraint("artifact_id", "cell_index", name="uq_nb_cell_idx"),)

    id: Mapped[str] = mapped_column(UUIDStr(), primary_key=True, default=_uuid_str)
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True)
    artifact_id: Mapped[str] = mapped_column(ForeignKey("submission_artifacts.id", ondelete="CASCADE"), nullable=False, index=True)
    cell_index: Mapped[int] = mapped_column(Integer, nullable=False)
    cell_type: Mapped[str] = mapped_column(String(24), nullable=False)
    source_code: Mapped[str] = mapped_column(Text, default="", nullable=False)
    saved_outputs: Mapped[List[Dict[str, Any]]] = mapped_column(JSON, default=list, nullable=False)
    execution_count: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)


class GradingRun(Base):
    __tablename__ = "grading_runs"
    __table_args__ = (UniqueConstraint("submission_id", "run_number", name="uq_grading_run_num"),)

    id: Mapped[str] = mapped_column(UUIDStr(), primary_key=True, default=_uuid_str)
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True)
    submission_id: Mapped[str] = mapped_column(ForeignKey("submissions.id", ondelete="CASCADE"), nullable=False, index=True)
    version_id: Mapped[str] = mapped_column(ForeignKey("submission_versions.id", ondelete="CASCADE"), nullable=False)
    run_number: Mapped[int] = mapped_column(Integer, nullable=False)
    celery_task_id: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    status: Mapped[str] = mapped_column(String(32), default="queued", nullable=False)
    triggered_by: Mapped[Optional[str]] = mapped_column(UUIDStr(), nullable=True)
    automated_score: Mapped[Optional[Decimal]] = mapped_column(Numeric(6, 2), nullable=True)
    ai_suggested_score: Mapped[Optional[Decimal]] = mapped_column(Numeric(6, 2), nullable=True)
    final_score: Mapped[Optional[Decimal]] = mapped_column(Numeric(6, 2), nullable=True)
    max_score: Mapped[Decimal] = mapped_column(Numeric(6, 2), nullable=False)
    ast_summary: Mapped[Dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    runtime_summary: Mapped[Dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    ai_feedback: Mapped[Optional[Dict[str, Any]]] = mapped_column(JSON, nullable=True)
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    started_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)


class CriterionResult(Base):
    __tablename__ = "criterion_results"

    id: Mapped[str] = mapped_column(UUIDStr(), primary_key=True, default=_uuid_str)
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True)
    grading_run_id: Mapped[str] = mapped_column(ForeignKey("grading_runs.id", ondelete="CASCADE"), nullable=False, index=True)
    criterion_id: Mapped[Optional[str]] = mapped_column(ForeignKey("rubric_criteria.id", ondelete="SET NULL"), nullable=True)
    criterion_name: Mapped[str] = mapped_column(String(200), nullable=False)
    check_method: Mapped[str] = mapped_column(String(32), nullable=False)
    max_score: Mapped[Decimal] = mapped_column(Numeric(6, 2), nullable=False)
    awarded_score: Mapped[Decimal] = mapped_column(Numeric(6, 2), nullable=False)
    status: Mapped[str] = mapped_column(String(24), nullable=False)
    reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    evidence: Mapped[Dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    is_ai_evaluated: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)


class TestResult(Base):
    __tablename__ = "test_results"

    id: Mapped[str] = mapped_column(UUIDStr(), primary_key=True, default=_uuid_str)
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True)
    grading_run_id: Mapped[str] = mapped_column(ForeignKey("grading_runs.id", ondelete="CASCADE"), nullable=False, index=True)
    test_case_id: Mapped[Optional[str]] = mapped_column(ForeignKey("test_cases.id", ondelete="SET NULL"), nullable=True)
    test_name: Mapped[str] = mapped_column(String(200), nullable=False)
    is_hidden: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    passed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    comparator: Mapped[str] = mapped_column(String(32), nullable=False)
    expected_output: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    actual_output: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    stderr: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    exit_code: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    timed_out: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    execution_time_ms: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    memory_usage_kb: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    score_awarded: Mapped[Decimal] = mapped_column(Numeric(6, 2), default=Decimal("0.00"), nullable=False)
    max_score: Mapped[Decimal] = mapped_column(Numeric(6, 2), default=Decimal("0.00"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)


class GradeAdjustment(Base):
    __tablename__ = "grade_adjustments"

    id: Mapped[str] = mapped_column(UUIDStr(), primary_key=True, default=_uuid_str)
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True)
    submission_id: Mapped[str] = mapped_column(ForeignKey("submissions.id", ondelete="CASCADE"), nullable=False, index=True)
    grading_run_id: Mapped[str] = mapped_column(ForeignKey("grading_runs.id", ondelete="CASCADE"), nullable=False)
    adjusted_by: Mapped[str] = mapped_column(UUIDStr(), nullable=False)
    previous_score: Mapped[Decimal] = mapped_column(Numeric(6, 2), nullable=False)
    new_score: Mapped[Decimal] = mapped_column(Numeric(6, 2), nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)


class TeacherFeedback(Base):
    __tablename__ = "teacher_feedback"

    id: Mapped[str] = mapped_column(UUIDStr(), primary_key=True, default=_uuid_str)
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True)
    submission_id: Mapped[str] = mapped_column(ForeignKey("submissions.id", ondelete="CASCADE"), nullable=False, index=True)
    grading_run_id: Mapped[Optional[str]] = mapped_column(ForeignKey("grading_runs.id", ondelete="SET NULL"), nullable=True)
    author_user_id: Mapped[str] = mapped_column(UUIDStr(), nullable=False)
    comment: Mapped[str] = mapped_column(Text, nullable=False)
    is_visible_to_student: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, onupdate=_utcnow, nullable=False)


class GradeSyncLog(Base):
    __tablename__ = "grade_sync_logs"

    id: Mapped[str] = mapped_column(UUIDStr(), primary_key=True, default=_uuid_str)
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True)
    assignment_id: Mapped[str] = mapped_column(ForeignKey("assignments.id", ondelete="CASCADE"), nullable=False, index=True)
    submission_id: Mapped[str] = mapped_column(ForeignKey("submissions.id", ondelete="CASCADE"), nullable=False)
    google_connection_id: Mapped[Optional[str]] = mapped_column(ForeignKey("google_connections.id", ondelete="SET NULL"), nullable=True)
    synced_by: Mapped[str] = mapped_column(UUIDStr(), nullable=False)
    synced_score: Mapped[Decimal] = mapped_column(Numeric(6, 2), nullable=False)
    status: Mapped[str] = mapped_column(String(24), nullable=False)
    response_payload: Mapped[Optional[Dict[str, Any]]] = mapped_column(JSON, nullable=True)
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    synced_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[str] = mapped_column(UUIDStr(), primary_key=True, default=_uuid_str)
    workspace_id: Mapped[Optional[str]] = mapped_column(ForeignKey("workspaces.id", ondelete="SET NULL"), nullable=True, index=True)
    actor_user_id: Mapped[Optional[str]] = mapped_column(UUIDStr(), nullable=True, index=True)
    actor_email: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    action: Mapped[str] = mapped_column(String(120), nullable=False)
    resource_type: Mapped[str] = mapped_column(String(64), nullable=False)
    resource_id: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    ip_address: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    user_agent: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    metadata_json: Mapped[Dict[str, Any]] = mapped_column("metadata", JSON, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)
