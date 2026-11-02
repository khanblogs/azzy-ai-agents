"""pptx.build / xlsx.model / pdf.export: real files into ARTIFACTS_DIR (works in DEMO too)."""

from __future__ import annotations

import asyncio
import json
import re
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from azzy.tools.base import ToolContext, ToolError, ToolSpec, schema, str_prop

_SLUG = re.compile(r"[^a-z0-9]+")


def _artifact_path(ctx: ToolContext, title: str, ext: str) -> Path:
    directory = Path(getattr(ctx.settings, "ARTIFACTS_DIR", "/data/artifacts"))
    directory.mkdir(parents=True, exist_ok=True)
    slug = _SLUG.sub("-", title.lower()).strip("-")[:48] or "artifact"
    stamp = datetime.now(UTC).strftime("%Y%m%d-%H%M%S")
    return directory / f"{stamp}-{ctx.agent_id}-{slug}.{ext}"


def _result(path: Path, **extra: Any) -> str:
    return json.dumps({"artifact": str(path), "filename": path.name, "bytes": path.stat().st_size, **extra}, indent=2)


async def _record(ctx: ToolContext, kind: str, result_json: str) -> str:
    """Register the produced file in the artifacts table (reports page). Best effort."""
    try:
        from azzy.db.engine import session_scope  # noqa: PLC0415
        from azzy.db.repo import add_artifact  # noqa: PLC0415

        data = json.loads(result_json)
        async with session_scope() as session:
            row = await add_artifact(session, agent=ctx.agent_id, task_id=ctx.task_id, kind=kind, filename=data["filename"], path=data["artifact"], size=int(data["bytes"]))
        data["artifact_id"] = row.id
        data["download"] = f"/api/reports/{row.id}/download"
        return json.dumps(data, indent=2)
    except Exception:  # noqa: BLE001 - the file exists either way
        return result_json


def _slides(args: dict[str, Any]) -> list[tuple[str, list[str]]]:
    slides: list[tuple[str, list[str]]] = []
    for item in args.get("slides") or []:
        if isinstance(item, str):
            slides.append((item, [f"{item}: summary and key figures", "Source: AZZY AI AGENTS weekly data"]))
        elif isinstance(item, dict):
            bullets = item.get("bullets") or item.get("points") or []
            slides.append((str(item.get("title", "Slide")), [str(b) for b in bullets]))
    return slides or [("Overview", ["Highlights", "Next steps"])]


def _build_pptx(ctx: ToolContext, args: dict[str, Any]) -> str:
    from pptx import Presentation  # noqa: PLC0415
    from pptx.dml.color import RGBColor  # noqa: PLC0415
    from pptx.util import Inches, Pt  # noqa: PLC0415

    title = str(args.get("title") or "AZZY AI AGENTS update")
    subtitle = str(args.get("subtitle") or f"Prepared by {ctx.agent_id.title()} · AZZY AI AGENTS · {datetime.now(UTC):%d %b %Y}")
    prs = Presentation()
    prs.slide_width, prs.slide_height = Inches(13.333), Inches(7.5)
    cover = prs.slides.add_slide(prs.slide_layouts[6])
    bg = cover.background.fill
    bg.solid()
    bg.fore_color.rgb = RGBColor(0x0F, 0x17, 0x2A)
    box = cover.shapes.add_textbox(Inches(0.8), Inches(2.6), Inches(11.5), Inches(1.5)).text_frame
    box.text = title
    box.paragraphs[0].runs[0].font.size = Pt(44)
    box.paragraphs[0].runs[0].font.bold = True
    box.paragraphs[0].runs[0].font.color.rgb = RGBColor(0xFB, 0xBF, 0x24)
    para = box.add_paragraph()
    para.text = subtitle
    para.runs[0].font.size = Pt(20)
    para.runs[0].font.color.rgb = RGBColor(0xE2, 0xE8, 0xF0)
    for heading, bullets in _slides(args):
        slide = prs.slides.add_slide(prs.slide_layouts[6])
        head = slide.shapes.add_textbox(Inches(0.8), Inches(0.5), Inches(11.5), Inches(1.0)).text_frame
        head.text = heading
        head.paragraphs[0].runs[0].font.size = Pt(32)
        head.paragraphs[0].runs[0].font.bold = True
        head.paragraphs[0].runs[0].font.color.rgb = RGBColor(0x0F, 0x17, 0x2A)
        body = slide.shapes.add_textbox(Inches(0.9), Inches(1.7), Inches(11.3), Inches(5.0)).text_frame
        body.word_wrap = True
        for index, bullet in enumerate(bullets):
            paragraph = body.paragraphs[0] if index == 0 else body.add_paragraph()
            paragraph.text = f"• {bullet}"
            paragraph.runs[0].font.size = Pt(20)
    path = _artifact_path(ctx, title, "pptx")
    prs.save(str(path))
    return _result(path, slides=len(prs.slides), title=title)


