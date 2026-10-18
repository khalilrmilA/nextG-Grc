#!/usr/bin/env node
/**
 * Static check: every `:param` a route declares must be read by the page it renders.
 *
 * Why: AuditDetailPage read `useParams<{ id }>()` while its route is
 * `audits/:auditId`, so the id was always empty and the page spun forever for
 * six weeks (d565c20). Type-checking cannot see it — useParams() is untyped
 * against the router.
 *
 * For each <Route path="…:param…" element={…<Page />…}> in src/App.tsx:
 *   - the page is the innermost component of `element` imported from ./pages;
 *   - if that page calls useParams, the keys it reads (from the generic
 *     `useParams<{ a: …; b?: … }>()` and/or the destructuring
 *     `const { a, b: x = "" } = useParams()`) must include every route param.
 * A page that never calls useParams is reported only if `--strict` is passed.
 *
 * Run: node scripts/check-route-params.mjs   (wired into `npm run lint`)
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "src");
const strict = process.argv.includes("--strict");

const app = readFileSync(join(SRC, "App.tsx"), "utf8");

// Component name -> source file, from `import X from "./pages/X"` and lazy imports.
const files = new Map();
for (const m of app.matchAll(/import\s+(\w+)\s+from\s+["']\.\/(pages\/[\w/.-]+)["']/g)) files.set(m[1], m[2]);
for (const m of app.matchAll(/const\s+(\w+)\s*=\s*lazy\(\s*\(\)\s*=>\s*import\(\s*["']\.\/(pages\/[\w/.-]+)["']/g)) files.set(m[1], m[2]);

function resolveFile(rel) {
  for (const ext of ["", ".tsx", ".ts", "/index.tsx"]) {
    const p = join(SRC, rel + ext);
    if (existsSync(p) && !p.endsWith("/pages")) return p;
  }
  return null;
}

/** Keys a page reads from useParams (generic type keys ∪ destructured names). */
function paramKeys(source) {
  const keys = new Set();
  let calls = 0;
  for (const m of source.matchAll(/useParams\s*(<\s*\{([^}]*)\}\s*>)?\s*\(\s*\)/g)) {
    calls++;
    if (m[2]) for (const k of m[2].matchAll(/(\w+)\s*\??\s*:/g)) keys.add(k[1]);
  }
  for (const m of source.matchAll(/const\s*\{([^}]*)\}\s*=\s*useParams\b/g)) {
    for (const part of m[1].split(",")) {
      const name = part.trim().split(/[:=\s]/)[0];
      if (name) keys.add(name);
    }
  }
  return { calls, keys };
}

const problems = [];
let checked = 0;
// <Route path="…" element={…} …/>  — element may nest guards; take the innermost page.
for (const m of app.matchAll(/<Route\s+path="([^"]+)"\s+element=\{([\s\S]*?)\}\s*\/?>/g)) {
  const [, path, element] = m;
  const params = [...path.matchAll(/:(\w+)/g)].map((p) => p[1]);
  if (!params.length) continue;
  const comps = [...element.matchAll(/<([A-Z]\w*)/g)].map((c) => c[1]).filter((c) => files.has(c));
  const page = comps[comps.length - 1];
  if (!page) {
    problems.push(`${path}: no page component imported from ./pages found in element`);
    continue;
  }
  const file = resolveFile(files.get(page));
  if (!file) {
    problems.push(`${path}: cannot find source of ${page} (${files.get(page)})`);
    continue;
  }
  const { calls, keys } = paramKeys(readFileSync(file, "utf8"));
  checked++;
  if (!calls) {
    if (strict) problems.push(`${path}: ${page} declares :${params.join(", :")} but never calls useParams`);
    continue;
  }
  const missing = params.filter((p) => !keys.has(p));
  if (missing.length) {
    problems.push(`${path}: ${page} reads useParams { ${[...keys].join(", ") || "—"} } but the route declares :${missing.join(", :")}`);
  }
}

if (problems.length) {
  console.error(`check-route-params: ${problems.length} problem(s)`);
  for (const p of problems) console.error("  ✗ " + p);
  process.exit(1);
}
console.log(`check-route-params: ${checked} parameterised route(s) OK`);
