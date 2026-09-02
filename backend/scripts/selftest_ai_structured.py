"""Self-test for app.services.ai_structured (component B of the AI foundation).

Pure Python: no database, no network, no pytest. Every model call goes through the
``call_fn`` seam (an async stub), so the retry-with-error-feedback path is deterministic.
Cases T1-T6 are the spec's mandated tests (foundation_spec_final.md, component B, section 6);
the rest cover the remaining public surface, the exception-classification table and the
"never raises for model problems" guarantee.

Usage (from the repo root or from backend/):
    venv/bin/python backend/scripts/selftest_ai_structured.py

Prints PASS/FAIL per case and exits non-zero on any failure.
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
import traceback
from typing import Literal, Optional

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

import httpx  # noqa: E402
from pydantic import BaseModel, ConfigDict, Field  # noqa: E402

from app.services import ai_provider  # noqa: E402
from app.services import ai_structured as S  # noqa: E402
from app.services.ai_structured import (  # noqa: E402
    REPAIR_PROMPT, AiResult, AiStructuredError, JsonExtractError, ai_structured, ai_structured_sync,
    classify_exception, coerce_shape, extract_json, looks_truncated, normalize_enums, schema_hint,
    validate_against,
)


class Verdict(BaseModel):
    model_config = ConfigDict(extra="ignore", str_strip_whitespace=True)
    control_id: str
    verdict: Literal["implemented", "partially_implemented", "not_implemented", "insufficient_evidence", "not_applicable"]
    confidence: float = Field(ge=0, le=1)


class Batch(BaseModel):
    results: list[Verdict]


DICT_SCHEMA = {"type": "object", "required": ["risk_level", "score"], "additionalProperties": False,
               "properties": {"risk_level": {"type": "string", "enum": ["low", "medium", "high", "critical"]},
                              "score": {"type": "number", "minimum": 1, "maximum": 10},
                              "notes": {"type": ["string", "null"]}}}

U = [{"role": "user", "content": "U"}]


def _run(coro):
    return asyncio.run(coro)


def _raises(exc_type, fn):
    try:
        fn()
    except exc_type as e:
        return e
    raise AssertionError("expected %s" % exc_type.__name__)


# --- Spec-mandated cases (component B, section 6) -----------------------------

def test_t1_extract_json():
    assert extract_json('Sure! ```json\n{"a": 1}\n```\nHope this helps.') == {"a": 1}
    assert extract_json('<think>{"draft": 0}</think>\nSee {note} below: [1, 2, 3] trailing text') == [1, 2, 3]
    assert extract_json('{"a": {"b": [1, 2]}} and then some prose {') == {"a": {"b": [1, 2]}}
    e = _raises(JsonExtractError, lambda: extract_json('{"results": [{"control_id": "A.5.1", "verd'))
    assert e.truncated is True
    e = _raises(JsonExtractError, lambda: extract_json("no json here"))
    assert e.truncated is False


def test_t2_validate_against_dict():
    ok, err, data = validate_against({"risk_level": "High", "score": "7.5", "extra": 1}, DICT_SCHEMA)
    assert ok and err is None and data == {"risk_level": "high", "score": 7.5}
    ok, err, data = validate_against({"score": 11}, DICT_SCHEMA)
    assert not ok and data is None and "risk_level" in err and "score" in err and err.startswith("- ")


def test_t3_coerce_shape_and_pydantic():
    assert coerce_shape([{"control_id": "A.5.1"}], Batch) == {"results": [{"control_id": "A.5.1"}]}
    assert coerce_shape({"results": [1, 2]}, {"type": "array", "items": {"type": "integer"}}) == [1, 2]
    ok, _, data = validate_against(
        {"results": [{"control_id": "A.5.1", "verdict": "Partially Implemented", "confidence": "0.8"}]}, Batch)
    assert ok and data.results[0].verdict == "partially_implemented" and data.results[0].confidence == 0.8


def test_t4_repair_round():
    calls = []

    async def fake(messages, **kw):
        calls.append(messages)
        if len(calls) == 1:
            return '{"results": [{"control_id": "A.5.1", "verdict": "compliant", "confidence": 0.9}]}'
        return '{"results": [{"control_id": "A.5.1", "verdict": "implemented", "confidence": 0.9}]}'

    res = _run(ai_structured([{"role": "system", "content": "SYS"}, {"role": "user", "content": "U"}], Batch, call_fn=fake))
    assert res.ok and res.attempts == 2 and res.kind is None and res.data.results[0].verdict == "implemented"
    assert calls[0][0]["role"] == "system" and "OUTPUT FORMAT" in calls[0][0]["content"] and calls[0][0]["content"].startswith("SYS")
    assert calls[1][-2]["role"] == "assistant" and '"compliant"' in calls[1][-2]["content"]
    assert calls[1][-1]["role"] == "user" and "results.0.verdict" in calls[1][-1]["content"]
    assert REPAIR_PROMPT.split("{errors}")[0] in calls[1][-1]["content"]
    assert "format\":" not in json.dumps(calls[0])  # no server-side schema object; kw json_mode is what E receives


def test_t5_never_raises():
    async def boom(messages, **kw):
        raise httpx.ReadTimeout("http://secret-host/api/chat")

    res = _run(ai_structured(U, DICT_SCHEMA, call_fn=boom))
    assert res.ok is False and res.kind == "timeout" and res.attempts == 1 and res.data is None
    assert "secret-host" not in (res.error or "")

    async def junk(messages, **kw):
        return "I cannot produce that."

    res = _run(ai_structured(U, DICT_SCHEMA, call_fn=junk))
    assert res.ok is False and res.kind == "malformed" and res.attempts == 2 and res.raw == "I cannot produce that."
    assert res.failure_detail().startswith("malformed: ")
    e = _raises(Exception, res.unwrap)
    assert type(e).__name__ == "AiStructuredError"

    async def empty(messages, **kw):
        return ""

    res = _run(ai_structured(U, DICT_SCHEMA, call_fn=empty, retries=0))
    assert res.ok is False and res.kind == "empty" and res.attempts == 1


def test_t6_partial_and_check():
    bad = ('{"results": [{"control_id": "A.5.1", "verdict": "implemented", "confidence": 0.9}, '
           '{"control_id": "A.5.2", "verdict": "maybe", "confidence": 5}, '
           '{"control_id": "A.5.3", "verdict": "not_implemented", "confidence": 0.7}]}')

    async def always_bad(messages, **kw):
        return bad

    res = _run(ai_structured(U, Batch, call_fn=always_bad, partial_items="results"))
    assert res.ok and res.partial and res.attempts == 2 and isinstance(res.data, Batch)
    assert [v.control_id for v in res.data.results] == ["A.5.1", "A.5.3"] and res.invalid_items[0]["index"] == 1

    seen = []

    async def good(messages, **kw):
        seen.append(messages)
        return '{"results": [{"control_id": "A.5.1", "verdict": "implemented", "confidence": 0.9}]}'

    res = _run(ai_structured(U, Batch, call_fn=good, check=lambda b: ["missing verdict for A.5.2"]))
    assert res.ok is False and res.kind == "validation" and res.attempts == 2
    assert "missing verdict for A.5.2" in seen[1][-1]["content"]
    assert res.validation_errors == ["- missing verdict for A.5.2"]


# --- Interface contract -----------------------------------------------------------

def test_interface_summary():
    assert S.FAILURE_KINDS == ("transport", "timeout", "provider", "empty", "truncated", "malformed", "validation", "input")
    assert S.LOCALE_KIND == {"transport": "unreachable", "timeout": "timeout", "provider": "error", "empty": "empty",
                             "truncated": "truncated", "malformed": "invalid_output", "validation": "invalid_output",
                             "input": "invalid_output"}
    assert S.MAX_REPLAY_CHARS == 12_000 and S.MAX_ERROR_LINES == 12 and S.NUM_PREDICT_CAP == 32_768
    assert S.WRAPPER_KEYS[0] == "results" and "{errors}" in REPAIR_PROMPT and "{kind}" in REPAIR_PROMPT
    assert "{kind}" in S.SCHEMA_HINT_HEADER and S.SCHEMA_HINT_HEADER.startswith("OUTPUT FORMAT (mandatory)")
    assert issubclass(JsonExtractError, ValueError) and issubclass(AiStructuredError, RuntimeError)
    for name in ("extract_json", "looks_truncated", "json_schema_of", "schema_hint", "coerce_shape", "normalize_enums",
                 "validate_against", "format_validation_error", "classify_exception", "ai_structured",
                 "ai_structured_sync", "AiResult", "AiStructuredError", "JsonExtractError"):
        assert name in S.__all__ and hasattr(S, name), name
    r = AiResult(ok=True, data={"a": 1}, error=None, raw="{}", attempts=1, model="m")
    assert r.kind is None and r.validation_errors == [] and r.partial is False and r.invalid_items == []
    assert r.unwrap() == {"a": 1} and r.failure_detail() == "" and r.user_message("fr") == ""
    # "input" kind is reserved for callers (component C): a hand-built result round-trips through the helpers
    r = AiResult(ok=False, data=None, error="No controls to assess.", raw=None, attempts=0, model="m", kind="input")
    assert r.failure_detail() == "input: No controls to assess." and r.user_message("en")
    e = _raises(AiStructuredError, r.unwrap)
    assert e.result is r and e.kind == "input" and str(e).startswith("input: ")


def test_extract_json_more_shapes():
    assert extract_json('```\n[{"x": "a } b"}, {"y": "[not json]"}]\n```') == [{"x": "a } b"}, {"y": "[not json]"}]
    assert extract_json('```json\n{"a": "b"}') == {"a": "b"}                       # unclosed fence
    assert extract_json('{"k": "va\\"l{ue"} trailing') == {"k": 'va"l{ue'}          # escaped quote + brace in string
    assert extract_json('Result:\n\n{"a": 1}\n\nDone.') == {"a": 1}
    assert extract_json('```text\nquoted words\n```\n{"a": 2}') == {"a": 2}          # non-JSON fence, JSON outside
    assert extract_json("  [ ]  ") == [] and extract_json("42") == 42
    e = _raises(JsonExtractError, lambda: extract_json('<think>partial {"a":'))      # unclosed <think>, cut fragment
    assert e.truncated is False                                                      # bracket is not at a line start
    e = _raises(JsonExtractError, lambda: extract_json("   "))
    assert e.truncated is False and "empty" in str(e)
    e = _raises(JsonExtractError, lambda: extract_json(None))
    assert e.truncated is False


def test_looks_truncated():
    assert looks_truncated('{"a": [1, 2') is True
    assert looks_truncated('```json\n{"a": "unterminated') is True
    assert looks_truncated('Here is the JSON:\n{"results": [{"control_id": "A.5.1"') is True
    assert looks_truncated('{"a": 1} trailing prose {') is False
    assert looks_truncated("no json here") is False and looks_truncated("") is False
    assert looks_truncated('See {note} below: [1, 2, 3]') is False
    assert looks_truncated('{"s": "a }] b"}') is False                              # brackets inside strings ignored


def test_json_schema_of_and_hint():
    class Doc(BaseModel):
        title: str
        level: Literal["low", "high"]

    js = S.json_schema_of(Doc)
    assert js["properties"]["title"]["type"] == "string" and S.json_schema_of(DICT_SCHEMA) is DICT_SCHEMA
    assert S.json_schema_of(list[Doc])["type"] == "array"
    for bad in ("notaschema", None, 42, [1]):
        _raises(TypeError, lambda b=bad: S.json_schema_of(b))
    hint = schema_hint(Doc)
    assert hint == schema_hint(Doc) and hint.startswith(S.SCHEMA_HINT_HEADER.format(kind="object"))
    body = json.loads(hint[len(S.SCHEMA_HINT_HEADER.format(kind="object")):])
    assert "title" not in body and "title" in body["properties"]                    # pydantic noise gone, field kept
    assert body["properties"]["level"]["enum"] == ["low", "high"]
    assert schema_hint({"type": "array", "items": {"type": "string"}}).startswith("OUTPUT FORMAT (mandatory)\nReply with ONLY one JSON array")
    assert "\n" not in hint[len(S.SCHEMA_HINT_HEADER.format(kind="object")):]       # compact JSON


def test_inject_hint():
    hint = schema_hint(DICT_SCHEMA)
    msgs = [{"role": "system", "content": "SYS"}, {"role": "user", "content": "U"}]
    out = S._inject_hint(msgs, hint)
    assert out[0]["content"] == "SYS\n\n" + hint and msgs[0]["content"] == "SYS"    # caller's list untouched
    again = S._inject_hint(out, hint)
    assert again[0]["content"] == out[0]["content"] and len(again) == 2              # never injected twice
    out = S._inject_hint([{"role": "user", "content": "U"}], hint)
    assert out[0] == {"role": "system", "content": hint} and out[1]["role"] == "user"
    assert sum(1 for m in out if m["role"] == "system") == 1


def test_coerce_shape_more():
    assert coerce_shape({"analysis": {"risk_level": "low", "score": 2}}, DICT_SCHEMA) == {"risk_level": "low", "score": 2}
    assert coerce_shape({"controls": [{"control_id": "A"}]}, Batch) == {"results": [{"control_id": "A"}]}
    assert coerce_shape({"wrapper": {"unrelated": 1}}, DICT_SCHEMA) == {"wrapper": {"unrelated": 1}}   # no shared key: untouched
    assert coerce_shape({"risk_level": "low", "score": 2}, DICT_SCHEMA) == {"risk_level": "low", "score": 2}
    assert coerce_shape({"meta": "x", "results": [1], "other": [2]}, {"type": "array"}) == [1]   # WRAPPER_KEYS order
    assert coerce_shape({"a": 1}, {"type": "array"}) == {"a": 1}
    assert coerce_shape([1, 2], {"type": "object", "properties": {"a": {"type": "array"}, "b": {"type": "array"}}}) == [1, 2]
    assert coerce_shape({"x": {"y": 1}}, {"type": "object"}) == {"x": {"y": 1}}      # free-form object never unwrapped
    assert coerce_shape("scalar", Batch) == "scalar"


def test_normalize_enums():
    js = S.json_schema_of(Batch)
    data = {"results": [{"control_id": "A", "verdict": "NOT-IMPLEMENTED", "confidence": 1},
                        {"control_id": "B", "verdict": " Not Applicable ", "confidence": 1},
                        {"control_id": "C", "verdict": "unknown", "confidence": 1}]}
    out = normalize_enums(data, js)
    assert [r["verdict"] for r in out["results"]] == ["not_implemented", "not_applicable", "unknown"]
    assert data["results"][0]["verdict"] == "NOT-IMPLEMENTED"                       # input not mutated
    amb = {"type": "object", "properties": {"v": {"type": "string", "enum": ["a_b", "a-b"]}}}
    assert normalize_enums({"v": "A B"}, amb) == {"v": "A B"}                        # ambiguous: untouched
    opt = {"type": "object", "properties": {"v": {"anyOf": [{"type": "string", "enum": ["low", "high"]}, {"type": "null"}]}}}
    assert normalize_enums({"v": "Low"}, opt) == {"v": "low"} and normalize_enums({"v": None}, opt) == {"v": None}
    assert normalize_enums("Low", {"type": "string", "enum": ["low"]}) == "low"
    assert normalize_enums(["High"], {"type": "array", "items": {"$ref": "#/$defs/L"}, "$defs": {"L": {"enum": ["high"]}}}) == ["high"]
    assert normalize_enums(None, js) is None and normalize_enums({"v": 1}, "not a schema") == {"v": 1}


def test_dict_validator_keywords():
    schema = {"$defs": {"Item": {"type": "object", "required": ["id"],
                                 "properties": {"id": {"type": "integer"},
                                                "tag": {"type": "string", "default": "none", "minLength": 2},
                                                "flag": {"type": "boolean"},
                                                "opt": {"anyOf": [{"type": "number", "exclusiveMaximum": 5}, {"type": "null"}]},
                                                "code": {"type": "string", "pattern": "^[A-Z]+$"}}}},
              "type": "object", "required": ["items"],
              "properties": {"items": {"type": "array", "items": {"$ref": "#/$defs/Item"}, "minItems": 1, "maxItems": 3},
                             "kind": {"const": "batch"}},
              "additionalProperties": {"type": "string"}}
    ok, err, data = validate_against({"items": [{"id": "7", "flag": "yes", "opt": "4.5", "code": "AB", "junk": 1}], "kind": "batch", "x": 5}, schema)
    assert ok, err
    assert data == {"items": [{"id": 7, "tag": "none", "flag": True, "opt": 4.5, "code": "AB", "junk": 1}], "kind": "batch", "x": "5"}
    ok, err, data = validate_against({"items": [{"id": 1.5, "tag": "x", "opt": 5, "code": "ab", "flag": 2}], "kind": "other"}, schema)
    assert not ok and data is None
    lines = err.splitlines()
    assert any(l.startswith("- items.0.id: Input should be a valid integer") for l in lines)
    assert any(l.startswith("- items.0.tag: String should have at least 2") for l in lines)
    assert any(l.startswith("- items.0.opt: Input should be less than 5") for l in lines)      # closest anyOf branch
    assert any(l.startswith("- items.0.code: String should match pattern") for l in lines)
    assert any(l.startswith("- items.0.flag: Input should be a valid boolean") for l in lines)
    assert any(l.startswith("- kind: Input should be 'batch'") for l in lines)
    ok, err, _ = validate_against({"items": []}, schema)
    assert not ok and "at least 1 item" in err
    ok, err, _ = validate_against({"items": [1, 2, 3, 4]}, schema)
    assert not ok and "at most 3 item" in err and "items.0: Input should be a valid object" in err
    ok, err, _ = validate_against([1], schema)
    assert not ok and err.startswith("- <root>: Input should be a valid object")
    ok, _, data = validate_against({"n": True}, {"type": "object", "properties": {"n": {"type": "number"}}})
    assert not ok                                                                   # bool is never a number
    ok, _, data = validate_against({"s": "  x  ", "z": "", "i": 3.0}, {"type": "object", "properties": {
        "s": {"type": "string"}, "z": {"type": ["string", "null"]}, "i": {"type": "integer"}}})
    assert ok and data == {"s": "x", "z": "", "i": 3}                                # exact type wins over null coercion
    ok, _, data = validate_against({"z": ""}, {"type": "object", "properties": {"z": {"type": "null"}}})
    assert ok and data == {"z": None}
    many = {"type": "object", "required": ["k%d" % i for i in range(20)], "properties": {}}
    ok, err, _ = validate_against({}, many)
    assert not ok and len(err.splitlines()) == 13 and err.splitlines()[-1] == "- (8 more)"


def test_pydantic_and_typing_validation():
    ok, err, data = validate_against([{"control_id": "A", "verdict": "Implemented", "confidence": "0.5"}], list[Verdict])
    assert ok and isinstance(data[0], Verdict) and data[0].verdict == "implemented"
    ok, err, data = validate_against({"results": [{"control_id": "A", "verdict": "bogus", "confidence": 2}]}, Batch)
    assert not ok and data is None
    lines = err.splitlines()
    assert lines[0].startswith("- results.0.verdict: Input should be 'implemented'") and "(got 'bogus')" in lines[0]
    assert any(l.startswith("- results.0.confidence: Input should be less than or equal to 1") for l in lines)
    ok, err, _ = validate_against({"results": [{"verdict": "implemented", "confidence": 0.1}]}, Batch)
    assert not ok and "- results.0.control_id: Field required" in err
    ok, err, _ = validate_against("nope", Batch)
    assert not ok and err.startswith("- <root>: ")
    ok, _, data = validate_against({"results": [{"control_id": "A", "verdict": "Implemented", "confidence": 0.5}]}, Batch, normalize=False)
    assert not ok                                                                   # normalisation can be switched off
    import pydantic
    try:
        Verdict.model_validate({"control_id": "A", "verdict": "x", "confidence": 3})
    except pydantic.ValidationError as exc:
        text = S.format_validation_error(exc, limit=1)
        assert text.splitlines()[0].startswith("- verdict: ") and text.splitlines()[-1] == "- (1 more)"


def test_classify_exception():
    assert classify_exception(ai_provider.AITimeout("The AI service did not answer within 120 seconds.")) == ("timeout", "The AI service did not answer within 120 seconds.")
    assert classify_exception(ai_provider.AIUnavailable("Cannot reach the configured AI service."))[0] == "transport"
    assert classify_exception(ai_provider.AIEmptyOutput("empty"))[0] == "empty"
    assert classify_exception(ai_provider.AITruncated("cut", raw="{"))[0] == "truncated"
    assert classify_exception(ai_provider.AIHTTPError("The AI service returned HTTP 502.", status_code=502)) == ("provider", "The AI service returned HTTP 502.")
    assert classify_exception(ai_provider.AIProtocolError("odd"))[0] == "provider"
    assert classify_exception(ai_provider.AIBadConfig("bad"))[0] == "provider"
    assert classify_exception(ai_provider.AIProviderError("Endpoint refused")) == ("provider", "Endpoint refused")
    assert classify_exception(asyncio.TimeoutError())[0] == "timeout" and classify_exception(TimeoutError())[0] == "timeout"
    assert classify_exception(httpx.ConnectTimeout("http://secret/x"))[0] == "timeout"
    assert classify_exception(httpx.ConnectError("http://secret/x")) == ("transport", "The AI service could not be reached.")
    assert classify_exception(ConnectionRefusedError())[0] == "transport"
    kind, msg = classify_exception(httpx.HTTPStatusError("http://secret-host/x", request=None, response=None))
    assert kind == "transport" and "secret-host" not in msg and "HTTPStatusError" in msg
    kind, msg = classify_exception(ValueError("http://secret-host/leak"))
    assert kind == "transport" and "secret-host" not in msg
    _raises(asyncio.CancelledError, lambda: classify_exception(asyncio.CancelledError()))
    _raises(KeyboardInterrupt, lambda: classify_exception(KeyboardInterrupt()))


def test_provider_exceptions_inside_loop():
    """E's typed errors: transport/provider kinds return immediately; empty/truncated are re-asked."""
    n = {"calls": 0}

    async def http_err(messages, **kw):
        n["calls"] += 1
        raise ai_provider.AIHTTPError("The AI service returned HTTP 502.", status_code=502)

    res = _run(ai_structured(U, DICT_SCHEMA, call_fn=http_err))
    assert res.ok is False and res.kind == "provider" and res.attempts == 1 and n["calls"] == 1 and res.raw is None
    assert res.failure_detail() == "provider: The AI service returned HTTP 502."

    seen = []

    async def empty_then_ok(messages, **kw):
        seen.append(messages)
        if len(seen) == 1:
            raise ai_provider.AIEmptyOutput("AI provider returned an empty answer.")
        return '{"risk_level": "low", "score": 3}'

    res = _run(ai_structured(U, DICT_SCHEMA, call_fn=empty_then_ok))
    assert res.ok and res.attempts == 2 and res.data == {"risk_level": "low", "score": 3}
    assert len(seen[1]) == len(seen[0]) and seen[1][-1]["role"] == "user"           # re-asked from base, no replay

    seen.clear()

    async def truncated_then_ok(messages, **kw):
        seen.append((messages, kw))
        if len(seen) == 1:
            raise ai_provider.AITruncated("cut", raw='{"risk_level": "lo')
        return '{"risk_level": "low", "score": 3}'

    res = _run(ai_structured(U, DICT_SCHEMA, call_fn=truncated_then_ok, num_predict=8192))
    assert res.ok and res.attempts == 2 and seen[1][1]["num_predict"] == 16384
    assert seen[1][0][-1]["role"] == "user" and all(m["role"] != "assistant" for m in seen[1][0])

    async def always_truncated(messages, **kw):
        raise ai_provider.AITruncated("cut", raw='{"risk_level": "lo')

    res = _run(ai_structured(U, DICT_SCHEMA, call_fn=always_truncated, retries=1))
    assert res.ok is False and res.kind == "truncated" and res.attempts == 2 and res.raw == '{"risk_level": "lo'
    assert res.user_message("fr").startswith("La réponse de l'IA a été tronquée") or "tronqu" in res.user_message("fr")


