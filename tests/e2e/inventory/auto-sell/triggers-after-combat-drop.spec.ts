
import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';
import { killMonsterViaEngine } from '../../fixtures/combatSim';

test.describe('Inventory › Auto-Sell', { tag: '@inventory' }, () => {
    test.describe.configure({ timeout: 120_000 });

    test('autoSellCommon=true -> kill rat with forced common drop -> bag unchanged, gold increased, drop marked sold', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            const created = await createCharacterViaApi({
                userEmail: testUsers.secondary.email,
                name: nick,
                class: 'Knight',
                overrides: { level: 5, highest_level: 5, hp_regen: 0, mp_regen: 0 },
            });
            createdId = created.id;

            await loginViaUI(page, testUsers.secondary);
            await page.goto('/character-select');
            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await expect(card).toBeVisible({ timeout: 15_000 });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
            await expect(page.locator('.town__char-name')).toHaveText(nick, { timeout: 10_000 });

            const before = await page.evaluate(async () => {
                const invMod = await import('/src/stores/inventoryStore.ts');
                const inv = (invMod as {
                    useInventoryStore: { getState: () => { bag: unknown[]; gold: number; stones: Record<string, number> } };
                }).useInventoryStore.getState();
                return { bagLen: inv.bag.length, gold: inv.gold, commonStones: inv.stones['common_stone'] ?? 0 };
            });
            expect(before.bagLen).toBe(0);
            expect(before.gold).toBe(0);

            await page.evaluate(async () => {
                const mod = await import('/src/stores/settingsStore.ts');
                (mod as {
                    useSettingsStore: { getState: () => { setAutoSellCommon: (v: boolean) => void } };
                }).useSettingsStore.getState().setAutoSellCommon(true);
            });

            await page.evaluate(() => {
                Math.random = () => 0.05;
            });

            const combatResult = await killMonsterViaEngine(page, 'rat', 'normal');

            const after = await page.evaluate(async () => {
                const invMod = await import('/src/stores/inventoryStore.ts');
                const inv = (invMod as {
                    useInventoryStore: { getState: () => { bag: unknown[]; gold: number; stones: Record<string, number> } };
                }).useInventoryStore.getState();
                return { bagLen: inv.bag.length, gold: inv.gold, commonStones: inv.stones['common_stone'] ?? 0 };
            });

            expect(after.bagLen, 'bag must stay empty — auto-sell skips addItem').toBe(0);

            expect(after.gold, 'gold must have grown — auto-sell adds price to gold').toBeGreaterThan(before.gold);

            const soldDrops = combatResult.lastDrops.filter((d) => {
                const dropAny = d as { sold?: boolean; soldPrice?: number };
                return dropAny.sold === true && typeof dropAny.soldPrice === 'number';
            });
            expect(soldDrops.length, 'at least 1 drop in lastDrops must have sold=true + soldPrice').toBeGreaterThanOrEqual(1);

            for (const drop of soldDrops) {
                const dropAny = drop as { soldPrice?: number };
                expect(dropAny.soldPrice ?? 0).toBeGreaterThan(0);
            }
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
