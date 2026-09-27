import { describe, expect, it } from "vitest";
import { normalizeMultiline } from "./text";

describe("normalizeMultiline", () => {
  it("trims leading and trailing spaces and line breaks", () => {
    expect(normalizeMultiline("  \n hello \n\n  ")).toBe("hello");
  });

  it("keeps internal line breaks", () => {
    expect(normalizeMultiline("one\ntwo\n\nthree")).toBe("one\ntwo\n\nthree");
  });

  it("normalizes CRLF and CR line endings", () => {
    expect(normalizeMultiline("one\r\ntwo\rthree\nfour")).toBe("one\ntwo\nthree\nfour");
  });

  it("leaves interior whitespace untouched", () => {
    expect(normalizeMultiline("a  b\n c ")).toBe("a  b\n c");
  });

  it("collapses whitespace-only text to an empty string", () => {
    expect(normalizeMultiline(" \r\n\t ")).toBe("");
  });
});
