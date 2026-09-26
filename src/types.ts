export type Formality = "formal" | "informal";

export type Side = "left" | "right";

export interface Language {
  code: string;
  name: string;
  native: string;
}

export interface GrammarCheckSetting {
  left: boolean;
  right: boolean;
}

export interface Settings {
  source: string;
  target: string;
  formality: Formality;
  grammarCheck: GrammarCheckSetting;
  translationModel: string;
  grammarModel: string;
}

export interface Message {
  id: string;
  side: Side;
  text: string;
  createdAt: number;
}

export type ChatLog = Message[];

export type ChatStore = Record<string, ChatLog>;

export type Screen = "login" | "setup" | "chat";

export type PendingKind = "grammar" | "translation";

export interface Pending {
  requestId: string;
  kind: PendingKind;
  status: "checking" | "loading" | "corrections" | "ready" | "error";
  sourceText: string;
  options: string[];
  error: string;
}