def test_truncated_reply_text_path():
    seen = []

    async def cut_then_ok(messages, **kw):
        seen.append((messages, dict(kw)))
        if len(seen) == 1:
            return '```json\n{"risk_level": "low", "score": [1, '
        return '{"risk_level": "low", "score": 3}'

    res = _run(ai_structured([{"role": "system", "content": "S"}] + U, DICT_SCHEMA, call_fn=cut_then_ok, num_predict=20000))
    assert res.ok and res.attempts == 2
    assert seen[1][1]["num_predict"] == S.NUM_PREDICT_CAP and len(seen[1][0]) == 2   # capped; base re-ask
    assert seen[0][1]["json_mode"] is True and seen[0][1]["temperature"] == 0.0     # explicit kwargs reach the call
    seen.clear()
    res = _run(ai_structured(U, DICT_SCHEMA, call_fn=cut_then_ok))
    assert res.ok and "num_predict" not in seen[1][1]                              # unset stays unset


def test_schema_in_prompt_variants():
    seen = []

    async def ok_call(messages, **kw):
        seen.append(messages)
        return '{"risk_level": "low", "score": 3}'

    msgs = [{"role": "system", "content": "SYS"}, {"role": "user", "content": "U"}]
    _run(ai_structured(msgs, DICT_SCHEMA, call_fn=ok_call, schema_in_prompt=False))
    assert seen[-1] == msgs and seen[-1] is not msgs
    _run(ai_structured(msgs, DICT_SCHEMA, call_fn=ok_call, schema_in_prompt="CUSTOM FORMAT TEXT"))
    assert seen[-1][0]["content"] == "SYS\n\nCUSTOM FORMAT TEXT"
    pre = [{"role": "system", "content": "SYS\n\n" + schema_hint(DICT_SCHEMA)}, {"role": "user", "content": "U"}]
    _run(ai_structured(pre, DICT_SCHEMA, call_fn=ok_call))
    assert seen[-1][0]["content"] == pre[0]["content"]                              # identical hint not duplicated
    _run(ai_structured(U, DICT_SCHEMA, call_fn=ok_call))
    assert seen[-1][0]["role"] == "system" and seen[-1][0]["content"].startswith("OUTPUT FORMAT") and len(seen[-1]) == 2
    assert msgs[0]["content"] == "SYS" and U == [{"role": "user", "content": "U"}]  # caller's messages never mutated