def _build_xlsx(ctx: ToolContext, args: dict[str, Any]) -> str:
    from openpyxl import Workbook  # noqa: PLC0415
    from openpyxl.styles import Font, PatternFill  # noqa: PLC0415

    title = str(args.get("title") or "Budget model")
    tables = args.get("tables") or []
    if tables:
        wb = Workbook()
        header_font, header_fill = Font(bold=True, color="FFFFFF"), PatternFill("solid", fgColor="0F172A")
        first = True
        for table in tables:
            ws = wb.active if first else wb.create_sheet()
            first = False
            ws.title = str(table.get("sheet") or table.get("name") or "Sheet")[:31]
            columns = [str(c) for c in (table.get("columns") or [])]
            for col, label in enumerate(columns, start=1):
                cell = ws.cell(row=1, column=col, value=label)
                cell.font, cell.fill = header_font, header_fill
            rows = table.get("rows") or []
            for r, row in enumerate(rows, start=2):
                values = row if isinstance(row, (list, tuple)) else [row.get(c, "") for c in columns] if isinstance(row, dict) else [row]
                for col, value in enumerate(values, start=1):
                    ws.cell(row=r, column=col, value=value)
            for col, label in enumerate(columns, start=1):
                ws.column_dimensions[ws.cell(row=1, column=col).column_letter].width = max(14, min(46, len(label) + 8))
        path = _artifact_path(ctx, title, "xlsx")
        wb.save(str(path))
        return _result(path, sheets=wb.sheetnames, tables=len(tables), title=title)
    months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    lines: list[dict[str, Any]] = list(args.get("lines") or [])
    if not lines:
        lines = [
            {"name": "Compute (ECS/EC2)", "monthly": 420.0, "growth": 0.02},
            {"name": "Database (RDS)", "monthly": 180.0, "growth": 0.01},
            {"name": "Storage & transfer", "monthly": 65.0, "growth": 0.03},
            {"name": "Observability", "monthly": 40.0, "growth": 0.0},
            {"name": "AI gateway (LLM)", "monthly": 250.0, "growth": 0.05},
        ]
    wb = Workbook()
    assumptions = wb.active
    assumptions.title = "Assumptions"
    header_font, header_fill = Font(bold=True, color="FFFFFF"), PatternFill("solid", fgColor="0F172A")
    for col, label in enumerate(["Line item", "Monthly base (USD)", "Monthly growth"], start=1):
        cell = assumptions.cell(row=1, column=col, value=label)
        cell.font, cell.fill = header_font, header_fill
    for row, line in enumerate(lines, start=2):
        assumptions.cell(row=row, column=1, value=str(line.get("name", f"Line {row - 1}")))
        assumptions.cell(row=row, column=2, value=float(line.get("monthly", 0.0)))
        assumptions.cell(row=row, column=3, value=float(line.get("growth", 0.0))).number_format = "0.0%"
    assumptions.column_dimensions["A"].width = 28
    assumptions.column_dimensions["B"].width = 20
    assumptions.column_dimensions["C"].width = 16

    budget = wb.create_sheet("Budget")
    budget.cell(row=1, column=1, value="Line item").font = Font(bold=True)
    for col, month in enumerate(months, start=2):
        budget.cell(row=1, column=col, value=month).font = Font(bold=True)
    budget.cell(row=1, column=14, value="Total").font = Font(bold=True)
    last_row = len(lines) + 1
    for row in range(2, last_row + 1):
        budget.cell(row=row, column=1, value=f"=Assumptions!A{row}")
        for col in range(2, 14):
            month_index = col - 2
            budget.cell(row=row, column=col, value=f"=Assumptions!$B{row}*(1+Assumptions!$C{row})^{month_index}").number_format = "#,##0.00"
        budget.cell(row=row, column=14, value=f"=SUM(B{row}:M{row})").number_format = "#,##0.00"
    total_row = last_row + 1
    budget.cell(row=total_row, column=1, value="Total").font = Font(bold=True)
    for col in range(2, 15):
        letter = budget.cell(row=1, column=col).column_letter
        budget.cell(row=total_row, column=col, value=f"=SUM({letter}2:{letter}{last_row})").number_format = "#,##0.00"
    budget.column_dimensions["A"].width = 28

    summary = wb.create_sheet("Summary")
    summary["A1"], summary["B1"] = "Annual total (USD)", f"=Budget!N{total_row}"
    summary["A2"], summary["B2"] = "Average month (USD)", f"=Budget!N{total_row}/12"
    summary["A3"], summary["B3"] = "Largest line", f'=INDEX(Assumptions!A2:A{last_row},MATCH(MAX(Budget!N2:N{last_row}),Budget!N2:N{last_row},0))'
    summary["A4"], summary["B4"] = "Over budget?", f'=IF(Budget!N{total_row}>{float(args.get("cap", 15000.0))},"YES","no")'
    summary["A5"], summary["B5"] = "Source", "Assumptions sheet (editable) → Budget formulas"
    summary.column_dimensions["A"].width = 24
    summary.column_dimensions["B"].width = 40
    for cell in ("B1", "B2"):
        summary[cell].number_format = "#,##0.00"
    for extra in args.get("sheets") or []:
        if str(extra) not in wb.sheetnames:
            wb.create_sheet(str(extra)[:31])
    path = _artifact_path(ctx, title, "xlsx")
    wb.save(str(path))
    return _result(path, sheets=wb.sheetnames, lines=len(lines), formulas=True, title=title)


