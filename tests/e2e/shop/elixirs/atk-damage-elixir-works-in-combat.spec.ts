/**
 * Atomic E2E — representative elixir-in-combat test (BACKLOG 3.4 partial).
 *
 * Spec (3.4): "Kup KAŻDY eliksir + przetestuj w walce". Realistic
 * dimensioning: ~30+ elixirs (XP / Skill XP / AS / CD / HP / MP / ATK /
 * SPELL / DEF tiers + transforms). Per task brief: cover ONE representative
 * elixir end-to-end through actual combat rather than parametrize all N —
 * the cardinality is captured by `combatElixirs.test.ts` unit suite which
 * already pins per-effect multipliers (`combatElixirs.test.ts` line 82-107
 * tests all 3 ATK tiers). THIS test proves the runtime contract end-to-end:
 *
 *   - Seed the buff (id = `atk_dmg_25`, effect = `atk_dmg_25`) — same
 *     shape `applyElixirDose` produces when the player drinks
 *     "Eliksir Ataku I" from inventory.
 *   - Run a SKIP-resolve fight against rat. `resolveInstantFight`
 *     (combatEngine.ts line 2460) reads `getAtkDamageMultiplier()` at
 *     line 2490 / 2502 — when our buff is active, that returns 1.25
 *     instead of 1.0. Knight's damage is multiplied per attack roll.
 *   - Verify fight resolves to victory (not stuck in 'fighting' / 'dead')
 *     + XP awarded (proves reward chain ran, which depends on the kill
 *     loop terminating normally with mHp <= 0).
 *
 * ## Why atk_dmg_25 (and not e.g. spell_dmg_25, or one of the XP buffs)
 *
 * `atk_dmg_25` is the simplest representative for the combat-affecting
 * elixir class:
 *   - Direct damage multiplier (1.25× per attack roll) — touches the
 *     hottest code path (calculateDamage every tick).
 *   - Knight uses physical attack — `getAtkDamageMultiplier()` reads our
 *     buff per the buff family it belongs to.
 *   - Pausable buff timer doesn't tick out-of-combat — the buff stays
 *     active throughout the test even between the seed and the SKIP fight.
 *   - minLevel: 1 — pairs with a starting Knight without level prerequisites.
 *
 * `spell_dmg_25` would work but Knight basic attacks don't trigger spell
 * multipliers (would test the multiplier=1.0 path, not the elevated path).
 * `xp_boost` is a reward-side multiplier, not a damage multiplier — proves
 * a different contract (XP elixirs covered separately in 3.13 and the
 * unit tests at combatEngine line 1071-1073).
 *
 * ## Why we don't assert specific damage numbers
 *
 * Knight base damage rolls with RNG (`rollWeaponDamage` + crit chance
 * + dual-wield off-hand if applicable). Asserting "victory with X damage"
 * would be flake-prone — RNG seed isn't deterministic between runs.
 *
 * Instead we assert the BEHAVIORAL CONTRACT:
 *  - `phase === 'victory'` — fight finished, monster died first.
 *  - `earnedXp > 0` — reward chain ran (engine line 2548 `addReward`).
 *  - `sessionKills.normal >= 1` — kill counter bumped (line 2565).
 *  - `characterStore.xp` increased — XP persisted to character store.
 *
 * If the buff broke the combat path (e.g. mult NaN, threw inside
 * calculateDamage, store-write throw), ANY of these would fail. The
 * multiplier's CORRECT NUMERIC VALUE (1.25) is pinned by
 * `combatElixirs.test.ts` line 92-95 unit test — no need to re-verify
 * here at the E2E level.
 *
 * ## Setup
 *
 *  1. Seed Knight lvl 1 on SECONDARY account (per task brief — reduce
 *     contention with parallel agents). hp_regen/mp_regen=0 silences
 *     background ticks.
 *  2. Seed `atk_dmg_25` buff via `seedGameSave({ buffs })`. Pausable
 *     timerMode so it doesn't tick down out-of-combat; 24h remainingMs
 *     so it survives the entire test.
 *  3. Login + Town hydration.
 *  4. Sanity: confirm `useBuffStore.hasBuff('atk_dmg_25')` is TRUE
 *     (proves buff hydrated into runtime store, not just sitting in
 *     game_saves blob).
 *  5. Sanity: confirm `getAtkDamageMultiplier()` returns 1.25 (proves
 *     the buff is being READ by the combat path — guards against the
 *     hashing/lookup bug where buff exists but multiplier helper looks
 *     for wrong effect string).
 *  6. Run `runCombatViaSkip(page, 'rat')` → resolveInstantFight reads
 *     the multiplier mid-loop and applies it to every attack roll.
 *  7. Assert victory + XP delta + kill counter.
 *
 * Cleanup: try/finally + `cleanupCharacterById`.
 */

import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { seedGameSave, findUserIdByEmail } from '../../fixtures/seedGameSave';
import { cleanupCharacterById } from '../../fixtures/cleanup';
import { runCombatViaSkip, getCharacterSnapshot } from '../../fixtures/combatSim';

