import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_GEMINI_MODELS,
  DEFAULT_GROQ_MODELS,
  DEFAULT_OPENROUTER_MODELS,
  generateWithFallback,
  hasPdfAttachmentRequest,
  isRetryableProviderStatus,
  normalizeOpenAiResult,
  streamGeminiResponse,
  toOpenAiChatPayload,
} from "./assistant-model-router.mjs";

const geminiBody = {
  system_instruction: { parts: [{ text: "Return JSON only." }] },
  contents: [{ role: "user", parts: [{ text: "hello" }] }],
  generationConfig: { maxOutputTokens: 300 },
};
const requestOptions = { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(geminiBody) };
const response = (status, payload) => ({ ok: status >= 200 && status < 300, status, json: async () => payload });

test("PDF attachments are routed only to Gemini because OpenAI-compatible image_url does not support PDFs", async () => {
  const pdfBody = {
    ...geminiBody,
    contents: [{ role: "user", parts: [{ text: "Read this PDF" }, { inline_data: { mime_type: "application/pdf", data: "JVBERi0xLjQ=" } }] }],
  };
  assert.equal(hasPdfAttachmentRequest(pdfBody), true);
  assert.equal(hasPdfAttachmentRequest(geminiBody), false);
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    return response(503, { error: { message: "Gemini unavailable" } });
  };
  const result = await generateWithFallback({
    requestOptions: { ...requestOptions, body: JSON.stringify(pdfBody) },
    geminiKey: "test",
    groqKey: "test",
    openRouterKey: "test",
    enableGroq: true,
    fetchImpl,
    totalTimeoutMs: 10000,
  });
  assert.equal(result.ok, false);
  assert.deepEqual(calls.map((url) => url.match(/models\/([^:]+):/)?.[1]), DEFAULT_GEMINI_MODELS);
  assert.equal(calls.some((url) => url.includes("openrouter") || url.includes("groq")), false);
});

test("free fallback list is explicit and Groq remains opt-in", () => {
  assert.deepEqual(DEFAULT_GEMINI_MODELS, ["gemini-3.8-flash", "gemini-3.5-flash-lite"]);
  assert.deepEqual(DEFAULT_OPENROUTER_MODELS, ["google/gemma-4-31b-it:free", "google/gemma-4-26b-a4b-it:free"]);
  assert.equal(DEFAULT_GROQ_MODELS.length, 2);
});

test("OpenRouter requests preserve the deny-data-collection policy", () => {
  const payload = toOpenAiChatPayload(geminiBody, "test-model");
  assert.deepEqual(payload.provider, { data_collection: "deny" });
  assert.equal("zdr" in payload.provider, false);
});

test("Gemini content and image parts map to OpenAI-compatible messages", () => {
  const payload = toOpenAiChatPayload({
    system_instruction: { parts: [{ text: "System prompt" }] },
    contents: [{ role: "user", parts: [{ text: "Read this" }, { inline_data: { mime_type: "image/png", data: "YWJj" } }] }, { role: "model", parts: [{ text: "Previous answer" }] }],
    generationConfig: { maxOutputTokens: 900 },
  }, "test-model");
  assert.equal(payload.messages[0].role, "system");
  assert.equal(payload.messages[1].content[1].image_url.url, "data:image/png;base64,YWJj");
  assert.equal(payload.messages[2].role, "assistant");
  assert.equal(payload.max_tokens, 900);
});

test("OpenRouter content string, content parts, choice text and output_text normalize", () => {
  assert.match(normalizeOpenAiResult({ choices: [{ message: { content: "plain answer" } }] }).candidates[0].content.parts[0].text, /plain answer/);
  assert.match(normalizeOpenAiResult({ choices: [{ message: { content: [{ type: "text", text: "parts answer" }] } }] }).candidates[0].content.parts[0].text, /parts answer/);
  assert.match(normalizeOpenAiResult({ choices: [{ text: "choice text" }] }).candidates[0].content.parts[0].text, /choice text/);
  assert.match(normalizeOpenAiResult({ output_text: "output text" }).candidates[0].content.parts[0].text, /output text/);
});

