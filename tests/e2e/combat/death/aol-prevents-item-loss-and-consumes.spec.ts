/**
 * Atomic E2E — Amulet of Loss (AOL) actually preserves bag items + consumes
 * one AOL count on death.
 *
 * BACKLOG 13.21 extension. The sibling armed-state SMOKE
 * (`combat/death/aol-armed-shows-buff-row.spec.ts`) only verifies that
 * the item siedzi w `consumables` + UI go widzi. The DP consume sibling
 * (`combat/death/death-protection-prevents-level-loss.spec.ts`) verifies
 * the death_protection branch consume. Neither covers the AOL item-
 * protection branch — that's THIS test's contract.
 *
 * What we test (mirrors `combatEngine.ts` lines 1395-1435):
 *  1. Seed Knight lvl 50 + 3 bag items (NO `death_protection` so the XP
 *     penalty branch fires too — we want the engine to reach line 1430
 *     `applyDeathItemLoss(usedAol)` where `usedAol=true`).
 *  2. Seed 3× `amulet_of_loss` in consumables.
 *  3. Login + Town.
 *  4. Pre-snapshot: 3 items in bag, AOL count=3.
 *  5. `triggerPlayerDeath(page)` — engine fires:
 *       - line 1395: useConsumable('death_protection') returns FALSE (none
 *         seeded) -> `usedDeathProtection=false`.
 *       - line 1396: useConsumable('amulet_of_loss') returns TRUE +
 *         decrements 3 -> 2 -> `usedAol=true`.
 *       - line 1408: applyDeathPenalty fires (no DP), level drops 50 -> 49,
 *         XP reset to 0.
 *       - line 1430: applyDeathItemLoss(true) — inventoryStore returns 0
 *         immediately (line 527: `if (protectedByAol) return 0;`) -> bag
 *         UNCHANGED.
 *       - line 1432: log ":trident-emblem: Amulet of Loss roztrzaskał się…".
 *  6. Post-assert:
 *       - All 3 items STILL in bag (count unchanged) + their UUIDs match
 *         the seeded ones (no swap-out by some accidental side effect).
 *       - `consumables.amulet_of_loss === 2` (1 used).
 *       - level dropped (50 -> 49) — proves the test actually triggered
 *         death (not a no-op) and that AOL does NOT protect XP/level,
 *         only items (separate contract from `death_protection`).
 *       - hp === max_hp (fullHealEffective ran).
 *
 * Why this matters vs the sibling tests:
 *  - `death-protection-prevents-level-loss.spec.ts` proves DP consume +
 *    LEVEL preservation (XP/level branch).
 *  - THIS test proves AOL consume + ITEM preservation (item branch).
 *  - Together both consumable protection paths are now fully covered.
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
import { seedConsumables, seedInventoryItem } from '../../fixtures/seedInventory';
import { triggerPlayerDeath, getCharacterSnapshot } from '../../fixtures/combatSim';

test.describe('Combat › Death', { tag: '@combat' }, () => {
    test.describe.configure({ timeout: 90_000 });

    test('Knight lvl 50 with 3× AOL + 3 bag items dies -> items preserved, AOL count 3 -> 2, level still drops', async ({ page }) => {
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

            // 2. Seed 3 common items in the bag. `applyDeathItemLoss` runs
            //    over `bag + equipped` pool with min 1 lost. Without AOL,
            //    pool size 3 -> floor(3 * 0.05) = 0 -> max(1, 0) = 1 item
            //    would normally be lost. With AOL, ALL 3 stay (line 527
            //    early-return).
            await seedInventoryItem({
                characterId: created.id,
                itemId: 'iron_sword',
                rarity: 'common',
                itemLevel: 1,
            });
            await seedInventoryItem({
                characterId: created.id,
                itemId: 'iron_helmet',
                rarity: 'common',
                itemLevel: 1,
            });
            await seedInventoryItem({
                characterId: created.id,
                itemId: 'leather_armor',
                rarity: 'common',
                itemLevel: 1,
            });

            // 3. Seed 3× AOL. The `useConsumable('amulet_of_loss')` call
            //    decrements by 1 -> after death, count should be 2.
            await seedConsumables({
                characterId: created.id,
                counts: { amulet_of_loss: 3 },
            });

            // 4. Login -> Town.
            await loginViaUI(page, testUsers.secondary);
            await page.goto('/character-select');
            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await expect(card).toBeVisible({ timeout: 10_000 });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
            await expect(page.locator('.town__char-name')).toHaveText(nick, { timeout: 10_000 });

            // 5. Pre-snapshot. Bag MUST have 3 items + AOL count MUST be 3.
            //    If either is wrong, the seed step didn't land or the
            //    blob hydration is mis-stamped (owner check fails).
            const before = await getCharacterSnapshot(page);
            expect(before).not.toBeNull();
            expect(before!.level).toBe(50);
            expect(before!.bagSize).toBe(3);

            const preState = await page.evaluate(async () => {
                // @ts-expect-error — dev-time Vite URL
                const mod = await import('/src/stores/inventoryStore.ts');
                const inv = (mod as {
                    useInventoryStore: { getState: () => {
                        bag: Array<{ uuid: string; itemId: string }>;
                        consumables: Record<string, number>;
                    } };
                }).useInventoryStore.getState();
                return {
                    aolCount: inv.consumables['amulet_of_loss'] ?? 0,
                    bagUuids: inv.bag.map((i) => i.uuid),
                    bagItemIds: inv.bag.map((i) => i.itemId),
                };
            });
            expect(preState.aolCount).toBe(3);
            expect(preState.bagUuids).toHaveLength(3);
            expect(preState.bagItemIds.sort()).toEqual(['iron_helmet', 'iron_sword', 'leather_armor']);

            // 6. Trigger death. Engine consumes 1× AOL + sets usedAol=true ->
            //    applyDeathItemLoss(true) early-returns 0 (line 527) -> bag
            //    untouched. Level penalty STILL fires because AOL doesn't
            //    block the XP/level branch.
            await triggerPlayerDeath(page, 'rat');

            // 7. Post-snapshot — XP/level branch did fire (no DP seeded).
            const after = await getCharacterSnapshot(page);
            expect(after).not.toBeNull();
            // 50 -> 49 (floor(50 * 0.02) = 1 lost level) — confirms the
            // death actually went through. If `triggerPlayerDeath` was a
            // no-op, level would still be 50.
            expect(after!.level).toBe(49);
            // fullHealEffective ran (line 1419) post-penalty.
            expect(after!.hp).toBe(after!.max_hp);

            // 8. KRYTYCZNE: bag preserved (all 3 items still present with
            //    same UUIDs). If AOL branch failed silently and items were
            //    lost via applyDeathItemLoss(false), bag.length would be
            //    <= 2 and UUIDs would drift.
            const postState = await page.evaluate(async () => {
                // @ts-expect-error — dev-time Vite URL
                const mod = await import('/src/stores/inventoryStore.ts');
                const inv = (mod as {
                    useInventoryStore: { getState: () => {
                        bag: Array<{ uuid: string; itemId: string }>;
                        consumables: Record<string, number>;
                    } };
                }).useInventoryStore.getState();
                return {
                    aolCount: inv.consumables['amulet_of_loss'] ?? 0,
                    bagUuids: inv.bag.map((i) => i.uuid),
                    bagItemIds: inv.bag.map((i) => i.itemId),
                };
            });
            expect(postState.bagUuids).toHaveLength(3);
            // Same UUIDs as before (set comparison — order may shift if
            // store mutations re-built the array, but membership stable).
            expect(postState.bagUuids.sort()).toEqual(preState.bagUuids.sort());
            // Same item IDs — sanity that we didn't swap items for some
            // other unintended reason.
            expect(postState.bagItemIds.sort()).toEqual(
                ['iron_helmet', 'iron_sword', 'leather_armor'],
            );

            // 9. KRYTYCZNE: AOL consumed by exactly 1 (line 1396's
            //    useConsumable). 3 -> 2.
            expect(postState.aolCount).toBe(2);
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
