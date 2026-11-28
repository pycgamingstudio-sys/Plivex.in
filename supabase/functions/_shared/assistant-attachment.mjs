const SUPPORTED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);

export function validateAssistantAttachment(value) {
  const mimeType = String(value?.mimeType || "").trim().toLowerCase();
  const data = typeof value?.data === "string" ? value.data : "";
  if (!SUPPORTED_MIME_TYPES.has(mimeType)) {
    return { ok: false, error: "Please attach a JPG, PNG, WebP image or PDF document smaller than 4 MB." };
  }
  if (!data || !/^[A-Za-z0-9+/]+={0,2}$/.test(data) || data.length > 5_600_000) {
    return { ok: false, error: "The attachment is invalid or larger than 4 MB. Please choose a smaller file." };
  }
  return { ok: true, mimeType, data };
}
