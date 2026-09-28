"""Extract every user-facing API message the backend can put in a response.

AST-based (never regex), so string concatenation, f-strings and module-level
constants are understood. Walks ``backend/app`` and collects:

* ``HTTPException(status, "detail")`` / ``detail=...`` (any exception class whose
  name ends in ``Exception``/``Error`` that takes ``detail=``);
* the first positional argument of ``raise SomeError("...")`` — these reach users
  through the ubiquitous ``detail=str(exc)`` pattern;
* ``{"message": ...}`` / ``{"detail": ...}`` dict literals and ``message=`` keywords
  (success/failure JSON the UI shows verbatim);
* module-level string constants referenced in any of those positions.

Static strings are recorded verbatim; f-strings / ``+`` concatenations become
*templates* in ``str.format`` syntax (``"Framework not found: {unknown_0}"``, literal
braces doubled) that the runtime catalog (``app.core.i18n_messages``) matches back
against the rendered English text.

Output: ``app/core/locales/messages_source.json`` —
``{"static": {text: ["file:line", ...]}, "templates": {template: [...]}}``.

    cd backend && venv/bin/python -m scripts.extract_api_messages [--out PATH]
"""
from __future__ import annotations

import argparse
import ast
import json
import re
import string
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
APP = BACKEND / "app"
DEFAULT_OUT = APP / "core" / "locales" / "messages_source.json"

# Keys whose string values are human text shown by the UI.
MESSAGE_KEYS = {"message", "detail"}
# Exception classes whose first positional arg is internal, never user text.
SKIP_EXC = {"NotImplementedError", "AssertionError", "StopIteration", "KeyError",
            "SystemExit", "ImportError", "ModuleNotFoundError", "AttributeError"}
# Files whose strings are owned by other work streams (AI outputs, notifications,
# emails, PDF reports) or are not user-visible API text.
SKIP_PARTS = ("/tests/", "/migrations/", "/alembic/")

_MIN_LETTERS = 3
# app.core.i18n_messages.msg, imported as i18n_msg: first arg is an English template.
TEMPLATE_CALLS = {"i18n_msg"}


def _letters(s: str) -> int:
    return sum(1 for c in s if c.isalpha())


def _ph_name(node: ast.AST, used: dict[str, int]) -> str:
    try:
        src = ast.unparse(node)
    except Exception:  # pragma: no cover
        src = "value"
    name = re.sub(r"\W+", "_", src).strip("_").lower()[:32] or "value"
    if name[0].isdigit():
        name = "v_" + name
    n = used.get(name, 0)
    used[name] = n + 1
    return name if n == 0 else f"{name}_{n + 1}"


