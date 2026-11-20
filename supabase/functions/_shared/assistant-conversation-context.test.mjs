import test from "node:test";
import assert from "node:assert/strict";
import { buildConversationRoutingText, isBusinessContextFollowUp } from "./assistant-conversation-context.mjs";

test("keeps the latest independent request as the routing context", () => {
  const messages = [
    { role: "user", content: "Mere pending invoices ka summary do" },
    { role: "assistant", content: "You have pending invoices." },
    { role: "user", content: "GST registration kaise hota hai?" },
  ];
  assert.equal(buildConversationRoutingText(messages), "GST registration kaise hota hai?");
});

test("carries invoice context into a short Hinglish follow-up", () => {
  const messages = [
    { role: "user", content: "Mere pending invoices ka summary do" },
    { role: "assistant", content: "You have 4 pending invoices." },
    { role: "user", content: "Aur overdue kitne hain?" },
  ];
  assert.match(buildConversationRoutingText(messages), /pending invoices/);
  assert.equal(isBusinessContextFollowUp(messages), true);
});

test("carries business context into a natural English follow-up", () => {
  const messages = [
    { role: "user", content: "Review my sales and expenses for this quarter." },
    { role: "assistant", content: "Here is the summary." },
    { role: "user", content: "What about last month?" },
  ];
  assert.match(buildConversationRoutingText(messages), /sales and expenses/);
});

test("does not load old business context for greetings or acknowledgements", () => {
  const messages = [
    { role: "user", content: "Show my invoices" },
    { role: "assistant", content: "Here is your invoice summary." },
    { role: "user", content: "Thanks" },
  ];
  assert.equal(buildConversationRoutingText(messages), "Thanks");
  assert.equal(isBusinessContextFollowUp(messages), false);
});

test("bounds the routing context to the most recent user turns", () => {
  const messages = [
    { role: "user", content: "Old business question about invoices" },
    { role: "assistant", content: "Old answer" },
    { role: "user", content: "Review my expenses" },
    { role: "assistant", content: "Recent answer" },
    { role: "user", content: "And cash flow?" },
  ];
  const context = buildConversationRoutingText(messages, 2);
  assert.doesNotMatch(context, /Old business question/);
  assert.match(context, /Review my expenses/);
});
