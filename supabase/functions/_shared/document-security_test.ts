import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { validateDocumentBytes } from "./document-security.ts";

Deno.test("document vault accepts matching PDF, JPEG, PNG and WebP signatures", () => {
  assertEquals(validateDocumentBytes("application/pdf", new TextEncoder().encode("%PDF-1.7")), true);
  assertEquals(validateDocumentBytes("image/jpeg", new Uint8Array([0xff,0xd8,0xff,0xe0])), true);
  assertEquals(validateDocumentBytes("image/png", new Uint8Array([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])), true);
  assertEquals(validateDocumentBytes("image/webp", new TextEncoder().encode("RIFFxxxxWEBP")), true);
});

Deno.test("document vault rejects spoofed MIME types, binary CSV and unsupported formats", () => {
  assertEquals(validateDocumentBytes("application/pdf", new TextEncoder().encode("<html>fake PDF</html>")), false);
  assertEquals(validateDocumentBytes("image/png", new Uint8Array([0xff,0xd8,0xff])), false);
  assertEquals(validateDocumentBytes("text/csv", new Uint8Array([0x61,0x00,0x62])), false);
  assertEquals(validateDocumentBytes("text/csv", new Uint8Array([0xff,0xfe,0x00])), false);
  assertEquals(validateDocumentBytes("application/zip", new Uint8Array([0x50,0x4b,0x03,0x04])), false);
  assertEquals(validateDocumentBytes("text/csv", new Uint8Array([])), false);
});