def test_result_fields_and_messages():
    async def ok_call(messages, **kw):
        return 'Here you go:\n```json\n{"risk_level": "Medium", "score": "4", "notes": null}\n```'

    res = _run(ai_structured(U, DICT_SCHEMA, call_fn=ok_call, model="custom-model", task="t"))
    assert res.ok and res.data == {"risk_level": "medium", "score": 4, "notes": None} and res.model == "custom-model"
    assert res.raw.startswith("Here you go") and res.error is None and res.validation_errors == []
    res2 = _run(ai_structured(U, DICT_SCHEMA, call_fn=ok_call))
    assert res2.model == ai_provider.env_ai_config().model

    async def bad(messages, **kw):
        return '{"risk_level": "extreme", "score": 99}'

    res = _run(ai_structured(U, DICT_SCHEMA, call_fn=bad))
    assert res.ok is False and res.kind == "validation" and res.attempts == 2 and res.data is None
    assert len(res.validation_errors) == 2 and res.validation_errors[0].startswith("- risk_level: Input should be 'low'")
    detail = res.failure_detail()
    assert detail.startswith("validation: The AI reply did not match the required format after 2 attempt(s).")
    assert res.validation_errors[0] in detail and res.validation_errors[1] in detail
    assert res.user_message("en") and res.user_message("fr") != res.user_message("en") and res.user_message("ar")
    assert res.user_message("xx") == res.user_message("en")
    e = _raises(AiStructuredError, res.unwrap)
    assert e.result is res and e.kind == "validation" and str(e) == detail


