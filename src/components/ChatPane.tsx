import { useEffect, useRef, useState, type ClipboardEvent, type ChangeEvent, type FormEvent, type KeyboardEvent } from "react";
import { LANGUAGES, languageName } from "../constants";
import { resizeImageFile } from "../lib/images";
import { normalizeMultiline, uniqueOptionIndexes } from "../lib/text";
import type { SpeechControls } from "../hooks/useSpeechPlayback";
import type { Message, Pending, Side } from "../types";
import ToggleSwitch from "./ToggleSwitch";
import styles from "./ChatPane.module.css";

const INPUT_MAX_HEIGHT = 132;

function optionIndexes(pending: Pending): number[] {
  if (pending.pickedIndex !== undefined) return [pending.pickedIndex];
  if (pending.status === "streaming") return pending.options.map((_, index) => index);
  return uniqueOptionIndexes(pending.options);
}

function imageFileFromList(data: DataTransfer): File | null {
  const fromFiles = Array.from(data.files).find((file) => file.type.startsWith("image/"));
  if (fromFiles) return fromFiles;
  for (const item of data.items) {
    if (item.kind !== "file" || !item.type.startsWith("image/")) continue;
    const file = item.getAsFile();
    if (file) return file;
  }
  return null;
}

interface ChatPaneProps {
  side: Side;
  languageCode: string;
  otherLanguageCode: string;
  messages: Message[];
  pending?: Pending;
  inputBlocked: boolean;
  grammarCheck: boolean;
  translate: boolean;
  onSend(text: string, image?: string): void;
  onLanguageChange(code: string): void;
  onToggleGrammarCheck(enabled: boolean): void;
  onToggleTranslate(enabled: boolean): void;
  onPick(index: number): void;
  onPickCorrection(index: number): void;
  onSendOriginal(): void;
  onDismiss(): void;
  onRetry(): void;
  onDeleteMessage(messageId: string): void;
  onClear(): void;
  speech: SpeechControls;
}

function SpeechButtons({ message, speech }: { message: Message; speech: SpeechControls }) {
  const phase = speech.phase(message.id);
  if (phase === "loading") {
    return <span className={styles.speechSpinner} role="status" aria-label="Loading speech" />;
  }
  if (phase === "playing" || phase === "paused") {
    const paused = phase === "paused";
    return (
      <>
        <button
          type="button"
          className={`${styles.speech} ${styles.speechLive}`}
          onClick={paused ? speech.resume : speech.pause}
          aria-label={paused ? "Resume speech" : "Pause speech"}
          title={paused ? "Resume" : "Pause"}
        >
          {paused ? "▶" : "⏸"}
        </button>
        <button
          type="button"
          className={`${styles.speech} ${styles.speechLive}`}
          onClick={() => speech.replay(message)}
          aria-label="Replay speech"
          title="Replay"
        >
          ↻
        </button>
      </>
    );
  }
  const error = speech.error(message.id);
  return (
    <button
      type="button"
      className={error ? `${styles.speech} ${styles.speechError}` : styles.speech}
      onClick={() => speech.play(message)}
      aria-label={error || "Play speech"}
      title={error || "Play"}
    >
      🔊
    </button>
  );
}

