const GEMINI_URL_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
export const DEFAULT_GEMINI_MODELS = ["gemini-3.8-flash", "gemini-3.5-flash-lite"];
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

export const DEFAULT_GROQ_MODELS = ["openai/gpt-oss-120b", "openai/gpt-oss-20b"];
// Use the live free-model router first, then current explicit free fallbacks.
// Explicit free models with provider-side no-training policies. Avoid the
// dynamic free router and providers that are incompatible with data_collection=deny.
export const DEFAULT_OPENROUTER_MODELS = [
  "google/gemma-4-31b-it:free",
  "google/gemma-4-26b-a4b-it:free",
];

function openAiMessages(geminiBody) {
  const systemText = (geminiBody?.system_instruction?.parts || [])
    .map((part) => typeof part?.text === "string" ? part.text : "")
    .filter(Boolean).join("\n");
  const messages = [];
  if (systemText) messages.push({ role: "system", content: systemText });
  for (const item of Array.isArray(geminiBody?.contents) ? geminiBody.contents : []) {
    const role = item?.role === "model" ? "assistant" : "user";
    const parts = Array.isArray(item?.parts) ? item.parts : [];
    const content = [];
    for (const part of parts) {
      if (typeof part?.text === "string" && part.text) content.push({ type: "text", text: part.text });
      if (part?.inline_data?.data && part?.inline_data?.mime_type) {
        content.push({ type: "image_url", image_url: { url: `data:${part.inline_data.mime_type};base64,${part.inline_data.data}` } });
      }
    }
    if (!content.length) continue;
    messages.push({ role, content: content.length === 1 && content[0].type === "text" ? content[0].text : content });
  }
  return messages;
}

export function toOpenAiChatPayload(geminiBody, model) {
  return {
    model,
    messages: openAiMessages(geminiBody),
    max_tokens: geminiBody?.generationConfig?.maxOutputTokens || 2200,
    response_format: { type: "json_object" },
    provider: { data_collection: "deny" },
  };
}

function assertJsonModelResult(result) {
  const raw = result?.candidates?.[0]?.content?.parts
    ?.map((part) => typeof part?.text === "string" ? part.text : "")
    .join("")
    .trim();
  if (!raw) throw new Error("empty_model_response");

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Some compatible free models return plain text despite response_format.
    // Wrap it in the exact chat contract and force the turn to be read-only.
    const normalized = { reply: raw.slice(0, 12000), actions: [], action: { type: "none", payload: {} } };
    return { candidates: [{ content: { parts: [{ text: JSON.stringify(normalized) }] } }] };
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("invalid_model_response_schema");
  }

  const replyKeys = ["reply", "message", "response", "answer", "text", "content"];
  let reply = "";
  for (const key of replyKeys) {
    if (typeof parsed[key] === "string" && parsed[key].trim()) {
      reply = parsed[key].trim();
      break;
    }
  }
  if (!reply && parsed.output && typeof parsed.output === "object") {
    for (const key of replyKeys) {
      if (typeof parsed.output[key] === "string" && parsed.output[key].trim()) {
        reply = parsed.output[key].trim();
        break;
      }
    }
  }
  if (!reply) throw new Error("invalid_model_response_schema");

  // Normalize every provider response to the exact JSON contract consumed by
  // assistant-chat. Plain-text fallback answers are strictly read-only.
  const actions = Array.isArray(parsed.actions) ? parsed.actions : [];
  const normalized = {
    ...parsed,
    reply: reply.slice(0, 12000),
    actions,
    ...(parsed.action && typeof parsed.action === "object"
      ? {}
      : { action: { type: "none", payload: {} } }),
  };
  return { candidates: [{ content: { parts: [{ text: JSON.stringify(normalized) }] } }] };
}

export function normalizeOpenAiResult(result) {
  const choice = result?.choices?.[0] || {};
  const message = choice?.message || {};
  const content = message?.content ?? choice?.text ?? result?.output_text ?? "";
  const raw = typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content.map((part) => {
          if (typeof part?.text === "string") return part.text;
          if (typeof part?.content === "string") return part.content;
          return "";
        }).join("")
      : "";
  const fallback = typeof message?.refusal === "string" ? message.refusal : "";
  const finalText = (raw || fallback).trim();
  if (!finalText) {
    const shape = {
      hasChoices: Array.isArray(result?.choices),
      choiceKeys: Object.keys(choice || {}).slice(0, 12),
      messageKeys: Object.keys(message || {}).slice(0, 12),
      finishReason: choice?.finish_reason || null,
      hasOutputText: typeof result?.output_text === "string",
    };
    throw new Error("empty_model_response:" + JSON.stringify(shape));
  }
  return { candidates: [{ content: { parts: [{ text: finalText }] } }] };
}

