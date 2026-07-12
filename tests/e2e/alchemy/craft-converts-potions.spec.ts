
import { test, expect } from '@playwright/test';
import { testUsers } from '../fixtures/testUsers';
import { loginViaUI } from '../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../fixtures/createCharacter';
import { cleanupCharacterById } from '../fixtures/cleanup';
import { seedConsumables } from '../fixtures/seedInventory';

test.describe('Alchemy › Craft', { tag: '@alchemy' }, () => {
    test.describe.configure({ timeout: 90_000 });

    test('tap Przetworz on HP tier 1 row consumes 5× sm + produces 1× md + shows toast', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            const created = await createCharacterViaApi({
                userEmail: testUsers.secondary.email,
                name: nick,
                class: 'Knight',
                overrides: { level: 25, highest_level: 25, hp_regen: 0, mp_regen: 0 },
            });
            createdId = created.id;

            await seedConsumables({
                characterId: created.id,
                counts: { hp_potion_sm: 10 },
            });

            await loginViaUI(page, testUsers.secondary);
            await page.goto('/character-select');
            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await expect(card).toBeVisible({ timeout: 10_000 });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });

            await page.goto('/inventory');
            await expect(page.locator('.inventory__paperdoll-actions')).toBeVisible({ timeout: 10_000 });
            await page.getByRole('button', { name: /^auto-potion$/i }).tap();

            const popup = page.locator('.inventory__popup--potion');
            await expect(popup).toBeVisible({ timeout: 5_000 });

            await popup.getByRole('button', { name: /Alchemia/i }).tap();
            await expect(popup.locator('.inventory__popup-tab--active')).toContainText(/Alchemia/i);

            const grid = popup.locator('.inventory__alchemy-grid');
            await expect(grid).toBeVisible();
            const hpTier1Row = grid.locator('.inventory__alchemy-row--hp').first();
            await expect(hpTier1Row).toBeVisible();

            await expect(hpTier1Row.locator('.inventory__alchemy-input .inventory__alchemy-owned'))
                .toContainText(/Posiadasz:\s*10/);
            await expect(hpTier1Row.locator('.inventory__alchemy-output .inventory__alchemy-owned'))
                .toContainText(/Masz:\s*0/);

            const craftBtn = hpTier1Row.locator('.inventory__alchemy-btn');
            await expect(craftBtn).toBeVisible();
            await expect(craftBtn).toBeEnabled();
            await expect(craftBtn).toContainText(/Przetworz/i);

            await craftBtn.tap();

            await expect(hpTier1Row.locator('.inventory__alchemy-input .inventory__alchemy-owned'))
                .toContainText(/Posiadasz:\s*5/, { timeout: 5_000 });
            await expect(hpTier1Row.locator('.inventory__alchemy-output .inventory__alchemy-owned'))
                .toContainText(/Masz:\s*1/, { timeout: 5_000 });

            await expect(popup.locator('.inventory__alchemy-toast'))
                .toContainText(/Przetworzono.*1.*Eliksir HP/i, { timeout: 3_000 });
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
