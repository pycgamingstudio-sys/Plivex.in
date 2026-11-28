import { assertEquals, assertNotEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  decodePublicApiCursor,
  encodePublicApiCursor,
  normalizePublicApiLead,
  parsePublicApiLimit,
  publicApiError,
} from "./public-api-contract.ts";

Deno.test("public API cursors round-trip and reject malformed or tampered values", () => {
  const cursor = { created_at: "2026-11-28T10:15:00.000Z", id: "123e4567-e89b-42d3-a456-426614174000" };
  const encoded = encodePublicApiCursor(cursor);
  assertEquals(decodePublicApiCursor(encoded), cursor);
  assertEquals(decodePublicApiCursor("not-a-cursor"), null);
  assertEquals(decodePublicApiCursor("eyJpZCI6Im5vdC11dWlkIiwiY3JlYXRlZF9hdCI6IjIwMjYtMTEtMjhUMTA6MTU6MDAuMDAwWiJ9"), null);
  assertNotEquals(encoded, "not-a-cursor");
});

Deno.test("public API page limits are bounded to 1..100", () => {
  assertEquals(parsePublicApiLimit(undefined), 50);
  assertEquals(parsePublicApiLimit("25"), 25);
  assertEquals(parsePublicApiLimit(100), 100);
  assertEquals(parsePublicApiLimit(0), null);
  assertEquals(parsePublicApiLimit(101), null);
  assertEquals(parsePublicApiLimit(1.5), null);
});

Deno.test("public API lead validation normalizes fields and rejects unsafe values", () => {
  assertEquals(normalizePublicApiLead({ name: "  Acme  ", email: " SALES@EXAMPLE.COM ", value: "12.50" }), {
    ok: true,
    value: { name: "Acme", company: null, email: "sales@example.com", phone: null, requirement: null, value: 12.5 },
  });
  assertEquals(normalizePublicApiLead({ name: "x" }).ok, false);
  assertEquals(normalizePublicApiLead({ name: "Acme", value: -1 }).ok, false);
  assertEquals(normalizePublicApiLead({ name: "Acme", email: "bad" }).ok, false);
});

Deno.test("public API errors have stable machine codes and request correlation", () => {
  const result = publicApiError("API_RATE_LIMITED", "123e4567-e89b-42d3-a456-426614174000");
  assertEquals(result.status, 429);
  assertEquals(result.body.api_version, "v1");
  assertEquals(result.body.error.code, "API_RATE_LIMITED");
  assertEquals(result.body.error.retryable, true);
  assertEquals(result.body.error.request_id, "123e4567-e89b-42d3-a456-426614174000");
});