export function parseRetryAfterSeconds(headers, now = Date.now()) {
  const raw = headers?.get?.("retry-after");
  if (raw) {
    const seconds = Number(raw);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);
    const date = Date.parse(raw);
    if (Number.isFinite(date)) return Math.max(0, Math.ceil((date - now) / 1000));
  }
  const reset = headers?.get?.("x-ratelimit-reset-requests");
  if (reset) {
    const value = String(reset).trim();
    const parts = [...value.matchAll(/(\d+(?:\.\d+)?)(ms|s|m|h)/g)];
    if (parts.length) {
      const total = parts.reduce((sum, part) => sum + Number(part[1]) * ({ ms: 0.001, s: 1, m: 60, h: 3600 }[part[2]]), 0);
      if (Number.isFinite(total)) return Math.ceil(total);
    }
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);
  }
  return null;
}

export function isRetryableProviderStatus(status) {
  return [401, 402, 403, 404].includes(status) || status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

async function callOpenAiProvider({ provider, model, key, body, fetchImpl, deadline }) {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Error("router_deadline_exceeded");
  const endpoint = provider === "groq" ? GROQ_URL : OPENROUTER_URL;
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${key}` };
  if (provider === "openrouter") {
    headers["HTTP-Referer"] = "https://plivex.in";
    headers["X-Title"] = "Plivex Nova";
  }
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(toOpenAiChatPayload(body, model)),
    signal: AbortSignal.timeout(Math.min(7500, remaining)),
  });
  const retryAfterSeconds = parseRetryAfterSeconds(response.headers);
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const providerError = result?.error || {};
    const detail = typeof providerError?.message === "string" ? providerError.message.slice(0, 180) : "";
    const code = typeof providerError?.code === "string" || typeof providerError?.code === "number" ? String(providerError.code).slice(0, 40) : "";
    const error = new Error(`${provider}_http_${response.status}${code ? `_${code}` : ""}${detail ? `: ${detail}` : ""}`);
    error.status = response.status;
    error.retryAfterSeconds = retryAfterSeconds;
    error.retryable = isRetryableProviderStatus(response.status) || [400, 401, 402, 403, 404].includes(response.status);
    throw error;
  }
  return normalizeOpenAiResult(result);
}

export async function streamGeminiResponse({ requestOptions, geminiKey, model, fetchImpl = fetch, timeoutMs = 12000, onTextChunk }) {
  const response = await fetchImpl(`${GEMINI_URL_BASE}/${model}:streamGenerateContent?alt=sse`, {
    ...requestOptions,
    headers: { ...requestOptions.headers, "x-goog-api-key": geminiKey },
    signal: AbortSignal.timeout(Math.max(1, timeoutMs)),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const error = new Error(String(payload?.error?.message || payload?.error?.status || "gemini_stream_unavailable"));
    error.status = response.status;
    error.retryAfterSeconds = parseRetryAfterSeconds(response.headers);
    throw error;
  }
  if (!response.body) throw new Error("stream_body_unavailable");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let rawText = "";
  const consume = (block) => {
    const data = block.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n").trim();
    if (!data || data === "[DONE]") return;
    const payload = JSON.parse(data);
    if (payload?.error) throw new Error(String(payload.error.message || "gemini_stream_error"));
    if (payload?.promptFeedback?.blockReason) throw new Error("gemini_stream_blocked");
    const chunk = (payload?.candidates?.[0]?.content?.parts || []).map((part) => typeof part?.text === "string" ? part.text : "").join("");
    if (chunk) { rawText += chunk; if (typeof onTextChunk === "function") onTextChunk(chunk); }
  };
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() || "";
    for (const block of blocks) consume(block);
  }
  buffer += decoder.decode();
  if (buffer.trim()) consume(buffer);
  if (!rawText.trim()) throw new Error("empty_model_response");
  return { candidates: [{ content: { parts: [{ text: rawText }] } }] };
}
export function hasPdfAttachmentRequest(body) {
  return (Array.isArray(body?.contents) ? body.contents : []).some((item) =>
    (Array.isArray(item?.parts) ? item.parts : []).some((part) =>
      String(part?.inline_data?.mime_type || "").toLowerCase() === "application/pdf"
    )
  );
}

export async function generateWithFallback({
  requestOptions,
  geminiKey,
  groqKey,
  openRouterKey,
  enableGroq = false,
  fetchImpl = fetch,
  totalTimeoutMs = 45000,
  onTextChunk = /** @type {((chunk: string) => void) | null} */ (null),
}) {
  const body = JSON.parse(requestOptions.body);
  const deadline = Date.now() + totalTimeoutMs;
  const attempts = [];
  const hasPdfAttachment = hasPdfAttachmentRequest(body);
  if (geminiKey) {
    for (const [index, model] of DEFAULT_GEMINI_MODELS.entries()) {
      attempts.push({ provider: "gemini", model, timeoutMs: index === 0 ? 12000 : 8000 });
    }
  }
  // Groq's current GPT-OSS endpoints are metered. Keep them off unless the
  // project owner explicitly enables Groq usage after reviewing account billing.
  if (!hasPdfAttachment && groqKey && enableGroq) {
    for (const model of DEFAULT_GROQ_MODELS) attempts.push({ provider: "groq", model });
  }
  if (!hasPdfAttachment && openRouterKey) {
    for (const model of DEFAULT_OPENROUTER_MODELS) attempts.push({ provider: "openrouter", model });
  }
  let lastStatus = 503;
  let retryAfterSeconds = null;
  const providerFailures = [];
  let streamedAny = false;
  for (const attempt of attempts) {
    if (Date.now() >= deadline) break;
    try {
      let result;
      if (attempt.provider === "gemini") {
        // A timeout is already a long wait: fail over immediately instead of
        // spending another full timeout on the same upstream. Retry only a
        // fast explicit 502/503/500 response once with a short jitter.
        const remaining = deadline - Date.now();
        if (remaining <= 0) break;
        let response;
        try {
          if (typeof onTextChunk === "function") {
            result = await streamGeminiResponse({
              requestOptions, geminiKey, model: attempt.model, fetchImpl,
              timeoutMs: Math.min(attempt.timeoutMs, remaining),
              onTextChunk: (chunk) => { streamedAny = true; onTextChunk(chunk); },
            });
          } else {
            response = await fetchImpl(`${GEMINI_URL_BASE}/${attempt.model}:generateContent`, {
              ...requestOptions,
              headers: { ...requestOptions.headers, "x-goog-api-key": geminiKey },
              signal: AbortSignal.timeout(Math.min(attempt.timeoutMs, remaining)),
            });
          }
        } catch (error) {
          lastStatus = Number(error?.status) || (error?.name === "TimeoutError" || error?.name === "AbortError" ? 504 : 503);
          retryAfterSeconds = Number.isFinite(error?.retryAfterSeconds) ? error.retryAfterSeconds : retryAfterSeconds;
          providerFailures.push({ provider: "gemini", model: attempt.model, status: lastStatus, reason: String(error?.message || "network_error").slice(0, 160) });
          if (streamedAny) return { ok: false, status: lastStatus === 429 ? 429 : 503, failureCode: "STREAM_INTERRUPTED", providerFailures, retryAfterSeconds };
          console.warn("Nova Gemini request failed; switching provider", {
            provider: "gemini", model: attempt.model, status: lastStatus,
            reason: error?.message || "network_error",
          });
          continue;
        }
        if (typeof onTextChunk !== "function") {
          retryAfterSeconds = parseRetryAfterSeconds(response.headers) ?? retryAfterSeconds;
          if (!response.ok) {
          const errorPayload = await response.json().catch(() => ({}));
          const providerError = errorPayload?.error || {};
          const detail = String(providerError.message || providerError.status || "upstream_error").slice(0, 180);
          lastStatus = response.status;
          providerFailures.push({ provider: "gemini", model: attempt.model, status: response.status, reason: detail });
          console.warn("Nova provider unavailable; switching provider", {
            provider: "gemini", model: attempt.model, status: response.status, retryAfterSeconds, reason: detail,
          });
          continue;
        }
          result = await response.json().catch(() => ({}));
        }
      } else {
        result = await callOpenAiProvider({ ...attempt, key: attempt.provider === "groq" ? groqKey : openRouterKey, body, fetchImpl, deadline });
      }
      result = assertJsonModelResult(result);
      return { ok: true, provider: attempt.provider, model: attempt.model, result };
    } catch (error) {
      lastStatus = Number(error?.status) || (error?.name === "TimeoutError" || error?.name === "AbortError" ? 504 : 503);
      retryAfterSeconds = Number.isFinite(error?.retryAfterSeconds) ? error.retryAfterSeconds : retryAfterSeconds;
      providerFailures.push({ provider: attempt.provider, model: attempt.model, status: lastStatus, reason: String(error?.message || "network_error").slice(0, 160) });
      if (streamedAny) return { ok: false, status: lastStatus === 429 ? 429 : 503, failureCode: "STREAM_INTERRUPTED", providerFailures, retryAfterSeconds };
      console.warn("Nova provider attempt failed", {
        provider: attempt.provider,
        model: attempt.model,
        status: lastStatus,
        retryAfterSeconds,
        reason: error?.message || "network_error",
      });
      // All configured OpenRouter variants are :free and share the account-level
      // daily cap. A 429 may consume that cap even when it fails, so do not burn
      // another failed request against a second free model.
      if (attempt.provider === "openrouter" && lastStatus === 429) break;
    }
  }
  const allProvidersRateLimited = providerFailures.length > 0 && providerFailures.every((failure) => failure.status === 429);
  const hadTimeout = providerFailures.some((failure) => failure.status === 504);
  return {
    ok: false,
    status: allProvidersRateLimited ? 429 : hadTimeout ? 503 : lastStatus === 504 ? 504 : 503,
    failureCode: allProvidersRateLimited ? "ALL_PROVIDERS_RATE_LIMITED" : hadTimeout ? "MIXED_PROVIDER_FAILURES" : "PROVIDERS_UNAVAILABLE",
    providerFailures,
    retryAfterSeconds,
  };
}
