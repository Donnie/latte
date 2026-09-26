import { useRef, useState } from "react";
import { languageName } from "../constants";
import { fetchTranslationOptions } from "../lib/openrouter";
import type { ChatLog, ChatStore, Message, Pending, Settings, Side } from "../types";
import ChatPane from "./ChatPane";
import styles from "./ChatScreen.module.css";

interface ChatScreenProps {
  settings: Settings;
  apiKey: string;
  chats: ChatStore;
  onAppendMessage(chatKey: string, message: Message): void;
  onOpenSettings(): void;
  onLogout(): void;
}

export function chatKeyOf(settings: Settings): string {
  return `${settings.source}|${settings.target}`;
}

function otherSide(side: Side): Side {
  return side === "left" ? "right" : "left";
}

export default function ChatScreen({
  settings,
  apiKey,
  chats,
  onAppendMessage,
  onOpenSettings,
  onLogout,
}: ChatScreenProps) {
  const chatKey = chatKeyOf(settings);
  const stored = chats[chatKey];
  const messages: ChatLog = Array.isArray(stored) ? stored : [];

  const [pending, setPending] = useState<Partial<Record<Side, Pending>>>({});
  const controllers = useRef<Partial<Record<Side, AbortController>>>({});

  async function handleSend(side: Side, text: string) {
    appendMessage(side, text);
    await translate(side, text);
  }

  async function handleRetry(targetSide: Side) {
    const state = pending[targetSide];
    if (state) await translate(otherSide(targetSide), state.sourceText);
  }

  function handlePick(targetSide: Side, option: string) {
    appendMessage(targetSide, option);
    clearPending(targetSide);
  }

  async function translate(inputSide: Side, text: string) {
    const targetSide = otherSide(inputSide);
    const sourceLanguage = languageName(inputSide === "left" ? settings.source : settings.target);
    const targetLanguage = languageName(inputSide === "left" ? settings.target : settings.source);

    controllers.current[inputSide]?.abort();
    const controller = new AbortController();
    controllers.current[inputSide] = controller;

    setPendingFor(targetSide, { status: "loading", sourceText: text, options: [], error: "" });

    try {
      const options = await fetchTranslationOptions({
        apiKey,
        text,
        sourceLanguage,
        targetLanguage,
        formality: settings.formality,
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      setPendingFor(targetSide, { status: "ready", sourceText: text, options, error: "" });
    } catch (error) {
      if (controller.signal.aborted) return;
      setPendingFor(targetSide, {
        status: "error",
        sourceText: text,
        options: [],
        error: error instanceof Error ? error.message : "Something went wrong.",
      });
    }
  }

  function appendMessage(side: Side, text: string) {
    onAppendMessage(chatKey, { id: crypto.randomUUID(), side, text, createdAt: Date.now() });
  }

  function setPendingFor(side: Side, value: Pending) {
    setPending((prev) => ({ ...prev, [side]: value }));
  }

  function clearPending(side: Side) {
    setPending((prev) => {
      const next = { ...prev };
      delete next[side];
      return next;
    });
  }

  return (
    <div className={styles.screen}>
      <header className={styles.header}>
        <span className={styles.brand}>☕ Latte</span>
        <div className={styles.pairInfo}>
          <span className={styles.pair}>
            {languageName(settings.source)} ⇄ {languageName(settings.target)}
          </span>
          <span className={styles.chip}>{settings.formality}</span>
        </div>
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.iconButton}
            onClick={onOpenSettings}
            aria-label="Translation settings"
          >
            ⚙︎ Settings
          </button>
          <button
            type="button"
            className={styles.iconButton}
            onClick={onLogout}
            aria-label="Log out and clear all stored data"
          >
            ⎋ Log out
          </button>
        </div>
      </header>
      <main className={styles.panes}>
        <ChatPane
          side="left"
          language={languageName(settings.source)}
          messages={messages.filter((message) => message.side === "left")}
          pending={pending.left}
          onSend={(text) => handleSend("left", text)}
          onPick={(option) => handlePick("left", option)}
          onRetry={() => handleRetry("left")}
        />
        <ChatPane
          side="right"
          language={languageName(settings.target)}
          messages={messages.filter((message) => message.side === "right")}
          pending={pending.right}
          onSend={(text) => handleSend("right", text)}
          onPick={(option) => handlePick("right", option)}
          onRetry={() => handleRetry("right")}
        />
      </main>
    </div>
  );
}