test("empty provider responses are rejected without exposing reasoning", () => {
  assert.throws(() => normalizeOpenAiResult({ choices: [{ message: { reasoning: "private reasoning" } }] }), /empty_model_response/);
});

test("fallback advances from Gemini 429 through OpenRouter and returns normalized JSON", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, body: options.body ? JSON.parse(options.body) : null });
    if (url.includes("generativelanguage.googleapis.com")) return response(429, { error: { message: "quota" } });
    const model = JSON.parse(options.body).model;
    if (model === DEFAULT_OPENROUTER_MODELS[0]) return response(503, { error: { message: "unavailable" } });
    return response(200, { choices: [{ message: { content: "Helpful fallback answer" } }] });
  };
  const result = await generateWithFallback({ requestOptions, geminiKey: "test", openRouterKey: "test", fetchImpl, totalTimeoutMs: 10000 });
  assert.equal(result.ok, true);
  assert.equal(result.provider, "openrouter");
  const normalized = JSON.parse(result.result.candidates[0].content.parts[0].text);
  assert.equal(normalized.reply, "Helpful fallback answer");
  assert.deepEqual(normalized.actions, []);
  assert.equal(normalized.action.type, "none");
  assert.equal(calls.length, 4);
});

test("Groq is never called unless explicitly enabled", async () => {
  const urls = [];
  const fetchImpl = async (url) => { urls.push(url); return response(503, {}); };
  await generateWithFallback({ requestOptions, geminiKey: "", groqKey: "test", openRouterKey: "", fetchImpl, totalTimeoutMs: 1000 });
  assert.equal(urls.length, 0);
});

test("Retry-After and reset headers are parsed safely", async () => {
  const { parseRetryAfterSeconds } = await import("./assistant-model-router.mjs");
  assert.equal(parseRetryAfterSeconds({ get: (name) => name === "retry-after" ? "3" : null }), 3);
  assert.equal(parseRetryAfterSeconds({ get: (name) => name === "x-ratelimit-reset-requests" ? "2m30s" : null }), 150);
  assert.equal(parseRetryAfterSeconds({ get: () => null }), null);
});

test("OpenRouter free-tier 429 stops before trying another shared-cap model", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push(url.includes("openrouter") ? JSON.parse(options.body).model : (url.match(/models\/([^:]+):/)?.[1] || "gemini"));
    if (url.includes("generativelanguage.googleapis.com")) return response(429, { error: { message: "quota" } });
    return {
      ...response(429, { error: { message: "free account daily limit" } }),
      headers: { get: (name) => name === "retry-after" ? "86400" : null },
    };
  };
  const result = await generateWithFallback({ requestOptions, geminiKey: "test", openRouterKey: "test", fetchImpl, totalTimeoutMs: 10000 });
  assert.equal(result.ok, false);
  assert.equal(result.status, 429);
  assert.equal(result.retryAfterSeconds, 86400);
  assert.deepEqual(calls, ["gemini-3.8-flash", "gemini-3.5-flash-lite", DEFAULT_OPENROUTER_MODELS[0]]);
});

test("provider status classification includes throttling and upstream outages", () => {
  for (const status of [408, 409, 425, 429, 500, 502, 503, 504, 401, 402, 403, 404]) assert.equal(isRetryableProviderStatus(status), true);
  assert.equal(isRetryableProviderStatus(400), false);
});


test("Gemini timeout moves to the alternate model before using the backup", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push(url);
    if (url.includes("generativelanguage.googleapis.com")) return response(504, { error: { message: "upstream timeout" } });
    return response(200, { choices: [{ message: { content: "Fast backup answer" } }] });
  };
  const result = await generateWithFallback({ requestOptions, geminiKey: "test", openRouterKey: "test", fetchImpl, totalTimeoutMs: 10000 });
  assert.equal(result.ok, true);
  assert.equal(result.provider, "openrouter");
  assert.equal(calls.length, 3);
  assert.match(calls[0], /gemini-3\.8-flash/);
  assert.match(calls[1], /gemini-3\.5-flash-lite/);
});

