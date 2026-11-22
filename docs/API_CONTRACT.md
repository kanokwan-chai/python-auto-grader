# REST API Contract — Python Auto Grader (v1)

Base URL: `/api/v1`
Authentication: `Authorization: Bearer <supabase_jwt>`
Tenant Header: `X-Workspace-Id: <workspace_uuid>` (required for all workspace-scoped endpoints)

## 1. Auth & Profile
- `GET /auth/me` — Get authenticated user profile, global role, and accessible workspaces.

## 2. Workspaces
- `GET /workspaces` — List workspaces the user belongs to.
- `POST /workspaces` — Create a new workspace (caller becomes `owner`).
- `GET /workspaces/{workspace_id}` — Get workspace details.
- `PATCH /workspaces/{workspace_id}` — Update workspace settings.
- `GET /workspaces/{workspace_id}/members` — List workspace members & roles.
- `POST /workspaces/{workspace_id}/members` — Invite/add a member with role (`teacher`, `grader`, `viewer`).
- `PATCH /workspaces/{workspace_id}/members/{member_id}` — Update member role/permissions.
- `DELETE /workspaces/{workspace_id}/members/{member_id}` — Remove member.

## 3. Classrooms & Students
- `GET /classrooms` — List classrooms in current workspace.
- `POST /classrooms` — Create a classroom manually.
- `GET /classrooms/{classroom_id}` — Get classroom details and student count.
- `PATCH /classrooms/{classroom_id}` — Update classroom details.
- `DELETE /classrooms/{classroom_id}` — Archive/delete classroom.
- `GET /classrooms/{classroom_id}/students` — List enrolled students.
- `POST /classrooms/{classroom_id}/students` — Add/enroll a student manually.
- `DELETE /classrooms/{classroom_id}/students/{student_id}` — Unenroll student.

## 4. Google OAuth & Google Classroom Integration
- `GET /google/oauth/authorize?scope_mode=read|write` — Generate signed Google OAuth 2.0 authorization URL.
- `GET /google/oauth/callback` — Handle OAuth callback, encrypt & store tokens, verify CSRF state.
- `GET /google/connections` — List connected Google accounts in workspace (tokens never returned).
- `DELETE /google/connections/{connection_id}` — Revoke & disconnect Google account.
- `GET /google/connections/{connection_id}/courses` — Fetch courses from Google Classroom API.
- `POST /google/connections/{connection_id}/courses/{course_id}/import` — Import Google course as a Classroom + sync students.
- `GET /google/connections/{connection_id}/courses/{course_id}/students` — Fetch roster from Classroom API.
- `GET /google/connections/{connection_id}/courses/{course_id}/coursework` — Fetch assignments (courseWork) from Classroom API.
- `POST /google/connections/{connection_id}/courses/{course_id}/coursework/{coursework_id}/import-submissions` — Import student submissions & Drive attachments/Colab links.
- `POST /google/grade-sync/{assignment_id}` — Sync approved grades back to Google Classroom (requires write scope + teacher approval; logs to `grade_sync_logs`).

## 5. Assignments, Submission Settings, Rubrics & Test Cases
- `GET /assignments` — List assignments (filterable by `classroom_id`, `status`).
- `POST /assignments` — Create assignment with submission settings, rubric criteria, and test cases.
- `GET /assignments/{assignment_id}` — Get full assignment details.
- `PATCH /assignments/{assignment_id}` — Update assignment.
- `POST /assignments/{assignment_id}/clone` — Clone assignment (including settings, rubric, test cases) into another classroom.
- `PUT /assignments/{assignment_id}/submission-settings` — Configure allowed formats (`colab_url`, `ipynb`, `py`, `zip`), max file size, max files.
- `PUT /assignments/{assignment_id}/rubric` — Replace/update rubric criteria (validates total max score <= assignment max score).
- `PUT /assignments/{assignment_id}/test-cases` — Replace/update test cases (visible & hidden).

## 6. Submissions & Artifacts
- `GET /assignments/{assignment_id}/submissions` — List all student submissions for an assignment.
- `POST /assignments/{assignment_id}/submissions` — Create/update a submission (supports Colab URL and/or multi-file upload: `.ipynb`, `.py`, `.zip`).
- `GET /submissions/{submission_id}` — Get submission detail, artifacts, versions, parsed notebook cells, and latest grading run.
- `POST /submissions/{submission_id}/artifacts` — Upload additional artifact or attach Colab URL to an existing submission.
- `POST /submissions/{submission_id}/parse-notebook` — Re-parse `.ipynb` or Colab file into `notebook_cells`.

## 7. Grading, Adjustments & Feedback
- `POST /grading/submissions/{submission_id}/run` — Queue a new grading run (AST + Sandbox + Tests + Rubric + optional AI Review).
- `POST /grading/assignments/{assignment_id}/run-batch` — Queue grading for multiple or all submissions.
- `POST /grading/runs/{run_id}/cancel` — Cancel a queued grading run.
- `GET /grading/submissions/{submission_id}/runs` — List full immutable grading run history.
- `GET /grading/runs/{run_id}` — Get detailed criterion results, test results, execution logs, and AI feedback.
- `POST /grading/runs/{run_id}/adjust` — Teacher adjusts score (records `previous_score`, `new_score`, `reason` in `grade_adjustments`).
- `POST /grading/runs/{run_id}/feedback` — Save teacher comment (`teacher_feedback`).
- `POST /grading/runs/{run_id}/approve` — Approve final grade (unlocks Google Classroom grade sync).

## 8. Reports & Exports
- `GET /reports/dashboard` — Workspace analytics summary (counts, averages, pass rate, submission status).
- `GET /reports/export/excel` — Export `.xlsx` workbook (`report_type=classroom|course|assignment|student|submission_status|rubric_breakdown`).

## 9. Audit Logs
- `GET /audit-logs` — Paginated audit log viewer (scoped to workspace, or global for `super_admin`).
