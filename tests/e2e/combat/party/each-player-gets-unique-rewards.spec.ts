
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

const applyMemberRewardAndSnapshot = async (
    page: Page,
    args: { monsterId: string; monsterLevel: number; rarity: string; finalXp: number },
): Promise<{
    xp: number;
    level: number;
    gold: number;
    bagSize: number;
    sessionKillsNormal: number;
    taskRatProgress: number;
}> => {
    return await page.evaluate(async (a) => {
        const engineMod = await import('/src/systems/combatEngine.ts');
        const charMod = await import('/src/stores/characterStore.ts');
        const invMod = await import('/src/stores/inventoryStore.ts');
        const combatMod = await import('/src/stores/combatStore.ts');
        const taskMod = await import('/src/stores/taskStore.ts');

        const engine = engineMod as {
            applyMonsterKillRewardsForMember: (
                monsterId: string,
                monsterLevel: number,
                rarity: string,
                finalXpFromLeader: number,
            ) => void;
        };
        const useCharacterStore = (charMod as {
            useCharacterStore: { getState: () => { character: { xp: number; level: number } | null } };
        }).useCharacterStore;
        const useInventoryStore = (invMod as {
            useInventoryStore: { getState: () => { gold: number; bag: unknown[] } };
        }).useInventoryStore;
        const useCombatStore = (combatMod as {
            useCombatStore: { getState: () => { sessionKills: Record<string, number> } };
        }).useCombatStore;
        const useTaskStore = (taskMod as {
            useTaskStore: {
                getState: () => {
                    progress: Record<string, number>;
                };
            };
        }).useTaskStore;

        engine.applyMonsterKillRewardsForMember(
            a.monsterId,
            a.monsterLevel,
            a.rarity,
            a.finalXp,
        );

        const character = useCharacterStore.getState().character;
        if (!character) throw new Error('[applyMemberRewardAndSnapshot] no character hydrated');
        const inv = useInventoryStore.getState();
        const combat = useCombatStore.getState();
        const tasks = useTaskStore.getState();

        return {
            xp: character.xp,
            level: character.level,
            gold: inv.gold,
            bagSize: inv.bag.length,
            sessionKillsNormal: combat.sessionKills.normal ?? 0,
            taskRatProgress: Object.entries(tasks.progress ?? {})
                .filter(([k]) => k.startsWith(a.monsterId))
                .reduce((acc, [, v]) => acc + (typeof v === 'number' ? v : 0), 0),
        };
    }, args);
};

test.describe('Combat › Party', { tag: '@combat' }, () => {
    test.describe.configure({ timeout: 180_000 });

    test('both members independently gain xp + gold + session-kill on shared monster kill', async ({ browser }) => {
        const primaryNick = generateTestCharacterName();
        const secondaryNick = generateTestCharacterName();
        const partyName = `Drops ${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

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

            const beforeBoth = await Promise.all([
                primaryPage.evaluate(async () => {
                    const charMod = await import('/src/stores/characterStore.ts');
                    const invMod = await import('/src/stores/inventoryStore.ts');
                    const combatMod = await import('/src/stores/combatStore.ts');
                    const character = (charMod as { useCharacterStore: { getState: () => { character: { xp: number; level: number } | null } } })
                        .useCharacterStore.getState().character;
                    const inv = (invMod as { useInventoryStore: { getState: () => { gold: number; bag: unknown[] } } })
                        .useInventoryStore.getState();
                    const combat = (combatMod as { useCombatStore: { getState: () => { sessionKills: Record<string, number> } } })
                        .useCombatStore.getState();
                    return {
                        xp: character?.xp ?? -1,
                        level: character?.level ?? -1,
                        gold: inv.gold,
                        bagSize: inv.bag.length,
                        sessionKillsNormal: combat.sessionKills.normal ?? 0,
                    };
                }),
                secondaryPage.evaluate(async () => {
                    const charMod = await import('/src/stores/characterStore.ts');
                    const invMod = await import('/src/stores/inventoryStore.ts');
                    const combatMod = await import('/src/stores/combatStore.ts');
                    const character = (charMod as { useCharacterStore: { getState: () => { character: { xp: number; level: number } | null } } })
                        .useCharacterStore.getState().character;
                    const inv = (invMod as { useInventoryStore: { getState: () => { gold: number; bag: unknown[] } } })
                        .useInventoryStore.getState();
                    const combat = (combatMod as { useCombatStore: { getState: () => { sessionKills: Record<string, number> } } })
                        .useCombatStore.getState();
                    return {
                        xp: character?.xp ?? -1,
                        level: character?.level ?? -1,
                        gold: inv.gold,
                        bagSize: inv.bag.length,
                        sessionKillsNormal: combat.sessionKills.normal ?? 0,
                    };
                }),
            ]);

            const [beforePrimary, beforeSecondary] = beforeBoth;
            expect(beforePrimary.xp).toBeGreaterThanOrEqual(0);
            expect(beforeSecondary.xp).toBeGreaterThanOrEqual(0);

            const FINAL_XP_FROM_LEADER = 10;
            const [afterPrimary, afterSecondary] = await Promise.all([
                applyMemberRewardAndSnapshot(primaryPage, {
                    monsterId: 'rat',
                    monsterLevel: 1,
                    rarity: 'normal',
                    finalXp: FINAL_XP_FROM_LEADER,
                }),
                applyMemberRewardAndSnapshot(secondaryPage, {
                    monsterId: 'rat',
                    monsterLevel: 1,
                    rarity: 'normal',
                    finalXp: FINAL_XP_FROM_LEADER,
                }),
            ]);

            const primaryXpDelta = afterPrimary.xp - beforePrimary.xp;
            const secondaryXpDelta = afterSecondary.xp - beforeSecondary.xp;
            expect(primaryXpDelta).toBe(FINAL_XP_FROM_LEADER);
            expect(secondaryXpDelta).toBe(FINAL_XP_FROM_LEADER);

            expect(afterPrimary.sessionKillsNormal).toBe(beforePrimary.sessionKillsNormal + 1);
            expect(afterSecondary.sessionKillsNormal).toBe(beforeSecondary.sessionKillsNormal + 1);

            const primaryGoldDelta = afterPrimary.gold - beforePrimary.gold;
            const secondaryGoldDelta = afterSecondary.gold - beforeSecondary.gold;
            expect(primaryGoldDelta).toBeGreaterThanOrEqual(1);
            expect(secondaryGoldDelta).toBeGreaterThanOrEqual(1);

            expect(afterPrimary.level).toBe(beforePrimary.level);
            expect(afterSecondary.level).toBe(beforeSecondary.level);

            expect(afterPrimary.taskRatProgress).toBeGreaterThanOrEqual(0);
            expect(afterSecondary.taskRatProgress).toBeGreaterThanOrEqual(0);
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
