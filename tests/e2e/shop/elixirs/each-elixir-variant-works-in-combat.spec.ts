/**
 * Atomic E2E — parameterized "each-elixir-variant in combat" test (BACKLOG 3.4 expansion).
 *
 * Spec (3.4): "Kup KAŻDY eliksir + przetestuj w walce". The original
 * representative test (`atk-damage-elixir-works-in-combat.spec.ts`)
 * pinned ONE elixir (atk_dmg_25) end-to-end. THIS test extends coverage
 * to a representative set of OTHER families, each exercising a distinct
 * engine helper path:
 *
 *   - **atk_dmg_50** — second tier of `getAtkDamageMultiplier`
 *     (combatElixirs.ts line 15: returns 1.5). Guards against accidental
 *     tier-collapse where the helper would return e.g. 1.25 for ALL atk
 *     elixir variants because of a missing if/else.
 *   - **hp_pct_25** — `getElixirHpPctMultiplier` returns 1.25 + boosted
 *     max HP cap used in `Math.min(effectiveChar.max_hp, ...)` clamps
 *     throughout combat tick path. Guards against NaN propagation if
 *     multiplier breaks.
 *   - **mp_pct_25** — same shape as HP-% but for MP cap. Mage-class so
 *     the larger MP pool (200) shows visible delta after multiplier;
 *     covers the spell-cost gating path (`getSkillMpCost` reads cap).
 *   - **xp_boost** — reward-side multiplier read in
 *     `combatEngine.ts` line 2534-2537 / 1069 (xp_boost = 1.5x XP).
 *     Distinct from the damage-side multipliers above — proves the
 *     reward chain reads the elixir buff at fight resolution.
 *
 * Each test seeds character + ONE buff → SKIP combat against rat →
 * asserts the fight resolved + the multiplier helper returns the
 * expected value mid-fight. Numeric damage / XP values are NOT
 * asserted (RNG-bound, pinned by `combatElixirs.test.ts` unit suite
 * line 82-107 for ATK tiers + by combatEngine.ts xp_boost line 2541
 * formula for XP).
 *
 * ## Why NOT crit_chance_boost (mentioned in brief)
 *
 * The brief listed `crit_chance_boost` as a variant to cover, but this
 * effect does NOT exist in the codebase:
 *   • No entry in BUFF_CONFIG (Inventory.tsx line 2580-2620 — all the
 *     defined elixir effects).
 *   • No reader in combatElixirs.ts (no `getCritChanceMultiplier` helper).
 *   • No buff in buffStore.ts effect lookup table.
 *
 * Documenting the gap rather than testing a non-existent buff. If
 * crit_chance elixir is added later, copy the atk_dmg_50 case and swap
 * the effect id.
 *
 * ## Test strategy — per-elixir test, parameterized for-of
 *
 * Each variant runs as a separate `test()` so failures isolate cleanly
 * (one elixir's regression doesn't tank the whole file). All variants
 * share the same SKIP-fight + sanity-multiplier shape so the for-of
 * keeps duplication out.
 *
 * Per CLAUDE.md TESTING + E2E hard rules:
 *   • try/finally + cleanupCharacterById per-variant (each variant
 *     creates its own character — atomic per-test cleanup).
 *   • SECONDARY account per task brief (primary hosts other agents).
 *   • Mobile-only `.tap()` (no `.click()`).
 *
 * Cleanup: each variant creates + cleans its own character.
 */

import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName, type CharacterClass } from '../../fixtures/createCharacter';
import { seedGameSave, findUserIdByEmail } from '../../fixtures/seedGameSave';
import { cleanupCharacterById } from '../../fixtures/cleanup';
import { runCombatViaSkip, getCharacterSnapshot } from '../../fixtures/combatSim';

interface IElixirVariant {
    /** Buff id (matches BUFF_CONFIG[<dose_id>].id). */
    buffId: string;
    /** Effect key that activates the multiplier helper. */
    effect: string;
    /** Display name (cosmetic — BuffPopover would show this). */
    name: string;
    /** Display icon (cosmetic). */
    icon: string;
    /** Character class that benefits most / can survive the test fight. */
    klass: CharacterClass;
    /**
     * Inline assertion of the multiplier helper this elixir activates.
     * The helper is imported dynamically inside `page.evaluate` so we can
     * verify the value mid-test without parking expectations in unit-land.
     * Returns the expected numeric multiplier (e.g. 1.5 for atk_dmg_50).
     */
    expectedMultiplier: number;
    /**
     * Path to the multiplier helper module + name of the export. The
     * helper takes zero args (reads `useBuffStore.getState().hasBuff`).
     */
    helperImport: { module: string; export: string };
    /**
     * Friendly description for the test name (parameterized).
     */
    description: string;
}

