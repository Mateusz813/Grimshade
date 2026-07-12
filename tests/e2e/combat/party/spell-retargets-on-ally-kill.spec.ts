
import { test, expect, type Page } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { seedGameSave, findUserIdByEmail } from '../../fixtures/seedGameSave';
import { openMultiContext } from '../../fixtures/multiContext';

const pickCharacterAndEnterTown = async (page: Page, nick: string): Promise<void> => {
    if (!page.url().endsWith('/character-select')) {
        await page.goto('/character-select');
    }
    await expect(page.locator('.char-select__card-name', { hasText: nick }))
        .toBeVisible({ timeout: 15_000 });
    const card = page.locator('.char-select__card', {
        has: page.locator('.char-select__card-name', { hasText: nick }),
    });
    await card.getByRole('button', { name: /Wybierz/i }).tap();
    await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
    await expect(page.locator('.town__char-name')).toHaveText(nick);
};

const navToParty = async (page: Page): Promise<void> => {
    await page.getByRole('button', { name: /^Społeczność$/i }).tap();
    await expect(page).toHaveURL(/\/social$/, { timeout: 10_000 });
    await page.locator('.social__tile--party').tap();
    await expect(page).toHaveURL(/\/party$/, { timeout: 10_000 });
    await expect(page.locator('.party__intro-title, .party__roster').first())
        .toBeVisible({ timeout: 15_000 });
};

