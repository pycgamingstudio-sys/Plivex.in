export function getAssistantSpeechLanguage(value, fallbackLanguage = "en-IN") {
  const text = String(value ?? "");
  if (/[\\u0900-\\u097F]/.test(text)) return "hi-IN";
  const fallback = String(fallbackLanguage || "en-IN").trim();
  if (fallback.toLowerCase().startsWith("hi")) return "hi-IN";
  if (fallback.toLowerCase().startsWith("en")) return "en-IN";
  return fallback || "en-IN";
}

export function normalizeAssistantSpeechText(value, maxLength = 4000) {
  const limit = Number.isFinite(maxLength) ? Math.max(0, Math.min(12000, Math.floor(maxLength))) : 4000;
  return String(value ?? "").replace(/\\u0000/g, "").trim().slice(0, limit);
}
