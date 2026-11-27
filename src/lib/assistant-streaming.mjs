export function parseAssistantSseBlock(block) {
  let event = "message";
  const data = [];
  for (const line of String(block || "").split(/\r?\n/)) {
    if (line.startsWith("event:")) event = line.slice(6).trim() || "message";
    else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
  }
  return { event, data: data.join("\n") };
}

export function extractPartialJsonStringField(source, field = "reply") {
  const raw = String(source || "");
  const key = JSON.stringify(String(field));
  const keyIndex = raw.indexOf(key);
  if (keyIndex < 0) return "";
  const colon = raw.indexOf(":", keyIndex + key.length);
  if (colon < 0) return "";
  let index = colon + 1;
  while (index < raw.length && /\s/.test(raw[index])) index += 1;
  if (raw[index] !== "\"") return "";
  index += 1;
  let value = "";
  while (index < raw.length) {
    const char = raw[index];
    if (char === "\"") return value;
    if (char !== "\\") { value += char; index += 1; continue; }
    if (index + 1 >= raw.length) break;
    const escaped = raw[index + 1];
    const simple = new Map([[String.fromCharCode(34), String.fromCharCode(34)], [String.fromCharCode(92), String.fromCharCode(92)], ["/", "/"], ["b", "\b"], ["f", "\f"], ["n", "\n"], ["r", "\r"], ["t", "\t"]]);
    if (simple.has(escaped)) { value += simple.get(escaped); index += 2; continue; }
    if (escaped === "u") {
      if (index + 5 >= raw.length) break;
      const hex = raw.slice(index + 2, index + 6);
      if (!/^[0-9a-f]{4}$/i.test(hex)) { value += "u"; index += 2; continue; }
      value += String.fromCharCode(parseInt(hex, 16));
      index += 6;
      continue;
    }
    value += escaped;
    index += 2;
  }
  return value;
}

export async function streamAssistantChat({ url, anonKey, accessToken, body, signal, onPartial, fetchImpl = fetch }) {
  const response = await fetchImpl(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, apikey: anonKey, "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify(body || {}),
    signal,
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(String(payload?.error || `Assistant request failed (${response.status}).`));
  }
  if (!response.body?.getReader) throw new Error("Assistant streaming response is unavailable.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let rawModelText = "";
  let lastPartial = "";
  let result = null;
  const consume = (block) => {
    const parsed = parseAssistantSseBlock(block);
    if (!parsed.data) return;
    if (parsed.event === "delta") {
      const payload = JSON.parse(parsed.data);
      if (typeof payload?.text === "string") {
        rawModelText += payload.text;
        const partial = extractPartialJsonStringField(rawModelText, "reply");
        if (partial !== lastPartial) { lastPartial = partial; if (typeof onPartial === "function") onPartial(partial); }
      }
    } else if (parsed.event === "complete") {
      result = JSON.parse(parsed.data);
    } else if (parsed.event === "error") {
      const payload = JSON.parse(parsed.data);
      throw new Error(String(payload?.error || "Assistant stream failed."));
    }
  };
  try {
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
  } finally {
    try { reader.releaseLock(); } catch { /* stream already released */ }
  }
  if (!result) throw new Error("Assistant stream ended before a final response was received.");
  if (result.error) throw new Error(String(result.error));
  if (typeof result.reply !== "string" || !result.reply.trim()) throw new Error("AI returned an empty response. Please try again.");
  return result;
}