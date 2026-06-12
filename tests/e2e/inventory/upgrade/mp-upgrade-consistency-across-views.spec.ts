/**
 * Atomic E2E — MP konsystencja across 3 widoków po założeniu UPGRADED
 * helmet-a z +20 MP bonusem (+3 enhance).
 *
 * Spec (BACKLOG.md punkt 3.10): "MP — wszystkie powyższe wzorce dla HP".
 * Ten test to MP analogue do 6.13 (`hp-upgrade-consistency-across-views.spec.ts`).
 *
 * **Kluczowa różnica vs HP analog 6.13**: MP NIE jest base stat dla żadnego
 * slot-u (patrz `getBaseStatKeysForSlot` w itemSystem.ts linia 490 —
 * helmet/armor/pants/shoulders/boots -> `['hp']`, gloves/ring -> `['attack']`,
 * necklace/earrings -> `['defense']`, weapon -> `['dmg_min', 'dmg_max', ...]`).
 *
 * Konsekwencja w `getTotalEquipmentStats` (itemSystem.ts linia 662-670):
 *   ```
 *   const isBase = isBaseStatKey(slot, key);
 *   const finalVal = isBase ? getUpgradedBaseStat(val, upgradeLevel) : val;
 *   ```
 *
 * Dla `slot='helmet'` + `key='mp'`: isBaseStatKey -> false -> finalVal = val
 * (flat, **NIE** mnożone przez upgrade multiplier). Więc helmet z
 * `bonuses: { mp: 20 }` i `upgradeLevel: 3` daje +20 MP, NIE +30 (jak HP
 * w analogicznym teście 6.13).
 *
 * **Sens tego testu**: gwarantuje że NON-BASE stat (mp na helmet) zostaje
 * flat we wszystkich 3 ścieżkach renderowania, niezależnie od upgrade
 * level-a. Regression guard przeciw scenariuszowi "ktoś dodał MP do
 * helmet base-stat list dla jednej ścieżki ale nie dla pozostałych" —
 * wtedy Town pokazałby `80/230` (upgrade scaled) a CharacterSelect
 * `80/220` (flat).
 *
 * Pragmatic scoping (mirrors 6.13 pattern):
 * Sprawdzamy 3 reprezentatywne widoki:
 *   1. Town `/` -> MP `.town__bar-value`
 *   2. TopHeader pulse popover -> `.top-header__pulse-popover-row--mp`
 *   3. `/character-select` card -> MP `.char-select__bar-value`
 *
 * ## Setup
 *
 * - **Mage**, level 5, mp=80, hp_regen=0, mp_regen=0.
 * - Equipped helmet `heavy_helmet_lvl5_common` z `bonuses: { mp: 20 }`,
 *   **upgradeLevel: 3** (kluczowa różnica vs test 3.10c — upgrade włączony).
 *
 * ## Expected math
 *
 * `isBaseStatKey('helmet', 'mp')` = false -> mp bonus zostaje flat 20.
 *
 *   raw = 200 (Mage base) + 20 (helmet flat, upgrade NIE scale-uje) + 0 + 0 + 0
 *       = 220
 *   eff = floor(220 × 1.0 × 1.0) = 220
 *
 * Wszystkie 3 widoki muszą pokazać `80/220` — IDENTYCZNIE jak w teście
 * 3.10c (bez upgrade), bo upgrade nie wpływa na non-base stat.
 *
 * Test guard: gdyby kiedyś `mp` zostało dodane do `getBaseStatKeysForSlot`
 * dla helmet-a (np. spec "MP gear scales with upgrade"), to test poleci
 * z `80/220` zamiast nowej `80/230` — sygnał że trzeba zaktualizować
 * BOTH expected math TUTAJ AND w 3.10c (żeby zachować spójność).
 *
 * ## Warm flow
 *
 * Jak w testach 3.5/3.6/6.12/6.13: `peekCharacterStore` czyta localStorage,
 * wymagamy "Wybierz" PRZED finalną asercją w CharacterSelect.
 *
 * Cleanup: try/finally + `cleanupCharacterById(createdId)`.
 */

