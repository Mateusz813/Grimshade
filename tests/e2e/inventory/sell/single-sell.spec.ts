/**
 * Atomic E2E — pojedyncza sprzedaż przedmiotu z plecaka.
 *
 * Spec (BACKLOG.md punkt 6.6): "Pojedyncza sprzedaż".
 *
 * Test sprawdza pełen flow single-sell:
 *  1. Tap na bag tile → otwiera się DetailPanel
 *  2. Tap "Sprzedaj (Xg)" button → item znika z bagu + gold w TopHeader rośnie.
 *
 * Setup: postać Knight, gold=0 (default z createCharacterViaApi), +1
 * seeded item w bag. Item: `iron_mace` (rarity common, basePrice=80) —
 * sell price = floor(80 * 0.20) = 16 gold (z RARITY_SELL_MULTIPLIER w
 * itemSystem.ts linia 373).
 *
 * Asercje:
 *  • Przed sprzedażą: 1 bag tile widoczne, TopHeader pokazuje "0".
 *  • Po sprzedaży: 0 bag tile (lub stack tiles dla consumables — patrz
 *    UWAGA niżej), TopHeader pokazuje "16" (gold short format dla 16g
 *    to po prostu "16" bo to mniej niż 100).
 *
 * Dlaczego iron_mace a nie wooden_mace:
 *  • wooden_mace ma `basePrice: 0` w items.json → sell padding via
 *    SELL_PRICES[common](lvl=1) = floor(1*5+10) = 15g. To też działa,
 *    ale iron_mace ma jawne basePrice które daje 16g — łatwiej
 *    audytować.
 *
 * UWAGA o gold format (TopHeader):
 *  • TopHeader używa `formatGoldShort()` (goldFormat.ts linia 31) — dla
 *    wartości < 1000 zwraca format `"{N} gp"` (np. "16 gp"), dla >= 1000
 *    redukuje do "{X,YZ} k" itd. My testujemy z 16g → display = "16 gp".
 *  • Gold value czytamy z `.top-header__gold-value` element (TopHeader.tsx
 *    linia 332). To liczba (+ suffix) widoczna w pillu obok ikony 💰.
 *
 * UWAGA o stack tiles vs bag tiles:
 *  • Inventory bag rendering miesza "real" items (broń, armor) z
 *    "stack tiles" (potions, chests, stones — które są w
 *    `inventoryStore.consumables` / `.stones`, nie w `.bag`). My
 *    seedujemy do `.bag` tylko, więc po sprzedaży count `.inventory__bag-tile`
 *    powinien być 0.
 *
 * Cleanup: try/finally + cleanupCharacterById.
 */

import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';
import { seedInventoryItem } from '../../fixtures/seedInventory';
import { waitForAppReady } from '../../fixtures/appReady';

test.describe('Inventory › Sell', { tag: '@inventory' }, () => {
    test.describe.configure({ timeout: 60_000 });
    // File-level retries=5 (global 2) — backstop for the App.tsx restore race
    // on `page.goto('/inventory')`; the waitForAppReady barrier below is the
    // primary fix (blocks until cloud loadGame + applyBlobToStores settle so
    // the sell mutation isn't reverted by a late blob apply).
    test.describe.configure({ retries: 5 });

    test('tap bag tile → tap "Sprzedaj" → item removed + gold counter increases by sell price', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            // 1. Seed Knight, level 5, gold 0.
            //    Domyślnie createCharacterViaApi daje gold=0 — czyli post-sell
            //    gold = 0 + sellPrice = sellPrice. Łatwo asertować.
            const created = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: nick,
                class: 'Knight',
                overrides: { level: 5, highest_level: 5, gold: 0, hp_regen: 0, mp_regen: 0 },
            });
            createdId = created.id;

            // 2. Seed 1 iron_mace (common, level 1) → sell price = floor(80 * 0.20) = 16g
            //    UWAGA: itemLevel: 1 świadomie — sell price formuła dla items z
            //    basePrice > 0 NIE skaluje po level, tylko mnoży basePrice przez
            //    rarity multiplier. Więc itemLevel nie wpływa na expected 16g.
            await seedInventoryItem({
                characterId: created.id,
                itemId: 'iron_mace',
                rarity: 'common',
                itemLevel: 1,
            });

            // 3. Login + wybierz postać + idź do /inventory
            await loginViaUI(page, testUsers.primary);
            await page.goto('/character-select');
            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await expect(card).toBeVisible({ timeout: 10_000 });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 10_000 });

            await page.goto('/inventory');
            // Hydration barrier — block until App.tsx restore() fully settled
            // (cloud loadGame + applyBlobToStores). Without this the sell
            // mutation can race a late applyBlobToStores that re-adds the
            // sold item (observed: bag-tile count 1→0→1 revert). See
            // fixtures/appReady.ts.
            await waitForAppReady(page);
            await expect(page.locator('.inventory')).toBeVisible({ timeout: 10_000 });

            // 4. Sanity — przed sprzedażą: 1 bag tile, gold = "0 gp" w TopHeader.
            //    Format "{N} gp" pochodzi z formatGoldShort() dla wartości < 1000.
            const bagTiles = page.locator('.inventory__bag-tile');
            await expect(bagTiles).toHaveCount(1, { timeout: 10_000 });
            await expect(page.locator('.top-header__gold-value')).toHaveText('0 gp');

            // 5. Tap na bag tile (klik na ItemIcon w środku tile) →
            //    otwiera DetailPanel (overlay z `.inventory__detail` root).
            //    ItemIcon ma onClick handler który wywołuje `selectBagItem(item)`
            //    (Inventory.tsx linia 420 + 4708). W trybie non-bulk → setSelected.
            await bagTiles.first().tap();
            await expect(page.locator('.inventory__detail')).toBeVisible({ timeout: 5_000 });

            // 6. Tap "Sprzedaj (16g ...)" button — tekst zawiera kwotę + ew. stones.
            //    Selektor po klasie `inventory__action-btn--sell` (Inventory.tsx
            //    linia 1168) żeby uniknąć kolizji z "Zaznacz wszystkie / Sprzedaj"
            //    multi-button (który jest disabled tutaj — multi-mode wyłączone).
            const sellBtn = page.locator('.inventory__action-btn--sell');
            await expect(sellBtn).toContainText(/Sprzedaj/);
            await sellBtn.tap();

            // 7. DetailPanel się zamknął (handleSell calls onClose).
            await expect(page.locator('.inventory__detail')).toHaveCount(0, { timeout: 5_000 });

            // 8. Bag tile zniknął — sprzedany item nie istnieje już w bagu.
            await expect(bagTiles).toHaveCount(0, { timeout: 5_000 });

            // 9. KRYTYCZNA ASERCJA: gold counter w TopHeader = "16 gp"
            //    (basePrice=80 * RARITY_SELL_MULTIPLIER.common=0.20 = 16,
            //    format "{N} gp" dla wartości < 1000).
            await expect(page.locator('.top-header__gold-value')).toHaveText('16 gp', { timeout: 5_000 });
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
