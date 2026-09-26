import { MODEL, OPENROUTER_URL, OPTIONS_PER_REQUEST } from "../constants";
import type { Formality } from "../types";

export class OpenRouterError extends Error {}

interface TranslationRequest {
  apiKey: string;
  text: string;
  sourceLanguage: string;
  targetLanguage: string;
  formality: Formality;
  signal?: AbortSignal;
}

interface OpenRouterResponse {
  error?: { message?: string };
  choices?: Array<{ message?: { content?: unknown } }>;
}

export async function fetchTranslationOptions(request: TranslationRequest): Promise<string[]> {
  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${request.apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": window.location.origin,
      "X-Title": "Latte Translator",
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: buildSystemPrompt(request) },
        { role: "user", content: request.text },
      ],
      temperature: 0.8,
    }),
    signal: request.signal,
  });

  if (!response.ok) {
    throw new OpenRouterError(await describeHttpError(response));
  }

  const payload = (await response.json()) as OpenRouterResponse;
  if (payload.error) {
    throw new OpenRouterError(payload.error.message ?? "OpenRouter returned an error.");
  }

  const content = payload.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new OpenRouterError("Unexpected response from OpenRouter.");
  }

  return parseOptions(content);
}

function buildSystemPrompt(request: TranslationRequest): string {
  const register =
    request.formality === "formal"
      ? "formal and polite (e.g. the 'Sie'/'vous' register where the language distinguishes)"
      : "casual and friendly (e.g. the 'du'/'tu' register where the language distinguishes)";

  return [
    "You are a professional translator.",
    `Translate the user's text from ${request.sourceLanguage} into ${request.targetLanguage}.`,
    `Use a ${register} register.`,
    `Give exactly ${OPTIONS_PER_REQUEST} alternative translations: same meaning, natural and idiomatic, with varied wording and structure.`,
    "Keep names, numbers, URLs and code unchanged.",
    "Reply with strict JSON only, no markdown, exactly in this shape:",
    '{"options": ["<option 1>", "<option 2>", "<option 3>"]}',
  ].join(" ");
}

async function describeHttpError(response: Response): Promise<string> {
  let detail = response.statusText || "request failed";
  try {
    const body = (await response.json()) as OpenRouterResponse;
    if (body.error?.message) detail = body.error.message;
  } catch {
    return detail;
  }
  if (response.status === 401) return `Invalid API key — ${detail}`;
  return `OpenRouter error ${response.status} — ${detail}`;
}

function parseOptions(raw: string): string[] {
  const jsonText = extractJson(raw);
  if (jsonText) {
    try {
      const parsed = JSON.parse(jsonText) as { options?: unknown };
      if (Array.isArray(parsed.options)) {
        const options = parsed.options
          .map((option) => (typeof option === "string" ? option.trim() : ""))
          .filter((option) => option.length > 0);
        if (options.length > 0) return options.slice(0, OPTIONS_PER_REQUEST);
      }
    } catch {
      return parsePlainLines(raw);
    }
  }
  return parsePlainLines(raw);
}

function parsePlainLines(raw: string): string[] {
  const lines = raw
    .split("\n")
    .map((line) =>
      line
        .replace(/^\s*(?:[-*•]|\d+[.)])?\s*/, "")
        .replace(/^["“]|["”],?$/g, "")
        .trim(),
    )
    .filter((line) => line.length > 0);

  if (lines.length > 0) return lines.slice(0, OPTIONS_PER_REQUEST);

  throw new OpenRouterError("Could not read the options from the model response.");
}

function extractJson(raw: string): string | null {
  const cleaned = raw.replace(/```(?:json)?/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  return cleaned.slice(start, end + 1);
}
