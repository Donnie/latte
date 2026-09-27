import { DECISIONS_URL, MODELS_URL, OPENROUTER_URL, OPTIONS_PER_REQUEST } from "../constants";
import { normalizeMultiline } from "./text";
import type { Formality } from "../types";

export class OpenRouterError extends Error {}

export type ModelKind = "text" | "decisions";

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

interface DecisionsResponse {
  error?: { message?: string };
  answers?: Record<string, { type?: unknown; noul?: unknown }>;
  usage?: { cost?: unknown };
}

interface ModelSummary {
  id?: unknown;
  architecture?: { output_modalities?: unknown };
}

export interface CompletionResult {
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

export async function fetchAvailableModels(kind: ModelKind = "text"): Promise<string[]> {
  const url = kind === "decisions" ? `${MODELS_URL}?output_modalities=decisions` : MODELS_URL;
  const response = await fetch(url);
  if (!response.ok) {
    throw new OpenRouterError(`Could not load models — ${response.statusText || "request failed"}`);
  }
  const payload = (await response.json()) as { data?: ModelSummary[] };
  if (!Array.isArray(payload.data)) {
    throw new OpenRouterError("Unexpected response from OpenRouter.");
  }
  const ids = payload.data
    .filter((model) => kind !== "decisions" || outputsDecisions(model))
    .map((model) => (typeof model.id === "string" ? model.id : ""))
    .filter((id) => id.length > 0)
    .sort((a, b) => a.localeCompare(b));
  if (ids.length === 0) {
    throw new OpenRouterError("No models available.");
  }
  return ids;
}

function outputsDecisions(model: ModelSummary): boolean {
  const modalities = model.architecture?.output_modalities;
  return Array.isArray(modalities) && modalities.includes("decisions");
}

export async function fetchHasGrammarErrors(request: ProofreadRequest): Promise<HasErrorsResult> {
  const response = await fetch(DECISIONS_URL, {
    method: "POST",
    headers: buildHeaders(request.apiKey),
    body: JSON.stringify({
      model: request.model,
      state: { language: request.language, text: request.text },
      questions: {
        has_errors: {
          type: "noul",
          instructions:
            "Check the text carefully for mistakes in the given language. Count as mistakes: misspellings, missing or wrong umlauts (e.g. 'konnen' for 'können'), missing noun capitals, wrong articles, cases or word endings, wrong verb forms, and punctuation errors. Do not count as mistakes: casual style, slang, emoji, names, quotes, URLs, code, informal wording, and a missing final period.",
          criteria: {
            true: "The text contains at least one misspelling, wrong umlaut, wrong article, wrong case, wrong verb form or punctuation error.",
            false: "The text is correctly spelled and grammatical; informal or casual style alone is not an error.",
          },
        },
      },
    }),
    signal: request.signal,
  });

  if (!response.ok) {
    throw new OpenRouterError(await describeHttpError(response));
  }

  const payload = (await response.json()) as DecisionsResponse;
  if (payload.error) {
    throw new OpenRouterError(payload.error.message ?? "OpenRouter returned an error.");
  }
  const answer = payload.answers?.has_errors;
  if (answer?.type !== "noul" || typeof answer.noul !== "number" || !Number.isFinite(answer.noul)) {
    throw new OpenRouterError("Unexpected response from OpenRouter.");
  }
  const cost = typeof payload.usage?.cost === "number" ? payload.usage.cost : 0;
  return { hasErrors: answer.noul > 0.5, cost };
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

export interface StreamedCompletion {
  promise: Promise<CompletionResult>;
  abort(): void;
}

export function streamTranslationOptions(
  request: TranslationRequest,
  onDelta: (full: string) => void,
): StreamedCompletion {
  return streamChatCompletion(
    request,
    [
      { role: "system", content: buildTranslationPrompt(request) },
      { role: "user", content: request.text },
    ],
    0.8,
    onDelta,
  );
}

const NO_EM_DASH_RULE =
  "Never use the em dash (—) anywhere in the output; rephrase with commas, colons, parentheses or full stops instead.";

function buildCorrectionPrompt(language: string): string {
  return [
    "You are a proofreading assistant.",
    `Correct the user's text written in ${language}: fix spelling, grammar and punctuation.`,
    "Preserve meaning, tone and wording; do not add or remove information.",
    "Preserve the line breaks and paragraph structure of the user's text in every corrected version.",
    `Give up to ${OPTIONS_PER_REQUEST} corrected versions, all equally valid, varying only in minor punctuation or phrasing choices.`,
    "Keep names, numbers, URLs and code unchanged.",
    NO_EM_DASH_RULE,
    "Reply with strict JSON only, no markdown, exactly in this shape:",
    '{"options": ["<correction 1>", "<correction 2>", "<correction 3>"]}',
    "Each option is a single JSON string that may span several lines; encode any line break inside it as \\n.",
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
    "Give exactly one translation: natural and idiomatic.",
    "The user's text may contain several lines or paragraphs; keep the same line breaks and paragraph structure.",
    "Keep names, numbers, URLs and code unchanged.",
    NO_EM_DASH_RULE,
    "Reply with the translation only: no preamble, no quotes around it, no explanations.",
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

interface StreamChunk {
  error?: { message?: string };
  choices?: Array<{ delta?: { content?: unknown } }>;
  usage?: { cost?: unknown };
}

function streamChatCompletion(
  request: RequestBase & { model: string },
  messages: ChatMessage[],
  temperature: number | undefined,
  onDelta: (full: string) => void,
): StreamedCompletion {
  const controller = new AbortController();
  const promise = readStreamedCompletion(request, controller.signal, messages, temperature, onDelta);
  return { promise, abort: () => controller.abort() };
}

async function readStreamedCompletion(
  request: RequestBase & { model: string },
  signal: AbortSignal,
  messages: ChatMessage[],
  temperature: number | undefined,
  onDelta: (full: string) => void,
): Promise<CompletionResult> {
  const body: Record<string, unknown> = {
    model: request.model,
    messages,
    stream: true,
    usage: { include: true },
  };
  if (temperature !== undefined) body.temperature = temperature;

  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: buildHeaders(request.apiKey),
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    throw new OpenRouterError(await describeHttpError(response));
  }
  if (!response.body) {
    throw new OpenRouterError("OpenRouter returned an empty stream.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let cost = 0;
  let stopped = false;

  const handleLine = (rawLine: string): "continue" | "stop" => {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith(":") || !line.startsWith("data:")) return "continue";
    const data = line.slice(5).trim();
    if (data === "[DONE]") return "stop";
    let chunk: StreamChunk;
    try {
      chunk = JSON.parse(data) as StreamChunk;
    } catch {
      return "continue";
    }
    if (chunk.error) {
      throw new OpenRouterError(chunk.error.message ?? "OpenRouter returned an error.");
    }
    const delta = chunk.choices?.[0]?.delta?.content;
    if (typeof delta === "string" && delta.length > 0) {
      content += delta;
      onDelta(content);
    }
    if (typeof chunk.usage?.cost === "number") cost = chunk.usage.cost;
    return "continue";
  };

  while (!stopped) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (handleLine(line) === "stop") {
        stopped = true;
        break;
      }
    }
  }
  if (!stopped && buffer.length > 0) handleLine(buffer);

  if (content.length === 0) {
    throw new OpenRouterError("OpenRouter returned an empty translation.");
  }
  return { content: cleanSingleTranslation(content), cost };
}

function cleanSingleTranslation(raw: string): string {
  const normalized = normalizeMultiline(raw).trim();
  const paired = normalized.match(/^“([\s\S]*)”$/) ?? normalized.match(/^"([\s\S]*)"$/);
  return stripEmDashes(paired ? paired[1].trim() : normalized);
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

export function parseOptions(raw: string): string[] {
  const jsonText = extractJson(raw);
  if (jsonText) {
    const parsed = parseOptionsJson(jsonText);
    if (parsed) return parsed;
  }
  return parsePlainLines(raw);
}

function parseOptionsJson(jsonText: string): string[] | null {
  for (const candidate of [jsonText, escapeRawNewlines(jsonText)]) {
    try {
      const parsed = JSON.parse(candidate) as { options?: unknown };
      if (!Array.isArray(parsed.options)) continue;
      const options = parsed.options
        .map((option) => (typeof option === "string" ? normalizeMultiline(option) : ""))
        .filter((option) => option.length > 0);
      if (options.length > 0) return options.slice(0, OPTIONS_PER_REQUEST).map(stripEmDashes);
    } catch {
      continue;
    }
  }
  return null;
}

function escapeRawNewlines(json: string): string {
  let result = "";
  let inString = false;
  for (let index = 0; index < json.length; index += 1) {
    const char = json[index];
    if (inString && char === "\\") {
      result += char + (json[index + 1] ?? "");
      index += 1;
      continue;
    }
    if (char === '"') inString = !inString;
    if (inString && char === "\n") {
      result += "\\n";
      continue;
    }
    if (inString && (char === "\r" || char === "\t")) {
      result += char === "\t" ? "\\t" : "";
      continue;
    }
    result += char;
  }
  return result;
}

function stripEmDashes(text: string): string {
  return text
    .replace(/[ \t]*—[ \t]*/g, ", ")
    .replace(/,[ \t]*([.,!?;:…])/g, "$1")
    .replace(/,\s*$/, "")
    .trim();
}

function parsePlainLines(raw: string): string[] {
  const lines = normalizeMultiline(raw)
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
