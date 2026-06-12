/**
 * Atomic E2E — BACKLOG 15.3: rapid-click "Kup" -> only 1 item bought.
 *
 * The anti-dupe guarantee comes from `inventoryStore.spendGold` (line
 * 342-347 of `src/stores/inventoryStore.ts`):
 *   spendGold: (amount) => {
 *     const { gold } = get();
 *     if (gold < amount) return false;   // <- idempotency gate
 *     set({ gold: gold - amount });
 *     return true;
 *   }
 *
 * Test contract: with the player holding EXACTLY the sticker price of
 * one item (50g for Lv 1 common Knight sword), firing 5 rapid taps on
 * "Kup" in immediate succession MUST result in:
 *   - exactly ONE item added to the bag (toast count "Kupiono: Miecz"
 *     fires once; bag size = 1 NOT 5)
 *   - gold deducted exactly once (final gold = 0, not -200)
 *   - the remaining 4 taps short-circuit at `spendGold` -> 'no_gold'
 *
 * Why we use `button.click()` via `page.evaluate` (vs 5× `.tap()`):
 *   The Shop disables the Kup button when `gold < item.price` via
 *   `disabled={!canBuy}` (Shop.tsx line 380). After the FIRST successful
 *   tap, Zustand fires its subscribers -> Shop re-renders -> button
 *   becomes `disabled=true`. Playwright's `.tap()` auto-waits for the
 *   element to be actionable (enabled, stable, visible) — so taps 2-5
 *   would either time out (waiting for an enabled state that never
 *   comes) or skip the test entirely. Calling `button.click()` from
 *   within the page context BYPASSES the actionability check; the
 *   click event still fires the React `onClick` handler even on a
 *   disabled button when invoked imperatively. This lets us reproduce
 *   the actual race we care about: rapid input events arriving inside
 *   the same JS microtask before React commits the disabled-state
 *   render.
 *
 *   Side note: 5 synchronous `button.click()` calls execute the
 *   `handleBuyItem` handler 5× in a row inside one microtask, but
 *   Zustand `set()` flushes state synchronously inside the handler.
 *   So call #2's `get()` already sees `gold=0` and `spendGold` returns
 *   false -> 'no_gold' branch. The "race" is real (5 events fire) but
 *   the guard is robust (only 1 commits).
 *
 * Setup:
 *   1. Seed Knight at Lv 1 with `characters.gold = 50` AND
 *      `game_saves.inventory.gold = 50` (the Shop reads from
 *       inventoryStore which is hydrated from game_saves, not from
 *       characters.gold — see comment in `item-appears-in-inventory-
 *       and-deducts-gold.spec.ts`).
 *   2. Login -> /character-select -> pick character -> Town.
 *   3. SPA-nav to /shop via BottomNav (preserves Zustand stores).
 *   4. Locate the common "Miecz" card (Lv 1 sword = 50g).
 *
 * Actions:
 *   5. Fire 5 synchronous `button.click()`s on the Kup button via
 *      `page.evaluate`.
 *
 * Assertions:
 *   6. TopHeader gold = 0 (not -200, not 50).
 *   7. Toast count for "Kupiono: Miecz" - we can't easily count toasts
 *      since `showToast` overwrites the same `.shop__toast` element via
 *      setTimeout, so we instead assert TopHeader gold = 0 (proves
 *      single deduction) + nav to /inventory and assert bag size = 1.
 *   8. Bag count badge reads "Plecak: 1 / 1000" — exactly one item.
 *
 * Cleanup: `cleanupCharacterById` in `finally`.
 */

import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { seedGameSave, findUserIdByEmail } from '../../fixtures/seedGameSave';
import { cleanupCharacterById } from '../../fixtures/cleanup';

