"""Self-test for app.services.ai_chunking (component C of the AI foundation).

Pure Python: no database, no network, no pytest. Model calls are faked by monkeypatching the
module attribute ``ai_chunking.ai_structured`` (the module binds it at import) and the A
dependency ``ai_chunking._assess_system_prompt``. Cases T1-T6 are the spec's mandated tests
(foundation_spec_final.md, component C, section 8); the rest cover the remaining public surface
and the "never a synthetic verdict / never drop text" guarantees.

Usage (from the repo root or from backend/):
    venv/bin/python backend/scripts/selftest_ai_chunking.py

Prints PASS/FAIL per case and exits non-zero on any failure.
"""
from __future__ import annotations

import asyncio
import logging
import os
import re
import subprocess
import sys
import traceback

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

from app.services import ai_chunking as C  # noqa: E402
from app.services.ai_chunking import (  # noqa: E402
    LOCATE_SYSTEM_PROMPT, Chunk, ControlSpec, ControlVerdict, EvidenceQuote, MapFailure, SourceIndex,
    assess_controls_over_document, build_id_resolver, chunk_document, chunk_documents, chunk_items, chunk_text,
    control_spec_from_model, estimate_messages_tokens, estimate_tokens, input_budget, map_reduce, merge_verdicts,
    normalize_verdict, normalize_ws, page_label, page_marked_text, quote_in_text, render_control_block,
    render_followup_user, verify_verdict,
)
from app.services.ai_structured import AiResult  # noqa: E402


def _run(coro):
    return asyncio.run(coro)


def _ok(data, attempts=1):
    return AiResult(ok=True, data=data, error=None, raw="{}", attempts=attempts, model="fake-model")


def _asked(user: str) -> list[str]:
    return re.findall(r"^### \[([^\]]+)\]", user, re.M)


def _block(user: str, cid: str) -> str:
    """The control block text for ``cid`` (up to the next block)."""
    m = re.search(r"^### \[%s\].*?(?=^### \[|\Z)" % re.escape(cid), user, re.M | re.S)
    return m.group(0) if m else ""


class _Patched:
    """Context manager that swaps the model call + the A system-prompt dependency."""

    def __init__(self, fake):
        self.fake = fake

    def __enter__(self):
        self._orig = (C.ai_structured, C._assess_system_prompt)
        C.ai_structured = self.fake
        C._assess_system_prompt = lambda lang, fl: "SYS"
        return self

    def __exit__(self, *exc):
        C.ai_structured, C._assess_system_prompt = self._orig
        return False


# ---------------------------------------------------------------------------
# T1 - T4: tokens, chunking, packing, quotes/ids
# ---------------------------------------------------------------------------

def test_t1_estimate_tokens():
    assert estimate_tokens("") == 0
    assert 900 <= estimate_tokens("word " * 800) <= 1100
    assert 380 <= estimate_tokens("م" * 1000) <= 420
    a, b = "hello world " * 50, "and more text"
    assert estimate_tokens(a + b) >= estimate_tokens(a)
    assert estimate_messages_tokens([{"role": "system", "content": "x" * 400}, {"role": "user", "content": ""}]) == 100 + 8
    assert input_budget(32768, "x" * 4000, reserve_output_tokens=4096) == 32768 - 4096 - 1000
    assert input_budget(10, "x" * 4000) == 0


def _paragraph_text() -> str:
    return "\n\n".join(" ".join("w%dx%d" % (i, j) for j in range(40)) for i in range(300))


def test_t2_chunk_document_invariants():
    text = _paragraph_text()
    assert len(text) > 80_000
    chunks = chunk_document(text, 2000, 100)
    assert len(chunks) >= 8
    for i, c in enumerate(chunks):
        assert estimate_tokens(c.text) <= 2000
        assert text[c.start:c.end] == c.text
        assert c.index == i + 1 and c.total == len(chunks)
        assert c.text  # never empty
        if i + 1 < len(chunks):
            assert chunks[i + 1].start <= c.end            # overlap
            assert chunks[i + 1].start > c.start           # progress
            assert c.text.endswith("\n\n")                 # paragraph cut
    assert chunks[0].start == 0 and chunks[-1].end == len(text)
    assert chunk_text(text, 2000, 100) == [c.text for c in chunks]
    assert chunk_document("   ") == []
    assert chunk_document("", 100) == []
    assert chunk_document("short", 100) == [Chunk("", 1, 1, "short", 0, 5, "full text")]
    marked = page_marked_text(["p1 " * 2000, "p2 " * 2000, "p3 " * 2000])
    pc = chunk_document(marked, 2500)
    assert any(marked[c.end:].startswith("[[PAGE") for c in pc[:-1])
    assert pc[0].label.startswith("page")
    assert page_label("[[PAGE 3]] x [[PAGE 5]]") == "pages 3-5" and page_label("no markers") == ""


def test_t2b_chunk_text_never_drops_text():
    text = _paragraph_text()
    for overlap in (0, 100):
        parts = chunk_text(text, 1500, overlap)
        assert all(p for p in parts)
        chunks = chunk_document(text, 1500, overlap)
        covered = 0
        for c in chunks:                                  # union of [start, end) covers the input in order
            assert c.start <= covered
            covered = max(covered, c.end)
        assert covered == len(text)
    assert "".join(chunk_text(text, 1500, 0)) == text     # zero overlap: concatenation IS the input
    # hard split on a text without any whitespace still covers everything and stays within budget
    blob = "a" * 20_000
    parts = chunk_text(blob, 1000, 0)
    assert "".join(parts) == blob and all(estimate_tokens(p) <= 1000 for p in parts)
    # sentence-level cut when there are no newlines
    prose = ("The policy applies to all staff. Access is reviewed quarterly! Is it logged? Yes. " * 400)
    sc = chunk_document(prose, 1000, 50)
    assert all(c.text.rstrip().endswith((".", "!", "?")) for c in sc[:-1])
    # degenerate overlap (>= half a window) still terminates with sane progress
    assert len(chunk_text("word " * 4000, 100, 200)) < 200


