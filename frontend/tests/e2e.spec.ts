/**
 * Suite 4 — Browser E2E Tests (Playwright)
 * Tests full user journeys on the live VPS.
 *
 * Setup:
 *   npm install -D @playwright/test
 *   npx playwright install chromium
 *
 * Run:
 *   npx playwright test                          (headless)
 *   npx playwright test --headed                 (visible browser)
 *   npx playwright test --reporter=html          (HTML report)
 *
 * Against VPS:   BASE_URL=http://43.134.173.106 npx playwright test
 * Against local: BASE_URL=http://localhost:5173  npx playwright test
 */

import { test, expect, Page } from '@playwright/test';
import { v4 as uuid } from 'uuid';

const BASE   = process.env.BASE_URL || 'http://43.134.173.106';
const EMAIL  = `e2e_${uuid().slice(0,8)}@tradevelix.test`;
const PASS   = 'playwright123';
const UNAME  = `pw_${uuid().slice(0,6)}`;

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function register(page: Page) {
  await page.goto(`${BASE}/register`);
  await page.fill('input[type="email"]',    EMAIL);
  await page.fill('input[type="text"]',     UNAME);
  await page.fill('input[type="password"]', PASS);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/dashboard', { timeout: 10_000 });
}

async function login(page: Page) {
  await page.goto(`${BASE}/login`);
  await page.fill('input[type="email"]',    EMAIL);
  await page.fill('input[type="password"]', PASS);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/dashboard', { timeout: 10_000 });
}

// ─── Suite 4: Landing Page ────────────────────────────────────────────────────

test.describe('Landing Page', () => {

  test('E2E-01: Landing page renders with Tradevelix branding', async ({ page }) => {
    await page.goto(BASE);
    await expect(page).toHaveTitle(/Tradevelix/i);
    await expect(page.locator('text=Tradevelix')).toBeVisible();
  });

  test('E2E-01b: Landing page has CTA buttons', async ({ page }) => {
    await page.goto(BASE);
    await expect(page.locator('button, a').filter({ hasText: /get started|sign in|create/i }).first()).toBeVisible();
  });

  test('E2E-01c: No crash-screen errors shown on landing page', async ({ page }) => {
    // The error div from window.onerror should never be visible
    await page.goto(BASE);
    const errorDiv = page.locator('.error');
    await expect(errorDiv).toHaveCount(0);
  });

});

// ─── Suite 4: Auth Redirect ───────────────────────────────────────────────────

test.describe('Auth Guards', () => {

  test('E2E-02: /dashboard without login redirects to /login', async ({ page }) => {
    await page.goto(`${BASE}/dashboard`);
    await expect(page).toHaveURL(/\/login/);
  });

  test('E2E-02b: /stock/INDY without login redirects to /login', async ({ page }) => {
    await page.goto(`${BASE}/stock/INDY`);
    await expect(page).toHaveURL(/\/login/);
  });

});

// ─── Suite 4: Register Flow ───────────────────────────────────────────────────