class Collector(ast.NodeVisitor):
    def __init__(self, rel: str, tree: ast.Module):
        self.rel = rel
        self.static: dict[str, set[str]] = {}
        self.templates: dict[str, set[str]] = {}
        self.consts: dict[str, ast.AST] = {}
        for node in tree.body:
            if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
                self.consts[node.targets[0].id] = node.value
            elif isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name) and node.value is not None:
                self.consts[node.target.id] = node.value

    # -- expression -> ("static", text) | ("template", tpl) | None -----------------
    def _render(self, node: ast.AST, used: dict[str, int], depth: int = 0):
        """Return list of parts: ("lit", text) / ("ph", name), or None if not text-like."""
        if depth > 6:
            return None
        if isinstance(node, ast.Constant) and isinstance(node.value, str):
            return [("lit", node.value)]
        if isinstance(node, ast.JoinedStr):
            parts = []
            for v in node.values:
                if isinstance(v, ast.Constant) and isinstance(v.value, str):
                    parts.append(("lit", v.value))
                elif isinstance(v, ast.FormattedValue):
                    parts.append(("ph", _ph_name(v.value, used)))
            return parts
        if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Add):
            left = self._render(node.left, used, depth + 1)
            right = self._render(node.right, used, depth + 1)
            if left is None and right is None:
                return None
            left = left if left is not None else [("ph", _ph_name(node.left, used))]
            right = right if right is not None else [("ph", _ph_name(node.right, used))]
            return left + right
        if isinstance(node, ast.Name) and node.id in self.consts and depth < 3:
            return self._render(self.consts[node.id], used, depth + 1)
        return None

    def _emit(self, node: ast.AST | None, line: int) -> None:
        if node is None:
            return
        # Conditional / boolean alternatives: collect every branch.
        if isinstance(node, ast.IfExp):
            self._emit(node.body, line)
            self._emit(node.orelse, line)
            return
        if isinstance(node, ast.BoolOp):
            for v in node.values:
                self._emit(v, line)
            return
        if isinstance(node, ast.Dict):  # detail={"error": ..., "message": ...}
            self._dict(node)
            return
        # "...".join / .format are not modelled; str(exc) is covered via raise-sites.
        parts = self._render(node, {})
        if not parts:
            return
        where = f"{self.rel}:{line}"
        if all(k == "lit" for k, _ in parts):
            text = "".join(v for _, v in parts)
            if _letters(text) >= _MIN_LETTERS and text.strip():
                self.static.setdefault(text, set()).add(where)
            return
        tpl = "".join(v.replace("{", "{{").replace("}", "}}") if k == "lit" else "{" + v + "}"
                      for k, v in parts)
        literal = "".join(v for k, v in parts if k == "lit")
        if _letters(literal) >= 6:
            self.templates.setdefault(tpl, set()).add(where)

    def _dict(self, node: ast.Dict) -> None:
        for k, v in zip(node.keys, node.values):
            if isinstance(k, ast.Constant) and k.value in MESSAGE_KEYS:
                self._emit(v, getattr(v, "lineno", node.lineno))

    # -- visitors ---------------------------------------------------------------------
    def visit_Call(self, node: ast.Call) -> None:
        fname = ""
        if isinstance(node.func, ast.Name):
            fname = node.func.id
        elif isinstance(node.func, ast.Attribute):
            fname = node.func.attr
        is_exc = fname.endswith("Exception") or fname.endswith("Error")
        for kw in node.keywords:
            if kw.arg == "detail" and is_exc:
                self._emit(kw.value, kw.value.lineno)
            elif kw.arg == "message":
                self._emit(kw.value, kw.value.lineno)
        if fname == "HTTPException" and len(node.args) >= 2:
            self._emit(node.args[1], node.args[1].lineno)
        if fname in TEMPLATE_CALLS and node.args:
            first = node.args[0]
            if isinstance(first, ast.Constant) and isinstance(first.value, str):
                self._template_literal(first.value, first.lineno)
        self.generic_visit(node)

    def _template_literal(self, text: str, line: int) -> None:
        """A literal already in str.format syntax (``i18n_msg("... {n} ...", lang, n=...)``)."""
        where = f"{self.rel}:{line}"
        try:
            has_fields = any(f is not None for _, f, _, _ in string.Formatter().parse(text))
        except ValueError:
            has_fields = False
        if has_fields:
            self.templates.setdefault(text, set()).add(where)
        elif _letters(text) >= _MIN_LETTERS:
            self.static.setdefault(text, set()).add(where)

    def visit_Raise(self, node: ast.Raise) -> None:
        exc = node.exc
        if isinstance(exc, ast.Call) and exc.args:
            fname = exc.func.id if isinstance(exc.func, ast.Name) else (
                exc.func.attr if isinstance(exc.func, ast.Attribute) else "")
            if (fname.endswith("Error") or fname.endswith("Exception")) and fname not in SKIP_EXC \
                    and fname != "HTTPException":
                self._emit(exc.args[0], exc.args[0].lineno)
        self.generic_visit(node)

    def visit_Dict(self, node: ast.Dict) -> None:
        self._dict(node)
        self.generic_visit(node)


def extract(root: Path = APP) -> dict:
    static: dict[str, set[str]] = {}
    templates: dict[str, set[str]] = {}
    for path in sorted(root.rglob("*.py")):
        rel = path.relative_to(BACKEND).as_posix()
        if any(p in "/" + rel for p in SKIP_PARTS):
            continue
        try:
            tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        except SyntaxError as exc:  # pragma: no cover
            print(f"skip {rel}: {exc}", file=sys.stderr)
            continue
        c = Collector(rel, tree)
        c.visit(tree)
        for k, v in c.static.items():
            static.setdefault(k, set()).update(v)
        for k, v in c.templates.items():
            templates.setdefault(k, set()).update(v)
    return {
        "static": {k: sorted(v) for k, v in sorted(static.items())},
        "templates": {k: sorted(v) for k, v in sorted(templates.items())},
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(DEFAULT_OUT))
    args = ap.parse_args()
    data = extract()
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"static={len(data['static'])} templates={len(data['templates'])} -> {out}")


if __name__ == "__main__":
    main()
