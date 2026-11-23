import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const crm = read("../../components/workspace/WorkspaceCRMPanel.jsx");
const dashboard = read("../../components/dashboard/DashboardTab.jsx");
const sales = read("../../components/dashboard/SalesTab.jsx");
const purchase = read("../../components/dashboard/PurchaseTab.jsx");
const stock = read("../../components/dashboard/StockTab.jsx");

test("CRM pipeline stages communicate their meaning with distinct semantic colours", () => {
  for (const tone of [
    "New Lead", "bg-sky-500", "Qualified", "bg-cyan-500",
    "Proposal", "bg-amber-500", "Negotiation", "bg-violet-500",
    "Won", "bg-emerald-500", "Lost", "bg-rose-500"
  ]) assert.ok(crm.includes(tone), "missing CRM stage colour cue: " + tone);
});

test("CRM lead score and follow-up urgency are visually scannable", () => {
  assert.match(crm, /Lead score<\/span>/);
  assert.match(crm, /from-sky-500 via-cyan-500 to-emerald-500/);
  assert.match(crm, /overdue\?"border-rose-200 bg-rose-50 text-rose-700":"border-amber-200 bg-amber-50 text-amber-700"/);
});

test("existing dashboard and financial module card colours remain intact", () => {
  for (const tone of [
    "from-[#EDE9FE] to-[#DDD6FE]", "from-[#DBEAFE] to-[#BFDBFE]",
    "from-[#DCFCE7] to-[#BBF7D0]", "from-[#FAE8FF] to-[#F5D0FE]"
  ]) assert.ok(dashboard.includes(tone), "existing dashboard card colour changed: " + tone);
  assert.match(sales, /from-\[#059669\] to-\[#10B981\]/);
  assert.match(sales, /from-\[#D97706\] to-\[#F59E0B\]/);
  assert.match(purchase, /from-\[#E11D48\] to-\[#F43F5E\]/);
  assert.match(purchase, /from-\[#059669\] to-\[#10B981\]/);
  assert.match(stock, /from-\[#059669\] to-\[#10B981\]/);
});
