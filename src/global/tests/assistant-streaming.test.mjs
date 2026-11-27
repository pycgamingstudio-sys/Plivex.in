import test from "node:test";
import assert from "node:assert/strict";
import { extractPartialJsonStringField, parseAssistantSseBlock, streamAssistantChat } from "../../lib/assistant-streaming.mjs";

test("extracts partial JSON reply text and decodes escapes", () => {
  assert.equal(extractPartialJsonStringField('{"reply":"Hello\\nworld\\\"!'), "Hello\nworld\"!");
  const escapedPath = JSON.stringify({ reply: "folder\\file" });
  assert.equal(extractPartialJsonStringField(escapedPath), "folder\\file");
  assert.equal(extractPartialJsonStringField('{"reply":"Hello\\nwo'), "Hello\nwo");
});

test("parses named SSE events and data payloads", () => {
  assert.deepEqual(parseAssistantSseBlock('event: delta\ndata: {"text":"abc"}\n'), { event: "delta", data: '{"text":"abc"}' });
});

test("streams reply deltas and returns final action payload", async () => {
  const events = [
    'event: delta\ndata: ' + JSON.stringify({ text: '{"reply":"Hello' }) + "\n\n",
    'event: delta\ndata: ' + JSON.stringify({ text: ' world","actions":[]}' }) + "\n\n",
    'event: complete\ndata: ' + JSON.stringify({ reply: "Hello world", pendingAction: null, pendingActions: null }) + "\n\n",
  ].join("");
  const partials = [];
  const result = await streamAssistantChat({
    url: "https://example.test/functions/v1/assistant-chat", anonKey: "anon", accessToken: "token", body: { messages: [] },
    fetchImpl: async (_url, options) => {
      assert.equal(options.headers.Accept, "text/event-stream");
      assert.equal(options.headers.Authorization, "Bearer token");
      return new Response(events, { headers: { "Content-Type": "text/event-stream" } });
    },
    onPartial: (value) => partials.push(value),
  });
  assert.equal(result.reply, "Hello world");
  assert.deepEqual(partials, ["Hello", "Hello world"]);
});

test("surfaces stream errors without pretending a response succeeded", async () => {
  const events = 'event: complete\ndata: ' + JSON.stringify({ error: "Provider unavailable" }) + "\n\n";
  await assert.rejects(() => streamAssistantChat({
    url: "https://example.test", anonKey: "anon", accessToken: "token", body: {},
    fetchImpl: async () => new Response(events, { headers: { "Content-Type": "text/event-stream" } }),
  }), /Provider unavailable/);
});