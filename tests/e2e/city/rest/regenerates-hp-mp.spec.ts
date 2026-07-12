
import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';

test.describe('City › Rest', { tag: '@city' }, () => {
    test.describe.configure({ timeout: 60_000 });

    test('tapping Odpoczynek tile heals HP and MP to max', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            const created = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: nick,
                class: 'Knight',
                overrides: { hp: 10, mp: 5, hp_regen: 0, mp_regen: 0 },
            });
            createdId = created.id;

            await loginViaUI(page, testUsers.primary);
            await page.goto('/character-select');
            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await expect(card).toBeVisible({ timeout: 10_000 });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 10_000 });

            await expect(page.locator('.town__char-name')).toHaveText(nick);
            const hpBarValue = page.locator('.town__bar-wrap', {
                has: page.locator('.town__bar--hp'),
            }).locator('.town__bar-value');
            const mpBarValue = page.locator('.town__bar-wrap', {
                has: page.locator('.town__bar--mp'),
            }).locator('.town__bar-value');
            await expect(hpBarValue).toHaveText('10/200');
            await expect(mpBarValue).toHaveText('5/50');

            const restTile = page.locator('.town__nav-tile--rest');
            await expect(restTile).toBeEnabled();
            await restTile.tap();

            const overlay = page.locator('.town__rest-overlay');
            await expect(overlay).toBeVisible({ timeout: 5_000 });
            await expect(page.locator('.town__rest-text')).toContainText('Odpoczywasz');

            await expect(hpBarValue).toHaveText('200/200', { timeout: 15_000 });
            await expect(mpBarValue).toHaveText('50/50', { timeout: 5_000 });
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
