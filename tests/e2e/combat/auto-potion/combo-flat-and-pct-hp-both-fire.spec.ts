
import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';
import { seedConsumables } from '../../fixtures/seedInventory';

test.describe('Combat › Auto-Potion', { tag: '@combat' }, () => {
    test.describe.configure({ timeout: 90_000 });

    test('flat HP + pct HP both fire in one engine tick: both consumables -1, HP healed by combined amount', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            const created = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: nick,
                class: 'Knight',
                overrides: {
                    level: 200,
                    highest_level: 200,
                    hp_regen: 0,
                    mp_regen: 0,
                },
            });
            createdId = created.id;

            await seedConsumables({
                characterId: created.id,
                counts: {
                    hp_potion_sm: 5,
                    hp_potion_great: 5,
                },
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
                const settingsMod = await import('/src/stores/settingsStore.ts');

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
                        getState: () => {
                            hpPotionCooldown: number;
                            pctHpCooldown: number;
                            clearAll: () => void;
                        };
                    };
                }).useCooldownStore;
                const useSettingsStore = (settingsMod as {
                    useSettingsStore: {
                        getState: () => {
                            setAutoPotionPctHpEnabled: (v: boolean) => void;
                        };
                    };
                }).useSettingsStore;

                useCooldownStore.getState().clearAll();

                useSettingsStore.getState().setAutoPotionPctHpEnabled(true);

                const rat = engine.getAllMonsters().find((m) => m.id === 'rat');
                if (!rat) throw new Error('rat monster missing from registry');

                useCombatStore.getState().initCombat(rat, 30, 30, 'normal');

                engine.tryAutoPotion(30, 120, 30, 30);

                const combat = useCombatStore.getState();
                const inv = useInventoryStore.getState();
                const cd = useCooldownStore.getState();
                return {
                    playerCurrentHp: combat.playerCurrentHp,
                    flatCount: inv.consumables['hp_potion_sm'] ?? 0,
                    pctCount: inv.consumables['hp_potion_great'] ?? 0,
                    hpPotionCooldown: cd.hpPotionCooldown,
                    pctHpCooldown: cd.pctHpCooldown,
                    sessionLog: combat.sessionLog.map((l) => ({ ...l })),
                };
            });

            expect(result.flatCount).toBe(4);
            expect(result.pctCount).toBe(4);

            expect(result.playerCurrentHp).toBe(104);

            expect(result.hpPotionCooldown).toBeGreaterThan(0);
            expect(result.pctHpCooldown).toBeGreaterThan(0);

            const autoPotionLogs = result.sessionLog.filter((l) =>
                /\[Auto-Potion\]/.test(l.text),
            );
            expect(autoPotionLogs.length).toBe(2);
            const hasFlatLog = autoPotionLogs.some((l) => /\+50 HP/.test(l.text));
            const hasPctLog = autoPotionLogs.some((l) => /\+24 HP/.test(l.text));
            expect(hasFlatLog).toBe(true);
            expect(hasPctLog).toBe(true);
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
