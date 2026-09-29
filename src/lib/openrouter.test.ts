
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OpenRouterError, fetchSpeechCatalog, refreshKeyUsage, setKeyUsageListener, streamCorrectionOptions, streamTranslationOptions, synthesizeSpeech } from "./openrouter";

function sseResponse(events: string[], status = 200): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of events) controller.enqueue(new TextEncoder().encode(event));
      controller.close();
    },
  });
  return new Response(stream, { status, statusText: status === 200 ? "OK" : "Unauthorized" });
}

describe("streamTranslationOptions", () => {
  const request = {
    apiKey: "test-key",
    model: "test-model",
    text: "hello\nworld",
    sourceLanguage: "English",
    targetLanguage: "German",
    formality: "informal" as const,
  };

  beforeEach(() => {
    if (typeof globalThis.window === "undefined") {
      vi.stubGlobal("window", { location: { origin: "http://localhost:4173" } });
    }
  });

  afterEach(() => {
    setKeyUsageListener(null);
    vi.unstubAllGlobals();
  });

  it("streams accumulated deltas and resolves the content", async () => {
    const deltas: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse([
          ": OPENROUTER PROCESSING\n\n",
          'data: {"choices":[{"delta":{"content":"Hallo"}}]}\n\n',
          'data: {"choices":[{"delta":{"content":" Welt"}}]}\n\n',
          "data: [DONE]\n\n",
        ]),
      ),
    );

    const handle = streamTranslationOptions(request, (full) => deltas.push(full));
    const result = await handle.promise;

    expect(deltas).toEqual(["Hallo", "Hallo Welt"]);
    expect(result.content).toBe("Hallo Welt");
  });

  it("reports the key's all-time usage after the request", async () => {
    const seen: Array<{ apiKey: string; usage: number }> = [];
    setKeyUsageListener((apiKey, usage) => seen.push({ apiKey, usage }));
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).endsWith("/key")) {
          return new Response(JSON.stringify({ data: { usage: 0.02369086 } }));
        }
        return sseResponse(['data: {"choices":[{"delta":{"content":"Hallo"}}]}\n\n', "data: [DONE]\n\n"]);
      }),
    );

    const handle = streamTranslationOptions(request, () => {});
    await handle.promise;

    expect(seen).toEqual([{ apiKey: "test-key", usage: 0.02369086 }]);
  });

  it("cleans wrapping quotes and em dashes from the final content", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse([
          'data: {"choices":[{"delta":{"content":"“a — b\\nc”"}}]}\n\n',
          "data: [DONE]\n\n",
        ]),
      ),
    );

    const handle = streamTranslationOptions(request, () => {});
    const result = await handle.promise;

    expect(result.content).toBe("a, b\nc");
  });

  it("rejects when abort is called mid-stream", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, options?: { signal?: AbortSignal }) => {
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"Hallo"}}]}\n\n'));
            options?.signal?.addEventListener("abort", () =>
              controller.error(new DOMException("Aborted", "AbortError")),
            );
          },
        });
        return new Response(stream, { status: 200 });
      }),
    );

    const handle = streamTranslationOptions(request, () => {});
    handle.abort();

    await expect(handle.promise).rejects.toThrow();
  });

  it("surfaces HTTP errors as OpenRouterError", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 401, statusText: "Unauthorized" })));

    const handle = streamTranslationOptions(request, () => {});

    await expect(handle.promise).rejects.toThrow(OpenRouterError);
    await expect(handle.promise).rejects.toThrow(/Invalid API key/);
  });

  it("rejects when the stream carries an OpenRouter error payload", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse(['data: {"error": {"message": "Rate limited"}}\n\n', "data: [DONE]\n\n"]),
      ),
    );

    const handle = streamTranslationOptions(request, () => {});

    await expect(handle.promise).rejects.toThrow(/Rate limited/);
  });
});

describe("streamCorrectionOptions", () => {
  const request = {
    apiKey: "test-key",
    model: "test-model",
    text: "we was going to the store",
    language: "English",
  };

  beforeEach(() => {
    if (typeof globalThis.window === "undefined") {
      vi.stubGlobal("window", { location: { origin: "http://localhost:4173" } });
    }
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("streams deltas and resolves the cleaned correction", async () => {
    const deltas: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse([
          'data: {"choices":[{"delta":{"content":"We was"}}]}\n\n',
          'data: {"choices":[{"delta":{"content":" going to the store."}}]}\n\n',
          "data: [DONE]\n\n",
        ]),
      ),
    );

    const handle = streamCorrectionOptions(request, (full) => deltas.push(full));
    const result = await handle.promise;

    expect(deltas).toEqual(["We was", "We was going to the store."]);
    expect(result.content).toBe("We was going to the store.");
  });

  it("rejects when abort is called mid-stream", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, options?: { signal?: AbortSignal }) => {
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"We"}}]}\n\n'));
            options?.signal?.addEventListener("abort", () =>
              controller.error(new DOMException("Aborted", "AbortError")),
            );
          },
        });
        return new Response(stream, { status: 200 });
      }),
    );

    const handle = streamCorrectionOptions(request, () => {});
    handle.abort();

    await expect(handle.promise).rejects.toThrow();
  });

  it("surfaces HTTP errors as OpenRouterError", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 401, statusText: "Unauthorized" })));

    const handle = streamCorrectionOptions(request, () => {});

    await expect(handle.promise).rejects.toThrow(OpenRouterError);
    await expect(handle.promise).rejects.toThrow(/Invalid API key/);
  });
});