def test_t3_chunk_documents_and_items():
    chunks = chunk_documents([("a.pdf", "x " * 5000), ("b.docx", ""), ("c.txt", "y " * 10)], 1000)
    assert all(not ("x" in c.text and "y" in c.text) for c in chunks)
    assert {c.source for c in chunks} == {"a.pdf", "c.txt"}
    assert chunk_items(list(range(25)), 10**6, str, max_items=10) == [list(range(10)), list(range(10, 20)), list(range(20, 25))]
    groups = chunk_items(["a" * 4000, "b" * 4000, "c"], 1000, str)
    assert len(groups) == 3 and sum(groups, []) == ["a" * 4000, "b" * 4000, "c"]
    assert chunk_items([], 100, str) == []


def test_t4_quote_in_text_and_ids():
    assert quote_in_text("laptops use full-disk encryption", "All  laptops use full-disk ENCRYPTION (BitLocker).")
    assert quote_in_text('the "Owner" – IT', "the “Owner” — IT department")
    assert quote_in_text("access reviews are quarterly", "access reviews [[PAGE 3]] are quarterly")
    long_q = "the security officer reviews every privileged account on the first monday of each month and records it"
    text = "Preamble. " + long_q[:80] + " but then the text diverges completely from what was quoted."
    assert len(long_q) >= 100 and quote_in_text(long_q, text)
    assert not quote_in_text("totally absent sentence here", text)
    assert not quote_in_text("short", "short")
    assert normalize_ws("Áb  [[PAGE 1]] “x” – مَ") == "áb \"x\" - م".replace("á", "á")
    idx = SourceIndex("Access rights are reviewed quarterly by the IT Security Manager.")
    assert idx.contains("reviewed quarterly by the it security manager") and not idx.contains("never here at all")
    resolve = build_id_resolver(["A.5.1", "A.5.18", "PR.AA-05"])
    assert resolve("[a.5.18]") == "A.5.18"
    assert resolve("A518") == "A.5.18"
    assert resolve("PR AA 05") == "PR.AA-05"
    assert resolve("A.9.9") is None and resolve(None) is None and resolve("") is None
    ambiguous = build_id_resolver(["1.2.3", "12.3"])
    assert ambiguous("123") is None and ambiguous("1.2.3") == "1.2.3"


# ---------------------------------------------------------------------------
# T5: map_reduce
# ---------------------------------------------------------------------------

def test_t5_map_reduce():
    async def scenario():
        inflight = {"now": 0, "max": 0}

        async def slow(x):
            inflight["now"] += 1
            inflight["max"] = max(inflight["max"], inflight["now"])
            await asyncio.sleep(0.01)
            inflight["now"] -= 1
            return x * 2

        out = await map_reduce(list(range(6)), slow, list, concurrency=2)
        assert out == [0, 2, 4, 6, 8, 10] and inflight["max"] == 2

        started: list[int] = []

        async def bad(x):
            started.append(x)
            if x == 2:
                raise ValueError("boom")
            await asyncio.sleep(0.01)
            return x

        try:
            await map_reduce(list(range(8)), bad, list, concurrency=2)
            raise AssertionError("expected ValueError")
        except ValueError as exc:
            assert type(exc) is ValueError and str(exc) == "boom"
        assert len(started) < 8 and 7 not in started and 6 not in started

        started.clear()
        out = await map_reduce(list(range(8)), bad, list, concurrency=2, allow_partial=True)
        assert isinstance(out[2], MapFailure) and out[2].index == 2 and out[2].chunk == 2 and out[2].error == "boom"
        assert [o for i, o in enumerate(out) if i != 2] == [0, 1, 3, 4, 5, 6, 7]

        assert await map_reduce([], slow, list) == []

        async def areduce(xs):
            return sum(xs)

        assert await map_reduce([1, 2, 3], lambda x: x + 1, areduce, concurrency=1) == 9     # sync map, async reduce
        assert await map_reduce([1, 2, 3], slow, lambda xs: sum(xs)) == 12                    # sync reduce

    _run(scenario())


# ---------------------------------------------------------------------------
# T6: assess_controls_over_document
# ---------------------------------------------------------------------------

DOC_A_SENTENCE = "All laptops use full-disk encryption (BitLocker) managed by IT Operations."
DOC_A_REVIEW = "Access rights are reviewed quarterly by the IT Security Manager and line managers."
DOC_LAST = "The final sentence of the policy closes the document with the approval of the CISO."


def _small_doc() -> str:
    filler = " ".join("Clause %d states an ordinary operational rule for the information security programme." % i
                      for i in range(30))
    text = "Section 1. %s %s %s %s" % (DOC_A_SENTENCE, DOC_A_REVIEW, filler, DOC_LAST)
    assert 2500 <= len(text) <= 3500, len(text)
    return text


def _controls(n: int, mandatory=("C3",)) -> list[ControlSpec]:
    return [ControlSpec("C%d" % i, "Control number %d" % i, "Requirement text for control %d." % i,
                        is_mandatory=("C%d" % i) in mandatory) for i in range(1, n + 1)]


