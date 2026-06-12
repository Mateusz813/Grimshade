/**
 * Atomic E2E — transform quest completion grants reward + appends to
 * `completedTransforms`.
 *
 * BACKLOG 13.19: "Transform: poprawne nagrody + DC edge case". The
 * full UI flow (start transform quest -> grind ALL its monsters one by
 * one -> claim modal -> assert rewards) is impractical: Transform I
 * (id=1) alone requires defeating 30 boss monsters (levels 1-30, see
 * `transforms.json:9` `monsterLevelRange: [1, 30]`). A real grind
 * would take minutes per test.
 *
 * Instead we drive the transformStore actions DIRECTLY via
 * `page.evaluate` — same calls Transform.tsx makes when the player
 * clears a boss (line 1733 `defeatMonster(currentMonster.id)`) or
 * finishes the run (line 2038 `completeTransform()`).
 *
 * What this proves:
 *  1. `startTransformQuest(1, level=30)` for a fresh Knight lvl 30 ->
 *     returns true -> `currentTransformQuest` populated with
 *     `{ transformId:1, monstersDefeated:[], totalMonsters:30, inProgress:true }`
 *     (transformStore.ts line 210-217).
 *  2. Repeatedly `defeatMonster(id)` for every monster in the quest list
 *     -> `monstersDefeated.length` climbs to `totalMonsters`.
 *  3. When the final monster falls, `pendingClaimTransformId` is auto-
 *     locked to transformId (line 242-249) — anti-disconnect safeguard.
 *  4. `completeTransform()` returns the completed transform id +
 *     promotes it to `completedTransforms` array (line 261-283).
 *  5. `claimPendingReward()` clears the pending claim and returns the
 *     same id (line 307-312).
 *
 * Why these assertions cover the spec:
 *  - "Poprawne nagrody" — `completedTransforms.includes(1)` is THE
 *    flag the cumulative-bonus calculator uses (`getCumulativeTransformBonuses`
 *    in transformSystem.ts line 354). Adding 1 to the array IS the
 *    persistent reward. The consumable rewards (`hp_potion_sm × 50`,
 *    `mp_potion_sm × 50`, etc.) are claim-time side effects driven by
 *    `Transform.tsx` line 2065 `claimPendingReward()` after assigning
 *    them via `transformSystem.ts.calculateTransformRewards`. Those
 *    consumables touch `inventoryStore.addConsumable` /
 *    `addSpellChest` from `Transform.tsx`, not from the store itself.
 *  - "DC edge case" — the `pendingClaimTransformId` invariant is the
 *    disconnect safeguard: the moment the final monster falls, the
 *    transform is "locked in" regardless of whether the player
 *    actually clicks through the claim modal. We assert that
 *    `pendingClaimTransformId` populates BEFORE `completeTransform`
 *    runs and clears only AFTER `claimPendingReward`.
 *
 * What we DON'T test (and why):
 *  - Consumable reward delivery (potions / chests in bag) — that's a
 *    Transform.tsx view-side effect, not a store-side guarantee. A
 *    separate test should drive the FULL UI flow (start -> win -> claim
 *    modal -> assert `consumables.hp_potion_sm += 50`) but it's
 *    blocked on the 30-monster grind issue. Future helper
 *    `seedTransformCompletedNotClaimed` would let us skip the grind
 *    and just test the claim step in isolation.
 *  - Mid-quest DC recovery via page reload — would need
 *    `forceSaveAfterCombat` to push the pending state to DB before
 *    reload, then re-hydrate. Deferred — the in-memory invariants
 *    proven here are the foundation.
 *  - Per-class transform bonus aggregation — covered by
 *    `transformSystem.test.ts` unit tests.
 *
 * Strategy:
 *  1. Seed Knight lvl 30 (Transform I gate). hp/mp regen=0.
 *  2. Login + pick character -> Town (transformStore hydrated).
 *  3. Pre-snapshot: `completedTransforms = []`, no active quest, no pending.
 *  4. Via `page.evaluate`: startTransformQuest -> for-each defeatMonster
 *     -> poke `pendingClaimTransformId` mid-flow -> completeTransform ->
 *     claimPendingReward. Each step's return value asserted.
 *  5. Post-snapshot: `completedTransforms` includes 1, `currentTransformQuest`
 *     cleared, `pendingClaimTransformId` cleared.
 *
 * Cleanup: try/finally + cleanupCharacterById.
 */

