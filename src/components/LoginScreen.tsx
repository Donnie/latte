import { useState, type FormEvent } from "react";
import { MODEL } from "../constants";
import styles from "./LoginScreen.module.css";

interface LoginScreenProps {
  onLogin(apiKey: string): void;
}

export default function LoginScreen({ onLogin }: LoginScreenProps) {
  const [apiKey, setApiKey] = useState("");
  const [reveal, setReveal] = useState(false);
  const trimmed = apiKey.trim();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (trimmed) onLogin(trimmed);
  }

  return (
    <main className={styles.screen}>
      <section className={styles.card}>
        <div className={styles.logo} aria-hidden="true">☕</div>
        <h1>Latte</h1>
        <p className={styles.tagline}>
          A two-pane chat translator, powered by <code>{MODEL}</code> via OpenRouter.
        </p>
        <form onSubmit={handleSubmit}>
          <label className={styles.label} htmlFor="openrouter-key">
            OpenRouter API key
          </label>
          <div className={styles.inputRow}>
            <input
              id="openrouter-key"
              type={reveal ? "text" : "password"}
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder="sk-or-v1-…"
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              autoFocus
            />
            <button type="button" onClick={() => setReveal((value) => !value)}>
              {reveal ? "Hide" : "Show"}
            </button>
          </div>
          <button type="submit" className={styles.primary} disabled={trimmed === ""}>
            Log in
          </button>
        </form>
        <p className={styles.note}>
          The key is saved only in this browser’s local storage and is sent only to OpenRouter.{" "}
          <a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer">
            Get a free key →
          </a>
        </p>
      </section>
    </main>
  );
}
