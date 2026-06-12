/**
 * Atomic E2E — auto-potion cooldown CONTRACT vs equipment / buffs (BACKLOG 11.5).
 *
 * ## Spec interpretation
 *
 * BACKLOG 11.5 ("Auto-potion z różnym EQ (pierścień przyspieszający)") was
 * written assuming a `band_of_quickening`-style ring with an
 * `auto_potion_cooldown_reduction` bonus exists in `src/data/items.json`.
 *
 * As of 2026-05-25 — **no such item exists** and the codebase has no
 * mechanism to read any equipment / buff modifier into
 * `getPotionCooldownMs()`. The relevant call site (`combatEngine.ts` line
 * 946) reads:
 *
 *   const cd = getPotionCooldownMs(elixir.id);
 *   if (cd > 0) startCdFn(cd);
 *
 * And `getPotionCooldownMs` in `src/systems/potionSystem.ts` line 56:
 *
 *   export const getPotionCooldownMs = (potionId: string): number =>
 *     isPctPotionId(potionId) ? PCT_POTION_COOLDOWN_MS : FLAT_POTION_COOLDOWN_MS;
 *
 * Returns `1000` (flat) or `500` (pct) UNCONDITIONALLY — no character /
 * buff / equipment input.
 *
 * Additionally, the shop sells `cd_reduction_elixir` (effect
 * `cooldown_reduction_0.20_30m` -> buff `cooldown_reduction` returns
 * multiplier `0.8` in `buffStore.ts` line 473). But the multiplier is NEVER
 * READ by any combat / potion code path — searched
 * `getBuffMultiplier('cooldown_reduction')` across the codebase, zero hits
 * outside the buffStore declaration. So even the existing "Eliksir
 * Skupienia" doesn't reduce ANY cooldown in practice.
 *
 * ## Synthetic test strategy — pin the CURRENT contract
 *
 * Rather than testing a feature that doesn't exist, this test pins the
 * current behaviour as a regression guard:
 *
 *   1. Without any cooldown-reduction equipment OR buff -> potion cooldown
 *      lands at exactly `FLAT_POTION_COOLDOWN_MS = 1000` after auto-potion
 *      fires.
 *   2. With the `cooldown_reduction` buff active -> potion cooldown STILL
 *      lands at exactly `1000` (the buff doesn't affect potion cooldown,
 *      only spell cooldowns per the elixir's tooltip — though it doesn't
 *      affect those either as of 2026-05-25).
 *
 * The dual-firing inside one `page.evaluate` proves the behaviour is
 * deterministic across runs and isolates the "buff has zero effect on
 * potion CD" branch.
 *
 * ## What this test will catch in the FUTURE
 *
 * When someone implements a real cooldown-reduction mechanism (e.g.
 * `band_of_quickening` ring or wiring the existing `cooldown_reduction`
 * buff into potions), this test WILL break — at which point:
 *   - If the implementation only touches a NEW item bonus (e.g.
 *     `auto_potion_cooldown_reduction` on a ring), the baseline branch
 *     stays green; only update / replace the buff branch.
 *   - If the implementation wires `cooldown_reduction` into potion CD,
 *     the buff branch will fail with the new (reduced) value. Update the
 *     expected value to `1000 × buffMultiplier`.
 *
 * Either way, the failure documents intent ("you changed the potion CD
 * contract — confirm intentional") and prevents accidental regressions.
 *
 * ## Setup
 *
 *  1. Seed Knight on SECONDARY account (per session brief: reduce
 *     contention with parallel agents).
 *  2. Seed 5× `hp_potion_sm` (default flat HP slot id).
 *  3. Login + Town hydration.
 *  4. Run the test inside ONE `page.evaluate`:
 *     a. Stage combat with HP 40/120 (below 50% threshold).
 *     b. Clear cooldowns.
 *     c. Fire `tryAutoPotion(40, 120, 30, 30)` -> snapshot CD (BASELINE).
 *     d. Reset cooldown + HP back to 40, re-seed consumable count.
 *     e. Add `cooldown_reduction` buff to live buffStore.
 *     f. Fire `tryAutoPotion(40, 120, 30, 30)` again -> snapshot CD (WITH_BUFF).
 *  5. Assert:
 *     - baseline_cd === 1000 (FLAT_POTION_COOLDOWN_MS contract).
 *     - with_buff_cd === 1000 (buff has no effect — current behaviour).
 *
 * Cleanup: try/finally + `cleanupCharacterById`.
 */

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
            // 1. Seed Knight lvl 5 on SECONDARY account.
            //    hp_regen/mp_regen=0 so HP doesn't drift between the
            //    stage-combat + tryAutoPotion + snapshot calls.
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

            // 2. Seed 5× hp_potion_sm — default settings.autoPotionHpId
            //    so auto-potion finds this on first try.
            await seedConsumables({
                characterId: created.id,
                counts: { hp_potion_sm: 5 },
            });

            // 3. Login + Town hydration.
            await loginViaUI(page, testUsers.secondary);
            await page.goto('/character-select');
            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await expect(card).toBeVisible({ timeout: 10_000 });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
            await expect(page.locator('.town__char-name')).toHaveText(nick, { timeout: 10_000 });

            // 4. Sanity: consumables hydrated.
            const preCount = await page.evaluate(async () => {
                // @ts-expect-error — dev-time Vite URL not resolvable by tsc
                const mod = await import('/src/stores/inventoryStore.ts');
                const inv = (mod as {
                    useInventoryStore: { getState: () => { consumables: Record<string, number> } };
                }).useInventoryStore.getState();
                return inv.consumables['hp_potion_sm'] ?? 0;
            });
            expect(preCount).toBe(5);

            // 5. Run the dual-fire experiment inside ONE evaluate to
            //    keep all state isolated to a single JS context tick.
            const result = await page.evaluate(async () => {
                // @ts-expect-error — dev-time Vite URL not resolvable by tsc
                const engineMod = await import('/src/systems/combatEngine.ts');
                // @ts-expect-error — dev-time Vite URL not resolvable by tsc
                const combatMod = await import('/src/stores/combatStore.ts');
                // @ts-expect-error — dev-time Vite URL not resolvable by tsc
                const invMod = await import('/src/stores/inventoryStore.ts');
                // @ts-expect-error — dev-time Vite URL not resolvable by tsc
                const cdMod = await import('/src/stores/cooldownStore.ts');
                // @ts-expect-error — dev-time Vite URL not resolvable by tsc
                const buffMod = await import('/src/stores/buffStore.ts');
                // @ts-expect-error — dev-time Vite URL not resolvable by tsc
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

                // --- ROUND 1: BASELINE (no buff, no equipment) -----------
                useCooldownStore.getState().clearAll();
                useBuffStore.getState().clearCharacterBuffs();
                // Reset HP to 40 inside the combat store via fresh init.
                useCombatStore.getState().initCombat(rat, 40, 30, 'normal');
                // Snapshot pre-state for sanity.
                const preCdBaseline = useCooldownStore.getState().hpPotionCooldown;
                const preCountBaseline = useInventoryStore.getState().consumables['hp_potion_sm'] ?? 0;

                // Fire.
                engine.tryAutoPotion(40, 120, 30, 30);

                const baselineCd = useCooldownStore.getState().hpPotionCooldown;
                const baselineCount = useInventoryStore.getState().consumables['hp_potion_sm'] ?? 0;

                // --- ROUND 2: WITH cooldown_reduction buff ---------------
                // Reset state: replenish consumable, clear cooldown, restage HP.
                useInventoryStore.getState().addConsumable('hp_potion_sm', 1);
                useCooldownStore.getState().clearAll();
                useCombatStore.getState().initCombat(rat, 40, 30, 'normal');

                // Apply the cooldown_reduction buff to the live store. This
                // is the EXISTING buff sold as "Eliksir Skupienia" —
                // promises -20% spell CD per shop tooltip (shopStore.ts
                // line 80). buffStore.getBuffMultiplier('cooldown_reduction')
                // returns 0.8 (buffStore line 473) but the multiplier is
                // never read by any combat / potion path as of 2026-05-25.
                // addBuff takes (buff, durationMs). It stamps characterId
                // from useCharacterStore.character?.id (getCharId helper).
                // Realtime timerMode = expiresAt vs now comparison, so a
                // 24h duration keeps the buff active for the whole test.
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

                // Fire.
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

            // 6a. BASELINE sanity: pre-fire state was clean.
            expect(result.preCdBaseline).toBe(0);
            expect(result.preCountBaseline).toBe(5);

            // 6b. BASELINE outcome: potion fired (count decremented) +
            //     cooldown set to EXACTLY 1000 (FLAT_POTION_COOLDOWN_MS).
            //     This is the contract guard — if anyone changes the
            //     constant or wires a new multiplier in, this assertion
            //     breaks and they must confirm intent.
            expect(result.baselineCount).toBe(4);
            expect(result.baselineCd).toBe(1000);

            // 6c. WITH-BUFF sanity: pre-fire state was clean +
            //     `cooldown_reduction` buff was actually registered.
            expect(result.preCdWithBuff).toBe(0);
            expect(result.preCountWithBuff).toBe(5);
            expect(result.buffCount).toBeGreaterThanOrEqual(1);

            // 6d. WITH-BUFF outcome: potion still fired (count decremented)
            //     + cooldown STILL set to EXACTLY 1000. The `cooldown_reduction`
            //     buff has NO effect on potion cooldown — proves the multiplier
            //     declared in buffStore.ts line 473 is currently NOT consumed
            //     by the potion path.
            //
            //     If/when someone wires the buff into potion CD, expect this
            //     value to become 800 (1000 × 0.8) — at which point this
            //     assertion will break and document the intentional change.
            expect(result.withBuffCount).toBe(4);
            expect(result.withBuffCd).toBe(1000);

            // 6e. Cross-comparison: baseline == with-buff (definitive
            //     statement of "buff has no effect on potion CD"). Saves
            //     future readers from inferring the contract from 6b + 6d
            //     separately.
            expect(result.withBuffCd).toBe(result.baselineCd);
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
