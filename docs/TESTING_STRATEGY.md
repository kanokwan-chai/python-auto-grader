# Testing & Security Verification Strategy

## 1. Unit Tests (`backend/tests/`)
- `test_ast_analyzer.py`: Verifies AST detection of variables, `append()`, `pop(0)`, loops, conditionals, list literals, syntax errors, and proves comments/strings containing keywords do **not** falsely satisfy AST rules.
- `test_file_security.py`: Tests ZIP bomb detection, path traversal (`../../etc/passwd`), oversized files, disallowed file extensions, and max file count enforcement.
- `test_notebook_parser.py`: Tests Colab URL regex & Drive ID extraction, multi-cell `.ipynb` parsing, preserving cell order, and separating Markdown vs Code cells.
- `test_test_engine.py`: Tests `exact`, `normalized`, `numeric_tolerance`, `json`, and `function` comparators plus timeout handling.
- `test_rubric_engine.py`: Tests criterion scoring, partial credit, bounds clamping (`0 <= score <= max_score`), and validation that sum of criteria <= assignment max score.
- `test_security_encryption.py`: Tests Fernet encryption/decryption of Google OAuth tokens and verifies plaintext tokens are never exposed.

## 2. Integration Tests (`backend/tests/test_api_integration.py`)
- Tests FastAPI endpoints with authenticated workspace context, RBAC enforcement, cross-workspace isolation (403 on foreign workspace resource), assignment creation, mixed submission validation, and grading history immutability.

## 3. Sandbox Security Verification
- Verifies student code cannot:
  - Reach external internet (`socket` / `urllib` blocked by `--network=none`).
  - Read host filesystem or backend environment variables (`os.environ` contains no secrets).
  - Exceed memory limit, CPU limit, PID limit (fork bomb), or wall-clock timeout (infinite loop).
  - Persist files after execution (container removed + ephemeral `tmpfs`).

## 4. Frontend Verification
- TypeScript strict type-checking (`tsc --noEmit`)
- Production Next.js build (`npm run build`)
- Responsive layout verification (Desktop, Tablet, Mobile)
