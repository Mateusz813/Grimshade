/**
 * Atomic E2E — auto-potion combo: flat + pct HP slots both fire (BACKLOG 11.3).
 *
 * Spec: "Auto-potion + auto-spell combinations". This test covers the
 * INTRA-AUTO-POTION combo half (flat HP + pct HP slot together) — the
 * canonical "two HP potions configured" scenario which `tryAutoPotion`
 * processes back-to-back across 4 slots (combatEngine.ts line 957-970).
 *
 * What this proves vs SMOKE 11.2:
 *  - SMOKE 11.2 (`triggers-on-hp-threshold-via-engine.spec.ts`) proves
 *    flat HP slot fires alone. It does NOT prove pct slot also fires
 *    (default config has pct DISABLED).
 *  - This test enables BOTH slots + seeds BOTH potion types, then
 *    asserts BOTH fire in one `tryAutoPotion` call. Critical regression
 *    guard: someone could refactor `useAutoPotionSlot` and accidentally
 *    early-return after the first slot fires, leaving the pct slot
 *    silently broken.
 *
 * Strategy:
 *  1. Seed Knight lvl 5 + 5× hp_potion_sm + 5× hp_potion_great (default
 *     ids for the two HP slots — pre-configured in defaults at
 *     settingsStore.ts lines 111 + 119).
 *  2. Login + Town hydration.
 *  3. Stage combat with playerCurrentHp = 30/120 = 25% — BELOW both
 *     thresholds (default flat threshold 50, default pct threshold 40).
 *  4. Enable PCT HP slot via `setAutoPotionPctHpEnabled(true)` (default
 *     is `false`).
 *  5. Clear cooldowns (separate cooldowns for flat vs pct — flat uses
 *     hpPotionCooldown, pct uses pctHpCooldown — so they don't gate
 *     each other).
 *  6. Call `tryAutoPotion(30, 120, 30, 30)` once.
 *  7. Assert:
 *     - Both consumables decrement: hp_potion_sm 5->4, hp_potion_great 5->4.
 *     - playerCurrentHp = 30 + 50 (flat) + floor(120 * 20 / 100) = 30
 *       (pct heal) = 30 + 50 + 24 = 104 (still under cap of 120).
 *     - BOTH cooldowns now set: hpPotionCooldown > 0, pctHpCooldown > 0.
 *     - TWO Auto-Potion log entries.
 *
 * Why HP not MP:
 *  Symmetry — flat HP / pct HP is the dominant combat protection set.
 *  MP equivalent (flat MP + pct MP) is structurally identical code path
 *  (same useAutoPotionSlot function, different cooldown bucket) — would
 *  be a near-duplicate test, low ROI vs separate "MP combo" test that
 *  exercises a different store path.
 *
 * What we DON'T test (kept for sibling/future tests):
 *  - Threshold ordering — what if flat threshold > pct threshold AND HP
 *    is between them? Each slot reads its own threshold independently
 *    (line 915 -> `valPct > threshold` skip). Already covered by 11.2
 *    proving flat fires; pct just fires under its own threshold here.
 *  - "Healed past max" — when curHp + heal > maxHp, healPlayerHp caps
 *    at maxHp (combatStore.ts line 274 `Math.min(maxHp, base + add)`).
 *    We pick numbers that fit comfortably so a heal-cap regression
 *    wouldn't pass silently — 30 + 50 + 24 = 104 < 120.
 *  - Auto-skill combo — that's a different subsystem (skillStore +
 *    castSkill path) and a separate test in BACKLOG 13.6.
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

    test('flat HP + pct HP both fire in one engine tick: both consumables -1, HP healed by combined amount', async ({ page }) => {
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

            // Seed BOTH potion types — hp_potion_sm (default flat slot id)
            // + hp_potion_great (default pct slot id). 5 of each so the
            // single-tick spend leaves headroom for accidental re-fires
            // that we'd then notice in the cleanup count.
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

            // Stage combat + enable pct slot + fire tryAutoPotion + read result.
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

                // Enable the pct HP slot (default is OFF — settingsStore line 115).
                // Flat HP is already enabled by default.
                useSettingsStore.getState().setAutoPotionPctHpEnabled(true);

                const rat = engine.getAllMonsters().find((m) => m.id === 'rat');
                if (!rat) throw new Error('rat monster missing from registry');

                // Player HP = 30 / 120 = 25%. Below default flat threshold (50)
                // AND below default pct threshold (40). Both slots will fire
                // on the same call.
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

            // Both consumables decremented by exactly 1.
            expect(result.flatCount).toBe(4);
            expect(result.pctCount).toBe(4);

            // HP healed by BOTH: flat 50 + pct floor(120 * 20/100) = 24
            // -> 30 + 50 + 24 = 104. Under cap (120) so no clipping.
            expect(result.playerCurrentHp).toBe(104);

            // Both cooldown buckets engaged — proves both slot's
            // start*Cd fn ran (combatEngine.ts lines 951-954).
            expect(result.hpPotionCooldown).toBeGreaterThan(0);
            expect(result.pctHpCooldown).toBeGreaterThan(0);

            // TWO Auto-Potion log lines — one per slot.
            const autoPotionLogs = result.sessionLog.filter((l) =>
                /\[Auto-Potion\]/.test(l.text),
            );
            expect(autoPotionLogs.length).toBe(2);
            // Sanity that both slots' distinct heal amounts are logged.
            // Flat = +50 HP. Pct = +24 HP (20% of 120).
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
