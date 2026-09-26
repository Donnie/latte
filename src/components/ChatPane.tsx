import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Message, Pending, Side } from "../types";
import styles from "./ChatPane.module.css";

interface ChatPaneProps {
  side: Side;
  language: string;
  messages: Message[];
  pending?: Pending;
  onSend(text: string): void;
  onPick(option: string): void;
  onRetry(): void;
}

export default function ChatPane({ side, language, messages, pending, onSend, onPick, onRetry }: ChatPaneProps) {
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLDivElement | null>(null);
  const isLoading = pending?.status === "loading";

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages.length, pending]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || isLoading) return;
    onSend(text);
    setDraft("");
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

        {isLoading && (
          <div className={styles.typing} aria-live="polite">
            <span />
            <span />
            <span />
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
          </div>
        )}

        {pending?.status === "error" && (
          <div className={styles.error} role="alert">
            <p>{pending.error}</p>
            <button type="button" onClick={onRetry}>
              Retry
            </button>
          </div>
        )}
      </div>

      <form className={styles.form} onSubmit={handleSubmit}>
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={`Write in ${language}…`}
          disabled={isLoading}
          aria-label={`Write in ${language}`}
        />
        <button type="submit" disabled={isLoading || draft.trim() === ""}>
          Send
        </button>
      </form>
    </section>
  );
}
