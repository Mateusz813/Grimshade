/**
 * Atomic E2E — Shop Arena tab does NOT scroll/swipe horizontally (mobile).
 *
 * BUG 5 (2026-06-24): the Arena tab (4th shop tab) is the only one that wraps
 * the card grid in a `display:flex` column (`.shop__panel--arena`). Flex
 * children default to `min-width: auto`, so the banner / nested grid could push
 * past the viewport and the tab scrolled sideways on mobile. Fix: clamp the
 * panel (`max-width:100%; overflow-x:hidden; min-width:0`) + `min-width:0` on
 * the banner and the nested grid (Shop.scss).
 *
 * This test reproduces the bug (red before fix: scrollWidth > clientWidth) and
 * guards it: after opening the Arena tab, the panel must have NO horizontal
 * overflow and the document must not scroll horizontally.
 *
 * No AP seeding needed — the Arena catalogue renders regardless of points.
 * Cleanup: try/finally -> cleanupCharacterById.
 */

import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';

test.describe('Shop › Arena', { tag: '@shop' }, () => {
    test.describe.configure({ timeout: 60_000 });

    test('Arena tab has no horizontal scroll on mobile', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            const created = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: nick,
                class: 'Knight',
                overrides: { hp_regen: 0, mp_regen: 0 },
            });
            createdId = created.id;

            // Login -> select -> Town.
            await loginViaUI(page, testUsers.primary);
            if (!page.url().endsWith('/character-select')) {
                await page.goto('/character-select');
            }
            await expect(page.locator('.char-select__card-name', { hasText: nick })).toBeVisible({ timeout: 10_000 });
            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 10_000 });
            await expect(page.locator('.town__char-name')).toHaveText(nick);

            // Shop -> Arena tab (Shop.tsx: tab aria-label="Arena").
            await page.getByRole('button', { name: /^Sklep$/i }).tap();
            await expect(page).toHaveURL(/\/shop$/, { timeout: 10_000 });
            await expect(page.locator('.shop__tabs')).toBeVisible({ timeout: 10_000 });
            await page.getByRole('button', { name: 'Arena' }).tap();

            const arenaPanel = page.locator('.shop__panel--arena');
            await expect(arenaPanel).toBeVisible({ timeout: 5_000 });

            // The Arena panel must NOT overflow horizontally. A 1px tolerance
            // absorbs sub-pixel rounding on different DPRs.
            const overflow = await arenaPanel.evaluate(
                (el) => el.scrollWidth - el.clientWidth,
            );
            expect(overflow).toBeLessThanOrEqual(1);

            // And the document itself must not scroll horizontally.
            const docOverflow = await page.evaluate(
                () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
            );
            expect(docOverflow).toBeLessThanOrEqual(1);
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
