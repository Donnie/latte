export function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch (error) {
    console.warn(`Latte could not read "${key}" from local storage.`, error);
    return fallback;
  }
}

export function writeJson(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.warn(`Latte could not write "${key}" to local storage.`, error);
  }
}

export function clearAppStorage(keys: readonly string[]): void {
  for (const key of keys) {
    try {
      window.localStorage.removeItem(key);
    } catch (error) {
      console.warn(`Latte could not remove "${key}" from local storage.`, error);
    }
  }
}