export default function ChatPane({
  side,
  languageCode,
  otherLanguageCode,
  messages,
  pending,
  inputBlocked,
  grammarCheck,
  translate,
  onSend,
  onLanguageChange,
  onToggleGrammarCheck,
  onToggleTranslate,
  onPick,
  onPickCorrection,
  onSendOriginal,
  onDismiss,
  onRetry,
  onDeleteMessage,
  onClear,
  speech,
}: ChatPaneProps) {
  const [draft, setDraft] = useState("");
  const [attachment, setAttachment] = useState<string | null>(null);
  const [attachError, setAttachError] = useState("");
  const [readingImage, setReadingImage] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const copyTimer = useRef<number | null>(null);
  const language = languageName(languageCode);
  const languageNative = LANGUAGES.find((option) => option.code === languageCode)?.native ?? language;
  const isBusy = pending?.status === "checking" || pending?.status === "loading";
  const networkBusy =
    pending?.status === "checking" || pending?.status === "loading" || pending?.status === "streaming";

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
    if (readingImage || isBusy || inputBlocked) return;
    if (!text && !attachment) return;
    onSend(text, attachment ?? undefined);
    setDraft("");
    setAttachment(null);
    setAttachError("");
  }

  function handleDismiss() {
    const text = pending?.kind === "grammar" ? pending.sourceText : "";
    const image = pending?.kind === "grammar" ? pending.sourceImage : undefined;
    onDismiss();
    if (text) setDraft(text);
    if (image) setAttachment(image);
  }

  function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const file = imageFileFromList(event.clipboardData);
    if (!file) return;
    event.preventDefault();
    void takeImage(file);
  }

  function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) void takeImage(file);
  }

  async function takeImage(file: File) {
    setAttachError("");
    setReadingImage(true);
    try {
      setAttachment(await resizeImageFile(file));
    } catch (error) {
      setAttachError(error instanceof Error ? error.message : "Could not read that image.");
    } finally {
      setReadingImage(false);
    }
  }

  return (
    <section className={styles.pane} aria-label={`${language} conversation`}>
      <header className={styles.header}>
        <div className={styles.titleGroup}>
          <div className={styles.languageSelectWrap}>
            <span className={styles.languageLabel} aria-hidden="true">
              {languageNative}
            </span>
            <select
              className={styles.languageSelect}
              value={languageCode}
              onChange={(event) => onLanguageChange(event.target.value)}
              aria-label={`${language} language`}
            >
              {LANGUAGES.map((option) => (
                <option key={option.code} value={option.code} disabled={option.code === otherLanguageCode}>
                  {option.name} · {option.native}
                </option>
              ))}
            </select>
          </div>
          {networkBusy && <span className={styles.spinner} role="status" aria-label="Network activity" />}
        </div>
        <div className={styles.headerActions}>
          <ToggleSwitch label="Grammar" checked={grammarCheck} onChange={onToggleGrammarCheck} />
          <ToggleSwitch label="Translate" checked={translate} onChange={onToggleTranslate} />
          <button
            type="button"
            className={styles.clearButton}
            onClick={onClear}
            disabled={messages.length === 0 && !pending}
            aria-label={`Clear the ${language} conversation`}
            title={`Clear the ${language} conversation`}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m-9 0 1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path d="M10 11v6M14 11v6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
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
              {message.image && <img className={styles.photo} src={message.image} alt="" />}
              {message.text ? message.text : null}
            </div>
            {message.text ? <SpeechButtons message={message} speech={speech} /> : null}
            {message.text ? (
              <button
                type="button"
                className={styles.copy}
                onClick={() => handleCopy(message)}
                aria-label="Copy message"
                title="Copy"
              >
                {copiedId === message.id ? "✓" : "⧉"}
              </button>
            ) : null}
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

        {pending?.kind === "grammar" &&
          (pending?.status === "corrections" || pending?.status === "streaming") && (
          <div className={styles.correction}>
            <div className={styles.boxHeader}>
              <span className={styles.boxTitle}>Grammar suggestions</span>
              <button type="button" className={styles.boxClose} onClick={handleDismiss} aria-label="Dismiss suggestions">
                ✕
              </button>
            </div>
            {optionIndexes(pending).map((index) => {
              const settled = pending.settled?.[index] ?? true;
              return (
                <button
                  key={index}
                  type="button"
                  className={
                    settled ? styles.correctionOption : `${styles.correctionOption} ${styles.optionStreaming}`
                  }
                  onClick={() => onPickCorrection(index)}
                >
                  {pending.options[index]}
                </button>
              );
            })}
            {pending.pickedIndex === undefined && (
              <button type="button" className={styles.boxLink} onClick={onSendOriginal}>
                Send as is
              </button>
            )}
          </div>
        )}

        {pending?.kind === "translation" &&
          (pending?.status === "streaming" || pending?.status === "ready") && (
          <div className={styles.options}>
            {optionIndexes(pending).map((index) => {
              const settled = pending.settled?.[index] ?? true;
              return (
                <button
                  key={index}
                  type="button"
                  className={settled ? styles.option : `${styles.option} ${styles.optionStreaming}`}
                  onClick={() => onPick(index)}
                >
                  {pending.options[index]}
                </button>
              );
            })}
            {pending.pickedIndex === undefined && (
              <button type="button" className={styles.boxLink} onClick={handleDismiss}>
                None of these
              </button>
            )}
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
        {attachment && (
          <div className={styles.attachment}>
            <img src={attachment} alt="" />
            <button
              type="button"
              className={styles.attachmentRemove}
              onClick={() => setAttachment(null)}
              disabled={isBusy || inputBlocked}
              aria-label="Remove image"
            >
              ✕
            </button>
          </div>
        )}
        {attachError && (
          <p className={styles.attachError} role="alert">
            {attachError}
          </p>
        )}
        <div className={styles.composer}>
          <button
            type="button"
            className={styles.attach}
            onClick={() => fileRef.current?.click()}
            disabled={isBusy || inputBlocked || readingImage}
            aria-label="Attach an image"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="2" />
              <circle cx="8.5" cy="10" r="1.5" fill="currentColor" />
              <path d="M21 16l-5-5-8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <input
            ref={fileRef}
            className={styles.fileInput}
            type="file"
            accept="image/*"
            onChange={handleFile}
            tabIndex={-1}
            aria-hidden="true"
          />
          <textarea
            ref={inputRef}
            rows={1}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={`Write in ${language}…`}
            disabled={isBusy || inputBlocked}
            aria-label={`Write in ${language}`}
          />
          <button
            type="submit"
            className={styles.send}
            disabled={isBusy || inputBlocked || readingImage || (normalizeMultiline(draft) === "" && !attachment)}
          >
            Send
          </button>
        </div>
      </form>
    </section>
  );
}
