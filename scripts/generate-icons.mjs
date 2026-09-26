import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(here, "..", "public");
const outDir = path.join(publicDir, "icons");
fs.mkdirSync(outDir, { recursive: true });

const targets = [
  { svg: "icon.svg", size: 512, file: "pwa-512.png" },
  { svg: "icon.svg", size: 192, file: "pwa-192.png" },
  { svg: "icon-maskable.svg", size: 512, file: "pwa-512-maskable.png" },
  { svg: "icon-maskable.svg", size: 180, file: "apple-touch-icon.png" },
];

const browser = await chromium.launch();
const page = await browser.newPage();

for (const { svg, size, file } of targets) {
  const source = fs.readFileSync(path.join(publicDir, svg), "utf8");
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<!doctype html><style>html,body{margin:0;padding:0}svg{display:block;width:${size}px;height:${size}px}</style>${source}`,
  );
  await page.screenshot({ path: path.join(outDir, file) });
  console.log("wrote", file);
}

await browser.close();
