/**
 * Atomic E2E — HP konsystencja across 3 widoków po założeniu UPGRADED
 * helmet-a z +20 HP bonusem (+3 enhance).
 *
 * Spec (BACKLOG.md punkt 6.13): "Upgrade EQ z +HP -> ta sama konsystencja"
 *
 * Komplementarny do punktu 6.12 (`hp-equip-consistency-across-views`)
 * — różnica: ten test ustawia `upgradeLevel: 3` żeby zweryfikować że
 * `getUpgradedBaseStat` multiplier (`getEnhancementMultiplier(3) = 1.15^3
 * ≈ 1.521`) jest aplikowany SPÓJNIE na wszystkich 3 widokach.
 *
 * Pragmatic scoping (per session brief 2026-05-25):
 * Sprawdzamy 3 reprezentatywne widoki:
 *   1. Town `/` -> `.town__bar-value`
 *   2. TopHeader pulse popover -> `.top-header__pulse-popover-row--hp`
 *   3. `/character-select` card -> `.char-select__bar-value`
 *
 * Wszystkie 3 czytają equipment przez `getTotalEquipmentStats`, ktore
 * dla generated items (linia 662-670 itemSystem.ts) sprawdza
 * `isBaseStatKey(slot, key)`. Dla `slot='helmet'` + `key='hp'` -> true ->
 * stosuje `getUpgradedBaseStat(20, 3) = 30`.
 *
 * Test guard przeciw regresji typu "upgrade multiplier działa w Town ale
 * w CharacterSelect helper nie jest aktualizowany". Bez tej spójności
 * gracz widzi inne HP zależnie od widoku -> frustracja.
 *
 * ## Setup
 *
 * - Knight, level 5, hp=40, mp=15, hp_regen=0, mp_regen=0.
 * - Equipped helmet `heavy_helmet_lvl5_common` z `bonuses: { hp: 20 }`,
 *   **upgradeLevel: 3** (kluczowa różnica vs test 6.12).
 *
 * ## Expected math (z `getUpgradedBaseStat`):
 *
 * `getUpgradedBaseStat(baseValue, upgradeLevel)`:
 *   multiplied = round(baseValue × getEnhancementMultiplier(upgradeLevel))
 *   flatFloor = baseValue + upgradeLevel
 *   return max(multiplied, flatFloor)
 *
 * `getEnhancementMultiplier(upgradeLevel)`:
 *   upgradeLevel ≤ 10: pow(1.15, upgradeLevel)
 *
 * Dla baseValue=20, upgradeLevel=3:
 *   getEnhancementMultiplier(3) = 1.15^3 = 1.520875
 *   multiplied = round(20 × 1.520875) = round(30.4175) = 30
 *   flatFloor = 20 + 3 = 23
 *   return max(30, 23) = 30
 *
 * Knight base max_hp = 120 + 30 (upgraded helmet hp) = 150.
 *   raw = 120 + 30 + 0 + 0 + 0 = 150
 *   eff = floor(150 × 1.0 × 1.0) = 150
 *
 * Wszystkie 3 widoki muszą pokazać `40/150`.
 *
 * ## Warm flow
 *
 * Jak w testach 3.5/3.6/6.12: `peekCharacterStore` czyta localStorage,
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

    test('helmet +3 with +20 HP base -> Town, TopHeader popover, CharacterSelect all show upgraded max HP', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            // 1. Seed Knight z under-max HP + zero regen.
            const created = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: nick,
                class: 'Knight',
                overrides: { hp: 40, mp: 15, level: 5, highest_level: 5, hp_regen: 0, mp_regen: 0 },
            });
            createdId = created.id;

            // 2. Equip upgraded helmet z +20 HP base bonusem.
            //    helmet's base stat to `hp` (per `getBaseStatKeysForSlot`) ->
            //    `getTotalEquipmentStats` wywołuje `getUpgradedBaseStat(20, 3)`
            //    -> 30 effective HP od tego helmet-a.
            await seedEquippedItem({
                characterId: created.id,
                slot: 'helmet',
                itemId: 'heavy_helmet_lvl5_common',
                rarity: 'common',
                bonuses: { hp: 20 },
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

            // 5. Read HP value from Town bar.
            //    Knight base 120 + 30 (upgraded helmet) = 150.
            //    HP=40 -> expect `40/150`.
            const townHp = await page
                .locator('.town__bar-wrap', { has: page.locator('.town__bar--hp') })
                .locator('.town__bar-value')
                .textContent();
            expect(townHp?.trim()).toBe('40/150');

            // 6. Open TopHeader pulse popover, read HP from popover row.
            const pulseBtn = page.locator('.top-header__pulse').first();
            await expect(pulseBtn).toBeVisible({ timeout: 5_000 });
            await pulseBtn.tap();
            const popoverHp = await page
                .locator('.top-header__pulse-popover-row--hp .top-header__pulse-popover-val')
                .first()
                .textContent();
            expect(popoverHp?.trim()).toBe('40/150');

            // 7. Wróć do /character-select. `getEffectiveMaxStats` w
            //    CharacterSelect ma TĄ SAMĄ ścieżkę `getTotalEquipmentStats`
            //    -> applies `getUpgradedBaseStat(20, 3) = 30`. Effective 150.
            await page.goto('/character-select');
            await expect(page.locator('.char-select__card-name', { hasText: nick })).toBeVisible({ timeout: 10_000 });
            const reloadedCard = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            const selectHpText = await reloadedCard
                .locator('.char-select__bar-wrap', { has: page.locator('.char-select__bar--hp') })
                .locator('.char-select__bar-value')
                .textContent();
            expect(selectHpText?.trim()).toBe('40/150');

            // 8. KRYTYCZNA ASERCJA: wszystkie 3 widoki ten sam string.
            expect(townHp?.trim()).toBe(popoverHp?.trim());
            expect(popoverHp?.trim()).toBe(selectHpText?.trim());
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
