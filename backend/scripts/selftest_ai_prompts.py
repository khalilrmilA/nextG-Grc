"""Self-test for app.services.ai_prompts (component A of the AI foundation).

Pure Python: no database queries, no network, no pytest. Mirrors the unit-test cases of the
foundation spec (A §7) plus contract checks (interface summary, enum vocabularies against the
real model Enums, template slot lists, preset names, fix-up/consistency behaviour, purity).

Usage (from the repo root or from backend/):
    venv/bin/python backend/scripts/selftest_ai_prompts.py

Prints PASS/FAIL per case and exits non-zero on any failure.
"""
import sys
import traceback
from pathlib import Path
from string import Template

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.services import ai_prompts as P  # noqa: E402


def _raises(fn, exc=P.PromptError):
    try:
        fn()
    except exc as e:
        return e
    raise AssertionError("expected %s" % exc.__name__)


# ---------------------------------------------------------------------------
# Spec A §7 cases (verbatim assertions, pytest.raises → _raises)
# ---------------------------------------------------------------------------

def test_every_task_builds_and_has_no_unfilled_placeholders():
    for task in P.TASKS:
        for lang in ("en", "fr", "ar"):
            s = P.system_prompt(task, lang=lang, extra_context="Organisation: ACME")
            assert "GROUNDING RULES" in s or task in ("assistant_chat", "public_support")
            assert "{today}" not in s and "{tables_rule}" not in s and "{product_facts}" not in s and "{language" not in s
            assert s.rstrip().endswith("Organisation: ACME")
            if P.task_defaults(task)["output"] == "json":
                assert "OUTPUT SCHEMA (JSON object)" in s and "OUTPUT RULES" in s
                assert P.task_defaults(task)["json_mode"] is True
    _raises(lambda: P.system_prompt("no_such_task"))
    _raises(lambda: P.system_prompt("policy_generation", output_format="json"))   # no schema for a Markdown task


def test_enums_match_platform_models():
    from app.models.compliance import ControlStatus
    from app.models.vendor import VendorRiskTier
    from app.models.regulatory_update import UpdateImpact
    from app.models.framework import ControlCategory
    from app.models.risk import RiskSeverity, RiskTreatmentOption
    from app.models.audit import FindingSeverity
    assert set(P.CONTROL_VERDICTS) - {"insufficient_evidence"} <= {c.value for c in ControlStatus}
    assert set(P.VERDICT_TO_CONTROL_STATUS.values()) <= {c.value for c in ControlStatus}
    assert set(P.VENDOR_TIERS) == {v.value for v in VendorRiskTier}
    assert set(P.REGULATORY_IMPACTS) == {u.value for u in UpdateImpact}
    assert set(P.CONTROL_CATEGORIES) == {c.name for c in ControlCategory}
    assert set(P.RISK_SEVERITIES) == {s.value for s in RiskSeverity}
    assert set(P.RISK_TREATMENTS) == {t.value for t in RiskTreatmentOption}
    assert set(P.FINDING_SEVERITIES) == {f.value for f in FindingSeverity}
    # the schema dicts carry the same vocabularies
    v = P.CONTROL_ASSESSMENT_SCHEMA["properties"]["results"]["items"]["properties"]["verdict"]["enum"]
    assert tuple(v) == P.CONTROL_VERDICTS
    assert tuple(P.REGULATORY_IMPACT_SCHEMA["properties"]["items"]["items"]["properties"]["impact"]["enum"]) == P.REGULATORY_IMPACTS
    assert tuple(P.FRAMEWORK_BUILDER_SCHEMA["properties"]["suggestions"]["items"]["properties"]["category"]["enum"]) == P.CONTROL_CATEGORIES


def test_schema_text_lists_enums_verbatim_and_language_does_not_touch_them():
    txt = P.schema_text(P.CONTROL_ASSESSMENT_SCHEMA)
    assert '"verdict": "implemented | partially_implemented | not_implemented | not_applicable | insufficient_evidence"' in txt
    assert '"confidence": <number 0-1>' in txt
    en = P.system_prompt("control_assessment", lang="en"); fr = P.system_prompt("control_assessment", lang="fr")
    assert txt in en and txt in fr and en != fr
    assert "français" in fr.lower() or "LANGUE" in fr


def test_render_user_prompt_missing_slot_and_dollar_safety():
    e = _raises(lambda: P.render_user_prompt("vendor_prescreen", vendor_name="ACME"))
    assert "questionnaire_block" in str(e)
    out = P.render_user_prompt("contract_extract", vendor_name="ACME", file_name="msa.pdf", chunk_index=1, chunk_total=2,
                               regimes="GDPR", contract_block="<<<BEGIN UNTRUSTED CONTRACT>>>\nfees of $5,000 per month\n<<<END UNTRUSTED CONTRACT>>>")
    assert "$5,000" in out and "$contract_block" not in out and "excerpt 1 of 2" in out


