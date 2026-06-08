/**
 * Atomic E2E — w trybie Offline próba wejścia na `/party` (online-only
 * route gated przez `OnlineOnlyGuard`) skutkuje redirectem.
 *
 * Spec (BACKLOG 14.1): "Offline mode: tylko dozwolone widoki dostępne
 * (...) Try to navigate to an online-only view (e.g., /party, /market,
 * /arena) — should redirect or show blocked screen via OnlineOnlyGuard".
 *
 * `OnlineOnlyGuard.tsx` linia 43-47: gdy `mode === 'offline'`,
 * `<Navigate to="/" replace state={{ blockedFrom: ... }} />` — redirect
 * synchroniczny. Te routy są gated (AppRouter.tsx):
 *   /arena, /arena/match — PvP
 *   /raid                — party-only
 *   /party               — managing party gdy nie ma sensu offline
 *   /market              — player trading wymaga drugiego usera
 *   /chat                — global chat (Realtime)
 *   /friends, /social    — interakcje społeczne
 *   /leaderboard         — rankingi (server-side data)
 *   /deaths              — global deaths feed
 *
 * Testujemy `/party` jako reprezentatywny (atomic — jedna route, nie
 * sprawdzamy każdej z osobna, bo to ten sam Guard component dla
 * wszystkich → wystarczy 1 test pokrywający contract).
 *
 * Strategy: przełączamy tryb przez AvatarMenu (Online → Offline)
 * ZANIM próbujemy wejść na `/party`. Test 1
 * (`mode-toggle-flips-status-dot.spec.ts`) pokrywa że UI toggle DZIAŁA;
 * tu zakładamy że po `setMode('offline')` Guard wykryje stan z
 * connectivityStore i zablokuje route.
 *
 * Setup:
 *   1. Seed character przez API.
 *   2. Login UI + wybór seedowanej postaci → Town (`/`).
 *   3. Open AvatarMenu → tap "Offline" → status dot --offline.
 *   4. Próba nawigacji na `/party` przez page.goto → redirect.
 *
 * Cleanup: try/finally + cleanupCharacterById.
 */

import { test, expect } from '@playwright/test';
import { testUsers } from '../fixtures/testUsers';
import { loginViaUI } from '../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../fixtures/createCharacter';
import { cleanupCharacterById } from '../fixtures/cleanup';

test.describe('Offline › Mode', { tag: '@offline' }, () => {
    test.describe.configure({ timeout: 60_000 });

    test('navigating to /party while offline does NOT mount Party view', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            // 1. Seed Knight + zero regen.
            const created = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: nick,
                class: 'Knight',
                overrides: { hp_regen: 0, mp_regen: 0 },
            });
            createdId = created.id;

            // 2. Login + wybór NASZEJ postaci → Town.
            await loginViaUI(page, testUsers.primary);
            await page.goto('/character-select');
            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await expect(card).toBeVisible({ timeout: 10_000 });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });

            // 3. Przełącz tryb na Offline przez AvatarMenu.
            //    Test `mode-toggle-flips-status-dot.spec.ts` pokrywa że
            //    toggle DZIAŁA — tu tylko go używamy żeby ustawić state.
            const avatarBtn = page.getByRole('button', { name: /menu postaci/i });
            await expect(avatarBtn).toBeVisible({ timeout: 10_000 });
            await avatarBtn.tap();

            // Drugi `.avatar-menu__lang-toggle` = wiersz "Tryb gry"
            //    (pierwszy = język). Patrz AvatarMenu.tsx linie 175-221.
            const modeToggle = page.locator('.avatar-menu__lang-toggle').nth(1);
            const offlineBtn = modeToggle.locator('.avatar-menu__lang-btn', { hasText: /^Offline$/ });
            await expect(offlineBtn).toBeVisible({ timeout: 5_000 });
            await offlineBtn.tap();

            // 4. Sanity: status dot pokazuje --offline → state przeszedł.
            const statusDot = page.locator('.top-header__status-dot');
            await expect(statusDot).toHaveClass(/top-header__status-dot--offline/, { timeout: 5_000 });

            // 5. Próba wejścia na `/party` — gated przez OnlineOnlyGuard.
            //    React Router `<Navigate>` jest synchroniczny: jak Guard
            //    widzi `mode === 'offline'`, render zwraca <Navigate to="/" replace>.
            //    Wynik: URL == "/" (Town) ALBO "/character-select" w edge
            //    case-ach (gdy character store nie jest wciąż wszędzie
            //    hydrated po reload). Oba są valid "blocked" outcomes —
            //    kluczowe że NIE jesteśmy na `/party` i UI Party NIE jest
            //    mounted w drzewie.
            await page.goto('/party');
            // Dajemy 15s żeby ewentualny full-reload + character restore
            //    + Guard redirect + render docelowego routa się zdążył wykonać.
            await expect(page).not.toHaveURL(/\/party$/, { timeout: 15_000 });
            // Party UI (root container) NIE jest widoczne w drzewie React.
            //    Party.tsx renderuje `.party` jako root div.
            await expect(page.locator('.party')).toHaveCount(0);
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