def test_t6a_direct_mode():
    doc = _small_doc()
    calls: list[tuple[str, str]] = []

    async def fake(messages, schema, **kw):
        system, user = messages[0]["content"], messages[1]["content"]
        calls.append((system, user))
        followup = user.startswith("Your previous answer")
        results = []
        for cid in _asked(user):
            if cid == "C11" and not followup:
                continue                                                    # omitted -> follow-up must fetch it
            if cid == "C1":
                results.append({"control_id": "C1", "verdict": "implemented", "confidence": "85%",
                                "evidence": [{"source": "doc.pdf", "quote": DOC_A_SENTENCE}],
                                "explanation": "Encryption is evidenced."})
            elif cid == "C2":
                results.append({"control_id": "C2", "verdict": "implemented", "confidence": 0.9,
                                "evidence": [{"source": "doc.pdf", "quote": "Backups are restored and tested every month by the DR team."}],
                                "explanation": "Invented."})
            elif cid == "C3":
                results.append({"control_id": "C3", "verdict": "not_applicable", "confidence": 0.8, "evidence": [],
                                "not_applicable_justification": "No in-house development.", "explanation": "N/A"})
            elif cid == "C4":
                results.append({"control_id": "C4", "verdict": "partial", "confidence": 0.7,
                                "evidence": [{"quote": DOC_A_REVIEW}], "explanation": "Review only.",
                                "gap_description": "No provisioning process.", "gap_severity": "HIGH",
                                "remediation": ["Write the JML procedure.", "Assign an owner."]})
            else:
                results.append({"control_id": cid, "verdict": "insufficient_evidence", "confidence": 0.1,
                                "evidence": [], "explanation": "Nothing found.", "gap_severity": "weird"})
        return _ok({"results": results, "warnings": []})

    with _Patched(fake):
        res = _run(assess_controls_over_document([("doc.pdf", doc)], _controls(12), controls_per_call=10,
                                                 framework_label="Test FW", concurrency=2))
    assert res.ok, res.error
    run = res.data
    assert run.mode == "direct" and run.chunks == 1
    assert run.calls == 3 and len(calls) == 3 and res.attempts == 3
    assert all(system == "SYS" for system, _ in calls)
    assert calls[2][1].startswith("Your previous answer did not contain a valid result for the following 1 control(s)")
    assert _asked(calls[2][1]) == ["C11"]
    user = calls[0][1]
    assert "<<<BEGIN UNTRUSTED DOCUMENT TEXT>>>" in user and DOC_LAST in user          # full text, E's markers
    assert "CONTROLS TO ASSESS (10 of 12)" in user and "Documents reviewed (1): doc.pdf" in user
    assert run.missing_ids == [] and run.failures == []
    assert set(run.verdicts) == {"C%d" % i for i in range(1, 13)}
    c1 = run.verdicts["C1"]
    assert c1.verdict == "implemented" and c1.confidence == 0.85 and c1.evidence[0].located and c1.evidence[0].source == "doc.pdf"
    assert c1.gap_description is None and c1.remediation is None
    c2 = run.verdicts["C2"]
    assert c2.verdict == "insufficient_evidence" and c2.evidence == [] and c2.confidence <= 0.2
    assert any("no quoted evidence could be located" in w for w in c2.warnings)
    c3 = run.verdicts["C3"]
    assert c3.verdict == "insufficient_evidence" and any("mandatory" in w for w in c3.warnings)
    c4 = run.verdicts["C4"]
    assert c4.verdict == "partially_implemented" and c4.gap_severity == "high" and c4.evidence[0].located
    assert c4.remediation == "1. Write the JML procedure.\n2. Assign an owner."
    assert run.verdicts["C5"].gap_severity is None and run.verdicts["C5"].confidence <= 0.2
    assert run.verdicts["C11"].verdict == "insufficient_evidence"
    assert res.partial is False and res.invalid_items == [] and res.model == "fake-model"


def _big_docs() -> list[tuple[str, str]]:
    filler = " ".join("Paragraph %d of the operational manual describes a routine that has no bearing on the controls." % i
                      for i in range(140))
    docs = [("a.pdf", DOC_A_SENTENCE + " " + filler), ("b.docx", "Second document. " + filler), ("c.txt", "Third document. " + filler)]
    total = sum(len(t) for _, t in docs)
    assert 36_000 <= total <= 46_000, total
    return docs


