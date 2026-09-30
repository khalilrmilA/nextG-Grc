const { chromium } = require("playwright-core");
(async()=>{const b=await chromium.launch({executablePath:"/usr/bin/google-chrome",args:["--no-sandbox"]});
const c=await b.newContext({viewport:{width:360,height:780},isMobile:true,hasTouch:true,deviceScaleFactor:2});const p=await c.newPage();
await p.goto("http://localhost:4100/login");await p.fill("input[type=email]","admin@demo.com");await p.fill("input[type=password]","demo123");await p.click("button[type=submit]");await p.waitForTimeout(3500);
await p.evaluate(()=>{for(const k of ["i18nextLng","lang","language","grc_lang"])localStorage.setItem(k,"fr")});await p.reload({waitUntil:"networkidle"});await p.waitForTimeout(1500);
console.log(await p.evaluate(()=>{const a=[...document.querySelectorAll("header *")].map(e=>e.getBoundingClientRect().right);return "header max right="+Math.round(Math.max(...a))+" vw="+innerWidth}));
await p.screenshot({path:process.env.OUT+"/fr360.png"});await b.close()})();
