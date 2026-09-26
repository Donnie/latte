import { MODELS_URL, OPENROUTER_URL, OPTIONS_PER_REQUEST } from "../constants";
import type { Formality } from "../types";

export class OpenRouterError extends Error {}

interface RequestBase {
  apiKey: string;
  signal?: AbortSignal;
}

interface TranslationRequest extends RequestBase {
  model: string;
  text: string;
  sourceLanguage: string;
  targetLanguage: string;
  formality: Formality;
}

interface ProofreadRequest extends RequestBase {
  model: string;
  text: string;
  language: string;
}

interface ChatMessage {
  role: "system" | "user";
  content: string;
}

interface OpenRouterResponse {
  error?: { message?: string };
  choices?: Array<{ message?: { content?: unknown } }>;
  usage?: { cost?: unknown };
}

interface CompletionResult {
  content: string;
  cost: number;
}

export interface HasErrorsResult {
  hasErrors: boolean;
  cost: number;
}

export interface OptionsResult {
  options: string[];
  cost: number;
}

export async function fetchAvailableModels(): Promise<string[]> {
  const response = await fetch(MODELS_URL);
  if (!response.ok) {
    throw new OpenRouterError(`Could not load models — ${response.statusText || "request failed"}`);
  }
  const payload = (await response.json()) as { data?: Array<{ id?: unknown }> };
  if (!Array.isArray(payload.data)) {
    throw new OpenRouterError("Unexpected response from OpenRouter.");
  }
  const ids = payload.data
    .map((model) => (typeof model.id === "string" ? model.id : ""))
    .filter((id) => id.length > 0)
    .sort((a, b) => a.localeCompare(b));
  if (ids.length === 0) {
    throw new OpenRouterError("No models available.");
  }
  return ids;
}

export async function fetchHasGrammarErrors(request: ProofreadRequest): Promise<HasErrorsResult> {
  const result = await requestCompletion(
    request,
    request.model,
    [
      { role: "system", content: GRAMMAR_CHECK_PROMPT },
      { role: "user", content: `Language: ${request.language}\nText: ${request.text}` },
    ],
  );
  return { hasErrors: parseHasErrors(result.content), cost: result.cost };
}

export async function fetchCorrectionOptions(request: ProofreadRequest): Promise<OptionsResult> {
  const result = await requestCompletion(
    request,
    request.model,
    [
      { role: "system", content: buildCorrectionPrompt(request.language) },
      { role: "user", content: request.text },
    ],
    0.3,
  );
  return { options: parseOptions(result.content), cost: result.cost };
}

export async function fetchTranslationOptions(request: TranslationRequest): Promise<OptionsResult> {
  const result = await requestCompletion(
    request,
    request.model,
    [
      { role: "system", content: buildTranslationPrompt(request) },
      { role: "user", content: request.text },
    ],
    0.8,
  );
  return { options: parseOptions(result.content), cost: result.cost };
}

const GRAMMAR_CHECK_PROMPT = [
  "You are a strict grammar, spelling and punctuation checker.",
  "Decide whether the user's text contains at least one real mistake in the given language.",
  "Only count real mistakes: wrong spelling, grammar or punctuation.",
  "Ignore intentional slang, names, quotes, URLs, code and stylistic choices.",
  'Reply with strict JSON only, no markdown: {"hasErrors": true} when there is at least one mistake, {"hasErrors": false} when the text is clean.',
].join(" ");

function buildCorrectionPrompt(language: string): string {
  return [
    "You are a proofreading assistant.",
    `Correct the user's text written in ${language}: fix spelling, grammar and punctuation.`,
    "Preserve meaning, tone and wording; do not add or remove information.",
    `Give up to ${OPTIONS_PER_REQUEST} corrected versions, all equally valid, varying only in minor punctuation or phrasing choices.`,
    "Keep names, numbers, URLs and code unchanged.",
    "Reply with strict JSON only, no markdown, exactly in this shape:",
    '{"options": ["<correction 1>", "<correction 2>", "<correction 3>"]}',
  ].join(" ");
}

function buildTranslationPrompt(request: TranslationRequest): string {
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

async function requestCompletion(
  request: RequestBase,
  model: string,
  messages: ChatMessage[],
  temperature?: number,
): Promise<CompletionResult> {
  const body: Record<string, unknown> = { model, messages };
  if (temperature !== undefined) body.temperature = temperature;

  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: buildHeaders(request.apiKey),
    body: JSON.stringify(body),
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
  const cost = typeof payload.usage?.cost === "number" ? payload.usage.cost : 0;
  return { content, cost };
}

function buildHeaders(apiKey: string): HeadersInit {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "HTTP-Referer": window.location.origin,
    "X-Title": "Latte Translator",
  };
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

function parseHasErrors(content: string): boolean {
  const jsonText = extractJson(content);
  if (jsonText) {
    try {
      const parsed = JSON.parse(jsonText) as { hasErrors?: unknown };
      if (typeof parsed.hasErrors === "boolean") return parsed.hasErrors;
    } catch {
      return /\btrue\b/i.test(content);
    }
  }
  return /\btrue\b/i.test(content);
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
