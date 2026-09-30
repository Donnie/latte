import type { ChatStore, Language } from "./types";

export const DEFAULT_TRANSLATION_MODEL = "z-ai/glm-5.3-flash";
export const DEFAULT_GRAMMAR_MODEL = "~typesafe/jev-latest";
export const DEFAULT_SPEECH_MODEL = "x-ai/grok-voice-tts-1.0";
export const DEFAULT_SPEECH_VOICE = "eve";
export const LEGACY_GRAMMAR_MODEL = "typesafe/jev-router";
export const DEFAULT_MODEL_SUGGESTIONS = [DEFAULT_TRANSLATION_MODEL];
export const DEFAULT_DECISION_MODEL_SUGGESTIONS = [
  DEFAULT_GRAMMAR_MODEL,
  "typesafe/jev-1.13",
  "jaredpalmer/kev-4b",
  "respan/span-01-lite",
];
export const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
export const DECISIONS_URL = "https://openrouter.ai/api/alpha/decisions";
export const MODELS_URL = "https://openrouter.ai/api/v1/models";
export const SPEECH_URL = "https://openrouter.ai/api/v1/audio/speech";
export const KEY_URL = "https://openrouter.ai/api/v1/key";
export const AUTH_URL = "https://openrouter.ai/auth";
export const AUTH_KEYS_URL = "https://openrouter.ai/api/v1/auth/keys";
export const APP_KEY_LABEL = "Latte";
export const OPTIONS_PER_REQUEST = 3;

export const STORAGE_KEYS = {
  apiKey: "latte.apiKey",
  settings: "latte.settings",
  chats: "latte.chats",
  cost: "latte.costs",
  theme: "latte.theme",
} as const;

export const EMPTY_CHATS: ChatStore = {};

export const LANGUAGES: Language[] = [
  { code: "en", name: "English", native: "English" },
  { code: "ar", name: "Arabic", native: "العربية" },
  { code: "bn", name: "Bengali", native: "বাংলা" },
  { code: "de", name: "German", native: "Deutsch" },
  { code: "el", name: "Greek", native: "Ελληνικά" },
  { code: "es", name: "Spanish", native: "Español" },
  { code: "fr", name: "French", native: "Français" },
  { code: "hi", name: "Hindi", native: "हिन्दी" },
  { code: "it", name: "Italian", native: "Italiano" },
  { code: "ja", name: "Japanese", native: "日本語" },
  { code: "ko", name: "Korean", native: "한국어" },
  { code: "nl", name: "Dutch", native: "Nederlands" },
  { code: "pl", name: "Polish", native: "Polski" },
  { code: "pt", name: "Portuguese", native: "Português" },
  { code: "ru", name: "Russian", native: "Русский" },
  { code: "tr", name: "Turkish", native: "Türkçe" },
  { code: "zh", name: "Chinese", native: "中文" },
];

export function languageName(code: string): string {
  return LANGUAGES.find((language) => language.code === code)?.name ?? code;
}
