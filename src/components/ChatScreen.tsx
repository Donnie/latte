import { useRef, useState } from "react";
import { languageName } from "../constants";
import { fetchCorrectionOptions, fetchHasGrammarErrors, fetchTranslationOptions } from "../lib/openrouter";
import type { ChatLog, ChatStore, Message, Pending, Settings, Side } from "../types";
import ChatPane from "./ChatPane";
import styles from "./ChatScreen.module.css";

interface ChatScreenProps {
  settings: Settings;
  apiKey: string;
  chats: ChatStore;
  onAppendMessage(chatKey: string, message: Message): void;
  onSettingsChange(settings: Settings): void;
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
  onSettingsChange,
  onOpenSettings,
  onLogout,
}: ChatScreenProps) {
  const chatKey = chatKeyOf(settings);
  const stored = chats[chatKey];
  const messages: ChatLog = Array.isArray(stored) ? stored : [];

  const [pending, setPending] = useState<Partial<Record<Side, Pending>>>({});
  const controllers = useRef<Partial<Record<Side, AbortController>>>({});
  const inputBlocked = pending.left !== undefined || pending.right !== undefined;

  async function handleSend(side: Side, text: string) {
    if (settings.grammarCheck[side]) {
      await grammarCheck(side, text);
    } else {
      await postForTranslation(side, crypto.randomUUID(), text);
    }
  }

  function handleToggleGrammarCheck(side: Side, enabled: boolean) {
    onSettingsChange({
      ...settings,
      grammarCheck: { ...settings.grammarCheck, [side]: enabled },
    });
  }

  async function grammarCheck(side: Side, text: string) {
    const language = languageName(side === "left" ? settings.source : settings.target);

    controllers.current[side]?.abort();
    const controller = new AbortController();
    controllers.current[side] = controller;
    const requestId = crypto.randomUUID();

    setPendingFor(side, { requestId, kind: "grammar", status: "checking", sourceText: text, options: [], error: "" });

    try {
      const hasErrors = await fetchHasGrammarErrors({ apiKey, text, language, signal: controller.signal });
      if (stopped(controller, side, requestId)) return;

      if (!hasErrors) {
        await postForTranslation(side, requestId, text);
        return;
      }

      const options = await fetchCorrectionOptions({ apiKey, text, language, signal: controller.signal });
      if (stopped(controller, side, requestId)) return;

      setPendingFor(side, { requestId, kind: "grammar", status: "corrections", sourceText: text, options, error: "" });
    } catch (error) {
      if (stopped(controller, side, requestId)) return;
      setPendingFor(side, {
        requestId,
        kind: "grammar",
        status: "error",
        sourceText: text,
        options: [],
        error: error instanceof Error ? error.message : "Something went wrong.",
      });
    }
  }

  async function translate(inputSide: Side, text: string) {
    const targetSide = otherSide(inputSide);
    const sourceLanguage = languageName(inputSide === "left" ? settings.source : settings.target);
    const targetLanguage = languageName(inputSide === "left" ? settings.target : settings.source);

    controllers.current[inputSide]?.abort();
    const controller = new AbortController();
    controllers.current[inputSide] = controller;
    const requestId = crypto.randomUUID();

    setPendingFor(targetSide, {
      requestId,
      kind: "translation",
      status: "loading",
      sourceText: text,
      options: [],
      error: "",
    });

    try {
      const options = await fetchTranslationOptions({
        apiKey,
        text,
        sourceLanguage,
        targetLanguage,
        formality: settings.formality,
        signal: controller.signal,
      });
      if (stopped(controller, targetSide, requestId)) return;
      setPendingFor(targetSide, { requestId, kind: "translation", status: "ready", sourceText: text, options, error: "" });
    } catch (error) {
      if (stopped(controller, targetSide, requestId)) return;
      setPendingFor(targetSide, {
        requestId,
        kind: "translation",
        status: "error",
        sourceText: text,
        options: [],
        error: error instanceof Error ? error.message : "Something went wrong.",
      });
    }
  }

  async function postForTranslation(side: Side, requestId: string, text: string) {
    clearPendingIfCurrent(side, requestId);
    appendMessage(side, text);
    await translate(side, text);
  }

  async function handleRetry(side: Side) {
    const state = pending[side];
    if (!state) return;
    if (state.kind === "grammar") {
      await grammarCheck(side, state.sourceText);
    } else {
      await translate(otherSide(side), state.sourceText);
    }
  }

  function handlePick(targetSide: Side, option: string) {
    appendMessage(targetSide, option);
    clearPending(targetSide);
  }

  function handlePickCorrection(side: Side, corrected: string) {
    const state = pending[side];
    if (!state) return;
    void postForTranslation(side, state.requestId, corrected);
  }

  function handleSendOriginal(side: Side) {
    const state = pending[side];
    if (!state) return;
    void postForTranslation(side, state.requestId, state.sourceText);
  }

  function appendMessage(side: Side, text: string) {
    onAppendMessage(chatKey, { id: crypto.randomUUID(), side, text, createdAt: Date.now() });
  }

  function stopped(controller: AbortController, side: Side, requestId: string): boolean {
    if (!controller.signal.aborted) return false;
    clearPendingIfCurrent(side, requestId);
    return true;
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

  function clearPendingIfCurrent(side: Side, requestId: string) {
    setPending((prev) => {
      if (prev[side]?.requestId !== requestId) return prev;
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
          inputBlocked={inputBlocked}
          grammarCheck={settings.grammarCheck.left}
          onSend={(text) => handleSend("left", text)}
          onToggleGrammarCheck={(enabled) => handleToggleGrammarCheck("left", enabled)}
          onPick={(option) => handlePick("left", option)}
          onPickCorrection={(option) => handlePickCorrection("left", option)}
          onSendOriginal={() => handleSendOriginal("left")}
          onDismiss={() => clearPending("left")}
          onRetry={() => handleRetry("left")}
        />
        <ChatPane
          side="right"
          language={languageName(settings.target)}
          messages={messages.filter((message) => message.side === "right")}
          pending={pending.right}
          inputBlocked={inputBlocked}
          grammarCheck={settings.grammarCheck.right}
          onSend={(text) => handleSend("right", text)}
          onToggleGrammarCheck={(enabled) => handleToggleGrammarCheck("right", enabled)}
          onPick={(option) => handlePick("right", option)}
          onPickCorrection={(option) => handlePickCorrection("right", option)}
          onSendOriginal={() => handleSendOriginal("right")}
          onDismiss={() => clearPending("right")}
          onRetry={() => handleRetry("right")}
        />
      </main>
    </div>
  );
}
