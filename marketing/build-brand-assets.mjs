// Regenerates every raster/vector brand asset from the GRC Eye brand kit mark.
// Usage: FONTCONFIG_FILE=<conf with Geist ttf dir> node scripts/build-brand-assets.mjs
import sharp from "sharp";
import fs from "node:fs";
import path from "node:path";

const INK = "#15181C", PAPER = "#F6F6F4", BLUE = "#0F74C5", RED = "#DB4241";
const cells = [
  [4, 4, "#E4C64F"], [18.5, 4, "#EF852E"], [35, 2, "#DB4241"],
  [4, 18.5, "#5BBD74"], [33, 18.5, "#EF852E"],
  [4, 33, "#5BBD74"], [18.5, 33, "#5BBD74"], [33, 33, "#E4C64F"],
];
function mark({ eye = INK, pupil = RED, mono = null } = {}) {
  const r = cells.map(([x, y, c]) => `<rect x="${x}" y="${y}" width="11" height="11" fill="${mono || c}"/>`).join("");
  return r + `<circle cx="24" cy="24" r="5.5" fill="${mono || eye}"/><circle cx="24" cy="24" r="2.2" fill="${pupil}"/>`;
}
const svg = (inner, vb = "0 0 48 48") =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" fill="none">${inner}</svg>`;
const word = (x, y, size, fill) =>
  `<text x="${x}" y="${y}" font-family="Geist" font-weight="700" font-size="${size}" letter-spacing="${-0.03 * size}" fill="${fill}">GRC Eye</text>`;

const out = {
  "logo-mark.svg": svg(mark()),
  "logo-mark-mono-ink.svg": svg(mark({ mono: INK, pupil: "#fff" })),
  "logo-mark-mono-white.svg": svg(mark({ mono: PAPER, pupil: INK })),
};
// lockup: mark 48 units + gap 14 + wordmark
const lockup = (textFill, eye) =>
  svg(`<g>${mark({ eye })}</g>${word(64, 34, 34, textFill)}`, "0 0 220 48");
const stacked = (textFill, eye) =>
  svg(`<g transform="translate(58 0)">${mark({ eye })}</g>${word(68 - 0, 82, 30, textFill).replace('<text', '<text text-anchor="middle"').replace(`x="68"`, `x="82"`)}`, "0 0 164 100");

const png = async (s, file, w, h, bg) => {
  let img = sharp(Buffer.from(s), { density: 384 }).resize(w, h, { fit: "contain", background: bg || { r: 0, g: 0, b: 0, alpha: 0 } });
  await img.png().toFile(file);
};

const targets = process.argv[2] ? process.argv.slice(2) : ["frontend/public", "marketing/public"];
for (const dir of targets) {
  fs.mkdirSync(dir, { recursive: true });
  for (const [f, s] of Object.entries(out)) fs.writeFileSync(path.join(dir, f), s);
  await png(svg(mark()), `${dir}/logo.png`, 512, 512);
  await png(lockup(INK, INK), `${dir}/logo-horizontal.png`, 1100, 240);
  await png(stacked(INK, INK), `${dir}/logo-vertical.png`, 820, 500);
  await png(lockup(PAPER, PAPER), `${dir}/logowhite.png`, 1100, 240);
  await png(stacked(PAPER, PAPER), `${dir}/logo-vertical-white.png`, 820, 500);
  // favicons / app icons: mark on ink tile (matches kit "App icon")
  const tile = (size, radius) => svg(
    `<rect width="100" height="100" rx="${radius}" fill="${INK}"/><g transform="translate(14 14) scale(1.5)">${mark({ eye: PAPER })}</g>`, "0 0 100 100");
  await png(tile(0, 0), `${dir}/apple-touch-icon.png`, 180, 180);
  await png(tile(0, 22), `${dir}/favicon-16x16.png`, 16, 16);
  await png(tile(0, 22), `${dir}/favicon-32x32.png`, 32, 32);
  await png(tile(0, 22), `${dir}/android-chrome-192x192.png`, 192, 192);
  await png(tile(0, 22), `${dir}/android-chrome-512x512.png`, 512, 512);
  if (dir.includes("marketing")) {
    await png(tile(0, 22), `${dir}/icon.png`, 512, 512);
    await png(tile(0, 22), `${dir}/apple-icon.png`, 180, 180);
    await png(tile(0, 22), `app/icon.png`, 512, 512);
    await png(tile(0, 22), `app/apple-icon.png`, 180, 180);
    const og = svg(
      `<rect width="1200" height="630" fill="${PAPER}"/>
       <g transform="translate(80 90) scale(2.6)">${mark()}</g>
       <text x="240" y="205" font-family="Geist" font-weight="700" font-size="84" letter-spacing="-2.5" fill="${INK}">GRC Eye</text>
       <text x="80" y="400" font-family="Geist" font-weight="700" font-size="76" letter-spacing="-3" fill="${INK}">See every risk before</text>
       <text x="80" y="486" font-family="Geist" font-weight="700" font-size="76" letter-spacing="-3" fill="${INK}">it becomes one.</text>
       <text x="80" y="560" font-family="Geist Mono" font-weight="500" font-size="24" letter-spacing="3" fill="#5B6068">GOVERNANCE · RISK · COMPLIANCE</text>
       <rect x="0" y="618" width="1200" height="12" fill="${BLUE}"/>`, "0 0 1200 630");
    await png(og, `${dir}/og-image.png`, 1200, 630);
  }
}