def test_t6b_locate_mode():
    docs = _big_docs()
    calls: list[tuple[str, str]] = []
    judge_prompts: list[str] = []

    async def fake(messages, schema, **kw):
        system, user = messages[0]["content"], messages[1]["content"]
        calls.append((system, user))
        if system == LOCATE_SYSTEM_PROMPT:
            assert "<<<BEGIN UNTRUSTED DOCUMENT EXCERPT>>>" in user and "CONTROL LIST (4 controls" in user
            if 'Document: "a.pdf" — excerpt 1 of 2' in user:
                return _ok({"document_summary": "An IT policy excerpt.", "evidence_language": "en", "matches": [
                    {"control_id": "C1", "quotes": [DOC_A_SENTENCE], "note": "policy statement"},
                    {"control_id": "Z.9", "quotes": [DOC_A_SENTENCE], "note": "hallucinated id"},
                    {"control_id": "C2", "quotes": ["Laptops are encrypted with a paraphrased sentence that is not verbatim."], "note": "x"},
                ]})
            return _ok({"document_summary": "Manual excerpt.", "evidence_language": "en", "matches": []})
        judge_prompts.append(user)
        results = []
        for cid in _asked(user):
            if cid == "C1":
                results.append({"control_id": "C1", "verdict": "implemented", "confidence": 0.8,
                                "evidence": [{"source": "a.pdf", "quote": DOC_A_SENTENCE}], "explanation": "ok"})
            else:
                results.append({"control_id": cid, "verdict": "insufficient_evidence", "confidence": 0.1, "evidence": [], "explanation": "none"})
        return _ok({"results": results})

    with _Patched(fake):
        res = _run(assess_controls_over_document(docs, _controls(4, mandatory=()), chunk_tokens=3000, concurrency=2))
    assert res.ok, res.error
    run = res.data
    assert run.mode == "locate_then_judge" and run.chunks == 6
    assert run.calls == 6 + 1 == len(calls)
    assert len(judge_prompts) == 1
    prompt = judge_prompts[0]
    assert "<<<BEGIN EVIDENCE [C1]>>>" in prompt and DOC_A_SENTENCE in _block(prompt, "C1")
    assert "(a.pdf, part 1 of 2)" in _block(prompt, "C1")
    assert "none located" in _block(prompt, "C2") and "none located" in _block(prompt, "C3")
    assert any("identifier(s) not in the framework were dropped" in w for w in run.warnings)
    assert any("unlocatable quote(s) dropped" in w for w in run.warnings)
    assert run.verdicts["C1"].verdict == "implemented" and run.verdicts["C1"].evidence[0].source == "a.pdf"
    assert run.verdicts["C2"].verdict == "insufficient_evidence" and run.missing_ids == []
    assert run.evidence_language == "en" and len(run.document_summaries) == 6
    assert run.failures == []


def test_t6c_failure_and_partial():
    doc = _small_doc()

    def make_fake(counter, asked_per_call):
        async def fake(messages, schema, **kw):
            counter["n"] += 1
            user = messages[1]["content"]
            asked_per_call.append(_asked(user))
            if counter["n"] == 2:
                return AiResult(ok=False, data=None, error="timeout", raw=None, attempts=1, model="fake-model", kind="timeout")
            return _ok({"results": [{"control_id": cid, "verdict": "not_implemented", "confidence": 0.6, "evidence": [],
                                     "explanation": "gap", "gap_description": "missing", "gap_severity": "medium"}
                                    for cid in _asked(user)]})
        return fake

    counter, asked = {"n": 0}, []
    with _Patched(make_fake(counter, asked)):
        res = _run(assess_controls_over_document([("doc.pdf", doc)], _controls(25, mandatory=()), controls_per_call=10, concurrency=2))
    assert res.ok is False and res.data is None
    assert "timeout" in res.error and res.error.startswith("AI analysis failed at controls ")
    assert res.kind == "timeout"
    assert counter["n"] <= 3                                         # n_batches == 3; never more

    counter, asked = {"n": 0}, []
    with _Patched(make_fake(counter, asked)):
        res = _run(assess_controls_over_document([("doc.pdf", doc)], _controls(25, mandatory=()), controls_per_call=10,
                                                 concurrency=2, allow_partial=True))
    assert res.ok is True
    run = res.data
    failed_ids = set(asked[1])
    assert failed_ids and failed_ids <= set(run.missing_ids) and set(run.missing_ids) == failed_ids
    assert len(run.failures) == 1 and "timeout" in run.failures[0]
    assert set(run.verdicts) == {"C%d" % i for i in range(1, 26)} - failed_ids
    assert run.verdicts["C1"].verdict == "not_implemented" and run.verdicts["C1"].gap_severity == "medium"
    assert res.partial is True and {x["item"]["control_id"] for x in res.invalid_items} == failed_ids
    assert all(x["errors"].startswith("analysis_failed") for x in res.invalid_items)


def test_t6c2_partial_locate_failure():
    docs = _big_docs()
    counter = {"n": 0}

    async def fake(messages, schema, **kw):
        counter["n"] += 1
        system, user = messages[0]["content"], messages[1]["content"]
        if system == LOCATE_SYSTEM_PROMPT:
            if counter["n"] == 1:
                return AiResult(ok=False, data=None, error="malformed reply", raw="x", attempts=2, model="fake-model", kind="malformed")
            return _ok({"matches": []})
        return _ok({"results": [{"control_id": cid, "verdict": "insufficient_evidence", "confidence": 0.1, "evidence": [], "explanation": "n"}
                                for cid in _asked(user)]})

    with _Patched(fake):
        strict = _run(assess_controls_over_document(docs, _controls(3, mandatory=()), chunk_tokens=3000, concurrency=1))
        assert strict.ok is False and strict.error.startswith("AI analysis failed at locate ") and strict.kind == "malformed"
        assert counter["n"] == 1                                     # concurrency 1: nothing else started
        counter["n"] = 0
        res = _run(assess_controls_over_document(docs, _controls(3, mandatory=()), chunk_tokens=3000, concurrency=1, allow_partial=True))
    assert res.ok and res.data.mode == "locate_then_judge"
    assert len(res.data.failures) == 1 and res.data.failures[0].startswith("locate ")
    assert any("was not searched for evidence" in w for w in res.data.warnings)
    assert res.data.missing_ids == [] and len(res.data.verdicts) == 3


