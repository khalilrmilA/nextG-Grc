"""Risk Cartography — CISO-owned, independently-configured risk maps."""
import asyncio
from datetime import datetime, timezone
from io import BytesIO

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable,
)
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT

from app.core.database import get_db
from app.api.v1.dependencies.auth import get_current_user, get_tenant_id, require_roles
from app.models.user import User, UserRole
from app.models.risk import Risk
from app.models.risk_cartography import RiskCartography
from app.models.tenant import Tenant
from app.services import pdf_arabic
from app.services.ai_locale import get_request_language

router = APIRouter()

# ── Default definition used when creating a new cartography ──────────────────
DEFAULT_DEFINITION = {
    "grid_rows": 5,
    "grid_cols": 5,
    "likelihood_labels": ["Rare", "Unlikely", "Possible", "Likely", "Almost Certain"],
    "impact_labels": ["Negligible", "Minor", "Moderate", "Major", "Catastrophic"],
    "risk_levels": [
        {"name": "Low",      "color": "#22c55e", "min_score": 1,  "max_score": 5},
        {"name": "Medium",   "color": "#eab308", "min_score": 6,  "max_score": 12},
        {"name": "High",     "color": "#f97316", "min_score": 13, "max_score": 18},
        {"name": "Critical", "color": "#ef4444", "min_score": 19, "max_score": 25},
    ],
}

# ── Pydantic schemas ──────────────────────────────────────────────────────────

class RiskLevelSchema(BaseModel):
    name: str
    color: str
    min_score: int
    max_score: int

class CartographyDefinitionSchema(BaseModel):
    grid_rows: int = 5
    grid_cols: int = 5
    likelihood_labels: list[str]
    impact_labels: list[str]
    risk_levels: list[RiskLevelSchema]

class CartographyCreate(BaseModel):
    name: str
    description: str | None = None
    is_default: bool = False
    definition: dict | None = None   # uses DEFAULT_DEFINITION if omitted

class CartographyUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    is_default: bool | None = None
    definition: dict | None = None

class PositionOverride(BaseModel):
    likelihood: int
    impact: int

class CartographyListItem(BaseModel):
    id: str
    name: str
    description: str | None
    is_default: bool
    definition: dict
    grid_rows: int
    grid_cols: int
    risk_count: int
    created_at: datetime
    updated_at: datetime
    model_config = {"from_attributes": True}

class CartographyRiskOut(BaseModel):
    id: str
    title: str
    severity: str | None
    native_likelihood: float | None
    native_impact: float | None
    effective_likelihood: float
    effective_impact: float
    is_overridden: bool

class CartographyDetailOut(BaseModel):
    id: str
    name: str
    description: str | None
    is_default: bool
    definition: dict
    risk_positions: dict
    risks: list[CartographyRiskOut]
    created_at: datetime
    updated_at: datetime
    model_config = {"from_attributes": True}


# ── Helpers ───────────────────────────────────────────────────────────────────

def _zone_color(score: float, risk_levels: list[dict]) -> str:
    """Return the hex color for a given score from the cartography's risk levels."""
    for lvl in sorted(risk_levels, key=lambda x: x["min_score"]):
        if lvl["min_score"] <= score <= lvl["max_score"]:
            return lvl["color"]
    return "#f3f4f6"


def _in_scope(risk: Risk, definition: dict | None) -> bool:
    """Whether a risk falls inside a cartography's scope filter.

    Shared by the detail view and the list's per-card count, so the two cannot
    disagree about which risks a cartography actually contains.
    """
    scope = (definition or {}).get("scope", {}) or {}
    scope_type = scope.get("type", "all")
    value = (scope.get("value") or "").strip().lower()
    if not value:
        return True
    if scope_type == "control":
        return any(str(c).lower() == value for c in (risk.linked_controls or []))
    if scope_type == "category":
        return (risk.risk_category or "").lower() == value
    if scope_type == "tag":
        return any(str(tag).lower() == value for tag in (risk.tags or []))
    return True


