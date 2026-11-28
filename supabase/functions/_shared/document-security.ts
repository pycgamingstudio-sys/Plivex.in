const signatures = {
  "application/pdf": (bytes: Uint8Array) => bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d,
  "image/jpeg": (bytes: Uint8Array) => bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
  "image/png": (bytes: Uint8Array) => bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a,
  "image/webp": (bytes: Uint8Array) => bytes.length >= 12 && new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" && new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP",
};

export function validateDocumentBytes(mimeType: string, bytes: Uint8Array): boolean {
  if (!(bytes instanceof Uint8Array) || bytes.length === 0) return false;
  const signature = signatures[mimeType as keyof typeof signatures];
  if (signature) return signature(bytes);
  if (mimeType !== "text/csv" || bytes.includes(0)) return false;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return text.length > 0 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text);
  } catch {
    return false;
  }
}
