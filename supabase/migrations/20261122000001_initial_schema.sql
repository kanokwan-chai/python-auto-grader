-- ============================================================================
-- Python Auto Grader — Initial Multi-Tenant PostgreSQL / Supabase Migration
-- Covers all 21 core tables, PKs, FKs, Unique Constraints, CHECK validations,
-- Indexes, Triggers, and Row Level Security (RLS) Policies.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "citext";

-- Helper schema/function for session-aware RLS (works with both Supabase auth.uid()
-- and Backend FastAPI SET LOCAL app.current_user_id / app.current_workspace_id)
CREATE OR REPLACE FUNCTION public.current_actor_id()
RETURNS UUID
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_uid TEXT;
BEGIN
    v_uid := NULLIF(current_setting('app.current_user_id', true), '');
    IF v_uid IS NOT NULL THEN
        RETURN v_uid::UUID;
    END IF;
    -- Fallback to Supabase JWT sub claim if present
    v_uid := NULLIF(current_setting('request.jwt.claim.sub', true), '');
    IF v_uid IS NOT NULL THEN
        RETURN v_uid::UUID;
    END IF;
    RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
    RETURN COALESCE(current_setting('app.is_super_admin', true), 'false') = 'true';
END;
$$;

-- Trigger function to maintain updated_at
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

-- ============================================================================
-- 1. workspaces
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.workspaces (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(150) NOT NULL,
    slug VARCHAR(120) NOT NULL UNIQUE,
    description TEXT,
    owner_user_id UUID NOT NULL,
    plan_tier VARCHAR(32) NOT NULL DEFAULT 'standard' CHECK (plan_tier IN ('standard', 'pro', 'enterprise')),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    settings JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_workspaces_updated_at
    BEFORE UPDATE ON public.workspaces
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================================
-- 2. workspace_members
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.workspace_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    email CITEXT NOT NULL,
    full_name VARCHAR(150),
    role VARCHAR(32) NOT NULL CHECK (role IN ('super_admin', 'owner', 'teacher', 'grader', 'viewer', 'student')),
    can_edit_grades BOOLEAN NOT NULL DEFAULT FALSE,
    can_approve_grades BOOLEAN NOT NULL DEFAULT FALSE,
    can_sync_classroom BOOLEAN NOT NULL DEFAULT FALSE,
    status VARCHAR(24) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'invited', 'suspended')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (workspace_id, user_id),
    UNIQUE (workspace_id, email)
);

CREATE INDEX idx_workspace_members_workspace ON public.workspace_members(workspace_id);
CREATE INDEX idx_workspace_members_user ON public.workspace_members(user_id);

CREATE TRIGGER trg_workspace_members_updated_at
    BEFORE UPDATE ON public.workspace_members
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Helper function for RLS workspace membership check
CREATE OR REPLACE FUNCTION public.has_workspace_access(target_workspace_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
    SELECT public.is_super_admin() OR EXISTS (
        SELECT 1
        FROM public.workspace_members wm
        WHERE wm.workspace_id = target_workspace_id
          AND wm.user_id = public.current_actor_id()
          AND wm.status = 'active'
    );
$$;

-- ============================================================================
-- 3. google_connections
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.google_connections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    google_account_email CITEXT NOT NULL,
    google_subject_id VARCHAR(128) NOT NULL,
    encrypted_access_token TEXT NOT NULL,
    encrypted_refresh_token TEXT,
    token_expires_at TIMESTAMPTZ,
    scopes TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    has_write_scope BOOLEAN NOT NULL DEFAULT FALSE,
    status VARCHAR(32) NOT NULL DEFAULT 'connected' CHECK (status IN ('connected', 'expired', 'revoked', 'error')),
    last_synced_at TIMESTAMPTZ,
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (workspace_id, google_subject_id)
);

CREATE INDEX idx_google_connections_workspace ON public.google_connections(workspace_id);

