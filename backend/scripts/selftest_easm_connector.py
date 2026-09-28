"""Self-test for the configurable EASM connector (app/services/easm_connector.py).

No DB, no network: every HTTP call goes through httpx.MockTransport, injected via
the ``scanner_connectors._client`` seam. Run from anywhere:

    backend/venv/bin/python backend/scripts/selftest_easm_connector.py

Prints PASS/FAIL per case and exits non-zero on any failure.
"""
from __future__ import annotations

import asyncio
import os
import sys
import traceback
import types

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
os.environ.setdefault("SCANNER_ALLOW_PRIVATE_TARGETS", "1")  # no DNS in _check_target

import httpx  # noqa: E402

from app.services import easm_connector as E  # noqa: E402
from app.services import scanner_connectors as sc  # noqa: E402

BASE = "https://easm.example.com"
SEEN: list[httpx.Request] = []


def conn(**kw):
    d = dict(id="c1", tenant_id="t1", name="EASM test", tool="easm", base_url=BASE,
             api_key="SEKRETKEY123", api_secret=None, verify_ssl=True)
    d.update(kw)
    return types.SimpleNamespace(**d)


def cfg(**kw):
    raw = {"findings_path": "/api/v1/findings"}
    raw.update(kw)
    return E.normalize_config(raw, BASE)


def install(handler):
    SEEN.clear()

    def wrapped(req: httpx.Request):
        SEEN.append(req)
        return handler(req)
    sc._client = lambda c: httpx.AsyncClient(transport=httpx.MockTransport(wrapped), follow_redirects=False)


FINDINGS = [
    {"id": 101, "name": "Exposed admin panel", "risk_level": "High", "domain": "shop.acme-demo.com"},
    {"id": 102, "name": "Outdated OpenSSH", "severity": 7.5, "cve": "CVE-2023-38408", "ip": "203.0.113.10"},
    {"id": 103, "title": "Expired TLS certificate", "severity": "medium", "url": "https://vpn.acme-demo.com:443/login"},
]


def run(coro):
    return asyncio.run(coro)


# --- cases ---------------------------------------------------------------------
def t_root_list():
    install(lambda r: httpx.Response(200, json=FINDINGS))
    f, _ = run(E.fetch_findings(conn(), cfg()))
    assert len(f) == 3, f
    assert f[0].title == "Exposed admin panel" and f[0].severity == "high" and f[0].host_name == "shop.acme-demo.com"
    assert f[0].ref_id == "EASM-101"
    assert f[1].ref_id == "CVE-2023-38408" and f[1].host_ip == "203.0.113.10" and f[1].severity == "high"
    assert f[2].host_name == "vpn.acme-demo.com", f[2].host_name
    assert str(SEEN[0].url) == BASE + "/api/v1/findings"


def t_next_url_pagination():
    def h(r):
        if r.url.params.get("cursor") == "2":
            return httpx.Response(200, json={"data": FINDINGS[2:], "next": None})
        return httpx.Response(200, json={"data": FINDINGS[:2], "next": BASE + "/api/v1/findings?cursor=2"})
    install(h)
    f, _ = run(E.fetch_findings(conn(), cfg()))
    assert len(f) == 3 and len(SEEN) == 2, (len(f), len(SEEN))


def t_relative_links_next():
    def h(r):
        if r.url.params.get("after") == "x":
            return httpx.Response(200, json={"items": FINDINGS[1:], "links": {"next": None}})
        return httpx.Response(200, json={"items": FINDINGS[:1], "links": {"next": "/api/v1/findings?after=x"}})
    install(h)
    f, _ = run(E.fetch_findings(conn(), cfg()))
    assert len(f) == 3 and len(SEEN) == 2


def t_page_number_pagination():
    def h(r):
        page = int(r.url.params.get("page", "1"))
        return httpx.Response(200, json={"results": [FINDINGS[page - 1]], "page": page, "total_pages": 3})
    install(h)
    f, _ = run(E.fetch_findings(conn(), cfg()))
    assert len(f) == 3 and [r.url.params.get("page") for r in SEEN] == [None, "2", "3"], [str(r.url) for r in SEEN]


