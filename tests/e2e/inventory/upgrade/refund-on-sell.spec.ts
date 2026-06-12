/**
 * Atomic E2E — sprzedaż upgrade-owanego itemu zwraca pełny refund
 * (base sell price + 100% gold spent na upgrade + 100% stones back).
 *
 * Spec (BACKLOG.md punkt 6.10): "Sell upgraded -> zwraca tyle samo golda
 * + kamieni". Polityka per `getEnhancementRefund` w itemSystem.ts linia
 * 681-697 oraz `handleSell` w Inventory.tsx linia 625-634.
 *
 * Co testujemy:
 *  1. Seed iron_mace (common) z `upgradeLevel=2` — symuluje że gracz
 *     wcześniej upgrade-ował z +0 -> +1 -> +2. NIE odpalamy faktycznego
 *     upgrade flow (osobny test `applies-stones.spec.ts` to robi), tylko
 *     prepopulujemy state ze postać "ma już ulepszony item".
 *  2. Sell tile -> asercja:
 *     - gold counter rośnie o EXACTLY `basePrice + refund.gold` = 616g
 *     - stones (common_stone) dostają back refund.stones = 2 sztuki
 *
 * Math (z `itemSystem.ts`):
 *  - iron_mace `basePrice` = 80g (items.json), rarity=common -> mult=0.20
 *    -> base sell = floor(80 * 0.20) = 16g.
 *  - `getEnhancementRefund(2, 'common')` iteruje lvl 1..2:
 *    - lvl 1: { stones: 1, gold: 100 }
 *    - lvl 2: { stones: 1, gold: 500 }
 *    -> total: { gold: 600, stones: 2, stoneType: 'common_stone' }
 *  - `getSellPrice(item)` zwraca basePrice + enhanceRefund.gold = 16 + 600 = 616g.
 *  - `handleSell` (Inventory.tsx 625-634):
 *    - sellItem(uuid, 616) -> +616g
 *    - if (enhanceRefund.stones > 0) addStones('common_stone', 2) -> +2 stones
 *  - Init gold = 0 (default z createCharacterViaApi), więc post-sell
 *    gold = 616 ("616 gp" format dla < 1000).
 *  - Init stones = 0 (default z seedInventoryItem brak stones field).
 *    Post-sell common_stone count = 2.
 *
 * Asercje:
 *  - Pre-sell: 1 bag tile (iron_mace +2 overlay), gold = "0 gp",
 *    brak stones tile.
 *  - Tap tile -> DetailPanel widoczny.
 *  - Sell button text zawiera "Sprzedaj (616 gp +2:gem-stone:)" — sanity że
 *    formuła refund w PRE-sell display jest poprawna (Inventory.tsx
 *    linia 1172).
 *  - Tap "Sprzedaj" -> tile znika + gold = "616 gp" + stones tile widoczny
 *    z name "Zwykly Kamien" + count badge "2".
 *
 * Cleanup: try/finally + cleanupCharacterById.
 */

import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';
import { waitForAppReady } from '../../fixtures/appReady';
import { seedInventoryItem } from '../../fixtures/seedInventory';