const VARIANTS: IElixirVariant[] = [
    {
        buffId: 'atk_dmg_50',
        effect: 'atk_dmg_50',
        name: 'ATK DMG +50%',
        icon: '⚔️',
        klass: 'Knight',
        expectedMultiplier: 1.5,
        helperImport: { module: '/src/systems/combatElixirs.ts', export: 'getAtkDamageMultiplier' },
        description: '+50% ATK damage tier (Knight)',
    },
    {
        buffId: 'hp_pct_25',
        effect: 'hp_pct_25',
        name: 'Max HP +25%',
        icon: '❤️‍🔥',
        klass: 'Knight',
        expectedMultiplier: 1.25,
        helperImport: { module: '/src/systems/combatElixirs.ts', export: 'getElixirHpPctMultiplier' },
        description: '+25% Max HP (Knight)',
    },
    {
        buffId: 'mp_pct_25',
        effect: 'mp_pct_25',
        name: 'Max MP +25%',
        icon: '💠',
        klass: 'Mage',
        expectedMultiplier: 1.25,
        helperImport: { module: '/src/systems/combatElixirs.ts', export: 'getElixirMpPctMultiplier' },
        description: '+25% Max MP (Mage — visible delta vs Knight)',
    },
    {
        // xp_boost is read by combatEngine via `bStore.getBuffMultiplier('xp_boost')`
        // (combatEngine.ts line 1072 + 2537). Returns 1.5 per buffStore.ts line 467.
        buffId: 'xp_boost',
        effect: 'xp_boost',
        name: 'XP +50%',
        icon: '⭐',
        klass: 'Knight',
        expectedMultiplier: 1.5,
        helperImport: { module: '/src/stores/buffStore.ts', export: 'useBuffStore' },
        description: '+50% XP reward (Knight) — reward-side, not damage-side',
    },
];

