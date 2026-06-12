/**
 * Atomic E2E — claim offline hunt with bag full -> bag stays bounded.
 *
 * Spec (BACKLOG.md 5.13): "Offline trening z pełnym plecakiem". The
 * OfflineHunt info box (OfflineHunt.tsx line 559) advertises:
 * "Plecak pełny? Najsłabsze przedmioty zostaną automatycznie sprzedane."
 *
 * Underlying contract: `inventoryStore.addItem` (line 233-271) calls
 *   if (bag.length < MAX_BAG_SIZE) push;
 *   else { try auto-sell-or-overflow swap; never grow past MAX_BAG_SIZE; }
 * so 1000/1000 bag survives any number of `addItem` calls from a hunt
 * claim without crash or `bag.length > 1000`.
 *
 * This test EXERCISES that contract under the real OfflineHunt claim
 * path (which loops `addItem(generatedItems[i])` line 316-318 of
 * offlineHuntSystem.ts) rather than mocking it.
 *
 * ## Test strategy — direct call to `claimOfflineHunt` (not full clock wait)
 *
 * The natural UI flow is "tap Rozpocznij -> wait 12h -> tap Odbierz". For
 * E2E we collapse this by:
 *   1. Seeding bag with 1000 filler items via `generateFillerBagItems`.
 *   2. Calling `startHunt(monster, skill)` via page.evaluate.
 *   3. Backdating `useOfflineHuntStore.startedAt` to (now - 12h) so the
 *      claim rolls the full cap of kills (43200 seconds / 10 = 4320
 *      kills at speed x1, mastery 0).
 *   4. Calling `claimOfflineHunt()` directly.
 *   5. Asserting: bag.length === 1000 EXACTLY (no growth, no crash),
 *      result.kills > 0 (proves the hunt actually ran), and gold +xp
 *      grew (proves the reward chain didn't bail out).
 *
 * The bag-stays-bounded invariant is the load-bearing assertion — same
 * contract is regression-tested in `combat/loot/full-inventory-bag-counter.spec.ts`
 * for live combat. This test extends the proof to the offline-hunt
 * claim path which loops through MANY potential `addItem` calls in a
 * single tick (4320 rolls × per-kill drop rate). If `addItem` ever
 * leaks a `bag.push()` past the MAX_BAG_SIZE guard, this test catches it.
 *
 * ## Setup
 *
 *  1. Seed Knight lvl 5 on SECONDARY (rat is unlocked at lvl 1+, so 5
 *     is comfortable). Bag pre-filled with 1000 filler items via
 *     `seedGameSave({ bagItems: generateFillerBagItems(1000) })`.
 *  2. Login + select character -> Town hydrates bag to 1000.
 *
 * ## Flow
 *
 *  1. Sanity: bag.length === 1000 post-hydration.
 *  2. page.evaluate: dynamic-import offlineHuntStore + monsters.json,
 *     call `startHunt(rat, sword_fighting)` then mutate `startedAt`
 *     backward to fake 12h elapsed.
 *  3. page.evaluate: dynamic-import `claimOfflineHunt`, run it,
 *     return `{ kills, goldGained, xpGained, finalBagLen, hadCrash }`.
 *  4. Assertions:
 *     - hadCrash === false (no exception thrown)
 *     - kills >= 1 (at least one rat actually killed)
 *     - finalBagLen === 1000 EXACTLY (the load-bearing invariant)
 *     - goldGained >= 1 (rewards chain executed past `addGold`)
 *
 * ## Why SECONDARY account
 *
 * Suite runs concurrent on primary per task brief.
 *
 * ## Cleanup
 *
 * try/finally -> cleanupCharacterById (game_saves wiped, hunt state +
 * bag + all rewards reset).
 */

import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';
import { seedGameSave, generateFillerBagItems, findUserIdByEmail } from '../../fixtures/seedGameSave';

