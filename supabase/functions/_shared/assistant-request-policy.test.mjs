import test from "node:test";
import assert from "node:assert/strict";
import { getAssistantRequestPolicy } from "./assistant-request-policy.mjs";

test("general chat in a Global workspace skips all business-record lookups", () => {
  const policy = getAssistantRequestPolicy({ isGlobalWorkspace: true });
  assert.equal(policy.loadGlobalContext, false);
  assert.equal(policy.simpleConversationalTurn, true);
  assert.equal(policy.thinkingLevel, "low");
  assert.equal(policy.maxOutputTokens, 1200);
});

test("greetings and general questions use the fast response profile", () => {
  const policy = getAssistantRequestPolicy({});
  assert.equal(policy.simpleConversationalTurn, true);
  assert.equal(policy.thinkingLevel, "low");
});

test("business data questions load context and retain medium reasoning", () => {
  const policy = getAssistantRequestPolicy({
    isGlobalWorkspace: true,
    needsGlobalFinanceContext: true,
    needsWorkspaceContext: true,
  });
  assert.equal(policy.loadGlobalContext, true);
  assert.equal(policy.simpleConversationalTurn, false);
  assert.equal(policy.thinkingLevel, "medium");
  assert.equal(policy.maxOutputTokens, 1800);
});

test("image requests do not use the lightweight plain-chat profile", () => {
  const policy = getAssistantRequestPolicy({ hasImage: true });
  assert.equal(policy.simpleConversationalTurn, false);
  assert.equal(policy.thinkingLevel, "medium");
});

test("purchasing context is retained for inventory workflows", () => {
  const policy = getAssistantRequestPolicy({ needsPurchasingContext: true });
  assert.equal(policy.simpleConversationalTurn, false);
  assert.equal(policy.maxOutputTokens, 1800);
});
