/**
 * Atomic E2E — założenie EQ pokazuje przedmiot poprawnie na paperdoll-u.
 *
 * Spec (BACKLOG.md punkt 6.1): "Zakładanie EQ pokazuje przedmioty
 * poprawnie".
 *
 * Test sprawdza najwęższe minimum: gdy item siedzi w slocie equipment
 * postaci, paperdoll w `/inventory` renderuje go jako `--filled` slot
 * (klasa `inventory__doll-slot--filled`), nie jako pusty `--empty`.
 * Bez sprawdzania ikony / koloru / nazwy — tylko binary state slot-u.
 *
 * Setup: seedujemy postać Knight + bezpośrednio wkładamy `iron_helmet`
 * do slot-a `helmet` przez `seedEquippedItem` (omijając `equip` flow w
 * UI). Następnie test loguje się + przechodzi do `/inventory` i czyta
 * klasy slot-u `inventory__doll-slot--helmet`.
 *
 * Dlaczego seed bezpośrednio do `equipment` zamiast pójść przez UI
 * (seed do bag -> tap -> tap "Załóż"):
 *  - Atomicity — ten test ma weryfikować RENDERING paperdoll-u, nie
 *    flow equip. Equip flow (bag -> DetailPanel -> "Załóż" button) jest
 *    osobny scenariusz (testowany przez `inventory/equip/equips-from-bag`,
 *    którego jeszcze nie ma w BACKLOG-u — kandydat na kolejną sesję).
 *  - Speed — pomijamy 3 dodatkowe taps i animacje DetailPanel-u.
 *  - Stable — equip flow ma side effects (HP/MP delta dla itemów z
 *    bonusami; my dajemy item bez bonusów żeby nie mieszać).
 *
 * Cleanup: try/finally + `cleanupCharacterById(createdId)`. Postać
 * usunięta = save w `game_saves` zniknie (kaskada przez
 * `CHARACTER_CHILD_TABLES`).
 *
 * Edge case parallelism: test używa primary account równolegle z innymi
 * inventory testami; każdy ma unique nick + per-character cleanup po
 * UUID, więc race conditions niemożliwe.
 */

import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';
import { seedEquippedItem } from '../../fixtures/seedInventory';

test.describe('Inventory › Equip', { tag: '@inventory' }, () => {
    test.describe.configure({ timeout: 60_000 });

    test('paperdoll shows --filled state for slot that has an equipped item', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            // 1. Seed Knight, level 5 (żeby pasował do iron_helmet minLevel=5
            //    chociaż equip check się nie odpala bo my pomijamy flow).
            //    `hp_regen: 0, mp_regen: 0` — żeby uniknąć regen tick-ów w
            //    trakcie testu (hard rule z task spec-a). Bonuses pustki
            //    żeby nie ruszać HP/MP delta po hydration.
            const created = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: nick,
                class: 'Knight',
                overrides: { level: 5, highest_level: 5, hp_regen: 0, mp_regen: 0 },
            });
            createdId = created.id;

            // 2. Seedujemy iron_helmet bezpośrednio w slot `helmet` —
            //    skipuje bag + equip flow.
            await seedEquippedItem({
                characterId: created.id,
                slot: 'helmet',
                itemId: 'iron_helmet',
                rarity: 'common',
                itemLevel: 5,
            });

            // 3. Login -> wybierz postać -> wejdź do /inventory
            await loginViaUI(page, testUsers.primary);
            await page.goto('/character-select');
            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await expect(card).toBeVisible({ timeout: 10_000 });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 10_000 });

            await page.goto('/inventory');

            // 4. Paperdoll się załadował — root container + 12 slot frames
            //    (sanity check że hydration prawidłowo wczytała blob).
            await expect(page.locator('.inventory__paperdoll')).toBeVisible({ timeout: 10_000 });
            await expect(page.locator('.inventory__doll-slot')).toHaveCount(12);

            // 5. KRYTYCZNA ASERCJA: helmet slot powinien mieć klasę
            //    `inventory__doll-slot--filled` (nie `--empty`).
            //    Klasy ustawiane w Inventory.tsx linia 3354:
            //      `inventory__doll-slot--${slot}${item ? ' --filled' : ' --empty'}`
            const helmetSlot = page.locator('.inventory__doll-slot--helmet');
            await expect(helmetSlot).toHaveClass(/inventory__doll-slot--filled/);
            await expect(helmetSlot).not.toHaveClass(/inventory__doll-slot--empty/);

            // 6. Sanity — inny slot (mainHand) który NIE ma seedu powinien
            //    być `--empty`. Asercja podwójna eliminuje false-positive
            //    typu "wszystko jest filled przez błąd CSS".
            const mainHandSlot = page.locator('.inventory__doll-slot--mainHand');
            await expect(mainHandSlot).toHaveClass(/inventory__doll-slot--empty/);
            await expect(mainHandSlot).not.toHaveClass(/inventory__doll-slot--filled/);
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
