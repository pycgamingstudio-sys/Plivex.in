import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_GROQ_MODELS,
  DEFAULT_OPENROUTER_MODELS,
  isRetryableProviderStatus,
  normalizeOpenAiResult,
  toOpenAiChatPayload,
} from "./assistant-model-router.mjs";

test("router has two Groq and three OpenRouter model fallbacks", () => {
  assert.equal(DEFAULT_GROQ_MODELS.length, 2);
  assert.equal(DEFAULT_OPENROUTER_MODELS.length, 3);
});

test("Gemini messages and inline images map to OpenAI-compatible messages", () => {
  const payload = toOpenAiChatPayload({
    system_instruction: { parts: [{ text: "System prompt" }] },
    contents: [
      { role: "user", parts: [{ text: "Read this" }, { inline_data: { mime_type: "image/png", data: "YWJj" } }] },
      { role: "model", parts: [{ text: "Previous answer" }] },
    ],
    generationConfig: { maxOutputTokens: 900 },
  }, "test-model");
  assert.equal(payload.messages[0].role, "system");
  assert.equal(payload.messages[1].role, "user");
  assert.equal(payload.messages[1].content[1].image_url.url, "data:image/png;base64,YWJj");
  assert.equal(payload.messages[2].role, "assistant");
  assert.equal(payload.max_tokens, 900);
  assert.deepEqual(payload.response_format, { type: "json_object" });\n  assert.deepEqual(payload.provider, { data_collection: "deny", zdr: true });
});

test("OpenAI-compatible results normalize to the Gemini candidate shape", () => {
  assert.equal(normalizeOpenAiResult({ choices: [{ message: { content: "{\"reply\":\"ok\",\"actions\":[]}" } }] }).candidates[0].content.parts[0].text, "{\"reply\":\"ok\",\"actions\":[]}");
});

test("only transient, throttling and model-route errors are retryable", () => {
  for (const status of [408, 409, 425, 429, 500, 502, 503, 504, 401, 402, 403, 404]) assert.equal(isRetryableProviderStatus(status), status !== 400);
  assert.equal(isRetryableProviderStatus(400), false);
});