CREATE TRIGGER trg_google_connections_updated_at
    BEFORE UPDATE ON public.google_connections
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================================
-- 4. classrooms
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.classrooms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    google_connection_id UUID REFERENCES public.google_connections(id) ON DELETE SET NULL,
    google_course_id VARCHAR(128),
    name VARCHAR(200) NOT NULL,
    code VARCHAR(64) NOT NULL,
    grade_level VARCHAR(64),
    major VARCHAR(120),
    academic_year VARCHAR(16),
    semester VARCHAR(32),
    subject_name VARCHAR(200) NOT NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
    source VARCHAR(24) NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'google_classroom')),
    created_by UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (workspace_id, code),
    UNIQUE (workspace_id, google_course_id)
);

CREATE INDEX idx_classrooms_workspace ON public.classrooms(workspace_id);
CREATE INDEX idx_classrooms_google_course ON public.classrooms(google_course_id) WHERE google_course_id IS NOT NULL;

CREATE TRIGGER trg_classrooms_updated_at
    BEFORE UPDATE ON public.classrooms
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================================
-- 5. students
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.students (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    student_code VARCHAR(64),
    full_name VARCHAR(200) NOT NULL,
    email CITEXT NOT NULL,
    google_user_id VARCHAR(128),
    avatar_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (workspace_id, email)
);

CREATE INDEX idx_students_workspace ON public.students(workspace_id);
CREATE INDEX idx_students_google_user ON public.students(workspace_id, google_user_id) WHERE google_user_id IS NOT NULL;

CREATE TRIGGER trg_students_updated_at
    BEFORE UPDATE ON public.students
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================================
-- 6. enrollments
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.enrollments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    classroom_id UUID NOT NULL REFERENCES public.classrooms(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
    status VARCHAR(24) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'dropped')),
    enrolled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (classroom_id, student_id)
);

CREATE INDEX idx_enrollments_workspace ON public.enrollments(workspace_id);
CREATE INDEX idx_enrollments_classroom ON public.enrollments(classroom_id);
CREATE INDEX idx_enrollments_student ON public.enrollments(student_id);

-- ============================================================================
-- 7. assignments
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    classroom_id UUID NOT NULL REFERENCES public.classrooms(id) ON DELETE CASCADE,
    google_coursework_id VARCHAR(128),
    title VARCHAR(250) NOT NULL,
    description TEXT,
    instructions TEXT,
    problem_statement TEXT NOT NULL,
    programming_requirements JSONB NOT NULL DEFAULT '{}'::JSONB,
    max_score NUMERIC(6,2) NOT NULL CHECK (max_score > 0),
    start_at TIMESTAMPTZ,
    due_at TIMESTAMPTZ,
    subject_name VARCHAR(200),
    python_version VARCHAR(16) NOT NULL DEFAULT '3.11',
    execution_mode VARCHAR(24) NOT NULL DEFAULT 'script' CHECK (execution_mode IN ('script', 'notebook', 'auto')),
    allow_resubmission BOOLEAN NOT NULL DEFAULT TRUE,
    enable_ai_review BOOLEAN NOT NULL DEFAULT TRUE,
    status VARCHAR(24) NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'published', 'closed', 'archived')),
    cloned_from_id UUID REFERENCES public.assignments(id) ON DELETE SET NULL,
    created_by UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (due_at IS NULL OR start_at IS NULL OR due_at >= start_at)
);

CREATE INDEX idx_assignments_workspace ON public.assignments(workspace_id);
CREATE INDEX idx_assignments_classroom ON public.assignments(classroom_id);

