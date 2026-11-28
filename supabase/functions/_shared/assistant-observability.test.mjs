import test from "node:test";
import assert from "node:assert/strict";
import { createAssistantRequestMetric, summarizeAssistantLatency } from "./assistant-observability.mjs";

test("request metric records timing and safe routing metadata only", () => {
  const metric = createAssistantRequestMetric({ requestId: "req-123", startedAt: 100, finishedAt: 185, status: 200, requestClass: "simple", provider: "gemini", model: "gemini-3.8-flash", ttftMs: 24 });
  assert.equal(metric.event, "nova_request_metric");
  assert.equal(metric.duration_ms, 85);
  assert.equal(metric.ttft_ms, 24);
  assert.equal(metric.status, 200);
  assert.equal(metric.request_class, "simple");
  assert.equal("prompt" in metric, false);
  assert.equal("workspace_id" in metric, false);
});

test("request metric preserves multi-step routing class for latency analysis", () => {
  const metric = createAssistantRequestMetric({ requestId: "req-multi", startedAt: 100, finishedAt: 240, status: 200, requestClass: "multi_step", provider: "gemini", model: "gemini-3.8-flash", ttftMs: 62 });
  assert.equal(metric.request_class, "multi_step");
  assert.equal(metric.duration_ms, 140);
  assert.equal(metric.ttft_ms, 62);
});

test("request metric clamps negative duration and sanitizes labels", () => {
  const metric = createAssistantRequestMetric({ requestId: "bad id", startedAt: 200, finishedAt: 100, status: 200, requestClass: "simple chat", provider: "gemini", model: "model" });
  assert.equal(metric.request_id, "unknown");
  assert.equal(metric.request_class, "unknown");
  assert.equal(metric.duration_ms, 0);
  assert.equal(metric.ttft_ms, null);
});

test("latency summary calculates nearest-rank p50 and p95", () => {
  assert.deepEqual(summarizeAssistantLatency([10,20,30,40,50,60,70,80,90,100]), { sample_count: 10, p50_ms: 50, p95_ms: 100, max_ms: 100 });
});

test("latency summary ignores invalid samples and handles empty input", () => {
  assert.deepEqual(summarizeAssistantLatency([10,-1,"bad",20]), { sample_count: 2, p50_ms: 10, p95_ms: 20, max_ms: 20 });
  assert.deepEqual(summarizeAssistantLatency([]), { sample_count: 0, p50_ms: null, p95_ms: null, max_ms: null });
});