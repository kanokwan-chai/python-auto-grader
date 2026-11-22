"""End-to-End FastAPI Integration Tests (Multi-Tenancy, Mixed Submissions, Grading History, Excel Export)."""

from __future__ import annotations

import io
import zipfile

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.database import Base, get_db
from app.core.security import create_access_token
from app.main import app


@pytest.fixture
async def api_client(tmp_path):
    db_file = tmp_path / "test_pyautograder.db"
    test_engine = create_async_engine(f"sqlite+aiosqlite:///{db_file}", echo=False)
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    TestSessionLocal = async_sessionmaker(bind=test_engine, class_=AsyncSession, expire_on_commit=False)

    async def _override_get_db():
        async with TestSessionLocal() as session:
            yield session

    app.dependency_overrides[get_db] = _override_get_db
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
        yield client
    app.dependency_overrides.clear()
    await test_engine.dispose()


@pytest.mark.asyncio
async def test_full_multitenant_mixed_submission_and_excel_flow(api_client: httpx.AsyncClient):
    t1_token = create_access_token("teacher-1", "t1@school.ac.th", "Teacher One", "teacher")
    t2_token = create_access_token("teacher-2", "t2@school.ac.th", "Teacher Two", "teacher")

    # 1. Teacher 1 creates Workspace A
    res_ws = await api_client.post(
        "/api/v1/workspaces",
        headers={"Authorization": f"Bearer {t1_token}"},
        json={"name": "CS Dept A", "slug": "cs-dept-a"},
    )
    assert res_ws.status_code == 201, res_ws.text
    ws_a_id = res_ws.json()["id"]

    # 2. Teacher 2 must be blocked (403) from Workspace A
    res_forbidden = await api_client.get(
        "/api/v1/classrooms",
        headers={"Authorization": f"Bearer {t2_token}", "X-Workspace-Id": ws_a_id},
    )
    assert res_forbidden.status_code == 403

    t1_headers = {"Authorization": f"Bearer {t1_token}", "X-Workspace-Id": ws_a_id}

    # 3. Create Classroom & Enroll Student
    res_cls = await api_client.post(
        "/api/v1/classrooms",
        headers=t1_headers,
        json={"name": "ม.4/1 Python", "code": "PY-401", "subject_name": "วิทยาการคำนวณ", "academic_year": "2569", "semester": "1"},
    )
    assert res_cls.status_code == 201, res_cls.text
    cls_id = res_cls.json()["id"]

    res_stu = await api_client.post(
        f"/api/v1/classrooms/{cls_id}/students",
        headers=t1_headers,
        json={"student_code": "69001", "full_name": "สมชาย ใจดี", "email": "somchai@student.ac.th"},
    )
    assert res_stu.status_code == 201
    stu_id = res_stu.json()["id"]

    # 4. Create Assignment with Mixed Submission Settings (Colab + IPYNB + PY + ZIP)
    res_asg = await api_client.post(
        "/api/v1/assignments",
        headers=t1_headers,
        json={
            "classroom_id": cls_id,
            "title": "Lab 1: Queue Structure",
            "problem_statement": "สร้างคิวว่าง ใช้ append() และ pop(0)",
            "max_score": 10,
            "enable_ai_review": False,
            "submission_settings": {
                "allow_colab_url": True,
                "allow_ipynb": True,
                "allow_py": True,
                "allow_zip": True,
                "allow_multiple_files": True,
            },
            "rubric_criteria": [
                {"name": "สร้างคิวว่าง", "max_score": 5, "check_method": "ast", "rule_config": {"require_empty_list": True}},
                {"name": "ใช้ append()", "max_score": 5, "check_method": "ast", "rule_config": {"require_method_calls": ["append"]}},
            ],
            "test_cases": [],
        },
    )
    assert res_asg.status_code == 201, res_asg.text
    asg_id = res_asg.json()["id"]

    # 5. Mixed Submission: Colab URL + .py file simultaneously
    res_sub = await api_client.post(
        f"/api/v1/assignments/{asg_id}/submissions",
        headers=t1_headers,
        data={
            "student_id": stu_id,
            "colab_url": "https://colab.research.google.com/drive/1AbCdEfGhIjKlMnOpQrStUvWxYz123456",
        },
        files=[("files", ("queue_lab.py", b"q = []\nq.append('A')\nprint(q)\n", "text/x-python"))],
    )
    assert res_sub.status_code == 201, res_sub.text
    assert len(res_sub.json()["artifacts"]) == 2

    # 6. Malicious ZIP with path traversal must be rejected (400)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("../../evil.py", b"print('pwned')")
    res_bad_zip = await api_client.post(
        f"/api/v1/assignments/{asg_id}/submissions",
        headers=t1_headers,
        data={"student_id": stu_id},
        files=[("files", ("evil.zip", buf.getvalue(), "application/zip"))],
    )
    assert res_bad_zip.status_code == 400
    assert "Path traversal" in res_bad_zip.text

    # 7. Dashboard & Excel Export
    res_dash = await api_client.get("/api/v1/reports/dashboard", headers=t1_headers)
    assert res_dash.status_code == 200
    assert res_dash.json()["total_assignments"] == 1

    res_xlsx = await api_client.get(
        "/api/v1/reports/export/excel?report_type=assignment",
        headers=t1_headers,
    )
    assert res_xlsx.status_code == 200
    assert "spreadsheetml" in res_xlsx.headers["content-type"]
    assert len(res_xlsx.content) > 500
