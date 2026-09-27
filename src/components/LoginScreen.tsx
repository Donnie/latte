import { useState, type FormEvent } from "react";
import { startOpenRouterSignIn } from "../lib/auth";
import type { Theme } from "../types";
import ThemeToggle from "./ThemeToggle";
import GitHubLink from "./GitHubLink";
import styles from "./LoginScreen.module.css";

interface LoginScreenProps {
  onLogin(apiKey: string): void;
  theme: Theme;
  onToggleTheme(): void;
  oauthPending?: boolean;
  oauthError?: string | null;
}

export default function LoginScreen({ onLogin, theme, onToggleTheme, oauthPending = false, oauthError = null }: LoginScreenProps) {
  const [apiKey, setApiKey] = useState("");
  const [reveal, setReveal] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const trimmed = apiKey.trim();
  const error = oauthError ?? startError;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (trimmed) onLogin(trimmed);
  }

  async function handleSignIn() {
    setStartError(null);
    try {
      await startOpenRouterSignIn();
    } catch (caught) {
      setStartError(caught instanceof Error ? caught.message : "Sign-in failed — please try again.");
    }
  }

  return (
    <main className={styles.screen}>
      <section className={styles.card}>
        <div className={styles.logo} aria-hidden="true">☕</div>
        <h1>Latte</h1>
        <p className={styles.tagline}>
          A two-pane chat translator, powered by OpenRouter. Choose your language pair and models after logging in.
        </p>
        {error && <p className={styles.error} role="alert">{error}</p>}
        {oauthPending && <p className={styles.pending}>Finishing sign-in with OpenRouter…</p>}
        <button type="button" className={styles.primary} onClick={handleSignIn} disabled={oauthPending}>
          Sign in with OpenRouter
        </button>
        <div className={styles.divider}>or paste an existing key</div>
        <form className={styles.loginForm} onSubmit={handleSubmit}>
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
              disabled={oauthPending}
            />
            <button type="button" onClick={() => setReveal((value) => !value)} disabled={oauthPending}>
              {reveal ? "Hide" : "Show"}
            </button>
          </div>
          <button type="submit" className={styles.secondary} disabled={trimmed === "" || oauthPending}>
            Log in
          </button>
        </form>
        <p className={styles.note}>
          The key is saved only in this browser’s local storage and is sent only to OpenRouter.
        </p>
        <div className={styles.cardFooter}>
          <GitHubLink />
          <ThemeToggle theme={theme} onToggle={onToggleTheme} />
        </div>
      </section>
    </main>
  );
}