def test_control_assessment_consistency_and_fixups():
    data = {"results": [
        {"control_id": "A.5.18", "verdict": "implemented", "confidence": 0.95, "evidence": [], "explanation": "x"},
        {"control_id": "A.8.7", "verdict": "not_applicable", "confidence": 0.9, "evidence": [], "explanation": "x", "not_applicable_justification": None},
    ]}
    issues = P.consistency_issues("control_assessment", data, expected_ids=["A.5.18", "A.8.7", "A.5.1"], mandatory_ids={"A.8.7"})
    joined = "\n".join(issues)
    assert "A.5.1" in joined and "evidence" in joined and "mandatory" in joined
    fixed = P.apply_fixups("control_assessment", data, mandatory_ids={"A.8.7"}, expected_ids=["A.5.18", "A.8.7"])
    r = {x["control_id"]: x for x in fixed["results"]}
    assert r["A.5.18"]["verdict"] == "insufficient_evidence" and r["A.5.18"]["confidence"] <= 0.2
    assert r["A.8.7"]["verdict"] == "insufficient_evidence" and r["A.8.7"]["gap_severity"] == "medium"
    assert data["results"][0]["verdict"] == "implemented"          # input not mutated
    assert P.VERDICT_TO_CONTROL_STATUS["insufficient_evidence"] == "not_implemented"


def test_prescreen_baseline_and_band_consistency():
    score, level, tiers = P.prescreen_baseline({"Do you encrypt data at rest?": "no", "Do you hold ISO 27001?": "n/a", "Is MFA enforced?": "yes"})
    assert score == 3.5 and level == "low" and tiers["Do you encrypt data at rest?"] == 1
    assert P.vendor_band(3) == "low" and P.vendor_band(4) == "medium" and P.vendor_band(7) == "high" and P.vendor_band(8) == "critical"
    out = P.apply_fixups("vendor_prescreen", {"initial_risk_score": 9.0, "risk_level": "low", "summary": "s", "strengths": [], "concerns": [], "red_flags": [], "recommendations": []}, baseline=3.5)
    assert out["initial_risk_score"] == 4.5 and out["risk_level"] == "medium"
    assert P.consistency_issues("vendor_prescreen", {"initial_risk_score": 8, "risk_level": "low"}) != []
    ctx = P.risk_scale_context({"probability": {"labels": ["Rare", "Likely"], "descriptions": ["<1%", ">50%"]}, "impact": {"labels": ["Minor", "Major"], "descriptions": ["", ""]}, "risk_levels": [{"name": "low", "min_score": 1, "max_score": 2}, {"name": "critical", "min_score": 3, "max_score": 4}]})
    assert "1 Rare (<1%)" in ctx and "critical 3-4" in ctx and P.risk_band(4, {"risk_levels": [{"name": "critical", "min_score": 3, "max_score": 4}]}) == "critical"
    assert P.risk_scale_context(None) == "" and P.risk_band(12) == "high"


# ---------------------------------------------------------------------------
# Additional contract checks
# ---------------------------------------------------------------------------

def test_interface_summary_contract():
    expected_tasks = {"control_assessment", "risk_analysis", "evidence_analysis", "vendor_analysis", "vendor_prescreen",
                      "policy_generation", "document_generation", "regulatory_impact", "audit_plan", "remediation_plan",
                      "contract_analysis", "framework_builder", "assistant_chat", "public_support",
                      "audit_report", "clause_coverage", "evidence_extract", "contract_extract", "contract_review"}
    assert set(P.TASKS) == expected_tasks and len(P.TASKS) == 19
    for name in ("TASKS", "PromptError", "system_prompt", "task_schema", "task_defaults", "schema_text", "render_user_prompt",
                 "USER_TEMPLATES", "controls_block", "qa_lines", "risk_scale_context", "prescreen_baseline", "vendor_band",
                 "risk_band", "regimes_for_country", "consistency_issues", "apply_fixups", "normalize_control_id",
                 "VERDICT_TO_CONTROL_STATUS", "CONTROL_VERDICTS", "GAP_SEVERITIES", "RISK_SEVERITIES", "RISK_TREATMENTS",
                 "VENDOR_TIERS", "REGULATORY_IMPACTS", "CONTROL_CATEGORIES", "FINDING_SEVERITIES", "EFFORT_LEVELS",
                 "CONTRACT_TOPICS", "CONTRACT_RISKS", "CONTRACT_SEVERITIES", "CONTRACT_RESPONSIBLES", "CONTRACT_DEADLINES",
                 "CONTROL_ASSESSMENT_SCHEMA", "EVIDENCE_ANALYSIS_SCHEMA", "EVIDENCE_EXTRACT_SCHEMA", "CLAUSE_COVERAGE_SCHEMA",
                 "RISK_ANALYSIS_SCHEMA", "VENDOR_PRESCREEN_SCHEMA", "VENDOR_ANALYSIS_SCHEMA", "REGULATORY_IMPACT_SCHEMA",
                 "CONTRACT_EXTRACT_SCHEMA", "CONTRACT_ANALYSIS_SCHEMA", "FRAMEWORK_BUILDER_SCHEMA",
                 "ANALYST_CORE", "AUTHOR_CORE", "ASSISTANT_CORE", "SUPPORT_CORE", "PRODUCT_FACTS", "JSON_OUTPUT_RULES",
                 "MARKDOWN_OUTPUT_RULES", "CONFIDENCE_RUBRIC", "REPAIR_HINT", "TASK_RISK_ANALYSIS_MD_OUTLINE", "REGIMES_BY_COUNTRY"):
        assert hasattr(P, name), name
    assert issubclass(P.PromptError, ValueError)
    d = P.task_defaults("vendor_prescreen")
    assert set(d) == {"output", "temperature", "json_mode", "tables_allowed", "preset"}
    assert d == {"output": "json", "temperature": 0.0, "json_mode": True, "tables_allowed": False, "preset": "analysis"}
    assert P.task_defaults("risk_analysis")["output"] == "markdown" and P.task_schema("risk_analysis") is P.RISK_ANALYSIS_SCHEMA
    assert P.task_schema("policy_generation") is None and P.task_defaults("assistant_chat")["preset"] == "chat"
    assert P.task_defaults("document_generation")["tables_allowed"] is True and P.task_defaults("audit_report")["tables_allowed"] is False
    _raises(lambda: P.task_schema("nope"))
    _raises(lambda: P.system_prompt("control_assessment", output_format="xml"))
    _raises(lambda: P.render_user_prompt("assistant_chat"))
    # frontend / backend contract vocabularies
    assert P.CONTRACT_RESPONSIBLES == ("Vendor Legal Team", "Vendor CISO", "Vendor DPO", "Vendor CEO")
    assert P.CONTRACT_DEADLINES == ("Immediate", "7 days", "14 days", "30 days", "60 days", "90 days")
    assert P.CONTRACT_SEVERITIES == ("critical", "high", "medium", "low") and len(P.CONTRACT_TOPICS) == 18