describe("synthesizeSpeech", () => {
  const request = {
    apiKey: "test-key",
    model: "x-ai/grok-voice-tts-1.0",
    voice: "eve",
    text: "Hello",
  };

  beforeEach(() => {
    if (typeof globalThis.window === "undefined") {
      vi.stubGlobal("window", { location: { origin: "http://localhost:4173" } });
    }
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("returns the mp3 bytes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        expect(JSON.parse(String(init?.body))).toEqual({
          model: request.model,
          input: "Hello",
          voice: "eve",
          response_format: "mp3",
        });
        return new Response(new Uint8Array([1, 2, 3, 4]), {
          status: 200,
          headers: { "x-generation-id": "gen-tts-1" },
        });
      }),
    );

    const result = await synthesizeSpeech(request);

    expect(new Uint8Array(result.bytes)).toEqual(new Uint8Array([1, 2, 3, 4]));
  });

  it("surfaces HTTP error JSON as OpenRouterError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: { message: "Voice not available" } }), {
            status: 400,
            statusText: "Bad Request",
          }),
      ),
    );

    await expect(synthesizeSpeech(request)).rejects.toThrow(OpenRouterError);
    await expect(synthesizeSpeech(request)).rejects.toThrow(/Voice not available/);
  });

  it("rejects an empty audio body", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array(), { status: 200 })));

    await expect(synthesizeSpeech(request)).rejects.toThrow(/empty audio/);
  });
});

describe("key usage", () => {
  const request = {
    apiKey: "test-key",
    model: "x-ai/grok-voice-tts-1.0",
    voice: "eve",
    text: "Hello",
  };

  beforeEach(() => {
    if (typeof globalThis.window === "undefined") {
      vi.stubGlobal("window", { location: { origin: "http://localhost:4173" } });
    }
  });

  afterEach(() => {
    setKeyUsageListener(null);
    vi.unstubAllGlobals();
  });

  it("reports all-time usage after speech and ignores an older read", async () => {
    const seen: number[] = [];
    setKeyUsageListener((_apiKey, usage) => seen.push(usage));
    let releaseOlder: (() => void) | undefined;
    const older = new Promise<void>((resolve) => {
      releaseOlder = resolve;
    });
    let keyCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (!String(url).endsWith("/key")) return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
        keyCalls += 1;
        if (keyCalls === 1) await older;
        const usage = keyCalls === 1 ? 0.01 : 0.02;
        return new Response(JSON.stringify({ data: { usage } }));
      }),
    );

    const first = synthesizeSpeech(request);
    await vi.waitFor(() => expect(keyCalls).toBe(1));
    const second = synthesizeSpeech({ ...request, text: "Again" });
    await vi.waitFor(() => expect(keyCalls).toBe(2));
    releaseOlder?.();
    await first;
    await second;

    expect(seen).toEqual([0.02]);
  });

  it("reads all-time usage when asked directly", async () => {
    const seen: number[] = [];
    setKeyUsageListener((_apiKey, usage) => seen.push(usage));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ data: { usage: 0.02369086 } }))),
    );

    await refreshKeyUsage("test-key");

    expect(seen).toEqual([0.02369086]);
  });
});

describe("fetchSpeechCatalog", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps multilingual voices and sorts the models by name", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        expect(url).toContain("output_modalities=speech");
        return new Response(
          JSON.stringify({
            data: [
              { id: "fish-audio/s1", name: "Fish", description: "A multilingual text-to-speech model.", supported_voices: null },
              { id: "canopylabs/orpheus", name: "Orpheus", description: "An English text-to-speech model.", supported_voices: ["tara", "leah"] },
              { id: "deepgram/aura-2", name: "Aura", description: "A multilingual catalog across multiple languages.", supported_voices: ["aura-2-thalia-en", "aura-2-agathe-fr"] },
              { id: "x-ai/grok-voice-tts-1.0", name: "Grok Voice", description: "Speech across 20+ languages with automatic language detection.", supported_voices: ["eve", "ara", "", "Greek_nestor", "el_nestor", "nestor-el", "Hindi_nestor", "hi_nestor", "nestor-hi", "Bengali_nestor", "bn_nestor", "nestor-bn"] },
              { id: "empty/voices", name: "Empty", supported_voices: [] },
              { id: "google/gemini-tts", name: "Gemini TTS", supported_voices: ["Kore", "Puck"] },
            ],
          }),
          { status: 200 },
        );
      }),
    );

    await expect(fetchSpeechCatalog()).resolves.toEqual([
      { id: "google/gemini-tts", name: "Gemini TTS", voices: ["Kore", "Puck"] },
      { id: "x-ai/grok-voice-tts-1.0", name: "Grok Voice", voices: ["eve", "ara"] },
    ]);
  });
});
