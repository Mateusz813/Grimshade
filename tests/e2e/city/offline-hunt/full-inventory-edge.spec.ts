
import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';
import { seedGameSave, generateFillerBagItems, findUserIdByEmail } from '../../fixtures/seedGameSave';

test.describe('City › Offline Hunt', { tag: '@city' }, () => {
    test.describe.configure({ timeout: 90_000 });

    test('claim with bag at 1000/1000 -> no crash, bag.length stays exactly 1000, rewards still granted', async ({ page }) => {
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

            const userId = await findUserIdByEmail(testUsers.secondary.email);
            await seedGameSave({
                characterId: created.id,
                userId,
                gold: 0,
                bagItems: generateFillerBagItems(1000),
            });

            await loginViaUI(page, testUsers.secondary);
            await page.goto('/character-select');
            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await expect(card).toBeVisible({ timeout: 10_000 });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });

            const preBagLen = await page.evaluate(async () => {
                const mod = await import('/src/stores/inventoryStore.ts');
                return mod.useInventoryStore.getState().bag.length;
            });
            expect(preBagLen).toBe(1000);

            await page.evaluate(async () => {
                const [ohMod, monsterMod] = await Promise.all([
                    import('/src/stores/offlineHuntStore.ts'),
                    import('/src/data/monsters.json'),
                ]);
                const monsters = (monsterMod.default ?? monsterMod) as Array<{ id: string; level: number; }>;
                const rat = monsters.find((m) => m.id === 'rat');
                if (!rat) throw new Error('[test 5.13] rat not found in monsters.json');
                ohMod.useOfflineHuntStore.getState().startHunt(rat as Parameters<typeof ohMod.useOfflineHuntStore.getState.prototype.startHunt>[0] extends infer T ? T : never, 'sword_fighting');
                const TWELVE_H_MS = 12 * 60 * 60 * 1000;
                ohMod.useOfflineHuntStore.setState({
                    startedAt: new Date(Date.now() - TWELVE_H_MS - 1000).toISOString(),
                });
            });

            const result = await page.evaluate(async () => {
                let hadCrash = false;
                let kills = 0;
                let goldGained = 0;
                let xpGained = 0;
                try {
                    const [ohSysMod, invMod] = await Promise.all([
                        import('/src/systems/offlineHuntSystem.ts'),
                        import('/src/stores/inventoryStore.ts'),
                    ]);
                    const preGold = invMod.useInventoryStore.getState().gold;
                    const claimResult = ohSysMod.claimOfflineHunt();
                    if (!claimResult) {
                        return { hadCrash: false, kills: 0, goldGained: 0, xpGained: 0, finalBagLen: invMod.useInventoryStore.getState().bag.length, postGold: preGold };
                    }
                    kills = claimResult.kills;
                    goldGained = claimResult.goldGained;
                    xpGained = claimResult.xpGained;
                    const finalBagLen = invMod.useInventoryStore.getState().bag.length;
                    const postGold = invMod.useInventoryStore.getState().gold;
                    return { hadCrash, kills, goldGained, xpGained, finalBagLen, postGold };
                } catch (e) {
                    hadCrash = true;
                    return { hadCrash, kills, goldGained, xpGained, finalBagLen: -1, postGold: -1, error: String(e) };
                }
            });

            expect(result.hadCrash, `claimOfflineHunt threw — ${'error' in result ? result.error : 'no error string'}`).toBe(false);
            expect(result.finalBagLen).toBe(1000);
            expect(result.kills).toBeGreaterThan(0);
            expect(result.goldGained).toBeGreaterThan(0);
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
