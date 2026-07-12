
import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { seedGameSave, findUserIdByEmail } from '../../fixtures/seedGameSave';
import { cleanupCharacterById } from '../../fixtures/cleanup';

test.describe('Shop › Buy', { tag: '@shop' }, () => {
    test.describe.configure({ timeout: 90_000 });

    test('buying Mały Eliksir MP increments owned count and deducts 30 gold', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        const STARTING_GOLD = 100_000;

        try {
            const created = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: nick,
                class: 'Mage',
                overrides: { gold: STARTING_GOLD, hp_regen: 0, mp_regen: 0 },
            });
            createdId = created.id;

            const userId = await findUserIdByEmail(testUsers.primary.email);
            await seedGameSave({
                characterId: created.id,
                userId,
                gold: STARTING_GOLD,
            });

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

            const goldBtn = page.locator('.top-header__gold-btn').first();
            await expect(goldBtn).toHaveAttribute('aria-label', /Złoto:\s*100[\s ]?000/, { timeout: 5_000 });

            await page.getByRole('button', { name: /^Sklep$/i }).tap();
            await expect(page).toHaveURL(/\/shop$/, { timeout: 10_000 });
            await expect(page.locator('.shop__tabs')).toBeVisible({ timeout: 10_000 });
            await page.locator('.shop__tab[aria-label="Potiony"]').tap();

            const potionCard = page.locator('.shop__card', {
                has: page.locator('.shop__card-name', { hasText: /^Mały Eliksir MP$/ }),
            }).first();
            await potionCard.scrollIntoViewIfNeeded();
            await expect(potionCard).toBeVisible();

            await expect(potionCard.locator('.shop__card-lvl-badge')).toHaveCount(0);

            await potionCard.getByRole('button', { name: /^Kup$/i }).tap();

            await expect(page.locator('.shop__toast')).toHaveText(/Kupiono\s+1×\s*Mały Eliksir MP/i, { timeout: 5_000 });

            await expect(potionCard.locator('.shop__card-lvl-badge')).toHaveText('×1', { timeout: 5_000 });

            await expect(goldBtn).toHaveAttribute('aria-label', /Złoto:\s*99[\s ]?970/, { timeout: 5_000 });

            await page.getByRole('button', { name: /^Postać$/i }).tap();
            await expect(page).toHaveURL(/\/inventory$/, { timeout: 10_000 });
            await expect(page.locator('.inventory__bag-count')).toHaveText(/Plecak:\s*0\s*\/\s*1000/, { timeout: 10_000 });
            const inventoryPotion = page.locator('.inventory__bag-tile-name', { hasText: /^Mały Eliksir MP$/ }).first();
            await expect(inventoryPotion).toBeVisible({ timeout: 5_000 });
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
