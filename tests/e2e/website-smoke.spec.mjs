import { test, expect } from "@playwright/test";

const publicRoutes = [
  "/",
  "/login",
  "/register",
  "/forgot-password",
  "/privacy-policy",
  "/terms-of-service",
  "/cancellation-and-refund",
  "/contact-us",
  "/about",
  "/features",
  "/pricing",
  "/help-center",
  "/i/qa-smoke-token",
  "/sign/qa-smoke-token",
  "/supplier-onboarding/qa-smoke-token",
];

const authenticatedRoutes = [
  "/dashboard",
  "/workspace/sales",
  "/workspace/purchase",
  "/workspace/reports",
  "/workspace/crm",
  "/workspace/stock",
  "/workspace/warehouses",
  "/workspace/reconciliation",
  "/invoice-history",
  "/invoice-shares",
  "/business-profile",
  "/client-database",
  "/crm",
  "/inventory-procurement",
  "/team-management",
  "/platform",
  "/settings",
];

for (const route of publicRoutes) {
  test(`public route ${route} renders without an unhandled browser exception`, async ({ page }) => {
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const response = await page.goto(route, { waitUntil: "domcontentloaded" });
    expect(response?.status() ?? 0).toBeLessThan(500);
    await expect.poll(async () => (await page.locator("body").innerText()).trim().length).toBeGreaterThan(0);
    expect(errors).toEqual([]);
  });
}

for (const route of authenticatedRoutes) {
  test(`workspace route ${route} resolves safely for an unauthenticated visitor`, async ({ page }) => {
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const response = await page.goto(route, { waitUntil: "domcontentloaded" });
    expect(response?.status() ?? 0).toBeLessThan(500);
    await expect.poll(async () => (await page.locator("body").innerText()).trim().length).toBeGreaterThan(0);
    expect(errors).toEqual([]);
  });
}

for (const route of ["/", "/login", "/register", "/pricing", "/features"]) {
  test(`mobile viewport has no page-level horizontal overflow on ${route}`, async ({ browser }) => {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await page.goto(route, { waitUntil: "domcontentloaded" });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2);
    expect(overflow).toBe(false);
    await page.close();
  });
}