test("Gemini 503 advances to the alternate model before accepting a recovery", async () => {
  let geminiCalls = 0;
  const fetchImpl = async (url) => {
    if (url.includes("generativelanguage.googleapis.com")) {
      geminiCalls += 1;
      if (geminiCalls === 1) return response(503, { error: { message: "temporary capacity" } });
      return response(200, { candidates: [{ content: { parts: [{ text: JSON.stringify({ reply: "Recovered", actions: [] }) }] } }] });
    }
    throw new Error("OpenRouter should not be called");
  };
  const result = await generateWithFallback({ requestOptions, geminiKey: "test", openRouterKey: "test", fetchImpl, totalTimeoutMs: 10000 });
  assert.equal(result.ok, true);
  assert.equal(result.provider, "gemini");
  assert.equal(geminiCalls, 2);
});


test("Gemini primary timeout tries the lightweight Gemini model before OpenRouter", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.includes("gemini-3.8-flash:")) return response(504, { error: { message: "primary timeout" } });
    if (url.includes("gemini-3.5-flash-lite:")) return response(200, { candidates: [{ content: { parts: [{ text: JSON.stringify({ reply: "Lite recovered", actions: [] }) }] } }] });
    throw new Error("OpenRouter should not be called after Gemini model recovery");
  };
  const result = await generateWithFallback({ requestOptions, geminiKey: "test", openRouterKey: "test", fetchImpl, totalTimeoutMs: 12000 });
  assert.equal(result.ok, true);
  assert.equal(result.provider, "gemini");
  assert.equal(result.model, "gemini-3.5-flash-lite");
  assert.equal(calls.length, 2);
});

test("mixed Gemini timeout and OpenRouter 429 are not mislabeled as Gemini quota exhaustion", async () => {
  const fetchImpl = async (url) => {
    if (url.includes("generativelanguage.googleapis.com")) return response(504, { error: { message: "upstream timeout" } });
    return response(429, { error: { message: "free daily cap" } });
  };
  const result = await generateWithFallback({ requestOptions, geminiKey: "test", openRouterKey: "test", fetchImpl, totalTimeoutMs: 12000 });
  assert.equal(result.ok, false);
  assert.equal(result.status, 503);
  assert.equal(result.failureCode, "MIXED_PROVIDER_FAILURES");
  assert.deepEqual(result.providerFailures.map((failure) => failure.status), [504, 504, 429]);
});


test("Gemini SSE streaming preserves chunks across split event boundaries", async () => {
  const events = [
    'data: {"candidates":[{"content":{"parts":[{"text":"Namaste "}]}}]}\n\n',
    'data: {"candidates":[{"content":{"parts":[{"text":"business "},{"text":"owner"}]}}]}\n\n',
  ];
  const encoded = new TextEncoder();
  const chunks = [events[0].slice(0, 19), events[0].slice(19) + events[1].slice(0, 31), events[1].slice(31)];
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    headers: new Headers(),
    body: new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoded.encode(chunk));
        controller.close();
      },
    }),
  });
  const received = [];
  const result = await streamGeminiResponse({
    requestOptions,
    geminiKey: "test",
    model: "gemini-test",
    fetchImpl,
    timeoutMs: 1000,
    onTextChunk: (chunk) => received.push(chunk),
  });
  assert.deepEqual(received, ["Namaste ", "business owner"]);
  assert.equal(result.candidates[0].content.parts[0].text, "Namaste business owner");
});

test("Gemini SSE streaming rejects an empty stream rather than returning a blank answer", async () => {
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    headers: new Headers(),
    body: new ReadableStream({ start(controller) { controller.close(); } }),
  });
  await assert.rejects(
    streamGeminiResponse({ requestOptions, geminiKey: "test", model: "gemini-test", fetchImpl, timeoutMs: 1000 }),
    /empty_model_response/,
  );
});

test("Gemini SSE streaming surfaces provider stream errors", async () => {
  const payload = 'data: {"error":{"message":"stream interrupted"}}\n\n';
  const fetchImpl = async () => new Response(payload, { status: 200, headers: { "Content-Type": "text/event-stream" } });
  await assert.rejects(
    streamGeminiResponse({ requestOptions, geminiKey: "test", model: "gemini-test", fetchImpl, timeoutMs: 1000 }),
    /stream interrupted/,
  );
});