def test_t6i_followup_failure_preserves_first_call_verdicts():
    """Regression for the high-severity defect: a transient failure of the single mandatory
    follow-up call must not discard the verdicts the batch's first, successful call already
    produced, and must not (via map_reduce's all-or-nothing default) cancel other batches that
    judged cleanly. Only the straggler the follow-up was chasing should end up in missing_ids."""
    doc = _small_doc()

    async def fake(messages, schema, **kw):
        user = messages[1]["content"]
        asked = _asked(user)
        if user.startswith("Your previous answer"):
            assert asked == ["C2"]                    # only batch 1's straggler ever needs a follow-up
            return AiResult(ok=False, data=None, error="timeout", raw=None, attempts=1, model="fake-model", kind="timeout")
        if asked == ["C1", "C2"]:
            # Batch 1's first call: a real, verified verdict for C1; C2 omitted -> mandatory follow-up.
            return _ok({"results": [{"control_id": "C1", "verdict": "implemented", "confidence": 0.9,
                                     "evidence": [{"source": "doc.pdf", "quote": DOC_A_SENTENCE}], "explanation": "ok"}]})
        # Batch 2 (C3, C4): judges cleanly on the first call, no follow-up.
        return _ok({"results": [{"control_id": cid, "verdict": "not_implemented", "confidence": 0.5, "evidence": [],
                                 "explanation": "gap"} for cid in asked]})

    for allow_partial in (False, True):
        with _Patched(fake):
            res = _run(assess_controls_over_document([("doc.pdf", doc)], _controls(4, mandatory=()), controls_per_call=2,
                                                     concurrency=2, allow_partial=allow_partial))
        assert res.ok is True, res.error
        run = res.data
        assert set(run.verdicts) == {"C1", "C3", "C4"}, (allow_partial, set(run.verdicts))
        c1 = run.verdicts["C1"]
        assert c1.verdict == "implemented" and c1.evidence[0].located and c1.evidence[0].quote == DOC_A_SENTENCE
        assert run.verdicts["C3"].verdict == "not_implemented" and run.verdicts["C4"].verdict == "not_implemented"
        assert run.missing_ids == ["C2"]
        assert run.failures == []                       # the batch itself never hard-failed
        assert any("follow-up for controls C1" in w and "timeout" in w for w in run.warnings)
        assert {x["item"]["control_id"] for x in res.invalid_items} == {"C2"}
        assert all(x["errors"] == "analysis_failed: no valid verdict returned" for x in res.invalid_items)


def test_t6d_guard_and_input_errors():
    calls = {"n": 0}

    async def fake(messages, schema, **kw):
        calls["n"] += 1
        raise AssertionError("must not be called")

    big = " ".join("token%d" % i for i in range(3000))              # ~20k chars -> 5+ chunks at 1000 tokens
    with _Patched(fake):
        res = _run(assess_controls_over_document([("big.pdf", big)], _controls(25, mandatory=()), chunk_tokens=1000,
                                                 controls_per_call=10, max_calls=2))
        assert res.ok is False and "too large" in res.error and res.kind == "input"
        assert res.data is None and calls["n"] == 0
        assert not _run(assess_controls_over_document([("a", "   "), ("b", "")], _controls(2))).ok
        assert "No extractable text" in _run(assess_controls_over_document([], _controls(2))).error
        assert "No controls" in _run(assess_controls_over_document([("a", "text " * 50)], [])).error
        dup = _run(assess_controls_over_document([("a", "text " * 50)], _controls(2) + _controls(1)))
        assert not dup.ok and "Duplicate" in dup.error and "C1" in dup.error
        assert calls["n"] == 0


def test_t6e_multi_small_documents_direct():
    """Several small documents that fit one chunk together are judged directly (no locator pass)."""
    seen = []

    async def fake(messages, schema, **kw):
        seen.append(messages[1]["content"])
        return _ok({"results": [{"control_id": "C1", "verdict": "implemented", "confidence": 0.9,
                                 "evidence": [{"source": "policy.pdf", "quote": DOC_A_REVIEW}], "explanation": "ok"},
                                {"control_id": "C2", "verdict": "implemented", "confidence": 0.9,
                                 "evidence": [{"source": "wrong-name.pdf", "quote": DOC_A_SENTENCE}], "explanation": "ok"}]})

    with _Patched(fake):
        res = _run(assess_controls_over_document([("policy.pdf", DOC_A_REVIEW + " " + "filler text. " * 40),
                                                  ("standard.docx", DOC_A_SENTENCE + " " + "other text. " * 40)],
                                                 _controls(2, mandatory=())))
    assert res.ok and res.data.mode == "direct" and res.data.calls == 1
    assert "=== DOCUMENT: policy.pdf ===" in seen[0] and "=== DOCUMENT: standard.docx ===" in seen[0]
    assert res.data.verdicts["C2"].evidence[0].source == "standard.docx"       # garbled name re-assigned by verification
    assert res.data.verdicts["C1"].evidence[0].source == "policy.pdf"


