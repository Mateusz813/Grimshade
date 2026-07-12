
import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';

test.describe('City › Offline Hunt', { tag: '@city' }, () => {
    test.describe.configure({ timeout: 120_000 });
    test.describe.configure({ retries: 7 });

    test('claim offline hunt against rat -> grants XP + gold + mastery kills, then sets isActive=false + startedAt=null', async ({ page }) => {
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
                const charMod = await import('/src/stores/characterStore.ts');
                const invMod = await import('/src/stores/inventoryStore.ts');
                const masMod = await import('/src/stores/masteryStore.ts');
                const ch = (charMod as {
                    useCharacterStore: { getState: () => { character: { xp: number; level: number } | null } };
                }).useCharacterStore.getState().character;
                const inv = (invMod as {
                    useInventoryStore: { getState: () => { gold: number } };
                }).useInventoryStore.getState();
                const mas = (masMod as {
                    useMasteryStore: { getState: () => { masteryKills: Record<string, number> } };
                }).useMasteryStore.getState();
                return {
                    xp: ch?.xp ?? 0,
                    level: ch?.level ?? 1,
                    gold: inv.gold,
                    ratKills: mas.masteryKills['rat'] ?? 0,
                };
            });
            expect(before.gold).toBe(0);

            await page.evaluate(async () => {
                const [ohMod, monsterMod] = await Promise.all([
                    import('/src/stores/offlineHuntStore.ts'),
                    import('/src/data/monsters.json'),
                ]);
                const monsters = ((monsterMod as { default?: unknown }).default ?? monsterMod) as Array<{ id: string; level: number }>;
                const rat = monsters.find((m) => m.id === 'rat');
                if (!rat) throw new Error('[test 5.12] rat not found in monsters.json');
                (ohMod as { useOfflineHuntStore: { getState: () => { startHunt: (m: unknown, skillId: string) => void } } })
                    .useOfflineHuntStore.getState().startHunt(rat as unknown, 'sword_fighting');
                const TWELVE_H_MS = 12 * 60 * 60 * 1000;
                (ohMod as { useOfflineHuntStore: { setState: (s: Record<string, unknown>) => void } })
                    .useOfflineHuntStore.setState({
                        startedAt: new Date(Date.now() - TWELVE_H_MS - 1000).toISOString(),
                    });
            });

            const preClaim = await page.evaluate(async () => {
                const mod = await import('/src/stores/offlineHuntStore.ts');
                const s = (mod as {
                    useOfflineHuntStore: { getState: () => { isActive: boolean; startedAt: string | null; targetMonster: { id: string } | null } };
                }).useOfflineHuntStore.getState();
                return {
                    isActive: s.isActive,
                    startedAtSet: s.startedAt !== null,
                    targetId: s.targetMonster?.id ?? null,
                };
            });
            expect(preClaim.isActive).toBe(true);
            expect(preClaim.startedAtSet).toBe(true);
            expect(preClaim.targetId).toBe('rat');

            const result = await page.evaluate(async () => {
                let hadCrash = false;
                try {
                    const [ohSysMod, charMod, invMod, masMod, ohStoreMod] = await Promise.all([
                        import('/src/systems/offlineHuntSystem.ts'),
                        import('/src/stores/characterStore.ts'),
                        import('/src/stores/inventoryStore.ts'),
                        import('/src/stores/masteryStore.ts'),
                        import('/src/stores/offlineHuntStore.ts'),
                    ]);
                    const claimResult = (ohSysMod as {
                        claimOfflineHunt: () => { xpGained: number; goldGained: number; kills: number; levelsGained: number; monster: { id: string }; killsByRarity: { normal: number; strong: number; epic: number; legendary: number; boss: number } } | null;
                    }).claimOfflineHunt();
                    if (!claimResult) {
                        return { hadCrash: false, claimReturnedNull: true };
                    }
                    const ch = (charMod as {
                        useCharacterStore: { getState: () => { character: { xp: number; level: number } | null } };
                    }).useCharacterStore.getState().character;
                    const inv = (invMod as {
                        useInventoryStore: { getState: () => { gold: number } };
                    }).useInventoryStore.getState();
                    const mas = (masMod as {
                        useMasteryStore: { getState: () => { masteryKills: Record<string, number> } };
                    }).useMasteryStore.getState();
                    const oh = (ohStoreMod as {
                        useOfflineHuntStore: { getState: () => { isActive: boolean; startedAt: string | null; targetMonster: { id: string } | null } };
                    }).useOfflineHuntStore.getState();
                    return {
                        hadCrash: false,
                        claimReturnedNull: false,
                        claimXp: claimResult.xpGained,
                        claimGold: claimResult.goldGained,
                        claimKills: claimResult.kills,
                        levelsGained: claimResult.levelsGained,
                        monsterId: claimResult.monster.id,
                        normalKills: claimResult.killsByRarity.normal,
                        xpAfter: ch?.xp ?? -1,
                        levelAfter: ch?.level ?? -1,
                        goldAfter: inv.gold,
                        masteryRatKillsAfter: mas.masteryKills['rat'] ?? 0,
                        sessionActiveAfter: oh.isActive,
                        sessionStartedAtNull: oh.startedAt === null,
                        sessionTargetMonsterNull: oh.targetMonster === null,
                    };
                } catch (e) {
                    hadCrash = true;
                    return { hadCrash, error: String(e) };
                }
            });

            expect(result.hadCrash, `claimOfflineHunt threw — ${'error' in result ? result.error : 'no error string'}`).toBe(false);
            expect(result.claimReturnedNull, 'claimOfflineHunt returned null — preview failed or hunt not active').toBe(false);

            expect(result.claimKills, 'kills should be > 0 at 12h cap').toBeGreaterThan(0);
            expect(result.claimXp, 'xpGained should be > 0').toBeGreaterThan(0);
            expect(result.claimGold, 'goldGained should be > 0').toBeGreaterThan(0);
            expect(result.normalKills, 'normalKills should be > 0 (rat rolls predominantly normal at lvl 5)').toBeGreaterThan(0);
            expect(result.monsterId).toBe('rat');

            if (result.levelsGained === 0) {
                expect(result.xpAfter, 'charStore.xp should have grown by claim.xpGained').toBeGreaterThan(before.xp);
            } else {
                expect(result.levelAfter, 'character level should have advanced when levelsGained>0').toBeGreaterThan(before.level);
            }

            expect(result.goldAfter).toBe(before.gold + result.claimGold);

            expect(result.masteryRatKillsAfter, 'masteryKills[rat] should advance past pre-claim baseline').toBeGreaterThan(before.ratKills);

            expect(result.sessionActiveAfter, 'hunt session should be ended (isActive=false) after claim').toBe(false);
            expect(result.sessionStartedAtNull, 'startedAt should be null after claim').toBe(true);
            expect(result.sessionTargetMonsterNull, 'targetMonster should be null after claim').toBe(true);
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
