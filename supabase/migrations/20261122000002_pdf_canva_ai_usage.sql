-- ============================================================================
-- Migration 2: Support PDF, Canva URL artifacts and Document Rubric criteria
-- ============================================================================

ALTER TABLE public.assignment_submission_settings
    ADD COLUMN IF NOT EXISTS allow_pdf BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS allow_canva_url BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE public.submission_artifacts
    DROP CONSTRAINT IF EXISTS submission_artifacts_artifact_type_check;

ALTER TABLE public.submission_artifacts
    ADD CONSTRAINT submission_artifacts_artifact_type_check
    CHECK (artifact_type IN ('colab_url', 'ipynb', 'py', 'zip', 'pdf', 'canva_url'));

ALTER TABLE public.rubric_criteria
    DROP CONSTRAINT IF EXISTS rubric_criteria_check_method_check;

ALTER TABLE public.rubric_criteria
    ADD CONSTRAINT rubric_criteria_check_method_check
    CHECK (check_method IN ('ast', 'runtime', 'test_case', 'document', 'ai_qualitative', 'manual'));
