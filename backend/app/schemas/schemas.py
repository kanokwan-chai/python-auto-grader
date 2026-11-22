"""Pydantic v2 Schemas for Python Auto Grader REST API."""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, EmailStr, Field, model_validator


class ORMBase(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# --- Auth & Workspaces ---
class UserProfile(BaseModel):
    user_id: str
    email: str
    full_name: str = ""
    global_role: str = "teacher"


class WorkspaceCreate(BaseModel):
    name: str = Field(..., min_length=2, max_length=150)
    slug: str = Field(..., min_length=2, max_length=120, pattern=r"^[a-z0-9-]+$")
    description: Optional[str] = None


class WorkspaceOut(ORMBase):
    id: str
    name: str
    slug: str
    description: Optional[str]
    owner_user_id: str
    plan_tier: str
    is_active: bool
    created_at: datetime


class WorkspaceMemberCreate(BaseModel):
    email: EmailStr
    full_name: Optional[str] = None
    role: Literal["teacher", "grader", "viewer", "student"] = "grader"
    can_edit_grades: bool = False
    can_approve_grades: bool = False
    can_sync_classroom: bool = False


class WorkspaceMemberOut(ORMBase):
    id: str
    workspace_id: str
    user_id: str
    email: str
    full_name: Optional[str]
    role: str
    can_edit_grades: bool
    can_approve_grades: bool
    can_sync_classroom: bool
    status: str


# --- Classrooms & Students ---
class ClassroomCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    code: str = Field(..., min_length=1, max_length=64)
    grade_level: Optional[str] = None
    major: Optional[str] = None
    academic_year: Optional[str] = None
    semester: Optional[str] = None
    subject_name: str = Field(..., min_length=1, max_length=200)


class ClassroomUpdate(BaseModel):
    name: Optional[str] = None
    grade_level: Optional[str] = None
    major: Optional[str] = None
    academic_year: Optional[str] = None
    semester: Optional[str] = None
    subject_name: Optional[str] = None
    status: Optional[Literal["active", "archived"]] = None


class ClassroomOut(ORMBase):
    id: str
    workspace_id: str
    google_connection_id: Optional[str]
    google_course_id: Optional[str]
    name: str
    code: str
    grade_level: Optional[str]
    major: Optional[str]
    academic_year: Optional[str]
    semester: Optional[str]
    subject_name: str
    status: str
    source: str
    created_at: datetime


class StudentCreate(BaseModel):
    student_code: Optional[str] = None
    full_name: str = Field(..., min_length=1, max_length=200)
    email: EmailStr


class StudentOut(ORMBase):
    id: str
    workspace_id: str
    student_code: Optional[str]
    full_name: str
    email: str
    google_user_id: Optional[str]
    avatar_url: Optional[str]


# --- Assignments, Mixed Submission Settings, Rubrics, Test Cases ---
class SubmissionSettingsIn(BaseModel):
    allow_colab_url: bool = True
    allow_ipynb: bool = True
    allow_py: bool = True
    allow_zip: bool = False
    allow_pdf: bool = True
    allow_canva_url: bool = True
    allow_multiple_files: bool = True
    max_file_size_mb: int = Field(default=10, ge=1, le=100)
    max_files_per_submission: int = Field(default=5, ge=1, le=50)
    max_zip_extracted_files: int = Field(default=50, ge=1, le=500)
    max_zip_uncompressed_mb: int = Field(default=25, ge=1, le=200)
    allowed_zip_extensions: List[str] = Field(default_factory=lambda: [".py", ".ipynb", ".txt", ".json", ".csv", ".pdf"])
    entry_file_name: Optional[str] = None
    portal_enabled: bool = True

    @model_validator(mode="after")
    def validate_at_least_one_format(self):
        if not (
            self.allow_colab_url
            or self.allow_ipynb
            or self.allow_py
            or self.allow_zip
            or self.allow_pdf
            or self.allow_canva_url
        ):
            raise ValueError("At least one submission format (Colab, IPYNB, PY, ZIP, PDF, or Canva) must be enabled.")
        return self


class SubmissionSettingsOut(ORMBase, SubmissionSettingsIn):
    id: str
    assignment_id: str


class RubricCriterionIn(BaseModel):
    order_index: int = 0
    name: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = None
    max_score: Decimal = Field(..., gt=0)
    check_method: Literal["ast", "runtime", "test_case", "document", "ai_qualitative", "manual"]
    rule_config: Dict[str, Any] = Field(default_factory=dict)
    pass_condition: Optional[str] = None
    allow_partial_credit: bool = True


class RubricCriterionOut(ORMBase, RubricCriterionIn):
    id: str
    assignment_id: str


class TestCaseIn(BaseModel):
    order_index: int = 0
    name: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = None
    stdin_input: str = ""
    expected_output: str = ""
    comparator: Literal["exact", "normalized", "numeric_tolerance", "json", "function"] = "normalized"
    comparator_config: Dict[str, Any] = Field(default_factory=dict)
    score_weight: Decimal = Field(default=Decimal("1.00"), ge=0)
    timeout_seconds: int = Field(default=5, ge=1, le=60)
    is_hidden: bool = False


class TestCaseOut(ORMBase, TestCaseIn):
    id: str
    assignment_id: str


class AssignmentCreate(BaseModel):
    classroom_id: str
    title: str = Field(..., min_length=1, max_length=250)
    description: Optional[str] = None
    instructions: Optional[str] = None
    problem_statement: str = Field(..., min_length=1)
    programming_requirements: Dict[str, Any] = Field(default_factory=dict)
    max_score: Decimal = Field(..., gt=0)
    start_at: Optional[datetime] = None
    due_at: Optional[datetime] = None
    subject_name: Optional[str] = None
    python_version: str = "3.11"
    execution_mode: Literal["script", "notebook", "auto"] = "auto"
    allow_resubmission: bool = True
    enable_ai_review: bool = True
    submission_settings: SubmissionSettingsIn = Field(default_factory=SubmissionSettingsIn)
    rubric_criteria: List[RubricCriterionIn] = Field(default_factory=list)
    test_cases: List[TestCaseIn] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_rubric_sum(self):
        if self.rubric_criteria:
            total = sum((c.max_score for c in self.rubric_criteria), Decimal("0"))
            if total > self.max_score:
                raise ValueError(
                    f"Total rubric criteria score ({total}) cannot exceed assignment max_score ({self.max_score})."
                )
        return self


class AssignmentCloneIn(BaseModel):
    target_classroom_id: str
    new_title: Optional[str] = None


class AssignmentOut(ORMBase):
    id: str
    workspace_id: str
    classroom_id: str
    google_coursework_id: Optional[str]
    title: str
    description: Optional[str]
    instructions: Optional[str]
    problem_statement: str
    programming_requirements: Dict[str, Any]
    max_score: Decimal
    start_at: Optional[datetime]
    due_at: Optional[datetime]
    subject_name: Optional[str]
    python_version: str
    execution_mode: str
    allow_resubmission: bool
    enable_ai_review: bool
    status: str
    created_at: datetime


# --- Submissions & Grading ---
class ArtifactOut(ORMBase):
    id: str
    artifact_type: str
    original_filename: Optional[str]
    colab_url: Optional[str]
    google_drive_file_id: Optional[str]
    file_size_bytes: Optional[int]
    fetch_status: str
    fetch_error: Optional[str]
    created_at: datetime


class NotebookCellOut(ORMBase):
    id: str
    cell_index: int
    cell_type: str
    source_code: str
    saved_outputs: List[Dict[str, Any]]
    execution_count: Optional[int]


class SubmissionOut(ORMBase):
    id: str
    assignment_id: str
    student_id: str
    source: str
    status: str
    latest_version_number: int
    latest_grading_run_id: Optional[str]
    final_score: Optional[Decimal]
    is_approved: bool
    submitted_at: Optional[datetime]


class CriterionResultOut(ORMBase):
    id: str
    criterion_id: Optional[str]
    criterion_name: str
    check_method: str
    max_score: Decimal
    awarded_score: Decimal
    status: str
    reason: Optional[str]
    evidence: Dict[str, Any]
    is_ai_evaluated: bool


class TestResultOut(ORMBase):
    id: str
    test_case_id: Optional[str]
    test_name: str
    is_hidden: bool
    passed: bool
    comparator: str
    expected_output: Optional[str]
    actual_output: Optional[str]
    stderr: Optional[str]
    exit_code: Optional[int]
    timed_out: bool
    execution_time_ms: Optional[int]
    memory_usage_kb: Optional[int]
    score_awarded: Decimal
    max_score: Decimal


class GradingRunOut(ORMBase):
    id: str
    submission_id: str
    version_id: str
    run_number: int
    status: str
    automated_score: Optional[Decimal]
    ai_suggested_score: Optional[Decimal]
    final_score: Optional[Decimal]
    max_score: Decimal
    ast_summary: Dict[str, Any]
    runtime_summary: Dict[str, Any]
    ai_feedback: Optional[Dict[str, Any]]
    error_message: Optional[str]
    started_at: Optional[datetime]
    completed_at: Optional[datetime]
    created_at: datetime


class GradeAdjustIn(BaseModel):
    new_score: Decimal = Field(..., ge=0)
    reason: str = Field(..., min_length=3, max_length=1000)


class TeacherFeedbackIn(BaseModel):
    comment: str = Field(..., min_length=1, max_length=4000)
    is_visible_to_student: bool = True


class BatchGradeIn(BaseModel):
    submission_ids: Optional[List[str]] = None
    selected_artifact_ids: Optional[List[str]] = None
    run_sync_inline: bool = False


class GoogleConnectionOut(ORMBase):
    id: str
    workspace_id: str
    google_account_email: str
    has_write_scope: bool
    status: str
    last_synced_at: Optional[datetime]
    last_error: Optional[str]
    created_at: datetime


class DashboardStatsOut(BaseModel):
    total_assignments: int
    total_classrooms: int
    total_students: int
    submitted_count: int
    not_submitted_count: int
    pending_grading_count: int
    graded_count: int
    average_score: Optional[float]
    max_score_achieved: Optional[float]
    min_score_achieved: Optional[float]
    pass_rate_percent: Optional[float]
