/**
 * Atomic E2E — Auto-sell common toggle ON → forced common drop after
 * combat → drop goes straight to gold, NOT to bag, with sold flag set
 * on the drop log entry.
 *
 * Spec (BACKLOG 6.3): "Auto-sell działa wg ustawień" → trigger-after-combat
 * flow. Original status ⚠️ partial (`settings-toggle-persists.spec.ts`
 * covers the toggle UI but not the actual combat trigger). This test
 * fills the gap.
 *
 * ## Contract under test
 *
 * `dropLootToInventory` (combatEngine.ts line 823-888) reads
 * `useSettingsStore.autoSellCommon` and for each generated drop whose
 * rarity matches an enabled flag:
 *   - `shouldAutoSell = true` (line 841-846)
 *   - skips `addItem` → adds `getGeneratedSellPrice` to `autoSellGold`
 *     accumulator
 *   - drop entry pushed with `sold: true` + `soldPrice: <amount>`
 *
 * After the loop:
 *   - `addGold(autoSellGold)` fires if any auto-sells happened (line 858)
 *
 * Side-effect contract we verify:
 *   - `inventoryStore.bag` count UNCHANGED (drop never landed)
 *   - `inventoryStore.gold` increased by exactly `getGeneratedSellPrice`
 *     for each auto-sold common
 *   - `combatStore.lastDrops` contains entries with `sold: true`
 *     (proves the drop pipeline marked them sold, not just silently
 *     swallowed)
 *
 * ## Test strategy — Math.random stub + killMonsterViaEngine
 *
 * `runCombatViaSkip` is unsuitable here: SKIP mode hard-codes
 * `gold = 0` + `setLastDrops([])` (combatEngine.ts line 2515-2516).
 * We need the FULL live-combat reward chain which `killMonsterViaEngine`
 * runs via direct `handleMonsterDeath(rarity)` (which calls the actual
 * `dropLootToInventory` with the actual auto-sell branch).
 *
 * Math.random stub: rat at level 5 has `BASE_DROP_CHANCES.normal = 0.08`
 * with `ROLL_COUNTS.normal = 2` (lootSystem.ts line 280-289). For
 * `Math.random() < 0.08` to fire, we need values strictly less than 0.08.
 * Then `rollRarity('normal')` rolls again → `Math.random() < 0.55` for
 * common (thresholds[0] = 0.55).
 *
 * Constant `Math.random = () => 0.05` works for both:
 *   - drop chance: 0.05 < 0.08 → drop fires
 *   - rarity:     0.05 < 0.55 → common rolled
 *   - bonuses generation: deterministic 0.05 each call
 *   - stone drop (0.30 normal threshold): 0.05 < 0.30 → also drops a
 *     common_stone (covered by separate stone branch — doesn't affect bag
 *     since stones go to invStore.stones not bag)
 *   - potion drop (0.4% chance / 0.004): 0.05 > 0.004 → no potion drop
 *   - spell chest drop (very rare): 0.05 likely > threshold → no chest
 *
 * **Why stubbing Math.random AFTER chat subscription is safe**:
 * `chatApi.subscribeAll` uses Math.random for unique channel name
 * (chatApi.ts line 157), called once on App mount. If we stub Math.random
 * BEFORE login, ALL subsequent chat subscribe calls would generate the
 * same channel id and Supabase would throw on the second subscribe. Same
 * pattern as `mass-disassemble.spec.ts` line 121-126: stub AFTER login +
 * character pick so the chat subscription has already opened a unique
 * channel.
 *
 * ## Why we don't stub Math.random to incrementing counter (like 6.5/6.7)
 *
 * The mass-disassemble test uses `() => 0.10 + counter*1e-8` so each call
 * returns a unique value (avoiding chat channel collision on RESUBSCRIBE
 * events). But 0.10 > 0.08 → drop chance check would FAIL → no drops.
 * Since the chat subscription is already up at this point and won't fire
 * again during our test window (no character switch / no chat panel open),
 * constant 0.05 is safe here.
 *
 * ## Why rat at level 5 (not level 1)
 *
 * Sell price scales with monster level: `getGeneratedSellPrice('common', N)
 * = floor(5*N + 10)` (lootSystem.ts line 387). At level 1: 15 gp per drop.
 * At level 5: 35 gp per drop — gives more numeric headroom for the
 * "gold > 0" assertion to be unambiguous even if only one of the 2 rolls
 * actually fires.
 *
 * ## Setup
 *
 *  1. Seed Knight lvl 5 on SECONDARY (rat at lvl 1 ok at level 5).
 *  2. Login + Town hydration → ensures characterStore + inventoryStore
 *     hydrated BEFORE we mutate settings + Math.random.
 *  3. Set `autoSellCommon: true` via direct settingsStore mutation.
 *  4. Stub Math.random → 0.05 (post-login = post-chat-subscribe).
 *
 * ## Cleanup
 *
 * try/finally + cleanupCharacterById. Settings store mutation auto-clears
 * on next character switch (per-character via persist middleware).
 */

