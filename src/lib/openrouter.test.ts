
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OpenRouterError, fetchGenerationCost, fetchSpeechCatalog, streamCorrectionOptions, streamTranslationOptions, synthesizeSpeech } from "./openrouter";

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
    vi.unstubAllGlobals();
  });

  it("streams accumulated deltas and resolves the content with the usage cost", async () => {
    const deltas: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse([
          ": OPENROUTER PROCESSING\n\n",
          'data: {"choices":[{"delta":{"content":"Hallo"}}]}\n\n',
          'data: {"choices":[{"delta":{"content":" Welt"}}]}\n\n',
          'data: {"choices":[],"usage":{"cost":0.0025}}\n\n',
          "data: [DONE]\n\n",
        ]),
      ),
    );

    const handle = streamTranslationOptions(request, (full) => deltas.push(full));
    const result = await handle.promise;

    expect(deltas).toEqual(["Hallo", "Hallo Welt"]);
    expect(result.content).toBe("Hallo Welt");
    expect(result.cost).toBe(0.0025);
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
          'data: {"choices":[],"usage":{"cost":0.0011}}\n\n',
          "data: [DONE]\n\n",
        ]),
      ),
    );

    const handle = streamCorrectionOptions(request, (full) => deltas.push(full));
    const result = await handle.promise;

    expect(deltas).toEqual(["We was", "We was going to the store."]);
    expect(result.content).toBe("We was going to the store.");
    expect(result.cost).toBe(0.0011);
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

  it("returns the mp3 bytes and generation id", async () => {
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
    expect(result.generationId).toBe("gen-tts-1");
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

describe("fetchGenerationCost", () => {
  beforeEach(() => {
    if (typeof globalThis.window === "undefined") {
      vi.stubGlobal("window", { location: { origin: "http://localhost:4173" } });
    }
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("reads total_cost", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ data: { total_cost: 0.00003 } }), { status: 200 })),
    );

    await expect(fetchGenerationCost("test-key", "gen-tts-1")).resolves.toBe(0.00003);
  });

  it("retries once when the generation is not ready", async () => {
    vi.useFakeTimers();
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls += 1;
        if (calls === 1) return new Response("{}", { status: 404 });
        return new Response(JSON.stringify({ data: { total_cost: 0.00003 } }), { status: 200 });
      }),
    );

    const pending = fetchGenerationCost("test-key", "gen-tts-1");
    await vi.runAllTimersAsync();

    await expect(pending).resolves.toBe(0.00003);
    expect(calls).toBe(2);
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
              { id: "x-ai/grok-voice-tts-1.0", name: "Grok Voice", description: "Speech across 20+ languages with automatic language detection.", supported_voices: ["eve", "ara", ""] },
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
