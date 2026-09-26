import { useState } from "react";
import ChatScreen, { chatKeyOf } from "./components/ChatScreen";
import LoginScreen from "./components/LoginScreen";
import SetupScreen from "./components/SetupScreen";
import { EMPTY_CHATS, STORAGE_KEYS } from "./constants";
import { usePersistentState } from "./hooks/usePersistentState";
import { clearAppStorage } from "./lib/storage";
import type { ChatStore, GrammarCheckSetting, Message, Screen, Settings } from "./types";

export default function App() {
  const [apiKey, setApiKey] = usePersistentState(STORAGE_KEYS.apiKey, "");
  const [storedSettings, setStoredSettings] = usePersistentState<Settings | null>(STORAGE_KEYS.settings, null);
  const [chats, setChats] = usePersistentState<ChatStore>(STORAGE_KEYS.chats, EMPTY_CHATS);
  const [screen, setScreen] = useState<Screen | null>(null);

  const settings = normalizeSettings(storedSettings);
  const activeScreen: Screen = screen ?? (apiKey ? (settings ? "chat" : "setup") : "login");

  return (
    <>
      {activeScreen === "login" && <LoginScreen onLogin={setApiKey} />}
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
          onAppendMessage={appendMessage}
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

  function logout() {
    setApiKey("");
    setStoredSettings(null);
    setChats(EMPTY_CHATS);
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
