const { chromium } = require("playwright-core");
const OUT = process.env.OUT, W = +(process.env.W || 390);
const routes = ["dashboard","assets","asset-graph","analytics","risks","risk-scenarios","compliance","framework","incidents","vulnerabilities","threats","applied-controls","security-exceptions","audits","policies","policy-generator","vendors","reports","regulatory","governance","settings","help","support","risk-cartography","action-plan","webhooks","archiving","control-effectiveness","risk-treatment","ocr","knowledge-base","cve"];
(async () => {
  const b = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
  const ctx = await b.newContext({ viewport: { width: W, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  await p.goto("http://localhost:4000/login", { waitUntil: "networkidle" });
  await p.screenshot({ path: `${OUT}/login.png` });
  await p.fill('input[type=email]', "admin@demo.com"); await p.fill('input[type=password]', "demo123");
  await p.click('button[type=submit]'); await p.waitForTimeout(3000);
  console.log("after login:", p.url());
  for (const r of routes) {
    try {
      await p.goto(`http://localhost:4000/${r}`, { waitUntil: "networkidle", timeout: 20000 });
      await p.waitForTimeout(800);
      const res = await p.evaluate(() => {
        const vw = document.documentElement.clientWidth, bad = [];
        for (const el of document.querySelectorAll("body *")) {
          const r = el.getBoundingClientRect();
          if (r.width && r.right > vw + 2 && !el.closest("table,[class*=overflow-x],[class*=overflow-auto],aside")) {
            let a = el, clipped = false; while ((a = a.parentElement)) { const o = getComputedStyle(a).overflowX; if (o === "auto" || o === "scroll" || o === "hidden") { clipped = true; break; } }
            if (!clipped) bad.push(el.tagName + "." + String(el.className).slice(0, 60) + " right=" + Math.round(r.right));
          }
        }
        return { sw: document.documentElement.scrollWidth, vw, bad: bad.slice(0, 3), n: bad.length, url: location.pathname };
      });
      console.log(r.padEnd(24), res.url.padEnd(28), `sw=${res.sw}/${res.vw}`, res.n ? `OVERFLOW x${res.n} ${res.bad[0]}` : "ok");
      await p.screenshot({ path: `${OUT}/${r}.png` });
    } catch (e) { console.log(r, "ERR", e.message.slice(0, 80)); }
  }
  await b.close();
})();
