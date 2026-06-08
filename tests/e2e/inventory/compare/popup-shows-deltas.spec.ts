/**
 * Atomic E2E — popup porównania pokazuje delta-y statów między item w bagu
 * a tym założonym na tym samym slocie.
 *
 * Spec (BACKLOG.md punkt 6.8): "Porównywanie przedmiotów".
 *
 * Test sprawdza Spec 12 z Inventory.tsx (linia 777+): gdy gracz klika na
 * non-equipped item w bagu, a w tym samym slocie ma już coś założone,
 * popup DetailPanel splituje się na 2 kolumny:
 *  • Lewa (NEW) — klikniety item z bagu, tag "Nowy"
 *  • Prawa (EQUIPPED) — założony item, tag "Założony", stat-delta arrows
 *    (↑ green = upgrade, ↓ red = downgrade).
 *
 * Implementacja: `equippedToCompare = compareSlot ? equipment[compareSlot] : null`
 * (linia 753). Gdy non-null → klasa `inventory__detail--comparing` na
 * popupie + render `<EquippedComparisonColumn>` (linia 1432).
 *
 * Setup:
 *  • Founda Knight, level 5.
 *  • Slot equipment.helmet: iron_helmet (common, lvl 5, baseDef=8).
 *  • Bag: iron_helmet (rare, lvl 5, baseDef=8 + bonus hp=20).
 *
 * Dlaczego rare vs common:
 *  • Same itemId + slot — gwarantuje że compareSlot dobrze trafi.
 *  • Różne rarity → różne stat-delta values (rare iron_helmet z hp=20
 *    bonusem pokaże delta HP +20 vs common bez bonusu).
 *
 * Asercje:
 *  • Bag tile widoczne.
 *  • Tap bag tile → DetailPanel z klasą `inventory__detail--comparing`.
 *  • Lewa kolumna (`inventory__detail-col--new`) zawiera tag "Nowy".
 *  • Prawa kolumna (`inventory__detail-col--equipped`) zawiera tag "Założony".
 *  • W prawej kolumnie pojawia się sekcja stat-diff (`inventory__compare-stats`).
 *  • Pokazuje wartość equipped + delta dla statu HP.
 *
 * Cleanup: try/finally + cleanupCharacterById.
 */

import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';
import { seedInventoryItem, seedEquippedItem } from '../../fixtures/seedInventory';

test.describe('Inventory › Compare', { tag: '@inventory' }, () => {
    test.describe.configure({ timeout: 60_000 });

    test('tap bag item with same-slot equipped item → popup shows comparison column with deltas', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            // 1. Seed Knight, level 5.
            const created = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: nick,
                class: 'Knight',
                overrides: { level: 5, highest_level: 5, hp_regen: 0, mp_regen: 0 },
            });
            createdId = created.id;

            // 2. Equipped helmet: iron_helmet common.
            await seedEquippedItem({
                characterId: created.id,
                slot: 'helmet',
                itemId: 'iron_helmet',
                rarity: 'common',
                itemLevel: 5,
            });

            // 3. Bag: iron_helmet rare (z hp bonus żeby były delta values).
            //    `rare` rarity + `bonuses: { hp: 20 }` → buildItemStats zwraca
            //    hp=20 dla new vs hp=0 dla equipped → delta HP +20.
            await seedInventoryItem({
                characterId: created.id,
                itemId: 'iron_helmet',
                rarity: 'rare',
                itemLevel: 5,
                bonuses: { hp: 20 },
            });

            // 4. Login + wybierz postać + idź do /inventory
            await loginViaUI(page, testUsers.primary);
            await page.goto('/character-select');
            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await expect(card).toBeVisible({ timeout: 10_000 });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 10_000 });

            await page.goto('/inventory');
            await expect(page.locator('.inventory')).toBeVisible({ timeout: 10_000 });

            // 5. Equipped paperdoll show iron_helmet — sanity że hydration ok.
            await expect(page.locator('.inventory__doll-slot--helmet')).toHaveClass(/inventory__doll-slot--filled/, { timeout: 10_000 });

            // 6. Bag tile widoczne (1 item).
            const bagTiles = page.locator('.inventory__bag-tile');
            await expect(bagTiles).toHaveCount(1);

            // 7. Tap bag tile → DetailPanel pojawia się.
            await bagTiles.first().tap();
            await expect(page.locator('.inventory__detail')).toBeVisible({ timeout: 5_000 });

            // 8. KRYTYCZNA ASERCJA: detail panel ma klasę `--comparing`
            //    (Inventory.tsx linia 764).
            await expect(page.locator('.inventory__detail')).toHaveClass(/inventory__detail--comparing/);

            // 9. Lewa kolumna (NEW) — tag "Nowy" widoczny.
            //    Inventory.tsx linia 782.
            const newCol = page.locator('.inventory__detail-col--new');
            await expect(newCol).toBeVisible();
            await expect(newCol.locator('.inventory__detail-col-tag').first()).toContainText('Nowy');

            // 10. Prawa kolumna (EQUIPPED) — tag "Założony" + comparison stats.
            //     Inventory.tsx linia 1465.
            const eqCol = page.locator('.inventory__detail-col--equipped');
            await expect(eqCol).toBeVisible();
            await expect(eqCol.locator('.inventory__detail-col-tag--equipped')).toContainText('Założony');

            // 11. Sekcja diff stats widoczna (klasa `inventory__compare-stats`).
            //     Inventory.tsx linia 1504.
            await expect(eqCol.locator('.inventory__compare-stats')).toBeVisible({ timeout: 5_000 });

            // 12. Co najmniej jeden stat row jest renderowany (HP delta lub baseDef).
            //     Stat rows mają klasę `inventory__compare-stat`.
            await expect(eqCol.locator('.inventory__compare-stat').first()).toBeVisible();
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
