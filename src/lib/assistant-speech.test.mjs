import test from "node:test";
import assert from "node:assert/strict";
import { getAssistantSpeechLanguage, normalizeAssistantSpeechText } from "./assistant-speech.mjs";

test("selects Hindi voice for Devanagari replies", () => {
  assert.equal(getAssistantSpeechLanguage("आपका भुगतान प्राप्त हो गया है", "en-US"), "hi-IN");
});

test("respects Hindi browser preference for Roman Hindi/Hinglish", () => {
  assert.equal(getAssistantSpeechLanguage("Aapka invoice ready hai", "hi-IN"), "hi-IN");
});

test("uses Indian English for English replies on an English browser", () => {
  assert.equal(getAssistantSpeechLanguage("Your invoice is ready", "en-US"), "en-IN");
});

test("preserves other browser languages when no Hindi script is present", () => {
  assert.equal(getAssistantSpeechLanguage("Bonjour", "fr-FR"), "fr-FR");
});

test("normalizes and bounds speech text without changing meaningful content", () => {
  assert.equal(normalizeAssistantSpeechText("  Hello\\u0000 world  "), "Hello world");
  assert.equal(normalizeAssistantSpeechText("abcdef", 3), "abc");
  assert.equal(normalizeAssistantSpeechText(null), "");
});
