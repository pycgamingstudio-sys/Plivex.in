const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent";
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
    signal: AbortSignal.timeout(Math.min(6000, remaining)),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const providerError = result?.error || {};
    const detail = typeof providerError?.message === "string" ? providerError.message.slice(0, 180) : "";
    const code = typeof providerError?.code === "string" || typeof providerError?.code === "number" ? String(providerError.code).slice(0, 40) : "";
    const error = new Error(`${provider}_http_${response.status}${code ? `_${code}` : ""}${detail ? `: ${detail}` : ""}`);
    error.status = response.status;
    error.retryable = isRetryableProviderStatus(response.status) || [400, 401, 402, 403, 404].includes(response.status);
    throw error;
  }
  return normalizeOpenAiResult(result);
}

export async function generateWithFallback({
  requestOptions,
  geminiKey,
  groqKey,
  openRouterKey,
  enableGroq = false,
  fetchImpl = fetch,
  totalTimeoutMs = 45000,
}) {
  const body = JSON.parse(requestOptions.body);
  const deadline = Date.now() + totalTimeoutMs;
  const attempts = [];
  if (geminiKey) attempts.push({ provider: "gemini", model: "gemini-3.8-flash" });
  // Groq's current GPT-OSS endpoints are metered. Keep them off unless the
  // project owner explicitly enables Groq usage after reviewing account billing.
  if (groqKey && enableGroq) {
    for (const model of DEFAULT_GROQ_MODELS) attempts.push({ provider: "groq", model });
  }
  if (openRouterKey) {
    for (const model of DEFAULT_OPENROUTER_MODELS) attempts.push({ provider: "openrouter", model });
  }
  let lastStatus = 503;
  for (const attempt of attempts) {
    if (Date.now() >= deadline) break;
    try {
      let result;
      if (attempt.provider === "gemini") {
        const remaining = deadline - Date.now();
        const response = await fetchImpl(GEMINI_URL, {
          ...requestOptions,
          headers: { ...requestOptions.headers, "x-goog-api-key": geminiKey },
          signal: AbortSignal.timeout(Math.min(20000, remaining)),
        });
        result = await response.json().catch(() => ({}));
        if (!response.ok) {
          lastStatus = response.status;
          console.warn("Nova provider unavailable", { provider: attempt.provider, model: attempt.model, status: response.status });
          continue;
        }
      } else {
        result = await callOpenAiProvider({ ...attempt, key: attempt.provider === "groq" ? groqKey : openRouterKey, body, fetchImpl, deadline });
      }
      result = assertJsonModelResult(result);
      return { ok: true, provider: attempt.provider, model: attempt.model, result };
    } catch (error) {
      lastStatus = Number(error?.status) || (error?.name === "TimeoutError" || error?.name === "AbortError" ? 504 : 503);
      console.warn("Nova provider attempt failed", {
        provider: attempt.provider,
        model: attempt.model,
        status: lastStatus,
        reason: error?.message || "network_error",
      });
    }
  }
  return { ok: false, status: lastStatus === 429 ? 429 : lastStatus === 504 ? 504 : 503 };
}
