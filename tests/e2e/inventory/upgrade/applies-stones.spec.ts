/**
 * Atomic E2E — upgrade przedmiotu konsumuje kamień + gold + bumpuje
 * `upgradeLevel` o 1.
 *
 * Spec (BACKLOG.md punkt 6.9): "Upgrade przedmiotu".
 *
 * Test sprawdza pełen flow upgrade:
 *  1. Tap na bag tile (iron_helmet common, +0) -> otwiera się DetailPanel.
 *  2. Sekcja enhance pokazuje "Ulepszenie +0 -> +1", koszt 100g + 1 Zwykly
 *     Kamień, szansa 100%.
 *  3. Tap "Ulepsz (+1)" -> progress bar 1.8s -> success result animation.
 *  4. Item w bagu pokazuje teraz `+1` overlay (ItemIcon `__upgrade` span).
 *
 * Upgrade math (z `itemSystem.ts` getEnhancementCost dla level 1):
 *  - table[1] = { stones: 1, gold: 100, successRate: 100 }
 *  - Stone type = `getRequiredStoneType('common')` = 'common_stone'
 *  - Success = `Math.random() * 100 < 100` -> ZAWSZE true gdy Math.random() < 1
 *
 * Math.random NIE jest stubowany w tym teście — successRate=100 daje 100%
 * sukces dla każdej wartości Math.random() ∈ [0, 1). Side effect — bonus
 * reroll (gdy item rare) używa innej formuły, ale my upgrade-ujemy common
 * item więc nie ma kolizji.
 *
 * Setup:
 *  - Knight, level 5, gold=200 (wystarczy na 100g koszt + zostaje).
 *  - Bag: iron_helmet (common, lvl 5, upgradeLevel=0).
 *  - Stones: { common_stone: 5 } — z głównego wystarczy 1, +zapas.
 *
 * Asercje:
 *  - Przed: bag tile widoczne, gold "200 gp".
 *  - Tap tile -> DetailPanel widoczny.
 *  - Sekcja `.inventory__detail-enhance` pokazuje "+0 -> +1" + szansa 100%
 *    + koszt 100g.
 *  - Tap "Ulepsz" button.
 *  - Po max ~3s: enhanceResult success — klasa `--success-glow` na detail-enhance
 *    (linia 1042) + success popup widoczny (klasa `__enhance-result--success`).
 *  - Item w bagu pokazuje `+1` w ItemIcon overlay (klasa `item-icon__upgrade`,
 *    tekst "+1").
 *  - Gold counter spadł do "100 gp" (200 - 100 = 100).
 *
 * Cleanup: try/finally + cleanupCharacterById.
 */

import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';
import { seedInventoryItem, seedInventoryResources } from '../../fixtures/seedInventory';

