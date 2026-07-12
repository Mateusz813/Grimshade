
import { test, expect } from '@playwright/test';
import { testUsers } from '../fixtures/testUsers';
import { loginViaUI } from '../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../fixtures/createCharacter';
import { cleanupCharacterById } from '../fixtures/cleanup';

test.describe('Stats › Popup', { tag: '@stats' }, () => {
    test.describe.configure({ timeout: 60_000 });

    test('opens Stats popup from Postać view and renders base combat stats', async ({ page }) => {
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

            await page.goto('/inventory');
            await expect(page.locator('.inventory__paperdoll-actions')).toBeVisible({ timeout: 10_000 });

            await page.getByRole('button', { name: /^statystyki$/i }).tap();

            const statsPopup = page.locator('.inventory__popup--stats');
            await expect(statsPopup).toBeVisible({ timeout: 5_000 });

            await expect(statsPopup.getByText('Statystyki Walki')).toBeVisible();

            const atakBox = statsPopup.locator('.inventory__stats-box', {
                has: page.locator('.inventory__stats-box-label', { hasText: /^Atak$/ }),
            });
            await expect(atakBox.locator('.inventory__stats-box-value')).toHaveText('10');

            const obronaBox = statsPopup.locator('.inventory__stats-box', {
                has: page.locator('.inventory__stats-box-label', { hasText: /^Obrona$/ }),
            });
            await expect(obronaBox.locator('.inventory__stats-box-value')).toHaveText('5');

            const hpBox = statsPopup.locator('.inventory__stats-box', {
                has: page.locator('.inventory__stats-box-label', { hasText: /^Max HP$/ }),
            });
            await expect(hpBox.locator('.inventory__stats-box-value')).toHaveText('200');

            const mpBox = statsPopup.locator('.inventory__stats-box', {
                has: page.locator('.inventory__stats-box-label', { hasText: /^Max MP$/ }),
            });
            await expect(mpBox.locator('.inventory__stats-box-value')).toHaveText('50');
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
