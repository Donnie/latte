export type Formality = "formal" | "informal";

export type Side = "left" | "right";

export interface Language {
  code: string;
  name: string;
  native: string;
}

export interface Settings {
  source: string;
  target: string;
  formality: Formality;
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

export interface Pending {
  status: "loading" | "ready" | "error";
  sourceText: string;
  options: string[];
  error: string;
}