def t_auth_bearer():
    install(lambda r: httpx.Response(200, json=[]))
    run(E.fetch_findings(conn(), cfg()))
    assert SEEN[0].headers["authorization"] == "Bearer SEKRETKEY123"


def t_auth_header():
    install(lambda r: httpx.Response(200, json=[]))
    run(E.fetch_findings(conn(), cfg(auth_style="header", auth_header="X-API-Key")))
    assert SEEN[0].headers["x-api-key"] == "SEKRETKEY123" and "authorization" not in SEEN[0].headers


def t_auth_query():
    def h(r):
        if r.url.params.get("page") == "2":
            return httpx.Response(200, json={"data": [FINDINGS[1]], "page": 2, "total_pages": 2})
        return httpx.Response(200, json={"data": [FINDINGS[0]], "page": 1, "total_pages": 2})
    install(h)
    run(E.fetch_findings(conn(), cfg(auth_style="query", auth_query_param="token")))
    assert all(r.url.params.get("token") == "SEKRETKEY123" for r in SEEN) and len(SEEN) == 2
    assert "authorization" not in SEEN[0].headers


def t_auth_basic():
    install(lambda r: httpx.Response(200, json=[]))
    run(E.fetch_findings(conn(api_secret="pw"), cfg(auth_style="basic")))
    assert SEEN[0].headers["authorization"].startswith("Basic ")


def t_field_map_dotted():
    body = {"payload": {"rows": [{
        "meta": {"headline": "Open S3 bucket", "sev": {"label": "Critical"}},
        "target": {"fqdn": "files.acme-demo.com", "addr": "198.51.100.7"},
        "vulns": [{"cve": "CVE-2024-0001"}], "fix": {"text": "Block public access"},
    }]}}
    install(lambda r: httpx.Response(200, json=body))
    c = cfg(results_key="payload.rows", field_map={
        "title": "meta.headline", "severity": "meta.sev.label", "host": "target.fqdn",
        "ip": "target.addr", "ref_id": "vulns[0].cve", "solution": "fix.text",
    })
    f, _ = run(E.fetch_findings(conn(), c))
    assert len(f) == 1
    x = f[0]
    assert (x.title, x.severity, x.host_name, x.host_ip, x.ref_id, x.solution) == (
        "Open S3 bucket", "critical", "files.acme-demo.com", "198.51.100.7", "CVE-2024-0001", "Block public access"), x


def t_severity_normalization():
    n = E.normalize_severity
    assert [n(v) for v in ("Critical", "HIGH", "Medium", "low", "info", "P1", "very high")] == [
        "critical", "high", "medium", "low", "informational", "critical", "critical"]
    assert [n(v) for v in (9.8, "7.5", 5.0, 0.0, 10)] == ["critical", "high", "medium", "informational", "critical"]
    assert [n(v) for v in (1, 2, 3, 4, 5)] == ["informational", "low", "medium", "high", "critical"]
    assert n(1, "priority") == "critical" and n(5, "priority") == "informational"
    assert n(85) == "high" and n("garbage") is None


def t_host_from_url():
    h = E.host_from
    assert h("https://Shop.Acme-Demo.com:8443/a/b?q=1") == "shop.acme-demo.com"
    assert h("vpn.acme-demo.com:443/login") == "vpn.acme-demo.com"
    assert h("*.acme-demo.com") == "acme-demo.com"
    assert h(["api.acme-demo.com"]) == "api.acme-demo.com"


def t_401():
    install(lambda r: httpx.Response(401, json={"error": "bad key"}))
    res = run(sc.test_connector(conn(), {"findings_path": "/api/v1/findings"}))
    assert res["ok"] is False and "rejected the credentials" in res["message"], res


