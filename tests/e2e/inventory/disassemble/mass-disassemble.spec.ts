/**
 * Atomic E2E — masowe rozkładanie wybranych przedmiotów na kamienie.
 *
 * Spec (BACKLOG.md punkt 6.5): "Masowe rozkładanie".
 *
 * Test sprawdza pełen flow mass-disassemble:
 *  1. Tap "🔨 Rozloz" toggle na header-ze plecaka → bulkMode='disassemble'.
 *  2. Tap "Zaznacz wszystkie" → wszystkie 3 seeded items oznaczone.
 *  3. Stopka pokazuje "🔨 Rozloz zaznaczone (3 szt.)" → tap.
 *  4. ~1.2s animacja progress → wszystkie items znikają + popup
 *     "🔨 Rozkladanie zakonczone!" z liczbą rozłożonych przedmiotów +
 *     listą kamieni.
 *
 * Hard RNG dependency (jak single-disassemble):
 *  • `disassembleMultiple` w inventoryStore linia 441:
 *    `if (Math.random() >= 0.20) continue;`
 *  • Tylko items dla których RNG < 0.20 dają kamień. Bez stub-a wynik
 *    losowy (każdy item ma 20% szansy na stone).
 *  • Items są ZAWSZE usuwane z bagu (linia 451-453).
 *
 * Stubujemy `Math.random` → 0 (< 0.20 zawsze), więc wszystkie 3 items
 * dają kamień. Stones earned: 3 × common_stone (rarity 'common' → STONE_FOR_RARITY['common'] = 'common_stone').
 *
 * Setup: postać Knight, +3 seeded items (wszystkie common rarity).
 *
 * Asercje:
 *  • Przed: 3 bag tiles.
 *  • Tap "🔨 Rozloz" toggle → bulkMode-label "🔨 Tryb rozkladania" widoczna.
 *  • Tap "Zaznacz wszystkie" → 3 tiles z klasą --selected.
 *  • Stopka "🔨 Rozloz zaznaczone (3 szt.)" widoczna.
 *  • Tap stopki → po ~1.5s animacji: bag tiles count = 0 + popup
 *    `.inventory__bulk-result` widoczny z "Rozlozono przedmiotow: 3"
 *    + "Zwykly Kamien: x3" (3 stones earned z stubowanego RNG).
 *
 * Cleanup: try/finally + cleanupCharacterById.
 */

import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';
import { seedInventoryItem } from '../../fixtures/seedInventory';