import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';
import { seedEquippedItem } from '../../fixtures/seedInventory';

test.describe('Inventory › Upgrade', { tag: '@inventory' }, () => {
    test.describe.configure({ timeout: 60_000 });

    test('helmet +3 with +20 MP bonus -> Town, TopHeader popover, CharacterSelect all show same flat max MP (upgrade does NOT scale non-base stat)', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            // 1. Seed Mage z under-max MP + zero regen.
            const created = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: nick,
                class: 'Mage',
                overrides: { hp: 50, mp: 80, level: 5, highest_level: 5, hp_regen: 0, mp_regen: 0 },
            });
            createdId = created.id;

            // 2. Equip upgraded helmet z +20 MP bonusem.
            //    Helmet's base stat to `hp` (per `getBaseStatKeysForSlot`).
            //    Klucz `mp` NIE jest base stat -> upgradeLevel=3 nie wpływa.
            //    Flat 20 MP zostaje w `getTotalEquipmentStats`.
            await seedEquippedItem({
                characterId: created.id,
                slot: 'helmet',
                itemId: 'heavy_helmet_lvl5_common',
                rarity: 'common',
                bonuses: { mp: 20 },
                itemLevel: 5,
                upgradeLevel: 3,
            });

            // 3. Login -> /character-select.
            await loginViaUI(page, testUsers.primary);
            await page.goto('/character-select');
            await expect(page.locator('.char-select__card-name', { hasText: nick })).toBeVisible({ timeout: 10_000 });

            // 4. Tap "Wybierz" -> Town (warm localStorage).
            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 10_000 });
            await expect(page.locator('.town__char-name')).toHaveText(nick);

            // 5. Read MP value from Town bar.
            //    Mage base 200 + 20 (flat MP, upgrade NIE scale-uje) = 220.
            //    MP=80 -> expect `80/220` (NIE `80/230` jak HP w 6.13).
            const townMp = await page
                .locator('.town__bar-wrap', { has: page.locator('.town__bar--mp') })
                .locator('.town__bar-value')
                .textContent();
            expect(townMp?.trim()).toBe('80/220');

            // 6. Open TopHeader pulse popover, read MP from popover row.
            const pulseBtn = page.locator('.top-header__pulse').first();
            await expect(pulseBtn).toBeVisible({ timeout: 5_000 });
            await pulseBtn.tap();
            const popoverMp = await page
                .locator('.top-header__pulse-popover-row--mp .top-header__pulse-popover-val')
                .first()
                .textContent();
            expect(popoverMp?.trim()).toBe('80/220');

            // 7. Wróć do /character-select. `getEffectiveMaxStats` w
            //    CharacterSelect ma TĄ SAMĄ ścieżkę `getTotalEquipmentStats`
            //    -> mp bonus zostaje flat 20, niezależnie od upgradeLevel-a.
            //    Effective 220.
            await page.goto('/character-select');
            await expect(page.locator('.char-select__card-name', { hasText: nick })).toBeVisible({ timeout: 10_000 });
            const reloadedCard = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            const selectMpText = await reloadedCard
                .locator('.char-select__bar-wrap', { has: page.locator('.char-select__bar--mp') })
                .locator('.char-select__bar-value')
                .textContent();
            expect(selectMpText?.trim()).toBe('80/220');

            // 8. KRYTYCZNA ASERCJA: wszystkie 3 widoki ten sam string.
            //    Gwarantuje że non-base stat (mp na helmet) traktowane jest
            //    flat we wszystkich 3 ścieżkach.
            expect(townMp?.trim()).toBe(popoverMp?.trim());
            expect(popoverMp?.trim()).toBe(selectMpText?.trim());
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