def test_presets_exist_in_ai_provider_and_schemas_use_only_the_subset():
    from app.services import ai_provider
    allowed_kw = {"type", "properties", "required", "items", "enum", "minimum", "maximum", "minLength", "maxLength", "minItems", "maxItems", "description"}

    def walk(node):
        assert isinstance(node, dict) and set(node) <= allowed_kw, node
        t = node.get("type")
        if isinstance(t, list):
            assert len(t) == 2 and t[1] == "null"
        if "enum" in node:
            assert all(isinstance(v, str) or v is None for v in node["enum"])
            assert (None in node["enum"]) == (isinstance(t, list))
        for p in (node.get("properties") or {}).values():
            walk(p)
        for r in node.get("required") or []:
            assert r in node["properties"], r
        if "items" in node:
            walk(node["items"])

    for task in P.TASKS:
        d = P.task_defaults(task)
        assert d["preset"] in ai_provider.DECODING, (task, d["preset"])
        assert d["output"] in ("json", "markdown") and 0.0 <= d["temperature"] <= 1.0
        schema = P.task_schema(task)
        if d["output"] == "json":
            assert schema is not None
        if schema is not None:
            walk(schema)
            assert schema["type"] == "object"


def test_system_prompt_composition_details():
    s = P.system_prompt("control_assessment", today="2026-01-01")
    for block in (P.ROLE_COMPLIANCE_AUDITOR, P.ANALYST_CORE.strip(), P.TASK_CONTROL_ASSESSMENT.strip(), P.CONFIDENCE_RUBRIC.strip(),
                  P.JSON_OUTPUT_RULES.strip(), P.EXAMPLE_CONTROL_ASSESSMENT.strip()):
        assert block in s
    order = [s.index(P.ROLE_COMPLIANCE_AUDITOR), s.index("GROUNDING RULES"), s.index("TASK\n"), s.index("CONFIDENCE RUBRIC"),
             s.index("OUTPUT RULES"), s.index("OUTPUT SCHEMA (JSON object)"), s.index("EXAMPLE (format only"), s.index("LANGUAGE:")]
    assert order == sorted(order) and s.endswith("\n") and not s.endswith("\n\n")
    assert s.count("LANGUAGE:") == 1 and P.system_prompt("control_assessment", lang="ar").count("اللغة:") == 1
    # AUTHOR core date slot and Markdown tables rule
    a = P.system_prompt("policy_generation", today="2026-03-04")
    assert "Today's date is 2026-03-04." in a and "Do not use tables" in a and "OUTPUT SCHEMA" not in a
    assert "Tables are allowed only where the TASK explicitly lists table columns." in P.system_prompt("remediation_plan")
    # risk_analysis: Markdown outline by default, schema in JSON mode
    md = P.system_prompt("risk_analysis"); js = P.system_prompt("risk_analysis", output_format="json")
    assert "OUTPUT OUTLINE (Markdown" in md and "OUTPUT SCHEMA" not in md
    assert "OUTPUT OUTLINE (Markdown" not in js and '"inherent_severity": "critical | high | medium | low | info"' in js
    # public_support: product facts embedded, no leftover slot
    ps = P.system_prompt("public_support", lang="fr")
    assert "<<<BEGIN PRODUCT FACTS>>>" in ps and "support@grceye.com" in ps and "{product_facts}" not in ps
    # extra_context only when non-blank; CONTEXT header wording
    assert "CONTEXT (read-only facts" not in P.system_prompt("assistant_chat", extra_context="   ")
    assert P.system_prompt("assistant_chat", extra_context="Organisation: ACME").rstrip().endswith("CONTEXT (read-only facts supplied by the platform; rely on them and cite them, never contradict them)\nOrganisation: ACME")
    # no f-string braces survive in any rendered prompt (JSON examples contain braces legitimately, so check known slots only)
    for task in P.TASKS:
        s = P.system_prompt(task)
        assert "{errors}" not in s and "{today}" not in s


