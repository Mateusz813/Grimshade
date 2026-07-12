
import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { seedGameSave, findUserIdByEmail } from '../../fixtures/seedGameSave';
import { cleanupCharacterById } from '../../fixtures/cleanup';

test.describe('Shop › Buy', { tag: '@shop' }, () => {
    test.describe.configure({ timeout: 90_000 });

    test('rapid-clicking Kup 5× with exactly 1 item worth of gold only buys 1', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        const STARTING_GOLD = 50;

        try {
            const created = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: nick,
                class: 'Knight',
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
            await expect(goldBtn).toHaveAttribute('aria-label', /Złoto:\s*50/, { timeout: 5_000 });

            await page.getByRole('button', { name: /^Sklep$/i }).tap();
            await expect(page).toHaveURL(/\/shop$/, { timeout: 10_000 });
            await expect(page.locator('.shop__tabs')).toBeVisible({ timeout: 10_000 });

            const swordCard = page.locator('.shop__card', {
                has: page.locator('.shop__card-name', { hasText: /^Miecz$/ }),
            }).first();
            await swordCard.scrollIntoViewIfNeeded();
            await expect(swordCard).toBeVisible();
            const priceText = await swordCard.locator('.shop__card-price').textContent();
            expect(priceText).toMatch(/50\s*gp/i);

            const buyBtn = swordCard.getByRole('button', { name: /^Kup$/i });
            await expect(buyBtn).toBeEnabled();

            await buyBtn.evaluate((btn) => {
                for (let i = 0; i < 5; i++) {
                    btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                }
            });

            await expect(goldBtn).toHaveAttribute('aria-label', /Złoto:\s*0(?!\d)/, { timeout: 5_000 });

            await expect(buyBtn).toBeDisabled({ timeout: 3_000 });

            await page.getByRole('button', { name: /^Postać$/i }).tap();
            await expect(page).toHaveURL(/\/inventory$/, { timeout: 10_000 });
            await expect(page.locator('.inventory__bag-count')).toHaveText(/Plecak:\s*1\s*\/\s*1000/, { timeout: 10_000 });
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
