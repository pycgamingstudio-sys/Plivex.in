import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_GEMINI_MODELS, generateWithFallback, streamGeminiResponse } from "./assistant-model-router.mjs";

const requestOptions = { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: "hello" }] }] }) };
const sse = (...chunks) => chunks.map((text) => "data: " + JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }) + "\n\n").join("") + "data: [DONE]\n\n";

test("Gemini SSE stream yields model chunks and a generateContent-compatible result", async () => {
  const chunks = [];
  const raw = '{"reply":"Hello world","actions":[]} ';
  const result = await streamGeminiResponse({
    requestOptions, geminiKey: "test", model: DEFAULT_GEMINI_MODELS[0],
    fetchImpl: async (url, options) => {
      assert.match(url, /:streamGenerateContent\\?alt=sse$/);
      assert.equal(options.headers["x-goog-api-key"], "test");
      return new Response(sse('{"reply":"Hello ', 'world","actions":[]} '), { headers: { "Content-Type": "text/event-stream" } });
    },
    onTextChunk: (chunk) => chunks.push(chunk),
  });
  assert.equal(result.candidates[0].content.parts[0].text, '{"reply":"Hello world","actions":[]} ');
  assert.deepEqual(chunks, ['{"reply":"Hello ', 'world","actions":[]} ']);
  assert.equal(raw.trim().length > 0, true);
});

test("Gemini stream failure before first chunk keeps provider fallback available", async () => {
  const calls = [];
  const chunks = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.includes(DEFAULT_GEMINI_MODELS[0])) return new Response(JSON.stringify({ error: { message: "temporarily unavailable" } }), { status: 503, headers: { "Content-Type": "application/json" } });
    return new Response(sse('{"reply":"Recovered","actions":[]} '), { headers: { "Content-Type": "text/event-stream" } });
  };
  const result = await generateWithFallback({ requestOptions, geminiKey: "test", openRouterKey: "", fetchImpl, onTextChunk: (chunk) => chunks.push(chunk), totalTimeoutMs: 10000 });
  assert.equal(result.ok, true);
  assert.equal(result.model, DEFAULT_GEMINI_MODELS[1]);
  assert.equal(chunks.join(""), '{"reply":"Recovered","actions":[]} ');
  assert.equal(calls.length, 2);
});

test("Gemini stream interruption after visible output does not switch providers", async () => {
  const calls = [];
  const chunks = [];
  const firstEvent = "data: " + JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"reply":"Part' }] } }] }) + "\n\n";
  const fetchImpl = async (url) => {
    calls.push(url);
    const body = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(firstEvent)); controller.error(new Error("connection reset")); } });
    return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
  };
  const result = await generateWithFallback({ requestOptions, geminiKey: "test", openRouterKey: "backup", fetchImpl, onTextChunk: (chunk) => chunks.push(chunk), totalTimeoutMs: 10000 });
  assert.equal(result.ok, false);
  assert.equal(result.failureCode, "STREAM_INTERRUPTED");
  assert.equal(chunks.join(""), '{"reply":"Part');
  assert.equal(calls.length, 1);
});

test("Gemini stream preserves upstream rate-limit status before output", async () => {
  await assert.rejects(() => streamGeminiResponse({
    requestOptions, geminiKey: "test", model: DEFAULT_GEMINI_MODELS[0],
    fetchImpl: async () => new Response(JSON.stringify({ error: { message: "quota" } }), { status: 429, headers: { "Content-Type": "application/json", "Retry-After": "12" } }),
  }), (error) => error.status === 429 && error.retryAfterSeconds === 12);
});