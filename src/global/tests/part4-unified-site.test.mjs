import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(path, "utf8");

test("public site uses the single canonical Plivex domain", () => {
  const html = read("index.html");
  assert.match(html, /<link rel="canonical" href="https:\/\/plivex\.in\/"\s*\/>/);
  assert.doesNotMatch(html, /https:\/\/www\.plivex\.in/);

  const jsonLd = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  assert.ok(jsonLd.length >= 2, "expected SoftwareApplication and Organization structured data");
  for (const [, source] of jsonLd) {
    const data = JSON.parse(source);
    assert.ok(data.url.startsWith("https://plivex.in/"));
  }
});

test("public attribution distinguishes the owner from the developer", () => {
  const about = read("src/pages/PublicInfoPages.jsx");
  const section = read("src/components/landing/AboutSection.jsx");
  const html = read("index.html");

  assert.match(about, /Plivex is owned by Virendra Sharma/);
  assert.match(about, /Yashvant Sharma leads the product's development as Developer/);
  assert.match(section, /Developer, Plivex/);
  assert.doesNotMatch(section, /Founder\s*&amp;\s*Developer/);
  assert.doesNotMatch(html, /"jobTitle":\s*"Founder & Developer"/);
});

test("landing page labels Global functionality as a staged rollout", () => {
  const landing = read("src/pages/GuestDashboard.jsx");
  assert.match(landing, /Your workspace uses the country and regional settings you select when you create your account/);
  assert.doesNotMatch(landing, /India GST workflows are available today/);
  assert.match(landing, /Create your free account/);
  assert.match(landing, /DEMO/);
});

test("production Worker is configured to build the unified single-app edition", () => {
  const config = JSON.parse(read("wrangler.jsonc"));
  const workflow = read(".github/workflows/deploy-cloudflare.yml");
  assert.equal(config.vars.VITE_APP_EDITION, "unified");
  assert.equal(config.previews.vars.VITE_APP_EDITION, "unified");
  assert.match(workflow, /VITE_APP_EDITION=unified npm run build/);
  assert.match(workflow, /VITE_APP_EDITION=unified npm run verify:build-env/);
});