def test_user_templates_slot_contract():
    expected = {
        "control_assessment": {"framework_name", "framework_version", "framework_short_name", "org_name", "industry", "country", "scope", "doc_names", "pass_note", "evidence_block", "control_count", "controls_block"},
        "evidence_extract": {"doc_label", "chunk_index", "chunk_total", "page_hint", "topic_count", "topics", "document_block"},
        "clause_coverage": {"framework_name", "framework_version", "doc_name", "chunk_index", "chunk_total", "checklist_item", "expected_clause", "id_count", "allowed_ids", "document_block"},
        "risk_analysis": {"gap_note", "risk_block", "org_context", "framework_list", "scales"},
        "vendor_prescreen": {"vendor_name", "industry", "country", "yes", "no", "na", "total", "baseline_line", "questionnaire_block"},
        "vendor_analysis": {"today", "vendor_name", "industry", "services", "country", "total", "yes", "no", "partial", "na", "questionnaire_block", "public_findings_block"},
        "regulatory_impact": {"framework_list", "today", "items_block", "item_count"},
        "contract_extract": {"vendor_name", "file_name", "chunk_index", "chunk_total", "regimes", "contract_block"},
        "contract_analysis": {"vendor_name", "contract_language", "chunk_total", "absent_topics", "prior_review_block", "findings_block"},
        "framework_builder": {"industry", "region", "use_case_block", "selected_count", "shown_count", "selected_lines"},
        "policy_generation": {"org_name", "industry", "org_size", "country", "framework_name", "framework_version", "framework_short_name", "control_id", "control_title", "control_requirement", "gap_block", "existing_block"},
        "document_generation": {"document_type", "org_name", "industry", "size_detail", "country", "frameworks", "effective_date", "requirements_block"},
        "audit_plan": {"audit_title", "framework_name", "framework_short_name", "framework_version", "audit_type", "scope_block", "audit_objective", "control_count", "more_note", "control_lines"},
        "remediation_plan": {"framework_name", "framework_short_name", "horizon_days", "available_roles", "n_blockers", "blocker_lines", "n_high", "high_lines", "n_other", "other_lines"},
    }
    for task, slots in expected.items():
        assert set(Template(P.USER_TEMPLATES[task]).get_identifiers()) == slots, task
    assert P.USER_TEMPLATES["evidence_analysis"] == P.USER_TEMPLATES["control_assessment"]
    assert {"assessment_name", "compliance_score", "n_mandatory_unreviewed", "findings_block", "observations_block"} <= set(Template(P.USER_TEMPLATES["audit_report"]).get_identifiers())
    assert "assistant_chat" not in P.USER_TEMPLATES and "public_support" not in P.USER_TEMPLATES
    # rendered slots keep '%' and adjacent identifiers intact
    out = P.render_user_prompt("audit_plan", audit_title="A", framework_name="ISO", framework_short_name="ISO27001", framework_version="2022",
                               audit_type="internal", scope_block="S", audit_objective="O", control_count=12, more_note="; 3 more not listed", control_lines="- [A.5.1] x")
    assert "CONTROLS IN SCOPE (12; 3 more not listed):" in out
    rep = P.render_user_prompt("audit_report", **{k: "v" for k in Template(P.USER_TEMPLATES["audit_report"]).get_identifiers()} | {"compliance_score": 73})
    assert "score: 73% (not an audit result)" in rep


