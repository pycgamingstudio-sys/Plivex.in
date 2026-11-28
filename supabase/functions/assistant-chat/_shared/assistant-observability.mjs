const clean = (value, fallback = "unknown") => {
  const text = String(value ?? "").trim();
  return /^[a-z0-9._-]{1,80}$/i.test(text) ? text : fallback;
};

export function createAssistantRequestMetric({ requestId, startedAt, finishedAt, status, requestClass, provider, model, ttftMs }) {
  const end = Number.isFinite(finishedAt) ? finishedAt : Date.now();
  const start = Number.isFinite(startedAt) ? startedAt : end;
  return {
    event: "nova_request_metric",
    request_id: clean(requestId),
    request_class: clean(requestClass),
    provider: clean(provider),
    model: clean(model),
    duration_ms: Math.max(0, Math.round(end - start)),
    ttft_ms: Number.isFinite(ttftMs) ? Math.max(0, Math.round(ttftMs)) : null,
    status: Number.isInteger(status) ? status : 500,
    timestamp: new Date(end).toISOString(),
  };
}

export function summarizeAssistantLatency(samples) {
  const values = (Array.isArray(samples) ? samples : []).map(Number).filter((value) => Number.isFinite(value) && value >= 0).sort((a, b) => a - b);
  const percentile = (p) => values.length ? values[Math.max(0, Math.ceil(p * values.length) - 1)] : null;
  return { sample_count: values.length, p50_ms: percentile(0.5), p95_ms: percentile(0.95), max_ms: values.length ? values[values.length - 1] : null };
}