export interface UserProfile {
  user_id: string;
  email: string;
  full_name: string;
  global_role: string;
}

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  owner_user_id: string;
  plan_tier: string;
  is_active: boolean;
  created_at: string;
}

export interface WorkspaceMember {
  id: string;
  workspace_id: string;
  user_id: string;
  email: string;
  full_name?: string | null;
  role: string;
  can_edit_grades: boolean;
  can_approve_grades: boolean;
  can_sync_classroom: boolean;
  status: string;
}

export interface Classroom {
  id: string;
  workspace_id: string;
  google_connection_id?: string | null;
  google_course_id?: string | null;
  name: string;
  code: string;
  grade_level?: string | null;
  major?: string | null;
  academic_year?: string | null;
  semester?: string | null;
  subject_name: string;
  status: string;
  source: string;
  created_at: string;
}

export interface Student {
  id: string;
  workspace_id: string;
  student_code?: string | null;
  full_name: string;
  email: string;
  google_user_id?: string | null;
  avatar_url?: string | null;
}

export interface Assignment {
  id: string;
  workspace_id: string;
  classroom_id: string;
  google_coursework_id?: string | null;
  title: string;
  description?: string | null;
  instructions?: string | null;
  problem_statement: string;
  max_score: number;
  start_at?: string | null;
  due_at?: string | null;
  subject_name?: string | null;
  python_version: string;
  execution_mode: string;
  allow_resubmission: boolean;
  enable_ai_review: boolean;
  status: string;
  created_at: string;
}

export interface SubmissionSummary {
  submission: {
    id: string;
    assignment_id: string;
    student_id: string;
    source: string;
    status: string;
    latest_version_number: number;
    latest_grading_run_id?: string | null;
    final_score?: number | null;
    is_approved: boolean;
    submitted_at?: string | null;
  };
  student: {
    id: string;
    full_name: string;
    email: string;
    student_code?: string | null;
  };
  artifact_types: string[];
  artifacts?: Array<{
    id: string;
    artifact_type: string;
    original_filename?: string | null;
    colab_url?: string | null;
    fetch_status: string;
  }>;
  graded_artifacts?: Array<{
    id: string;
    artifact_type: string;
    filename: string;
  }> | null;
  ai_usage_percent?: number | null;
}

export interface CriterionResult {
  id: string;
  criterion_name: string;
  check_method: string;
  max_score: number;
  awarded_score: number;
  status: string;
  reason?: string | null;
  evidence: Record<string, unknown>;
  is_ai_evaluated: boolean;
}

export interface TestResult {
  id: string;
  test_name: string;
  is_hidden: boolean;
  passed: boolean;
  comparator: string;
  expected_output?: string | null;
  actual_output?: string | null;
  stderr?: string | null;
  exit_code?: number | null;
  timed_out: boolean;
  execution_time_ms?: number | null;
  memory_usage_kb?: number | null;
  score_awarded: number;
  max_score: number;
}

export interface GradingRun {
  id: string;
  submission_id: string;
  version_id: string;
  run_number: number;
  status: string;
  automated_score?: number | null;
  ai_suggested_score?: number | null;
  final_score?: number | null;
  max_score: number;
  ast_summary: Record<string, unknown>;
  runtime_summary: Record<string, unknown>;
  ai_feedback?: {
    status: string;
    summary_th?: string;
    error_explanation_th?: string | null;
    fix_suggestions_th?: string[];
    readability_notes_th?: string[];
  } | null;
  error_message?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  created_at: string;
}

export interface DashboardStats {
  total_assignments: number;
  total_classrooms: number;
  total_students: number;
  submitted_count: number;
  not_submitted_count: number;
  pending_grading_count: number;
  graded_count: number;
  average_score: number | null;
  max_score_achieved: number | null;
  min_score_achieved: number | null;
  pass_rate_percent: number | null;
}

export interface GoogleConnection {
  id: string;
  workspace_id: string;
  google_account_email: string;
  has_write_scope: boolean;
  status: string;
  last_synced_at?: string | null;
  last_error?: string | null;
  created_at: string;
}