def test_rendering_helpers():
    block = P.controls_block([
        {"control_id": "A.5.18", "title": "Access  rights", "category": "Organizational", "is_mandatory": True,
         "description": "Access rights\nare provisioned.", "guidance": "  see 5.15 ", "requirements": [("must", "Review quarterly"), {"level": "should", "text": "Log removals"}]},
        {"control_id": "A.8.7", "title": "Malware", "is_mandatory": False, "description": "", "requirements": []},
    ])
    assert block.startswith("[A.5.18] Access rights\n  Category: Organizational | Mandatory: yes\n  Requirement: Access rights are provisioned.\n  Guidance: see 5.15\n  Statements: (must) Review quarterly ; (should) Log removals")
    assert "[A.8.7] Malware\n  Category: not stated | Mandatory: no\n  Requirement: (no description in framework — apply the standard's requirement)" in block
    assert "Guidance:" not in block.split("[A.8.7]")[1] and "Statements:" not in block.split("[A.8.7]")[1]
    long_desc = P.controls_block([{"control_id": "X", "title": "T", "description": "d" * 2000}]).splitlines()[2]
    assert long_desc == "  Requirement: " + "d" * 1200
    q = P.qa_lines({"Do you encrypt?": "yes", "MFA?": "  no ", "Blank?": ""})
    assert q == "- Do you encrypt?: YES\n- MFA?: NO\n- Blank?: (BLANK)"
    assert P.qa_lines([("q%d" % i, "yes") for i in range(62)]).endswith("- (2 more answers omitted)")
    assert P.qa_lines({}) == "" and P.qa_lines(None) == ""
    ctx = P.risk_scale_context({"probability": {"labels": ["A", "B", "C"]}, "impact": {"labels": ["X", "Y", "Z"], "descriptions": ["low", "", "high"]}})
    assert ctx.splitlines()[1] == "Likelihood (3 levels): 1 A · 2 B · 3 C" and ctx.splitlines()[2] == "Impact (3 levels): 1 X (low) · 2 Y · 3 Z (high)" and "Bands:" not in ctx
    assert P.risk_scale_context({"probability": {"labels": []}, "impact": {"labels": ["a"]}}) == "" and P.risk_scale_context("junk") == ""
    assert P.regimes_for_country("TN").startswith("Tunisian law 2004-63") and P.regimes_for_country("fr") == P.REGIMES_BY_COUNTRY["eu"]
    assert P.regimes_for_country("us") == P.REGIMES_BY_COUNTRY["default"] and P.regimes_for_country(None) == P.REGIMES_BY_COUNTRY["default"]
    assert P.normalize_control_id(" [a.5.18] ") == "A.5.18" and P.normalize_control_id("‘CC 6.1’") == "CC 6.1" and P.normalize_control_id(None) == ""
    assert P.normalize_control_id("`a.5.1`  x") == "A.5.1 X"


def test_bands_and_baseline_details():
    assert P.vendor_band(3.5) == "low" and P.vendor_band(3.6) == "medium" and P.vendor_band(5.5) == "medium" and P.vendor_band(5.6) == "high"
    assert P.vendor_band(7.5) == "high" and P.vendor_band(7.6) == "critical" and P.vendor_band(1) == "low" and P.vendor_band(10) == "critical"
    assert P.vendor_band("7") == "high" and P.vendor_band("x") == "medium" and P.vendor_band(None) == "medium"
    assert P.risk_band(1) == "low" and P.risk_band(4) == "low" and P.risk_band(5) == "medium" and P.risk_band(9) == "medium"
    assert P.risk_band(10) == "high" and P.risk_band(16) == "critical" and P.risk_band(25) == "critical" and P.risk_band("zz") == "medium"
    assert P.risk_band(3, {"risk_levels": [{"name": "Weird", "min_score": 1, "max_score": 5}]}) == "medium"
    assert P.risk_band(9, {"risk_levels": [{"name": "low", "min_score": 1, "max_score": 5}]}) == "medium"
    score, level, tiers = P.prescreen_baseline({})
    assert (score, level, tiers) == (1.0, "low", {})
    score, level, tiers = P.prescreen_baseline({
        "Is MFA required for privileged accounts?": "NO",            # tier 1 NO  +2.0
        "Do you have an incident response plan?": "Oui",             # tier 1 YES +0
        "Do you hold SOC 2 or ISO 27001?": "",                       # tier 2 blank +0.5
        "Do you perform an access review annually?": "n/a",          # tier 2 N/A +0.5
        "Do you run security awareness training?": "non",            # tier 3 NO +0.5
        "هل يتم تشفير البيانات؟": "لا",                               # tier 1 NO +2.0
        "Do you have an audit log?": True,                           # tier 2 YES (bool)
    })
    assert score == 6.5 and level == "high"
    assert tiers["Is MFA required for privileged accounts?"] == 1 and tiers["Do you hold SOC 2 or ISO 27001?"] == 2
    assert tiers["Do you run security awareness training?"] == 3 and tiers["هل يتم تشفير البيانات؟"] == 1
    big = P.prescreen_baseline({"Do you encrypt q%d?" % i: "no" for i in range(10)})
    assert big[0] == 10.0 and big[1] == "critical"


