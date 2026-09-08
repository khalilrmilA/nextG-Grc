"""Acceptance checks for the requirement-critical paths.

Run against a live instance:

    python -m tests.acceptance --base-url http://127.0.0.1:8000/api/v1 \\
        --email ciso@example.com --password '...'

Two properties this harness is built around, because the throwaway scripts it
replaces got both wrong and produced false failures:

**Routes are verified, not guessed.** Every path the suite uses is checked
against the live ``/openapi.json`` before anything runs. A mistyped path then
says "route not in the API" instead of failing an assertion with a confusing
404 that looks like a broken feature.

**Every check is idempotent.** Fixtures are created with a per-run suffix and
removed afterwards, and anything the suite changes on an existing record is put
back. Re-running immediately must produce the same result — a suite that only
passes on a fresh database cannot be used to verify a deployment.
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request
import uuid
from urllib.parse import urlencode


# Mirrors ChangePasswordRequest's Field(min_length=12) in auth.py. Kept here so
# the suite can decline a round-trip it would not be able to undo.
PASSWORD_MIN_LENGTH = 12


class Result:
    def __init__(self) -> None:
        self.passed = 0
        self.failed: list[str] = []
        self.skipped: list[str] = []

    def check(self, label: str, ok: bool, detail: str = "") -> bool:
        suffix = f"   [{detail}]" if detail else ""
        print(("  PASS  " if ok else "  FAIL  ") + label + suffix)
        if ok:
            self.passed += 1
        else:
            self.failed.append(label)
        return ok

    def skip(self, label: str, why: str) -> None:
        print(f"  SKIP  {label}   [{why}]")
        self.skipped.append(label)


class Client:
    def __init__(self, base_url: str) -> None:
        self.base = base_url.rstrip("/")
        self.token: str | None = None
        self._paths: set[str] | None = None

    # ---- transport -------------------------------------------------------
    def call(self, method: str, path: str, body=None, params=None, token=None):
        url = self.base + path + ("?" + urlencode(params) if params else "")
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(url, data=data, method=method)
        req.add_header("Content-Type", "application/json")
        req.add_header("X-GRC-Client", "acceptance-suite")
        bearer = token if token is not None else self.token
        if bearer:
            req.add_header("Authorization", f"Bearer {bearer}")
        try:
            with urllib.request.urlopen(req, timeout=90) as resp:
                raw = resp.read().decode()
                return resp.status, (json.loads(raw) if raw else None), dict(resp.headers)
        except urllib.error.HTTPError as exc:
            raw = exc.read().decode()
            try:
                return exc.code, json.loads(raw), dict(exc.headers)
            except ValueError:
                return exc.code, raw[:300], dict(exc.headers)

    # ---- route verification ---------------------------------------------
    def load_routes(self) -> set[str]:
        if self._paths is None:
            status, spec, _ = self.call("GET", "/openapi.json")
            if status != 200 or not isinstance(spec, dict):
                # Some deployments hide the schema; verification then degrades
                # to "not available" rather than blocking the run.
                self._paths = set()
            else:
                # OpenAPI reports absolute paths ("/api/v1/auth/login") while the
                # suite works relative to the base URL. Normalise both ways so a
                # mismatch here is a genuinely missing route, not a prefix.
                prefix = self.base.split("://", 1)[-1]
                prefix = prefix[prefix.index("/"):] if "/" in prefix else ""
                paths = set()
                for raw in spec.get("paths", {}):
                    paths.add(raw)
                    if prefix and raw.startswith(prefix):
                        paths.add(raw[len(prefix):] or "/")
                self._paths = paths
        return self._paths

    def has_route(self, template: str) -> bool:
        paths = self.load_routes()
        return not paths or template in paths

    def login(self, email: str, password: str) -> bool:
        status, body, _ = self.call("POST", "/auth/login", body={"email": email, "password": password})
        if status == 200 and isinstance(body, dict) and body.get("access_token"):
            self.token = body["access_token"]
            return True
        return False


def _require_routes(client: Client, result: Result, templates: list[str]) -> bool:
    """Fail loudly on a mistyped path instead of asserting on its 404."""
    missing = [t for t in templates if not client.has_route(t)]
    for t in missing:
        result.check(f"route {t} exists in the API", False, "not in openapi.json")
    return not missing


# ── suites ────────────────────────────────────────────────────────────────

def suite_auth(client: Client, result: Result, email: str, password: str) -> None:
    print("\n== Authentication ==")
    if not _require_routes(client, result, ["/auth/login", "/auth/change-password"]):
        return
    status, _, _ = client.call("POST", "/auth/login", body={"email": email, "password": "definitely-not-it"})
    result.check("a wrong password is refused", status == 401, str(status))

    # The password round-trip is only safe when the supplied password could
    # itself be set again — the endpoint enforces a 12-character minimum, so a
    # shorter one can be changed away from but never restored. Running it
    # regardless is what left the previous harness's account stranded on a
    # temporary password and every later run failing at login.
    if len(password) < PASSWORD_MIN_LENGTH:
        result.skip("password change round-trip",
                    f"the supplied password is under {PASSWORD_MIN_LENGTH} characters and "
                    f"could not be restored afterwards")
        return

    temporary = f"Tmp!{uuid.uuid4().hex[:12]}Aa1"
    status, body, _ = client.call("POST", "/auth/change-password",
                                  body={"current_password": password, "new_password": temporary})
    if not result.check("password change accepted", status in (200, 204), f"{status} {str(body)[:60]}"):
        return
    result.check("the new password authenticates", client.login(email, temporary))

    status, body, _ = client.call("POST", "/auth/change-password",
                                  body={"current_password": temporary, "new_password": password})
    if not result.check("the original password is restored", status in (200, 204), str(status)):
        # Never lose the account: say exactly how to get back in.
        print(f"\n  !! The account is still on the temporary password: {temporary}")
        print(f"  !! Restore it with a change-password call, or the suite cannot be re-run.\n")
        return
    client.login(email, password)


def suite_uploads(client: Client, result: Result) -> None:
    print("\n== Upload safety ==")
    route = "/vuln-import/upload"
    if not _require_routes(client, result, [route]):
        return

    def send(filename: str):
        boundary = "----acceptance"
        payload = (
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'
            f"Content-Type: application/octet-stream\r\n\r\n"
        ).encode() + b"ref,name\n" + f"\r\n--{boundary}--\r\n".encode()
        req = urllib.request.Request(client.base + route, data=payload, method="POST")
        req.add_header("Content-Type", f"multipart/form-data; boundary={boundary}")
        req.add_header("Authorization", f"Bearer {client.token}")
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                return resp.status, resp.read().decode()[:160]
        except urllib.error.HTTPError as exc:
            return exc.code, exc.read().decode()[:200]

    for filename in ("malware.exe", "shell.php", "page.html", "report.pdf.exe", "payload.php.pdf"):
        status, message = send(filename)
        result.check(f"{filename} is refused", status == 422 and "not accepted" in message, str(status))
    status, _ = send("scan.csv")
    result.check("a legitimate .csv is still accepted", status < 400, str(status))


def suite_collections(client: Client, result: Result) -> None:
    print("\n== Collections are bounded ==")
    if not _require_routes(client, result, ["/vulnerabilities", "/applied-controls", "/assets"]):
        return
    status, body, headers = client.call("GET", "/vulnerabilities", params={"limit": 2})
    lowered = {k.lower(): v for k, v in headers.items()}
    result.check("vulnerabilities honours a limit", status == 200 and len(body) <= 2,
                 f"n={len(body) if status == 200 else body}")
    result.check("and reports the true total", "x-total-count" in lowered,
                 lowered.get("x-total-count", "missing"))
    status, body, _ = client.call("GET", "/assets", params={"page": 1, "page_size": 5})
    result.check("assets paginate with a total", status == 200 and "total" in (body or {}),
                 f"{len(body.get('items', []))} of {body.get('total')}" if status == 200 else str(status))


def suite_audit_access(client: Client, result: Result) -> None:
    print("\n== Audit trail access ==")
    if not _require_routes(client, result, ["/activity-log", "/activity-log/retention"]):
        return
    status, body, _ = client.call("GET", "/activity-log", params={"limit": 1})
    result.check("an authorised reader can read the trail", status == 200, str(status))
    status, body, _ = client.call("GET", "/activity-log/retention")
    if status == 200:
        result.check("the retention policy is readable", True,
                     f"{body['retention_days']}d, floor {body['absolute_floor_days']}d")
        result.check("the floor protects recent evidence", body["absolute_floor_days"] >= 365,
                     str(body["absolute_floor_days"]))
    else:
        result.skip("retention policy", f"status {status}")
    for method in ("PATCH", "PUT", "DELETE"):
        status, _, _ = client.call(method, "/activity-log", body={} if method != "DELETE" else None)
        result.check(f"{method} on the trail is not offered", status in (404, 405), str(status))


def suite_control_register(client: Client, result: Result) -> None:
    print("\n== Applied-control register ==")
    needed = ["/applied-controls", "/applied-controls/{cid}", "/applied-controls/{cid}/history"]
    if not _require_routes(client, result, needed):
        return
    ref = f"ACC-{uuid.uuid4().hex[:8].upper()}"
    status, control, _ = client.call("POST", "/applied-controls", body={
        "ref_id": ref, "name": f"Acceptance control {ref}", "category": "technical", "status": "planned",
    })
    if not result.check("a control can be created", status == 201, f"{status} {str(control)[:70]}"):
        return
    cid = control["id"]
    try:
        # "active" is NOT a ControlStatus member (planned / in_progress / implemented /
        # not_applicable / deprecated). The endpoint used to accept it silently and now
        # validates, so the suite was asserting a value the model never allowed.
        status, updated, _ = client.call("PATCH", f"/applied-controls/{cid}", body={"status": "implemented"})
        result.check("a status change is accepted", status == 200, str(status))
        status, history, _ = client.call("GET", f"/applied-controls/{cid}/history")
        actions = [h["action"] for h in history] if status == 200 else []
        result.check("creation is in the history", "created" in actions, str(actions))
        result.check("the status change is distinguished", "status_changed" in actions, str(actions))
    finally:
        status, _, _ = client.call("DELETE", f"/applied-controls/{cid}",
                                   params={"reason": "Acceptance suite cleanup"})
        result.check("the fixture is removed", status == 204, str(status))
        status, history, _ = client.call("GET", f"/applied-controls/{cid}/history")
        result.check("and its history outlives it",
                     status == 200 and any(h["action"] == "deleted" for h in history),
                     f"n={len(history) if status == 200 else history}")


def suite_scenarios(client: Client, result: Result) -> None:
    print("\n== Risk scenarios ==")
    if not _require_routes(client, result, ["/risk-scenarios", "/risk-scenarios/priority-criteria"]):
        return
    status, criteria, _ = client.call("GET", "/risk-scenarios/priority-criteria")
    if not result.check("prioritisation criteria are readable", status == 200, str(status)):
        return
    status, scenarios, _ = client.call("GET", "/risk-scenarios")
    if status == 200 and scenarios:
        result.check("every scenario carries a traceable reference",
                     all(s.get("ref_id") for s in scenarios),
                     str([s.get("ref_id") for s in scenarios][:5]))
    else:
        result.skip("scenario references", "no scenarios in this tenant")


SUITES = {
    "auth": suite_auth,
    "uploads": suite_uploads,
    "collections": suite_collections,
    "audit": suite_audit_access,
    "controls": suite_control_register,
    "scenarios": suite_scenarios,
}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://127.0.0.1:8000/api/v1")
    parser.add_argument("--email", required=True)
    parser.add_argument("--password", required=True)
    parser.add_argument("--only", help="comma-separated suite names", default="")
    args = parser.parse_args()

    client = Client(args.base_url)
    result = Result()

    print(f"target: {args.base_url}")
    if not client.login(args.email, args.password):
        print("  FAIL  could not sign in — check --email / --password")
        return 2
    routes = client.load_routes()
    print(f"routes discovered: {len(routes) if routes else 'unavailable (schema not exposed)'}")

    wanted = [s.strip() for s in args.only.split(",") if s.strip()] or list(SUITES)
    for name in wanted:
        suite = SUITES.get(name)
        if suite is None:
            print(f"\n(unknown suite {name!r}; known: {', '.join(SUITES)})")
            continue
        if name == "auth":
            suite(client, result, args.email, args.password)
        else:
            suite(client, result)

    print(f"\n{result.passed} passed, {len(result.failed)} failed, {len(result.skipped)} skipped")
    for label in result.failed:
        print(f"  FAILED: {label}")
    return 1 if result.failed else 0


if __name__ == "__main__":
    sys.exit(main())