CREATE TRIGGER trg_assignments_updated_at
    BEFORE UPDATE ON public.assignments
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================================
-- 8. assignment_submission_settings
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.assignment_submission_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    assignment_id UUID NOT NULL UNIQUE REFERENCES public.assignments(id) ON DELETE CASCADE,
    allow_colab_url BOOLEAN NOT NULL DEFAULT TRUE,
    allow_ipynb BOOLEAN NOT NULL DEFAULT TRUE,
    allow_py BOOLEAN NOT NULL DEFAULT TRUE,
    allow_zip BOOLEAN NOT NULL DEFAULT FALSE,
    allow_multiple_files BOOLEAN NOT NULL DEFAULT TRUE,
    max_file_size_mb INTEGER NOT NULL DEFAULT 10 CHECK (max_file_size_mb BETWEEN 1 AND 100),
    max_files_per_submission INTEGER NOT NULL DEFAULT 5 CHECK (max_files_per_submission BETWEEN 1 AND 50),
    max_zip_extracted_files INTEGER NOT NULL DEFAULT 50 CHECK (max_zip_extracted_files BETWEEN 1 AND 500),
    max_zip_uncompressed_mb INTEGER NOT NULL DEFAULT 25 CHECK (max_zip_uncompressed_mb BETWEEN 1 AND 200),
    allowed_zip_extensions TEXT[] NOT NULL DEFAULT ARRAY['.py', '.ipynb', '.txt', '.json', '.csv']::TEXT[],
    entry_file_name VARCHAR(128),
    portal_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (allow_colab_url OR allow_ipynb OR allow_py OR allow_zip)
);

CREATE INDEX idx_submission_settings_workspace ON public.assignment_submission_settings(workspace_id);

CREATE TRIGGER trg_submission_settings_updated_at
    BEFORE UPDATE ON public.assignment_submission_settings
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================================
-- 9. rubric_criteria
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.rubric_criteria (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    assignment_id UUID NOT NULL REFERENCES public.assignments(id) ON DELETE CASCADE,
    order_index INTEGER NOT NULL DEFAULT 0,
    name VARCHAR(200) NOT NULL,
    description TEXT,
    max_score NUMERIC(6,2) NOT NULL CHECK (max_score > 0),
    check_method VARCHAR(32) NOT NULL CHECK (check_method IN ('ast', 'runtime', 'test_case', 'ai_qualitative', 'manual')),
    rule_config JSONB NOT NULL DEFAULT '{}'::JSONB,
    pass_condition TEXT,
    allow_partial_credit BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_rubric_criteria_assignment ON public.rubric_criteria(assignment_id, order_index);
CREATE INDEX idx_rubric_criteria_workspace ON public.rubric_criteria(workspace_id);

CREATE TRIGGER trg_rubric_criteria_updated_at
    BEFORE UPDATE ON public.rubric_criteria
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================================
-- 10. test_cases
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.test_cases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    assignment_id UUID NOT NULL REFERENCES public.assignments(id) ON DELETE CASCADE,
    order_index INTEGER NOT NULL DEFAULT 0,
    name VARCHAR(200) NOT NULL,
    description TEXT,
    stdin_input TEXT NOT NULL DEFAULT '',
    expected_output TEXT NOT NULL DEFAULT '',
    comparator VARCHAR(32) NOT NULL DEFAULT 'normalized' CHECK (
        comparator IN ('exact', 'normalized', 'numeric_tolerance', 'json', 'function')
    ),
    comparator_config JSONB NOT NULL DEFAULT '{}'::JSONB,
    score_weight NUMERIC(6,2) NOT NULL DEFAULT 1.00 CHECK (score_weight >= 0),
    timeout_seconds INTEGER NOT NULL DEFAULT 5 CHECK (timeout_seconds BETWEEN 1 AND 60),
    is_hidden BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_test_cases_assignment ON public.test_cases(assignment_id, order_index);
CREATE INDEX idx_test_cases_workspace ON public.test_cases(workspace_id);

CREATE TRIGGER trg_test_cases_updated_at
    BEFORE UPDATE ON public.test_cases
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================================
-- 11. submissions
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.submissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    assignment_id UUID NOT NULL REFERENCES public.assignments(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
    google_submission_id VARCHAR(128),
    google_submission_state VARCHAR(48),
    source VARCHAR(32) NOT NULL DEFAULT 'portal' CHECK (source IN ('google_classroom', 'portal', 'teacher_upload')),
    status VARCHAR(32) NOT NULL DEFAULT 'submitted' CHECK (
        status IN ('not_submitted', 'submitted', 'queued', 'grading', 'graded', 'needs_review', 'approved', 'returned', 'error')
    ),
    latest_version_number INTEGER NOT NULL DEFAULT 1,
    latest_grading_run_id UUID,
    final_score NUMERIC(6,2) CHECK (final_score IS NULL OR final_score >= 0),
    is_approved BOOLEAN NOT NULL DEFAULT FALSE,
    approved_by UUID,
    approved_at TIMESTAMPTZ,
    submitted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (assignment_id, student_id)
);

CREATE INDEX idx_submissions_workspace ON public.submissions(workspace_id);
CREATE INDEX idx_submissions_assignment ON public.submissions(assignment_id);
CREATE INDEX idx_submissions_status ON public.submissions(workspace_id, status);

CREATE TRIGGER trg_submissions_updated_at
    BEFORE UPDATE ON public.submissions
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================================
-- 12. submission_versions
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.submission_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    submission_id UUID NOT NULL REFERENCES public.submissions(id) ON DELETE CASCADE,
    version_number INTEGER NOT NULL CHECK (version_number >= 1),
    notes TEXT,
    submitted_by UUID,
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (submission_id, version_number)
);