def test_check_semantics():
    seen = []

    async def ok_call(messages, **kw):
        seen.append(messages)
        return '{"risk_level": "low", "score": 3}'

    res = _run(ai_structured(U, DICT_SCHEMA, call_fn=ok_call, check=lambda d: []))
    assert res.ok and res.attempts == 1
    res = _run(ai_structured(U, DICT_SCHEMA, call_fn=ok_call, check=lambda d: None))
    assert res.ok and res.attempts == 1
    seen.clear()
    res = _run(ai_structured(U, DICT_SCHEMA, call_fn=ok_call, check=lambda d: "- score too low for low risk", retries=0))
    assert res.ok is False and res.kind == "validation" and res.attempts == 1
    assert res.validation_errors == ["- score too low for low risk"]                # already-prefixed line kept

    def broken(d):
        raise KeyError("oops")

    res = _run(ai_structured(U, DICT_SCHEMA, call_fn=ok_call, check=broken))         # never raises, never 500s
    assert res.ok is False and res.kind == "validation" and res.validation_errors == ["- consistency check failed (KeyError)"]


def test_partial_salvage_variants():
    bad_list = '[{"control_id": "A", "verdict": "implemented", "confidence": 0.9}, {"control_id": "B", "verdict": "??", "confidence": 0.1}]'

    async def bad_arr(messages, **kw):
        return bad_list

    res = _run(ai_structured(U, list[Verdict], call_fn=bad_arr, partial_items=""))
    assert res.ok and res.partial and isinstance(res.data, list) and isinstance(res.data[0], Verdict)
    assert [v.control_id for v in res.data] == ["A"] and res.invalid_items == [
        {"index": 1, "item": {"control_id": "B", "verdict": "??", "confidence": 0.1}, "errors": res.invalid_items[0]["errors"]}]
    assert res.invalid_items[0]["errors"].startswith("- verdict: ") and res.error == "1 item(s) failed validation and were dropped"
    assert res.kind is None and res.failure_detail() == "" and res.validation_errors and res.attempts == 2

    arr_schema = {"type": "array", "items": {"$ref": "#/$defs/V"},
                  "$defs": {"V": {"type": "object", "required": ["control_id", "verdict"], "additionalProperties": False,
                                  "properties": {"control_id": {"type": "string"}, "verdict": {"enum": ["implemented", "not_implemented"]}}}}}
    res = _run(ai_structured(U, arr_schema, call_fn=bad_arr, partial_items=""))
    assert res.ok and res.partial and res.data == [{"control_id": "A", "verdict": "implemented"}] and res.invalid_items[0]["index"] == 1

    obj_schema = {"type": "object", "required": ["results"], "properties": {"results": {"type": "array", "items": {"$ref": "#/$defs/V"}}},
                  "$defs": arr_schema["$defs"]}

    async def wrapped(messages, **kw):
        return '{"results": ' + bad_list + ', "extra": true}'

    res = _run(ai_structured(U, obj_schema, call_fn=wrapped, partial_items="results"))
    assert res.ok and res.partial and res.data == {"results": [{"control_id": "A", "verdict": "implemented"}], "extra": True}

    async def all_bad(messages, **kw):
        return '[{"control_id": "B", "verdict": "??", "confidence": 0.1}]'

    res = _run(ai_structured(U, list[Verdict], call_fn=all_bad, partial_items=""))
    assert res.ok is False and res.kind == "validation" and res.partial is False     # nothing survives -> honest failure

    res = _run(ai_structured(U, list[Verdict], call_fn=bad_arr, partial_items="", check=lambda d: ["missing B"]))
    assert res.ok is False and res.kind == "validation"                              # check still applies to the rebuilt root

    res = _run(ai_structured(U, list[Verdict], call_fn=bad_arr))
    assert res.ok is False and res.attempts == 2                                     # no partial_items -> no salvage

    async def junk(messages, **kw):
        return "nothing"

    res = _run(ai_structured(U, Batch, call_fn=junk, partial_items="results"))
    assert res.ok is False and res.kind == "malformed"                               # nothing parsed -> nothing to salvage

    calls = []

    async def good_then_cut(messages, **kw):
        calls.append(1)
        if len(calls) == 1:
            return '{"results": ' + bad_list + '}'
        return '{"results": [{"control_id": "A", "verd'

    res = _run(ai_structured(U, Batch, call_fn=good_then_cut, partial_items="results"))
    assert res.ok and res.partial and [v.control_id for v in res.data.results] == ["A"]   # salvage uses the last parsed attempt


