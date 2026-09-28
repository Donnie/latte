import { useEffect, useState } from "react";
import {
  DEFAULT_DECISION_MODEL_SUGGESTIONS,
  DEFAULT_GRAMMAR_MODEL,
  DEFAULT_MODEL_SUGGESTIONS,
  DEFAULT_TRANSLATION_MODEL,
  LANGUAGES,
} from "../constants";
import { fetchAvailableModels } from "../lib/openrouter";
import type { Formality, Settings } from "../types";
import ToggleSwitch from "./ToggleSwitch";
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
  const [showOptions, setShowOptions] = useState(initial?.showOptions !== false);
  const [translationModel, setTranslationModel] = useState(initial?.translationModel ?? DEFAULT_TRANSLATION_MODEL);
  const [grammarModel, setGrammarModel] = useState(initial?.grammarModel ?? DEFAULT_GRAMMAR_MODEL);
  const [textModels, setTextModels] = useState<string[]>(DEFAULT_MODEL_SUGGESTIONS);
  const [decisionModels, setDecisionModels] = useState<string[]>(DEFAULT_DECISION_MODEL_SUGGESTIONS);

  useEffect(() => {
    let cancelled = false;
    fetchAvailableModels("text")
      .then((ids) => {
        if (!cancelled) setTextModels(ids);
      })
      .catch(() => {
        if (!cancelled) setTextModels(DEFAULT_MODEL_SUGGESTIONS);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchAvailableModels("decisions")
      .then((ids) => {
        if (!cancelled) setDecisionModels(ids);
      })
      .catch(() => {
        if (!cancelled) setDecisionModels(DEFAULT_DECISION_MODEL_SUGGESTIONS);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const trimmedTranslationModel = translationModel.trim();
  const trimmedGrammarModel = grammarModel.trim();
  const sameLanguage = source === target;
  const missingModel = trimmedTranslationModel === "" || trimmedGrammarModel === "";
  const isInvalid = sameLanguage || missingModel;

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

        {sameLanguage && <p className={styles.warning}>Pick two different languages.</p>}
        {!sameLanguage && missingModel && <p className={styles.warning}>Enter both model IDs.</p>}

        <div className={styles.formality} role="radiogroup" aria-label="Tonality">
          <span className={styles.formalityLabel}>Tonality</span>
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

        <div className={styles.optionToggle}>
          <div className={styles.optionCopy}>
            <span className={styles.formalityLabel}>Show options</span>
            <p className={styles.modelsHint}>
              When off, one proofreading or translation result is streamed and used automatically.
            </p>
          </div>
          <ToggleSwitch label={showOptions ? "On" : "Off"} checked={showOptions} onChange={setShowOptions} />
        </div>

        <p className={styles.modelsHint}>
          Translation runs on any OpenRouter text model. Grammar check runs on a typed decision model that answers with
          probabilities instead of text.
        </p>
        <label className={styles.field}>
          <span>Translation model</span>
          <input
            list="openrouter-text-models"
            value={translationModel}
            onChange={(event) => setTranslationModel(event.target.value)}
            placeholder={DEFAULT_TRANSLATION_MODEL}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
          />
        </label>
        <label className={styles.field}>
          <span>Grammar check model</span>
          <input
            list="openrouter-decision-models"
            value={grammarModel}
            onChange={(event) => setGrammarModel(event.target.value)}
            placeholder={DEFAULT_GRAMMAR_MODEL}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
          />
        </label>
        <datalist id="openrouter-text-models">
          {textModels.map((id) => (
            <option key={id} value={id} />
          ))}
        </datalist>
        <datalist id="openrouter-decision-models">
          {decisionModels.map((id) => (
            <option key={id} value={id} />
          ))}
        </datalist>

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
            onClick={() =>
              onSave({
                source,
                target,
                formality,
                grammarCheck: initial?.grammarCheck ?? { left: true, right: true },
                showOptions,
                translationModel: trimmedTranslationModel,
                grammarModel: trimmedGrammarModel,
              })
            }
          >
            {canCancel ? "Save" : "Start translating"}
          </button>
        </div>
      </section>
    </main>
  );
}
