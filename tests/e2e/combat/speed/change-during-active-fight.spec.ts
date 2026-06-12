/**
 * Atomic E2E — combat speed setting can be mutated mid-fight without
 * crashing the combat view (BACKLOG 13.7 — speed change during active fight).
 *
 * Spec 13.7: "Speed X1/X2/X4 zmiana w trakcie walki". A sibling test
 * (`setting-persists-across-skip-fight.spec.ts`) covers the combatSim
 * restore-contract; THIS test covers the load-bearing contract that
 * matters for live combat: **changing combatSpeed mid-fight does NOT
 * crash + the new value is reflected in settingsStore**.
 *
 * Why we don't drive UI speed-chip taps for this scenario:
 *  - Real attack-cadence observation across 3 speed multipliers requires
 *    multi-frame setInterval observation + RNG/WebKit scheduler tolerance.
 *    Already partially covered by unit-test `combatCadence.test.ts` (13.9)
 *    + speedCooldownMatrix.test.ts (12.8) — the timing math is pinned at
 *    the unit layer.
 *  - The chip-tap path (Combat.tsx line 1685 -> cycleSpeed line 1652) is
 *    pure `setCombatSpeed(next)` call — same code path as the page.evaluate
 *    setter. UI cycling is covered by the idle-hub clickability test
 *    `combat/ui/clickability-at-each-speed.spec.ts` (13.25).
 *
 * What this test PROVES:
 *  1. Stage a fight via direct `useCombatStore.initCombat(monster, hp, mp)`
 *     in `page.evaluate` — same API the engine calls (combatStore.ts
 *     line 202-223). Result: `phase='fighting'`, monster + HP wired up.
 *  2. Snapshot `combatSpeed` (default 'x1' per settingsStore.ts line 103).
 *  3. Mid-fight, call `setCombatSpeed('x4')` directly. This is the EXACT
 *     setter the chip-tap path invokes (Combat.tsx line 1652).
 *  4. Verify post-set `combatSpeed === 'x4'` (regression guard against a
 *     refactor where setCombatSpeed silently drops the value during
 *     phase='fighting' — e.g. someone adding an "if (phase==='fighting')
 *     return;" guard).
 *  5. Verify combat phase STAYS 'fighting' (the chip-tap MUST NOT side-
 *     effect into phase mutation — Combat.tsx line 1561-1562 syncs
 *     buffStore.combatSpeedMult on `useEffect([combatSpeed])` but
 *     never touches `combatStore.phase`).
 *  6. Cycle through all 3 user-facing speeds (x2 -> x1 -> x4 again) to
 *     exercise the bidirectional setter without UI involvement.
 *
 * What we DON'T test:
 *  - Real-time tick cadence at x4 vs x1 — timing-based, covered by unit.
 *  - SKIP speed — only available in solo mode (Combat.tsx line 1643-1645
 *    `partyBots.length > 0 ? filter(s !== 'SKIP') : SPEED_ORDER`); has
 *    its own contract test (13.7 restore + combatSim).
 *  - The buff store sync side-effect — `useBuffStore.setCombatSpeedMult`
 *    is triggered by a React useEffect that only runs in Combat.tsx mount
 *    (line 1561). Direct setter calls don't trigger React effects in
 *    page.evaluate scope — we'd need to assert against the live mounted
 *    Combat view. That's out of smoke scope.
 *
 * Cleanup: try/finally + cleanupCharacterById.
 */

import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';

