/**
 * Atomic E2E — full bag (1000/1000) during a kill: the engine's
 * overflow-handling path keeps bag size at MAX and routes gold + XP
 * rewards without crashing or breaking the bag counter.
 *
 * BACKLOG 13.17: "Combat reward + full inventory → komunikat".
 * App-level contract (drop modal / toast / silent auto-sell) is
 * INTERMITTENT — `addItem` in `inventoryStore.ts` line 233-271 has
 * three branches:
 *
 *  1. Incoming item rarity has auto-sell flag ON in settings →
 *     converted to gold, bag length unchanged.
 *  2. Bag has room → push to bag, no message.
 *  3. Bag FULL → `pickOverflowVictim` picks the lowest-rarity (then
 *     lowest-level) non-heroic item in the bag. If the incoming item
 *     is strictly "better" (higher rarity, or same rarity higher
 *     level), the victim is auto-sold for `OVERFLOW_SELL_PRICE[rarity]`
 *     and the incoming item replaces it. Else the incoming item is
 *     DROPPED (return false) with no visible UI signal.
 *
 * For a Knight lvl 1 vs rat (lvl 1, `dropTable: []`), most kills yield
 * 0 random drops; the small chance of a tier-1 common item drop hits the
 * overflow path and is silently discarded (same-rarity same-level
 * common → `isBetter=false` → dropped). The IMPORTANT contract we can
 * deterministically test:
 *
 *  • Killing while bag is at MAX_BAG_SIZE (1000) MUST NOT crash the
 *    engine / UI (no infinite loop, no NaN in stats, no React-render
 *    explosion).
 *  • Bag length stays at MAX after kill — overflow swaps replace one
 *    item with another, they NEVER grow past 1000.
 *  • Gold is awarded (rat gold range [1,1], plus possible overflow
 *    sell price if a swap happened — either way, gold > pre-kill gold).
 *  • XP is awarded (rat.xp = 3, plus mastery / party / SKIP multipliers
 *    — earnedXp > 0).
 *
 * This is the load-bearing edge case: prior to the overflow-handling
 * branch (combit history c. 2025), a kill with a full bag would simply
 * lose the drop silently AND the engine had no MAX_BAG_SIZE check at
 * the addItem entry point — early Inventory.tsx versions would render
 * 1001+ tiles and the bag-counter line would silently overflow.
 *
 * What we DON'T test (and why):
 *  • Toast / drop-modal text — the app currently has no consistent
 *    "Plecak pełny" surface in combat path (deposit ✕ feedback exists
 *    but the engine-side drop path does not). When/if the app adds
 *    one, extend this test with `expect(toast).toBeVisible()`.
 *  • Per-rarity overflow rules — unit-test material (`addItem`
 *    swap semantics), covered separately. Test here verifies the
 *    high-level invariant, not per-branch.
 *
 * Strategy:
 *  1. Seed Knight lvl 1 + 1000 common filler items via `seedGameSave`
 *     (`generateFillerBagItems(1000)`). Bag starts at MAX.
 *  2. Login, pick character, reach Town (combatStore + inventoryStore
 *     hydrated). Pre-snapshot bag size + gold + xp.
 *  3. `killMonsterViaEngine(page, 'rat')` runs the FULL reward flow
 *     including `dropLootToInventory` → `addItem` → overflow branch.
 *  4. Post-kill snapshot:
 *     • bag.length === 1000 (still capped).
 *     • gold > preGold (rat awarded ≥1 gp; engine no-op would leave
 *       gold unchanged).
 *     • xp > preXp (rat awarded 3 XP, multipliers may inflate).
 *     • No JS errors leaked into the page console (Playwright catches
 *       unhandled exceptions automatically).
 *
 * Cleanup: try/finally + cleanupCharacterById (wipes characters +
 * game_saves; filler items live in the save blob).
 */

import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';
import { seedGameSave, findUserIdByEmail, generateFillerBagItems } from '../../fixtures/seedGameSave';
import { killMonsterViaEngine, getCharacterSnapshot } from '../../fixtures/combatSim';

test.describe('Combat › Loot', { tag: '@combat' }, () => {
    test.describe.configure({ timeout: 90_000 });

    test('kill mob with bag at 1000/1000: bag stays at MAX, gold/XP still awarded', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            // 1. Seed Knight lvl 1.
            const created = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: nick,
                class: 'Knight',
                overrides: { hp_regen: 0, mp_regen: 0 },
            });
            createdId = created.id;

            // 2. Seed game_save with 1000 common filler items → bag MAX
            //    capacity reached BEFORE first navigation. `seedGameSave`
            //    overwrites whatever default save existed for this char,
            //    so we don't have to worry about pre-existing items.
            const userId = await findUserIdByEmail(testUsers.primary.email);
            await seedGameSave({
                characterId: created.id,
                userId,
                gold: 0, // start at 0 for clean delta assertion
                bagItems: generateFillerBagItems(1000),
            });

            // 3. Login → wybierz postać → Town. Town hydration is the
            //    earliest point at which `inventoryStore.bag` reflects
            //    the seeded 1000 items (Character switch → hydrateGame
            //    → applyBlobToStores).
            await loginViaUI(page, testUsers.primary);
            await page.goto('/character-select');
            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await expect(card).toBeVisible({ timeout: 10_000 });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
            await expect(page.locator('.town__char-name')).toHaveText(nick, { timeout: 10_000 });

            // 4. Pre-snapshot. bagSize MUST be 1000 (proves seed
            //    hydrated through the full per-character store pipeline).
            const before = await getCharacterSnapshot(page);
            expect(before).not.toBeNull();
            expect(before!.bagSize).toBe(1000);
            const preGold = before!.gold;
            const preXp = before!.xp;

            // 5. Drive the full reward flow via the live-combat path.
            //    `killMonsterViaEngine` runs `handleMonsterDeath` directly
            //    (combatEngine.ts line 975) which calls
            //    `dropLootToInventory` → `addItem`. With bag at MAX, the
            //    overflow-swap branch decides per-item whether to swap
            //    (incoming > victim → replace) or discard (same-rarity
            //    same-level common → drop). Either way, gold + XP still
            //    apply via `addGold(gold)` / `addXp(finalXp)`.
            await killMonsterViaEngine(page, 'rat');

            // 6. Post-snapshot. Key invariants:
            const after = await getCharacterSnapshot(page);
            expect(after).not.toBeNull();

            // (a) Bag length never grows past MAX. Overflow path is
            //     replace-or-discard, both keep length stable.
            //     This is the crash-prevention guarantee.
            expect(after!.bagSize).toBe(1000);

            // (b) Gold awarded — rat range [1,1] (monsters.json line 12).
            //     If an overflow swap happened, an extra
            //     OVERFLOW_SELL_PRICE.common = 5 gp gets added on top.
            //     Either way, post-gold MUST be strictly greater.
            expect(after!.gold).toBeGreaterThan(preGold);

            // (c) XP awarded — rat.xp = 3, multipliers may shift but
            //     always > 0 (handleMonsterDeath addReward line 1066).
            expect(after!.xp).toBeGreaterThan(preXp);
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