async def _resolve_risks(
    cartography: RiskCartography,
    db: AsyncSession,
    tenant_id: str,
) -> list[CartographyRiskOut]:
    """Fetch risks for the tenant, apply scope filter, then apply position overrides."""
    result = await db.execute(
        select(Risk).where(
            Risk.tenant_id == tenant_id,
            Risk.likelihood.is_not(None),
            Risk.impact.is_not(None),
        )
    )
    all_risks = result.scalars().all()
    risks = [r for r in all_risks if _in_scope(r, cartography.definition)]

    overrides: dict = cartography.risk_positions or {}
    out = []
    for r in risks:
        override = overrides.get(r.id)
        if override:
            eff_l = float(override["likelihood"])
            eff_i = float(override["impact"])
            is_overridden = True
        else:
            eff_l = float(r.likelihood)  # type: ignore[arg-type]
            eff_i = float(r.impact)       # type: ignore[arg-type]
            is_overridden = False
        out.append(CartographyRiskOut(
            id=r.id,
            title=r.title,
            severity=r.severity.value if r.severity else None,
            native_likelihood=r.likelihood,
            native_impact=r.impact,
            effective_likelihood=eff_l,
            effective_impact=eff_i,
            is_overridden=is_overridden,
        ))
    return out


# ── LIST ──────────────────────────────────────────────────────────────────────

@router.get("", response_model=list[CartographyListItem])
async def list_cartographies(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
):
    rows = (await db.execute(
        select(RiskCartography)
        .where(RiskCartography.tenant_id == tenant_id)
        .order_by(RiskCartography.created_at.desc())
    )).scalars().all()

    # Risks with coordinates, fetched once; each card then counts what its own
    # scope keeps. The count used to ignore the scope filter entirely, so a
    # cartography scoped to one category or tag advertised the whole register on
    # the list and a different number the moment it was opened.
    plottable = list((await db.execute(
        select(Risk).where(
            Risk.tenant_id == tenant_id,
            Risk.likelihood.is_not(None),
            Risk.impact.is_not(None),
        )
    )).scalars().all())

    items = []
    for c in rows:
        defn = c.definition or {}
        items.append(CartographyListItem(
            id=c.id,
            name=c.name,
            description=c.description,
            is_default=c.is_default,
            definition=defn,
            grid_rows=defn.get("grid_rows", 5),
            grid_cols=defn.get("grid_cols", 5),
            risk_count=sum(1 for r in plottable if _in_scope(r, defn)),
            created_at=c.created_at,
            updated_at=c.updated_at,
        ))
    return items


# ── CREATE ────────────────────────────────────────────────────────────────────

@router.post("", response_model=CartographyDetailOut, status_code=201)
async def create_cartography(
    body: CartographyCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.RISK_MANAGER, UserRole.CISO)),
    tenant_id: str = Depends(get_tenant_id),
):
    defn = body.definition if body.definition else DEFAULT_DEFINITION

    # Validate grid dimensions match label counts
    rows = defn.get("grid_rows", 5)
    cols = defn.get("grid_cols", 5)
    ll = defn.get("likelihood_labels", [])
    il = defn.get("impact_labels", [])
    if len(ll) != rows or len(il) != cols:
        raise HTTPException(400, "Label counts must match grid dimensions")

    c = RiskCartography(
        tenant_id=tenant_id,
        created_by=current_user.id,
        name=body.name,
        description=body.description,
        is_default=body.is_default,
        definition=defn,
        risk_positions={},
    )
    db.add(c)
    await db.flush()
    await db.commit()
    await db.refresh(c)
    risks = await _resolve_risks(c, db, tenant_id)
    return CartographyDetailOut(
        id=c.id, name=c.name, description=c.description,
        is_default=c.is_default, definition=c.definition,
        risk_positions=c.risk_positions, risks=risks,
        created_at=c.created_at, updated_at=c.updated_at,
    )


