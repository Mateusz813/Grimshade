/**
 * Atomic E2E — Death without AOL -> items lost from bag via
 * `applyDeathItemLoss(false)`.
 *
 * BACKLOG 13.20 extension. The sibling `real-death-applies-xp-penalty.spec.ts`
 * proves the XP/level penalty branch fires. THIS test proves the EQ-loss
 * branch fires when no AOL is armed.
 *
 * ## Contract (from `inventoryStore.ts` lines 526-565)
 *
 * `applyDeathItemLoss(protectedByAol)`:
 *   - Early return 0 if `protectedByAol === true` (AOL branch).
 *   - Builds pool of {bag items + equipped items} — deposit excluded.
 *   - If pool empty -> return 0.
 *   - lossCount = max(1, floor(pool.length * 0.05)).
 *   - Shuffles pool with Math.random (Fisher-Yates), picks first
 *     `lossCount` victims, removes them from bag / clears equip slots.
 *
 * ## Strategy: seed BIG bag -> predictable loss count
 *
 * `Math.max(1, floor(N * 0.05))`:
 *   - N=1..19 -> 1 item lost (Math.max kicks in).
 *   - N=20 -> 1 item (20 * 0.05 = 1).
 *   - N=40 -> 2 items.
 *
 * To get a DETERMINISTIC, multi-item loss we seed 20 items -> exactly
 * 1 victim lost (floor(20 * 0.05) = 1, ties Math.max). Why 20 over 1:
 * with a single item, the test technically passes if EITHER bag goes
 * 1->0 OR (regression) the engine no-ops; with 20 items, asserting
 * bagSize === 19 (or 18, etc.) gives more specific signal vs zero.
 *
 * We DON'T stub Math.random — we don't care WHICH item drops, only
 * that 1 item is lost (the count is deterministic given a non-empty
 * pool; Fisher-Yates just picks WHICH).
 *
 * ## What we test
 *
 *  1. Seed Knight lvl 50 (no consumables, no AOL, no DP).
 *  2. Seed 20 common items in the bag.
 *  3. Login + Town. Snapshot: bagSize=20.
 *  4. `triggerPlayerDeath(page)` — engine fires:
 *       - line 1396: useConsumable('amulet_of_loss') -> FALSE
 *         (count=0) -> `usedAol=false`.
 *       - line 1430: applyDeathItemLoss(false) — runs the loss path:
 *           - pool = 20 (bag) + 0 (equipped) = 20.
 *           - lossCount = max(1, floor(20 * 0.05)) = max(1, 1) = 1.
 *           - 1 victim removed from bag.
 *       - Returns 1 -> line 1434 log ":skull: Stracileś 1 przedmiot(ow)…".
 *  5. Post-assert:
 *       - bagSize === 19 (exactly 1 lost).
 *       - The remaining 19 UUIDs are a SUBSET of the original 20
 *         (no items appeared from nowhere).
 *       - character.gold unchanged (death penalty doesn't touch gold,
 *         per spec — gold penalty would be a separate column).
 *       - level dropped 50 -> 49 (penalty branch also fired — sanity
 *         that we actually reached the death code path).
 *
 * ## What we DON'T verify (kept for separate tests)
 *
 *  - Equipment slot clearing — would need `seedEquippedItem` for
 *    every slot + assertion that some equipment slot got nulled. The
 *    pool randomisation may pick a bag item, missing the equip branch
 *    in any single test run. Covered atomically in unit tests via
 *    `inventoryStore.test.ts` if anyone writes one.
 *  - WHICH specific item drops — Math.random-driven; not stable.
 *
 * Cleanup: try/finally + cleanupCharacterById.
 *
 * ## Why SECONDARY account
 *
 * Per task brief — primary is hit by the background suite; we offload
 * char seeding here onto secondary to keep concurrency-safe.
 */

import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';
import { seedInventoryItem, seedInventoryResources } from '../../fixtures/seedInventory';
import { triggerPlayerDeath, getCharacterSnapshot } from '../../fixtures/combatSim';

