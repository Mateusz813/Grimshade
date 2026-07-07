/**
 * Atomic E2E — text inputs render >= 16px on mobile (no iOS focus-zoom).
 *
 * CRITICAL (2026-06-24): iOS Safari auto-zooms the whole app when a focused
 * input/textarea/select has computed font-size < 16px, and in a PWA the user
 * cannot pinch back out. Per-view SCSS styled many fields at 11-15px (by class,
 * so they beat the element-level global rule), so focusing them zoomed the app.
 * Fix: a `!important` guard in src/index.css (scoped to touch / <=767px) forces
 * every text field to 16px on mobile regardless of specificity/load order.
 *
 * This guards the fix on the mobile profiles (iPhone 13 / Pixel 7): the public
 * /login page's inputs (styled .login__input = 15px by class) must compute to
 * >= 16px. No auth / character needed — /login is public, so no cleanup.
 */

import { test, expect } from '@playwright/test';

test.describe('Auth › Login', { tag: '@auth' }, () => {
    test.describe.configure({ timeout: 45_000 });

    test('login inputs render >= 16px on mobile (no iOS focus-zoom)', async ({ page }) => {
        await page.goto('/login');
        const inputs = page.locator(
            'input:not([type="checkbox"]):not([type="radio"]):not([type="range"])',
        );
        await expect(inputs.first()).toBeVisible({ timeout: 10_000 });

        const count = await inputs.count();
        expect(count).toBeGreaterThan(0);
        for (let i = 0; i < count; i++) {
            const fontSize = await inputs
                .nth(i)
                .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
            expect(
                fontSize,
                `login input #${i} must be >= 16px to avoid iOS focus-zoom`,
            ).toBeGreaterThanOrEqual(16);
        }
    });
});