def test_t6f_duplicate_document_names_do_not_shadow_each_other():
    """compliance.py names every assessment upload "<framework>_document_<date><ext>", so two PDFs
    uploaded the same day share a name (and '' is the documented 'unknown source'); each must keep
    its own quote index and citation — a shadowed document turned every correct verdict quoted
    from it into a false gap."""
    doc1 = "First policy. " + DOC_A_SENTENCE + " " + "filler text one. " * 40
    doc2 = "Second policy. " + DOC_A_REVIEW + " " + "filler text two. " * 40
    for names in (("policy.pdf", "policy.pdf"), ("", "")):
        seen = []

        async def fake(messages, schema, **kw):
            seen.append(messages[1]["content"])
            src = names[0]
            return _ok({"results": [{"control_id": "C1", "verdict": "implemented", "confidence": 0.9,
                                     "evidence": [{"source": src, "quote": DOC_A_SENTENCE}], "explanation": "ok"},
                                    {"control_id": "C2", "verdict": "implemented", "confidence": 0.9,
                                     "evidence": [{"source": src, "quote": DOC_A_REVIEW}], "explanation": "ok"}]})

        with _Patched(fake):
            res = _run(assess_controls_over_document([(names[0], doc1), (names[1], doc2)], _controls(2, mandatory=())))
        assert res.ok and res.data.mode == "direct", res.error
        v1, v2 = res.data.verdicts["C1"], res.data.verdicts["C2"]
        assert v1.verdict == "implemented" and v1.evidence[0].located and v1.warnings == []
        assert v2.verdict == "implemented" and v2.evidence[0].located and v2.warnings == [], v2.warnings   # was a false gap
        second = (names[1] or "document") + " (2)"
        assert v1.evidence[0].source == names[0] and v2.evidence[0].source == second
        assert "=== DOCUMENT: %s ===" % second in seen[0] and any("disambiguated" in w for w in res.data.warnings)
    # locate mode: chunks of same-named documents carry distinct sources and packets cite them
    big = _big_docs()
    docs = [("same.pdf", big[0][1]), ("same.pdf", big[1][1]), ("same.pdf", big[2][1])]
    prompts = []

    async def fake2(messages, schema, **kw):
        system, user = messages[0]["content"], messages[1]["content"]
        prompts.append(user)
        if system == LOCATE_SYSTEM_PROMPT:
            if 'Document: "same.pdf" — excerpt 1 of 2' in user:
                return _ok({"matches": [{"control_id": "C1", "quotes": [DOC_A_SENTENCE], "note": "n"}]})
            return _ok({"matches": []})
        return _ok({"results": [{"control_id": cid, "verdict": "implemented" if cid == "C1" else "insufficient_evidence",
                                 "confidence": 0.8 if cid == "C1" else 0.1,
                                 "evidence": [{"source": "same.pdf", "quote": DOC_A_SENTENCE}] if cid == "C1" else [],
                                 "explanation": "x"} for cid in _asked(user)]})

    with _Patched(fake2):
        res = _run(assess_controls_over_document(docs, _controls(2, mandatory=()), chunk_tokens=3000))
    assert res.ok and res.data.mode == "locate_then_judge", res.error
    assert any('Document: "same.pdf (2)" — excerpt' in p for p in prompts) and any('Document: "same.pdf (3)" — excerpt' in p for p in prompts)
    assert res.data.verdicts["C1"].verdict == "implemented" and res.data.verdicts["C1"].evidence[0].source == "same.pdf"
    assert "(same.pdf, part 1 of 2)" in _block([p for p in prompts if "EVIDENCE PACKET" in p][0], "C1")
    # pure helper: the first keeps its name, later duplicates are numbered, generated names never collide
    renamed, notes = C._unique_doc_names([("a.pdf", "1"), ("a.pdf", "2"), ("a.pdf (2)", "3"), ("a.pdf", "4"), ("", "5"), ("", "6")])
    assert [n for n, _ in renamed] == ["a.pdf", "a.pdf (2)", "a.pdf (2) (2)", "a.pdf (3)", "", "document (2)"]
    assert len(set(n for n, _ in renamed)) == 6 and len(notes) == 4 and C._unique_doc_names([]) == ([], [])


def test_t6g_locator_control_list_is_sliced_by_the_context_budget():
    """A long control list is never sent whole next to a chunk (on a num_ctx-honouring model the
    part silently dropped would be the system prompt with the retrieval rules): it is sliced by
    input_budget() — every slice is one locator call, all counted by the job-size guard."""
    docs = _big_docs()
    controls = [ControlSpec("C%d" % i, "Control number %d" % i, ("Requirement text for control %d. " % i) * 6)
                for i in range(1, 61)]
    seen = []

    async def fake(messages, schema, **kw):
        system, user = messages[0]["content"], messages[1]["content"]
        seen.append((system, user))
        if system == LOCATE_SYSTEM_PROMPT:
            return _ok({"matches": []})
        return _ok({"results": [{"control_id": cid, "verdict": "insufficient_evidence", "confidence": 0.1, "evidence": [],
                                 "explanation": "n"} for cid in _asked(user)]})

    real = C._num_ctx
    C._num_ctx = lambda: 9000
    try:
        with _Patched(fake):
            res = _run(assess_controls_over_document(docs, controls, chunk_tokens=1500, controls_per_call=10, max_calls=200))
            assert res.ok, res.error
            run = res.data
            locate_calls = [(s, u) for s, u in seen if s == LOCATE_SYSTEM_PROMPT]
            judge_calls = [(s, u) for s, u in seen if s != LOCATE_SYSTEM_PROMPT]
            assert len(locate_calls) > run.chunks and run.calls == len(seen) == len(locate_calls) + len(judge_calls)
            per_chunk: dict = {}
            for s, u in locate_calls:
                head = u.split("\n\nCONTROL LIST")[0]
                n = int(re.search(r"CONTROL LIST \((\d+) controls", u).group(1))
                assert 0 < n <= 60                                            # a short tail chunk may fit the whole list
                ids = re.findall(r"^\[(C\d+)\]", u.split("CONTROL LIST")[1], re.M)
                assert len(ids) == n
                per_chunk.setdefault(head, []).extend(ids)
                assert estimate_tokens(s) + estimate_tokens(u) <= 9000 - 4096 + 128, estimate_tokens(s) + estimate_tokens(u)
            assert len(per_chunk) == run.chunks
            for ids in per_chunk.values():
                assert ids == ["C%d" % i for i in range(1, 61)]                     # slices cover the whole list, in order
            assert run.missing_ids == [] and len(run.verdicts) == 60
            # every judge call carries the same system prompt / all controls once
            assert sorted(sum((_asked(u) for _, u in judge_calls), [])) == sorted(c.control_id for c in controls)
            # the job-size guard counts the locator slices
            seen.clear()
            res = _run(assess_controls_over_document(docs, controls, chunk_tokens=1500, controls_per_call=10, max_calls=run.chunks + 6))
            assert res.ok is False and "too large" in res.error and res.kind == "input" and seen == []
    finally:
        C._num_ctx = real


