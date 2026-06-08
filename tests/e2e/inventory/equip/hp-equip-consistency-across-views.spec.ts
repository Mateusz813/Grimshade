/**
 * Atomic E2E — HP konsystencja across 3 widoków po założeniu helmet-a
 * z +20 HP bonusem.
 *
 * Spec (BACKLOG.md punkt 6.12): "Założenie EQ → HP zwiększone na
 * wszystkich widokach (Town, TopHeader, every combat)"
 *
 * Pragmatic scoping (per session brief 2026-05-25):
 * Sprawdzamy 3 reprezentatywne widoki które renderują efektywne max HP
 * z uwzględnieniem equipment-u:
 *   1. Town `/` → `.town__bar-value`
 *      (helper `engineGetEffectiveChar` →
 *      `getTotalEquipmentStats(equipment).hp`)
 *   2. TopHeader pulse popover → `.top-header__pulse-popover-row--hp`
 *      (helper `getEffectiveChar` — same engine as Town)
 *   3. `/character-select` card → `.char-select__bar-value`
 *      (helper `getEffectiveMaxStats` — czyta equipment przez
 *      `peekCharacterStore(charId, 'inventory')` z localStorage)
 *
 * Ścieżki dla equipment:
 *  • Town/TopHeader: `useInventoryStore.getState().equipment` (in-memory
 *    Zustand store, populated po `switchToCharacter`).
 *  • CharacterSelect: `peekCharacterStore` (czyta localStorage
 *    `dungeon_rpg_save_char_<id>`).
 *
 * Każdy z nich woła `getTotalEquipmentStats(equipment, ALL_ITEMS)` i ma
 * sumować `bonuses.hp` z helmet-a. Bez konsystencji można cicho odlecieć
 * (np. dodaje się nowy bonus type ale propagacja jest nierówna).
 *
 * ## Setup
 *
 * - Knight, level 5, hp=40, mp=15, hp_regen=0, mp_regen=0.
 * - Equipped helmet `heavy_helmet_lvl5_common` z `bonuses: { hp: 20 }`,
 *   `upgradeLevel: 0` (no upgrade — sam bonus z bag).
 *
 * Why `heavy_helmet_lvl5_common` (generated item, NOT legacy
 * `iron_helmet`):
 *  • Legacy items z `items.json` (iron_helmet/leather_cap) używają
 *    `findBaseItem` path w `getTotalEquipmentStats` (linia 651) — czyta
 *    `baseAtk/baseDef` z items.json. NIE bierze pod uwagę `bonuses.hp`
 *    bo legacy gear ma stats wbity w baseDef, nie w bonuses object.
 *  • Generated items (regex `<type>_lvl<N>_<rarity>`) padają w `genInfo`
 *    fallback (linia 662) ktory czyta KAŻDY klucz z `bonuses` (linia 665)
 *    — w tym `hp`. Test seeduje `bonuses: { hp: 20 }` i `getTotalEquipmentStats`
 *    to sumuje.
 *
 * Knight class requirement spełnione: `getGeneratedItemInfo('heavy_helmet_lvl5_common')`
 * zwraca `{ type: 'heavy_helmet', slot: 'helmet' }`. `canClassEquip`
 * sprawdza prefix `heavy_` matchuje `CLASS_ARMOR_TYPES.Knight`. Ale
 * `canEquip` nie jest wywoływane bo `seedEquippedItem` zapisuje
 * bezpośrednio do `equipment.helmet` w game_saves (omijając UI flow).
 *
 * ## Expected math
 *
 * Knight base max_hp = 120 (CLASS_BASE_STATS).
 *   `getTotalEquipmentStats` zwraca `{ hp: 20, ... }` z bonus on helmet.
 *   raw = 120 + 20 (equip) + 0 + 0 + 0 = 140
 *   eff = floor(140 × 1.0 × 1.0) = 140
 *
 * Wszystkie 3 widoki muszą pokazać `40/140`.
 *
 * ## Warm flow
 *
 * Jak w testach 3.5/3.6: CharacterSelect czyta equipment z localStorage,
 * świeży character bez `switchToCharacter` ma pusty save → wymagamy
 * tap "Wybierz" PRZED finalną asercją w CharacterSelect.
 *
 * Cleanup: try/finally + `cleanupCharacterById(createdId)`.
 */

import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';
import { seedEquippedItem } from '../../fixtures/seedInventory';

test.describe('Inventory › Equip', { tag: '@inventory' }, () => {
    test.describe.configure({ timeout: 60_000 });

    test('helmet with +20 HP bonus → Town, TopHeader popover, CharacterSelect all show effective max HP', async ({ page }) => {
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

            // 2. Equip helmet z +20 HP bonusem bezpośrednio do equipment slot.
            //    `heavy_helmet_lvl5_common` to generated item id —
            //    `getGeneratedItemInfo` rozpoznaje typPart='heavy_helmet',
            //    slot='helmet'. `getTotalEquipmentStats` używa `bonuses` path
            //    (linia 662 itemSystem.ts) i sumuje hp=20.
            //    upgradeLevel=0 — bez wzmocnienia, sam flat bonus.
            await seedEquippedItem({
                characterId: created.id,
                slot: 'helmet',
                itemId: 'heavy_helmet_lvl5_common',
                rarity: 'common',
                bonuses: { hp: 20 },
                itemLevel: 5,
                upgradeLevel: 0,
            });

            // 3. Login → /character-select.
            await loginViaUI(page, testUsers.primary);
            await page.goto('/character-select');
            await expect(page.locator('.char-select__card-name', { hasText: nick })).toBeVisible({ timeout: 10_000 });

            // 4. Tap "Wybierz" → Town (warm localStorage przy okazji).
            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 10_000 });
            await expect(page.locator('.town__char-name')).toHaveText(nick);

            // 5. Read HP value from Town bar.
            //    Knight base max_hp=120 + 20 (helmet bonus) = 140.
            //    HP starts at 40 → expect `40/140`.
            const townHp = await page
                .locator('.town__bar-wrap', { has: page.locator('.town__bar--hp') })
                .locator('.town__bar-value')
                .textContent();
            expect(townHp?.trim()).toBe('40/140');

            // 6. Open TopHeader pulse popover, read HP from popover row.
            const pulseBtn = page.locator('.top-header__pulse').first();
            await expect(pulseBtn).toBeVisible({ timeout: 5_000 });
            await pulseBtn.tap();
            const popoverHp = await page
                .locator('.top-header__pulse-popover-row--hp .top-header__pulse-popover-val')
                .first()
                .textContent();
            expect(popoverHp?.trim()).toBe('40/140');

            // 7. Wróć do /character-select. localStorage ma teraz świeży save
            //    z equipped helmet. `getEffectiveMaxStats` w CharacterSelect:
            //      `peekCharacterStore(charId, 'inventory')` → `.equipment.helmet`
            //      → `getTotalEquipmentStats` → `hp: 20` → effective 140.
            await page.goto('/character-select');
            await expect(page.locator('.char-select__card-name', { hasText: nick })).toBeVisible({ timeout: 10_000 });
            const reloadedCard = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            const selectHpText = await reloadedCard
                .locator('.char-select__bar-wrap', { has: page.locator('.char-select__bar--hp') })
                .locator('.char-select__bar-value')
                .textContent();
            expect(selectHpText?.trim()).toBe('40/140');

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
