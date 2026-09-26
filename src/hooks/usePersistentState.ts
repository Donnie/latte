import { useEffect, useState } from "react";
import { readJson, writeJson } from "../lib/storage";

export function usePersistentState<T>(key: string, fallback: T) {
  const [value, setValue] = useState<T>(() => readJson(key, fallback));

  useEffect(() => {
    if (value === fallback) return;
    writeJson(key, value);
  }, [key, value, fallback]);

  return [value, setValue] as const;
}
