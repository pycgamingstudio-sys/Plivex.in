import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../../components/landing/PricingSection.jsx", import.meta.url), "utf8");

test("India pricing continues to the India registration route", () => {
  assert.match(source, /countryCode === "IN" \? \(/);
  assert.match(source, /<Link to="\/register"/);
});

test("international pricing opens Global on the same domain with a full navigation", () => {
  assert.match(source, /<a href="\/global\/" aria-label=/);
  assert.doesNotMatch(source, /<Link to="\/global\//);
});
