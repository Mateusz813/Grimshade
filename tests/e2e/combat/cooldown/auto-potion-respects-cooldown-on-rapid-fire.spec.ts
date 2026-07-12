
import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';
import { seedConsumables } from '../../fixtures/seedInventory';

test.describe('Combat › Cooldown', { tag: '@combat' }, () => {
    test.describe.configure({ timeout: 90_000 });

    test('auto-potion fires once, blocks while cooldown active, fires again after tick releases cooldown', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            const created = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
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

            await loginViaUI(page, testUsers.primary);
            await page.goto('/character-select');
            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await expect(card).toBeVisible({ timeout: 10_000 });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
            await expect(page.locator('.town__char-name')).toHaveText(nick, { timeout: 10_000 });

            const result = await page.evaluate(async () => {
                const engineMod = await import('/src/systems/combatEngine.ts');
                const combatMod = await import('/src/stores/combatStore.ts');
                const invMod = await import('/src/stores/inventoryStore.ts');
                const cdMod = await import('/src/stores/cooldownStore.ts');

                const engine = engineMod as {
                    tryAutoPotion: (hp: number, maxHp: number, mp: number, maxMp: number) => void;
                    getAllMonsters: () => Array<{ id: string; hp: number; level: number }>;
                };
                const useCombatStore = (combatMod as {
                    useCombatStore: {
                        getState: () => {
                            initCombat: (m: unknown, hp: number, mp: number, rarity?: string) => void;
                            playerCurrentHp: number;
                            setHps: (mHp: number, pHp: number) => void;
                        };
                    };
                }).useCombatStore;
                const useInventoryStore = (invMod as {
                    useInventoryStore: { getState: () => { consumables: Record<string, number> } };
                }).useInventoryStore;
                const useCooldownStore = (cdMod as {
                    useCooldownStore: {
                        getState: () => {
                            hpPotionCooldown: number;
                            clearAll: () => void;
                            tick: (decMs: number) => void;
                        };
                    };
                }).useCooldownStore;

                useCooldownStore.getState().clearAll();

                const rat = engine.getAllMonsters().find((m) => m.id === 'rat');
                if (!rat) throw new Error('rat missing');

                useCombatStore.getState().initCombat(rat, 30, 30, 'normal');

                engine.tryAutoPotion(30, 120, 30, 30);
                const afterFire1 = {
                    count: useInventoryStore.getState().consumables['hp_potion_sm'] ?? 0,
                    hp: useCombatStore.getState().playerCurrentHp,
                    cd: useCooldownStore.getState().hpPotionCooldown,
                };

                useCombatStore.getState().setHps(rat.hp, 30);
                engine.tryAutoPotion(30, 120, 30, 30);
                const afterFire2 = {
                    count: useInventoryStore.getState().consumables['hp_potion_sm'] ?? 0,
                    hp: useCombatStore.getState().playerCurrentHp,
                    cd: useCooldownStore.getState().hpPotionCooldown,
                };

                useCooldownStore.getState().tick(1000);
                const afterTick = {
                    cd: useCooldownStore.getState().hpPotionCooldown,
                };

                useCombatStore.getState().setHps(rat.hp, 30);
                engine.tryAutoPotion(30, 120, 30, 30);
                const afterFire3 = {
                    count: useInventoryStore.getState().consumables['hp_potion_sm'] ?? 0,
                    hp: useCombatStore.getState().playerCurrentHp,
                    cd: useCooldownStore.getState().hpPotionCooldown,
                };

                return { afterFire1, afterFire2, afterTick, afterFire3 };
            });

            expect(result.afterFire1.count).toBe(4);
            expect(result.afterFire1.hp).toBe(80);
            expect(result.afterFire1.cd).toBeGreaterThan(0);

            expect(result.afterFire2.count).toBe(4);
            expect(result.afterFire2.hp).toBe(30);
            expect(result.afterFire2.cd).toBeGreaterThan(0);

            expect(result.afterTick.cd).toBe(0);

            expect(result.afterFire3.count).toBe(3);
            expect(result.afterFire3.hp).toBe(80);
            expect(result.afterFire3.cd).toBeGreaterThan(0);
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