def test_t6h_context_window_too_small_fails_honestly():
    calls = {"n": 0}

    async def fake(messages, schema, **kw):
        calls["n"] += 1
        raise AssertionError("must not be called")

    real = C._num_ctx
    C._num_ctx = lambda: 6000
    try:
        with _Patched(fake):
            res = _run(assess_controls_over_document(_big_docs(), _controls(3, mandatory=()), chunk_tokens=3000))
            single = "word " * 1800                                            # ~2250 tokens: one chunk, but no room next to it
            small = _run(assess_controls_over_document([("a.pdf", single)], _controls(3, mandatory=()), chunk_tokens=3000))
    finally:
        C._num_ctx = real
    assert res.ok is False and res.kind == "input" and "context window" in res.error and calls["n"] == 0
    assert small.ok is False and small.kind == "input" and "context window" in small.error and calls["n"] == 0
    assert input_budget(9000, "x" * 4000, "y" * 4000) == 9000 - 4096 - 2000


# ---------------------------------------------------------------------------
# Remaining public surface
# ---------------------------------------------------------------------------

def test_normalize_verdict_aliases():
    resolve = build_id_resolver(["A.5.18", "A.8.7"])
    v = normalize_verdict({"id": "[a.5.18]", "status": "Not Covered", "confidence": "high", "justification": "why",
                           "evidence_quote": "some quoted passage here", "remediation": ["Do this", "", "Then that"],
                           "gap_severity": "High"}, resolve)
    assert v.control_id == "A.5.18" and v.verdict == "not_implemented" and v.confidence == 0.85
    assert v.rationale == "why" and v.evidence == [EvidenceQuote("", "some quoted passage here", "", False)]
    assert v.remediation == "1. Do this\n2. Then that" and v.gap_severity == "high" and v.warnings == []
    assert normalize_verdict({"control_id": "A.8.7", "verdict": "compliant", "confidence": 80}, resolve).confidence == 0.8
    assert normalize_verdict({"control_id": "A.8.7", "verdict": "N/A", "confidence": "0.4"}, resolve).verdict == "not_applicable"
    assert normalize_verdict({"control_id": "A.8.7", "verdict": "partially compliant"}, resolve).verdict == "partially_implemented"
    missing = normalize_verdict({"control_id": "A.8.7", "verdict": "unknown"}, resolve)
    assert missing.verdict == "insufficient_evidence" and missing.confidence == 0.5 and missing.warnings == ["confidence missing"]
    assert normalize_verdict({"control_id": "A.9.9", "verdict": "implemented"}, resolve) is None       # never invents ids
    assert normalize_verdict({"control_id": "A.8.7", "verdict": "maybe"}, resolve) is None             # unknown verdict
    assert normalize_verdict("garbage", resolve) is None
    strings = normalize_verdict({"control_id": "A.8.7", "verdict": "implemented", "confidence": 1,
                                 "quotes": ["first quote text", {"quote": "second", "source": "s"}]}, resolve)
    assert [(e.quote, e.source, e.located) for e in strings.evidence] == [("first quote text", "", False), ("second", "s", False)]


def test_verify_verdict_rules():
    sources = {"doc.pdf": SourceIndex("Section 1. " + DOC_A_SENTENCE + " Trailing text.")}
    v = ControlVerdict("C1", "implemented", 0.9, evidence=[EvidenceQuote("", DOC_A_SENTENCE, "", False),
                                                          EvidenceQuote("doc.pdf", "not in the document at all", "", False)],
                       gap_description="x", gap_severity="high", remediation="y")
    verify_verdict(v, sources)
    assert v.verdict == "implemented" and len(v.evidence) == 1 and v.evidence[0].located and v.evidence[0].source == "doc.pdf"
    assert v.gap_description is None and v.gap_severity is None and v.remediation is None
    assert len(v.warnings) == 1 and v.warnings[0].startswith("dropped unlocatable quote")
    na = ControlVerdict("C2", "not_applicable", 0.9, not_applicable_justification="stated exclusion")
    verify_verdict(na, {"doc.pdf": "plain text is indexed on the fly"}, control=ControlSpec("C2", "t", is_mandatory=True))
    assert na.verdict == "insufficient_evidence" and na.confidence == 0.2 and any("mandatory" in w for w in na.warnings)
    na2 = ControlVerdict("C2", "not_applicable", 0.9)
    verify_verdict(na2, sources, control=ControlSpec("C2", "t"))
    assert na2.verdict == "insufficient_evidence"
    na3 = ControlVerdict("C2", "not_applicable", 0.9, not_applicable_justification="No in-house software development.")
    verify_verdict(na3, sources, control=ControlSpec("C2", "t"))
    assert na3.verdict == "not_applicable" and na3.confidence == 0.9
    gap = ControlVerdict("C3", "not_implemented", 1.7, gap_severity="urgent")
    verify_verdict(gap, sources)
    assert gap.verdict == "not_implemented" and gap.confidence == 1.0 and gap.gap_severity is None
    ins = ControlVerdict("C4", "insufficient_evidence", 0.9)
    verify_verdict(ins, sources)
    assert ins.confidence == 0.2


