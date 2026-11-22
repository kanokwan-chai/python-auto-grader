# Setup Guide: Supabase, Google Classroom OAuth, LLM API & Sandbox

This application uses **real integrations** (no fake OAuth or mock DB). Follow these steps to connect external services.

## 1. Supabase (PostgreSQL + Auth + Storage)
1. Create a project at [Supabase](https://supabase.com) (or run local PostgreSQL via `docker-compose.yml`).
2. Run the SQL migration in `supabase/migrations/20261122000001_initial_schema.sql` using the Supabase SQL Editor or CLI (`supabase db push`).
3. Create a **Private** Storage Bucket named `submissions` in Supabase Storage.
4. Copy the following values into `.env`:
   - `DATABASE_URL` (PostgreSQL connection string using `postgresql+asyncpg://...`)
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `SUPABASE_JWT_SECRET` (Settings -> API -> JWT Secret)

## 2. Google Cloud (OAuth 2.0 + Classroom API + Drive API)
1. Open [Google Cloud Console](https://console.cloud.google.com/).
2. Create a project and enable:
   - **Google Classroom API**
   - **Google Drive API**
3. Configure the **OAuth Consent Screen** (External or Internal Workspace) and add scopes:
   - Read scopes (initial connection):
     - `https://www.googleapis.com/auth/userinfo.email`
     - `https://www.googleapis.com/auth/classroom.courses.readonly`
     - `https://www.googleapis.com/auth/classroom.rosters.readonly`
     - `https://www.googleapis.com/auth/classroom.coursework.students.readonly`
     - `https://www.googleapis.com/auth/classroom.student-submissions.students.readonly`
     - `https://www.googleapis.com/auth/drive.readonly`
   - Write scope (requested separately when enabling grade sync):
     - `https://www.googleapis.com/auth/classroom.coursework.students`
4. Create an **OAuth 2.0 Client ID** (Web Application):
   - Authorized redirect URI: `http://localhost:8000/api/v1/google/oauth/callback` (and your production backend URL).
5. Copy `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REDIRECT_URI` into `.env`.
6. Generate a Fernet encryption key for storing OAuth tokens safely:
   ```bash
   python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
   ```
   Set `TOKEN_ENCRYPTION_KEY` in `.env`.

## 3. AI Code Review (LLM API)
- Set `LLM_API_KEY`, `LLM_BASE_URL` (defaults to OpenAI-compatible endpoint, works with OpenAI, Gemini OpenAI-compat, OpenRouter, etc.), and `LLM_MODEL` (e.g., `gpt-4o-mini` or `gemini-2.5-flash`).
- If `LLM_API_KEY` is not set, automated AST + Sandbox + Test Case + Rubric grading continues normally, and AI Review explicitly reports `unconfigured` instead of fabricating fake AI feedback.

## 4. Isolated Python Sandbox (Docker + gVisor)
- For development, `sandbox/` runs student containers with Docker (`--network=none`, `--cap-drop=ALL`, `--read-only`, `--pids-limit=64`, memory/CPU caps).
- For production Linux hosts, install **gVisor (`runsc`)** and set `SANDBOX_DOCKER_RUNTIME=runsc` in `.env`.
- Always deploy the `sandbox` service on a separate VM/host from the Database and Backend API server.