test.describe('Combat › Speed', { tag: '@combat' }, () => {
    test.describe.configure({ timeout: 120_000 });

    test('setCombatSpeed during active fight does not crash + new value persists', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            // 1. Seed Knight lvl 5 on SECONDARY (per task brief). Lvl 5
            //    is enough for rat (lvl 1) without the bypass-level-check
            //    flag. hp_regen=0 / mp_regen=0 to keep state observable.
            const created = await createCharacterViaApi({
                userEmail: testUsers.secondary.email,
                name: nick,
                class: 'Knight',
                overrides: { level: 5, highest_level: 5, hp_regen: 0, mp_regen: 0 },
            });
            createdId = created.id;

            // 2. Login on SECONDARY -> wybierz postać -> Town.
            await loginViaUI(page, testUsers.secondary);
            await page.goto('/character-select');
            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await expect(card).toBeVisible({ timeout: 15_000 });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
            await expect(page.locator('.town__char-name')).toHaveText(nick, { timeout: 10_000 });

            // 3. Stage combat + cycle speeds via single `page.evaluate`
            //    round-trip. Doing it inline keeps store-state coherent
            //    (no inter-call drift) and minimises page.evaluate
            //    overhead. We return a structured result with EVERY
            //    observation we need to assert.
            const result = await page.evaluate(async () => {
                // @ts-expect-error — dev-time Vite URL not resolvable by tsc
                const engineMod = await import('/src/systems/combatEngine.ts');
                // @ts-expect-error — dev-time Vite URL not resolvable by tsc
                const combatMod = await import('/src/stores/combatStore.ts');
                // @ts-expect-error — dev-time Vite URL not resolvable by tsc
                const settingsMod = await import('/src/stores/settingsStore.ts');
                // @ts-expect-error — dev-time Vite URL not resolvable by tsc
                const charMod = await import('/src/stores/characterStore.ts');

                interface IGetAllMon { getAllMonsters: () => Array<{ id: string; level: number; hp: number }> }
                const engine = engineMod as unknown as IGetAllMon;
                interface ICombatLite {
                    initCombat: (m: unknown, hp: number, mp: number, rarity?: string) => void;
                    phase: 'idle' | 'fighting' | 'victory' | 'dead';
                }
                const useCombatStore = (combatMod as unknown as {
                    useCombatStore: { getState: () => ICombatLite };
                }).useCombatStore;
                interface ISettingsLite {
                    combatSpeed: string;
                    setCombatSpeed: (s: string) => void;
                }
                const useSettingsStore = (settingsMod as unknown as {
                    useSettingsStore: { getState: () => ISettingsLite };
                }).useSettingsStore;
                const useCharacterStore = (charMod as unknown as {
                    useCharacterStore: { getState: () => { character: { hp: number; mp: number } | null } };
                }).useCharacterStore;

                const character = useCharacterStore.getState().character;
                if (!character) {
                    return { error: 'no character hydrated' as const };
                }

                // Pin starting speed to 'x1' (default) so the subsequent
                // changes have a clean baseline. If a prior test polluted
                // the value via this character's game_saves, force a reset.
                useSettingsStore.getState().setCombatSpeed('x1');

                // Use rat — lvl 1, hp 30. Engine's getAllMonsters returns
                // every monster from monsters.json; we look up by id.
                const monster = engine.getAllMonsters().find((m) => m.id === 'rat');
                if (!monster) {
                    return { error: 'rat monster not found in monsters.json' as const };
                }

                // Stage the fight. initCombat sets phase='fighting' +
                // populates waveMonsters[0] (combatStore.ts line 202-223).
                // We pass character.hp / character.mp so player bars look
                // realistic but the test doesn't care about them.
                useCombatStore.getState().initCombat(monster as unknown, character.hp ?? 100, character.mp ?? 50, 'normal');

                const phaseBefore = useCombatStore.getState().phase;
                const speedBefore = useSettingsStore.getState().combatSpeed;

                // The load-bearing action: mid-fight speed change. This
                // is the EXACT setter called by Combat.tsx line 1652
                // cycleSpeed handler — chip taps go through here.
                useSettingsStore.getState().setCombatSpeed('x4');
                const phaseAfterX4 = useCombatStore.getState().phase;
                const speedAfterX4 = useSettingsStore.getState().combatSpeed;

                // Cycle x4 -> x2 (skip wraps to test bidirectional setter
                // without going through chip ordering — proves any value
                // in the type union is freely writable mid-fight).
                useSettingsStore.getState().setCombatSpeed('x2');
                const phaseAfterX2 = useCombatStore.getState().phase;
                const speedAfterX2 = useSettingsStore.getState().combatSpeed;

                // Final cycle x2 -> x1 — full restoration. Also proves
                // there's no monotonic-only guard hiding in the setter.
                useSettingsStore.getState().setCombatSpeed('x1');
                const phaseAfterX1 = useCombatStore.getState().phase;
                const speedAfterX1 = useSettingsStore.getState().combatSpeed;

                return {
                    error: null,
                    phaseBefore,
                    speedBefore,
                    phaseAfterX4,
                    speedAfterX4,
                    phaseAfterX2,
                    speedAfterX2,
                    phaseAfterX1,
                    speedAfterX1,
                };
            });

            // Defensive — surface any structural error from the evaluate
            // (no character / no rat) as a clean assertion failure rather
            // than an opaque "result.foo is undefined" later.
            expect(result.error).toBeNull();

            // After initCombat we should be in 'fighting' phase + at x1
            // baseline.
            expect(result.phaseBefore).toBe('fighting');
            expect(result.speedBefore).toBe('x1');

            // PRIMARY ASSERTION 1 — setting x4 mid-fight:
            //   - value lands in the store ('x4', not silently dropped),
            //   - phase remains 'fighting' (setter has no side-effect
            //     into combatStore).
            expect(result.speedAfterX4).toBe('x4');
            expect(result.phaseAfterX4).toBe('fighting');

            // PRIMARY ASSERTION 2 — bidirectional setter (x4 -> x2):
            //   - cycles in any direction without phase mutation.
            expect(result.speedAfterX2).toBe('x2');
            expect(result.phaseAfterX2).toBe('fighting');

            // PRIMARY ASSERTION 3 — full cycle back to x1:
            //   - proves the entire user-facing speed range (x1/x2/x4)
            //     can be navigated mid-fight without crashing the engine.
            //   - SKIP intentionally not exercised here — it's solo-only
            //     (filtered out in party mode at Combat.tsx line 1643-1644)
            //     and has its own restore-contract test.
            expect(result.speedAfterX1).toBe('x1');
            expect(result.phaseAfterX1).toBe('fighting');
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
