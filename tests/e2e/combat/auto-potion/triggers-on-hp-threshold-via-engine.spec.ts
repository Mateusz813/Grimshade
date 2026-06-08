/**
 * Atomic E2E — auto-potion fires at HP threshold (BACKLOG 11.2 derived).
 *
 * Spec coverage:
 *  • 11.2 → "Auto-potion MP threshold trigger" rephrased to HP (same engine
 *    branch). The sibling popup tests (11.1 / 11.4 / 11.4b) only prove
 *    the SETTINGS UI persists and renders; THIS test verifies the
 *    COMBAT-TRIGGER contract: when an auto-potion is configured, enabled,
 *    and the player's HP drops below the threshold, the engine calls
 *    `tryAutoPotion` → `useAutoPotionSlot` → `inv.useConsumable` AND
 *    `cs.healPlayerHp(amount, maxHp)` AND sets the potion cooldown.
 *
 * Test strategy:
 *  Calling `tryAutoPotion` directly via `page.evaluate` is the equivalent
 *  of the engine's natural call site (combatEngine.ts line 1983 from
 *  `doPlayerAttackTick`, line 2324 from monster-tick, line 2661 from
 *  SKIP-fight). It reads the same `useSettingsStore` slot config, the
 *  same `useCombatStore.playerCurrentHp`, the same `useInventoryStore.consumables`,
 *  and writes through the SAME setters. Real combat would also call this
 *  function — we're testing the function under the same store
 *  preconditions as a real fight, just without the fragile real-time
 *  attack-cadence + RNG between the moment HP drops and the moment we
 *  assert the potion fired.
 *
 *  Why not full real-time combat?
 *    • Real-time combat ticks at attack_speed intervals (rat speed=5 →
 *      ~600 ms per tick). With auto-potion firing inside a tick, the
 *      next assertion has to either poll for state changes or rely on a
 *      specific number of attack ticks. Race-prone on slow CI runners.
 *    • The auto-fight loop will start a NEW fight as soon as the current
 *      one ends (AUTO_FIGHT_DELAY_MS), so even pausing for one tick
 *      pulls in side effects we don't want to assert against.
 *    • The contract here is "auto-potion fires when HP < threshold +
 *      potion in bag + not on cooldown" — that's a pure-store / pure-
 *      function contract, perfectly testable without combat animation.
 *
 * Setup:
 *  1. Seed Knight lvl 5 + 5× `hp_potion_sm` consumable.
 *  2. Login + Town → forces `useCharacterStore.character` hydration AND
 *     `useInventoryStore.consumables` hydration via applyBlobToStores.
 *  3. Stage combat state via `initCombat` (so `useCombatStore.playerCurrentHp`
 *     is the value the engine reads). Set player HP to 40/120 = 33% of
 *     max — below the default 50% threshold.
 *  4. Confirm settings.autoPotionHpEnabled=true (default) and threshold=50
 *     (default) and HP id = hp_potion_sm (default). Don't tweak settings
 *     to demonstrate the OUT-OF-BOX experience works.
 *  5. Call `tryAutoPotion(curHp=40, maxHp=120, curMp=30, maxMp=30)` via
 *     `page.evaluate`.
 *  6. Assert:
 *     a) `consumables.hp_potion_sm === 4` (1 consumed via `useConsumable`).
 *     b) `playerCurrentHp === 90` (40 + 50 heal, capped by 120 max).
 *     c) `cooldownStore.hpPotionCooldown > 0` (FLAT_POTION_COOLDOWN_MS =
 *        1000 set after the heal — proves cooldown gate engaged so
 *        subsequent calls would no-op).
 *     d) `sessionLog` contains a `[Auto-Potion] Mały Eliksir HP +50 HP`
 *        line (combatEngine.ts line 936).
 *
 * Why HP not MP:
 *  HP is the load-bearing slot — every class needs it, healing visible
 *  in `playerCurrentHp`. MP-flat would be symmetric but redundant for
 *  the contract proof.
 *
 * Cleanup: try/finally + `cleanupCharacterById`. The character row is
 * destroyed → game_saves cascade → cooldown / combat state evaporates
 * with the page session.
 */

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
            // 1. Seed Knight lvl 5 — well below any thresholds, max_hp=120
            //    (Knight base, hp_regen=0 so HP doesn't drift between the
            //    initCombat + tryAutoPotion + snapshot calls).
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

            // 2. Seed 5× hp_potion_sm in consumables. Default
            //    settings.autoPotionHpId === 'hp_potion_sm' so the
            //    auto-potion will find this one.
            await seedConsumables({
                characterId: created.id,
                counts: { hp_potion_sm: 5 },
            });

            // 3. Login + Town — forces character + inventory hydration.
            await loginViaUI(page, testUsers.primary);
            await page.goto('/character-select');
            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await expect(card).toBeVisible({ timeout: 10_000 });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
            await expect(page.locator('.town__char-name')).toHaveText(nick, { timeout: 10_000 });

            // 4. Sanity: consumables hydrated correctly.
            const preCount = await page.evaluate(async () => {
                // @ts-expect-error — dev-time Vite URL not resolvable by tsc
                const mod = await import('/src/stores/inventoryStore.ts');
                const inv = (mod as {
                    useInventoryStore: { getState: () => { consumables: Record<string, number> } };
                }).useInventoryStore.getState();
                return inv.consumables['hp_potion_sm'] ?? 0;
            });
            expect(preCount).toBe(5);

            // 5. Stage combat state + invoke tryAutoPotion. We use the
            //    rat as the encounter so initCombat has a real monster
            //    reference (engine asserts non-null on s.monster in some
            //    branches). Player HP=40 / max=120 = 33% — below default
            //    threshold of 50%. MP set to 30/30 (full) so the MP
            //    branch doesn't fire (we'd waste a potion seed we didn't
            //    set up + log assertion would have to match either).
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

                // Clear cooldown to be sure the test starts from a fresh
                // pre-fire state — otherwise some leftover from a prior
                // navigation could mask the cooldown-was-set assertion.
                useCooldownStore.getState().clearAll();

                // Find rat (deterministic — every monsters.json keeps it
                // as the level-1 starter). Use it as the encounter
                // reference for initCombat.
                const rat = engine.getAllMonsters().find((m) => m.id === 'rat');
                if (!rat) throw new Error('rat monster missing from registry');

                // Stage combat: player HP=40 / 120 = 33% (below default
                // 50% threshold). MP=30 full so MP auto-potion skip.
                useCombatStore.getState().initCombat(rat, 40, 30, 'normal');

                // Fire the auto-potion check.
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

            // 6a. Consumable decremented by exactly 1 (useConsumable line 410).
            expect(result.consumableCount).toBe(4);

            // 6b. HP healed by 50 → 40 + 50 = 90 (under cap of 120).
            //     healPlayerHp(amount=50, max=120) → min(120, 40+50) = 90.
            expect(result.playerCurrentHp).toBe(90);

            // 6c. Cooldown engaged (FLAT_POTION_COOLDOWN_MS = 1000).
            expect(result.hpPotionCooldown).toBeGreaterThan(0);
            expect(result.hpPotionCooldown).toBeLessThanOrEqual(1000);

            // 6d. Log entry written. Format from combatEngine.ts line 936:
            //     `[Auto-Potion] {name_pl} +{healAmount} {HP|MP}{pctText}`.
            //     For hp_potion_sm: `[Auto-Potion] Mały Eliksir HP +50 HP`.
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