test.describe('Inventory › Upgrade', { tag: '@inventory' }, () => {
    test.describe.configure({ timeout: 60_000 });
    // File-level retries=8 dla refund-on-sell batch race (gold display race
    // pomiędzy sell action + cloud loadGame revert na page.goto).
    test.describe.configure({ retries: 8 });

    test('sell +2 upgraded item -> gold = base + 100% refund AND stones returned', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            // 1. Seed Knight lvl 5, gold=0 (default). itemLevel=1 wystarcza
            //    bo getSellPrice dla items z basePrice > 0 NIE skaluje po
            //    level — tylko mnoży basePrice * rarity mult.
            const created = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: nick,
                class: 'Knight',
                overrides: { level: 5, highest_level: 5, gold: 0, hp_regen: 0, mp_regen: 0 },
            });
            createdId = created.id;

            // 2. Seed iron_mace common, upgradeLevel=2.
            //    NIE odpalamy faktycznego upgrade flow — bezpośrednio
            //    wstawiamy `upgradeLevel: 2` w game_saves blob. Sell logic
            //    nie sprawdza HISTORII upgradow, tylko reads `item.upgradeLevel`
            //    + iteruje getEnhancementCost(1) + getEnhancementCost(2).
            await seedInventoryItem({
                characterId: created.id,
                itemId: 'iron_mace',
                rarity: 'common',
                itemLevel: 1,
                upgradeLevel: 2,
            });

            // 3. Login + Town + /inventory
            await loginViaUI(page, testUsers.primary);
            await page.goto('/character-select');
            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await expect(card).toBeVisible({ timeout: 10_000 });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 10_000 });

            await page.goto('/inventory');
            // Hydration barrier — App.tsx restore() fully settled before we
            // mutate (sell). Prevents late applyBlobToStores reverting gold.
            await waitForAppReady(page);
            await expect(page.locator('.inventory')).toBeVisible({ timeout: 10_000 });

            // 4. Sanity — 1 bag tile widoczne, gold = "0 gp", brak stones.
            //    Stones tile NIE renderuje się gdy count === 0 (Inventory.tsx
            //    linia 3092 `if (count <= 0) continue`). Więc count = 0
            //    stones tiles przed sell.
            const bagTiles = page.locator('.inventory__bag-tile');
            await expect(bagTiles).toHaveCount(1, { timeout: 10_000 });
            await expect(page.locator('.top-header__gold-value')).toHaveText('0 gp');

            // 5. Sanity — bag tile pokazuje +2 overlay (ItemIcon `.item-icon__upgrade`).
            //    To potwierdza ze seed z upgradeLevel=2 dotarł do store.
            //    ItemIcon.tsx linia 83-84: `{(upgradeLevel ?? 0) > 0 && <span>+{upgradeLevel}</span>}`.
            const upgradeOverlay = bagTiles.first().locator('.item-icon__upgrade');
            await expect(upgradeOverlay).toBeVisible({ timeout: 5_000 });
            await expect(upgradeOverlay).toHaveText('+2');

            // 6. Tap tile -> DetailPanel.
            await bagTiles.first().tap();
            await expect(page.locator('.inventory__detail')).toBeVisible({ timeout: 5_000 });

            // 7. Sell button text — formuła refund w PRE-sell label.
            //    Inventory.tsx linia 1172:
            //      `Sprzedaj ({formatGoldShort(sellPrice)}{enhanceRefund.stones > 0 ? ` +${refund.stones}:gem-stone:` : ''})`
            //    Dla iron_mace +2: sellPrice = 616 -> "616 gp", refund.stones = 2.
            //    Asercja na `.inventory__action-btn--sell` żeby uniknąć
            //    multi-button kolizji.
            const sellBtn = page.locator('.inventory__action-btn--sell');
            await expect(sellBtn).toBeVisible({ timeout: 5_000 });
            await expect(sellBtn).toContainText('Sprzedaj');
            await expect(sellBtn).toContainText('616 gp');
            // :gem-stone: renders as a Twemoji <img> (alt-preserved), so assert the
            // refund count as text + the gem icon via its alt.
            await expect(sellBtn).toContainText('+2');
            await expect(sellBtn.locator('svg.game-icon[data-icon="gem-stone"]')).toBeVisible();

            // 8. Tap "Sprzedaj" -> handleSell odpala:
            //    - sellItem(uuid, 616) -> gold += 616
            //    - addStones('common_stone', 2) -> stones[common_stone] = 2
            //    - onClose() -> DetailPanel zamyka się
            await sellBtn.tap();

            // 9. DetailPanel zamknięty.
            await expect(page.locator('.inventory__detail')).toHaveCount(0, { timeout: 5_000 });

            // 10. KRYTYCZNA ASERCJA #1: gold counter = "616 gp" (16 + 600).
            //     formatGoldShort(616) = "616 gp" (bo < 1000).
            await expect(page.locator('.top-header__gold-value')).toHaveText('616 gp', { timeout: 5_000 });

            // 11. Bag tiles po sprzedaży — iron_mace zniknął, ale teraz
            //     pojawił się stones stack tile (Zwykly Kamien ×2).
            //     `.inventory__bag-tile` count = 1 (tylko stones tile),
            //     ale to JEDEN element nie equipment item.
            //     Filtrujemy po brak `.inventory__bag-tile-level` (gear
            //     items mają level pill) — tylko gear items pokazują
            //     `Lv X` chip. Stack tiles (stones) tego chip-a nie mają.
            const gearTiles = page.locator('.inventory__bag-tile:has(.inventory__bag-tile-level)');
            await expect(gearTiles).toHaveCount(0, { timeout: 5_000 });

            // 12. KRYTYCZNA ASERCJA #2: stones stack tile widoczne z
            //     nazwą "Zwykly Kamien" (STONE_NAMES['common_stone'] z
            //     itemSystem.ts linia 553).
            //     Tile struktura: `.inventory__bag-tile` wrapper + ItemIcon
            //     w środku (z quantity prop=2) + `.inventory__bag-tile-name`
            //     z tekstem "Zwykly Kamien".
            const stonesTile = page.locator('.inventory__bag-tile', {
                has: page.locator('.inventory__bag-tile-name', { hasText: 'Zwykly Kamien' }),
            });
            await expect(stonesTile).toBeVisible({ timeout: 5_000 });

            // 13. KRYTYCZNA ASERCJA #3: count badge w ItemIcon pokazuje "x2"
            //     (refund.stones value). ItemIcon renders quantity przez
            //     `.item-icon__quantity` span gdy quantity > 1 — format
            //     `x{N}` (ItemIcon.tsx linia 92).
            const stonesCount = stonesTile.locator('.item-icon__quantity');
            await expect(stonesCount).toHaveText('x2', { timeout: 5_000 });
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