def test_consistency_issues_other_tasks():
    assert P.consistency_issues("control_assessment", "not a dict") == ["control_assessment: data is not an object"]
    assert P.consistency_issues("control_assessment", {"results": {}}) != []
    assert P.consistency_issues("policy_generation", {"anything": 1}) == [] and P.consistency_issues("nope", {}) == []
    good = {"results": [{"control_id": "A.5.18", "verdict": "implemented", "confidence": 0.8, "evidence": [{"quote": "q", "source": None}], "explanation": "x"}]}
    assert P.consistency_issues("control_assessment", good, expected_ids=["a.5.18"], mandatory_ids={"A.5.18"}) == []
    bad = {"results": [
        {"control_id": "A.5.18", "verdict": "implemented", "confidence": 0.5, "evidence": [{"quote": "q"}], "explanation": "x", "gap_severity": "low"},
        {"control_id": "A.5.18", "verdict": "insufficient_evidence", "confidence": 0.9, "evidence": [{"quote": "q"}], "explanation": "x"},
        {"control_id": "A.9.9", "verdict": "partially_implemented", "confidence": 0.6, "evidence": [], "explanation": "x", "gap_description": "", "remediation": []},
    ]}
    j = "\n".join(P.consistency_issues("control_assessment", bad, expected_ids=["A.5.18"]))
    assert "confidence >= 0.7" in j and "gap_severity" in j and "<= 0.2" in j and "must be empty" in j and "duplicate" in j
    assert 'unknown control_id "A.9.9"' in j and "gap_description" in j and "remediation" in j and "partially_implemented" in j
    assert all(line.startswith("- ") for line in j.splitlines())
    # clause_coverage
    cov = {"covered": [{"control_id": "A.5.15", "strength": "addresses"}, {"control_id": "Z.1", "strength": "mentions"}, {"control_id": "Z.2", "strength": "mentions"}]}
    assert P.consistency_issues("clause_coverage", cov, allowed_values=["A.5.15"]) == ["- covered: 2 of 3 control_id values are not in the allow-list — use only ALLOWED CONTROL IDS"]
    assert P.consistency_issues("clause_coverage", cov, allowed_values=["A.5.15", "Z.1"]) == ['- covered[2].control_id: "Z.2" is not in ALLOWED CONTROL IDS']
    assert P.consistency_issues("clause_coverage", cov) == []
    # vendor_prescreen
    assert P.consistency_issues("vendor_prescreen", {"initial_risk_score": 4.0, "risk_level": "medium", "strengths": ["x" * 301]}, baseline=6.0) == [
        "- initial_risk_score: must stay within ±1.0 of the platform baseline 6.0 (got 4.0)", "- strengths[0]: longer than 300 characters"]
    # vendor_analysis
    doms = [{"domain": d, "score": 2, "evidence_status": "insufficient_evidence"} for d in ("compliance_standards", "data_protection", "access_control", "incident_response")] + \
           [{"domain": "business_continuity", "score": 9, "evidence_status": "answered"}]
    j = "\n".join(P.consistency_issues("vendor_analysis", {"domains": doms, "overall_score": 9, "risk_classification": "high", "recommendation": "APPROVED"}))
    assert "sub_processors must appear exactly once (found 0)" in j and "must be critical" in j and "INSUFFICIENT EVIDENCE" in j
    assert "APPROVED is not allowed" in j
    # regulatory_impact
    items = {"items": [{"index": 1, "is_relevant": True, "summary": "", "relevance_reason": "r", "affected_frameworks": ["ISO27001", "XYZ"]}, {"index": 1, "is_relevant": False}]}
    j = "\n".join(P.consistency_issues("regulatory_impact", items, expected_ids=["1", "2"], allowed_values=["ISO27001"]))
    assert "items[0].summary" in j and "XYZ" in j and "index 1 must appear exactly once (found 2)" in j and "index 2 must appear exactly once (found 0)" in j
    # framework_builder
    fb = {"suggestions": [{"title": "Dup", "source_confidence": 0.9, "source_reference": ""}, {"title": "dup"}, {"title": "Sel"}]}
    j = "\n".join(P.consistency_issues("framework_builder", fb, allowed_values=["sel"]))
    assert "at least 5" in j and "duplicate title" in j and "collides" in j and "source_reference" in j
    # contract_analysis
    ca = {"suggestions": [{"severity": "low", "topic": "insurance", "fix": ""}, {"severity": "high", "topic": "liability_cap", "fix": "x"}],
          "action_plan": [{"topic": "termination"}]}
    j = "\n".join(P.consistency_issues("contract_analysis", ca))
    assert "suggestions[0].fix" in j and "severity descending" in j and "termination has no matching suggestion" in j
    # risk_analysis (json)
    ra = {"likelihood": {"score": 6, "scale_max": 5}, "impact": {"score": 3, "scale_max": 5}, "treatment_options": [{"option": "mitigate"}], "recommended_option": "avoid"}
    j = "\n".join(P.consistency_issues("risk_analysis", ra))
    assert "likelihood.score: 6 exceeds scale_max 5" in j and "impact" not in j and "avoid is not among treatment_options" in j