test.describe('Inventory › Disassemble', { tag: '@inventory' }, () => {
    test.describe.configure({ timeout: 60_000 });

    test('bulk mode → select all → "Rozloz zaznaczone" → all removed + result popup with 3 stones (stubbed RNG)', async ({ page }) => {
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

            // 2. Seed 3 common items.
            for (const itemId of ['iron_mace', 'iron_sword', 'iron_helmet']) {
                await seedInventoryItem({
                    characterId: created.id,
                    itemId,
                    rarity: 'common',
                    itemLevel: 1,
                });
            }

            // 3. Login + wybierz postać + idź do /inventory.
            //    UWAGA: Math.random NIE stubujemy via addInitScript bo
            //    `src/stores/characterScope.ts:49` używa go do TAB_SESSION_ID —
            //    deterministyczne ID → konflikty tabów przy równoległych testach.
            //    Stub odpalamy DOPIERO po wejściu w /inventory (krok 5a).
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
            // Wait dla TopHeader żeby characterStore był w pełni zhydratowany
            // PRZED dalszymi akcjami. Bez tego async restore (App.tsx)
            // może zresetować inventoryStore (przez applyBlobToStores w
            // switchToCharacter) AFTER nasz tap → set bag = [seeded items]
            // → tap nie usuwa items widzianych po remount.
            await expect(page.locator('.top-header')).toBeVisible({ timeout: 15_000 });
            await expect(page.locator('.inventory')).toBeVisible({ timeout: 10_000 });

            // 5. Sanity — 3 real bag tiles.
            //    UWAGA: `.inventory__bag-tile` jest dzielony przez real bag
            //    items + stack tiles (potions/stones). Po disassemble stones
            //    pojawi się 1 stack tile z 3 common_stone → bez filtra count=4.
            //    Filtrujemy po `:has(.inventory__bag-tile-level)` — tylko real
            //    gear/weapon tiles mają `Lv X` span (Inventory.tsx linia 427).
            await expect(page.locator('.inventory__bag-count')).toContainText('Plecak: 3', { timeout: 10_000 });
            const bagTiles = page.locator('.inventory__bag-tile:has(.inventory__bag-tile-level)');
            await expect(bagTiles).toHaveCount(3);

            // 5a. Stubujemy Math.random tak żeby (a) `disassembleMultiple`
            //     dostawał < 0.20 dla każdego item-u (gotStone = true), (b)
            //     pozostałe wywołania (chatApi.subscribeAll → unique channel
            //     name, necroSummonStore, arenaStore) dostały UNIQUE wartości.
            //     Stała wartość (np. `() => 0`) BURZY te ID-y bo wszystkie
            //     calle zwracają to samo → collision → Supabase rzuca
            //     "cannot add postgres_changes callbacks for
            //     realtime:chat:all:::TIMESTAMP after subscribe()" → React
            //     crash → App unmount → test failuje z app w stanie
            //     "spinner / dragon background".
            //     Rozwiązanie: incrementing counter zwracający różne wartości
            //     każdym call-em, ale wszystkie zaczynają się od 0.10xxx →
            //     disassembleMultiple zawsze < 0.20 → gotStone true.
            //     0.10 + i*1e-8 → 7-decimal precision distinctness, all
            //     under 0.11.
            //     Robimy stub PO załadowaniu /inventory żeby characterScope
            //     już zdążył wygenerować unikalny TAB_SESSION_ID.
            await page.evaluate(() => {
                let counter = 0;
                Math.random = () => 0.10 + (counter++ % 9000000) * 1e-8;
            });

            // 6. Tap "🔨 Rozloz" toggle (multi-sell-toggle--disassemble) —
            //    Inventory.tsx linia 4297-4302.
            //    UWAGA: czekamy na stabilność elementu PRZED tap-em (czasem
            //    Inventory re-renderuje gdy bag hydration kończy się parę ms
            //    po pierwszym render). bez tego "element was detached from DOM,
            //    retrying" → timeout.
            const disassembleToggle = page.locator('.inventory__multi-sell-toggle--disassemble');
            await expect(disassembleToggle).toBeVisible();
            await disassembleToggle.tap();

            // 7. Bulk mode label "🔨 Tryb rozkladania" widoczna.
            const bulkLabel = page.locator('.inventory__bulk-mode-label');
            await expect(bulkLabel).toBeVisible({ timeout: 5_000 });
            await expect(bulkLabel).toContainText('Tryb rozkladania');

            // 8. Tap "Zaznacz wszystkie".
            await page.locator('.inventory__multi-btn--tx', { hasText: 'Zaznacz wszystkie' }).tap();
            await expect(page.locator('.inventory__bag-tile--selected')).toHaveCount(3, { timeout: 5_000 });

            // 9. Stopka "🔨 Rozloz zaznaczone (3 szt.)" pojawia się
            //    (Inventory.tsx linia 4758, klasa `inventory__mass-disassemble-btn`).
            const massDisassembleBtn = page.locator('.inventory__mass-disassemble-btn');
            await expect(massDisassembleBtn).toBeVisible({ timeout: 5_000 });
            await expect(massDisassembleBtn).toContainText('3 szt');

            // 10. Tap stopki — odpala animację rAF (~1.2s) + setTimeout 250ms.
            await massDisassembleBtn.tap();

            // 11. Animacja overlay `.inventory__disassemble-anim-overlay` pojawia
            //     się natychmiast.
            await expect(page.locator('.inventory__disassemble-anim-overlay')).toBeVisible({ timeout: 2_000 });

            // 12. Po ~1.5s (1200ms anim + 250ms cleanup): items znikają z bagu
            //     + popup wynikowy `.inventory__bulk-result` pojawia się.
            //     Generous timeout 4s na wypadek wolnego rAF.
            await expect(page.locator('.inventory__bulk-result')).toBeVisible({ timeout: 4_000 });
            await expect(bagTiles).toHaveCount(0);

            // 13. KRYTYCZNA ASERCJA — popup zawiera "Rozlozono przedmiotow: 3"
            //     i "Zwykly Kamien: x3" (3 commons → 3 common_stones).
            const resultPopup = page.locator('.inventory__bulk-result');
            await expect(resultPopup).toContainText('Rozlozono przedmiotow');
            await expect(resultPopup).toContainText('3');
            await expect(resultPopup.locator('.inventory__bulk-result-stones')).toContainText('Zwykly Kamien');
            await expect(resultPopup.locator('.inventory__bulk-result-stones')).toContainText('x3');
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
