"""Excel (.xlsx) Report Exporter using openpyxl."""

from __future__ import annotations

import io
from typing import Any, Dict, List

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill


def build_excel_report(
    report_title: str,
    headers: List[str],
    rows: List[List[Any]],
    rubric_breakdown_rows: List[List[Any]] | None = None,
) -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.title = "Score Summary"

    header_fill = PatternFill(start_color="7C5CFC", end_color="7C5CFC", fill_type="solid")
    header_font = Font(color="FFFFFF", bold=True, size=11)
    title_font = Font(color="1F1B2E", bold=True, size=14)

    ws.append([report_title])
    ws["A1"].font = title_font
    ws.append([])

    ws.append(headers)
    header_row_idx = 3
    for col_idx in range(1, len(headers) + 1):
        cell = ws.cell(row=header_row_idx, column=col_idx)
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = Alignment(horizontal="center", vertical="center")

    for row in rows:
        ws.append(row)

    # Auto-fit column widths
    for col in ws.columns:
        max_len = max((len(str(c.value or "")) for c in col), default=10)
        ws.column_dimensions[col[0].column_letter].width = min(max(max_len + 4, 12), 45)

    if rubric_breakdown_rows is not None:
        ws2 = wb.create_sheet(title="Rubric Breakdown")
        rb_headers = ["Student", "Assignment", "Criterion", "Method", "Awarded", "Max", "Status", "Reason"]
        ws2.append(rb_headers)
        for col_idx in range(1, len(rb_headers) + 1):
            c = ws2.cell(row=1, column=col_idx)
            c.fill = header_fill
            c.font = header_font
        for r in rubric_breakdown_rows:
            ws2.append(r)
        for col in ws2.columns:
            max_len = max((len(str(c.value or "")) for c in col), default=10)
            ws2.column_dimensions[col[0].column_letter].width = min(max(max_len + 4, 12), 45)

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return buf.read()
