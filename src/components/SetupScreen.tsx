import { useState } from "react";
import { LANGUAGES } from "../constants";
import type { Formality, Settings } from "../types";
import styles from "./SetupScreen.module.css";

interface SetupScreenProps {
  initial: Settings | null;
  canCancel: boolean;
  onSave(settings: Settings): void;
  onCancel(): void;
}

export default function SetupScreen({ initial, canCancel, onSave, onCancel }: SetupScreenProps) {
  const [source, setSource] = useState(initial?.source ?? "en");
  const [target, setTarget] = useState(initial?.target ?? "de");
  const [formality, setFormality] = useState<Formality>(initial?.formality ?? "informal");

  const isInvalid = source === target;

  function swap() {
    setSource(target);
    setTarget(source);
  }

  return (
    <main className={styles.screen}>
      <section className={styles.card}>
        <h1>Languages</h1>
        <p className={styles.sub}>
          Choose the language pair and how translations should sound. You can type in either pane.
        </p>

        <label className={styles.field}>
          <span>First language</span>
          <select value={source} onChange={(event) => setSource(event.target.value)}>
            {LANGUAGES.map((language) => (
              <option key={language.code} value={language.code}>
                {language.name} · {language.native}
              </option>
            ))}
          </select>
        </label>

        <button type="button" className={styles.swap} onClick={swap} aria-label="Swap languages">
          ⇄ Swap
        </button>

        <label className={styles.field}>
          <span>Second language</span>
          <select value={target} onChange={(event) => setTarget(event.target.value)}>
            {LANGUAGES.map((language) => (
              <option key={language.code} value={language.code}>
                {language.name} · {language.native}
              </option>
            ))}
          </select>
        </label>

        {isInvalid && <p className={styles.warning}>Pick two different languages.</p>}

        <div className={styles.formality} role="radiogroup" aria-label="Register">
          <span className={styles.formalityLabel}>Register</span>
          <label className={styles.choice}>
            <input
              type="radio"
              name="formality"
              checked={formality === "informal"}
              onChange={() => setFormality("informal")}
            />
            Informal
          </label>
          <label className={styles.choice}>
            <input
              type="radio"
              name="formality"
              checked={formality === "formal"}
              onChange={() => setFormality("formal")}
            />
            Formal
          </label>
        </div>

        <div className={styles.actions}>
          {canCancel && (
            <button type="button" onClick={onCancel}>
              Back
            </button>
          )}
          <button
            type="button"
            className={styles.primary}
            disabled={isInvalid}
            onClick={() => onSave({ source, target, formality })}
          >
            {canCancel ? "Save" : "Start translating"}
          </button>
        </div>
      </section>
    </main>
  );
}
