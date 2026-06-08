/**
 * Atomic E2E — auto-potion stays silent when HP is above threshold
 * (regression guard, BACKLOG 11.2 inverse).
 *
 * Spec partial: 11.2 verifies positive case (HP below threshold fires).
 * THIS test verifies the negative case — HP equal-to / above threshold
 * does NOT fire. The two together pin down the comparison's exact
 * boundary at combatEngine.ts line 915:
 *
 *   if (valPct > threshold) return;
 *
 * Critical regression scenarios this test catches:
 *  • Someone "tightens" the comparison to `valPct >= threshold` — would
 *    fire at exactly threshold (e.g. HP=50% with threshold=50). Sibling
 *    test 11.2 (positive) wouldn't catch it because firing at 33% is
 *    valid under BOTH operator variants.
 *  • A future refactor that swaps numerator/denominator and the
 *    threshold check accidentally reverses (e.g. `threshold > valPct`
 *    instead of `valPct > threshold`). Both positive and negative tests
 *    together would catch the sign flip.
 *  • Threshold ID renamed but not propagated everywhere — if `threshold`
 *    param becomes 0 due to a missing config read, ALL fires fire,
 *    breaking this negative test.
 *
 * Test sequence:
 *  1. Seed Knight lvl 5 + 5× hp_potion_sm. Default settings keep flat
 *     HP enabled at threshold 50.
 *  2. Login + Town.
 *  3. Stage combat with playerCurrentHp = 80/120 = 66.67% — ABOVE the
 *     default threshold of 50%.
 *  4. Clear cooldowns to be sure the cooldown-gate isn't the reason
 *     for no-fire.
 *  5. Call `tryAutoPotion(80, 120, 30, 30)`.
 *  6. Assert:
 *     a) `consumables.hp_potion_sm === 5` (unchanged — no fire).
 *     b) `playerCurrentHp === 80` (unchanged — no heal).
 *     c) `cooldownStore.hpPotionCooldown === 0` (unchanged — proves
 *        engine bailed BEFORE the startCdFn call at line 933).
 *
 * Pair this with the sibling positive test to prove the threshold check
 * is the gate (not just "consumables=0" or "cooldown active" gating).
 *
 * Cleanup: try/finally + cleanupCharacterById.
 */

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
                // @ts-expect-error — dev-time Vite URL not resolvable by tsc
                const engineMod = await import('/src/systems/combatEngine.ts');
                // @ts-expect-error — dev-time Vite URL not resolvable by tsc
                const combatMod = await import('/src/stores/combatStore.ts');
                // @ts-expect-error — dev-time Vite URL not resolvable by tsc
                const invMod = await import('/src/stores/inventoryStore.ts');
                // @ts-expect-error — dev-time Vite URL not resolvable by tsc
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

                // Player HP = 80 / 120 = 66.67%. ABOVE the default flat
                // threshold of 50. Auto-potion MUST stay silent.
                useCombatStore.getState().initCombat(rat, 80, 30, 'normal');

                engine.tryAutoPotion(80, 120, 30, 30);

                return {
                    count: useInventoryStore.getState().consumables['hp_potion_sm'] ?? 0,
                    hp: useCombatStore.getState().playerCurrentHp,
                    cd: useCooldownStore.getState().hpPotionCooldown,
                    sessionLog: useCombatStore.getState().sessionLog.map((l) => ({ ...l })),
                };
            });

            // Consumable count unchanged — proves useConsumable was NOT called.
            expect(result.count).toBe(5);

            // HP unchanged — proves healPlayerHp was NOT called.
            expect(result.hp).toBe(80);

            // Cooldown unchanged at 0 — proves startCdFn was NOT called
            // (early return at line 915 happened before line 933).
            expect(result.cd).toBe(0);

            // No Auto-Potion log entries written.
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