def test_retries_bound_and_programming_errors():
    n = {"calls": 0}

    async def junk(messages, **kw):
        n["calls"] += 1
        return "junk"

    res = _run(ai_structured(U, DICT_SCHEMA, call_fn=junk, retries=3))
    assert res.attempts == 4 and n["calls"] == 4 and res.kind == "malformed"
    n["calls"] = 0
    res = _run(ai_structured(U, DICT_SCHEMA, call_fn=junk, retries=-5))
    assert res.attempts == 1 and n["calls"] == 1
    _raises(TypeError, lambda: _run(ai_structured(U, "not a schema", call_fn=junk)))
    _raises(ValueError, lambda: _run(ai_structured([], DICT_SCHEMA, call_fn=junk)))
    _raises(ValueError, lambda: _run(ai_structured([{"role": "tool", "content": "x"}], DICT_SCHEMA, call_fn=junk)))
    _raises(ValueError, lambda: _run(ai_structured("U", DICT_SCHEMA, call_fn=junk)))
    assert n["calls"] == 1                                                           # programming errors raise before any call


def test_replay_cap_and_repair_kind():
    seen = []

    async def huge(messages, **kw):
        seen.append(messages)
        return '[' + ",".join('{"control_id": "A%d", "verdict": "bad", "confidence": 0.5}' % i for i in range(1000)) + ']'

    res = _run(ai_structured(U, list[Verdict], call_fn=huge))
    assert res.ok is False and res.attempts == 2
    replay = seen[1][-2]["content"]
    assert len(replay) == S.MAX_REPLAY_CHARS and seen[1][-1]["content"].split("\n")[0].endswith("format:")
    assert "one valid JSON array" in seen[1][-1]["content"]                          # {kind} follows the schema root
    assert "- (" in seen[1][-1]["content"] and "more)" in seen[1][-1]["content"]      # error lines capped at 12
    assert len(res.validation_errors) == 13


