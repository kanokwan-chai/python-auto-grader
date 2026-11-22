# Python Auto Grader

ระบบตรวจงานเขียนโปรแกรมภาษา Python อัตโนมัติแบบครบวงจรสำหรับครูและสถาบันการศึกษา รองรับหลาย Workspace, หลายห้องเรียน, เชื่อมต่อ Google Classroom & Google Drive API จริง, รับงานหลายรูปแบบในใบงานเดียว (Colab URL / `.ipynb` / `.py` / `.zip`), ตรวจโค้ดด้วย Python AST, รันโค้ดใน Isolated Sandbox (Docker / gVisor), ทดสอบ Test Cases, ให้คะแนนตาม Rubric, วิเคราะห์โค้ดด้วย AI ภาษาไทย, ปรับคะแนนและอนุมัติส่งกลับ Google Classroom พร้อมส่งออกรายงาน Excel

## Project Structure

- `docs/` — System Architecture, API Contract, UI Design System, Testing Strategy, and External Setup Guide
- `supabase/migrations/` — Multi-tenant PostgreSQL schema (21 tables, RLS policies, indexes, constraints)
- `sandbox/` — Isolated Python code execution service (Docker + gVisor `runsc`, no network, non-root, resource caps)
- `backend/` — Python FastAPI + SQLAlchemy Async + Celery/Redis + AST/Test/Rubric/AI/Google/Excel services + `pytest` suite
- `frontend/` — Next.js App Router + TypeScript + Tailwind CSS (Light Pastel Lavender/Soft Purple/Peach/Cream Theme)

## Quick Start (Docker Compose)

1. Copy `.env.example` to `.env` and configure your credentials (see `docs/SETUP_GOOGLE_AND_SUPABASE.md`).
2. Build the student sandbox Python image:
   ```bash
   docker build -f sandbox/Dockerfile.student -t pyautograder-student-python:3.11 sandbox/
   ```
3. Start all services:
   ```bash
   docker compose up --build
   ```
4. Open:
   - Frontend: `http://localhost:3000`
   - Backend OpenAPI Docs: `http://localhost:8000/docs`

## Running Tests

### Backend Unit & Integration Tests
```bash
docker compose run --rm backend pytest -v
```

### Frontend Type-check & Build
```bash
cd frontend
npm install
npm run build
```