def t_non_json():
    install(lambda r: httpx.Response(200, text="<html>login</html>", headers={"content-type": "text/html"}))
    res = run(sc.test_connector(conn(), {"findings_path": "/app/findings"}))
    assert res["ok"] is False and "did not return JSON" in res["message"], res


def t_offhost_next_refused():
    install(lambda r: httpx.Response(200, json={"data": FINDINGS, "next": "https://evil.example.net/steal"}))
    try:
        run(E.fetch_findings(conn(), cfg()))
    except ValueError as exc:
        assert "different host" in str(exc)
    else:
        raise AssertionError("off-host next URL was followed")
    assert len(SEEN) == 1


def t_test_message_and_preview():
    install(lambda r: httpx.Response(200, json={"data": [
        {"id": i, "name": f"Issue {i}", "risk_level": "High", "domain": f"h{i}.acme-demo.com"} for i in range(37)]}))
    res = run(sc.test_connector(conn(), {"findings_path": "/api/v1/findings"}))
    assert res["ok"], res
    m = res["message"]
    assert m.startswith("Connected. 37 finding(s) on the first page."), m
    assert "title←name" in m and "severity←risk_level" in m and "host←domain" in m and "no CVE field found" in m, m
    assert len(res["preview"]) == 3 and res["preview"][0]["host"] == "h0.acme-demo.com"


def t_query_key_redacted_in_errors():
    install(lambda r: httpx.Response(500, text="boom"))
    res = run(sc.test_connector(conn(), {"findings_path": "/api/v1/findings", "auth_style": "query"}))
    assert res["ok"] is False and "SEKRETKEY123" not in res["message"], res


def t_config_validation():
    for bad, frag in [
        ({}, "findings_path is required"),
        ({"findings_path": "api/v1"}, "must start with '/'"),
        ({"findings_path": "https://other.example.org/x"}, "same host"),
        ({"findings_path": "/x", "auth_style": "oauth"}, "auth_style"),
        ({"findings_path": "/x", "auth_header": "Host"}, "cannot be"),
        ({"findings_path": "/x", "field_map": {"colour": "c"}}, "field_map keys"),
        ({"findings_path": "/x", "findings_pth": "/y"}, "Unknown EASM setting"),
        ({"findings_path": "/x", "discover_assets": "yes"}, "true or false"),
    ]:
        try:
            E.normalize_config(bad, BASE)
        except ValueError as exc:
            assert frag in str(exc), (bad, str(exc))
        else:
            raise AssertionError(f"accepted {bad}")
    ok = E.normalize_config({"findings_path": BASE + "/v2/f", "assets_path": "/v2/assets"}, BASE)
    assert ok["findings_path"] == BASE + "/v2/f" and ok["discover_assets"] is True and ok["auth_style"] == "bearer"


def t_assets_path_items():
    def h(r):
        if r.url.path.endswith("/assets"):
            return httpx.Response(200, json={"assets": [
                {"hostname": "mail.acme-demo.com", "type": "subdomain"}, {"ip": "192.0.2.44", "type": "ip"}, "cdn.acme-demo.com"]})
        return httpx.Response(200, json=[])
    install(h)
    _, items = run(E.fetch_findings(conn(), cfg(assets_path="/api/v1/assets")))
    assert items == [
        {"host": "mail.acme-demo.com", "ip": None, "kind": "subdomain"},
        {"host": None, "ip": "192.0.2.44", "kind": "ip"},
        {"host": "cdn.acme-demo.com", "ip": None, "kind": None},
    ], items


CASES = [v for k, v in dict(globals()).items() if k.startswith("t_")]


def main() -> int:
    failed = 0
    for fn in CASES:
        try:
            fn()
            print(f"PASS {fn.__name__}")
        except Exception:  # noqa: BLE001
            failed += 1
            print(f"FAIL {fn.__name__}")
            traceback.print_exc()
    print(f"\n{len(CASES) - failed}/{len(CASES)} passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