CREATE INDEX idx_submission_versions_submission ON public.submission_versions(submission_id);

-- ============================================================================
-- 13. submission_artifacts
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.submission_artifacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    submission_id UUID NOT NULL REFERENCES public.submissions(id) ON DELETE CASCADE,
    version_id UUID NOT NULL REFERENCES public.submission_versions(id) ON DELETE CASCADE,
    artifact_type VARCHAR(24) NOT NULL CHECK (artifact_type IN ('colab_url', 'ipynb', 'py', 'zip')),
    original_filename VARCHAR(255),
    colab_url TEXT,
    google_drive_file_id VARCHAR(128),
    storage_bucket VARCHAR(128),
    storage_path TEXT,
    file_size_bytes BIGINT CHECK (file_size_bytes IS NULL OR file_size_bytes >= 0),
    sha256_hash VARCHAR(64),
    mime_type VARCHAR(128),
    fetch_status VARCHAR(32) NOT NULL DEFAULT 'ready' CHECK (
        fetch_status IN ('pending', 'ready', 'permission_denied', 'file_deleted', 'invalid_format', 'security_blocked', 'error')
    ),
    fetch_error TEXT,
    extracted_manifest JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_submission_artifacts_submission ON public.submission_artifacts(submission_id);
CREATE INDEX idx_submission_artifacts_version ON public.submission_artifacts(version_id);

-- ============================================================================
-- 14. notebook_cells
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.notebook_cells (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    artifact_id UUID NOT NULL REFERENCES public.submission_artifacts(id) ON DELETE CASCADE,
    cell_index INTEGER NOT NULL CHECK (cell_index >= 0),
    cell_type VARCHAR(24) NOT NULL CHECK (cell_type IN ('code', 'markdown', 'raw')),
    source_code TEXT NOT NULL DEFAULT '',
    saved_outputs JSONB NOT NULL DEFAULT '[]'::JSONB,
    execution_count INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (artifact_id, cell_index)
);

CREATE INDEX idx_notebook_cells_artifact ON public.notebook_cells(artifact_id, cell_index);