test.describe('Shop › Buy', { tag: '@shop' }, () => {
    // Login + character switch + cloud sync + shop render + 5× rapid click
    // + assertion across 2 surfaces ≈ comparable cost to the canonical
    // shop-buy test; reuse its 90s timeout for WebKit cold start safety.
    test.describe.configure({ timeout: 90_000 });

    test('rapid-clicking Kup 5× with exactly 1 item worth of gold only buys 1', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        // Seed gold EQUAL to one Lv 1 common Knight sword price (50g per
        // calculateShopPrice in shopStore.ts: floor((30*1 + 20) * 1) = 50).
        // This is the critical setup: after the first successful buy,
        // gold MUST be exactly 0 so subsequent `spendGold(50)` calls
        // short-circuit on `gold < amount`.
        const STARTING_GOLD = 50;

        try {
            // 1. Seed character + game_save with starting gold = 50.
            const created = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: nick,
                class: 'Knight',
                overrides: { gold: STARTING_GOLD, hp_regen: 0, mp_regen: 0 },
            });
            createdId = created.id;

            const userId = await findUserIdByEmail(testUsers.primary.email);
            await seedGameSave({
                characterId: created.id,
                userId,
                gold: STARTING_GOLD,
            });

            // 2. Login + pick character -> Town.
            await loginViaUI(page, testUsers.primary);
            if (!page.url().endsWith('/character-select')) {
                await page.goto('/character-select');
            }
            await expect(page.locator('.char-select__card-name', { hasText: nick })).toBeVisible({ timeout: 10_000 });
            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 10_000 });
            await expect(page.locator('.town__char-name')).toHaveText(nick);

            // 3. Sanity: TopHeader gold reads 50 BEFORE the rapid-click salvo.
            const goldBtn = page.locator('.top-header__gold-btn').first();
            await expect(goldBtn).toHaveAttribute('aria-label', /Złoto:\s*50/, { timeout: 5_000 });

            // 4. SPA-nav to /shop via BottomNav (preserves Zustand stores;
            //    page.goto would reload and wipe in-memory state — see comment
            //    in item-appears-in-inventory-and-deducts-gold.spec.ts).
            await page.getByRole('button', { name: /^Sklep$/i }).tap();
            await expect(page).toHaveURL(/\/shop$/, { timeout: 10_000 });
            await expect(page.locator('.shop__tabs')).toBeVisible({ timeout: 10_000 });

            // 5. Locate the Lv 1 common "Miecz" card. Exact-name match
            //    avoids picking up "Rzadki Miecz" (rare variant).
            const swordCard = page.locator('.shop__card', {
                has: page.locator('.shop__card-name', { hasText: /^Miecz$/ }),
            }).first();
            await swordCard.scrollIntoViewIfNeeded();
            await expect(swordCard).toBeVisible();
            const priceText = await swordCard.locator('.shop__card-price').textContent();
            expect(priceText).toMatch(/50\s*gp/i);

            // 6. Sanity: the Kup button starts ENABLED (canBuy = 50 >= 50).
            const buyBtn = swordCard.getByRole('button', { name: /^Kup$/i });
            await expect(buyBtn).toBeEnabled();

            // 7. RAPID-CLICK SALVO — fire 5 synchronous click events on the
            //    Kup button inside one JS microtask. We use `evaluate` with
            //    a button handle so all 5 invocations happen back-to-back
            //    on the same DOM node WITHOUT going through Playwright's
            //    auto-actionability wait (which would block on the
            //    `disabled` flag that flips after click #1).
            //
            //    Why this matters: a `.tap().tap().tap().tap().tap()` chain
            //    would auto-wait per call and fail when the button becomes
            //    disabled. Our race-condition contract requires 5 events
            //    arriving BEFORE the React render that disables the button.
            //
            //    `dispatchEvent(new MouseEvent('click', {bubbles:true}))`
            //    bypasses the `disabled` check that synthetic `.click()`
            //    honors in some browsers (WebKit ignores `disabled` for
            //    programmatic `.click()`; Chromium respects it). Using
            //    MouseEvent guarantees the React onClick handler fires on
            //    both engines.
            await buyBtn.evaluate((btn) => {
                for (let i = 0; i < 5; i++) {
                    btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                }
            });

            // 8. PRIMARY assertion — TopHeader gold reads 0 (not -200).
            //    Proves `spendGold` short-circuited 4× and only spent
            //    50g once. The shop's BUY_MESSAGES['no_gold'] toast
            //    overwrites the success toast quickly, so we don't rely
            //    on toast text — gold value is the source of truth.
            await expect(goldBtn).toHaveAttribute('aria-label', /Złoto:\s*0(?!\d)/, { timeout: 5_000 });

            // 9. Button should now be visibly disabled (canBuy = 0 >= 50 = false).
            //    Sanity check: confirms React noticed the state change.
            await expect(buyBtn).toBeDisabled({ timeout: 3_000 });

            // 10. Navigate to /inventory and assert bag has EXACTLY 1 item.
            //     This is the bag-side proof of "only 1 item bought" — the
            //     other 4 click events never reached `restoreItem` because
            //     `spendGold` blocked them at the gate.
            await page.getByRole('button', { name: /^Postać$/i }).tap();
            await expect(page).toHaveURL(/\/inventory$/, { timeout: 10_000 });
            await expect(page.locator('.inventory__bag-count')).toHaveText(/Plecak:\s*1\s*\/\s*1000/, { timeout: 10_000 });
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
