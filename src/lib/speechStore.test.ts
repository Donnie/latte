import { indexedDB } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  beginSpeech,
  clearSpeechFiles,
  completeSpeech,
  dropSpeechFile,
  dropSpeechFiles,
  lookupSpeech,
  retainSpeech,
  speechEpoch,
  speechFileUrl,
} from "./speechFiles";
import { readSpeechAudio } from "./speechStore";

globalThis.indexedDB = indexedDB;

const model = "x-ai/grok-voice-tts-1.0";

function mp3(bytes: number[]): ArrayBuffer {
  return Uint8Array.from(bytes).buffer;
}

async function storedBytes(messageId: string, voice: string): Promise<number[] | null> {
  const blob = await readSpeechAudio(messageId, model, voice);
  if (!blob) return null;
  return [...new Uint8Array(await blob.arrayBuffer())];
}

describe("speech storage", () => {
  beforeEach(async () => {
    await clearSpeechFiles();
  });

  it("keeps a clip for the same message, model, and voice", async () => {
    await retainSpeech("m1", model, "eve", mp3([1, 2, 3, 4]), speechEpoch());

    expect(await storedBytes("m1", "eve")).toEqual([1, 2, 3, 4]);
    expect(await storedBytes("m1", "ara")).toBeNull();
  });

  it("reads a saved clip back into memory after the page memory is gone", async () => {
    await retainSpeech("m1", model, "eve", mp3([9, 8, 7]), speechEpoch());
    vi.resetModules();
    const fresh = await import("./speechFiles");

    const url = await fresh.lookupSpeech("m1", model, "eve");
    const again = await fresh.lookupSpeech("m1", model, "eve");

    expect(url).toEqual(expect.any(String));
    expect(again).toBe(url);
    expect(await fresh.lookupSpeech("m1", model, "ara")).toBeNull();
  });

  it("reuses the in-memory clip for a second play", async () => {
    const url = completeSpeech("m1", speechEpoch(), mp3([1, 1, 1]), model, "eve");

    expect(speechFileUrl("m1", model, "eve")).toBe(url);
    expect(await lookupSpeech("m1", model, "eve")).toBe(url);
    expect(speechFileUrl("m1", model, "ara")).toBeUndefined();
  });

  it("drops every voice for a deleted message and leaves other messages", async () => {
    await retainSpeech("m1", model, "eve", mp3([1]), speechEpoch());
    await retainSpeech("m1", model, "ara", mp3([2]), speechEpoch());
    await retainSpeech("m2", model, "eve", mp3([3]), speechEpoch());

    await dropSpeechFile("m1");

    expect(await storedBytes("m1", "eve")).toBeNull();
    expect(await storedBytes("m1", "ara")).toBeNull();
    expect(await storedBytes("m2", "eve")).toEqual([3]);
  });

  it("drops several messages in one call", async () => {
    await retainSpeech("m1", model, "eve", mp3([1]), speechEpoch());
    await retainSpeech("m2", model, "eve", mp3([2]), speechEpoch());
    await retainSpeech("m3", model, "eve", mp3([3]), speechEpoch());

    await dropSpeechFiles(["m1", "m3"]);

    expect(await storedBytes("m1", "eve")).toBeNull();
    expect(await storedBytes("m2", "eve")).toEqual([2]);
    expect(await storedBytes("m3", "eve")).toBeNull();
  });

  it("clears saved clips on logout", async () => {
    await retainSpeech("m1", model, "eve", mp3([1, 2]), speechEpoch());

    await clearSpeechFiles();

    expect(await storedBytes("m1", "eve")).toBeNull();
  });

  it("does not store a clip for a message that was deleted while saving", async () => {
    const epoch = speechEpoch();
    const saving = retainSpeech("m1", model, "eve", mp3([5, 5]), epoch);
    const removing = dropSpeechFile("m1");

    await Promise.all([saving, removing]);

    expect(await storedBytes("m1", "eve")).toBeNull();
  });

  it("ignores a save from a session that has already been cleared", async () => {
    const epoch = speechEpoch();
    await clearSpeechFiles();

    await retainSpeech("m1", model, "eve", mp3([4]), epoch);

    expect(await storedBytes("m1", "eve")).toBeNull();
  });

  it("replaces an in-memory clip when the voice changes", () => {
    const url = completeSpeech("m1", speechEpoch(), mp3([1]), model, "eve");

    expect(speechFileUrl("m1", model, "eve")).toBe(url);
    expect(beginSpeech("m1", model, "ara")).toBe("ready");
    expect(speechFileUrl("m1", model, "eve")).toBeUndefined();
  });
});
