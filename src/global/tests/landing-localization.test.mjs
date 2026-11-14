import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../../components/landing/AboutSection.jsx", import.meta.url), "utf8");

test("shared About section uses international copy only for Global edition", () => {
  assert.match(source, /APP_EDITION === "global"/);
  assert.match(source, /small teams around the world/);
  assert.match(source, /designed for Indian retailers, wholesalers, distributors, freelancers, service providers and small teams/);
});
