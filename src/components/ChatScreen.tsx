import { useRef, useState } from "react";
import { languageName } from "../constants";
import { fetchCorrectionOptions, fetchHasGrammarErrors, fetchTranslationOptions } from "../lib/openrouter";
import type { ChatLog, ChatStore, Message, Pending, Settings, Side, Theme } from "../types";
import ChatPane from "./ChatPane";
import ThemeToggle from "./ThemeToggle";
import styles from "./ChatScreen.module.css";

interface ChatScreenProps {
  settings: Settings;
  apiKey: string;
  chats: ChatStore;
  totalCost: number;
  theme: Theme;
  onToggleTheme(): void;
  onAppendMessage(chatKey: string, message: Message): void;
  onRemoveMessage(chatKey: string, messageId: string): void;
  onClearSide(chatKey: string, side: Side): void;
  onAddCost(cost: number): void;
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

function formatCost(cost: number): string {
  if (cost <= 0) return "$0.00";
  if (cost < 0.01) return `$${cost.toFixed(6)}`;
  if (cost < 1) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(2)}`;
}

export default function ChatScreen({
  settings,
  apiKey,
  chats,
  totalCost,
  theme,
  onToggleTheme,
  onAppendMessage,
  onRemoveMessage,
  onClearSide,
  onAddCost,
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
      const check = await fetchHasGrammarErrors({
        apiKey,
        model: settings.grammarModel,
        text,
        language,
        signal: controller.signal,
      });
      onAddCost(check.cost);
      if (stopped(controller, side, requestId)) return;
      const hasErrors = check.hasErrors;

      if (!hasErrors) {
        await postForTranslation(side, requestId, text);
        return;
      }

      const corrections = await fetchCorrectionOptions({
        apiKey,
        model: settings.translationModel,
        text,
        language,
        signal: controller.signal,
      });
      onAddCost(corrections.cost);
      if (stopped(controller, side, requestId)) return;

      setPendingFor(side, {
        requestId,
        kind: "grammar",
        status: "corrections",
        sourceText: text,
        options: corrections.options,
        error: "",
      });
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
      const result = await fetchTranslationOptions({
        apiKey,
        model: settings.translationModel,
        text,
        sourceLanguage,
        targetLanguage,
        formality: settings.formality,
        signal: controller.signal,
      });
      onAddCost(result.cost);
      if (stopped(controller, targetSide, requestId)) return;
      setPendingFor(targetSide, {
        requestId,
        kind: "translation",
        status: "ready",
        sourceText: text,
        options: result.options,
        error: "",
      });
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

  function handleClear(side: Side) {
    clearPending(side);
    onClearSide(chatKey, side);
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
        <a
          className={styles.gitLink}
          href="https://github.com/Donnie/latte"
          target="_blank"
          rel="noreferrer"
          aria-label="View source on GitHub"
          title="View source on GitHub"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
          </svg>
        </a>
        <div className={styles.pairInfo}>
          <span className={styles.pair}>
            {languageName(settings.source)} ⇄ {languageName(settings.target)}
          </span>
          <span className={styles.chip}>{settings.formality}</span>
        </div>
        <div className={styles.actions}>
          <ThemeToggle theme={theme} onToggle={onToggleTheme} />
          <span className={styles.costChip} title="Total OpenRouter spend on this device">
            Σ {formatCost(totalCost)}
          </span>
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
          onDeleteMessage={(messageId) => onRemoveMessage(chatKey, messageId)}
          onClear={() => handleClear("left")}
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
          onDeleteMessage={(messageId) => onRemoveMessage(chatKey, messageId)}
          onClear={() => handleClear("right")}
        />
      </main>
    </div>
  );
}
