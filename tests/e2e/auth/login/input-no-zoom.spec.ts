
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
