/**
 * Atomic E2E — MP konsystencja across 3 widoków po założeniu helmet-a
 * z +20 MP bonusem.
 *
 * Spec (BACKLOG.md punkt 3.10): "MP — wszystkie powyższe wzorce dla HP".
 * Ten test to MP analogue do 6.12 (`hp-equip-consistency-across-views.spec.ts`).
 *
 * Pragmatic scoping (per session brief 2026-05-25):
 * Sprawdzamy 3 reprezentatywne widoki które renderują efektywne max MP
 * z uwzględnieniem equipment-u:
 *   1. Town `/` -> MP `.town__bar-value` (Town.tsx linia 334)
 *      (helper `engineGetEffectiveChar` ->
 *      `getTotalEquipmentStats(equipment).mp`)
 *   2. TopHeader pulse popover -> `.top-header__pulse-popover-row--mp`
 *      (helper `getEffectiveChar` — same engine as Town)
 *   3. `/character-select` card -> MP `.char-select__bar-value`
 *      (helper `getEffectiveMaxStats` — czyta equipment przez
 *      `peekCharacterStore(charId, 'inventory')` z localStorage)
 *
 * Ścieżki dla equipment:
 *  - Town/TopHeader: `useInventoryStore.getState().equipment` (in-memory
 *    Zustand store, populated po `switchToCharacter`).
 *  - CharacterSelect: `peekCharacterStore` (czyta localStorage
 *    `dungeon_rpg_save_char_<id>`).
 *
 * Każdy z nich woła `getTotalEquipmentStats(equipment, ALL_ITEMS)` i ma
 * sumować `bonuses.mp` z helmet-a. Bez konsystencji można cicho odlecieć
 * (np. dodaje się nowy bonus type ale propagacja jest nierówna).
 *
 * ## Setup
 *
 * - **Mage**, level 5, mp=80, hp_regen=0, mp_regen=0.
 * - Equipped helmet `heavy_helmet_lvl5_common` z `bonuses: { mp: 20 }`,
 *   `upgradeLevel: 0` (no upgrade — sam bonus z bag).
 *
 * Why `heavy_helmet_lvl5_common` (generated item, NOT legacy `iron_helmet`):
 *  - Legacy items z `items.json` (iron_helmet/leather_cap) używają
 *    `findBaseItem` path w `getTotalEquipmentStats` (linia 651) — czyta
 *    `baseAtk/baseDef` z items.json. NIE bierze pod uwagę `bonuses.mp`
 *    bo legacy gear ma stats wbity w baseDef, nie w bonuses object.
 *  - Generated items (regex `<type>_lvl<N>_<rarity>`) padają w `genInfo`
 *    fallback (linia 662) ktory czyta KAŻDY klucz z `bonuses` (linia 665)
 *    — w tym `mp`. Test seeduje `bonuses: { mp: 20 }` i `getTotalEquipmentStats`
 *    to sumuje. Patrz `isBaseStatKey(slot, key)` w itemSystem.ts linia 518:
 *    dla `slot='helmet'` base stat keys = `['hp']`, więc `mp` NIE jest
 *    base -> upgrade multiplier NIE jest aplikowany, mp zostaje flat 20.
 *
 * Klasa Mage zamiast Knight bo Mage ma większą baseline max_mp (200 vs 30),
 * więc 20 MP od item-u stanowi widoczną deltę w UI (Mage 200 -> 220), nie
 * marginalną zmianę widoczną głównie w pikselu progress bara.
 *
 * Knight by też zadziałało (max_mp 30 -> 50) ale w UI to ułamek bara —
 * dla człowieka który ogląda screenshot trudne do dostrzeżenia.
 *
 * ## Expected math
 *
 * Mage base max_mp = 200 (CLASS_BASE_STATS).
 *   `getTotalEquipmentStats` zwraca `{ mp: 20, ... }` z bonus on helmet.
 *   raw = 200 + 20 (equip) + 0 + 0 + 0 = 220
 *   eff = floor(220 × 1.0 × 1.0) = 220
 *
 * Wszystkie 3 widoki muszą pokazać `80/220`.
 *
 * ## Warm flow
 *
 * Jak w testach 3.5/3.6/6.12/6.13: CharacterSelect czyta equipment z
 * localStorage, świeży character bez `switchToCharacter` ma pusty save
 * -> wymagamy tap "Wybierz" PRZED finalną asercją w CharacterSelect.
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

    test('helmet with +20 MP bonus -> Town, TopHeader popover, CharacterSelect all show effective max MP', async ({ page }) => {
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

            // 2. Equip helmet z +20 MP bonusem bezpośrednio do equipment slot.
            //    `heavy_helmet_lvl5_common` to generated item id —
            //    `getGeneratedItemInfo` rozpoznaje typPart='heavy_helmet',
            //    slot='helmet'. `getTotalEquipmentStats` używa `bonuses` path
            //    (linia 662 itemSystem.ts) i sumuje mp=20 (flat, bo mp nie
            //    jest base stat dla helmet-a — patrz `getBaseStatKeysForSlot`
            //    linia 490).
            //    upgradeLevel=0 — bez wzmocnienia, sam flat bonus.
            await seedEquippedItem({
                characterId: created.id,
                slot: 'helmet',
                itemId: 'heavy_helmet_lvl5_common',
                rarity: 'common',
                bonuses: { mp: 20 },
                itemLevel: 5,
                upgradeLevel: 0,
            });

            // 3. Login -> /character-select.
            await loginViaUI(page, testUsers.primary);
            await page.goto('/character-select');
            await expect(page.locator('.char-select__card-name', { hasText: nick })).toBeVisible({ timeout: 10_000 });

            // 4. Tap "Wybierz" -> Town (warm localStorage przy okazji).
            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 10_000 });
            await expect(page.locator('.town__char-name')).toHaveText(nick);

            // 5. Read MP value from Town bar.
            //    Mage base max_mp=200 + 20 (helmet bonus) = 220.
            //    MP starts at 80 -> expect `80/220`.
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

            // 7. Wróć do /character-select. localStorage ma teraz świeży save
            //    z equipped helmet. `getEffectiveMaxStats` w CharacterSelect:
            //      `peekCharacterStore(charId, 'inventory')` -> `.equipment.helmet`
            //      -> `getTotalEquipmentStats` -> `mp: 20` -> effective 220.
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
            expect(townMp?.trim()).toBe(popoverMp?.trim());
            expect(popoverMp?.trim()).toBe(selectMpText?.trim());
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
