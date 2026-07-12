
import { test, expect } from '@playwright/test';
import { testUsers } from '../fixtures/testUsers';
import { loginViaUI } from '../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../fixtures/createCharacter';
import { cleanupCharacterById } from '../fixtures/cleanup';
import { seedEquippedItem } from '../fixtures/seedInventory';

test.describe('Stats › Popup', { tag: '@stats' }, () => {
    test.describe.configure({ timeout: 60_000 });

    test('Atak stat aggregates base + equipped weapon baseAtk', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            const created = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: nick,
                class: 'Knight',
                overrides: { level: 5, highest_level: 5, hp_regen: 0, mp_regen: 0 },
            });
            createdId = created.id;

            await seedEquippedItem({
                characterId: created.id,
                slot: 'mainHand',
                itemId: 'iron_sword',
                rarity: 'common',
                itemLevel: 5,
            });

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
            await expect(atakBox.locator('.inventory__stats-box-value')).toHaveText('22');

            await expect(atakBox).toContainText('Baza');
            await expect(atakBox).toContainText('10');
            await expect(atakBox).toContainText('Eq');
            await expect(atakBox).toContainText('+12');
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
