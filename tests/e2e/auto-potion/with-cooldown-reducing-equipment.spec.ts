
import { test, expect } from '@playwright/test';
import { testUsers } from '../fixtures/testUsers';
import { loginViaUI } from '../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../fixtures/createCharacter';
import { cleanupCharacterById } from '../fixtures/cleanup';
import { seedConsumables } from '../fixtures/seedInventory';

test.describe('Auto-Potion › Cooldown vs Equipment', { tag: '@auto-potion' }, () => {
    test.describe.configure({ timeout: 90_000 });

    test('potion cooldown locked at FLAT_POTION_COOLDOWN_MS=1000 regardless of cooldown_reduction buff (current contract)', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            const created = await createCharacterViaApi({
                userEmail: testUsers.secondary.email,
                name: nick,
                class: 'Knight',
                overrides: {
                    level: 5,
                    highest_level: 5,
                    hp_regen: 0,
                    mp_regen: 0,
                },
            });
            createdId = created.id;

            await seedConsumables({
                characterId: created.id,
                counts: { hp_potion_sm: 5 },
            });

            await loginViaUI(page, testUsers.secondary);
            await page.goto('/character-select');
            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await expect(card).toBeVisible({ timeout: 10_000 });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
            await expect(page.locator('.town__char-name')).toHaveText(nick, { timeout: 10_000 });

            const preCount = await page.evaluate(async () => {
                const mod = await import('/src/stores/inventoryStore.ts');
                const inv = (mod as {
                    useInventoryStore: { getState: () => { consumables: Record<string, number> } };
                }).useInventoryStore.getState();
                return inv.consumables['hp_potion_sm'] ?? 0;
            });
            expect(preCount).toBe(5);

            const result = await page.evaluate(async () => {
                const engineMod = await import('/src/systems/combatEngine.ts');
                const combatMod = await import('/src/stores/combatStore.ts');
                const invMod = await import('/src/stores/inventoryStore.ts');
                const cdMod = await import('/src/stores/cooldownStore.ts');
                const buffMod = await import('/src/stores/buffStore.ts');
                const charMod = await import('/src/stores/characterStore.ts');

                const engine = engineMod as {
                    tryAutoPotion: (hp: number, maxHp: number, mp: number, maxMp: number) => void;
                    getAllMonsters: () => Array<{ id: string; level: number; hp: number }>;
                };
                const useCombatStore = (combatMod as {
                    useCombatStore: {
                        getState: () => {
                            initCombat: (m: unknown, hp: number, mp: number, rarity?: string) => void;
                            playerCurrentHp: number;
                            healPlayerHp: (amount: number, max: number) => void;
                        };
                    };
                }).useCombatStore;
                const useInventoryStore = (invMod as {
                    useInventoryStore: {
                        getState: () => {
                            consumables: Record<string, number>;
                            addConsumable: (id: string, delta: number) => void;
                        };
                    };
                }).useInventoryStore;
                const useCooldownStore = (cdMod as {
                    useCooldownStore: {
                        getState: () => { hpPotionCooldown: number; clearAll: () => void };
                    };
                }).useCooldownStore;
                const useBuffStore = (buffMod as {
                    useBuffStore: {
                        getState: () => {
                            allBuffs: Array<unknown>;
                            addBuff: (b: { id: string; name: string; icon: string; effect: string }, durationMs: number) => void;
                            clearCharacterBuffs: () => void;
                        };
                    };
                }).useBuffStore;
                const useCharacterStore = (charMod as {
                    useCharacterStore: { getState: () => { character: { id: string } | null } };
                }).useCharacterStore;

                const charId = useCharacterStore.getState().character?.id;
                if (!charId) throw new Error('[11.5 test] character not hydrated');

                const rat = engine.getAllMonsters().find((m) => m.id === 'rat');
                if (!rat) throw new Error('[11.5 test] rat monster missing');

                useCooldownStore.getState().clearAll();
                useBuffStore.getState().clearCharacterBuffs();
                useCombatStore.getState().initCombat(rat, 40, 30, 'normal');
                const preCdBaseline = useCooldownStore.getState().hpPotionCooldown;
                const preCountBaseline = useInventoryStore.getState().consumables['hp_potion_sm'] ?? 0;

                engine.tryAutoPotion(40, 120, 30, 30);

                const baselineCd = useCooldownStore.getState().hpPotionCooldown;
                const baselineCount = useInventoryStore.getState().consumables['hp_potion_sm'] ?? 0;

                useInventoryStore.getState().addConsumable('hp_potion_sm', 1);
                useCooldownStore.getState().clearAll();
                useCombatStore.getState().initCombat(rat, 40, 30, 'normal');

                useBuffStore.getState().addBuff(
                    {
                        id: 'cooldown_reduction',
                        name: 'CD -20%',
                        icon: 'cyclone',
                        effect: 'cooldown_reduction',
                    },
                    24 * 60 * 60 * 1000,
                );
                const buffCount = useBuffStore.getState().allBuffs.length;

                const preCdWithBuff = useCooldownStore.getState().hpPotionCooldown;
                const preCountWithBuff = useInventoryStore.getState().consumables['hp_potion_sm'] ?? 0;

                engine.tryAutoPotion(40, 120, 30, 30);

                const withBuffCd = useCooldownStore.getState().hpPotionCooldown;
                const withBuffCount = useInventoryStore.getState().consumables['hp_potion_sm'] ?? 0;

                return {
                    preCdBaseline,
                    preCountBaseline,
                    baselineCd,
                    baselineCount,
                    buffCount,
                    preCdWithBuff,
                    preCountWithBuff,
                    withBuffCd,
                    withBuffCount,
                };
            });

            expect(result.preCdBaseline).toBe(0);
            expect(result.preCountBaseline).toBe(5);

            expect(result.baselineCount).toBe(4);
            expect(result.baselineCd).toBe(1000);

            expect(result.preCdWithBuff).toBe(0);
            expect(result.preCountWithBuff).toBe(5);
            expect(result.buffCount).toBeGreaterThanOrEqual(1);

            expect(result.withBuffCount).toBe(4);
            expect(result.withBuffCd).toBe(1000);

            expect(result.withBuffCd).toBe(result.baselineCd);
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