test.describe('City › Offline Hunt', { tag: '@city' }, () => {
    test.describe.configure({ timeout: 90_000 });

    test('claim with bag at 1000/1000 -> no crash, bag.length stays exactly 1000, rewards still granted', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            // 1. Seed Knight lvl 5 on SECONDARY (rat unlocked at lvl 1).
            const created = await createCharacterViaApi({
                userEmail: testUsers.secondary.email,
                name: nick,
                class: 'Knight',
                overrides: { level: 5, highest_level: 5, hp_regen: 0, mp_regen: 0 },
            });
            createdId = created.id;

            // 2. Seed bag with 1000 filler items + gold=0 baseline.
            //    generateFillerBagItems builds deterministic common
            //    `small_hp_potion` items with unique UUIDs (uuid required
            //    by inventoryStore.bag shape — items.json id is fine).
            const userId = await findUserIdByEmail(testUsers.secondary.email);
            await seedGameSave({
                characterId: created.id,
                userId,
                gold: 0,
                bagItems: generateFillerBagItems(1000),
            });

            // 3. Login -> pick character -> Town.
            await loginViaUI(page, testUsers.secondary);
            await page.goto('/character-select');
            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await expect(card).toBeVisible({ timeout: 10_000 });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });

            // 4. Sanity — bag hydrated to 1000.
            const preBagLen = await page.evaluate(async () => {
                const mod = await import('/src/stores/inventoryStore.ts');
                return mod.useInventoryStore.getState().bag.length;
            });
            expect(preBagLen).toBe(1000);

            // 5. Start hunt against rat, then backdate startedAt to fake
            //    12h elapsed. Mutate the store directly so we don't have
            //    to wait real-time — `previewOfflineHunt` reads
            //    `Date.now() - startMs` so any past timestamp works.
            await page.evaluate(async () => {
                const [ohMod, monsterMod] = await Promise.all([
                    import('/src/stores/offlineHuntStore.ts'),
                    import('/src/data/monsters.json'),
                ]);
                const monsters = (monsterMod.default ?? monsterMod) as Array<{ id: string; level: number; }>;
                const rat = monsters.find((m) => m.id === 'rat');
                if (!rat) throw new Error('[test 5.13] rat not found in monsters.json');
                // sword_fighting is the Knight weapon skill — passes
                // `getTrainableStatsForClass('Knight')` check inside
                // startHunt (not asserted explicitly but kept for
                // realism). Hunt accepts any string for the skill id.
                ohMod.useOfflineHuntStore.getState().startHunt(rat as Parameters<typeof ohMod.useOfflineHuntStore.getState.prototype.startHunt>[0] extends infer T ? T : never, 'sword_fighting');
                // Backdate startedAt -> 12h ago. OFFLINE_HUNT_MAX_SECONDS
                // is 43200 (12h). previewOfflineHunt caps elapsedSeconds
                // at that -> kills = 43200 / (BASE 10s / x1 multiplier)
                // = 4320 kills.
                const TWELVE_H_MS = 12 * 60 * 60 * 1000;
                ohMod.useOfflineHuntStore.setState({
                    startedAt: new Date(Date.now() - TWELVE_H_MS - 1000).toISOString(),
                });
            });

            // 6. Run the claim + collect snapshot. Wrap in try/catch so a
            //    runtime exception inside addItem (the bug we're guarding
            //    against) doesn't tank the test — instead we assert
            //    hadCrash === false explicitly.
            const result = await page.evaluate(async () => {
                let hadCrash = false;
                let kills = 0;
                let goldGained = 0;
                let xpGained = 0;
                try {
                    const [ohSysMod, invMod] = await Promise.all([
                        import('/src/systems/offlineHuntSystem.ts'),
                        import('/src/stores/inventoryStore.ts'),
                    ]);
                    const preGold = invMod.useInventoryStore.getState().gold;
                    const claimResult = ohSysMod.claimOfflineHunt();
                    if (!claimResult) {
                        return { hadCrash: false, kills: 0, goldGained: 0, xpGained: 0, finalBagLen: invMod.useInventoryStore.getState().bag.length, postGold: preGold };
                    }
                    kills = claimResult.kills;
                    goldGained = claimResult.goldGained;
                    xpGained = claimResult.xpGained;
                    const finalBagLen = invMod.useInventoryStore.getState().bag.length;
                    const postGold = invMod.useInventoryStore.getState().gold;
                    return { hadCrash, kills, goldGained, xpGained, finalBagLen, postGold };
                } catch (e) {
                    hadCrash = true;
                    return { hadCrash, kills, goldGained, xpGained, finalBagLen: -1, postGold: -1, error: String(e) };
                }
            });

            // 7. Load-bearing assertions.
            //    (a) No crash — addItem must never throw past MAX_BAG_SIZE.
            expect(result.hadCrash, `claimOfflineHunt threw — ${'error' in result ? result.error : 'no error string'}`).toBe(false);
            //    (b) Bag stayed at exactly 1000 — never grew. This is THE
            //        contract: every drop in the claim loop either goes
            //        into the overflow-swap branch or is silently auto-sold,
            //        never push past MAX_BAG_SIZE.
            expect(result.finalBagLen).toBe(1000);
            //    (c) Actually killed something — proves the hunt ran past
            //        previewOfflineHunt sanity check (which would no-op if
            //        the elapsed seconds didn't translate to kills > 0).
            expect(result.kills).toBeGreaterThan(0);
            //    (d) Gold gained — addGold ran past the bag.push branch
            //        (regression guard against "bail out early when bag is
            //        full" which would zero out gold rewards too).
            expect(result.goldGained).toBeGreaterThan(0);
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
