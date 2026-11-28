import test from "node:test";
import assert from "node:assert/strict";
import { validateAssistantAttachment } from "./assistant-attachment.mjs";

test("accepts supported image MIME types", () => {
  for (const mimeType of ["image/jpeg", "image/png", "image/webp"]) {
    assert.deepEqual(validateAssistantAttachment({ mimeType, data: "aGVsbG8=" }), { ok: true, mimeType, data: "aGVsbG8=" });
  }
});

test("accepts a PDF document for model-side document understanding", () => {
  assert.deepEqual(validateAssistantAttachment({ mimeType: "application/pdf", data: "JVBERi0xLjQ=" }), {
    ok: true, mimeType: "application/pdf", data: "JVBERi0xLjQ="
  });
});

test("rejects unsupported types and malformed or oversized base64", () => {
  assert.equal(validateAssistantAttachment({ mimeType: "text/html", data: "aGVsbG8=" }).ok, false);
  assert.equal(validateAssistantAttachment({ mimeType: "application/pdf", data: "not base64!" }).ok, false);
  assert.equal(validateAssistantAttachment({ mimeType: "application/pdf", data: "A".repeat(5_600_001) }).ok, false);
});
