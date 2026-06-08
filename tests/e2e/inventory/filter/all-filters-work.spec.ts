/**
 * Atomic E2E — filtry w plecaku (rarity + slot) faktycznie ograniczają widoczne tile-y.
 *
 * Spec (BACKLOG.md punkt 6.2): "Filtry w plecaku (rarity, type, level)".
 *
 * Pokrycie:
 *  • Rarity filter — tap "Rzadkie" → tylko rare items widoczne.
 *  • Slot filter — tap "Bronie" → tylko items ze slot `mainHand`/`offHand`.
 *  • Combined (po rarity tap) → reset na "Wszystkie" → wszystkie z powrotem.
 *
 * Setup: postać Knight + 3 seeded items w bag:
 *   1. wooden_mace (mainHand, common)        — broń, common
 *   2. iron_helmet (helmet, rare)           — armor, rare
 *   3. leather_armor (armor, common)        — armor, common
 *
 * Wybór items: każdy ma inną combo (slot × rarity), żeby filtry mogły
 * sortować po obu wymiarach niezależnie. iron_helmet z rarity='rare'
 * jest "syntetyczne" — w items.json jest common, ale my seedujemy
 * rarity-flag ręcznie (bonuses zostają puste; chodzi tylko o filtrowanie).
 *
 * Asercje czytają `.inventory__bag-tile` count po każdym tap-u filtra:
 *  • Default ("Wszystkie") → 3 tile-y
 *  • Tap "Rzadkie" → 1 tile (iron_helmet)
 *  • Tap "Wszystkie" → 3 tile-y (reset)
 *  • Tap "Bronie" slot filter → 1 tile (wooden_mace)
 *
 * UWAGA o stacked items: Inventory dorzuca też "stack tiles" (potions,
 * chests, stones) do bag grid (Inventory.tsx linia 2983). Nasze seed-y
 * NIE zawierają consumables ani spell chestów, więc liczba tile-i =
 * liczba seeded items. Jeśli kiedyś dorzucimy potion seed → liczby
 * trzeba poprawić ALBO dodać selektor który filtruje tylko bagowane
 * "real" itemy.
 *
 * Mobile interakcja: rarity-filter labels (`Wszystkie`, `Rzadkie`,
 * `Zwykłe`...) są w `.inventory__filter-btn`. Slot-filter labels są w
 * `.inventory__filter-btn--slot`. Same elementy = ten sam selektor
 * `inventory__filter-btn` z dodatkowym modyfikatorem. Selektywujemy po
 * `:has-text()` żeby trafić w konkretny button po tekście (i18n PL).
 *
 * Cleanup: try/finally + cleanupCharacterById.
 */

import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';
import { seedInventoryItem } from '../../fixtures/seedInventory';

test.describe('Inventory › Filter', { tag: '@inventory' }, () => {
    test.describe.configure({ timeout: 60_000 });

    test('rarity filter narrows to matching items; slot filter narrows by group; "Wszystkie" resets', async ({ page }) => {
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

            // 2. Trzy items w bagu — różne kombinacje slot × rarity.
            //    wooden_mace = mainHand (weapon), common
            //    iron_helmet = helmet (armor), rare (override z 'common')
            //    leather_armor = armor (armor), common
            await seedInventoryItem({
                characterId: created.id,
                itemId: 'wooden_mace',
                rarity: 'common',
                itemLevel: 1,
            });
            await seedInventoryItem({
                characterId: created.id,
                itemId: 'iron_helmet',
                rarity: 'rare',
                itemLevel: 5,
            });
            await seedInventoryItem({
                characterId: created.id,
                itemId: 'leather_armor',
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
            await expect(page.locator('.inventory')).toBeVisible({ timeout: 10_000 });

            // 4. Bag tiles — czekamy aż wszystkie 3 seeded items się załadują.
            //    Counter "Plecak: 3 / 1000" potwierdza że hydration zadziałała.
            await expect(page.locator('.inventory__bag-count')).toContainText('Plecak: 3', { timeout: 10_000 });
            const bagTiles = page.locator('.inventory__bag-tile');
            await expect(bagTiles).toHaveCount(3);

            // 5. Tap filtr rarity "Rzadki" (RARITY_LABELS.rare = 'Rzadki' —
            //    masc. sg., NIE "Rzadkie" plural. Auto-sell row obok ma
            //    "Rzadkie ×" jako label — to inne klasy: `inventory__auto-sell-btn`).
            //    Selektor po dokładnym tekście — `hasText: /^Rzadki$/` exact match.
            //    `.first()` bo główny rarity filter row "Rzadki" pojawia się też
            //    jako modyfikator w innych kontekstach.
            const rareFilter = page.locator('.inventory__filter-btn', { hasText: /^Rzadki$/ }).first();
            await rareFilter.tap();
            await expect(rareFilter).toHaveClass(/inventory__filter-btn--active/);

            // 6. Po tap-ie — tylko 1 tile (iron_helmet z rarity='rare') zostaje.
            await expect(bagTiles).toHaveCount(1, { timeout: 5_000 });

            // 7. Tap "Wszystkie" — reset filtra → wszystkie 3 z powrotem.
            //    UWAGA: "Wszystkie" pojawia się w obu filter rows (rarity +
            //    slot). Bierzemy ten w pierwszym row-ie (rarity). `.first()`
            //    bo `RARITY_FILTERS[0] = 'all'` jest pierwszy w grupie.
            const allRarity = page.locator('.inventory__filter-btn', { hasText: /^Wszystkie$/ }).first();
            await allRarity.tap();
            await expect(allRarity).toHaveClass(/inventory__filter-btn--active/);
            await expect(bagTiles).toHaveCount(3, { timeout: 5_000 });

            // 8. Tap filtr slot "Bronie" — slot filtry mają `--slot` modifier.
            //    SLOT_FILTERS.weapons → matchuje slot==='mainHand' || slot==='offHand'.
            //    Z naszych 3 seeded: tylko wooden_mace (mainHand) pasuje.
            const weaponsFilter = page.locator('.inventory__filter-btn--slot', { hasText: /^Bronie$/ });
            await weaponsFilter.tap();
            await expect(weaponsFilter).toHaveClass(/inventory__filter-btn--active/);
            await expect(bagTiles).toHaveCount(1, { timeout: 5_000 });
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