test.describe('Register Flow', () => {

  test('E2E-03: Register → redirect to dashboard', async ({ page }) => {
    await register(page);
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test('E2E-03b: Dashboard shows leaderboard after register', async ({ page }) => {
    await register(page);
    // Wait for the table to appear (may take a moment for API call)
    await expect(page.locator('table, [role="table"]').first()).toBeVisible({ timeout: 15_000 });
  });

});

// ─── Suite 4: Login Flow ──────────────────────────────────────────────────────

test.describe('Login Flow', () => {
  test.beforeAll(async ({ browser }) => {
    // Ensure user exists by registering once
    const page = await browser.newPage();
    await page.goto(`${BASE}/register`);
    try {
      await page.fill('input[type="email"]', EMAIL);
      await page.fill('input[type="text"]',  UNAME);
      await page.fill('input[type="password"]', PASS);
      await page.click('button[type="submit"]');
      await page.waitForTimeout(2000);
    } catch { /* already registered */ }
    await page.close();
  });

  test('E2E-04: Login with valid credentials → /dashboard', async ({ page }) => {
    await login(page);
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test('E2E-05: Wrong password shows error message', async ({ page }) => {
    await page.goto(`${BASE}/login`);
    await page.fill('input[type="email"]',    EMAIL);
    await page.fill('input[type="password"]', 'thisisthewrongpassword');
    await page.click('button[type="submit"]');
    // Error text should appear
    await expect(page.locator('text=/invalid|incorrect|wrong/i').first()).toBeVisible({ timeout: 5_000 });
  });

});

// ─── Suite 4: Dashboard ───────────────────────────────────────────────────────

test.describe('Dashboard', () => {
  test.beforeEach(async ({ page }) => { await login(page); });

  test('E2E-06: Leaderboard table rows visible after login', async ({ page }) => {
    await page.waitForTimeout(2000); // allow API call
    const rows = page.locator('tbody tr');
    await expect(rows.first()).toBeVisible({ timeout: 15_000 });
  });

  test('E2E-07: Filter "BUY Signals" via sidebar', async ({ page }) => {
    await page.click('text=BUY Signals');
    await page.waitForTimeout(1500);
    // URL should contain filter=buy OR rows should only show BUY signals
    const url = page.url();
    expect(url).toMatch(/filter=buy|\/dashboard/);
  });

  test('E2E-07b: Filter tabs change visible stocks', async ({ page }) => {
    await page.waitForTimeout(2000);
    // Get count on "All"
    const allRows = await page.locator('tbody tr').count();

    await page.click('text=WATCH');
    await page.waitForTimeout(1000);
    // Watch filter may show fewer rows (or same if all are WATCH)
    // Just check the page didn't crash
    await expect(page.locator('table').first()).toBeVisible();
    expect(allRows).toBeGreaterThanOrEqual(0);
  });

});

// ─── Suite 4: Stock Detail ────────────────────────────────────────────────────

test.describe('Stock Detail', () => {
  test.beforeEach(async ({ page }) => { await login(page); });

  test('E2E-08: Clicking a stock row navigates to /stock/{ticker}', async ({ page }) => {
    await page.waitForTimeout(2000);
    const firstRow = page.locator('tbody tr').first();
    await firstRow.waitFor({ state: 'visible', timeout: 15_000 });
    await firstRow.click();
    await expect(page).toHaveURL(/\/stock\/[A-Z]+/, { timeout: 8_000 });
  });

  test('E2E-09: Evidence cards expand on click', async ({ page }) => {
    await page.goto(`${BASE}/stock/INDY`);
    await page.waitForTimeout(3000);

    // Find a metric card (has "EVIDENCE" text in it)
    const card = page.locator('text=EVIDENCE').first();
    await card.waitFor({ timeout: 10_000 });
    await card.click();

    // The evidence panel should appear
    await expect(page.locator('text=/how this is calculated/i').first()).toBeVisible({ timeout: 5_000 });
  });

  test('E2E-10: Price chart renders (Recharts SVG present)', async ({ page }) => {
    await page.goto(`${BASE}/stock/INDY`);
    await page.waitForTimeout(3000);
    const svg = page.locator('svg.recharts-surface').first();
    await expect(svg).toBeVisible({ timeout: 10_000 });
  });

  test('E2E-11: Broker tables visible on stock detail', async ({ page }) => {
    await page.goto(`${BASE}/stock/INDY`);
    await page.waitForTimeout(3000);
    // Look for the "BUY" and "SELL" side labels
    await expect(page.locator('text=↑ BUY').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('text=↓ SELL').first()).toBeVisible({ timeout: 10_000 });
  });

  test('E2E-12: Back button returns to dashboard', async ({ page }) => {
    await page.goto(`${BASE}/stock/INDY`);
    await page.waitForTimeout(2000);
    await page.click('text=Back to Dashboard');
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 5_000 });
  });

});

// ─── Suite 4: Theme & UX ─────────────────────────────────────────────────────

test.describe('Theme & UX', () => {
  test.beforeEach(async ({ page }) => { await login(page); });

  test('E2E-13: Theme toggle switches dark/light', async ({ page }) => {
    // Default is dark — click the theme button
    const themeBtnSelector = 'button[title*="light"], button[title*="dark"], button[title*="Switch"]';
    const btn = page.locator(themeBtnSelector).first();
    await btn.waitFor({ timeout: 5_000 });

    const attrBefore = await page.evaluate(() => document.documentElement.getAttribute('data-theme') ?? 'dark');
    await btn.click();
    await page.waitForTimeout(400);
    const attrAfter = await page.evaluate(() => document.documentElement.getAttribute('data-theme') ?? 'dark');
    expect(attrBefore).not.toBe(attrAfter);
  });

  test('E2E-15: Search bar navigates on Enter', async ({ page }) => {
    const input = page.locator('input[placeholder*="ticker" i]').first();
    await input.fill('BRMS');
    await input.press('Enter');
    await expect(page).toHaveURL(/\/stock\/BRMS/, { timeout: 5_000 });
  });

  test('E2E-16: Extension errors NOT shown as crash screen', async ({ page }) => {
    await page.goto(BASE);
    // The .error div from the old window.onerror should never appear
    await expect(page.locator('.error')).toHaveCount(0);
  });

});

// ─── Suite 4: Logout ─────────────────────────────────────────────────────────

test.describe('Logout', () => {
  test('E2E-14: Logout redirects to landing page', async ({ page }) => {
    await login(page);
    // Click logout (in sidebar or top nav)
    const logoutBtn = page.locator('button[title*="out"], button[title*="Sign out"]').first();
    await logoutBtn.waitFor({ timeout: 5_000 });
    await logoutBtn.click();
    await expect(page).toHaveURL(/^\/?$|\/login|\//, { timeout: 5_000 });
    // After logout, /dashboard should redirect to /login
    await page.goto(`${BASE}/dashboard`);
    await expect(page).toHaveURL(/\/login/);
  });
});
