import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { synthesizeSpeech } from "../lib/openrouter";
import {
  beginSpeech,
  completeSpeech,
  failSpeech,
  getSpeechSnapshot,
  lookupSpeech,
  retainSpeech,
  speechEpoch,
  speechFileUrl,
  subscribeSpeech,
} from "../lib/speechFiles";
import type { Message } from "../types";

export type SpeechPhase = "idle" | "loading" | "playing" | "paused";

interface SpeechPlaybackOptions {
  apiKey: string;
  model: string;
  voice: string;
  messages: Message[];
}

interface ActiveClip {
  id: string;
  phase: "playing" | "paused";
}

export interface SpeechControls {
  phase(messageId: string): SpeechPhase;
  error(messageId: string): string;
  play(message: Message): void;
  pause(): void;
  resume(): void;
  replay(message: Message): void;
  download(message: Message): void;
}

function speechDownloadName(text: string): string {
  const slug = text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return `${slug || "speech"}.mp3`;
}

export function useSpeechPlayback({ apiKey, model, voice, messages }: SpeechPlaybackOptions): SpeechControls {
  const snapshot = useSyncExternalStore(subscribeSpeech, getSpeechSnapshot, getSpeechSnapshot);
  const [active, setActiveState] = useState<ActiveClip | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const loadedUrl = useRef<string | null>(null);
  const activeRef = useRef<ActiveClip | null>(null);
  const wantPlay = useRef<string | null>(null);
  const pendingSpeech = useRef(new Map<string, Promise<string | null>>());
  const mounted = useRef(true);
  const idsRef = useRef(new Set<string>());
  idsRef.current = new Set(messages.map((message) => message.id));

  function setActive(next: ActiveClip | null) {
    activeRef.current = next;
    setActiveState(next);
  }

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      audioRef.current?.pause();
    };
  }, []);

  useEffect(() => {
    if (!active || idsRef.current.has(active.id)) return;
    audioRef.current?.pause();
    activeRef.current = null;
    setActiveState(null);
  }, [messages, active]);

  function ensureAudio(): HTMLAudioElement {
    if (audioRef.current) return audioRef.current;
    const audio = new Audio();
    audio.onended = () => {
      activeRef.current = null;
      setActiveState(null);
    };
    audioRef.current = audio;
    return audio;
  }

  function playUrl(messageId: string, url: string) {
    const audio = ensureAudio();
    audio.pause();
    if (loadedUrl.current !== url) {
      audio.src = url;
      loadedUrl.current = url;
    }
    audio.currentTime = 0;
    setActive({ id: messageId, phase: "playing" });
    void audio.play().catch((error: unknown) => {
      if (!mounted.current) return;
      if (error instanceof DOMException && error.name === "AbortError") return;
      activeRef.current = null;
      setActiveState(null);
    });
  }

  function fetchSpeech(message: Message): Promise<string | null> {
    const existing = speechFileUrl(message.id, model, voice);
    if (existing) return Promise.resolve(existing);
    const inflight = pendingSpeech.current.get(message.id);
    if (inflight) return inflight;
    const promise = loadSpeech(message).finally(() => {
      pendingSpeech.current.delete(message.id);
    });
    pendingSpeech.current.set(message.id, promise);
    return promise;
  }

  async function loadSpeech(message: Message): Promise<string | null> {
    const cached = await lookupSpeech(message.id, model, voice);
    if (cached) return cached;
    if (beginSpeech(message.id, model, voice) !== "ready") return speechFileUrl(message.id, model, voice) ?? null;
    const requestEpoch = speechEpoch();
    try {
      const result = await synthesizeSpeech({ apiKey, model, voice, text: message.text });
      const url = completeSpeech(message.id, requestEpoch, result.bytes, model, voice);
      if (url) void retainSpeech(message.id, model, voice, result.bytes, requestEpoch);
      return url;
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : "Could not play speech.";
      failSpeech(message.id, requestEpoch, detail);
      return null;
    }
  }

  function play(message: Message) {
    wantPlay.current = message.id;
    void fetchSpeech(message).then((url) => {
      if (url && mounted.current && wantPlay.current === message.id) playUrl(message.id, url);
    });
  }

  function download(message: Message) {
    void fetchSpeech(message).then((url) => {
      if (!url || !mounted.current) return;
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = speechDownloadName(message.text);
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    });
  }

  function pause() {
    const current = activeRef.current;
    if (!current || current.phase !== "playing") return;
    audioRef.current?.pause();
    setActive({ id: current.id, phase: "paused" });
  }

  function resume() {
    const current = activeRef.current;
    if (!current || current.phase !== "paused") return;
    setActive({ id: current.id, phase: "playing" });
    void audioRef.current?.play().catch((error: unknown) => {
      if (error instanceof DOMException && error.name === "AbortError") return;
      activeRef.current = null;
      setActiveState(null);
    });
  }

  function replay(message: Message) {
    const existing = speechFileUrl(message.id, model, voice);
    if (!existing) return;
    wantPlay.current = message.id;
    playUrl(message.id, existing);
  }

  return {
    phase(messageId: string): SpeechPhase {
      if (snapshot.loadingIds.includes(messageId)) return "loading";
      if (active?.id === messageId) return active.phase;
      return "idle";
    },
    error(messageId: string): string {
      if (snapshot.loadingIds.includes(messageId) || active?.id === messageId) return "";
      return snapshot.errors[messageId] ?? "";
    },
    play,
    pause,
    resume,
    replay,
    download,
  };
}
