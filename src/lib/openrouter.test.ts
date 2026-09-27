import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OpenRouterError, parseOptions, streamTranslationOptions } from "./openrouter";

describe("parseOptions", () => {
  it("reads options from JSON, preserving escaped line breaks and trimming edges", () => {
    const raw = '{"options": ["  line one\\nline two  ", "single"]}';
    expect(parseOptions(raw)).toEqual(["line one\nline two", "single"]);
  });

  it("repairs JSON containing raw newlines inside strings", () => {
    const raw = '{\n  "options": [\n    "first line\nsecond line",\n    "just one line"\n  ]\n}';
    expect(parseOptions(raw)).toEqual(["first line\nsecond line", "just one line"]);
  });

  it("normalizes CRLF line endings in options", () => {
    const raw = '{"options": ["\r\nhallo\r\nwelt\r\n", "x"]}';
    expect(parseOptions(raw)).toEqual(["hallo\nwelt", "x"]);
  });

  it("keeps line breaks while cleaning em dashes", () => {
    const raw = '{"options": ["a — b\\nnext", "c"]}';
    expect(parseOptions(raw)).toEqual(["a, b\nnext", "c"]);
  });

  it("reads options from fenced JSON", () => {
    const raw = '```json\n{"options": ["m1\\nm2", "m3"]}\n```';
    expect(parseOptions(raw)).toEqual(["m1\nm2", "m3"]);
  });

  it("falls back to plain lines when the response is not JSON", () => {
    expect(parseOptions("- one\n- two\n- three")).toEqual(["one", "two", "three"]);
  });

  it("drops empty and non-string options", () => {
    const raw = '{"options": ["keep", "", 42, null, "also"]}';
    expect(parseOptions(raw)).toEqual(["keep", "also"]);
  });

  it("returns at most three options", () => {
    const raw = '{"options": ["a", "b", "c", "d", "e"]}';
    expect(parseOptions(raw)).toEqual(["a", "b", "c"]);
  });

  it("throws when nothing can be read", () => {
    expect(() => parseOptions("   \n   ")).toThrow(/Could not read the options/);
  });
});

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
