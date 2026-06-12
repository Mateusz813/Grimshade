/**
 * Atomic E2E — auto-potion cooldown blocks rapid re-trigger then releases
 * after tick (BACKLOG 13.8 derived).
 *
 * Spec: "Spell po cooldownie od razu można klikać" (skill after cooldown
 * immediately castable). Strict interpretation = SKILL bar, but the
 * SAME contract applies to auto-potion: once a potion fires its
 * cooldown bucket is set, repeat-calls within the cooldown window MUST
 * no-op (engine guard at combatEngine.ts line 910 `onCooldown` check),
 * and once the cooldown ticks down to 0 the next call MUST fire.
 *
 * This test proves that contract end-to-end for the HP potion slot:
 *
 *   1. Fire #1 — cooldown=0 (clear state), fires, count 5->4,
 *      cooldown set to 1000ms (FLAT_POTION_COOLDOWN_MS).
 *   2. Fire #2 — IMMEDIATELY after, with cooldown still ~1000ms,
 *      MUST no-op. Count stays 4.
 *   3. `cooldownStore.tick(1000)` — ticks cooldown to 0.
 *   4. Fire #3 — with cooldown=0, MUST fire again. Count 4->3.
 *
 * Why this is the canonical regression guard:
 *  - combatEngine.ts line 910: `if (!enabled || threshold <= 0 || onCooldown) return;`
 *    — the `onCooldown` argument is computed by the caller as
 *    `cd.hpPotionCooldown > 0`. If a future refactor moves the
 *    cooldown check to before `useConsumable` correctly but skips
 *    setting the cooldown at line 933 (`startCdFn(cd)`), this test
 *    would catch it — fires #1 and #2 would BOTH succeed because no
 *    cooldown is set.
 *  - If someone changes `cd > 0` to `cd >= 0`, this test catches it
 *    (fire #3 would no-op because tick(1000) leaves cd at exactly 0
 *    which is still "active" by the new buggy gate).
 *  - If `tick` semantics change (e.g. clamp wrong), this test catches
 *    that — fire #3 needs cd === 0 to succeed.
 *
 * Setup:
 *  - Knight lvl 5, 5× hp_potion_sm. Default settings (flat HP enabled
 *    at threshold 50, id=hp_potion_sm).
 *  - Stage combat with HP=30/120=25% (well below threshold so all
 *    three call attempts SHOULD fire if cooldown allowed).
 *
 * Cleanup: try/finally + cleanupCharacterById.
 */

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

            // Run the three-fire sequence in one page.evaluate so all the
            // store reads/writes are atomic within the same JS turn.
            // Snapshot after each fire so we can assert on the sequence.
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

                // Stage. HP=30 / 120 = 25% — below default threshold (50).
                useCombatStore.getState().initCombat(rat, 30, 30, 'normal');

                // -- FIRE #1 ---------------------------------------------
                engine.tryAutoPotion(30, 120, 30, 30);
                const afterFire1 = {
                    count: useInventoryStore.getState().consumables['hp_potion_sm'] ?? 0,
                    hp: useCombatStore.getState().playerCurrentHp,
                    cd: useCooldownStore.getState().hpPotionCooldown,
                };

                // -- FIRE #2 - immediately after, cooldown active. Reset
                // HP back to 30 so threshold check would still allow fire
                // (otherwise after heal HP would be 80 and threshold
                // check at line 915 would gate, hiding the cooldown gate
                // we're trying to assert).
                useCombatStore.getState().setHps(rat.hp, 30);
                engine.tryAutoPotion(30, 120, 30, 30);
                const afterFire2 = {
                    count: useInventoryStore.getState().consumables['hp_potion_sm'] ?? 0,
                    hp: useCombatStore.getState().playerCurrentHp,
                    cd: useCooldownStore.getState().hpPotionCooldown,
                };

                // -- TICK - advance cooldown to 0.
                // FLAT_POTION_COOLDOWN_MS = 1000, so tick(1000) drops
                // hpPotionCooldown from 1000 -> 0.
                useCooldownStore.getState().tick(1000);
                const afterTick = {
                    cd: useCooldownStore.getState().hpPotionCooldown,
                };

                // -- FIRE #3 - cooldown=0, must fire again.
                useCombatStore.getState().setHps(rat.hp, 30);
                engine.tryAutoPotion(30, 120, 30, 30);
                const afterFire3 = {
                    count: useInventoryStore.getState().consumables['hp_potion_sm'] ?? 0,
                    hp: useCombatStore.getState().playerCurrentHp,
                    cd: useCooldownStore.getState().hpPotionCooldown,
                };

                return { afterFire1, afterFire2, afterTick, afterFire3 };
            });

            // Fire #1: fired — count 5->4, HP 30->80 (30+50), cooldown set.
            expect(result.afterFire1.count).toBe(4);
            expect(result.afterFire1.hp).toBe(80);
            expect(result.afterFire1.cd).toBeGreaterThan(0);

            // Fire #2: BLOCKED by cooldown — count unchanged at 4, HP
            // unchanged at 30 (we reset HP before this fire to ensure
            // threshold check would PASS — only cooldown gate is left
            // to do the blocking).
            expect(result.afterFire2.count).toBe(4);
            expect(result.afterFire2.hp).toBe(30);
            // Cooldown is still > 0 (we didn't tick).
            expect(result.afterFire2.cd).toBeGreaterThan(0);

            // After tick(1000): cooldown drops to 0 (clamped at 0 by
            // cooldownStore.ts line 51 `Math.max(0, ...)`).
            expect(result.afterTick.cd).toBe(0);

            // Fire #3: fired again — count 4->3, HP 30->80, cooldown reset.
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
