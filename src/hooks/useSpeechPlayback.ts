import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { synthesizeSpeech } from "../lib/openrouter";
import {
  beginSpeech,
  completeSpeech,
  failSpeech,
  getSpeechSnapshot,
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
}

export function useSpeechPlayback({ apiKey, model, voice, messages }: SpeechPlaybackOptions): SpeechControls {
  const snapshot = useSyncExternalStore(subscribeSpeech, getSpeechSnapshot, getSpeechSnapshot);
  const [active, setActiveState] = useState<ActiveClip | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const loadedUrl = useRef<string | null>(null);
  const activeRef = useRef<ActiveClip | null>(null);
  const wantPlay = useRef<string | null>(null);
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

  function play(message: Message) {
    const existing = speechFileUrl(message.id);
    if (existing) {
      wantPlay.current = message.id;
      playUrl(message.id, existing);
      return;
    }
    if (beginSpeech(message.id) !== "ready") return;
    wantPlay.current = message.id;
    const requestEpoch = speechEpoch();
    void synthesizeSpeech({ apiKey, model, voice, text: message.text })
      .then((result) => {
        const url = completeSpeech(message.id, requestEpoch, result.bytes);
        if (url && mounted.current && wantPlay.current === message.id) playUrl(message.id, url);
      })
      .catch((error: unknown) => {
        const detail = error instanceof Error ? error.message : "Could not play speech.";
        failSpeech(message.id, requestEpoch, detail);
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
    const existing = speechFileUrl(message.id);
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
  };
}
