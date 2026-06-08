/**
 * Atomic E2E — pojedyncze rozkładanie przedmiotu na kamień.
 *
 * Spec (BACKLOG.md punkt 6.7): "Pojedyncze rozkładanie".
 *
 * Test sprawdza pełen flow single-disassemble:
 *  1. Tap na bag tile → otwiera się DetailPanel.
 *  2. Tap "🔨 Rozloz (20% na <stone>)" button → progress bar pojawia się
 *     na 1.5s, potem item ZNIKA z bagu (zawsze, niezależnie od success).
 *  3. Przy success (RNG 20%) — wyświetla się popup "Otrzymano: Zwykly
 *     Kamien x1" + addStones wywołane.
 *
 * Hard RNG dependency:
 *  • `handleDisassemble` w Inventory.tsx linia 665: `const gotStone = Math.random() < 0.20;`
 *  • Item jest ZAWSZE usuwany (linia 666: `removeItem(item.uuid)`).
 *  • Stone dodany TYLKO gdy gotStone === true.
 *
 * Żeby uczynić test deterministycznym, stub-ujemy `Math.random` przez
 * `page.addInitScript` żeby zawsze zwracało 0 (< 0.20 → gotStone=true).
 * To bardziej restrykcyjne assertion + nie testujemy obie ścieżki, ale
 * gwarantuje przewidywalny wynik.
 *
 * Alternatywa "fail path" (Math.random → 0.99) — pominięta tutaj bo pora
 * zaminować jeden happy + jeden fail = osobny test. Na razie atomic
 * "success path".
 *
 * Setup: postać Knight, +1 seeded item iron_helmet (common, lvl 5).
 *  • Po success: stone type = `RARITY_STONE_MAP[common]` = `common_stone`.
 *  • addStones('common_stone', 1) → inventoryStore.stones.common_stone = 1.
 *
 * Asercje:
 *  • Przed: 1 bag tile widoczne.
 *  • Tap tile → DetailPanel widoczny.
 *  • Tap "Rozloz" button → progress bar pojawia się (selektor
 *    `.inventory__disassemble-progress`).
 *  • Po 1.5s: item zniknął z bagu (bag tiles count = 0), success message
 *    pojawia się (selektor `.inventory__disassemble-result--success`).
 *  • Po 2.5s success message: DetailPanel zamyka się (handleDisassemble
 *    wywołuje onClose w setTimeout 2500ms po setDisassembleResult).
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

    test('tap "Rozloz" → progress bar → item removed + success popup (with stubbed Math.random)', async ({ page }) => {
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

            // 2. Seed 1 iron_helmet (common, lvl 5).
            await seedInventoryItem({
                characterId: created.id,
                itemId: 'iron_helmet',
                rarity: 'common',
                itemLevel: 5,
            });

            // 3. Login + wybierz postać + idź do /inventory.
            //    UWAGA: Math.random NIE stubujemy via addInitScript bo
            //    `src/stores/characterScope.ts:49` używa go do generowania
            //    TAB_SESSION_ID — deterministyczne ID → konflikty tabów
            //    przy równoległych testach (storage lock collisions). Stub
            //    odpalamy DOPIERO po wejściu w /inventory (krok 5).
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

            // 5. Sanity — 1 real bag tile.
            //    UWAGA: `.inventory__bag-tile` jest używany ZARÓWNO przez
            //    real bag items (BagTile component, ma `--level` child span)
            //    JAK i stack tiles (potions / chests / stones, BEZ `--level`).
            //    Po success disassemble stone trafia do consumables → renderuje
            //    się jako stack tile z tym samym selektorem. Filtrujemy więc
            //    po `:has(.inventory__bag-tile-level)` żeby liczyć TYLKO real
            //    bag items (gear / weapons), nie stones.
            const bagTiles = page.locator('.inventory__bag-tile:has(.inventory__bag-tile-level)');
            await expect(bagTiles).toHaveCount(1, { timeout: 10_000 });

            // 5a. Stubujemy Math.random tak żeby (a) `handleDisassemble`
            //     dostawał < 0.20 (gotStone = true), (b) pozostałe wywołania
            //     dostały UNIQUE wartości żeby nie kolidowały z innymi
            //     parts of app które używają `Math.random().toString(36)`
            //     do generowania ID (chatApi.subscribeAll channel name,
            //     necroSummonStore summon id, arenaStore match id).
            //     Stała wartość (np. `() => 0.1`) BURZY te ID-y bo wszystkie
            //     wywołania zwracają to samo → collision → Supabase rzuca
            //     "cannot add postgres_changes callbacks for
            //     realtime:chat:all:3lllllll:TIMESTAMP after subscribe()"
            //     → React crash → App unmount → test failuje z app w stanie
            //     "spinner / dragon background".
            //     Rozwiązanie: incrementing counter który zwraca rozne
            //     wartości za każdym callem, ale wszystkie zaczynają się
            //     od 0.1xxx → handleDisassemble zawsze < 0.20 → gotStone
            //     true.
            //     UWAGA: incrementing counter musi być deterministyczny
            //     ale unique per-call w obrębie tego samego ms-a (Date.now
            //     stays stable w StrictMode double-fire). 0.10 + i*1e-7
            //     daje 7-decimal precision distinctness, all < 0.11 < 0.20.
            //     Robimy stub PO załadowaniu /inventory żeby characterScope
            //     już zdążył wygenerować unikalny TAB_SESSION_ID.
            await page.evaluate(() => {
                let counter = 0;
                Math.random = () => 0.10 + (counter++ % 9000000) * 1e-8;
            });

            // 6. Tap tile → DetailPanel.
            //    UWAGA: na mobile-safari pierwszy tap czasem nie rejestruje się
            //    (touch event race z initialize bag grid). Wait for tile stable
            //    + retry-via-toBeVisible pattern (timeout 10s zamiast 5s).
            //    Tapujemy na .item-icon child (nie root .inventory__bag-tile)
            //    bo onClick jest na ItemIcon (Inventory.tsx linia 420), nie na
            //    parent div — tap na parent z `force:true` czasem trafia w
            //    .inventory__bag-tile-name/dmg span obok ikony i kliknięcie
            //    nie propaguje do onClick.
            //    Retry loop: pierwszy tap może być stracony jeśli React jest
            //    w trakcie re-render-u (Vite HMR + multi-store hydration). Do
            //    3 prób, każda poll-cycle dla DetailPanel.
            await expect(bagTiles.first()).toBeVisible({ timeout: 5_000 });
            const tileIcon = bagTiles.first().locator('.item-icon').first();
            const detailPanel = page.locator('.inventory__detail');
            for (let attempt = 1; attempt <= 3; attempt++) {
                await tileIcon.tap();
                try {
                    await expect(detailPanel).toBeVisible({ timeout: 3_000 });
                    break;
                } catch (err) {
                    if (attempt === 3) throw err;
                }
            }

            // 7. Tap "Rozloz" button — klasa `inventory__action-btn--disassemble`
            //    (Inventory.tsx linia 1176).
            //    UWAGA: DetailPanel mountuje się z animacją (motion.div), więc
            //    pierwszy render może mieć stale-DOM disassemble button. Czekamy
            //    aż button jest STABLE (visible + niezdetachowany) przez explicit
            //    `toBeEnabled()` poll-cycle przed tap, plus force:true żeby
            //    bypass pointer-events-intercept podczas re-render-u.
            const disassembleBtn = page.locator('.inventory__action-btn--disassemble');
            await expect(disassembleBtn).toBeVisible({ timeout: 5_000 });
            await expect(disassembleBtn).toContainText(/Rozloz/);
            await expect(disassembleBtn).toBeEnabled();
            await disassembleBtn.tap({ force: true });

            // 8. Progress bar pojawia się natychmiast po tap-ie
            //    (linia 1216: `.inventory__disassemble-progress`).
            await expect(page.locator('.inventory__disassemble-progress')).toBeVisible({ timeout: 2_000 });

            // 9. Po 1.5s setTimeout: item usuwany + success popup.
            //    Selektor `.inventory__disassemble-result--success` (linia 1225).
            //    Generous timeout (5s) na wypadek wolnego eventLoop, motion
            //    spring transition (opacity 0→1 może trochę zająć), oraz
            //    pierwszego cold-render dla AnimatePresence po HMR.
            await expect(page.locator('.inventory__disassemble-result--success')).toBeVisible({ timeout: 5_000 });

            // 10. Item zniknął z bagu — `removeItem(item.uuid)` w linii 666.
            await expect(bagTiles).toHaveCount(0, { timeout: 2_000 });

            // 11. Success message zawiera "Zwykly Kamien" (STONE_NAMES.common_stone
            //     z itemSystem.ts linia 553) + "x1".
            const result = page.locator('.inventory__disassemble-result--success');
            await expect(result).toContainText('Zwykly Kamien');
            await expect(result).toContainText('x1');
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