import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';

interface ITransformSnapshot {
    completedTransforms: number[];
    activeQuestId: number | null;
    defeatedCount: number;
    totalCount: number;
    pendingClaimId: number | null;
}

const getTransformSnapshot = async (
    page: import('@playwright/test').Page,
): Promise<ITransformSnapshot> => {
    return await page.evaluate(async (): Promise<ITransformSnapshot> => {
        // @ts-expect-error — dev-time Vite URL not resolvable by tsc
        const mod = await import('/src/stores/transformStore.ts');
        const state = (mod as {
            useTransformStore: {
                getState: () => {
                    completedTransforms: number[];
                    currentTransformQuest: {
                        transformId: number;
                        monstersDefeated: string[];
                        totalMonsters: number;
                    } | null;
                    pendingClaimTransformId: number | null;
                };
            };
        }).useTransformStore.getState();
        return {
            completedTransforms: [...state.completedTransforms],
            activeQuestId: state.currentTransformQuest?.transformId ?? null,
            defeatedCount: state.currentTransformQuest?.monstersDefeated.length ?? 0,
            totalCount: state.currentTransformQuest?.totalMonsters ?? 0,
            pendingClaimId: state.pendingClaimTransformId,
        };
    });
};

test.describe('Combat › Transform', { tag: '@combat' }, () => {
    test.describe.configure({ timeout: 90_000 });

    test('start -> defeat all monsters -> completeTransform: id in completedTransforms + pendingClaim lifecycle', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            // 1. Seed Knight lvl 30. Transform 1 has `level: 30` gate
            //    (transforms.json line 4), so 30 is the minimum.
            //    hp/mp_regen=0 for state stability.
            const created = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: nick,
                class: 'Knight',
                overrides: { level: 30, highest_level: 30, hp_regen: 0, mp_regen: 0 },
            });
            createdId = created.id;

            // 2. Login -> wybierz postać -> Town
            await loginViaUI(page, testUsers.primary);
            await page.goto('/character-select');
            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await expect(card).toBeVisible({ timeout: 10_000 });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
            await expect(page.locator('.top-header')).toBeVisible({ timeout: 10_000 });

            // 3. Pre-snapshot: fresh character has no completed transforms,
            //    no quest, no pending claim. Sanity that store hydration
            //    landed at the right defaults.
            const before = await getTransformSnapshot(page);
            expect(before.completedTransforms).toEqual([]);
            expect(before.activeQuestId).toBeNull();
            expect(before.pendingClaimId).toBeNull();

            // 4. Start quest + defeat all monsters + complete + claim,
            //    all in one evaluate to avoid 30+ round-trips. Returns
            //    intermediate observations for assertion.
            const result = await page.evaluate(async (): Promise<{
                started: boolean;
                monsterCount: number;
                allDefeated: boolean;
                pendingBeforeComplete: number | null;
                completeReturned: number;
                claimReturned: number | null;
                pendingAfterClaim: number | null;
            }> => {
                // @ts-expect-error — dev-time Vite URL not resolvable by tsc
                const storeMod = await import('/src/stores/transformStore.ts');
                // @ts-expect-error — dev-time Vite URL not resolvable by tsc
                const sysMod = await import('/src/systems/transformSystem.ts');

                const useTransformStore = (storeMod as {
                    useTransformStore: {
                        getState: () => {
                            startTransformQuest: (id: number, lvl: number) => boolean;
                            defeatMonster: (id: string) => boolean;
                            completeTransform: () => number;
                            claimPendingReward: () => number | null;
                            currentTransformQuest: {
                                monstersDefeated: string[];
                                totalMonsters: number;
                            } | null;
                            pendingClaimTransformId: number | null;
                        };
                    };
                }).useTransformStore;
                const getTransformMonsters = (sysMod as {
                    getTransformMonsters: (id: number) => Array<{ id: string }>;
                }).getTransformMonsters;

                // Start Transform 1 quest.
                const started = useTransformStore.getState().startTransformQuest(1, 30);

                // Pull the monster list AFTER start so it's the same one
                // the store seeded into currentTransformQuest.totalMonsters.
                const monsters = getTransformMonsters(1);

                // Defeat every monster one by one. defeatMonster is
                // idempotent (line 232) and returns true on success.
                for (const m of monsters) {
                    useTransformStore.getState().defeatMonster(m.id);
                }

                // After the LAST defeatMonster call, line 242-249 should
                // have auto-locked pendingClaimTransformId to 1 because
                // the final kill puts monstersDefeated.length ===
                // totalMonsters.
                const pendingBeforeComplete = useTransformStore.getState().pendingClaimTransformId;

                const q = useTransformStore.getState().currentTransformQuest;
                const allDefeated = q ? q.monstersDefeated.length >= q.totalMonsters : false;

                // Run the completion path — promotes 1 to
                // completedTransforms array AND clears currentTransformQuest.
                const completeReturned = useTransformStore.getState().completeTransform();

                // Claim the pending reward — returns the id and clears
                // pendingClaimTransformId. Transform.tsx line 2065 fires
                // this after the reward animation finishes.
                const claimReturned = useTransformStore.getState().claimPendingReward();

                const pendingAfterClaim = useTransformStore.getState().pendingClaimTransformId;

                return {
                    started,
                    monsterCount: monsters.length,
                    allDefeated,
                    pendingBeforeComplete,
                    completeReturned,
                    claimReturned,
                    pendingAfterClaim,
                };
            });

            // 5. Assertions on intermediate state observations.

            // (a) Quest started successfully. False here would mean either
            //     the level check failed (we seeded 30 == gate so unlikely)
            //     or a previous quest was active (we asserted before.activeQuestId === null).
            expect(result.started).toBe(true);

            // (b) Transform 1 has exactly 30 monsters (level 1..30 each).
            //     Hard-coded check against the data file — if someone
            //     changes monsterLevelRange to [1, 31] this test breaks
            //     and someone has to come check why.
            expect(result.monsterCount).toBe(30);

            // (c) Every monster got defeated. allDefeated assertion checks
            //     the store's view of "done".
            expect(result.allDefeated).toBe(true);

            // (d) Pending claim was auto-locked to id=1 BEFORE
            //     completeTransform ran. This is the DC-safety branch —
            //     even if the test crashed after defeatMonster but before
            //     completeTransform, the claim would survive.
            expect(result.pendingBeforeComplete).toBe(1);

            // (e) completeTransform returned the id of the transform.
            expect(result.completeReturned).toBe(1);

            // (f) claimPendingReward returned the same id and cleared.
            expect(result.claimReturned).toBe(1);
            expect(result.pendingAfterClaim).toBeNull();

            // 6. Final store-state snapshot — proves the REWARD is
            //    persistent: completedTransforms.includes(1) drives every
            //    cumulative bonus the game gives the player going forward
            //    (HP%, MP%, regen, atk, def, skill bonus per
            //    transformSystem.getCumulativeTransformBonuses).
            const after = await getTransformSnapshot(page);
            expect(after.completedTransforms).toContain(1);
            // currentTransformQuest cleared (line 276).
            expect(after.activeQuestId).toBeNull();
            // pendingClaimId cleared by claimPendingReward.
            expect(after.pendingClaimId).toBeNull();
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