test.describe('Inventory › Upgrade', { tag: '@inventory' }, () => {
    test.describe.configure({ timeout: 60_000 });

    test('apply +1 upgrade to common item -> item gets +1 badge + gold/stones consumed', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            // 1. Seed Knight, level 5, gold=200.
            const created = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: nick,
                class: 'Knight',
                overrides: { level: 5, highest_level: 5, gold: 200, hp_regen: 0, mp_regen: 0 },
            });
            createdId = created.id;

            // 2. Seed iron_helmet common +0.
            await seedInventoryItem({
                characterId: created.id,
                itemId: 'iron_helmet',
                rarity: 'common',
                itemLevel: 5,
                upgradeLevel: 0,
            });

            // 3. Seed 5 common_stones + gold (gold 200 wymaga override gold field
            //    w game_saves blob — character row to inny field).
            //    Powód: inventoryStore.gold hydratuje się z game_saves.inventory.gold,
            //    NIE z characters.gold (patrz fixtures/seedGameSave.ts komentarz).
            await seedInventoryResources({
                characterId: created.id,
                gold: 200,
                stones: { common_stone: 5 },
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

            // 5. Sanity — 1 real bag tile + gold = 200.
            //    UWAGA: `.inventory__bag-tile` jest dzielony przez real bag
            //    items (BagTile component) ORAZ stack tiles (stones/potions
            //    z `inventoryStore.consumables/stones`). Seeded common_stones
            //    pokazują się jako stack tile -> musimy filtrować po
            //    `:has(.inventory__bag-tile-level)` żeby liczyć tylko gear
            //    items (które mają `<span class="...bag-tile-level">Lv X</span>`).
            //    Gold value — czytamy `aria-label` z `.top-header__gold-btn`
            //    (TopHeader.tsx linia 329) który używa raw `gold` ze store-u,
            //    NIE displayGold który ma 600ms rAF animation count-up (flaky
            //    w headless mode gdy rAF throttluje).
            const bagTiles = page.locator('.inventory__bag-tile:has(.inventory__bag-tile-level)');
            await expect(bagTiles).toHaveCount(1, { timeout: 10_000 });
            const goldBtn = page.locator('.top-header__gold-btn');
            await expect(goldBtn).toHaveAttribute('aria-label', 'Złoto: 200');

            // 6. Tap tile -> DetailPanel.
            await bagTiles.first().tap();
            await expect(page.locator('.inventory__detail')).toBeVisible({ timeout: 5_000 });

            // 7. Sekcja enhance widoczna: `.inventory__detail-enhance`.
            //    Pokazuje "Ulepszenie +0 -> +1" + szansa 100% + koszt 100g.
            const enhanceSection = page.locator('.inventory__detail-enhance');
            await expect(enhanceSection).toBeVisible({ timeout: 5_000 });
            await expect(enhanceSection).toContainText('+0');
            await expect(enhanceSection).toContainText('+1');
            await expect(enhanceSection).toContainText('100%');

            // 8. Tap "Ulepsz (+1)" button — klasa `inventory__action-btn--enhance`.
            const enhanceBtn = page.locator('.inventory__action-btn--enhance');
            await expect(enhanceBtn).toBeEnabled({ timeout: 2_000 });
            await expect(enhanceBtn).toContainText(/Ulepsz/);
            await enhanceBtn.tap();

            // 9. Po 1.8s setTimeout: success result animation pojawia się.
            //    Klasa `inventory__enhance-result--success` (linia 1085 motion.div).
            //    Generous timeout 4s żeby objąć rare slowdown.
            await expect(page.locator('.inventory__enhance-result--success')).toBeVisible({ timeout: 4_000 });

            // 10. Zamknij DetailPanel (klik na X close) żeby zobaczyć ItemIcon
            //     w bagu z nowym +1 overlay. enhanceResult animation auto-clears
            //     po 3s (setTimeout linia 1026), ale my zamykamy ręcznie.
            await page.locator('.inventory__detail-close').tap();
            await expect(page.locator('.inventory__detail')).toHaveCount(0, { timeout: 3_000 });

            // 11. KRYTYCZNA ASERCJA #1: gold spadł do 100 (200 - 100 = 100).
            //     `spendGold(100)` wywołane w handleEnhance line 967.
            //     Asercja po aria-label (raw value, no animation flake).
            //     Sprawdzamy GOLD PIERWSZY (przed +1 badge) — synchronicznie ustawiany
            //     w handleEnhance ZANIM setTimeout dla animation odpali. Jeśli ten
            //     się nie zgadza -> wiemy że spendGold zwróciło false (brak gold/stones).
            await expect(goldBtn).toHaveAttribute('aria-label', 'Złoto: 100', { timeout: 15_000 });

            // 12. KRYTYCZNA ASERCJA #2: ItemIcon overlay `.item-icon__upgrade`
            //     z tekstem "+1" pojawia się na bag tile.
            //     ItemIcon.tsx linia 83-84:
            //       `{(upgradeLevel ?? 0) > 0 && <span class="item-icon__upgrade">+{upgradeLevel}</span>}`
            //     Generous timeout (5s) bo upgradeItem wywołane w finishUp wewnątrz
            //     setTimeout 1.8s — może być rare race z React re-render.
            const upgradeOverlay = bagTiles.first().locator('.item-icon__upgrade');
            await expect(upgradeOverlay).toBeVisible({ timeout: 5_000 });
            await expect(upgradeOverlay).toHaveText('+1');
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