test.describe('Combat › Party', { tag: '@combat' }, () => {
    test.describe.configure({ timeout: 180_000 });

    test('spell retargets on ally-killed slot, refuses cast when no alive monsters remain', async ({ browser }) => {
        const primaryNick = generateTestCharacterName();
        const secondaryNick = generateTestCharacterName();
        const partyName = `Retarget ${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

        let primaryCharId: string | null = null;
        let secondaryCharId: string | null = null;
        let handles: Awaited<ReturnType<typeof openMultiContext>> | null = null;

        try {
            const primaryCreated = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: primaryNick,
                class: 'Knight',
                overrides: { level: 10, highest_level: 10, hp_regen: 0, mp_regen: 0 },
            });
            primaryCharId = primaryCreated.id;
            const secondaryCreated = await createCharacterViaApi({
                userEmail: testUsers.secondary.email,
                name: secondaryNick,
                class: 'Mage',
                overrides: { level: 10, highest_level: 10, hp_regen: 0, mp_regen: 0 },
            });
            secondaryCharId = secondaryCreated.id;

            const primaryUserId = await findUserIdByEmail(testUsers.primary.email);
            const secondaryUserId = await findUserIdByEmail(testUsers.secondary.email);
            await seedGameSave({ characterId: primaryCharId, userId: primaryUserId });
            await seedGameSave({ characterId: secondaryCharId, userId: secondaryUserId });

            handles = await openMultiContext(browser);
            const { primaryPage, secondaryPage } = handles;

            await Promise.all([
                pickCharacterAndEnterTown(primaryPage, primaryNick),
                pickCharacterAndEnterTown(secondaryPage, secondaryNick),
            ]);

            await Promise.all([
                navToParty(primaryPage),
                navToParty(secondaryPage),
            ]);

            await primaryPage
                .locator('.party__primary-btn', { hasText: /Stwórz nowe party/i })
                .tap();
            await expect(primaryPage.locator('.party__create-form'))
                .toBeVisible({ timeout: 5_000 });
            await primaryPage.locator('.party__field', { hasText: /Nazwa party/i })
                .locator('input').fill(partyName);
            const primarySubmitBtn = primaryPage.locator('.party__form-actions')
                .getByRole('button', { name: /^Utwórz$/i });
            await expect(primarySubmitBtn).toBeEnabled({ timeout: 10_000 });
            await primarySubmitBtn.tap();
            await expect(primaryPage.locator('.party__roster')).toBeVisible({ timeout: 15_000 });
            await expect(primaryPage.locator('.party__roster-meta'))
                .toContainText(/1\/4\s+graczy/i);

            await secondaryPage.locator('.party__refresh-btn').tap();
            const partyCard = secondaryPage.locator('.party__card', {
                has: secondaryPage.locator('.party__card-name', { hasText: partyName }),
            });
            await expect(partyCard).toBeVisible({ timeout: 15_000 });
            const joinBtn = partyCard.locator('.party__primary-btn', { hasText: /^Dołącz$/i });
            await expect(joinBtn).toBeEnabled({ timeout: 10_000 });
            await joinBtn.tap();

            await expect(primaryPage.locator('.party__roster-meta'))
                .toContainText(/2\/4\s+graczy/i, { timeout: 45_000 });
            await expect(secondaryPage.locator('.party__roster-meta'))
                .toContainText(/2\/4\s+graczy/i, { timeout: 45_000 });

            const setupResult = await primaryPage.evaluate(async () => {
                const engineMod = await import('/src/systems/combatEngine.ts');
                const combatMod = await import('/src/stores/combatStore.ts');
                const engine = engineMod as {
                    getAllMonsters: () => Array<{ id: string; level: number; hp: number }>;
                };
                const useCombatStore = (combatMod as {
                    useCombatStore: {
                        getState: () => {
                            initCombat: (m: unknown, hp: number, mp: number, rarity?: string) => void;
                            addWaveMonster: (m: unknown, rarity: string) => boolean;
                            waveMonsters: Array<{ isDead: boolean; currentHp: number }>;
                            activeTargetIdx: number;
                        };
                    };
                }).useCombatStore;

                const rat = engine.getAllMonsters().find((m) => m.id === 'rat');
                if (!rat) throw new Error('rat monster def missing');

                useCombatStore.getState().initCombat(rat, 100, 30, 'normal');
                const added = useCombatStore.getState().addWaveMonster(rat, 'normal');
                if (!added) throw new Error('addWaveMonster slot 1 failed');

                const wave = useCombatStore.getState().waveMonsters;
                return {
                    waveLen: wave.length,
                    slot0Dead: wave[0].isDead,
                    slot1Dead: wave[1].isDead,
                    activeIdx: useCombatStore.getState().activeTargetIdx,
                };
            });

            expect(setupResult.waveLen).toBe(2);
            expect(setupResult.slot0Dead).toBe(false);
            expect(setupResult.slot1Dead).toBe(false);
            expect(setupResult.activeIdx).toBe(0);

            const retargetResult = await primaryPage.evaluate(async () => {
                const engineMod = await import('/src/systems/combatEngine.ts');
                const combatMod = await import('/src/stores/combatStore.ts');
                const engine = engineMod as {
                    huntApplySkillEffectV2: (skillId: string, activeIdx: number) => unknown | null;
                };
                const useCombatStore = (combatMod as {
                    useCombatStore: {
                        getState: () => {
                            damageWaveMonster: (idx: number, dmg: number) => void;
                            markActiveWaveMonsterDead: () => void;
                            waveMonsters: Array<{ isDead: boolean; currentHp: number; monster: { id: string } }>;
                            activeTargetIdx: number;
                            monster: { id: string } | null;
                            monsterCurrentHp: number;
                        };
                    };
                }).useCombatStore;

                useCombatStore.getState().damageWaveMonster(0, 9999);
                useCombatStore.getState().markActiveWaveMonsterDead();

                const preWave = useCombatStore.getState().waveMonsters;
                const preActiveIdx = useCombatStore.getState().activeTargetIdx;

                const effApply = engine.huntApplySkillEffectV2('shield_bash', 0);

                const postWave = useCombatStore.getState().waveMonsters;
                const postActiveIdx = useCombatStore.getState().activeTargetIdx;
                const postMonsterId = useCombatStore.getState().monster?.id ?? null;
                const postMonsterHp = useCombatStore.getState().monsterCurrentHp;

                return {
                    effApplyIsNull: effApply === null,
                    preActiveIdx,
                    postActiveIdx,
                    preSlot0Dead: preWave[0].isDead,
                    preSlot1Dead: preWave[1].isDead,
                    postSlot1Dead: postWave[1].isDead,
                    postMonsterId,
                    postMonsterHp,
                    slot1MonsterId: postWave[1].monster.id,
                    slot1Hp: postWave[1].currentHp,
                };
            });

            expect(retargetResult.effApplyIsNull).toBe(false);

            expect(retargetResult.preSlot0Dead).toBe(true);
            expect(retargetResult.preSlot1Dead).toBe(false);
            expect(retargetResult.preActiveIdx).toBe(0);

            expect(retargetResult.postActiveIdx).toBe(1);

            expect(retargetResult.postMonsterId).toBe('rat');
            expect(retargetResult.postMonsterHp).toBe(retargetResult.slot1Hp);
            expect(retargetResult.postSlot1Dead).toBe(false);

            const negativeResult = await primaryPage.evaluate(async () => {
                const engineMod = await import('/src/systems/combatEngine.ts');
                const combatMod = await import('/src/stores/combatStore.ts');
                const engine = engineMod as {
                    huntApplySkillEffectV2: (skillId: string, activeIdx: number) => unknown | null;
                };
                const useCombatStore = (combatMod as {
                    useCombatStore: {
                        getState: () => {
                            damageWaveMonster: (idx: number, dmg: number) => void;
                            markActiveWaveMonsterDead: () => void;
                            waveMonsters: Array<{ isDead: boolean; currentHp: number }>;
                        };
                    };
                }).useCombatStore;

                useCombatStore.getState().damageWaveMonster(1, 9999);
                useCombatStore.getState().markActiveWaveMonsterDead();

                const wave = useCombatStore.getState().waveMonsters;
                const allDead = wave.every((w) => w.isDead);

                const effApply = engine.huntApplySkillEffectV2('shield_bash', 1);

                return {
                    allDead,
                    effApplyIsNull: effApply === null,
                };
            });

            expect(negativeResult.allDead).toBe(true);
            expect(negativeResult.effApplyIsNull).toBe(true);
        } finally {
            if (handles) {
                await handles.cleanup({ primaryCharId, secondaryCharId });
            } else {
                const { cleanupCharacterById } = await import('../../fixtures/cleanup');
                const { getAdminClient } = await import('../../fixtures/adminClient');
                const idsToWipe = [primaryCharId, secondaryCharId].filter(
                    (id): id is string => id !== null,
                );
                if (idsToWipe.length > 0) {
                    try {
                        const admin = getAdminClient();
                        const idList = idsToWipe.map((id) => `"${id}"`).join(',');
                        await admin.from('parties').delete().or(`leader_id.in.(${idList})`);
                    } catch { }
                    await Promise.all(idsToWipe.map((id) => cleanupCharacterById(id)));
                }
            }
        }
    });
});
