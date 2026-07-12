
import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';

test.describe('Combat › Speed', { tag: '@combat' }, () => {
    test.describe.configure({ timeout: 120_000 });

    test('setCombatSpeed during active fight does not crash + new value persists', async ({ page }) => {
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

            const result = await page.evaluate(async () => {
                const engineMod = await import('/src/systems/combatEngine.ts');
                const combatMod = await import('/src/stores/combatStore.ts');
                const settingsMod = await import('/src/stores/settingsStore.ts');
                const charMod = await import('/src/stores/characterStore.ts');

                interface IGetAllMon { getAllMonsters: () => Array<{ id: string; level: number; hp: number }> }
                const engine = engineMod as unknown as IGetAllMon;
                interface ICombatLite {
                    initCombat: (m: unknown, hp: number, mp: number, rarity?: string) => void;
                    phase: 'idle' | 'fighting' | 'victory' | 'dead';
                }
                const useCombatStore = (combatMod as unknown as {
                    useCombatStore: { getState: () => ICombatLite };
                }).useCombatStore;
                interface ISettingsLite {
                    combatSpeed: string;
                    setCombatSpeed: (s: string) => void;
                }
                const useSettingsStore = (settingsMod as unknown as {
                    useSettingsStore: { getState: () => ISettingsLite };
                }).useSettingsStore;
                const useCharacterStore = (charMod as unknown as {
                    useCharacterStore: { getState: () => { character: { hp: number; mp: number } | null } };
                }).useCharacterStore;

                const character = useCharacterStore.getState().character;
                if (!character) {
                    return { error: 'no character hydrated' as const };
                }

                useSettingsStore.getState().setCombatSpeed('x1');

                const monster = engine.getAllMonsters().find((m) => m.id === 'rat');
                if (!monster) {
                    return { error: 'rat monster not found in monsters.json' as const };
                }

                useCombatStore.getState().initCombat(monster as unknown, character.hp ?? 100, character.mp ?? 50, 'normal');

                const phaseBefore = useCombatStore.getState().phase;
                const speedBefore = useSettingsStore.getState().combatSpeed;

                useSettingsStore.getState().setCombatSpeed('x4');
                const phaseAfterX4 = useCombatStore.getState().phase;
                const speedAfterX4 = useSettingsStore.getState().combatSpeed;

                useSettingsStore.getState().setCombatSpeed('x2');
                const phaseAfterX2 = useCombatStore.getState().phase;
                const speedAfterX2 = useSettingsStore.getState().combatSpeed;

                useSettingsStore.getState().setCombatSpeed('x1');
                const phaseAfterX1 = useCombatStore.getState().phase;
                const speedAfterX1 = useSettingsStore.getState().combatSpeed;

                return {
                    error: null,
                    phaseBefore,
                    speedBefore,
                    phaseAfterX4,
                    speedAfterX4,
                    phaseAfterX2,
                    speedAfterX2,
                    phaseAfterX1,
                    speedAfterX1,
                };
            });

            expect(result.error).toBeNull();

            expect(result.phaseBefore).toBe('fighting');
            expect(result.speedBefore).toBe('x1');

            expect(result.speedAfterX4).toBe('x4');
            expect(result.phaseAfterX4).toBe('fighting');

            expect(result.speedAfterX2).toBe('x2');
            expect(result.phaseAfterX2).toBe('fighting');

            expect(result.speedAfterX1).toBe('x1');
            expect(result.phaseAfterX1).toBe('fighting');
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
