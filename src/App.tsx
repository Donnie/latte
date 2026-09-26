import { useEffect, useState } from "react";
import ChatScreen, { chatKeyOf } from "./components/ChatScreen";
import LoginScreen from "./components/LoginScreen";
import SetupScreen from "./components/SetupScreen";
import { EMPTY_CHATS, DEFAULT_GRAMMAR_MODEL, DEFAULT_TRANSLATION_MODEL, LEGACY_GRAMMAR_MODEL, STORAGE_KEYS } from "./constants";
import { usePersistentState } from "./hooks/usePersistentState";
import { exchangeAuthCode, readAuthCodeFromUrl, readAuthErrorFromUrl } from "./lib/auth";
import { clearAppStorage } from "./lib/storage";
import type { ChatStore, GrammarCheckSetting, Message, Screen, Settings, Side } from "./types";

export default function App() {
  const [apiKey, setApiKey] = usePersistentState(STORAGE_KEYS.apiKey, "");
  const [storedSettings, setStoredSettings] = usePersistentState<Settings | null>(STORAGE_KEYS.settings, null);
  const [chats, setChats] = usePersistentState<ChatStore>(STORAGE_KEYS.chats, EMPTY_CHATS);
  const [storedCost, setTotalCost] = usePersistentState(STORAGE_KEYS.cost, 0);
  const [screen, setScreen] = useState<Screen | null>(null);
  const [oauthPending, setOauthPending] = useState(false);
  const [oauthError, setOauthError] = useState<string | null>(null);

  useEffect(() => {
    const urlError = readAuthErrorFromUrl();
    if (urlError) setOauthError(urlError);
    const code = readAuthCodeFromUrl();
    if (!code) return;
    setOauthPending(true);
    exchangeAuthCode(code)
      .then((key) => setApiKey(key))
      .catch((error: unknown) => {
        setOauthError(error instanceof Error ? error.message : "Sign-in failed — please try again.");
      })
      .finally(() => setOauthPending(false));
  }, [setApiKey]);

  const settings = normalizeSettings(storedSettings);
  const totalCost = Number.isFinite(storedCost) ? storedCost : 0;
  const activeScreen: Screen = screen ?? (apiKey ? (settings ? "chat" : "setup") : "login");

  return (
    <>
      {activeScreen === "login" && (
        <LoginScreen onLogin={setApiKey} oauthPending={oauthPending} oauthError={oauthError} />
      )}
      {activeScreen === "setup" && (
        <SetupScreen
          initial={settings}
          canCancel={settings !== null}
          onSave={saveSettings}
          onCancel={() => setScreen(null)}
        />
      )}
      {activeScreen === "chat" && settings && (
        <ChatScreen
          key={chatKeyOf(settings)}
          settings={settings}
          apiKey={apiKey}
          chats={chats}
          totalCost={totalCost}
          onAppendMessage={appendMessage}
          onRemoveMessage={removeMessage}
          onClearSide={clearChatSide}
          onAddCost={addCost}
          onSettingsChange={setStoredSettings}
          onOpenSettings={() => setScreen("setup")}
          onLogout={logout}
        />
      )}
    </>
  );

  function saveSettings(next: Settings) {
    setStoredSettings(next);
    setScreen(null);
  }

  function appendMessage(chatKey: string, message: Message) {
    setChats((prev) => ({
      ...prev,
      [chatKey]: [...(Array.isArray(prev[chatKey]) ? prev[chatKey] : []), message],
    }));
  }

  function removeMessage(chatKey: string, messageId: string) {
    setChats((prev) => {
      const log = Array.isArray(prev[chatKey]) ? prev[chatKey] : [];
      return { ...prev, [chatKey]: log.filter((message) => message.id !== messageId) };
    });
  }

  function clearChatSide(chatKey: string, side: Side) {
    setChats((prev) => {
      const log = Array.isArray(prev[chatKey]) ? prev[chatKey] : [];
      return { ...prev, [chatKey]: log.filter((message) => message.side !== side) };
    });
  }

  function addCost(cost: number) {
    if (!Number.isFinite(cost)) return;
    setTotalCost((prev) => {
      const base = Number.isFinite(prev) ? prev : 0;
      return (Math.round(base * 1e9) + Math.round(cost * 1e9)) / 1e9;
    });
  }

  function logout() {
    setApiKey("");
    setStoredSettings(null);
    setChats(EMPTY_CHATS);
    setTotalCost(0);
    setScreen(null);
    clearAppStorage(Object.values(STORAGE_KEYS));
  }
}

function normalizeSettings(value: unknown): Settings | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.source !== "string" || typeof candidate.target !== "string") return null;
  return {
    source: candidate.source,
    target: candidate.target,
    formality: candidate.formality === "formal" ? "formal" : "informal",
    grammarCheck: normalizeGrammarCheck(candidate.grammarCheck),
    translationModel: normalizeModel(candidate.translationModel, DEFAULT_TRANSLATION_MODEL),
    grammarModel: normalizeModel(
      candidate.grammarModel === LEGACY_GRAMMAR_MODEL ? DEFAULT_GRAMMAR_MODEL : candidate.grammarModel,
      DEFAULT_GRAMMAR_MODEL,
    ),
  };
}

function normalizeGrammarCheck(value: unknown): GrammarCheckSetting {
  if (typeof value !== "object" || value === null) return { left: true, right: true };
  const candidate = value as Record<string, unknown>;
  return {
    left: candidate.left !== false,
    right: candidate.right !== false,
  };
}

function normalizeModel(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}
