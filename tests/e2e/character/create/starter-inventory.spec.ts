
import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterByName } from '../../fixtures/cleanup';

test.describe('Character › Create', { tag: '@character' }, () => {
    test.describe.configure({ timeout: 60_000, mode: 'serial' });

    test('new character starts with 30x small HP + 30x small MP potions', async ({ page }) => {
        const nick = generateTestCharacterName();
        try {
            await loginViaUI(page, testUsers.primary);
            if (!page.url().endsWith('/character-select')) {
                await page.goto('/character-select');
            }
            const createBtn = page.getByRole('button', { name: /Stwórz nową postać/i });
            await createBtn.scrollIntoViewIfNeeded();
            await createBtn.tap();
            await expect(page).toHaveURL(/\/create-character$/, { timeout: 10_000 });

            const classButton = page.locator('.character-create__class-btn').filter({ hasText: 'Rycerz' });
            await classButton.tap();
            await page.locator('.character-create__input').fill(nick);
            await page.getByRole('button', { name: /Stwórz postać/i }).tap();

            await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
            await expect(page.locator('.town__char-name')).toHaveText(nick);

            const consumables = await page.evaluate(async () => {
                const m = await import('/src/stores/inventoryStore.ts');
                return (m as { useInventoryStore: { getState: () => { consumables: Record<string, number> } } })
                    .useInventoryStore.getState().consumables;
            });
            expect(consumables.hp_potion_sm).toBe(30);
            expect(consumables.mp_potion_sm).toBe(30);
        } finally {
            await cleanupCharacterByName(testUsers.primary.email, nick);
        }
    });
});
