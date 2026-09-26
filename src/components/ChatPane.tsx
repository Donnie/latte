import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Message, Pending, Side } from "../types";
import styles from "./ChatPane.module.css";

interface ChatPaneProps {
  side: Side;
  language: string;
  messages: Message[];
  pending?: Pending;
  inputBlocked: boolean;
  onSend(text: string): void;
  onPick(option: string): void;
  onPickCorrection(option: string): void;
  onSendOriginal(): void;
  onDismiss(): void;
  onRetry(): void;
}

export default function ChatPane({
  side,
  language,
  messages,
  pending,
  inputBlocked,
  onSend,
  onPick,
  onPickCorrection,
  onSendOriginal,
  onDismiss,
  onRetry,
}: ChatPaneProps) {
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLDivElement | null>(null);
  const isBusy = pending?.status === "checking" || pending?.status === "loading";

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages.length, pending]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = draft.trim();
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
      </header>

      <div className={styles.messages} ref={listRef}>
        {messages.length === 0 && !pending && (
          <p className={styles.hint}>Type below to get three {language} options to choose from.</p>
        )}

        {messages.map((message) => (
          <div
            key={message.id}
            className={
              message.side === side ? `${styles.bubble} ${styles.sent}` : `${styles.bubble} ${styles.received}`
            }
          >
            {message.text}
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
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={`Write in ${language}…`}
          disabled={isBusy || inputBlocked}
          aria-label={`Write in ${language}`}
        />
        <button type="submit" disabled={isBusy || inputBlocked || draft.trim() === ""}>
          Send
        </button>
      </form>
    </section>
  );
}