-- ============================================================================
-- 15. grading_runs (Immutable history per grading execution)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.grading_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    submission_id UUID NOT NULL REFERENCES public.submissions(id) ON DELETE CASCADE,
    version_id UUID NOT NULL REFERENCES public.submission_versions(id) ON DELETE CASCADE,
    run_number INTEGER NOT NULL CHECK (run_number >= 1),
    celery_task_id VARCHAR(128),
    status VARCHAR(32) NOT NULL DEFAULT 'queued' CHECK (
        status IN ('queued', 'running', 'completed', 'failed', 'cancelled', 'unreadable_artifact')
    ),
    triggered_by UUID,
    automated_score NUMERIC(6,2) CHECK (automated_score IS NULL OR automated_score >= 0),
    ai_suggested_score NUMERIC(6,2) CHECK (ai_suggested_score IS NULL OR ai_suggested_score >= 0),
    final_score NUMERIC(6,2) CHECK (final_score IS NULL OR final_score >= 0),
    max_score NUMERIC(6,2) NOT NULL CHECK (max_score > 0),
    ast_summary JSONB NOT NULL DEFAULT '{}'::JSONB,
    runtime_summary JSONB NOT NULL DEFAULT '{}'::JSONB,
    ai_feedback JSONB,
    error_message TEXT,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (submission_id, run_number),
    CHECK (final_score IS NULL OR final_score <= max_score)
);

CREATE INDEX idx_grading_runs_submission ON public.grading_runs(submission_id, run_number DESC);
CREATE INDEX idx_grading_runs_workspace ON public.grading_runs(workspace_id, status);

-- Add FK from submissions.latest_grading_run_id -> grading_runs.id
ALTER TABLE public.submissions
    ADD CONSTRAINT fk_submissions_latest_grading_run
    FOREIGN KEY (latest_grading_run_id) REFERENCES public.grading_runs(id) ON DELETE SET NULL;

