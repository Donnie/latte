
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OpenRouterError, streamCorrectionOptions, streamTranslationOptions } from "./openrouter";

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