def test_sync_wrapper():
    async def ok_call(messages, **kw):
        return '{"risk_level": "low", "score": 3}'

    res = ai_structured_sync(U, DICT_SCHEMA, call_fn=ok_call)
    assert res.ok and res.attempts == 1

    async def inside_loop():
        return ai_structured_sync(U, DICT_SCHEMA, call_fn=ok_call)

    _raises(RuntimeError, lambda: _run(inside_loop()))

    import threading
    out = {}

    def worker():
        out["res"] = ai_structured_sync(U, DICT_SCHEMA, call_fn=ok_call)

    t = threading.Thread(target=worker, daemon=True)
    t.start()
    t.join(10)
    assert out["res"].ok


def test_default_call_fn_is_ai_complete_and_no_network():
    """With no call_fn the module calls ai_provider.ai_complete; patch it to prove the seam and
    that the kwargs contract (json_mode / temperature / **ai_complete_kwargs) is what E receives."""
    seen = {}
    original = ai_provider.ai_complete

    async def fake_complete(messages, **kw):
        seen["messages"], seen["kw"] = messages, kw
        return '{"risk_level": "low", "score": 3}'

    ai_provider.ai_complete = fake_complete
    try:
        res = _run(ai_structured(U, DICT_SCHEMA, user_id="u1", tenant_id="t1", task="x", num_ctx=32768, timeout_s=5))
    finally:
        ai_provider.ai_complete = original
    assert res.ok and seen["kw"] == {"json_mode": True, "temperature": 0.0, "user_id": "u1", "tenant_id": "t1",
                                     "task": "x", "num_ctx": 32768, "timeout_s": 5}
    assert seen["messages"][0]["role"] == "system"


