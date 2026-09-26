import { STORAGE_KEYS } from "../constants";
import { readJson, writeJson } from "./storage";
import type { Theme } from "../types";

const STORAGE_KEY = STORAGE_KEYS.theme;

export function initialTheme(): Theme {
  return readJson<Theme>(STORAGE_KEY, systemTheme());
}

export function storeTheme(theme: Theme): void {
  writeJson(STORAGE_KEY, theme);
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}

function systemTheme(): Theme {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}