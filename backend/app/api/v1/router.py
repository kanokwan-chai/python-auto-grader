from fastapi import APIRouter

from app.api.v1 import (
    assignments,
    auth,
    classrooms,
    google_classroom,
    grading,
    reports,
    submissions,
    workspaces,
)

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(auth.router)
api_router.include_router(workspaces.router)
api_router.include_router(classrooms.router)
api_router.include_router(google_classroom.router)
api_router.include_router(assignments.router)
api_router.include_router(submissions.router)
api_router.include_router(grading.router)
api_router.include_router(reports.router)
