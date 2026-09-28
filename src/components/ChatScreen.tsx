import { useRef, useState } from "react";
import { languageName, OPTIONS_PER_REQUEST } from "../constants";
import { soleOption } from "../lib/text";
import {
  fetchHasGrammarErrors,
  streamCorrectionOptions,
  streamTranslationOptions,
  type CompletionResult,
} from "../lib/openrouter";
import { uuid } from "../lib/uuid";
import type { ChatLog, ChatStore, Message, Pending, PendingKind, Settings, Side, Theme } from "../types";
import ChatPane from "./ChatPane";
import GitHubLink from "./GitHubLink";
import ThemeToggle from "./ThemeToggle";
import ToggleSwitch from "./ToggleSwitch";
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

function optionCountFor(showOptions: boolean): number {
  return showOptions ? OPTIONS_PER_REQUEST : 1;
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
  const streamsRef = useRef<
    Partial<
      Record<
        Side,
        { requestId: string; kind: PendingKind; aborts: Array<() => void>; promises: Promise<CompletionResult>[] }
      >
    >
  >({});
  const pendingRequestRef = useRef<Partial<Record<Side, string>>>({});
  const pickedIndexRef = useRef<Partial<Record<Side, number>>>({});
  const inputBlocked = pending.left !== undefined || pending.right !== undefined;

  async function handleSend(side: Side, text: string) {
    if (settings.grammarCheck[side]) {
      await grammarCheck(side, text);
    } else {
      await postForTranslation(side, uuid(), text);
    }
  }

  function handleToggleGrammarCheck(side: Side, enabled: boolean) {
    onSettingsChange({
      ...settings,
      grammarCheck: { ...settings.grammarCheck, [side]: enabled },
    });
  }

  function handleToggleFormality(formal: boolean) {
    onSettingsChange({
      ...settings,
      formality: formal ? "formal" : "informal",
    });
  }

  async function grammarCheck(side: Side, text: string) {
    const language = languageName(side === "left" ? settings.source : settings.target);
    const optionCount = optionCountFor(settings.showOptions);

    controllers.current[side]?.abort();
    const controller = new AbortController();
    controllers.current[side] = controller;
    abortStreams(side);
    abortStreams(otherSide(side));
    const requestId = uuid();

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

      if (!check.hasErrors) {
        await postForTranslation(side, requestId, text);
        return;
      }

      const patchOption = (index: number, full: string) => {
        setPending((prev) => {
          const current = prev[side];
          if (!current || current.requestId !== requestId) return prev;
          if (current.pickedIndex !== undefined && current.pickedIndex !== index) return prev;
          if (current.options[index] === full) return prev;
          const options = current.options.map((option, i) => (i === index ? full : option));
          return { ...prev, [side]: { ...current, options } };
        });
      };

      const markSettled = (index: number, content: string) => {
        setPending((prev) => {
          const current = prev[side];
          if (!current || current.requestId !== requestId) return prev;
          const options = current.options.map((option, i) => (i === index ? content : option));
          const settled = (current.settled ?? current.options.map(() => false)).map((done, i) =>
            i === index ? true : done,
          );
          return { ...prev, [side]: { ...current, options, settled } };
        });
      };

      const markReady = () => {
        setPending((prev) => {
          const current = prev[side];
          if (!current || current.requestId !== requestId || current.status !== "streaming") return prev;
          return { ...prev, [side]: { ...current, status: "corrections" } };
        });
      };

      setPendingFor(side, {
        requestId,
        kind: "grammar",
        status: "streaming",
        sourceText: text,
        options: Array.from({ length: optionCount }, () => ""),
        settled: Array.from({ length: optionCount }, () => false),
        error: "",
      });

      const aborts: Array<() => void> = [];
      const promises: Promise<CompletionResult>[] = [];
      const finals = Array.from({ length: optionCount }, () => "");
      let settledCount = 0;

      for (let index = 0; index < optionCount; index += 1) {
        const handle = streamCorrectionOptions(
          { apiKey, model: settings.translationModel, text, language },
          (full) => patchOption(index, full),
        );
        aborts.push(handle.abort);
        promises.push(handle.promise);
        void handle.promise.then(
          (result) => {
            if (!isCurrentRequest(side, requestId)) return;
            onAddCost(result.cost);
            finals[index] = result.content;
            settledCount += 1;
            markSettled(index, result.content);
            if (settledCount !== optionCount) return;
            const only = soleOption(finals);
            if (only !== undefined && pickedIndexRef.current[side] === undefined) {
              delete streamsRef.current[side];
              void postForTranslation(side, requestId, only);
              return;
            }
            markReady();
          },
          (error) => {
            if (error instanceof DOMException && error.name === "AbortError") return;
            if (!isCurrentRequest(side, requestId)) return;
            if (pickedIndexRef.current[side] !== undefined && pickedIndexRef.current[side] !== index) return;
            setPendingFor(side, {
              requestId,
              kind: "grammar",
              status: "error",
              sourceText: text,
              options: [],
              error: error instanceof Error ? error.message : "Something went wrong.",
            });
          },
        );
      }

      streamsRef.current[side] = { requestId, kind: "grammar", aborts, promises };
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
    const optionCount = optionCountFor(settings.showOptions);

    controllers.current[inputSide]?.abort();
    const controller = new AbortController();
    controllers.current[inputSide] = controller;
    abortStreams(targetSide);
    const requestId = uuid();

    setPendingFor(targetSide, {
      requestId,
      kind: "translation",
      status: "streaming",
      sourceText: text,
      options: Array.from({ length: optionCount }, () => ""),
      settled: Array.from({ length: optionCount }, () => false),
      error: "",
    });

    const patchOption = (index: number, full: string) => {
      setPending((prev) => {
        const current = prev[targetSide];
        if (!current || current.requestId !== requestId) return prev;
        if (current.pickedIndex !== undefined && current.pickedIndex !== index) return prev;
        if (current.options[index] === full) return prev;
        const options = current.options.map((option, i) => (i === index ? full : option));
        return { ...prev, [targetSide]: { ...current, options } };
      });
    };

    const markSettled = (index: number, content: string) => {
      setPending((prev) => {
        const current = prev[targetSide];
        if (!current || current.requestId !== requestId) return prev;
        const options = current.options.map((option, i) => (i === index ? content : option));
        const settled = (current.settled ?? current.options.map(() => false)).map((done, i) =>
          i === index ? true : done,
        );
        return { ...prev, [targetSide]: { ...current, options, settled } };
      });
    };

    const markReady = () => {
      setPending((prev) => {
        const current = prev[targetSide];
        if (!current || current.requestId !== requestId || current.status !== "streaming") return prev;
        return { ...prev, [targetSide]: { ...current, status: "ready" } };
      });
    };

    const aborts: Array<() => void> = [];
    const promises: Promise<CompletionResult>[] = [];
    const finals = Array.from({ length: optionCount }, () => "");
    let settledCount = 0;

    for (let index = 0; index < optionCount; index += 1) {
      const handle = streamTranslationOptions(
        {
          apiKey,
          model: settings.translationModel,
          text,
          sourceLanguage,
          targetLanguage,
          formality: settings.formality,
        },
        (full) => patchOption(index, full),
      );
      aborts.push(handle.abort);
      promises.push(handle.promise);
      void handle.promise.then(
        (result) => {
          if (!isCurrentRequest(targetSide, requestId)) return;
          onAddCost(result.cost);
          finals[index] = result.content;
          settledCount += 1;
          markSettled(index, result.content);
          if (settledCount !== optionCount) return;
          const only = soleOption(finals);
          if (only !== undefined && pickedIndexRef.current[targetSide] === undefined) {
            delete streamsRef.current[targetSide];
            appendMessage(targetSide, only);
            clearPending(targetSide);
            return;
          }
          markReady();
        },
        (error) => {
          if (error instanceof DOMException && error.name === "AbortError") return;
          if (!isCurrentRequest(targetSide, requestId)) return;
          if (pickedIndexRef.current[targetSide] !== undefined && pickedIndexRef.current[targetSide] !== index) return;
          setPendingFor(targetSide, {
            requestId,
            kind: "translation",
            status: "error",
            sourceText: text,
            options: [],
            error: error instanceof Error ? error.message : "Something went wrong.",
          });
        },
      );
    }

    streamsRef.current[targetSide] = { requestId, kind: "translation", aborts, promises };
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

  function handlePick(targetSide: Side, index: number) {
    const state = pending[targetSide];
    if (!state) return;
    pickedIndexRef.current[targetSide] = index;
    setPending((prev) => {
      const current = prev[targetSide];
      if (!current || current.requestId !== state.requestId) return prev;
      return { ...prev, [targetSide]: { ...current, pickedIndex: index } };
    });
    const entry = streamsRef.current[targetSide];
    if (entry && entry.requestId === state.requestId) {
      entry.aborts.forEach((abort, i) => {
        if (i !== index) abort();
      });
      void entry.promises[index].then(
        (result) => {
          if (!isCurrentRequest(targetSide, entry.requestId)) return;
          appendMessage(targetSide, result.content);
          clearPending(targetSide);
          delete streamsRef.current[targetSide];
        },
        () => {
          /* cleared or superseded mid-stream — the creation-time handler owns error UI */
        },
      );
      return;
    }
    if (state.options[index]) {
      appendMessage(targetSide, state.options[index]);
    }
    clearPending(targetSide);
  }

  function handlePickCorrection(side: Side, index: number) {
    const state = pending[side];
    if (!state || state.kind !== "grammar") return;
    pickedIndexRef.current[side] = index;
    setPending((prev) => {
      const current = prev[side];
      if (!current || current.requestId !== state.requestId) return prev;
      return { ...prev, [side]: { ...current, pickedIndex: index } };
    });
    const entry = streamsRef.current[side];
    if (entry && entry.requestId === state.requestId) {
      entry.aborts.forEach((abort, i) => {
        if (i !== index) abort();
      });
      void entry.promises[index].then(
        (result) => {
          if (!isCurrentRequest(side, entry.requestId)) return;
          delete streamsRef.current[side];
          void postForTranslation(side, entry.requestId, result.content);
        },
        () => {
          /* cleared or superseded mid-stream — the creation-time handler owns error UI */
        },
      );
      return;
    }
    if (state.options[index]) {
      void postForTranslation(side, state.requestId, state.options[index]);
    }
  }

  function handleSendOriginal(side: Side) {
    const state = pending[side];
    if (!state) return;
    abortStreams(side);
    void postForTranslation(side, state.requestId, state.sourceText);
  }

  function handleClear(side: Side) {
    dismissPending(side);
    onClearSide(chatKey, side);
  }

  function appendMessage(side: Side, text: string) {
    onAppendMessage(chatKey, { id: uuid(), side, text, createdAt: Date.now() });
  }

  function stopped(controller: AbortController, side: Side, requestId: string): boolean {
    if (!controller.signal.aborted) return false;
    clearPendingIfCurrent(side, requestId);
    return true;
  }

  function setPendingFor(side: Side, value: Pending) {
    pendingRequestRef.current[side] = value.requestId;
    setPending((prev) => ({ ...prev, [side]: value }));
  }

  function isCurrentRequest(side: Side, requestId: string) {
    return pendingRequestRef.current[side] === requestId;
  }

  function clearPending(side: Side) {
    delete pendingRequestRef.current[side];
    delete pickedIndexRef.current[side];
    setPending((prev) => {
      const next = { ...prev };
      delete next[side];
      return next;
    });
  }

  function clearPendingIfCurrent(side: Side, requestId: string) {
    if (pendingRequestRef.current[side] !== requestId) return;
    delete pendingRequestRef.current[side];
    setPending((prev) => {
      if (prev[side]?.requestId !== requestId) return prev;
      const next = { ...prev };
      delete next[side];
      return next;
    });
  }

  function abortStreams(side: Side) {
    const entry = streamsRef.current[side];
    if (!entry) return;
    delete streamsRef.current[side];
    entry.aborts.forEach((abort) => abort());
  }

  function dismissPending(side: Side) {
    abortStreams(side);
    clearPending(side);
  }

  return (
    <div className={styles.screen}>
      <header className={styles.header}>
        <div className={styles.brandCluster}>
          <span className={styles.brand}>☕ Latte</span>
          <GitHubLink />
        </div>
        <div className={styles.pairInfo}>
          <span className={styles.pair}>
            {languageName(settings.source)} ⇄ {languageName(settings.target)}
          </span>
        </div>
        <div className={styles.actions}>
          <div className={styles.formality}>
            <ToggleSwitch
              label="Formal"
              checked={settings.formality === "formal"}
              onChange={handleToggleFormality}
            />
          </div>
          <div className={styles.tools}>
            <ThemeToggle theme={theme} onToggle={onToggleTheme} />
            <span className={styles.costChip} title="Total OpenRouter spend on this device">
              Σ {formatCost(totalCost)}
            </span>
          </div>
          <div className={styles.session}>
            <button
              type="button"
              className={styles.iconButton}
              onClick={onOpenSettings}
              aria-label="Translation settings"
            >
              <span className={styles.buttonIcon} aria-hidden="true">⚙︎</span>
              <span className={styles.buttonLabel}>Settings</span>
            </button>
            <button
              type="button"
              className={styles.iconButton}
              onClick={onLogout}
              aria-label="Log out and clear all stored data"
            >
              <span className={styles.buttonIcon} aria-hidden="true">⎋</span>
              <span className={styles.buttonLabel}>Log out</span>
            </button>
          </div>
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
          onPick={(index) => handlePick("left", index)}
          onPickCorrection={(index) => handlePickCorrection("left", index)}
          onSendOriginal={() => handleSendOriginal("left")}
          onDismiss={() => dismissPending("left")}
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
          onPick={(index) => handlePick("right", index)}
          onPickCorrection={(index) => handlePickCorrection("right", index)}
          onSendOriginal={() => handleSendOriginal("right")}
          onDismiss={() => dismissPending("right")}
          onRetry={() => handleRetry("right")}
          onDeleteMessage={(messageId) => onRemoveMessage(chatKey, messageId)}
          onClear={() => handleClear("right")}
        />
      </main>
    </div>
  );
}
