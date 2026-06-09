/**
 * Atomic E2E — tutorial opens from the avatar menu and shows the guide.
 *
 * Flow (mirror logout/change-password menu pattern):
 *   1. Seed character (avatar button needs character !== null).
 *   2. Login → pick character → Town.
 *   3. Open AvatarMenu → tap "Tutorial".
 *   4. Assert the tutorial dialog appears with numbered sections, and the
 *      menu has closed.
 *   5. Close via the footer button.
 *
 * Pure client-side feature (no backend writes) — only the seeded character is
 * cleaned up in finally.
 */

import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';
import { waitForAppReady } from '../../fixtures/appReady';

test.describe('Chrome › Tutorial', { tag: '@chrome' }, () => {
    test.describe.configure({ timeout: 60_000 });

    test('tutorial opens from AvatarMenu with numbered sections', async ({ page }) => {
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

            await loginViaUI(page, testUsers.primary);
            await page.goto('/character-select');
            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await expect(card).toBeVisible({ timeout: 10_000 });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
            await waitForAppReady(page);

            // Open menu → Tutorial.
            await page.getByRole('button', { name: /menu postaci/i }).tap();
            const tutorialItem = page.getByRole('menuitem', { name: /tutorial/i });
            await expect(tutorialItem).toBeVisible({ timeout: 5_000 });
            await tutorialItem.tap();

            // Dialog appears + the menu closed.
            await expect(page.locator('.tutorial')).toBeVisible({ timeout: 5_000 });
            await expect(page.locator('.avatar-menu')).toHaveCount(0);

            // Has numbered sections with content.
            const sections = page.locator('.tutorial__section');
            expect(await sections.count()).toBeGreaterThanOrEqual(10);
            await expect(page.locator('.tutorial__section-num').first()).toHaveText('1.');
            // First section has at least one bullet.
            await expect(
                sections.first().locator('.tutorial__section-bullet').first(),
            ).toBeVisible();

            // Close via footer button.
            await page.locator('.tutorial__done').tap();
            await expect(page.locator('.tutorial')).toHaveCount(0, { timeout: 5_000 });
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