# ── GET DETAIL ────────────────────────────────────────────────────────────────

@router.get("/{cid}", response_model=CartographyDetailOut)
async def get_cartography(
    cid: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
):
    c = (await db.execute(
        select(RiskCartography).where(
            RiskCartography.id == cid,
            RiskCartography.tenant_id == tenant_id,
        )
    )).scalar_one_or_none()
    if not c:
        raise HTTPException(404, "Cartography not found")
    risks = await _resolve_risks(c, db, tenant_id)
    return CartographyDetailOut(
        id=c.id, name=c.name, description=c.description,
        is_default=c.is_default, definition=c.definition,
        risk_positions=c.risk_positions, risks=risks,
        created_at=c.created_at, updated_at=c.updated_at,
    )


# ── UPDATE ────────────────────────────────────────────────────────────────────

@router.put("/{cid}", response_model=CartographyDetailOut)
async def update_cartography(
    cid: str,
    body: CartographyUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles(UserRole.RISK_MANAGER, UserRole.CISO)),
    tenant_id: str = Depends(get_tenant_id),
):
    c = (await db.execute(
        select(RiskCartography).where(
            RiskCartography.id == cid,
            RiskCartography.tenant_id == tenant_id,
        )
    )).scalar_one_or_none()
    if not c:
        raise HTTPException(404, "Cartography not found")

    if body.name is not None:
        c.name = body.name
    if body.description is not None:
        c.description = body.description
    if body.is_default is not None:
        c.is_default = body.is_default
    if body.definition is not None:
        defn = body.definition
        rows = defn.get("grid_rows", 5)
        cols = defn.get("grid_cols", 5)
        if len(defn.get("likelihood_labels", [])) != rows:
            raise HTTPException(400, "Likelihood label count must match grid_rows")
        if len(defn.get("impact_labels", [])) != cols:
            raise HTTPException(400, "Impact label count must match grid_cols")
        c.definition = defn

    await db.commit()
    await db.refresh(c)
    risks = await _resolve_risks(c, db, tenant_id)
    return CartographyDetailOut(
        id=c.id, name=c.name, description=c.description,
        is_default=c.is_default, definition=c.definition,
        risk_positions=c.risk_positions, risks=risks,
        created_at=c.created_at, updated_at=c.updated_at,
    )


# ── DELETE ────────────────────────────────────────────────────────────────────

@router.delete("/{cid}", status_code=204)
async def delete_cartography(
    cid: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles(UserRole.RISK_MANAGER, UserRole.CISO)),
    tenant_id: str = Depends(get_tenant_id),
):
    c = (await db.execute(
        select(RiskCartography).where(
            RiskCartography.id == cid,
            RiskCartography.tenant_id == tenant_id,
        )
    )).scalar_one_or_none()
    if not c:
        raise HTTPException(404, "Cartography not found")
    await db.delete(c)
    await db.commit()


# ── UPDATE RISK POSITIONS ─────────────────────────────────────────────────────

@router.put("/{cid}/risk-positions", response_model=CartographyDetailOut)
async def update_risk_positions(
    cid: str,
    positions: dict[str, PositionOverride | None],
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles(UserRole.RISK_MANAGER, UserRole.CISO)),
    tenant_id: str = Depends(get_tenant_id),
):
    """Bulk-update manual risk position overrides.
    Pass null for a risk_id to reset it to its native register position.
    """
    c = (await db.execute(
        select(RiskCartography).where(
            RiskCartography.id == cid,
            RiskCartography.tenant_id == tenant_id,
        )
    )).scalar_one_or_none()
    if not c:
        raise HTTPException(404, "Cartography not found")

    current: dict = dict(c.risk_positions or {})
    for risk_id, override in positions.items():
        if override is None:
            current.pop(risk_id, None)
        else:
            current[risk_id] = {"likelihood": override.likelihood, "impact": override.impact}
    c.risk_positions = current

    await db.commit()
    await db.refresh(c)
    risks = await _resolve_risks(c, db, tenant_id)
    return CartographyDetailOut(
        id=c.id, name=c.name, description=c.description,
        is_default=c.is_default, definition=c.definition,
        risk_positions=c.risk_positions, risks=risks,
        created_at=c.created_at, updated_at=c.updated_at,
    )