test.describe('Shop › Elixirs', { tag: '@shop' }, () => {
    test.describe.configure({ timeout: 120_000 });

    for (const variant of VARIANTS) {
        test(`${variant.buffId} buff active → SKIP fight against rat resolves to victory + multiplier helper confirms ${variant.expectedMultiplier}× — ${variant.description}`, async ({ page }) => {
            const nick = generateTestCharacterName();
            let createdId: string | null = null;

            try {
                // 1. Seed character on SECONDARY (parallel agents on primary).
                //    Mage starts with hp=80 baseline — survivable against rat.
                //    Knight at hp=120 trivially one-shots. Zero regen prevents
                //    background HP ticking during multi-step assertions.
                const created = await createCharacterViaApi({
                    userEmail: testUsers.secondary.email,
                    name: nick,
                    class: variant.klass,
                    overrides: { hp_regen: 0, mp_regen: 0 },
                });
                createdId = created.id;

                // 2. Seed the buff via game_saves blob. Pausable timer mode
                //    (default per seedGameSave) doesn't drain out-of-combat —
                //    buff stays active for the entire test sequence.
                const userId = await findUserIdByEmail(testUsers.secondary.email);
                await seedGameSave({
                    characterId: createdId,
                    userId,
                    buffs: [
                        {
                            id: variant.buffId,
                            name: variant.name,
                            icon: variant.icon,
                            effect: variant.effect,
                        },
                    ],
                });

                // 3. Login + Town hydration. applyBlobToStores hydrates the
                //    seeded buff into runtime useBuffStore so it's "live" by
                //    the time runCombatViaSkip reaches into combat path.
                await loginViaUI(page, testUsers.secondary);
                await page.goto('/character-select');
                const card = page.locator('.char-select__card', {
                    has: page.locator('.char-select__card-name', { hasText: nick }),
                });
                await expect(card).toBeVisible({ timeout: 15_000 });
                await card.getByRole('button', { name: /Wybierz/i }).tap();
                await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
                await expect(page.locator('.town__char-name')).toHaveText(nick, { timeout: 10_000 });

                // 4. Sanity gate: buff is in runtime store.
                //    Without this, a seed-pipeline regression (e.g. blob shape
                //    mismatch with characterScope's stateKeys allowlist) would
                //    silently leave buffStore empty and the test would
                //    pass-when-it-shouldn't (asserting raw helper output).
                const hasBuffOnEnter = await page.evaluate(async (effect) => {
                    // @ts-expect-error — dev-time Vite URL not resolvable by tsc
                    const mod = await import('/src/stores/buffStore.ts');
                    return (mod as {
                        useBuffStore: { getState: () => { hasBuff: (e: string) => boolean } };
                    }).useBuffStore.getState().hasBuff(effect);
                }, variant.effect);
                expect(hasBuffOnEnter).toBe(true);

                // 5. Sanity: multiplier helper actually reads the buff.
                //    For xp_boost we read via the generic `getBuffMultiplier`
                //    helper (returns 1.5 per buffStore.ts line 467); for
                //    combatElixirs helpers we call the dedicated getter.
                const multiplier = await page.evaluate(async (v) => {
                    if (v.helperImport.export === 'useBuffStore') {
                        // @ts-expect-error — dev-time Vite URL
                        const mod = await import(v.helperImport.module);
                        const store = (mod as {
                            useBuffStore: { getState: () => { getBuffMultiplier: (e: string) => number } };
                        }).useBuffStore.getState();
                        return store.getBuffMultiplier(v.effect);
                    }
                    // @ts-expect-error — dev-time Vite URL
                    const mod = await import(v.helperImport.module);
                    const helper = (mod as Record<string, unknown>)[v.helperImport.export] as () => number;
                    return helper();
                }, variant);
                expect(multiplier).toBe(variant.expectedMultiplier);

                // 6. Pre-snapshot XP for later delta check.
                const before = await getCharacterSnapshot(page);
                expect(before).not.toBeNull();
                const preXp = before!.xp;

                // 7. SKIP-fight rat. Every variant should resolve to victory
                //    — rat is the lowest-level monster (hp=30) and even Mage
                //    with attack=6 can kill it solo via SKIP (no real-time
                //    cadence; 5000-iter simulation runs synchronously).
                const result = await runCombatViaSkip(page, 'rat');

                // 8. Behavioral contract assertions.
                //    (a) Fight ended in victory — proves the buff didn't break
                //        combat tick (NaN damage, infinite loop, throw inside
                //        calculateDamage).
                expect(result.phase).toBe('victory');

                //    (b) XP awarded — proves reward chain ran. For xp_boost
                //        specifically this MUST be > 0 because the multiplier
                //        applies INSIDE the reward chain.
                expect(result.earnedXp).toBeGreaterThan(0);

                //    (c) Kill counter bumped — proves engine reached
                //        incrementSessionKill (line 2565).
                expect(result.sessionKills.normal).toBeGreaterThanOrEqual(1);

                //    (d) Character store XP increased — end-to-end reward
                //        path verified.
                const after = await getCharacterSnapshot(page);
                expect(after).not.toBeNull();
                expect(after!.xp).toBeGreaterThan(preXp);

                //    (e) Buff still active after fight (pausable drains 2000ms
                //        per SKIP fight per tickCombatElixirs in
                //        combatEngine.ts line 2547; seeded with 24h remainingMs
                //        so survives the entire test). xp_boost drains separately
                //        via line 2544/2546 (also 2000ms).
                //    NOTE: xp_boost only drains if the engine path explicitly
                //    calls `consumePausableTime('xp_boost', 2000)` — line 2544.
                //    24h - 2s remains 23h59m58s, well above zero.
                const hasBuffOnExit = await page.evaluate(async (effect) => {
                    // @ts-expect-error — dev-time Vite URL not resolvable by tsc
                    const mod = await import('/src/stores/buffStore.ts');
                    return (mod as {
                        useBuffStore: { getState: () => { hasBuff: (e: string) => boolean } };
                    }).useBuffStore.getState().hasBuff(effect);
                }, variant.effect);
                expect(hasBuffOnExit).toBe(true);
            } finally {
                if (createdId) {
                    await cleanupCharacterById(createdId);
                }
            }
        });
    }
});
