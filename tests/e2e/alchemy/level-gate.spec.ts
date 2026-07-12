
import { test, expect } from '@playwright/test';
import { testUsers } from '../fixtures/testUsers';
import { loginViaUI } from '../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../fixtures/createCharacter';
import { cleanupCharacterById } from '../fixtures/cleanup';
import { seedConsumables } from '../fixtures/seedInventory';

test.describe('Alchemy › Level Gate', { tag: '@alchemy' }, () => {
    test.describe.configure({ timeout: 60_000 });

    test('low-level character cannot convert to potion above required level', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            const created = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: nick,
                class: 'Knight',
                overrides: { level: 10, highest_level: 10, hp_regen: 0, mp_regen: 0 },
            });
            createdId = created.id;

            await seedConsumables({
                characterId: created.id,
                counts: { hp_potion_md: 20 },
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
            await page.getByRole('button', { name: /^auto-potion$/i }).tap();

            const popup = page.locator('.inventory__popup--potion');
            await expect(popup).toBeVisible({ timeout: 5_000 });
            await popup.getByRole('button', { name: /Alchemia/i }).tap();

            const targetRow = popup.locator('.inventory__alchemy-row', {
                hasText: 'Silny Eliksir HP',
            });
            await expect(targetRow.first()).toBeVisible({ timeout: 5_000 });
            const tier2Row = targetRow.filter({
                hasNot: popup.locator('.inventory__alchemy-input .inventory__alchemy-name', {
                    hasText: 'Silny Eliksir HP',
                }),
            }).first();
            await expect(tier2Row).toBeVisible({ timeout: 5_000 });

            const convertBtn = tier2Row.getByRole('button', { name: /Przetworz/i });
            await expect(convertBtn).toBeDisabled();

            await expect(tier2Row.locator('.inventory__alchemy-summary'))
                .toContainText(/Wymagany lvl 50/i);
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