def test_apply_fixups_other_tasks():
    # control assessment: low-confidence implemented, N/A without justification, canonical ids, gap defaults, remediation coercion
    data = {"results": [
        {"control_id": "a.5.18", "verdict": "implemented", "confidence": 0.5, "evidence": [{"quote": "q"}], "explanation": "ok", "remediation": "one step"},
        {"control_id": "A.8.7", "verdict": "not_applicable", "confidence": 1.7, "evidence": ["loose quote"], "explanation": "x"},
        {"control_id": "A.8.8", "verdict": "not_implemented", "confidence": -1, "evidence": [], "explanation": "x"},
        {"control_id": "A.8.9", "verdict": "insufficient_evidence", "confidence": 0.9, "evidence": [{"quote": "q"}], "explanation": "x"},
        {"control_id": "A.8.10", "verdict": "partially_implemented", "confidence": 0.6, "evidence": [{"quote": ""}], "explanation": "x", "gap_severity": "high"},
        "junk",
    ]}
    out = P.apply_fixups("evidence_analysis", data, mandatory_ids={"A.8.8"}, expected_ids=["A.5.18"])
    r = {x["control_id"]: x for x in out["results"] if isinstance(x, dict)}
    assert r["A.5.18"]["verdict"] == "partially_implemented" and r["A.5.18"]["explanation"].startswith("Downgraded: confidence below 0.7. ok")
    assert r["A.5.18"]["remediation"] == ["one step"] and r["A.5.18"]["gap_severity"] == "low"
    assert r["A.8.7"]["verdict"] == "insufficient_evidence" and r["A.8.7"]["confidence"] == 0.2 and r["A.8.7"]["evidence"] == [] and r["A.8.7"]["gap_severity"] == "low"
    assert r["A.8.8"]["confidence"] == 0.0 and r["A.8.8"]["gap_severity"] == "high" and r["A.8.8"]["remediation"] == []
    assert r["A.8.9"]["confidence"] == 0.2 and r["A.8.9"]["evidence"] == [] and r["A.8.9"]["gap_severity"] == "low"
    assert r["A.8.10"]["verdict"] == "insufficient_evidence" and r["A.8.10"]["gap_severity"] == "high"  # existing severity kept
    assert out["results"][-1] == "junk" and data["results"][0]["control_id"] == "a.5.18"
    assert P.apply_fixups("control_assessment", {"results": "nope"}) == {"results": "nope"}
    assert P.apply_fixups("control_assessment", [1, 2]) == [1, 2]
    # vendor_prescreen without baseline
    out = P.apply_fixups("vendor_prescreen", {"initial_risk_score": "12", "risk_level": "low", "strengths": ["a" * 400] * 8})
    assert out["initial_risk_score"] == 10.0 and out["risk_level"] == "critical" and len(out["strengths"]) == 6 and len(out["strengths"][0]) == 300
    # vendor_analysis
    va = {"overall_score": 9.6, "risk_classification": "low", "recommendation": "APPROVED", "domains": [{"evidence_status": "answered"}]}
    out = P.apply_fixups("vendor_analysis", va)
    assert out["overall_score"] == 10 and out["risk_classification"] == "critical" and out["recommendation"] == "REJECTED"
    va["domains"] = [{"evidence_status": "insufficient_evidence"}] * 4
    assert P.apply_fixups("vendor_analysis", va)["recommendation"] == "INSUFFICIENT EVIDENCE"
    # regulatory_impact
    ri = {"items": [{"index": 1, "is_relevant": False, "impact": "critical", "affected_frameworks": ["ISO27001", "XYZ"]},
                    {"index": 2, "is_relevant": True, "impact": "high", "affected_frameworks": ["XYZ"]}]}
    out = P.apply_fixups("regulatory_impact", ri, expected_ids=["ISO27001"])
    assert out["items"][0]["impact"] == "informational" and out["items"][0]["affected_frameworks"] == ["ISO27001"]
    assert out["items"][1]["impact"] == "high" and out["items"][1]["affected_frameworks"] == []
    assert P.apply_fixups("regulatory_impact", ri)["items"][0]["affected_frameworks"] == ["ISO27001", "XYZ"]
    # framework_builder
    fb = {"suggestions": [{"title": "One", "category": "protect", "priority": "HIGH"}, {"title": "one", "category": "PROTECT"},
                          {"title": "Two", "category": "Unknown"}, {"title": "Three", "category": "Organizational"}]}
    out = P.apply_fixups("framework_builder", fb)
    assert [s["title"] for s in out["suggestions"]] == ["One", "Three"] and out["suggestions"][0] == {"title": "One", "category": "PROTECT", "priority": "high"}
    # contract_analysis: stable severity sort
    ca = {"suggestions": [{"severity": "low", "clause": "a"}, {"severity": "critical", "clause": "b"}, {"severity": "high", "clause": "c"}, {"severity": "high", "clause": "d"}, {"severity": "weird", "clause": "e"}]}
    assert [s["clause"] for s in P.apply_fixups("contract_analysis", ca)["suggestions"]] == ["b", "c", "d", "a", "e"]
    # other tasks: deep copy, unchanged
    src = {"a": [1]}
    out = P.apply_fixups("policy_generation", src)
    assert out == src and out is not src and out["a"] is not src["a"]