test.describe('Combat › Death', { tag: '@combat' }, () => {
    test.describe.configure({ timeout: 120_000 });

    test('Knight lvl 50 no protection + 20 bag items dies -> exactly 1 item lost, gold unchanged, level drops', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            // 1. Seed Knight lvl 50 on SECONDARY (per task brief — primary
            //    is hammered by background suite).
            const created = await createCharacterViaApi({
                userEmail: testUsers.secondary.email,
                name: nick,
                class: 'Knight',
                overrides: {
                    level: 50,
                    highest_level: 50,
                    hp_regen: 0,
                    mp_regen: 0,
                },
            });
            createdId = created.id;

            // 2. Seed 20 common bag items. Pool size 20 -> lossCount=1
            //    (deterministic from `max(1, floor(20*0.05))`).
            //
            //    We iterate a mix of common cheap items to avoid all-same
            //    UUID collisions (each seedInventoryItem call generates a
            //    fresh UUID). Variety also makes the post-mortem easier
            //    if a single item drops out — we can see WHICH one.
            const itemIds = [
                'iron_sword', 'iron_helmet', 'leather_armor',
                'iron_sword', 'iron_helmet', 'leather_armor',
                'iron_sword', 'iron_helmet', 'leather_armor',
                'iron_sword', 'iron_helmet', 'leather_armor',
                'iron_sword', 'iron_helmet', 'leather_armor',
                'iron_sword', 'iron_helmet', 'leather_armor',
                'iron_sword', 'iron_helmet',
            ];
            for (const itemId of itemIds) {
                await seedInventoryItem({
                    characterId: created.id,
                    itemId,
                    rarity: 'common',
                    itemLevel: 1,
                });
            }

            // 3. Seed gold INTO `game_saves.state.inventory.gold` blob —
            //    the app reads gold from `inventoryStore.gold` (hydrated
            //    from the blob). `characters.gold` column is legacy/unused
            //    by runtime. Without this call, gold defaults to 0 and
            //    we can't assert "gold unchanged at 100".
            await seedInventoryResources({
                characterId: created.id,
                gold: 100,
            });

            // 3. Login -> Town.
            await loginViaUI(page, testUsers.secondary);
            await page.goto('/character-select');
            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await expect(card).toBeVisible({ timeout: 10_000 });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
            await expect(page.locator('.town__char-name')).toHaveText(nick, { timeout: 10_000 });

            // 4. Pre-snapshot. bagSize MUST be 20 + gold MUST be 100. If
            //    bagSize < 20 the seed didn't all land (possible blob
            //    overwrite race in seedInventoryItem if calls are too
            //    fast — sequential `await` should prevent it).
            const before = await getCharacterSnapshot(page);
            expect(before).not.toBeNull();
            expect(before!.level).toBe(50);
            expect(before!.bagSize).toBe(20);
            expect(before!.gold).toBe(100);

            const preUuids = await page.evaluate(async () => {
                // @ts-expect-error — dev-time Vite URL
                const mod = await import('/src/stores/inventoryStore.ts');
                const inv = (mod as {
                    useInventoryStore: { getState: () => {
                        bag: Array<{ uuid: string; itemId: string }>;
                    } };
                }).useInventoryStore.getState();
                return inv.bag.map((i) => i.uuid);
            });
            expect(preUuids).toHaveLength(20);

            // 5. Trigger death. No protection consumables -> usedAol=false ->
            //    applyDeathItemLoss(false) runs the loss path -> 1 item
            //    removed from bag (pool=20, lossCount=max(1, floor(1.0))=1).
            await triggerPlayerDeath(page, 'rat');

            // 6. Post-snapshot.
            const after = await getCharacterSnapshot(page);
            expect(after).not.toBeNull();

            // (a) Level dropped 50 -> 49 — sanity that the death actually
            //     ran (not a no-op). Without this check, a regression that
            //     made `triggerPlayerDeath` a no-op would silently pass
            //     "bagSize === 20" both before and after.
            expect(after!.level).toBe(49);

            // (b) HP full (fullHealEffective ran line 1419).
            expect(after!.hp).toBe(after!.max_hp);

            // (c) KRYTYCZNE: bagSize === 19. Exactly 1 item removed by
            //     applyDeathItemLoss.
            expect(after!.bagSize).toBe(19);

            // (d) The 19 remaining UUIDs are a strict subset of the
            //     original 20 — items aren't being replaced or re-rolled.
            const postUuids = await page.evaluate(async () => {
                // @ts-expect-error — dev-time Vite URL
                const mod = await import('/src/stores/inventoryStore.ts');
                const inv = (mod as {
                    useInventoryStore: { getState: () => {
                        bag: Array<{ uuid: string; itemId: string }>;
                    } };
                }).useInventoryStore.getState();
                return inv.bag.map((i) => i.uuid);
            });
            expect(postUuids).toHaveLength(19);
            const preSet = new Set(preUuids);
            for (const uuid of postUuids) {
                expect(preSet.has(uuid)).toBe(true);
            }

            // (e) gold UNCHANGED at 100. Death penalty per spec is XP +
            //     skill XP + items. NOT gold — gold-on-death would be a
            //     separate column in `applyDeathPenalty` (levelSystem.ts)
            //     and there isn't one. Asserting this guards against a
            //     regression that ever introduces accidental gold loss.
            expect(after!.gold).toBe(100);
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
