import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, "..", "docs", "screenshots");
fs.mkdirSync(outDir, { recursive: true });

const BASE_URL = "http://localhost:4173";

const SEED_SETTINGS = {
  source: "de",
  target: "en",
  formality: "informal",
  grammarCheck: { left: true, right: true },
  translationModel: "z-ai/glm-5.3-flash",
    grammarModel: "~typesafe/jev-latest",
};

const SEED_MESSAGES = [
  { id: "seed-1", side: "left", text: "Ja super idee, last uns gerne Odyssey shauen", createdAt: 1 },
  { id: "seed-2", side: "right", text: "Yes, great idea, let's happily watch Odyssey.", createdAt: 2 },
  { id: "seed-3", side: "left", text: "gestern haben wir den ersten folge gesehen", createdAt: 3 },
  { id: "seed-4", side: "right", text: "Yesterday we watched the first episode.", createdAt: 4 },
];

async function seed(context, { withSettings = true, withChats = false, withCosts = false } = {}) {
  await context.addInitScript(
    (data) => {
      localStorage.setItem("latte.apiKey", JSON.stringify("sk-or-v1-example"));
      if (data.withSettings) localStorage.setItem("latte.settings", JSON.stringify(data.settings));
      if (data.chats) localStorage.setItem("latte.chats", JSON.stringify(data.chats));
      if (data.costs !== null) localStorage.setItem("latte.costs", JSON.stringify(data.costs));
    },
    {
      withSettings,
      settings: SEED_SETTINGS,
      chats: withChats ? { "de|en": SEED_MESSAGES } : null,
      costs: withCosts ? 0.0025 : null,
    },
  );
}

async function mockOpenRouter(context) {
  await context.route("**/api/alpha/decisions", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        answers: { has_errors: { type: "noul", noul: 0.96 } },
        usage: { cost: 0.00001 },
      }),
    });
  });
  await context.route("**/api/v1/chat/completions", async (route) => {
    const body = route.request().postDataJSON();
    const system = body?.messages?.[0]?.content ?? "";
    let content;
    if (system.includes("punctuation checker")) {
      content = JSON.stringify({ hasErrors: true });
    } else if (system.includes("proofreading assistant")) {
      content = JSON.stringify({
        options: [
          "Wir können morgen unbedingt weiterschauen.",
          "Wir können morgen auf jeden Fall weiterschauen.",
          "Wir können morgen sicher weiter schauen.",
        ],
      });
    } else {
      content = JSON.stringify({
        options: [
          "Can we keep watching tomorrow?",
          "Shall we continue watching tomorrow?",
          "Let's watch more again tomorrow, ok?",
        ],
      });
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "mock-1",
        choices: [{ message: { role: "assistant", content } }],
        usage: { cost: 0.00001 },
      }),
    });
  });
}

const browser = await chromium.launch();

const loginContext = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
});
const loginPage = await loginContext.newPage();
await loginPage.goto(BASE_URL, { waitUntil: "networkidle" });
await loginPage.screenshot({ path: path.join(outDir, "login.png") });
await loginContext.close();

const setupContext = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
});
await seed(setupContext, { withSettings: false });
const setupPage = await setupContext.newPage();
await setupPage.goto(BASE_URL, { waitUntil: "networkidle" });
await setupPage.getByText("Tonality").waitFor();
await setupPage.screenshot({ path: path.join(outDir, "setup.png") });
await setupContext.close();

const chatContext = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
});
await seed(chatContext, { withChats: true, withCosts: true });
const chatPage = await chatContext.newPage();
await chatPage.goto(BASE_URL, { waitUntil: "networkidle" });
await chatPage.getByText("Yesterday we watched the first episode.").waitFor();
await chatPage.screenshot({ path: path.join(outDir, "chat-web.png") });
await chatContext.close();

const mobileContext = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
});
await mockOpenRouter(mobileContext);
await seed(mobileContext, { withChats: true, withCosts: true });
const mobilePage = await mobileContext.newPage();
await mobilePage.goto(BASE_URL, { waitUntil: "networkidle" });
await mobilePage.getByText("Yesterday we watched the first episode.").waitFor();
await mobilePage.locator('[aria-label="Write in German"]').fill("wir konnen morgen unbedingt weiter schauen");
await mobilePage.keyboard.press("Enter");
await mobilePage.getByText("Grammar suggestions").waitFor({ timeout: 10000 });
await mobilePage.screenshot({ path: path.join(outDir, "chat-mobile.png") });
await mobileContext.close();

await browser.close();
console.log("Screenshots written to", outDir);
