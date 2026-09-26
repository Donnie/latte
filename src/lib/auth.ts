import { APP_KEY_LABEL, AUTH_KEYS_URL, AUTH_URL } from "../constants";

const VERIFIER_STORAGE_KEY = "latte.oauthVerifier";

export class AuthError extends Error {}

interface ExchangeResponse {
  key?: unknown;
  error?: { message?: unknown };
}

export async function startOpenRouterSignIn(): Promise<void> {
  const verifier = createVerifier();
  const challenge = await createS256Challenge(verifier);
  try {
    window.sessionStorage.setItem(VERIFIER_STORAGE_KEY, verifier);
  } catch {
    throw new AuthError("Browser storage is unavailable, so sign-in cannot start.");
  }
  const callback = new URL(window.location.pathname, window.location.origin);
  const params = new URLSearchParams({
    callback_url: callback.toString(),
    code_challenge: challenge,
    code_challenge_method: "S256",
    key_label: APP_KEY_LABEL,
  });
  window.location.assign(`${AUTH_URL}?${params.toString()}`);
}

export function readAuthCodeFromUrl(): string | null {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  if (code === null) return null;
  params.delete("code");
  params.delete("state");
  const rest = params.toString();
  window.history.replaceState(null, "", `${window.location.pathname}${rest ? `?${rest}` : ""}`);
  return code;
}

export function readAuthErrorFromUrl(): string | null {
  const params = new URLSearchParams(window.location.search);
  const error = params.get("error");
  if (error === null) return null;
  params.delete("error");
  params.delete("error_description");
  const rest = params.toString();
  window.history.replaceState(null, "", `${window.location.pathname}${rest ? `?${rest}` : ""}`);
  return error === "access_denied" ? "Sign-in was cancelled." : `Sign-in failed — ${error}.`;
}

export async function exchangeAuthCode(code: string): Promise<string> {
  let verifier: string | null = null;
  try {
    verifier = window.sessionStorage.getItem(VERIFIER_STORAGE_KEY);
    window.sessionStorage.removeItem(VERIFIER_STORAGE_KEY);
  } catch {
    throw new AuthError("Browser storage is unavailable, so sign-in cannot be completed.");
  }
  if (!verifier) {
    throw new AuthError("Sign-in could not be completed — try signing in again.");
  }

  let response: Response;
  try {
    response = await fetch(AUTH_KEYS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: "S256" }),
    });
  } catch {
    throw new AuthError("Could not reach OpenRouter to finish sign-in — check your connection.");
  }

  let payload: ExchangeResponse;
  try {
    payload = (await response.json()) as ExchangeResponse;
  } catch {
    throw new AuthError("Unexpected response from OpenRouter while finishing sign-in.");
  }
  if (!response.ok || payload.error) {
    throw new AuthError(describeExchangeFailure(response.status, payload));
  }
  if (typeof payload.key !== "string" || payload.key.length === 0) {
    throw new AuthError("Unexpected response from OpenRouter while finishing sign-in.");
  }
  return payload.key;
}

function describeExchangeFailure(status: number, payload: ExchangeResponse): string {
  const detail = typeof payload.error?.message === "string" ? payload.error.message : "";
  if (status === 403) {
    return "Sign-in could not be completed — the request may have expired. Please try again.";
  }
  return detail.length > 0 ? `Sign-in failed — ${detail}` : "Sign-in failed — please try again.";
}

function createVerifier(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

async function createS256Challenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

function base64Url(bytes: Uint8Array): string {
  const raw = btoa(String.fromCharCode(...bytes));
  return raw.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}