def test_import_purity():
    import subprocess
    code = ("import socket, sys\n"
            "def deny(*a, **k): raise AssertionError('network at import time')\n"
            "socket.socket.connect = deny\n"
            "import app.services.ai_structured as m\n"
            "assert not any(isinstance(getattr(m, n), (list, dict, set)) and not n.isupper() and not n.startswith('_')\n"
            "               for n in dir(m)), 'module-level mutable state'\n"
            "print('pure')\n")
    out = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True,
                         cwd=os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
    assert out.returncode == 0 and "pure" in out.stdout, out.stderr[-2000:]


# --- Regression cases for the verified defects (2026-09-02) --------------------------

def test_truncated_batch_reply_is_truncation_not_a_fragment():
    """A cut-off batch reply whose first item is complete is `truncated` (base re-ask, num_predict
    doubled) — never the inner fragment as a wrong success (spec B 3.1 / 3.10: 'never replays a
    fragment')."""
    cut = '{"results": [{"control_id": "A.5.1", "verdict": "implemented", "confidence": 0.9}, {"control_id": "A.5.2", "verd'
    e = _raises(JsonExtractError, lambda: extract_json(cut))
    assert e.truncated is True
    e = _raises(JsonExtractError, lambda: extract_json('[{"quote": "x"}, {"quote": "y'))
    assert e.truncated is True
    e = _raises(JsonExtractError, lambda: extract_json('{"summary": "ok", "items": [{"name": "first", "tags": ["a"]}, {"name": "sec'))
    assert e.truncated is True
    assert extract_json('{"a": 1}\n{"b"') == {"a": 1}                                 # a complete value first is kept
    assert extract_json('prose {"a": 1} more {"b"') == {"a": 1}                        # not at a line start: scan wins
    seen = []

    async def cut_then_ok(messages, **kw):
        seen.append((messages, dict(kw)))
        if len(seen) == 1:
            return cut
        return ('{"results": [{"control_id": "A.5.1", "verdict": "implemented", "confidence": 0.9}, '
                '{"control_id": "A.5.2", "verdict": "not_implemented", "confidence": 0.8}]}')

    res = _run(ai_structured([{"role": "system", "content": "S"}] + U, Batch, call_fn=cut_then_ok, num_predict=8192))
    assert res.ok and res.attempts == 2 and len(res.data.results) == 2
    assert seen[1][1]["num_predict"] == 16384 and len(seen[1][0]) == 2               # doubled; base re-ask
    assert all(m["role"] != "assistant" for m in seen[1][0])                          # the fragment is never replayed

    async def always_cut(messages, **kw):
        return '[{"control_id": "A", "verdict": "implemented", "confidence": 0.9}, {"control_id": "B", "verd'

    res = _run(ai_structured(U, list[Verdict], call_fn=always_cut))
    assert res.ok is False and res.kind == "truncated" and res.attempts == 2          # was: [{"quote": ...}]-style data

    async def loose_cut(messages, **kw):
        return '{"summary": "ok", "items": [{"name": "first", "tags": ["a"]}, {"name": "sec'

    res = _run(ai_structured(U, {"type": "object"}, call_fn=loose_cut))
    assert res.ok is False and res.kind == "truncated" and res.data is None           # was: silent wrong success


