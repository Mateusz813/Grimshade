/**
 * Atomic E2E — Shop "Items" tab buy flow.
 *
 * Backlog item 3.1 ("Kup item w sklepie -> pojawia się w plecaku +
 * odjęło gold"): the player has gold, opens the Shop, taps "Kup" on
 * a Lv 1 common weapon, and we verify:
 *  1. Toast confirms the purchase ("Kupiono: Miecz").
 *  2. TopHeader gold value decreases by the sticker price.
 *  3. The bought item appears in the bag when we open `/inventory`.
 *
 * Setup pattern:
 *   - `createCharacterViaApi` creates a fresh Knight at level 1 with
 *     `characters.gold = 100000` (DB row only).
 *   - `seedGameSave` writes a matching `game_saves` blob with
 *     `inventory.gold = 100000` so when `switchToCharacter` rehydrates
 *     the stores on character pick, inventoryStore.gold lands at
 *     100,000 — NOT 0. Without the seed, `characters.gold` is never
 *     read back into inventoryStore (it's a write-only column for
 *     cross-character ranking and offline-save backup).
 *   - Knight is chosen so the Shop renders a "Miecz" sword (its common
 *     name_pl in `itemTemplates.json`) — deterministic selector text.
 *   - Lv 1 common weapon price is `floor((30 * 1 + 20) * 1) = 50` gold
 *     (see `calculateShopPrice` in shopStore.ts).
 *
 * Why we navigate via BottomNav tap instead of `.goto('/shop')`:
 *   Grimshade is a Zustand-based SPA; `page.goto()` performs a full
 *   page reload that wipes the in-memory store. After reload the
 *   characterStore is null -> Shop renders only `<Spinner>` (per
 *   Shop.tsx line 214-216) -> `.shop__tabs` never appears.
 *   BottomNav uses React Router's `navigate()` (SPA route change),
 *   preserving the characterStore + inventoryStore hydration.
 *
 * Cleanup: `cleanupCharacterById` in `finally` — also wipes the
 * seeded `game_saves` row (it's listed in `CHARACTER_CHILD_TABLES`).
 */

import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { seedGameSave, findUserIdByEmail } from '../../fixtures/seedGameSave';
import { cleanupCharacterById } from '../../fixtures/cleanup';

test.describe('Shop › Buy', { tag: '@shop' }, () => {
    // Login + character switch + cloud sync + shop render + buy + assert across
    // 3 surfaces (toast, TopHeader, inventory) is a 5+ network call test;
    // default 30 s timeout has been tight on WebKit cold starts.
    test.describe.configure({ timeout: 90_000 });

    test('buying Lv 1 common Knight sword shows toast, decreases gold, and adds item to bag', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        // Starting gold large enough to never hit "no_gold" and small
        // enough that the after-buy number is easy to verify visually.
        // Lv 1 common weapon price per calculateShopPrice in shopStore.ts
        // = floor((30 * 1 + 20) * 1) = 50 gold, so post-buy is 100,000 - 50 = 99,950.
        const STARTING_GOLD = 100_000;

        try {
            // 1. Seed character + game_save with starting gold.
            //    hp_regen=0, mp_regen=0 to avoid any background ticks during
            //    UI assertions (cargo-culted from hp-mp-level-consistency test).
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

            // 2. Login + go to /character-select -> pick our character -> Town.
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
            // Wait for Town to fully hydrate so TopHeader reads the seeded gold.
            await expect(page.locator('.town__char-name')).toHaveText(nick);

            // 3. Confirm TopHeader gold is the seeded amount BEFORE buy.
            //    aria-label = "Złoto: 100 000" (pl-PL toLocaleString uses NBSP
            //    or thin space depending on engine; we match the digits inside).
            const goldBtn = page.locator('.top-header__gold-btn').first();
            await expect(goldBtn).toHaveAttribute('aria-label', /Złoto:\s*100[\s\xa0]?000/, { timeout: 5_000 });

            // 4. Navigate to Shop via BottomNav (SPA route — preserves
            //    Zustand stores). Items tab is the default in Shop.tsx.
            await page.getByRole('button', { name: /^Sklep$/i }).tap();
            await expect(page).toHaveURL(/\/shop$/, { timeout: 10_000 });
            await expect(page.locator('.shop__tabs')).toBeVisible({ timeout: 10_000 });

            // 5. Locate the Miecz (common Lv 1 sword) card and its price/buy
            //    button. Card scope = `.shop__card` whose `.shop__card-name` is
            //    exactly "Miecz" (rare variant is "Rzadki Miecz", so exact match
            //    avoids picking up the rare).
            const swordCard = page.locator('.shop__card', {
                has: page.locator('.shop__card-name', { hasText: /^Miecz$/ }),
            }).first();
            await swordCard.scrollIntoViewIfNeeded();
            await expect(swordCard).toBeVisible();

            // Price chip on the card should read 50 gold (formatGoldShort
            // renders small values as "Ngp"; for 50 gp it's "50gp").
            const priceText = await swordCard.locator('.shop__card-price').textContent();
            expect(priceText).toMatch(/50\s*gp/i);

            // 6. Tap "Kup" — selectorse buttons inside the card body.
            await swordCard.getByRole('button', { name: /^Kup$/i }).tap();

            // 7. Toast appears with "Kupiono: Miecz".
            await expect(page.locator('.shop__toast')).toHaveText(/Kupiono:\s*Miecz/i, { timeout: 5_000 });

            // 8. TopHeader gold decreased by exactly 50 (sword price).
            //    Expected: 100,000 - 50 = 99,950. Use the aria-label which
            //    holds the un-shortened pl-PL formatted number.
            await expect(goldBtn).toHaveAttribute('aria-label', /Złoto:\s*99[\s\xa0]?950/, { timeout: 5_000 });

            // 9. Navigate to /inventory via BottomNav "Postać" tab.
            //    The Inventory header shows "Plecak: N / 1000" — we expect 1.
            await page.getByRole('button', { name: /^Postać$/i }).tap();
            await expect(page).toHaveURL(/\/inventory$/, { timeout: 10_000 });
            await expect(page.locator('.inventory__bag-count')).toHaveText(/Plecak:\s*1\s*\/\s*1000/, { timeout: 10_000 });

            // 10. The bag tile name is the item's name_pl ("Miecz") in its
            //     rarity color — assert presence by text inside the bag grid.
            const bagTileName = page.locator('.inventory__bag-tile-name', { hasText: /Miecz/i }).first();
            await expect(bagTileName).toBeVisible({ timeout: 5_000 });
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
