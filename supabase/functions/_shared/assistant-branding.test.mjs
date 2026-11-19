import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [assistantChat, assistantWidget] = await Promise.all([
  readFile(new URL("../assistant-chat/index.ts", import.meta.url), "utf8"),
  readFile(new URL("../../../../src/components/AssistantWidget.jsx", import.meta.url), "utf8"),
]);

test("Plivex Nova identity is consistent across assistant runtime and UI", () => {
  assert.match(assistantChat, /You are Plivex Nova \(Plivex Intelligence\)/);
  assert.match(assistantWidget, /Plivex Nova/);
  assert.match(assistantWidget, /Ask Nova/);
  assert.doesNotMatch(assistantWidget, /Plivex AI Assistant/);
});
