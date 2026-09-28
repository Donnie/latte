import { describe, expect, it } from "vitest";
import { normalizeMultiline, soleOption, uniqueOptionIndexes } from "./text";

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

describe("uniqueOptionIndexes", () => {
  it("keeps every option when they all differ", () => {
    expect(uniqueOptionIndexes(["one", "two", "three"])).toEqual([0, 1, 2]);
  });

  it("drops later exact copies and keeps the first occurrence", () => {
    expect(uniqueOptionIndexes(["same", "same", "same"])).toEqual([0]);
    expect(uniqueOptionIndexes(["same", "other", "same"])).toEqual([0, 1]);
  });

  it("treats differing whitespace as distinct", () => {
    expect(uniqueOptionIndexes(["hello", "hello ", "hello"])).toEqual([0, 1]);
  });
});

describe("soleOption", () => {
  it("returns the text when every option is the same", () => {
    expect(soleOption(["same", "same", "same"])).toBe("same");
  });

  it("returns nothing when more than one distinct option remains", () => {
    expect(soleOption(["same", "other", "same"])).toBeUndefined();
    expect(soleOption(["one", "two", "three"])).toBeUndefined();
  });

  it("returns nothing for an empty option", () => {
    expect(soleOption(["", "", ""])).toBeUndefined();
  });
});
