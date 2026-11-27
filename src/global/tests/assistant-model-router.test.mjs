import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_GEMINI_MODELS,
  DEFAULT_GROQ_MODELS,
  DEFAULT_OPENROUTER_MODELS,
  isRetryableProviderStatus,
  normalizeOpenAiResult,
  parseRetryAfterSeconds,
  toOpenAiChatPayload,
} from "../../../supabase/functions/assistant-chat/_shared/assistant-model-router.mjs";

test("Nova keeps configured multi-model fallback chains", () => {
  assert.deepEqual(DEFAULT_GEMINI_MODELS, ["gemini-3.8-flash", "gemini-3.5-flash-lite"]);
  assert.equal(DEFAULT_GROQ_MODELS.length, 2);
  assert.equal(DEFAULT_OPENROUTER_MODELS.length, 2);
});

test("provider retry policy recognizes transient and quota responses", () => {
  for (const status of [408, 409, 425, 429, 500, 502, 503, 504]) {
    assert.equal(isRetryableProviderStatus(status), true);
  }
  assert.equal(isRetryableProviderStatus(200), false);
});

test("retry-after supports seconds, HTTP dates, and provider reset durations", () => {
  assert.equal(parseRetryAfterSeconds(new Headers({ "retry-after": "12" })), 12);
  assert.equal(parseRetryAfterSeconds(new Headers({ "x-ratelimit-reset-requests": "1m30s" })), 90);
  assert.equal(parseRetryAfterSeconds(new Headers()), null);
});

test("OpenAI-compatible responses normalize to the Gemini response contract", () => {
  const result = normalizeOpenAiResult({
    choices: [{ message: { content: JSON.stringify({ reply: "Ready", actions: [] }) } }],
  });
  const parsed = JSON.parse(result.candidates[0].content.parts[0].text);
  assert.equal(parsed.reply, "Ready");
  assert.deepEqual(parsed.actions, []);
});

test("fallback payload preserves system instructions and multimodal user content", () => {
  const payload = toOpenAiChatPayload({
    system_instruction: { parts: [{ text: "Return JSON" }] },
    contents: [{ role: "user", parts: [
      { text: "Read this invoice" },
      { inline_data: { mime_type: "image/png", data: "aGVsbG8=" } },
    ] }],
    generationConfig: { maxOutputTokens: 1000 },
  }, "google/gemma-test:free");
  assert.equal(payload.messages[0].role, "system");
  assert.equal(payload.messages[0].content, "Return JSON");
  assert.equal(payload.messages[1].role, "user");
  assert.equal(payload.max_tokens, 1000);
  assert.equal(payload.provider.data_collection, "deny");
});