def _build_pdf(ctx: ToolContext, args: dict[str, Any]) -> str:
    from reportlab.lib.pagesizes import A4  # noqa: PLC0415
    from reportlab.lib.styles import getSampleStyleSheet  # noqa: PLC0415
    from reportlab.lib.units import cm  # noqa: PLC0415
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer  # noqa: PLC0415

    title = str(args.get("title") or "AZZY AI AGENTS report")
    sections = args.get("sections") or []
    if not sections:
        raise ValueError("pdf.export refused: pass sections as [{title, body}] with the real report text for every section - headings alone are not a report.")
    styles = getSampleStyleSheet()
    story: list[Any] = [Paragraph(title, styles["Title"]), Paragraph(f"Prepared by {ctx.agent_id.title()} · {datetime.now(UTC):%d %b %Y}", styles["Normal"]), Spacer(1, 0.6 * cm)]
    for section in sections:
        if isinstance(section, dict):
            heading, body = str(section.get("title", "Section")), str(section.get("body", ""))
        else:
            heading, body = str(section), str(args.get("body", {}).get(str(section), "")) if isinstance(args.get("body"), dict) else ""
        if not body.strip():
            raise ValueError(f"pdf.export refused: section '{heading}' has no body. Write the real content (facts, figures, findings from your research) into each section's body - placeholder or invented filler text is never acceptable.")
        story.append(Paragraph(heading, styles["Heading2"]))
        story.append(Paragraph(body, styles["BodyText"]))
        story.append(Spacer(1, 0.4 * cm))
    path = _artifact_path(ctx, title, "pdf")
    SimpleDocTemplate(str(path), pagesize=A4, title=title, author="AZZY AI AGENTS").build(story)
    return _result(path, sections=len(sections), title=title)


async def pptx_build(ctx: ToolContext, args: dict[str, Any]) -> str:
    try:
        return await _record(ctx, "pptx", await asyncio.to_thread(_build_pptx, ctx, args))
    except ImportError as exc:
        raise ToolError("python-pptx not installed") from exc


async def xlsx_model(ctx: ToolContext, args: dict[str, Any]) -> str:
    try:
        return await _record(ctx, "xlsx", await asyncio.to_thread(_build_xlsx, ctx, args))
    except ImportError as exc:
        raise ToolError("openpyxl not installed") from exc


async def pdf_export(ctx: ToolContext, args: dict[str, Any]) -> str:
    try:
        return await _record(ctx, "pdf", await asyncio.to_thread(_build_pdf, ctx, args))
    except ImportError as exc:
        raise ToolError("reportlab not installed") from exc


SPECS: list[ToolSpec] = [
    ToolSpec("pptx.build", "Build a PowerPoint deck into the artifacts folder.", "low",
             schema({"title": str_prop("Deck title"), "subtitle": str_prop("Cover subtitle"), "slides": {"type": "array", "description": "slide titles or {title, bullets[]}"}}, ["title"]), pptx_build, demo_passthrough=True),
    ToolSpec("xlsx.model", "Build an Excel model (Assumptions → Budget formulas → Summary) into the artifacts folder.", "low",
             schema({"title": str_prop("Workbook title"), "lines": {"type": "array", "description": "[{name, monthly, growth}]"}, "sheets": {"type": "array", "description": "extra EMPTY sheet names (legacy model mode only)"}, "tables": {"type": "array", "description": "data mode: [{sheet, columns[], rows[[...]] or rows[{col: value}]}] - builds a workbook with ONLY these sheets and the real data rows"}}, ["title"]), xlsx_model, demo_passthrough=True),
    ToolSpec("pdf.export", "Export a PDF report into the artifacts folder.", "low",
             schema({"title": str_prop("Report title"), "sections": {"type": "array", "description": "REQUIRED: [{title, body}] - every section must carry its full real report text in body; headings alone are refused"}}, ["title"]), pdf_export, demo_passthrough=True),
]
