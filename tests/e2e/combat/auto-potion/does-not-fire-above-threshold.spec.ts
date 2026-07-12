
import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';
import { seedConsumables } from '../../fixtures/seedInventory';

test.describe('Combat › Auto-Potion', { tag: '@combat' }, () => {
    test.describe.configure({ timeout: 90_000 });

    test('HP at 66% (above threshold 50) does NOT trigger auto-potion: count + HP + cooldown unchanged', async ({ page }) => {
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
                            sessionLog: Array<{ id: number; text: string; type: string }>;
                        };
                    };
                }).useCombatStore;
                const useInventoryStore = (invMod as {
                    useInventoryStore: { getState: () => { consumables: Record<string, number> } };
                }).useInventoryStore;
                const useCooldownStore = (cdMod as {
                    useCooldownStore: {
                        getState: () => { hpPotionCooldown: number; clearAll: () => void };
                    };
                }).useCooldownStore;

                useCooldownStore.getState().clearAll();

                const rat = engine.getAllMonsters().find((m) => m.id === 'rat');
                if (!rat) throw new Error('rat missing');

                useCombatStore.getState().initCombat(rat, 80, 30, 'normal');

                engine.tryAutoPotion(80, 120, 30, 30);

                return {
                    count: useInventoryStore.getState().consumables['hp_potion_sm'] ?? 0,
                    hp: useCombatStore.getState().playerCurrentHp,
                    cd: useCooldownStore.getState().hpPotionCooldown,
                    sessionLog: useCombatStore.getState().sessionLog.map((l) => ({ ...l })),
                };
            });

            expect(result.count).toBe(5);

            expect(result.hp).toBe(80);

            expect(result.cd).toBe(0);

            const autoPotionLogs = result.sessionLog.filter((l) =>
                /\[Auto-Potion\]/.test(l.text),
            );
            expect(autoPotionLogs.length).toBe(0);
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
