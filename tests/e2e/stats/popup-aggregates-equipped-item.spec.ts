/**
 * Atomic E2E — Stats popup agreguje base attack + equipped item bonus.
 *
 * Spec (BACKLOG.md punkt 8.1 — partial): "Stats popup agreguje: EQ +
 * transform + upgrade + eliksir + skill train + buffs". Ten test pokrywa
 * ZRODLO `EQ` w aggregation — pelne 8.1 wymaga setup wszystkich źródeł
 * jednoczesnie (transform, upgrade, eliksir, skill train, buffs) co
 * przekracza scope sesji.
 *
 * Mechanika (StatsPopupBody w Inventory.tsx linia 1574-1801):
 *   - Atak: `effAtk = Math.floor(rawAtk * (1 + tfAtkPct/100))` gdzie
 *     `rawAtk = character.attack + eqStats.attack + tfFlatAtk` (linia 1599-1600).
 *   - eqStats z getTotalEquipmentStats(equipment, ALL_ITEMS) — itemSystem.ts
 *     linia 643-673.
 *   - Dla legacy item z `baseAtk` w items.json: `getItemStats` (linia 622-641)
 *     dodaje baseAtk (skalowany upgradeLevel-em).
 *   - iron_sword (items.json): `baseAtk: 12`. Bez upgrade = 12 attack
 *     dodane do total.
 *
 * Setup state:
 *   1. Seed Knight LEVEL 5 (iron_sword minLevel=5; chocie equip check
 *      i tak nie odpala bo seedujemy bezposrednio do equipment slot).
 *      Bez tego level= 1 i UI moze pokazac warning ale niegrozne dla
 *      stats aggregation.
 *      Base attack Knight = 10 (CLASS_BASE_STATS w createCharacter.ts).
 *   2. Seed iron_sword w slot `mainHand` przez seedEquippedItem.
 *   3. Login + select character.
 *
 * Actions:
 *   1. /inventory -> tap "Statystyki" w action row.
 *   2. Popup `.inventory__popup--stats` się otwiera.
 *
 * Outcome:
 *   - Atak StatBox value === "22" (10 base + 12 iron_sword baseAtk).
 *   - Breakdown row "Baza: 10" + "Eq: +12" widoczne (linia 1666-1671).
 *
 * Cleanup: try/finally -> cleanupCharacterById.
 *
 * Sanity baseline (popup-shows-base-stats test):
 *   Knight bez EQ -> Atak = 10. Roznica 10 -> 22 = +12 dowod że eq stats
 *   sa aggregated. Gdyby agregacja nie dzialala albo iron_sword nie
 *   pickowal się — wartość zostalaby na 10.
 */

import { test, expect } from '@playwright/test';
import { testUsers } from '../fixtures/testUsers';
import { loginViaUI } from '../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../fixtures/createCharacter';
import { cleanupCharacterById } from '../fixtures/cleanup';
import { seedEquippedItem } from '../fixtures/seedInventory';

test.describe('Stats › Popup', { tag: '@stats' }, () => {
    test.describe.configure({ timeout: 60_000 });

    test('Atak stat aggregates base + equipped weapon baseAtk', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            // 1. Knight lvl 5 (iron_sword minLevel = 5).
            //    Base atk Knight = 10 (createCharacter.ts CLASS_BASE_STATS).
            const created = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: nick,
                class: 'Knight',
                overrides: { level: 5, highest_level: 5, hp_regen: 0, mp_regen: 0 },
            });
            createdId = created.id;

            // 2. Seed iron_sword w mainHand. items.json: baseAtk=12, common rarity.
            //    Bez bonuses (puste) bo getItemStats automatycznie podbije
            //    `attack` o baseAtk (legacy item path). Itemlevel=5 zeby
            //    pasowal do postaci.
            await seedEquippedItem({
                characterId: created.id,
                slot: 'mainHand',
                itemId: 'iron_sword',
                rarity: 'common',
                itemLevel: 5,
            });

            // 3. Login -> Town
            await loginViaUI(page, testUsers.primary);
            await page.goto('/character-select');
            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await expect(card).toBeVisible({ timeout: 10_000 });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });

            // 4. /inventory -> Statystyki popup
            await page.goto('/inventory');
            await expect(page.locator('.inventory__paperdoll-actions')).toBeVisible({ timeout: 10_000 });
            await page.getByRole('button', { name: /^statystyki$/i }).tap();

            const statsPopup = page.locator('.inventory__popup--stats');
            await expect(statsPopup).toBeVisible({ timeout: 5_000 });

            // 5. Sanity — popup ma "Statystyki Walki" header (linia 1652).
            await expect(statsPopup.getByText('Statystyki Walki')).toBeVisible();

            // 6. KRYTYCZNA asercja — Atak StatBox value = 22 (10 base + 12 eq).
            //    Selektor: stats-box z labelem "Atak" -> value content === "22".
            //    Pattern z popup-shows-base-stats.spec.ts (poprzednia sesja).
            const atakBox = statsPopup.locator('.inventory__stats-box', {
                has: page.locator('.inventory__stats-box-label', { hasText: /^Atak$/ }),
            });
            await expect(atakBox.locator('.inventory__stats-box-value')).toHaveText('22');

            // 7. Asercja na breakdown lines — Inventory.tsx linia 1666-1671
            //    buduje atkLines = [{Baza: 10}, {Eq: +12}]. Renderowane
            //    przez StatBox w `.inventory__stats-box-breakdown` markup.
            //    Sprawdzamy obecnosc "Eq" + "+12" gdziekolwiek w atakBox
            //    (StatBox internal layout to seperate element ale
            //    locator po tekscie wystarcza dla smoke).
            await expect(atakBox).toContainText('Baza');
            await expect(atakBox).toContainText('10');
            await expect(atakBox).toContainText('Eq');
            await expect(atakBox).toContainText('+12');
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