def test_deeply_nested_reply_never_raises():
    """CPython's JSON scanner raises RecursionError (not ValueError) on '[[[[...' — a degenerate
    repetition loop the model can fall into at temperature 0; it must surface as an AiResult, never
    as a 500 at the route."""
    cases = (("[" * 30000, True), ('{"a":' * 20000 + "1" + "}" * 20000, False), ("[" * 30000 + "]" * 30000, False))
    for text, truncated in cases:
        e = _raises(JsonExtractError, lambda t=text: extract_json(t))
        assert e.truncated is truncated, text[:12]
        assert looks_truncated(text) is truncated

        async def derailed(messages, **kw):
            return text

        res = _run(ai_structured(U, DICT_SCHEMA, call_fn=derailed, retries=0))
        assert res.ok is False and res.kind == ("truncated" if truncated else "malformed") and res.attempts == 1
    assert isinstance(extract_json("[" * 500 + "]" * 500), list)                       # sane depth still decodes


def test_nan_and_infinity_rejected_by_dict_validator():
    """json.loads accepts NaN / Infinity; nan passes every bound comparison and json.dumps would
    emit it again (invalid JSON for the browser). The dict validator rejects non-finite numbers."""
    bounded = {"type": "object", "properties": {"score": {"type": "number", "minimum": 0, "maximum": 1}}, "required": ["score"]}
    for bad in (float("nan"), float("inf"), float("-inf")):
        ok, err, data = validate_against({"score": bad}, bounded)
        assert not ok and data is None and "finite" in err, (bad, err)
    ok, err, _ = validate_against({"n": float("nan")}, {"type": "object", "properties": {"n": {"type": "number"}}})
    assert not ok and "finite" in err                                                  # no bounds needed
    ok, err, _ = validate_against({"n": float("nan")}, {"type": "object", "properties": {"n": {"minimum": 0}}})
    assert not ok                                                                      # untyped node with a bound
    ok, _, data = validate_against({"score": 0.5, "i": 2.0, "s": "1e3"}, {"type": "object", "properties": {
        "score": {"type": "number"}, "i": {"type": "integer"}, "s": {"type": "number"}}})
    assert ok and data == {"score": 0.5, "i": 2, "s": 1000.0}                          # finite values untouched

    async def nan_reply(messages, **kw):
        return '{"score": NaN}'

    res = _run(ai_structured(U, bounded, call_fn=nan_reply))
    assert res.ok is False and res.kind == "validation" and any("finite" in line for line in res.validation_errors)
    from app.services import ai_prompts
    reply = {"results": [{"control_id": "A.5.1", "verdict": "implemented", "confidence": float("nan"),
                          "evidence": [{"quote": "a passage that is long enough"}], "explanation": "x"}]}
    ok, err, _ = validate_against(reply, ai_prompts.CONTROL_ASSESSMENT_SCHEMA)
    assert not ok and "results.0.confidence" in err and "finite" in err


def test_truncation_budget_is_shared_with_the_provider_layer():
    """Spec B: retries=1 => at most 2 model calls and attempts == calls actually made — also when the
    provider layer does its own num_predict doubling. End-to-end through ai_provider.ai_complete on a
    MockTransport that always answers done_reason='length' (the adoption recipe: decoding('analysis'))."""
    from app.core import ai_quota
    ai_provider._THINK_REJECTED.clear()
    cfg = ai_provider.AIConfig(provider="ollama", base_url="http://fake-host:11434", model="m")
    seen: list = []

    def handler(request):
        body = json.loads(request.content)
        seen.append((body.get("options") or {}).get("num_predict"))
        return httpx.Response(200, json={"message": {"role": "assistant", "content": '{"a":'}, "done": True,
                                         "done_reason": "length", "prompt_eval_count": 10, "eval_count": 5})

    async def go(**kw):
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as c:
            return await ai_structured(U, DICT_SCHEMA, cfg=cfg, client=c, **kw)

    before = ai_quota.get_used("u-trunc")
    res = _run(go(user_id="u-trunc", **ai_provider.decoding("analysis")))
    assert res.ok is False and res.kind == "truncated" and res.raw == '{"a":'
    assert seen == [8192, 16384] and res.attempts == 2                                # 2 HTTP requests, not 4
    assert ai_quota.get_used("u-trunc") == before + 15                                 # metered once, not twice
    seen.clear()
    res = _run(go(retries=2, **ai_provider.decoding("analysis")))
    assert seen == [8192, 16384, 32768] and res.attempts == 3                          # grows from what E tried; no duplicate
    seen.clear()
    res = _run(go(num_ctx=32768))                                                      # no num_predict: E raises at once
    assert seen == [None, None] and res.attempts == 2 and res.kind == "truncated"
    # the same contract through the call_fn seam: E's attempts and num_predict are honoured
    calls = []

    async def fake_e(messages, **kw):
        calls.append(dict(kw))
        np = kw.get("num_predict")
        if np and np < S.NUM_PREDICT_CAP:
            raise ai_provider.AITruncated("cut", attempts=2, raw="{", num_predict=min(2 * np, S.NUM_PREDICT_CAP))
        raise ai_provider.AITruncated("cut", attempts=1, raw="{", num_predict=np)

    res = _run(ai_structured(U, DICT_SCHEMA, call_fn=fake_e, num_predict=8192))
    assert res.ok is False and res.attempts == 2 and len(calls) == 1                   # E used the whole budget
    calls.clear()
    res = _run(ai_structured(U, DICT_SCHEMA, call_fn=fake_e, num_predict=8192, retries=3))
    assert res.attempts == 4 and [c["num_predict"] for c in calls] == [8192, 32768, 32768]

    async def empty_after_transport_retry(messages, **kw):
        raise ai_provider.AIEmptyOutput("empty", attempts=2)                           # 503 then an empty answer

    res = _run(ai_structured(U, DICT_SCHEMA, call_fn=empty_after_transport_retry))
    assert res.ok is False and res.kind == "empty" and res.attempts == 2


def main() -> int:
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
    print("ALL AI_STRUCTURED FOUNDATION TESTS PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
