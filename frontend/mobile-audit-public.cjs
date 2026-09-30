const { chromium } = require("playwright-core");
const pages = ["", "pricing", "features", "contact", "faq", "blog", "solutions", "how-it-works", "changelog"].map(x => `/en/${x}`);
(async () => {
  const b = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  for (const r of pages) {
    try {
      await p.goto("http://localhost:3000" + r, { waitUntil: "load", timeout: 30000 }); await p.waitForTimeout(1500);
      const res = await p.evaluate(() => { const vw = document.documentElement.clientWidth, bad = [];
        for (const el of document.querySelectorAll("body *")) { const r = el.getBoundingClientRect(); if (r.width && r.right > vw + 2) { let a = el, c = false; while ((a = a.parentElement)) { const o = getComputedStyle(a).overflowX; if (o !== "visible") { c = true; break; } } if (!c) bad.push(el.tagName + "." + String(el.className).slice(0, 50) + " r=" + Math.round(r.right)); } }
        return { sw: document.documentElement.scrollWidth, vw, n: bad.length, b: bad[0], status: document.title.slice(0, 30) }; });
      console.log(r.padEnd(22), `sw=${res.sw}/${res.vw}`, res.n ? `OVERFLOW x${res.n} ${res.b}` : "ok", "|", res.status);
      await p.screenshot({ path: `${process.env.OUT}/pub${r.replace(/\//g, "_")}.png` });
    } catch (e) { console.log(r, "ERR", e.message.slice(0, 70)); }
  }
  await b.close();
})();
