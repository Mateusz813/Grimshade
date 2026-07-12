
import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';
import { seedConsumables } from '../../fixtures/seedInventory';

test.describe('Combat › Auto-Potion', { tag: '@combat' }, () => {
    test.describe.configure({ timeout: 90_000 });

    test('HP at 33% triggers hp_potion_sm: consumable -1, HP +50, cooldown set, log entry written', async ({ page }) => {
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
                            log: Array<{ id: number; text: string; type: string }>;
                            resetCombat: () => void;
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
                if (!rat) throw new Error('rat monster missing from registry');

                useCombatStore.getState().initCombat(rat, 40, 30, 'normal');

                engine.tryAutoPotion(40, 120, 30, 30);

                const combat = useCombatStore.getState();
                const inv = useInventoryStore.getState();
                const cd = useCooldownStore.getState();
                return {
                    playerCurrentHp: combat.playerCurrentHp,
                    consumableCount: inv.consumables['hp_potion_sm'] ?? 0,
                    hpPotionCooldown: cd.hpPotionCooldown,
                    sessionLog: combat.sessionLog.map((l) => ({ ...l })),
                };
            });

            expect(result.consumableCount).toBe(4);

            expect(result.playerCurrentHp).toBe(90);

            expect(result.hpPotionCooldown).toBeGreaterThan(0);
            expect(result.hpPotionCooldown).toBeLessThanOrEqual(1000);

            const hasAutoPotionLog = result.sessionLog.some((l) =>
                /\[Auto-Potion\].*\+50 HP/.test(l.text),
            );
            expect(hasAutoPotionLog).toBe(true);
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
