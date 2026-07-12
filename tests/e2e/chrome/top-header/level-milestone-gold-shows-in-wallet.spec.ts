
import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';

test.describe('Chrome › TopHeader', { tag: '@chrome' }, () => {
    test.describe.configure({ timeout: 60_000 });

    test('crossing a gold milestone (lvl 10) credits the spendable wallet + shows 1cc', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            const created = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: nick,
                class: 'Knight',
                overrides: { level: 9, highest_level: 9, xp: 0, gold: 0 },
            });
            createdId = created.id;

            await loginViaUI(page, testUsers.primary);
            await page.goto('/character-select');
            await expect(page.locator('.char-select__card-name', { hasText: nick }))
                .toBeVisible({ timeout: 10_000 });
            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 10_000 });
            await expect(page.locator('.town__char-name')).toHaveText(nick);
            await page.waitForLoadState('networkidle').catch(() => {});

            const beforeGold = await page.evaluate(async () => {
                const invMod = await import('/src/stores/inventoryStore.ts');
                return (invMod as {
                    useInventoryStore: { getState: () => { gold: number } };
                }).useInventoryStore.getState().gold;
            });
            expect(beforeGold).toBe(0);

            const result = await page.evaluate(async () => {
                const charMod = await import('/src/stores/characterStore.ts');
                const lvlMod = await import('/src/systems/levelSystem.ts');
                const invMod = await import('/src/stores/inventoryStore.ts');
                const charStore = (charMod as {
                    useCharacterStore: {
                        getState: () => {
                            character: { level: number; gold: number } | null;
                            addXp: (xp: number) => void;
                        };
                    };
                }).useCharacterStore;
                const xpToNextLevel = (lvlMod as {
                    xpToNextLevel: (level: number) => number;
                }).xpToNextLevel;
                const level = charStore.getState().character?.level ?? 0;
                charStore.getState().addXp(xpToNextLevel(level));
                const inv = (invMod as {
                    useInventoryStore: { getState: () => { gold: number } };
                }).useInventoryStore.getState();
                return {
                    newLevel: charStore.getState().character?.level ?? 0,
                    charColumnGold: charStore.getState().character?.gold ?? -1,
                    walletGold: inv.gold,
                };
            });

            expect(result.newLevel).toBe(10);
            expect(result.walletGold).toBe(100_000);
            expect(result.charColumnGold).toBe(0);

            const goldValue = page.locator('.top-header__gold-value').first();
            await expect(goldValue).toContainText('cc', { timeout: 10_000 });
            const goldBtn = page.locator('.top-header__gold-btn').first();
            await expect(goldBtn).toHaveAttribute('aria-label', /100\D?000/, { timeout: 10_000 });
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
