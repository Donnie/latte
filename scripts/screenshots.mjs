import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, "..", "docs", "screenshots");
fs.mkdirSync(outDir, { recursive: true });

const BASE_URL = "http://localhost:4173";
const CLEAN_MESSAGE = "Wie war dein Tag heute?";
const SLOPPY_MESSAGE = "gestern haben wir den erster folge gesehen";

function readApiKey() {
  const fromEnv = process.env.OPENROUTER_API_KEY ?? process.env.KEY;
  if (fromEnv?.trim()) return fromEnv.trim();
  const envFile = path.join(here, "..", ".env");
  if (fs.existsSync(envFile)) {
    for (const line of fs.readFileSync(envFile, "utf8").split("\n")) {
      const match = line.match(/^\s*(?:KEY|OPENROUTER_API_KEY)\s*=\s*["']?([^"'\s]+)["']?\s*$/);
      if (match) return match[1];
    }
  }
  throw new Error("No OpenRouter API key found. Set OPENROUTER_API_KEY or add KEY=<key> to .env");
}

const API_KEY = readApiKey();

async function loginWithKey(page) {
  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  await page.getByLabel("OpenRouter API key").fill(API_KEY);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.getByText("Tonality").waitFor({ timeout: 30000 });
}

async function startChat(page) {
  await page.getByRole("button", { name: "Start translating" }).click();
  await page.locator('[aria-label="Write in German"]').waitFor({ timeout: 30000 });
}

async function pickFirstOption(page, regionName) {
  const noneOfThese = page
    .getByRole("region", { name: regionName })
    .getByRole("button", { name: "None of these" });
  await noneOfThese.waitFor({ timeout: 60000 });
  await noneOfThese.locator("xpath=preceding-sibling::button[1]").click();
}

async function pickFirstCorrection(page, regionName) {
  const sendAsIs = page
    .getByRole("region", { name: regionName })
    .getByRole("button", { name: "Send as is" });
  await sendAsIs.waitFor({ timeout: 60000 });
  await sendAsIs.locator("xpath=preceding-sibling::button[1]").click();
}

async function send(page, regionName, text) {
  const input = page.locator(`[aria-label="Write in ${regionName}"]`);
  await input.fill(text);
  await input.press("Enter");
}

async function exchange(page, fromRegion, toRegion, text, { expectCorrections = false } = {}) {
  await send(page, fromRegion, text);
  if (expectCorrections) {
    await page.getByText("Grammar suggestions").waitFor({ timeout: 60000 });
    await pickFirstCorrection(page, fromRegion);
  }
  await pickFirstOption(page, toRegion);
}

const browser = await chromium.launch();

// --- Desktop section -------------------------------------------------------

const desktopContext = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
});
const desktopPage = await desktopContext.newPage();

await desktopPage.goto(BASE_URL, { waitUntil: "networkidle" });
await desktopPage.screenshot({ path: path.join(outDir, "login.png") });

await loginWithKey(desktopPage);
await desktopPage.screenshot({ path: path.join(outDir, "setup.png") });

await startChat(desktopPage);
await exchange(desktopPage, "German", "English", CLEAN_MESSAGE);
await exchange(desktopPage, "German", "English", SLOPPY_MESSAGE, { expectCorrections: true });
await desktopPage.waitForTimeout(500);
await desktopPage.screenshot({ path: path.join(outDir, "chat-desktop.png") });
await desktopContext.close();

// --- Mobile section --------------------------------------------------------

const mobileContext = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});
const mobilePage = await mobileContext.newPage();

await loginWithKey(mobilePage);
await startChat(mobilePage);
await send(mobilePage, "German", SLOPPY_MESSAGE);
await mobilePage.getByText("Grammar suggestions").waitFor({ timeout: 60000 });
await mobilePage.waitForTimeout(500);
await mobilePage.screenshot({ path: path.join(outDir, "chat-mobile.png"), fullPage: true });
await mobileContext.close();

await browser.close();
console.log("Screenshots written to", outDir);