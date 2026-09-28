interface SpeechSnapshot {
  loadingIds: string[];
  errors: Record<string, string>;
  fileIds: string[];
}

const files = new Map<string, string>();
const inflight = new Set<string>();
const dropped = new Set<string>();
let errors: Record<string, string> = {};
let epoch = 0;
let snapshot: SpeechSnapshot = { loadingIds: [], errors: {}, fileIds: [] };
const listeners = new Set<() => void>();

function emit() {
  snapshot = {
    loadingIds: [...inflight].sort(),
    errors: { ...errors },
    fileIds: [...files.keys()].sort(),
  };
  for (const listener of listeners) listener();
}

export function subscribeSpeech(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSpeechSnapshot(): SpeechSnapshot {
  return snapshot;
}

export function speechEpoch(): number {
  return epoch;
}

export function speechFileUrl(messageId: string): string | undefined {
  return files.get(messageId);
}

export function beginSpeech(messageId: string): "ready" | "loading" | "cached" {
  if (files.has(messageId)) return "cached";
  if (inflight.has(messageId)) return "loading";
  inflight.add(messageId);
  if (errors[messageId]) {
    const next = { ...errors };
    delete next[messageId];
    errors = next;
  }
  emit();
  return "ready";
}

export function completeSpeech(messageId: string, requestEpoch: number, bytes: ArrayBuffer): string | null {
  inflight.delete(messageId);
  if (requestEpoch !== epoch || dropped.has(messageId)) {
    emit();
    return null;
  }
  const existing = files.get(messageId);
  if (existing) {
    emit();
    return existing;
  }
  const url = URL.createObjectURL(new Blob([bytes], { type: "audio/mpeg" }));
  files.set(messageId, url);
  emit();
  return url;
}

export function failSpeech(messageId: string, requestEpoch: number, message: string) {
  inflight.delete(messageId);
  if (requestEpoch !== epoch || dropped.has(messageId)) {
    emit();
    return;
  }
  errors = { ...errors, [messageId]: message };
  emit();
}

export function dropSpeechFile(messageId: string) {
  dropped.add(messageId);
  inflight.delete(messageId);
  if (errors[messageId]) {
    const next = { ...errors };
    delete next[messageId];
    errors = next;
  }
  const url = files.get(messageId);
  if (url) URL.revokeObjectURL(url);
  files.delete(messageId);
  emit();
}

export function dropSpeechFiles(messageIds: string[]) {
  for (const messageId of messageIds) dropSpeechFile(messageId);
}

export function clearSpeechFiles() {
  epoch += 1;
  dropped.clear();
  inflight.clear();
  errors = {};
  for (const url of files.values()) URL.revokeObjectURL(url);
  files.clear();
  emit();
}
