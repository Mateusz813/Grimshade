/**
 * Atomic E2E — a new character starts with 30× smallest HP + 30× smallest MP
 * potions (2026-06-24 owner request: healing from the very first fight).
 *
 * Flow: login -> /character-select -> create a Knight via UI -> enter Town ->
 * read the live inventoryStore consumables (the create handler grants the
 * starter potions before redirecting to Town). Asserts consumables.hp_potion_sm
 * === 30 and consumables.mp_potion_sm === 30.
 *
 * We read the store directly via a dev-time dynamic import (same pattern as the
 * arena buy-with-ap spec) instead of scraping bag tiles — robust to UI markup.
 *
 * Cleanup: try/finally -> cleanupCharacterByName (no leftover character).
 */

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

            // Read the live inventory consumables — granted by the create flow
            // before the Town redirect.
            const consumables = await page.evaluate(async () => {
                // @ts-expect-error dev-time Vite URL not resolvable by tsc, works in browser
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