def test_schema_text_rendering_details():
    txt = P.schema_text(P.VENDOR_ANALYSIS_SCHEMA)
    assert '"public_information_used": true|false,' in txt and '"overall_score": <integer 1-10>,' in txt
    assert '"recommendation": "APPROVED | APPROVED WITH CONDITIONS | REJECTED | INSUFFICIENT EVIDENCE",' in txt
    assert "],  // min 6, max 6" in txt and '"warnings": ["<string, max 300 chars>", ...]  // optional, max 5' in txt
    assert not any(line != line.rstrip() for line in txt.splitlines()) and not txt.endswith("\n")
    assert P.schema_text(P.CONTROL_ASSESSMENT_SCHEMA) == P.schema_text(P.CONTROL_ASSESSMENT_SCHEMA)  # deterministic
    ce = P.schema_text(P.CONTRACT_EXTRACT_SCHEMA)
    assert '"facts": {' in ce and '"parties": "<string, max 300 chars>" | null,' in ce
    assert '"language": "<string, max 10 chars>" | null\n  },  // optional' in ce
    assert P.schema_text({"type": "object", "properties": {"n": {"type": "number"}, "d": {"type": "string", "description": "why"}}, "required": ["n"]}) == \
        '{\n  "n": <number>,\n  "d": "<string>"  // optional, why\n}'
    _raises(lambda: P.schema_text("nope"))


def test_import_purity_and_no_side_effects():
    import subprocess
    code = ("import sys, importlib; before = set(sys.modules); import app.services.ai_prompts as P; "
            "assert 'app.core.database' not in sys.modules, 'ai_prompts must not touch the DB layer'; "
            "assert 'app.core.config' not in sys.modules or 'app.core.config' in before, 'ai_prompts must not import settings'; "
            "print('pure')")
    res = subprocess.run([sys.executable, "-c", code], cwd=str(BACKEND_DIR), capture_output=True, text=True, timeout=120)
    assert res.returncode == 0 and "pure" in res.stdout, res.stderr


def test_examples_validate_against_their_schemas():
    """Every registered few-shot must pass the task's own schema and consistency rules — otherwise
    the model is told to imitate a shape that fails validation and costs the single repair round
    (evidence_analysis re-used the control_assessment example, which lacks overall_summary)."""
    from app.services.ai_structured import extract_json, validate_against
    checked = 0
    for task in P.TASKS:
        spec = P._TASK_SPECS[task]
        if not spec.example:
            continue
        schema = P.task_schema(task)
        data = extract_json(spec.example)
        if task == "framework_builder":                       # "one acceptable item": validate as an item
            schema = schema["properties"]["suggestions"]["items"]
        ok, err, _ = validate_against(data, schema)
        assert ok, (task, err)
        if task != "framework_builder":
            assert P.consistency_issues(task, data) == [], (task, P.consistency_issues(task, data))
        checked += 1
    assert checked >= 7
    assert P.EXAMPLE_EVIDENCE_ANALYSIS != P.EXAMPLE_CONTROL_ASSESSMENT
    assert '"overall_summary"' in P.EXAMPLE_EVIDENCE_ANALYSIS and '"key_gaps"' in P.EXAMPLE_EVIDENCE_ANALYSIS
    assert P.EXAMPLE_EVIDENCE_ANALYSIS.strip() in P.system_prompt("evidence_analysis")
    assert P.EXAMPLE_CONTROL_ASSESSMENT.strip() not in P.system_prompt("evidence_analysis")
    assert "EXAMPLE_EVIDENCE_ANALYSIS" in P.__all__


def test_chat_personas_have_no_document_output_rules():
    """assistant_chat / public_support have an empty TASK block and their own STYLE / FORMAT rules;
    the document-oriented MARKDOWN_OUTPUT_RULES ('Use the headings listed in the TASK', 'Output ONLY
    the document') must not contradict them (public_support: no headings, at most 120 words)."""
    for task in ("assistant_chat", "public_support"):
        s = P.system_prompt(task)
        assert "Output ONLY the document in Markdown" not in s and "OUTPUT RULES" not in s
        assert "Use the headings listed in the TASK" not in s and "{tables_rule}" not in s
    assert "no headings, no tables" in P.system_prompt("public_support")
    assert "STYLE" in P.system_prompt("assistant_chat")
    for task in ("policy_generation", "audit_report", "contract_review", "risk_analysis"):
        assert "Output ONLY the document in Markdown" in P.system_prompt(task)


CASES = [
    test_every_task_builds_and_has_no_unfilled_placeholders,
    test_enums_match_platform_models,
    test_schema_text_lists_enums_verbatim_and_language_does_not_touch_them,
    test_render_user_prompt_missing_slot_and_dollar_safety,
    test_control_assessment_consistency_and_fixups,
    test_prescreen_baseline_and_band_consistency,
    test_interface_summary_contract,
    test_presets_exist_in_ai_provider_and_schemas_use_only_the_subset,
    test_system_prompt_composition_details,
    test_user_templates_slot_contract,
    test_rendering_helpers,
    test_bands_and_baseline_details,
    test_consistency_issues_other_tasks,
    test_apply_fixups_other_tasks,
    test_schema_text_rendering_details,
    test_import_purity_and_no_side_effects,
    test_examples_validate_against_their_schemas,
    test_chat_personas_have_no_document_output_rules,
]


def main() -> int:
    failures = 0
    for case in CASES:
        try:
            case()
        except Exception:
            failures += 1
            print(f"FAIL  {case.__name__}")
            traceback.print_exc()
        else:
            print(f"PASS  {case.__name__}")
    total = len(CASES)
    print(f"\n{total - failures}/{total} passed" + ("" if not failures else f", {failures} FAILED"))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
