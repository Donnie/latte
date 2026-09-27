import { describe, expect, it } from "vitest";
import { parseOptions } from "./openrouter";

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
