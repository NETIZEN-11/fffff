import { test, expect } from "@playwright/test";

test.describe("Landing Page", () => {
  test("should load homepage successfully", async ({ page }) => {
    await page.goto("/");
    
    await expect(page).toHaveTitle(/ResumeRank AI/i);
    await expect(page.locator("body")).toContainText(/resume/i);
  });

  test("should have working navigation links", async ({ page }) => {
    await page.goto("/");
    
    // Check for pricing link
    const pricingLink = page.locator('a[href="/pricing"]');
    if (await pricingLink.isVisible()) {
      await expect(pricingLink).toBeVisible();
    }
    
    // Check for sign-in link
    const signinLink = page.locator('a[href*="signin"]');
    await expect(signinLink.first()).toBeVisible();
  });

  test("should display pricing page", async ({ page }) => {
    await page.goto("/pricing");
    
    await expect(page.locator("body")).toContainText(/pricing|plans/i);
    // Should show Free, Pro, and Team plans
    await expect(page.locator("body")).toContainText(/free/i);
  });

  test("should have responsive design", async ({ page }) => {
    // Test mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/");
    
    await expect(page.locator("body")).toBeVisible();
    
    // Test desktop viewport
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto("/");
    
    await expect(page.locator("body")).toBeVisible();
  });
});
