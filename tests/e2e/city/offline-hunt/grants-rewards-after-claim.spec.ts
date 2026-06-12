/**
 * Atomic E2E — Offline hunt full claim flow grants XP + gold + ends session.
 *
 * Spec (BACKLOG 5.12): "Offline trening — wykonaj, daje XP + drop +
 * monsters count". Original status :warning: smoke only (`page-loads.spec.ts`
 * covered UI rendering but not the full claim flow). This test exercises
 * the END-TO-END reward chain: start hunt -> fake 12h elapsed via
 * timestamp backdating -> call `claimOfflineHunt` -> verify all reward
 * mutations + session teardown.
 *
 * ## What "claim flow" actually mutates
 *
 * Per `claimOfflineHunt` impl (offlineHuntSystem.ts line 285-398):
 *   1. `useCharacterStore.addXp(totalXp)` — XP into character store, may
 *      bump level if threshold crossed.
 *   2. `useInventoryStore.addGold(totalGold)` — gold delta.
 *   3. `invStore.addItem(item)` per dropped item (subject to autoSell /
 *      bag-full overflow swap).
 *   4. `invStore.addConsumable(potionId, count)` per potion drop.
 *   5. `invStore.addConsumable('spell_chest_<lvl>', count)` per chest drop.
 *   6. `invStore.addStones(type, count)` per stone drop.
 *   7. `useSkillStore.addSkillXp(skillId, xp)` — training XP.
 *   8. `useMasteryStore.addMasteryKills(monster.id, weightedTaskKills)`.
 *   9. `useTaskStore.addKill(monster.id, level, weightedTaskKills)`.
 *  10. `useQuestStore.addProgress('kill', monsterId, weightedTaskKills)`.
 *  11. `useDailyQuestStore.addProgress('kill_any', weightedTaskKills)`.
 *  12. `useDailyQuestStore.addProgress('earn_gold', totalGold)`.
 *  13. `useOfflineHuntStore.stopHunt()` — sets isActive=false +
 *      startedAt=null (session teardown contract).
 *
 * THIS test pins the LOAD-BEARING SUBSET that's the most regression-prone:
 *   - XP delta > 0 (charStore.xp persists post-claim)
 *   - Gold delta > 0 (inventoryStore.gold persists post-claim)
 *   - Mastery kills > 0 (proves the weightedTaskKills wiring to masteryStore)
 *   - Hunt session ENDED (isActive=false + startedAt=null) — the most
 *     common bug shape: claim runs, rewards land, but `stopHunt` doesn't
 *     fire so the hunt counter on the UI says "still running" and a
 *     second click immediately re-claims with elapsed=now (0 kills).
 *
 * Item drops + stone drops + potion drops are RNG-dependent and may or
 * may not roll on a given 12h hunt — covered by 5.13 + 5.14 indirectly
 * (kills > 0 is the precondition for those rolls anyway). We assert
 * `kills > 0` instead (deterministic for any 12h hunt at any speed).
 *
 * ## Why no `character_kills` assertion (mentioned in task brief)
 *
 * The brief mentioned "character_kills bumped" but no such table /
 * column exists in the codebase (`grep -rn "character_kills"` in
 * `src/` returns zero hits). The actual kill bookkeeping lives in:
 *   - `useMasteryStore.masteryKills[monster.id]` (per-monster kill
 *     counter that drives mastery level progression).
 *   - `useTaskStore.activeTasks[i].progress` (per-task kill counter).
 *
 * We assert the masteryStore counter as the "kills bumped" proxy —
 * deterministic for any successful claim (mastery counter is keyed by
 * monster.id and incremented by weightedTaskKills per claim).
 *
 * ## Test strategy — direct call to `claimOfflineHunt`
 *
 * Same pattern as 5.13 (`full-inventory-edge.spec.ts`) + 5.14
 * (`advances-task.spec.ts`):
 *   1. Seed Knight + start hunt via page.evaluate.
 *   2. Backdate `startedAt` 12h via setState (no real-time wait).
 *   3. Call `claimOfflineHunt` directly.
 *   4. Read snapshot + assert reward chain + session teardown.
 *
 * ## Setup
 *
 *  1. Seed Knight lvl 5 on SECONDARY (rat unlocked at lvl 1).
 *  2. No bag fill (5.13 covers full-bag edge; we want the normal path).
 *
 * ## Cleanup
 *
 * try/finally -> cleanupCharacterById (game_saves wiped, hunt state +
 * mastery + tasks + XP all reset by character deletion CASCADE).
 */