# ── PDF EXPORT ────────────────────────────────────────────────────────────────

def _hex_to_rl(hex_color: str):
    """Convert #rrggbb to a ReportLab color."""
    h = hex_color.lstrip("#")
    r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
    return colors.Color(r / 255, g / 255, b / 255)


# ── PDF wording (en/fr/ar) ────────────────────────────────────────────────────
# The export used to be English whatever the UI language. The cartography's own
# name/description and risk titles are tenant data and stay as written; the
# default scale and zone names below are the platform's (DEFAULT_DEFINITION) and
# are translated when a definition still uses them.
_PDF_TEXT = {
    "en": {"exported": "Exported {date}", "grid": "{rows}×{cols} grid", "zones": "Risk Zones",
           "zone": "Zone", "range": "Score Range", "color": "Color", "register": "Risk Register",
           "title": "Title", "likelihood": "Likelihood", "impact": "Impact", "score": "Score",
           "severity": "Severity", "overridden": "Overridden", "map": "Risk Map",
           "more": "+{n} more"},
    "fr": {"exported": "Exporté le {date}", "grid": "grille {rows}×{cols}", "zones": "Zones de risque",
           "zone": "Zone", "range": "Plage de score", "color": "Couleur", "register": "Registre des risques",
           "title": "Intitulé", "likelihood": "Vraisemblance", "impact": "Impact", "score": "Score",
           "severity": "Gravité", "overridden": "Ajusté", "map": "Cartographie des risques",
           "more": "+{n} autre(s)"},
    "ar": {"exported": "تاريخ التصدير {date}", "grid": "شبكة {rows}×{cols}", "zones": "مناطق المخاطر",
           "zone": "المنطقة", "range": "نطاق الدرجة", "color": "اللون", "register": "سجل المخاطر",
           "title": "العنوان", "likelihood": "الاحتمالية", "impact": "الأثر", "score": "الدرجة",
           "severity": "الخطورة", "overridden": "معدَّل", "map": "خريطة المخاطر",
           "more": "+{n} أخرى"},
}
_SCALE_WORDS = {
    "rare": {"fr": "Rare", "ar": "نادر"},
    "unlikely": {"fr": "Peu probable", "ar": "غير مرجح"},
    "possible": {"fr": "Possible", "ar": "ممكن"},
    "likely": {"fr": "Probable", "ar": "مرجح"},
    "almost certain": {"fr": "Quasi certain", "ar": "شبه مؤكد"},
    "negligible": {"fr": "Négligeable", "ar": "ضئيل"},
    "minor": {"fr": "Mineur", "ar": "طفيف"},
    "moderate": {"fr": "Modéré", "ar": "متوسط"},
    "major": {"fr": "Majeur", "ar": "كبير"},
    "catastrophic": {"fr": "Catastrophique", "ar": "كارثي"},
    "very low": {"fr": "Très faible", "ar": "منخفض جداً"},
    "low": {"fr": "Faible", "ar": "منخفض"},
    "medium": {"fr": "Moyen", "ar": "متوسط"},
    "high": {"fr": "Élevé", "ar": "مرتفع"},
    "very high": {"fr": "Très élevé", "ar": "مرتفع جداً"},
    "critical": {"fr": "Critique", "ar": "حرج"},
}


def _pdf_t(lang: str, key: str, **fmt) -> str:
    return (_PDF_TEXT.get(lang) or _PDF_TEXT["en"])[key].format(**fmt)