-- ============================================================================
-- 16. criterion_results
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.criterion_results (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    grading_run_id UUID NOT NULL REFERENCES public.grading_runs(id) ON DELETE CASCADE,
    criterion_id UUID REFERENCES public.rubric_criteria(id) ON DELETE SET NULL,
    criterion_name VARCHAR(200) NOT NULL,
    check_method VARCHAR(32) NOT NULL,
    max_score NUMERIC(6,2) NOT NULL CHECK (max_score > 0),
    awarded_score NUMERIC(6,2) NOT NULL CHECK (awarded_score >= 0 AND awarded_score <= max_score),
    status VARCHAR(24) NOT NULL CHECK (status IN ('passed', 'partial', 'failed', 'pending_review', 'error')),
    reason TEXT,
    evidence JSONB NOT NULL DEFAULT '{}'::JSONB,
    is_ai_evaluated BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_criterion_results_run ON public.criterion_results(grading_run_id);

-- ============================================================================
-- 17. test_results
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.test_results (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    grading_run_id UUID NOT NULL REFERENCES public.grading_runs(id) ON DELETE CASCADE,
    test_case_id UUID REFERENCES public.test_cases(id) ON DELETE SET NULL,
    test_name VARCHAR(200) NOT NULL,
    is_hidden BOOLEAN NOT NULL DEFAULT FALSE,
    passed BOOLEAN NOT NULL DEFAULT FALSE,
    comparator VARCHAR(32) NOT NULL,
    expected_output TEXT,
    actual_output TEXT,
    stderr TEXT,
    exit_code INTEGER,
    timed_out BOOLEAN NOT NULL DEFAULT FALSE,
    execution_time_ms INTEGER CHECK (execution_time_ms IS NULL OR execution_time_ms >= 0),
    memory_usage_kb INTEGER CHECK (memory_usage_kb IS NULL OR memory_usage_kb >= 0),
    score_awarded NUMERIC(6,2) NOT NULL DEFAULT 0 CHECK (score_awarded >= 0),
    max_score NUMERIC(6,2) NOT NULL DEFAULT 0 CHECK (max_score >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_test_results_run ON public.test_results(grading_run_id);

-- ============================================================================
-- 18. grade_adjustments
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.grade_adjustments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    submission_id UUID NOT NULL REFERENCES public.submissions(id) ON DELETE CASCADE,
    grading_run_id UUID NOT NULL REFERENCES public.grading_runs(id) ON DELETE CASCADE,
    adjusted_by UUID NOT NULL,
    previous_score NUMERIC(6,2) NOT NULL CHECK (previous_score >= 0),
    new_score NUMERIC(6,2) NOT NULL CHECK (new_score >= 0),
    reason TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_grade_adjustments_submission ON public.grade_adjustments(submission_id, created_at DESC);

-- ============================================================================
-- 19. teacher_feedback
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.teacher_feedback (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    submission_id UUID NOT NULL REFERENCES public.submissions(id) ON DELETE CASCADE,
    grading_run_id UUID REFERENCES public.grading_runs(id) ON DELETE SET NULL,
    author_user_id UUID NOT NULL,
    comment TEXT NOT NULL,
    is_visible_to_student BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_teacher_feedback_submission ON public.teacher_feedback(submission_id);

CREATE TRIGGER trg_teacher_feedback_updated_at
    BEFORE UPDATE ON public.teacher_feedback
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================================
-- 20. grade_sync_logs
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.grade_sync_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    assignment_id UUID NOT NULL REFERENCES public.assignments(id) ON DELETE CASCADE,
    submission_id UUID NOT NULL REFERENCES public.submissions(id) ON DELETE CASCADE,
    google_connection_id UUID REFERENCES public.google_connections(id) ON DELETE SET NULL,
    synced_by UUID NOT NULL,
    synced_score NUMERIC(6,2) NOT NULL CHECK (synced_score >= 0),
    status VARCHAR(24) NOT NULL CHECK (status IN ('success', 'failed', 'skipped')),
    response_payload JSONB,
    error_message TEXT,
    synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_grade_sync_logs_assignment ON public.grade_sync_logs(assignment_id, synced_at DESC);

-- ============================================================================
-- 21. audit_logs
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID REFERENCES public.workspaces(id) ON DELETE SET NULL,
    actor_user_id UUID,
    actor_email CITEXT,
    action VARCHAR(120) NOT NULL,
    resource_type VARCHAR(64) NOT NULL,
    resource_id VARCHAR(128),
    ip_address VARCHAR(64),
    user_agent TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_logs_workspace_time ON public.audit_logs(workspace_id, created_at DESC);
CREATE INDEX idx_audit_logs_actor ON public.audit_logs(actor_user_id, created_at DESC);

-- ============================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES — Multi-Tenant Isolation
-- ============================================================================
ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.google_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.classrooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assignment_submission_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rubric_criteria ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.test_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.submission_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.submission_artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notebook_cells ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.grading_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.criterion_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.test_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.grade_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teacher_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.grade_sync_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Workspaces policy
CREATE POLICY workspaces_isolation ON public.workspaces
    USING (public.is_super_admin() OR owner_user_id = public.current_actor_id() OR public.has_workspace_access(id));

-- Tenant-scoped policies for all workspace tables
DO $$
DECLARE
    tbl TEXT;
BEGIN
    FOREACH tbl IN ARRAY ARRAY[
        'workspace_members',
        'google_connections',
        'classrooms',
        'students',
        'enrollments',
        'assignments',
        'assignment_submission_settings',
        'rubric_criteria',
        'test_cases',
        'submissions',
        'submission_versions',
        'submission_artifacts',
        'notebook_cells',
        'grading_runs',
        'criterion_results',
        'test_results',
        'grade_adjustments',
        'teacher_feedback',
        'grade_sync_logs'
    ]
    LOOP
        EXECUTE format(
            'CREATE POLICY %I_tenant_isolation ON public.%I USING (public.has_workspace_access(workspace_id)) WITH CHECK (public.has_workspace_access(workspace_id));',
            tbl, tbl
        );
    END LOOP;
END $$;

-- Audit logs: readable by super_admin or workspace members for their workspace
CREATE POLICY audit_logs_isolation ON public.audit_logs
    FOR SELECT
    USING (public.is_super_admin() OR (workspace_id IS NOT NULL AND public.has_workspace_access(workspace_id)));

CREATE POLICY audit_logs_insert ON public.audit_logs
    FOR INSERT
    WITH CHECK (TRUE);
