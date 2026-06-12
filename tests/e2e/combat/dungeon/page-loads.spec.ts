/**
 * Atomic E2E smoke — `/dungeon` (dungeon hub) renders the dungeon list
 * panel without JS errors.
 *
 * Spec (BACKLOG.md punkt 13.5 — per-combat-type smoke, dungeon variant):
 * "Każdy typ walki E2E smoke (polowanie/raid/dungeon/boss/arena/trainer/
 * loch/transform)".
 *
 * Co testujemy (smoke only — NIE testujemy walki w dungeon):
 *  - Direct nav na `/dungeon` z aktywną postacią poprawnie renderuje
 *    `.dungeon` root + `.dungeon__panel` (phase='list' jest default —
 *    Dungeon.tsx linia 2299 `{phase === 'list' && (...)}`).
 *  - Filter bar (`.dungeon__hub-filters`) widoczny — sanity check że
 *    hydration settingsStore-a osiadła.
 *  - Co najmniej 1 dungeon card (`.dungeon__card`) widoczna — `allDungeons`
 *    data zawiera kilkaset wpisów (1..1000), każdy renderuje się jako
 *    karta (locked / dostępna / cleared), więc cards.count() jest > 0
 *    nawet dla świeżego Knight lvl 1.
 *  - Strona NIE redirectuje — CombatGuard sprawdza
 *    `combatStore.phase === 'fighting' || 'victory'`, którego nie
 *    odpalamy. ProtectedRoute przejdzie bo session jest aktywny.
 *
 * **Co NIE testujemy** (defer do osobnych speców):
 *  - Faktyczna walka w dungeon (tap "Wejdź" -> wave run -> boss -> reward).
 *  - Party mode / min-level rule (13.16) — wymagałoby multi-context.
 *  - Filter logic (już test 5.4 pokrywa monster list, dungeon parity TODO).
 *
 * **App-bug note (2026-05-25)**: Dungeon.tsx miał Rules of Hooks violation
 * podobnie jak Boss/Transform — early return `if (!character) return …`
 * na linii 505 byl PRZED `useEffect`/`useCallback` hooks (linie 525+).
 * Pierwszy render z character==null pomijał subsequent hooks; drugi render
 * z character hydrated registers them -> React Rules of Hooks detector
 * crashował <Dungeon> subtree -> `.dungeon__panel` nigdy nie mountuje się.
 * Fix: przesunięto early return POD wszystkie hooks (analogicznie do
 * Boss.tsx). Komentarz "// Dungeon render guard (after-hooks)" dla
 * przyszłych eyes.
 *
 * Seed: Knight lvl 1 (default base stats, regen off).
 *
 * Cleanup: try/finally + cleanupCharacterById.
 */

import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';

test.describe('Combat › Dungeon', { tag: '@combat' }, () => {
    test.describe.configure({ timeout: 60_000 });

    test('smoke: /dungeon renders dungeon list panel without errors', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            // 1. Seed Knight lvl 1. hp_regen/mp_regen=0 zeby HP/MP nie
            //    tickowal w trakcie testu.
            const created = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: nick,
                class: 'Knight',
                overrides: { hp_regen: 0, mp_regen: 0 },
            });
            createdId = created.id;

            // 2. Login -> wybierz postać -> Town
            await loginViaUI(page, testUsers.primary);
            await page.goto('/character-select');
            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await expect(card).toBeVisible({ timeout: 10_000 });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 10_000 });

            // 2b. Wait dla TopHeader żeby characterStore.character zostal
            //     zhydratowany przed direct-nav. Bez tego /dungeon może
            //     mountować zanim character store dostał blob -> Dungeon.tsx
            //     spinner fallback zwraca, a `.dungeon__panel` nigdy się nie
            //     pojawia w time window.
            await expect(page.locator('.top-header')).toBeVisible({ timeout: 10_000 });

            // 3. Direct nav na /dungeon. CombatGuard pozwala bo
            //    combatStore.phase = 'idle' (default).
            await page.goto('/dungeon');

            // 4. URL pozostaje /dungeon (sanity).
            await expect(page).toHaveURL(/\/dungeon$/, { timeout: 10_000 });

            // 5. Root `.dungeon` container widoczny. Spinner fallback z
            //    after-hooks guard odpada po hydratacji characterStore-a
            //    i pełny pipeline renderuje się.
            await expect(page.locator('.dungeon')).toBeVisible({ timeout: 10_000 });

            // 6. Dungeon panel (motion.div z `.dungeon__panel` linia 2329).
            //    Renderowany tylko w phase='list' branch (linia 2299) ->
            //    obecność potwierdza że ten gate przeszedł.
            await expect(page.locator('.dungeon__panel')).toBeVisible({ timeout: 15_000 });

            // 7. Filter bar widoczny (`.dungeon__hub-filters` linia 2337).
            await expect(page.locator('.dungeon__hub-filters')).toBeVisible();

            // 8. Co najmniej 1 dungeon card. allDungeons zawiera kilkaset
            //    wpisów, każdy renderuje się jako `.dungeon__card`.
            const cards = page.locator('.dungeon__card');
            await expect(cards.first()).toBeVisible({ timeout: 10_000 });
            const cardCount = await cards.count();
            expect(cardCount).toBeGreaterThanOrEqual(1);
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