def test_merge_verdicts_precedence():
    a = ControlVerdict("X", "insufficient_evidence", 0.1, rationale="nothing", warnings=["w1"])
    b = ControlVerdict("X", "partially_implemented", 0.6, rationale="some", evidence=[EvidenceQuote("d1", "quote one here", "part 1 of 3")],
                       gap_description="gap", gap_severity="medium", remediation="fix")
    c = ControlVerdict("X", "implemented", 0.7, rationale="full", evidence=[EvidenceQuote("d2", "quote two here", "part 2 of 3")], warnings=["w1", "w2"])
    d = ControlVerdict("X", "implemented", 0.5, rationale="full again", evidence=[EvidenceQuote("d2", "Quote  two here", "part 3 of 3")])
    e = ControlVerdict("X", "not_implemented", 0.95, rationale="absent")
    merged = merge_verdicts([a, b, c, d, e])
    assert merged.verdict == "implemented" and merged.confidence == 0.7 and merged.control_id == "X"
    assert [q.quote for q in merged.evidence] == ["quote one here", "quote two here"]     # concatenated, de-duplicated, input order
    assert merged.rationale == "full | full again" and merged.warnings == ["w1", "w2"]
    assert merged.gap_description is None and merged.remediation is None
    assert merge_verdicts([a, b]).verdict == "partially_implemented" and merge_verdicts([a, b]).gap_description == "gap"
    assert merge_verdicts([a, e]).verdict == "not_implemented"
    assert merge_verdicts([]) is None and merge_verdicts([None]) is None
    try:
        merge_verdicts([a, ControlVerdict("Y", "implemented", 0.5)])
        raise AssertionError("expected ValueError")
    except ValueError:
        pass
    assert merge_verdicts([a, b, c, d, e]) == merge_verdicts([a, b, c, d, e])                # deterministic


def test_render_and_fence():
    class Cat:
        value = "organizational"

    class Row:
        control_id, title, description, guidance, category, is_mandatory = "A.5.18", "Access rights", "Desc", "Guide", Cat(), True

    class Req:
        requirement_level, requirement_text = "must", "Access rights are reviewed."

    spec = control_spec_from_model(Row(), [Req(), ("should", "Removed at termination."), ("", "")])
    assert spec == ControlSpec("A.5.18", "Access rights", "Desc", "Guide", "organizational", True,
                               [("must", "Access rights are reviewed."), ("should", "Removed at termination.")])
    assert control_spec_from_model({"control_id": "X", "title": "T"}).control_id == "X"
    block = render_control_block(spec, mode="direct")
    assert block.startswith("### [A.5.18] Access rights\nCategory: organizational | Mandatory in this framework: yes\nRequirement: Desc\nGuidance: Guide\nStatements: (must) Access rights are reviewed.; (should) Removed at termination.")
    assert "EVIDENCE PACKET" not in block
    empty = render_control_block(ControlSpec("B", "t"), mode="packet", doc_count=3)
    assert "Requirement: (no description in the framework" in empty and "none located in any of the 3 document(s)" in empty
    packet = render_control_block(spec, [EvidenceQuote("p.pdf", "a quote <<<with markers>>>", "pages 2-3")], mode="packet")
    assert "EVIDENCE PACKET (1 verified quotes):\n<<<BEGIN EVIDENCE [A.5.18]>>>\n- (p.pdf, pages 2-3) \"a quote ‹‹‹with markers›››\"\n<<<END EVIDENCE [A.5.18]>>>" in packet
    text = "x" * 20_000
    fenced = C._fence(text, "DOCUMENT TEXT")
    assert fenced.count("x") == 20_000 and "<<<BEGIN UNTRUSTED DOCUMENT TEXT>>>" in fenced and "<<<END UNTRUSTED DOCUMENT TEXT>>>" in fenced
    assert "‹‹‹" in C._fence("a <<<BEGIN UNTRUSTED X>>> b", "D") and "<<<BEGIN UNTRUSTED X>>>" not in C._fence("a <<<BEGIN UNTRUSTED X>>> b", "D")[40:]
    chunk = Chunk("d.pdf", 1, 1, "body text", 0, 9, "full text")
    fu = render_followup_user([spec], chunk=chunk, doc_names=["d.pdf"], n_total=5)
    assert fu.startswith("Your previous answer did not contain a valid result for the following 1 control(s).")
    assert "CONTROLS TO ASSESS (1 of 5)" in fu and "<<<BEGIN UNTRUSTED DOCUMENT TEXT>>>" in fu
    fp = render_followup_user([spec], packets={}, doc_names=["d.pdf"], n_total=5)
    assert "none located in any of the 1 document(s)" in fp and "exactly 1 results" in fp


def test_import_purity():
    code = ("import socket, sys\n"
            "def deny(*a, **k): raise AssertionError('network at import time')\n"
            "socket.socket.connect = deny\n"
            "import sqlite3\n"
            "sqlite3.connect = deny\n"
            "import app.services.ai_chunking as m\n"
            "assert m.ai_structured is not None and m.normalize_control_id('[a.1]') == 'A.1'\n"
            "print('pure')\n")
    out = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True,
                         cwd=os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
    assert out.returncode == 0 and "pure" in out.stdout, out.stderr[-2000:]


def main() -> int:
    logging.getLogger("app.services.ai_chunking").setLevel(logging.ERROR)   # expected WARNINGs from the failure cases
    cases = [(n, f) for n, f in sorted(globals().items()) if n.startswith("test_") and callable(f)]
    failed = 0
    for name, fn in cases:
        try:
            fn()
            print("PASS", name)
        except Exception:  # noqa: BLE001
            failed += 1
            print("FAIL", name)
            traceback.print_exc()
    print("%d/%d passed" % (len(cases) - failed, len(cases)))
    if failed:
        print("SELFTEST FAILED")
        return 1
    print("ALL AI_CHUNKING FOUNDATION TESTS PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
