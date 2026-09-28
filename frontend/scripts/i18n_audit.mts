// i18n coverage audit: `npx tsx scripts/i18n_audit.mts <out.json> [only-files.json]` — counts t() keys missing in fr/ar and hard-coded English in .tsx files (heuristic).
import fs from "fs"; import path from "path";
const root = "/root/Desktop/GRC/frontend/src";
const i18n = await import(root + "/i18n/locales/en.ts");
const en = (await import(root + "/i18n/locales/en.ts")).default;
const fr = (await import(root + "/i18n/locales/fr.ts")).default;
const ar = (await import(root + "/i18n/locales/ar.ts")).default;
const el = await import(root + "/i18n/eliteLocales.ts");
const gf = await import(root + "/i18n/locales/gapfills.ts");
const mn = await import(root + "/i18n/menuLocales.ts");
const fx = await import(root + "/i18n/fixLocales.ts");
function deep(a: any, b: any, over: boolean) { for (const k in b) { if (b[k] && typeof b[k] === "object" && !Array.isArray(b[k])) { a[k] = a[k] && typeof a[k]==="object" ? a[k] : {}; deep(a[k], b[k], over); } else if (over || a[k] === undefined) a[k] = b[k]; } return a; }
const sweeps = await Promise.all(["g1_admin_account","g2_vendors","g3_compliance","g4_risk_gov","g5_audit_docs","g6_security_shell","g7_exports"].map(g => import(root + "/i18n/sweep/" + g + ".ts").then(m => m.default)));
const R: any = {
  en: deep(deep(deep(structuredClone(en), el.eliteEn, true), mn.menuEn, true), gf.gapEn, false),
  fr: deep(deep(deep(deep(structuredClone(fr), el.eliteFr, true), mn.menuFr, true), gf.gapFr, false), fx.fixFr, false),
  ar: deep(deep(deep(deep(structuredClone(ar), el.eliteAr, true), mn.menuAr, true), gf.gapAr, false), fx.fixAr, false),
};
const get = (o: any, k: string) => k.split(".").reduce((x, p) => (x == null ? x : x[p]), o);
function walk(d: string, out: string[] = []) { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) { if (!["i18n","kb","landing"].includes(f)) walk(p, out); } else if (/\.tsx$/.test(f)) out.push(p); } return out; }
const files = walk(root);
const perFile: any[] = []; let totFr = 0, totAr = 0, totHard = 0;
for (const b of sweeps) { deep(R.en, b.en, false); deep(R.fr, b.fr, false); deep(R.ar, b.ar, false); }
const only = process.argv[3] ? JSON.parse(fs.readFileSync(process.argv[3], "utf8")) : null;
for (const f of files) {
  if (only && !only.includes(f.replace(root + "/", ""))) continue;
  const s = fs.readFileSync(f, "utf8");
  if (!s.includes("<")) continue;
  const keys = [...s.matchAll(/\bt\(\s*["'`]([a-zA-Z0-9_.]+)["'`]/g)].map(m => m[1]).filter(k => k.includes("."));
  const uniq = [...new Set(keys)];
  const mFr = uniq.filter(k => get(R.fr, k) === undefined), mAr = uniq.filter(k => get(R.ar, k) === undefined);
  // hardcoded JSX text: >Some English words<  and placeholder/title/aria-label="English"
  const hard = [...s.matchAll(/>\s*([A-Z][A-Za-z][^<>{}]{2,}?)\s*</g)].map(m => m[1].trim()).filter(x => /[a-z]{2,}/.test(x) && !/^[A-Z0-9_\-]+$/.test(x));
  const attrs = [...s.matchAll(/\b(?:placeholder|title|aria-label|label)=\"([A-Z][^"]{2,})\"/g)].map(m => m[1]);
  const h = hard.length + attrs.length;
  totFr += mFr.length; totAr += mAr.length; totHard += h;
  if (mFr.length || mAr.length || h) perFile.push({ f: f.replace(root + "/", ""), mFr: mFr.length, mAr: mAr.length, hard: h, sample: [...hard, ...attrs].slice(0, 3) });
}
perFile.sort((a, b) => (b.mFr + b.mAr + b.hard) - (a.mFr + a.mAr + a.hard));
fs.writeFileSync(process.argv[2], JSON.stringify(perFile, null, 1));
console.log("files with gaps:", perFile.length, "| keys missing FR:", totFr, "AR:", totAr, "| hardcoded strings:", totHard);
for (const p of perFile.slice(0, 40)) console.log(String(p.mFr).padStart(4), String(p.mAr).padStart(4), String(p.hard).padStart(4), p.f, "|", p.sample.join(" / ").slice(0, 70));
