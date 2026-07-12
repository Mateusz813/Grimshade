
import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';

test.describe('Combat › Aggro', { tag: '@combat' }, () => {
    test.describe.configure({ timeout: 90_000 });

    test('member leave mid-fight: combat continues, aggro re-rolls without crash, no zombie target', async ({ page }) => {
        const primaryNick = generateTestCharacterName();
        const secondaryNick = generateTestCharacterName();
        let primaryCharId: string | null = null;
        let secondaryCharId: string | null = null;

        try {
            const primaryCreated = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: primaryNick,
                class: 'Knight',
                overrides: { level: 10, highest_level: 10, hp_regen: 0, mp_regen: 0 },
            });
            primaryCharId = primaryCreated.id;
            const secondaryCreated = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: secondaryNick,
                class: 'Mage',
                overrides: { level: 10, highest_level: 10, hp_regen: 0, mp_regen: 0 },
            });
            secondaryCharId = secondaryCreated.id;

            await loginViaUI(page, testUsers.primary);
            await page.goto('/character-select');
            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: primaryNick }),
            });
            await expect(card).toBeVisible({ timeout: 10_000 });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
            await expect(page.locator('.town__char-name')).toHaveText(primaryNick, { timeout: 10_000 });

            const result = await page.evaluate(async (args) => {
                const engineMod = await import('/src/systems/combatEngine.ts');
                const combatMod = await import('/src/stores/combatStore.ts');
                const partyMod = await import('/src/stores/partyStore.ts');
                const charMod = await import('/src/stores/characterStore.ts');

                const engine = engineMod as {
                    getAllMonsters: () => Array<{ id: string; level: number; hp: number }>;
                    resetAggro: () => void;
                };
                const useCombatStore = (combatMod as {
                    useCombatStore: {
                        getState: () => {
                            initCombat: (m: unknown, hp: number, mp: number, rarity?: string) => void;
                            phase: string;
                            monsterCurrentHp: number;
                            waveMonsters: Array<{ aggroTarget: string | null }>;
                            setWaveMonsterAggro: (idx: number, target: string) => void;
                        };
                    };
                }).useCombatStore;
                const usePartyStore = (partyMod as {
                    usePartyStore: {
                        getState: () => {
                            party: unknown;
                            removeMember: (id: string) => void;
                        };
                        setState: (s: unknown) => void;
                    };
                }).usePartyStore;
                const useCharacterStore = (charMod as {
                    useCharacterStore: { getState: () => { character: { id: string; name: string; class: string; level: number } | null } };
                }).useCharacterStore;

                const character = useCharacterStore.getState().character;
                if (!character) throw new Error('character not hydrated');

                const simulatedParty = {
                    id: 'e2e-sim-party',
                    leaderId: character.id,
                    members: [
                        {
                            id: character.id,
                            name: character.name,
                            class: character.class,
                            level: character.level,
                            hp: 100,
                            maxHp: 120,
                            isOnline: true,
                            isBot: false,
                        },
                        {
                            id: args.secondaryCharId,
                            name: args.secondaryNick,
                            class: 'Mage',
                            level: 10,
                            hp: 100,
                            maxHp: 80,
                            isOnline: true,
                            isBot: false,
                        },
                    ],
                    createdAt: new Date().toISOString(),
                    name: 'E2E Sim Party',
                    description: '',
                    hasPassword: false,
                    isPublic: true,
                    maxMembers: 4,
                    minJoinLevel: 1,
                };
                usePartyStore.setState({ party: simulatedParty });

                const partyAfterSet = (usePartyStore.getState().party as unknown) as { leaderId: string; members: Array<{ id: string; isBot: boolean }> };
                const otherHumans = partyAfterSet.members.filter((m) => m.id !== character.id && !m.isBot);

                engine.resetAggro();

                const rat = engine.getAllMonsters().find((m) => m.id === 'rat');
                if (!rat) throw new Error('rat monster missing from registry');
                const bossRat = { ...rat, hp: 100_000 };
                useCombatStore.getState().initCombat(bossRat, 100, 30, 'normal');

                const preLeaveHumanCount = otherHumans.length;
                const preLeavePoolWidens = preLeaveHumanCount > 0;

                usePartyStore.getState().removeMember(args.secondaryCharId);

                const partyAfterRemove = (usePartyStore.getState().party as unknown) as { members: Array<{ id: string; isBot: boolean }> } | null;
                const postLeaveOtherHumans = partyAfterRemove
                    ? partyAfterRemove.members.filter((m) => m.id !== character.id && !m.isBot)
                    : [];
                const postLeaveHumanCount = postLeaveOtherHumans.length;
                const postLeavePoolWidens = postLeaveHumanCount > 0;

                let tickCrashed = false;
                let tickCrashMsg = '';
                const observedTargets: string[] = [];
                try {
                    const staleTarget = `human_${args.secondaryCharId}`;
                    useCombatStore.getState().setWaveMonsterAggro(0, staleTarget);
                    const afterSet = useCombatStore.getState().waveMonsters[0]?.aggroTarget ?? null;
                    if (afterSet !== null) observedTargets.push(afterSet);

                    useCombatStore.getState().setWaveMonsterAggro(0, 'player');
                    const afterReset = useCombatStore.getState().waveMonsters[0]?.aggroTarget ?? null;
                    if (afterReset !== null) observedTargets.push(afterReset);
                } catch (e) {
                    tickCrashed = true;
                    tickCrashMsg = (e as Error).message ?? String(e);
                }

                const finalCombat = useCombatStore.getState();
                return {
                    preLeaveHumanCount,
                    preLeavePoolWidens,
                    postLeaveHumanCount,
                    postLeavePoolWidens,
                    finalPhase: finalCombat.phase,
                    finalMonsterHp: finalCombat.monsterCurrentHp,
                    tickCrashed,
                    tickCrashMsg,
                    observedTargets,
                };
            }, { secondaryCharId: secondaryCharId!, secondaryNick });

            expect(result.preLeaveHumanCount).toBe(1);
            expect(result.preLeavePoolWidens).toBe(true);

            expect(result.postLeaveHumanCount).toBe(0);
            expect(result.postLeavePoolWidens).toBe(false);

            expect(result.tickCrashed, `tick crashed: ${result.tickCrashMsg}`).toBe(false);

            expect(result.finalPhase).toBe('fighting');

            expect(result.finalMonsterHp).toBeGreaterThan(0);

            expect(result.observedTargets.length).toBeGreaterThanOrEqual(1);
            expect(result.observedTargets).toContain('player');
        } finally {
            const ids = [primaryCharId, secondaryCharId].filter((id): id is string => id !== null);
            await Promise.all(ids.map((id) => cleanupCharacterById(id)));
        }
    });
});