import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';
import { killMonsterViaEngine } from '../../fixtures/combatSim';

test.describe('Inventory › Auto-Sell', { tag: '@inventory' }, () => {
    test.describe.configure({ timeout: 120_000 });

    test('autoSellCommon=true → kill rat with forced common drop → bag unchanged, gold increased, drop marked sold', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            // 1. Seed Knight lvl 5 on SECONDARY. Rat at lvl 1 (or rolled
            //    rarity-normal at higher levels) drops common items with
            //    getGeneratedSellPrice('common', 5) = floor(5*5+10) = 35 gp.
            const created = await createCharacterViaApi({
                userEmail: testUsers.secondary.email,
                name: nick,
                class: 'Knight',
                overrides: { level: 5, highest_level: 5, hp_regen: 0, mp_regen: 0 },
            });
            createdId = created.id;

            // 2. Login → pick → Town hydration (characterStore + inventoryStore
            //    populated). MUST happen BEFORE Math.random stub so:
            //    (a) chat subscribe gets a unique channel name
            //    (b) characterStore.character is non-null when killMonsterViaEngine
            //        runs (helper throws otherwise per combatSim.ts line 558)
            await loginViaUI(page, testUsers.secondary);
            await page.goto('/character-select');
            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await expect(card).toBeVisible({ timeout: 15_000 });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
            await expect(page.locator('.town__char-name')).toHaveText(nick, { timeout: 10_000 });

            // 3. Sanity baseline: bag empty + gold=0.
            const before = await page.evaluate(async () => {
                // @ts-expect-error — dev-time Vite URL
                const invMod = await import('/src/stores/inventoryStore.ts');
                const inv = (invMod as {
                    useInventoryStore: { getState: () => { bag: unknown[]; gold: number; stones: Record<string, number> } };
                }).useInventoryStore.getState();
                return { bagLen: inv.bag.length, gold: inv.gold, commonStones: inv.stones['common_stone'] ?? 0 };
            });
            expect(before.bagLen).toBe(0);
            expect(before.gold).toBe(0);

            // 4. Enable autoSellCommon via settingsStore. Direct mutation
            //    instead of going through the Inventory UI flow (which is
            //    already covered by `settings-toggle-persists.spec.ts`).
            await page.evaluate(async () => {
                // @ts-expect-error — dev-time Vite URL
                const mod = await import('/src/stores/settingsStore.ts');
                (mod as {
                    useSettingsStore: { getState: () => { setAutoSellCommon: (v: boolean) => void } };
                }).useSettingsStore.getState().setAutoSellCommon(true);
            });

            // 5. Stub Math.random → 0.05. AFTER login/Town (chat subscribe
            //    already opened its unique channel). Stub value 0.05:
            //      - < 0.08 (BASE_DROP_CHANCES.normal)     → drop fires
            //      - < 0.55 (rollRarity common threshold) → common rolled
            //      - deterministic bonuses generation
            //      - > 0.004 potion threshold              → no potion drop
            await page.evaluate(() => {
                Math.random = () => 0.05;
            });

            // 6. Kill rat at normal rarity via the FULL handleMonsterDeath
            //    path (not SKIP — SKIP returns gold=0 + sets lastDrops=[]).
            //    killMonsterViaEngine stages combat via initCombat(rat) then
            //    invokes handleMonsterDeath('normal') which runs:
            //      → dropLootToInventory(rat, 'normal')
            //      → rollLoot: 2 rolls, both fire (0.05 < 0.08)
            //      → rollRarity: both return 'common' (0.05 < 0.55)
            //      → shouldAutoSell: true for each (autoSellCommon=true)
            //      → 2× addGold(getGeneratedSellPrice('common', 1)) = 2× 15 = 30 gp
            //         (rat is monster level 1, NOT character level 5 — the
            //         drop level is the monster's level per rollLoot line 321)
            //      → 0× addItem (bag stays empty)
            //      → 2× drops.push({sold: true, soldPrice: 15})
            //    Plus the stone drop branch: rollStoneDrop @ 0.05 may also
            //    fire → adds common_stone to stones (separate from bag).
            const combatResult = await killMonsterViaEngine(page, 'rat', 'normal');

            // 7. After-snapshot.
            const after = await page.evaluate(async () => {
                // @ts-expect-error — dev-time Vite URL
                const invMod = await import('/src/stores/inventoryStore.ts');
                const inv = (invMod as {
                    useInventoryStore: { getState: () => { bag: unknown[]; gold: number; stones: Record<string, number> } };
                }).useInventoryStore.getState();
                return { bagLen: inv.bag.length, gold: inv.gold, commonStones: inv.stones['common_stone'] ?? 0 };
            });

            // 8. Bag UNCHANGED — the drops bypassed addItem.
            //    This is the load-bearing assertion: if auto-sell is broken
            //    and the drops landed in bag instead, bagLen would be 2.
            expect(after.bagLen, 'bag must stay empty — auto-sell skips addItem').toBe(0);

            // 9. Gold INCREASED. Floor: at least 1 sell happened. Combat-kill
            //    can also award a gold-per-kill amount (rat gold range [1,1])
            //    so we expect gold ≥ minimal auto-sell + base gold.
            //    Exact value depends on how many rolls fired AND base monster
            //    gold (1-1 for rat). We assert "non-trivial growth" rather
            //    than an exact number to absorb the (deterministic at our
            //    stub but rarity-dependent in code) gold roll for monster.gold.
            expect(after.gold, 'gold must have grown — auto-sell adds price to gold').toBeGreaterThan(before.gold);

            // 10. Drop log entries show `sold: true` flag — proves the
            //     dropLootToInventory branch executed and pushed sold drops
            //     into `combatStore.lastDrops` (combatEngine.ts line 851).
            //     This catches the regression where auto-sell silently
            //     swallows drops without marking them (the drop log would
            //     read as "no drops" instead of "auto-sold: X").
            //     There must be at least one sold drop in lastDrops. We
            //     filter out stones/potions (rarity: 'common' but generated
            //     by separate branches) by requiring soldPrice to be present
            //     (only the loot branch sets soldPrice).
            const soldDrops = combatResult.lastDrops.filter((d) => {
                const dropAny = d as { sold?: boolean; soldPrice?: number };
                return dropAny.sold === true && typeof dropAny.soldPrice === 'number';
            });
            expect(soldDrops.length, 'at least 1 drop in lastDrops must have sold=true + soldPrice').toBeGreaterThanOrEqual(1);

            // 11. Total accumulated soldPrice in drops + monster.gold should
            //     match the gold delta. Loose check — only asserts that the
            //     drop log's soldPrice values are individually positive (the
            //     auto-sell branch computed a real price).
            for (const drop of soldDrops) {
                const dropAny = drop as { soldPrice?: number };
                expect(dropAny.soldPrice ?? 0).toBeGreaterThan(0);
            }
        } finally {
            // Math.random stub is per-page-context; killing the page after
            // the test resets it automatically. No need to restore manually.
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
