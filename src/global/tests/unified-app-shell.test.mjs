import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("unified app mounts one Main Workspace route tree for every supported country", () => {
  const app = read("../../App.jsx");
  assert.match(app, /All supported countries use the same Main Workspace routes/);
  assert.ok(app.includes('<Route path="/dashboard" element={<HomeGate />} />'));
  assert.ok(app.includes('<Route path="/invoice-history" element={<InvoiceHistory />} />'));
  assert.ok(app.includes('path="/quotations" element={<Navigate to="/dashboard" replace state={{ initialTab: "sales", initialSub: "quotations" }} />}'));
  assert.doesNotMatch(app, /GlobalApp|isGlobalWorkspace/);
  assert.match(app, /<AuthProvider>/);
  assert.match(app, /<AppLayout \/>/);
});

test("payment callback routing preserves unconditional hook order", () => {
  const app = read("../../App.jsx");
  const component = app.slice(app.indexOf("const AuthenticatedApp ="), app.indexOf("// Shows a message"));
  assert.ok(component.indexOf("const { isLoadingAuth") < component.indexOf('if (window.location.pathname === "/payment-result")'));
});

test("unified authentication resolves the workspace country without activating a legacy Global workspace", () => {
  const auth = read("../../lib/AuthContext.jsx");
  const backend = read("../../api/backendClient.js");
  assert.match(auth, /if \(isUnifiedBuild\)/);
  assert.match(auth, /setRuntimeEdition\("india"\)/);
  assert.match(auth, /currentUser\?\.country_code/);
  assert.ok(auth.indexOf("if (isUnifiedBuild)") < auth.indexOf("global-auth-context"));
  assert.match(backend, /if \(isUnifiedBuild && edition === "global"\) return false/);
});

test("shared CRM, warehouse and platform modules are routed through the Main Workspace", () => {
  const app = read("../../App.jsx");
  const nav = read("../../lib/nav.js");
  assert.match(app, /WorkspaceFeatureGate anyOf=\{\["crm", "leads"\]\}/);
  assert.match(app, /WorkspaceFeatureGate feature="inventoryWorkspace"/);
  assert.match(nav, /CRM & leads/);
  assert.match(nav, /Inventory & procurement/);
  assert.match(app, /WorkspacePlatformPage/);
});

test("legacy Global-only route gates do not block supported non-India workspaces", () => {
  const app = read("../../App.jsx");
  assert.doesNotMatch(app, /isGlobalWorkspace/);
  assert.doesNotMatch(app, /APP_EDITION === "global" && user\?\.country_code/);
});
