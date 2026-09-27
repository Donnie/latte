import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { normalizeMultiline } from "../lib/text";
import type { Message, Pending, Side } from "../types";
import ToggleSwitch from "./ToggleSwitch";
import styles from "./ChatPane.module.css";

const INPUT_MAX_HEIGHT = 132;

interface ChatPaneProps {
  side: Side;
  language: string;
  messages: Message[];
  pending?: Pending;
  inputBlocked: boolean;
  grammarCheck: boolean;
  onSend(text: string): void;
  onToggleGrammarCheck(enabled: boolean): void;
  onPick(option: string): void;
  onPickCorrection(option: string): void;
  onSendOriginal(): void;
  onDismiss(): void;
  onRetry(): void;
  onDeleteMessage(messageId: string): void;
  onClear(): void;
}

export default function ChatPane({
  side,
  language,
  messages,
  pending,
  inputBlocked,
  grammarCheck,
  onSend,
  onToggleGrammarCheck,
  onPick,
  onPickCorrection,
  onSendOriginal,
  onDismiss,
  onRetry,
  onDeleteMessage,
  onClear,
}: ChatPaneProps) {
  const [draft, setDraft] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const copyTimer = useRef<number | null>(null);
  const isBusy = pending?.status === "checking" || pending?.status === "loading";

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages.length, pending]);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, INPUT_MAX_HEIGHT)}px`;
  }, [draft]);

  useEffect(() => () => {
    if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
  }, []);

  function handleCopy(message: Message) {
    navigator.clipboard?.writeText(message.text).then(() => {
      setCopiedId(message.id);
      if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => setCopiedId(null), 1200);
    }).catch(() => {});
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    submitDraft();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    submitDraft();
  }

  function submitDraft() {
    const text = normalizeMultiline(draft);
    if (!text || isBusy || inputBlocked) return;
    onSend(text);
    setDraft("");
  }

  function handleDismiss() {
    const text = pending?.kind === "grammar" ? pending.sourceText : "";
    onDismiss();
    if (text) setDraft(text);
  }

  return (
    <section className={styles.pane} aria-label={`${language} conversation`}>
      <header className={styles.header}>
        <h2>{language}</h2>
        <div className={styles.headerActions}>
          <ToggleSwitch label="Grammar" checked={grammarCheck} onChange={onToggleGrammarCheck} />
          <button
            type="button"
            className={styles.clearButton}
            onClick={onClear}
            disabled={messages.length === 0 && !pending}
            aria-label={`Clear the ${language} conversation`}
          >
            ⌫ Clear
          </button>
        </div>
      </header>

      <div className={styles.messages} ref={listRef}>
        {messages.length === 0 && !pending && (
          <p className={styles.hint}>Use the other pane to get an instant {language} translation.</p>
        )}

        {messages.map((message) => (
          <div
            key={message.id}
            className={
              message.side === side ? `${styles.row} ${styles.rowSent}` : `${styles.row} ${styles.rowReceived}`
            }
          >
            <div
              className={
                message.side === side ? `${styles.bubble} ${styles.sent}` : `${styles.bubble} ${styles.received}`
              }
            >
              {message.text}
            </div>
            <button
              type="button"
              className={styles.copy}
              onClick={() => handleCopy(message)}
              aria-label="Copy message"
              title="Copy"
            >
              {copiedId === message.id ? "✓" : "⧉"}
            </button>
            <button
              type="button"
              className={styles.delete}
              onClick={() => onDeleteMessage(message.id)}
              aria-label="Delete message"
              title="Delete"
            >
              ✕
            </button>
          </div>
        ))}

        {isBusy && (
          <div className={styles.typing} aria-live="polite">
            <span />
            <span />
            <span />
          </div>
        )}

        {pending?.status === "corrections" && (
          <div className={styles.correction}>
            <div className={styles.boxHeader}>
              <span className={styles.boxTitle}>Grammar suggestions</span>
              <button type="button" className={styles.boxClose} onClick={handleDismiss} aria-label="Dismiss suggestions">
                ✕
              </button>
            </div>
            {pending.options.map((option, index) => (
              <button
                key={`${index}-${option}`}
                type="button"
                className={styles.correctionOption}
                onClick={() => onPickCorrection(option)}
              >
                {option}
              </button>
            ))}
            <button type="button" className={styles.boxLink} onClick={onSendOriginal}>
              Send as is
            </button>
          </div>
        )}

        {pending?.status === "ready" && (
          <div className={styles.options}>
            {pending.options.map((option, index) => (
              <button
                key={`${index}-${option}`}
                type="button"
                className={styles.option}
                onClick={() => onPick(option)}
              >
                {option}
              </button>
            ))}
            <button type="button" className={styles.boxLink} onClick={handleDismiss}>
              None of these
            </button>
          </div>
        )}

        {pending?.status === "error" && (
          <div className={styles.error} role="alert">
            <p>{pending.error}</p>
            <div className={styles.errorActions}>
              {pending.kind === "grammar" && (
                <button type="button" className={styles.errorSecondary} onClick={onSendOriginal}>
                  Send as is
                </button>
              )}
              <button type="button" onClick={onRetry}>
                Retry
              </button>
            </div>
          </div>
        )}
      </div>

      <form className={styles.form} onSubmit={handleSubmit}>
        <textarea
          ref={inputRef}
          rows={1}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={`Write in ${language}…`}
          disabled={isBusy || inputBlocked}
          aria-label={`Write in ${language}`}
        />
        <button type="submit" disabled={isBusy || inputBlocked || normalizeMultiline(draft) === ""}>
          Send
        </button>
      </form>
    </section>
  );
}