import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';

test.describe('City › Offline Hunt', { tag: '@city' }, () => {
    test.describe.configure({ timeout: 120_000 });
    // 2026-05-27: retries=7 dla claim offline hunt batch flake.
    test.describe.configure({ retries: 7 });

    test('claim offline hunt against rat -> grants XP + gold + mastery kills, then sets isActive=false + startedAt=null', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            // 1. Seed Knight lvl 5 on SECONDARY. hp_regen=0/mp_regen=0
            //    silences background ticks during multi-step assertions.
            const created = await createCharacterViaApi({
                userEmail: testUsers.secondary.email,
                name: nick,
                class: 'Knight',
                overrides: { level: 5, highest_level: 5, hp_regen: 0, mp_regen: 0 },
            });
            createdId = created.id;

            // 2. Login -> pick character -> Town.
            await loginViaUI(page, testUsers.secondary);
            await page.goto('/character-select');
            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await expect(card).toBeVisible({ timeout: 15_000 });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
            await expect(page.locator('.town__char-name')).toHaveText(nick, { timeout: 10_000 });

            // 3. Pre-snapshot: capture baseline XP + gold + mastery counter
            //    BEFORE starting the hunt. The post-claim deltas are what
            //    we assert against (raw "kills > 0" alone wouldn't catch
            //    a regression where addXp silently no-ops).
            const before = await page.evaluate(async () => {
                // @ts-expect-error — dev-time Vite URL not resolvable by tsc
                const charMod = await import('/src/stores/characterStore.ts');
                // @ts-expect-error — dev-time Vite URL not resolvable by tsc
                const invMod = await import('/src/stores/inventoryStore.ts');
                // @ts-expect-error — dev-time Vite URL not resolvable by tsc
                const masMod = await import('/src/stores/masteryStore.ts');
                const ch = (charMod as {
                    useCharacterStore: { getState: () => { character: { xp: number; level: number } | null } };
                }).useCharacterStore.getState().character;
                const inv = (invMod as {
                    useInventoryStore: { getState: () => { gold: number } };
                }).useInventoryStore.getState();
                const mas = (masMod as {
                    useMasteryStore: { getState: () => { masteryKills: Record<string, number> } };
                }).useMasteryStore.getState();
                return {
                    xp: ch?.xp ?? 0,
                    level: ch?.level ?? 1,
                    gold: inv.gold,
                    ratKills: mas.masteryKills['rat'] ?? 0,
                };
            });
            expect(before.gold).toBe(0);

            // 4. Start hunt + backdate startedAt 12h. Same flow as 5.13/5.14:
            //    `startHunt(rat, 'sword_fighting')` then mutate `startedAt`
            //    backward via setState. `previewOfflineHunt` reads
            //    `Date.now() - startedAt`, so any past timestamp produces
            //    the elapsed seconds we want (capped at OFFLINE_HUNT_MAX_SECONDS
            //    = 43200 = 12h).
            await page.evaluate(async () => {
                const [ohMod, monsterMod] = await Promise.all([
                    // @ts-expect-error — dev-time Vite URL
                    import('/src/stores/offlineHuntStore.ts'),
                    // @ts-expect-error — dev-time Vite URL
                    import('/src/data/monsters.json'),
                ]);
                const monsters = ((monsterMod as { default?: unknown }).default ?? monsterMod) as Array<{ id: string; level: number }>;
                const rat = monsters.find((m) => m.id === 'rat');
                if (!rat) throw new Error('[test 5.12] rat not found in monsters.json');
                (ohMod as { useOfflineHuntStore: { getState: () => { startHunt: (m: unknown, skillId: string) => void } } })
                    .useOfflineHuntStore.getState().startHunt(rat as unknown, 'sword_fighting');
                const TWELVE_H_MS = 12 * 60 * 60 * 1000;
                (ohMod as { useOfflineHuntStore: { setState: (s: Record<string, unknown>) => void } })
                    .useOfflineHuntStore.setState({
                        startedAt: new Date(Date.now() - TWELVE_H_MS - 1000).toISOString(),
                    });
            });

            // 5. Pre-claim sanity: hunt is active + startedAt is set.
            //    Without this, a bug in step 4 (rat lookup failed, startHunt
            //    silently no-op'd) would cause the claim to return null AND
            //    leave session state untouched — both the "rewards landed"
            //    and "session ended" asserts would silently fail to fire.
            const preClaim = await page.evaluate(async () => {
                // @ts-expect-error — dev-time Vite URL
                const mod = await import('/src/stores/offlineHuntStore.ts');
                const s = (mod as {
                    useOfflineHuntStore: { getState: () => { isActive: boolean; startedAt: string | null; targetMonster: { id: string } | null } };
                }).useOfflineHuntStore.getState();
                return {
                    isActive: s.isActive,
                    startedAtSet: s.startedAt !== null,
                    targetId: s.targetMonster?.id ?? null,
                };
            });
            expect(preClaim.isActive).toBe(true);
            expect(preClaim.startedAtSet).toBe(true);
            expect(preClaim.targetId).toBe('rat');

            // 6. Invoke `claimOfflineHunt` directly. Wrap in try/catch so a
            //    reward-chain throw surfaces as `hadCrash=true` instead of
            //    tanking the page.evaluate. Capture all key state into a
            //    single return so the test asserts off ONE snapshot
            //    (avoids inter-read drift if some side-effect tick fired
            //    between separate reads).
            const result = await page.evaluate(async () => {
                let hadCrash = false;
                try {
                    const [ohSysMod, charMod, invMod, masMod, ohStoreMod] = await Promise.all([
                        // @ts-expect-error — dev-time Vite URL
                        import('/src/systems/offlineHuntSystem.ts'),
                        // @ts-expect-error — dev-time Vite URL
                        import('/src/stores/characterStore.ts'),
                        // @ts-expect-error — dev-time Vite URL
                        import('/src/stores/inventoryStore.ts'),
                        // @ts-expect-error — dev-time Vite URL
                        import('/src/stores/masteryStore.ts'),
                        // @ts-expect-error — dev-time Vite URL
                        import('/src/stores/offlineHuntStore.ts'),
                    ]);
                    const claimResult = (ohSysMod as {
                        claimOfflineHunt: () => { xpGained: number; goldGained: number; kills: number; levelsGained: number; monster: { id: string }; killsByRarity: { normal: number; strong: number; epic: number; legendary: number; boss: number } } | null;
                    }).claimOfflineHunt();
                    if (!claimResult) {
                        return { hadCrash: false, claimReturnedNull: true };
                    }
                    const ch = (charMod as {
                        useCharacterStore: { getState: () => { character: { xp: number; level: number } | null } };
                    }).useCharacterStore.getState().character;
                    const inv = (invMod as {
                        useInventoryStore: { getState: () => { gold: number } };
                    }).useInventoryStore.getState();
                    const mas = (masMod as {
                        useMasteryStore: { getState: () => { masteryKills: Record<string, number> } };
                    }).useMasteryStore.getState();
                    const oh = (ohStoreMod as {
                        useOfflineHuntStore: { getState: () => { isActive: boolean; startedAt: string | null; targetMonster: { id: string } | null } };
                    }).useOfflineHuntStore.getState();
                    return {
                        hadCrash: false,
                        claimReturnedNull: false,
                        claimXp: claimResult.xpGained,
                        claimGold: claimResult.goldGained,
                        claimKills: claimResult.kills,
                        levelsGained: claimResult.levelsGained,
                        monsterId: claimResult.monster.id,
                        normalKills: claimResult.killsByRarity.normal,
                        xpAfter: ch?.xp ?? -1,
                        levelAfter: ch?.level ?? -1,
                        goldAfter: inv.gold,
                        masteryRatKillsAfter: mas.masteryKills['rat'] ?? 0,
                        sessionActiveAfter: oh.isActive,
                        sessionStartedAtNull: oh.startedAt === null,
                        sessionTargetMonsterNull: oh.targetMonster === null,
                    };
                } catch (e) {
                    hadCrash = true;
                    return { hadCrash, error: String(e) };
                }
            });

            // 7. No crash from the claim path.
            expect(result.hadCrash, `claimOfflineHunt threw — ${'error' in result ? result.error : 'no error string'}`).toBe(false);
            expect(result.claimReturnedNull, 'claimOfflineHunt returned null — preview failed or hunt not active').toBe(false);

            // 8. Claim result reports positive deltas.
            //    At 12h cap + speed x1 + mastery 0, rat baseline: 4320 kills.
            //    XP per kill (rat) = 3, gold per kill = 1; multipliers may
            //    reduce both, but xp + gold must both be > 0.
            expect(result.claimKills, 'kills should be > 0 at 12h cap').toBeGreaterThan(0);
            expect(result.claimXp, 'xpGained should be > 0').toBeGreaterThan(0);
            expect(result.claimGold, 'goldGained should be > 0').toBeGreaterThan(0);
            expect(result.normalKills, 'normalKills should be > 0 (rat rolls predominantly normal at lvl 5)').toBeGreaterThan(0);
            expect(result.monsterId).toBe('rat');

            // 9. Reward chain landed in stores. The CRITICAL contract — if
            //    the claim returns positive deltas but the stores aren't
            //    actually mutated, the player gets nothing.
            //    XP delta: charStore.xp must reflect addXp call.
            //      Note: addXp can roll level + reset xp to remainder, so
            //      simple `xpAfter > before.xp` may fail if levelup happened.
            //      Use levelsGained to disambiguate.
            if (result.levelsGained === 0) {
                expect(result.xpAfter, 'charStore.xp should have grown by claim.xpGained').toBeGreaterThan(before.xp);
            } else {
                // Level-up happened — character.xp resets to remainder.
                // levelAfter > before.level proves addXp ran with enough XP.
                expect(result.levelAfter, 'character level should have advanced when levelsGained>0').toBeGreaterThan(before.level);
            }

            //    Gold delta — pre-claim was 0 (no seed), so we check exact
            //    equality with claimGold.
            expect(result.goldAfter).toBe(before.gold + result.claimGold);

            //    Mastery kills bumped — proves weightedTaskKills wiring
            //    (offlineHuntSystem.ts line 355). Mastery store tracks
            //    per-monster kill counter that drives level progression.
            expect(result.masteryRatKillsAfter, 'masteryKills[rat] should advance past pre-claim baseline').toBeGreaterThan(before.ratKills);

            // 10. Hunt session ended. The most regression-prone check: if
            //     `stopHunt()` doesn't fire at end of claim, the player can
            //     double-claim and the in-flight UI counters keep ticking.
            //     All 3 state flags must reset:
            //       - isActive  : true -> false
            //       - startedAt : "<iso>" -> null
            //       - targetMonster : { id: 'rat' } -> null
            expect(result.sessionActiveAfter, 'hunt session should be ended (isActive=false) after claim').toBe(false);
            expect(result.sessionStartedAtNull, 'startedAt should be null after claim').toBe(true);
            expect(result.sessionTargetMonsterNull, 'targetMonster should be null after claim').toBe(true);
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