test.describe('Shop › Elixirs', { tag: '@shop' }, () => {
    test.describe.configure({ timeout: 90_000 });

    test('atk_dmg_25 buff active → SKIP fight against rat resolves to victory + rewards land + multiplier reads 1.25', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            // 1. Seed Knight lvl 1 on SECONDARY (parallel-agent contention).
            const created = await createCharacterViaApi({
                userEmail: testUsers.secondary.email,
                name: nick,
                class: 'Knight',
                overrides: { hp_regen: 0, mp_regen: 0 },
            });
            createdId = created.id;

            // 2. Seed buff via game_saves blob. id matches
            //    BUFF_CONFIG[atk_dmg_25_15m].id (Inventory.tsx line 2600).
            //    Pausable + 24h remainingMs so the buff is active in/out
            //    of combat (pausable buffs only drain DURING combat — but
            //    rat fights are sub-second under SKIP, so even pausable
            //    drain wouldn't expire mid-fight).
            const userId = await findUserIdByEmail(testUsers.secondary.email);
            await seedGameSave({
                characterId: createdId,
                userId,
                buffs: [
                    {
                        id: 'atk_dmg_25',
                        name: 'ATK DMG +25%',
                        icon: '⚔️',
                        effect: 'atk_dmg_25',
                        // Defaults: timerMode='pausable', remainingMs=24h,
                        // expiresAt=now+24h. Pausable means no real-time
                        // drain out of combat → assertions are race-free.
                    },
                ],
            });

            // 3. Login + Town hydration. The applyBlobToStores call
            //    re-populates useBuffStore with the seeded buff.
            await loginViaUI(page, testUsers.secondary);
            await page.goto('/character-select');
            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await expect(card).toBeVisible({ timeout: 10_000 });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
            await expect(page.locator('.town__char-name')).toHaveText(nick, { timeout: 10_000 });

            // 4. Sanity: buff hydrated into runtime store.
            //    `hasBuff('atk_dmg_25')` checks both timerMode flavors
            //    and characterId match (buffStore line 451-462).
            const hasBuffOnEnter = await page.evaluate(async () => {
                // @ts-expect-error — dev-time Vite URL not resolvable by tsc
                const mod = await import('/src/stores/buffStore.ts');
                return (mod as {
                    useBuffStore: { getState: () => { hasBuff: (e: string) => boolean } };
                }).useBuffStore.getState().hasBuff('atk_dmg_25');
            });
            expect(hasBuffOnEnter).toBe(true);

            // 5. Sanity: combat multiplier helper actually reads our buff.
            //    Guards against an "effect string mismatch" regression
            //    (e.g. buff seeded with 'atk_dmg_25' but helper looks for
            //    'atk_dmg_25_15m'). Per `combatElixirs.ts` line 16:
            //    `if (b.hasBuff('atk_dmg_25')) return 1.25;`
            const multiplier = await page.evaluate(async () => {
                // @ts-expect-error — dev-time Vite URL not resolvable by tsc
                const mod = await import('/src/systems/combatElixirs.ts');
                return (mod as { getAtkDamageMultiplier: () => number }).getAtkDamageMultiplier();
            });
            expect(multiplier).toBe(1.25);

            // 6. Pre-snapshot character XP for delta verification.
            const before = await getCharacterSnapshot(page);
            expect(before).not.toBeNull();
            const preXp = before!.xp;

            // 7. SKIP-fight rat. resolveInstantFight reads the multiplier
            //    via `getAtkDamageMultiplier() * getTransformDmgMultiplier()`
            //    (combatEngine.ts line 2490 / 2502) and applies it per
            //    attack roll. Knight one-shots rat at base damage; with
            //    1.25× the kill is even more certain — phase=victory.
            const result = await runCombatViaSkip(page, 'rat');

            // 8. Behavioural contract assertions.
            //    a) Fight ended in victory (not stuck or dead) — proves
            //       the elixir multiplier didn't break the combat tick
            //       (e.g. NaN damage, infinite loop, throw inside
            //       calculateDamage).
            expect(result.phase).toBe('victory');

            //    b) XP awarded — proves reward chain ran (engine line
            //       2548 addReward + 2549 addXp). If the kill loop
            //       terminated abnormally (e.g. iter ran out before mob
            //       died), earnedXp would be 0.
            expect(result.earnedXp).toBeGreaterThan(0);

            //    c) Kill counter bumped — proves engine reached
            //       incrementSessionKill (line 2565). Independent of
            //       reward stack — catches "rewards skipped but kill
            //       counted" inconsistency.
            expect(result.sessionKills.normal).toBeGreaterThanOrEqual(1);

            //    d) Character store XP increased — proves engine.addXp
            //       persisted through to characterStore (not just to
            //       combatStore.earnedXp accumulator). End-to-end
            //       reward path verified.
            const after = await getCharacterSnapshot(page);
            expect(after).not.toBeNull();
            expect(after!.xp).toBeGreaterThan(preXp);

            // 9. Sanity: buff is still active after the fight (pausable
            //    drain at SKIP is ~2000ms — combatEngine.ts line 2547
            //    `tickCombatElixirs(2000)` — and our buff was seeded with
            //    24h remainingMs, so it should still be alive). This
            //    guards against the buff getting wiped by the combat
            //    cleanup path (which would silently break "buff lasts X
            //    minutes" UX claims).
            const hasBuffOnExit = await page.evaluate(async () => {
                // @ts-expect-error — dev-time Vite URL not resolvable by tsc
                const mod = await import('/src/stores/buffStore.ts');
                return (mod as {
                    useBuffStore: { getState: () => { hasBuff: (e: string) => boolean } };
                }).useBuffStore.getState().hasBuff('atk_dmg_25');
            });
            expect(hasBuffOnExit).toBe(true);
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
