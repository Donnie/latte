import { clearSpeechAudio, deleteSpeechAudio, deleteSpeechVariant, readSpeechAudio, writeSpeechAudio } from "./speechStore";

interface SpeechSnapshot {
  loadingIds: string[];
  errors: Record<string, string>;
  fileIds: string[];
}

interface SpeechClip {
  url: string;
  model: string;
  voice: string;
}

const files = new Map<string, SpeechClip>();
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

function matches(clip: SpeechClip, model: string, voice: string): boolean {
  return clip.model === model && clip.voice === voice;
}

function putClip(messageId: string, model: string, voice: string, audio: Blob): string {
  const current = files.get(messageId);
  if (current && matches(current, model, voice)) return current.url;
  if (current) URL.revokeObjectURL(current.url);
  const url = URL.createObjectURL(audio);
  files.set(messageId, { url, model, voice });
  emit();
  return url;
}

function forgetMemory(messageId: string) {
  dropped.add(messageId);
  inflight.delete(messageId);
  if (errors[messageId]) {
    const next = { ...errors };
    delete next[messageId];
    errors = next;
  }
  const clip = files.get(messageId);
  if (clip) URL.revokeObjectURL(clip.url);
  files.delete(messageId);
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

export function speechFileUrl(messageId: string, model: string, voice: string): string | undefined {
  const clip = files.get(messageId);
  if (!clip || !matches(clip, model, voice)) return undefined;
  return clip.url;
}

export async function lookupSpeech(messageId: string, model: string, voice: string): Promise<string | null> {
  const memory = speechFileUrl(messageId, model, voice);
  if (memory) return memory;
  const audio = await readSpeechAudio(messageId, model, voice);
  if (!audio || dropped.has(messageId)) return null;
  return putClip(messageId, model, voice, audio);
}

export function beginSpeech(messageId: string, model: string, voice: string): "ready" | "loading" | "cached" {
  const clip = files.get(messageId);
  if (clip && matches(clip, model, voice)) return "cached";
  if (inflight.has(messageId)) return "loading";
  if (clip) {
    URL.revokeObjectURL(clip.url);
    files.delete(messageId);
  }
  inflight.add(messageId);
  if (errors[messageId]) {
    const next = { ...errors };
    delete next[messageId];
    errors = next;
  }
  emit();
  return "ready";
}

export function completeSpeech(
  messageId: string,
  requestEpoch: number,
  bytes: ArrayBuffer,
  model: string,
  voice: string,
): string | null {
  inflight.delete(messageId);
  if (requestEpoch !== epoch || dropped.has(messageId)) {
    emit();
    return null;
  }
  return putClip(messageId, model, voice, new Blob([bytes], { type: "audio/mpeg" }));
}

export function retainSpeech(
  messageId: string,
  model: string,
  voice: string,
  bytes: ArrayBuffer,
  requestEpoch: number,
): Promise<void> {
  if (requestEpoch !== epoch || dropped.has(messageId) || bytes.byteLength === 0) return Promise.resolve();
  const audio = new Blob([bytes], { type: "audio/mpeg" });
  return writeSpeechAudio(messageId, model, voice, audio).then(async (saved) => {
    if (!saved) return;
    if (requestEpoch !== epoch || dropped.has(messageId)) await deleteSpeechVariant(messageId, model, voice);
  });
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

export function dropSpeechFile(messageId: string): Promise<void> {
  forgetMemory(messageId);
  emit();
  return deleteSpeechAudio([messageId]);
}

export function dropSpeechFiles(messageIds: string[]): Promise<void> {
  if (messageIds.length === 0) return Promise.resolve();
  for (const messageId of messageIds) forgetMemory(messageId);
  emit();
  return deleteSpeechAudio(messageIds);
}

export function clearSpeechFiles(): Promise<void> {
  epoch += 1;
  dropped.clear();
  inflight.clear();
  errors = {};
  for (const clip of files.values()) URL.revokeObjectURL(clip.url);
  files.clear();
  emit();
  return clearSpeechAudio();
}
