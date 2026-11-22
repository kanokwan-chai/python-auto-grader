# System Architecture — Python Auto Grader

## 1. High-Level Architecture

Python Auto Grader is a multi-tenant, production-grade educational SaaS platform engineered with strict separation of concerns and security boundaries:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Frontend (Vercel / Next.js)                     │
│  Next.js App Router + TypeScript + Tailwind CSS (Light Pastel Theme)   │
│  Supabase Auth Client + Typed REST API Client                           │
└───────────────────────────────────┬─────────────────────────────────────┘
                                    │ HTTPS + Bearer JWT + X-Workspace-Id
┌───────────────────────────────────▼─────────────────────────────────────┐
│                      Backend API Server (FastAPI)                       │
│  Auth Verification │ RBAC & Workspace Guard │ Rate Limiter │ Audit Log  │
│  REST API v1 │ Google Classroom/Drive API │ Storage │ Excel Exporter    │
└──────────┬────────────────────────┬─────────────────────────┬───────────┘
           │                        │                         │
           ▼                        ▼                         ▼
┌─────────────────────┐  ┌─────────────────────┐   ┌─────────────────────┐
│ Supabase PostgreSQL │  │   Redis + Celery    │   │  Supabase Storage   │
│ 21 Tables + RLS     │  │  Async Grading Queue│   │  Private Buckets    │
│ Multi-Tenant Guard  │  │  Batch & Sync Jobs  │   │  (.ipynb/.py/.zip)  │
└─────────────────────┘  └──────────┬──────────┘   └─────────────────────┘
                                    │ Internal Authenticated HTTP (mTLS/Shared Key)
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│             Isolated Sandbox Server (Separate Host / Network)           │
│  Sandbox Orchestrator -> Ephemeral Containers (Docker + gVisor runsc)   │
│  • --network=none          • --read-only + tmpfs /tmp                   │
│  • --cap-drop=ALL          • --security-opt=no-new-privileges           │
│  • CPU/RAM/PID/File limits • Destroyed immediately after execution      │
│  • Zero access to DB, Backend Env, Google Tokens, or Host Filesystem    │
└─────────────────────────────────────────────────────────────────────────┘
```

## 2. Multi-Tenancy & Access Control

- **Workspace Isolation**: Every domain table carries a `workspace_id` foreign key referencing `workspaces(id)`.
- **PostgreSQL Row Level Security (RLS)**: Enabled on all tenant tables. Every database session sets `app.current_user_id` and `app.current_workspace_id` so Postgres enforces isolation even at the SQL layer.
- **Role-Based Access Control (RBAC)**:
  - `super_admin`: Global system administration, audit logs, workspace management.
  - `teacher` (Workspace Owner/Admin): Full workspace management, Google Classroom connection, assignment/rubric/test authoring, grading, score override, grade approval & sync.
  - `workspace_member` (`grader` / `viewer`): Scoped permissions inside a workspace; cannot approve/sync grades or alter workspace billing/integrations unless explicitly permitted.
  - `student`: Can submit work via Google Classroom or enabled Submission Portal only for enrolled classrooms/assignments.

## 3. Mixed Submission & Notebook Processing Pipeline

A single assignment supports any combination of:
1. `colab_url` — Google Colab URL -> validated regex -> Google Drive File ID -> downloaded via Google Drive API using teacher's encrypted OAuth token -> parsed with `nbformat`.
2. `ipynb` — Uploaded Jupyter Notebook -> parsed with `nbformat` -> Markdown cells, Code cells, saved outputs (for reference only — **never trusted as execution proof**), and cell ordering persisted in `notebook_cells`.
3. `py` — Single or multiple `.py` files. Files are **never auto-merged** unless an explicit entry point/relationship is configured.
4. `zip` — Inspected before extraction by `file_security.py` to block ZIP bombs (compression ratio & uncompressed size caps), path traversal (`../`, absolute paths, symlinks), disallowed extensions, and file count limits.

## 4. Grading Engine Architecture

Every grading execution creates an immutable `grading_runs` record (re-grading never overwrites history):
1. **Static Analysis (`ast_analyzer.py`)**: Parses Python AST (`ast.parse`) to verify syntax, variable declarations, loops (`For`/`While`), conditionals (`If`), function calls, method calls (e.g., `append`, `pop`), list usage, and structural rules — never relying on naive substring matching.
2. **Sandboxed Runtime Execution (`sandbox_client.py` -> `sandbox/`)**: Executes student code in a fresh, network-isolated container (`runsc` / Docker) with strict CPU, RAM, PID, file size, and timeout limits.
3. **Test Case Engine (`test_engine.py`)**: Runs visible and hidden test cases with `exact`, `normalized`, `numeric_tolerance`, `json`, and `function` comparators.
4. **Rubric Engine (`rubric_engine.py`)**: Maps AST checks, runtime checks, test cases, and qualitative criteria to weighted rubric items with partial credit and strict `[0, max_score]` bounds.
5. **AI Code Review (`ai_reviewer.py`)**: Produces structured Thai feedback, error explanations, readability insights, and qualitative rubric suggestions. AI scores are strictly separated from deterministic automated scores and require teacher review/approval. AI **never** overrides deterministic Test Case pass/fail results.

## 5. Security Controls

- **Token Encryption**: Google OAuth Access & Refresh Tokens are encrypted at rest using Fernet (AES-128-CBC + HMAC-SHA256) with a dedicated `TOKEN_ENCRYPTION_KEY`.
- **OAuth Scope Separation**: Initial connection requests read-only Classroom/Drive scopes; grade write-back (`classroom.coursework.students`) is requested separately when enabling grade sync.
- **CSRF Protection**: OAuth `state` parameter is cryptographically signed and bound to the authenticated user & workspace with short TTL in Redis.
- **Audit Logging**: All sensitive actions (auth, OAuth connect/revoke, grade adjustment, grade approval, grade sync, role changes) are recorded in `audit_logs`.
