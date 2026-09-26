import type { ChatStore, Language } from "./types";

export const MODEL = "z-ai/glm-5.3-flash";
export const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
export const OPTIONS_PER_REQUEST = 3;

export const STORAGE_KEYS = {
  apiKey: "latte.apiKey",
  settings: "latte.settings",
  chats: "latte.chats",
} as const;

export const EMPTY_CHATS: ChatStore = {};

export const LANGUAGES: Language[] = [
  { code: "en", name: "English", native: "English" },
  { code: "de", name: "German", native: "Deutsch" },
  { code: "fr", name: "French", native: "Français" },
  { code: "es", name: "Spanish", native: "Español" },
  { code: "it", name: "Italian", native: "Italiano" },
  { code: "pt", name: "Portuguese", native: "Português" },
  { code: "nl", name: "Dutch", native: "Nederlands" },
  { code: "pl", name: "Polish", native: "Polski" },
  { code: "ru", name: "Russian", native: "Русский" },
  { code: "tr", name: "Turkish", native: "Türkçe" },
  { code: "ar", name: "Arabic", native: "العربية" },
  { code: "zh", name: "Chinese", native: "中文" },
  { code: "ja", name: "Japanese", native: "日本語" },
  { code: "ko", name: "Korean", native: "한국어" },
];

export function languageName(code: string): string {
  return LANGUAGES.find((language) => language.code === code)?.name ?? code;
}