def _scale_word(lang: str, value) -> str:
    raw = str(value or "")
    if lang == "en":
        return raw
    entry = _SCALE_WORDS.get(raw.strip().lower().replace("_", " "))
    return (entry or {}).get(lang) or raw


def _build_cartography_pdf(
    cartography: RiskCartography,
    risks: list[CartographyRiskOut],
    tenant_name: str,
    lang: str = "en",
) -> BytesIO:
    from app.services.report_generator import _fmt_date
    lang = lang if lang in _PDF_TEXT else "en"
    rtl = lang == "ar"
    M = pdf_arabic.paragraph_markup
    buf = BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=landscape(A4),
        leftMargin=0.6 * inch,
        rightMargin=0.6 * inch,
        topMargin=0.5 * inch,
        bottomMargin=0.5 * inch,
    )

    NAVY = colors.HexColor("#1a2332")
    DARK_BLUE = colors.HexColor("#1e3a5f")
    GRAY_700 = colors.HexColor("#374151")
    GRAY_500 = colors.HexColor("#6b7280")
    GRAY_100 = colors.HexColor("#f3f4f6")
    WHITE = colors.white

    st = getSampleStyleSheet()
    align = TA_RIGHT if rtl else TA_LEFT
    st.add(ParagraphStyle("RCH1", fontName="Helvetica-Bold", fontSize=16, textColor=NAVY, spaceAfter=2, leading=20, alignment=align))
    st.add(ParagraphStyle("RCH2", fontName="Helvetica-Bold", fontSize=10, textColor=DARK_BLUE, spaceBefore=12, spaceAfter=4, alignment=align))
    st.add(ParagraphStyle("RCBody", fontName="Helvetica", fontSize=8, textColor=GRAY_700, leading=11, spaceAfter=3, alignment=align))
    st.add(ParagraphStyle("RCSmall", fontName="Helvetica", fontSize=7, textColor=GRAY_500, leading=9, alignment=align))
    st.add(ParagraphStyle("RCCell", fontName="Helvetica", fontSize=6.5, textColor=GRAY_700, leading=8, alignment=TA_CENTER))

    defn = cartography.definition or DEFAULT_DEFINITION
    rows = defn.get("grid_rows", 5)
    cols = defn.get("grid_cols", 5)
    ll_labels = defn.get("likelihood_labels", [str(i) for i in range(1, rows + 1)])
    il_labels = defn.get("impact_labels", [str(i) for i in range(1, cols + 1)])
    risk_levels: list[dict] = defn.get("risk_levels", DEFAULT_DEFINITION["risk_levels"])

    story = []

    # ── Title block
    now = _fmt_date(datetime.now(timezone.utc), lang)
    story.append(Paragraph(pdf_arabic.paragraph_markup(cartography.name, bold=True), st["RCH1"]))
    if cartography.description:
        story.append(Paragraph(pdf_arabic.paragraph_markup(cartography.description), st["RCBody"]))
    story.append(Paragraph(M(f"{tenant_name}  ·  {_pdf_t(lang, 'exported', date=now)}  ·  "
                             f"{_pdf_t(lang, 'grid', rows=rows, cols=cols)}"), st["RCSmall"]))
    story.append(HRFlowable(width="100%", thickness=1, color=colors.HexColor("#e5e7eb"), spaceAfter=10))

    # ── Build grid table  (rows+1 rows, cols+2 cols: y-axis label | header row + data rows)
    # We'll build: header row = impact labels, data rows = likelihood rows (high → low)
    usable_w = landscape(A4)[0] - 1.2 * inch
    y_label_w = 0.55 * inch
    cell_w = (usable_w - y_label_w) / (cols + 1)  # +1 for the row label column
    row_h = 0.65 * inch

    # Gather risks per cell: key = (likelihood_1based, impact_1based)
    cell_risks: dict[tuple[int, int], list[str]] = {}
    for risk in risks:
        l_idx = max(1, min(rows, int(round(risk.effective_likelihood))))
        i_idx = max(1, min(cols, int(round(risk.effective_impact))))
        cell_risks.setdefault((l_idx, i_idx), []).append(risk.title)

    # Header row: empty corner + impact labels
    header = [Paragraph("", st["RCCell"])] + [
        Paragraph(M(_scale_word(lang, il_labels[c]) if c < len(il_labels) else str(c + 1)), st["RCCell"])
        for c in range(cols)
    ]
    grid_data = [header]

    # Data rows: likelihood high → low
    style_cmds = [
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#d1d5db")),
        ("FONTNAME", (0, 0), (-1, -1), "Helvetica"),
        ("FONTSIZE", (0, 0), (-1, -1), 7),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        # Header row background
        ("BACKGROUND", (0, 0), (-1, 0), GRAY_100),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
    ]

    for row_i in range(rows, 0, -1):  # rows → 1 (high likelihood at top)
        row_label = Paragraph(
            M(_scale_word(lang, ll_labels[row_i - 1]) if (row_i - 1) < len(ll_labels) else str(row_i)),
            st["RCCell"]
        )
        row_data = [row_label]
        for col_j in range(1, cols + 1):
            score = row_i * col_j
            bg_hex = _zone_color(score, risk_levels)
            bg_rl = _hex_to_rl(bg_hex)
            titles = cell_risks.get((row_i, col_j), [])
            lines = [M(t[:25] + "…" if len(t) > 25 else t) for t in titles[:3]]
            if len(titles) > 3:
                lines.append(M(_pdf_t(lang, "more", n=len(titles) - 3)))
            cell_p = Paragraph("<br/>".join(lines) or " ", st["RCCell"])
            row_data.append(cell_p)

            # Color this cell
            table_row = len(grid_data)
            style_cmds.append(("BACKGROUND", (col_j, table_row), (col_j, table_row), bg_rl))

        grid_data.append(row_data)

    col_widths = [y_label_w] + [cell_w] * cols
    row_heights = [0.25 * inch] + [row_h] * rows
    grid_table = Table(grid_data, colWidths=col_widths, rowHeights=row_heights)
    grid_table.setStyle(TableStyle(style_cmds))

    # ── Legend
    legend_head = [
        Paragraph(M(_pdf_t(lang, "zone"), bold=True), st["RCBody"]),
        Paragraph(M(_pdf_t(lang, "range"), bold=True), st["RCBody"]),
        Paragraph(M(_pdf_t(lang, "color"), bold=True), st["RCBody"]),
    ]
    legend_data = [legend_head]
    legend_styles = [
        ("BACKGROUND", (0, 0), (-1, 0), GRAY_100),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#e5e7eb")),
        ("FONTSIZE", (0, 0), (-1, -1), 8),
        ("ALIGN", (0, 0), (-1, -1), "LEFT"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ]
    for idx, lvl in enumerate(risk_levels):
        legend_data.append([
            Paragraph(M(_scale_word(lang, lvl["name"])), st["RCBody"]),
            Paragraph(f"{lvl['min_score']} – {lvl['max_score']}", st["RCBody"]),
            Paragraph(" ", st["RCBody"]),
        ])
        swatch_col = 0 if rtl else 2
        legend_styles.append((
            "BACKGROUND", (swatch_col, idx + 1), (swatch_col, idx + 1), _hex_to_rl(lvl["color"])
        ))
    legend_widths = [1.4 * inch, 1.2 * inch, 0.5 * inch]
    if rtl:
        # Arabic reads right-to-left: the first column goes on the right.
        legend_data = [list(reversed(r)) for r in legend_data]
        legend_widths = list(reversed(legend_widths))
    legend_table = Table(
        legend_data,
        colWidths=legend_widths,
    )
    legend_table.setStyle(TableStyle(legend_styles))

    # ── Risk list
    risk_list_data = [[
        Paragraph(M(_pdf_t(lang, key), bold=True), st["RCBody"])
        for key in ("title", "likelihood", "impact", "score", "severity", "overridden")
    ]]
    risk_list_styles = [
        ("BACKGROUND", (0, 0), (-1, 0), GRAY_100),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#e5e7eb")),
        ("FONTSIZE", (0, 0), (-1, -1), 7.5),
        ("ALIGN", (0, 0), (-1, -1), "LEFT"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [WHITE, GRAY_100]),
    ]
    sorted_risks = sorted(risks, key=lambda r: r.effective_likelihood * r.effective_impact, reverse=True)
    for r in sorted_risks:
        score = r.effective_likelihood * r.effective_impact
        risk_list_data.append([
            Paragraph(M(r.title[:60] + ("…" if len(r.title) > 60 else "")), st["RCBody"]),
            Paragraph(str(int(r.effective_likelihood)), st["RCBody"]),
            Paragraph(str(int(r.effective_impact)), st["RCBody"]),
            Paragraph(f"{score:.0f}", st["RCBody"]),
            Paragraph(M(_scale_word(lang, r.severity) if r.severity else "—"), st["RCBody"]),
            Paragraph("✏" if r.is_overridden else "—", st["RCBody"]),
        ])
    risk_widths = [None, 0.7 * inch, 0.7 * inch, 0.5 * inch, 0.7 * inch, 0.6 * inch]
    if rtl:
        risk_list_data = [list(reversed(r)) for r in risk_list_data]
        risk_widths = list(reversed(risk_widths))
    risk_list_table = Table(
        risk_list_data,
        colWidths=risk_widths,
    )
    risk_list_table.setStyle(TableStyle(risk_list_styles))

    # Side-by-side: grid left, legend+risk list right
    story.append(Paragraph(M(_pdf_t(lang, "map"), bold=True), st["RCH2"]))
    story.append(grid_table)
    story.append(Spacer(1, 12))

    # Section headings for the two side-by-side tables (they used to be appended
    # to the story before the map, so they printed above it, detached from
    # their tables).
    legend_block = [Paragraph(M(_pdf_t(lang, "zones"), bold=True), st["RCH2"]), legend_table]
    register_block = [Paragraph(M(_pdf_t(lang, "register"), bold=True), st["RCH2"]), risk_list_table]
    cells = [legend_block, Spacer(0.3 * inch, 1), register_block]
    if rtl:
        cells = list(reversed(cells))
    side_by_side = Table([cells])
    side_by_side.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP")]))
    story.append(side_by_side)

    doc.build(story)
    buf.seek(0)
    return buf


@router.get("/{cid}/pdf")
async def export_cartography_pdf(
    cid: str,
    lang: str = Depends(get_request_language),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
):
    c = (await db.execute(
        select(RiskCartography).where(
            RiskCartography.id == cid,
            RiskCartography.tenant_id == tenant_id,
        )
    )).scalar_one_or_none()
    if not c:
        raise HTTPException(404, "Cartography not found")

    tenant = (await db.execute(
        select(Tenant).where(Tenant.id == tenant_id)
    )).scalar_one_or_none()
    tenant_name = tenant.name if tenant else "Organisation"

    risks = await _resolve_risks(c, db, tenant_id)
    # ReportLab is blocking CPU work — building it inline would stall every other
    # request this worker is serving until the document is finished. The three
    # attributes the builder reads off `c` are already loaded, so the thread
    # never touches the session.
    pdf_buf = await asyncio.to_thread(_build_cartography_pdf, c, risks, tenant_name, lang)

    safe_name = "".join(ch if ch.isalnum() or ch in " _-" else "_" for ch in c.name)
    filename = f"cartography_{safe_name}_{datetime.now(timezone.utc).strftime('%Y%m%d')}.pdf"

    return StreamingResponse(
        pdf_buf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
