/**
 * Atomic E2E — toggle Online → Offline w AvatarMenu zmienia stan
 * `useConnectivityStore.mode` + active class na odpowiednim przycisku
 * + status dot w TopHeader przełącza się z `--online` na `--offline`.
 *
 * Spec (BACKLOG 14.1): "Offline mode: tylko dozwolone widoki dostępne".
 *
 * Ten test pokrywa SAMO przełączenie trybu (visible state). Asercja
 * że online-only routes są zablokowane → osobny atomic test
 * `offline/mode-blocks-party-route.spec.ts`.
 *
 * AvatarMenu.tsx linie 198-221 — wiersz "Tryb gry" z dwoma buttonami
 * Online/Offline. Klasa `avatar-menu__lang-btn--active` flaguje aktualnie
 * wybrany przycisk (tak — to ta sama klasa co dla języka, bo używa
 * tych samych styli toggle-row).
 *
 * Wiersz "Tryb gry" to DRUGI `.avatar-menu__lang-toggle` w menu (Język
 * jest pierwszy, Tryb drugi — patrz AvatarMenu.tsx linie 175-221).
 *
 * TopHeader.tsx linie 243-247 — `.top-header__status-dot` z modyfikatorem
 * `--online` / `--offline` (zielona / czerwona kropka w prawym dolnym
 * rogu avatara).
 *
 * Setup:
 *   1. Seed character przez API — TopHeader renderuje się TYLKO gdy
 *      `character !== null`. Bez postaci nie ma avatar button-a → nie ma
 *      jak otworzyć AvatarMenu.
 *   2. Login UI + wybór seedowanej postaci → Town (`/`).
 *   3. Open AvatarMenu (tap avatar button `aria-label="Menu postaci"`).
 *
 * Actions + outcomes:
 *   A. Domyślnie active = Online (connectivityStore default po fresh boot,
 *      bez snapshot w sessionStorage). Status dot ma class `--online`.
 *   B. Tap Offline → Offline button dostaje class `--active`, Online ją
 *      traci. Status dot dostaje class `--offline`.
 *   C. Tap Online (wracamy do online) — bidirectional toggle works.
 *      UWAGA: przejście offline → online triggeruje `transitionToOnline`
 *      które robi full Supabase sync; nie czekamy na sync result, tylko
 *      sprawdzamy że store się od razu zmienił (sync side effect żyje
 *      na backgrounder).
 *
 * Cleanup: `cleanupCharacterById(createdId)` w finally per CLAUDE.md
 * TESTING hard rule.
 */

import { test, expect } from '@playwright/test';
import { testUsers } from '../fixtures/testUsers';
import { loginViaUI } from '../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../fixtures/createCharacter';
import { cleanupCharacterById } from '../fixtures/cleanup';

test.describe('Offline › Mode', { tag: '@offline' }, () => {
    test.describe.configure({ timeout: 60_000 });

    test('AvatarMenu Tryb gry toggle flips status dot Online ↔ Offline', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            // 1. Seed postaci żeby TopHeader się wyrenderował.
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

            // 3. Status dot w TopHeader — domyślnie powinien być `--online`.
            //    Postać świeża, brak snapshot-u w sessionStorage → boot jako online.
            const statusDot = page.locator('.top-header__status-dot');
            await expect(statusDot).toBeVisible({ timeout: 10_000 });
            await expect(statusDot).toHaveClass(/top-header__status-dot--online/);

            // 4. Open AvatarMenu — avatar button w TopHeader.
            //    `aria-label="Menu postaci"` (TopHeader.tsx linia 235).
            const avatarBtn = page.getByRole('button', { name: /menu postaci/i });
            await expect(avatarBtn).toBeVisible();
            await avatarBtn.tap();

            // 5. Wiersz "Tryb gry" to DRUGI `.avatar-menu__lang-toggle` w
            //    menu (pierwszy = język). Filter po exact text "Online"/"Offline".
            const modeToggle = page.locator('.avatar-menu__lang-toggle').nth(1);
            const onlineBtn  = modeToggle.locator('.avatar-menu__lang-btn', { hasText: /^Online$/ });
            const offlineBtn = modeToggle.locator('.avatar-menu__lang-btn', { hasText: /^Offline$/ });
            await expect(onlineBtn).toBeVisible({ timeout: 5_000 });
            await expect(offlineBtn).toBeVisible();

            // 5A. Initial state — Online aktywny, Offline nie.
            await expect(onlineBtn).toHaveClass(/avatar-menu__lang-btn--active/);
            await expect(offlineBtn).not.toHaveClass(/avatar-menu__lang-btn--active/);

            // 5B. Tap Offline → active flippa się + status dot zmienia kolor.
            await offlineBtn.tap();
            await expect(offlineBtn).toHaveClass(/avatar-menu__lang-btn--active/);
            await expect(onlineBtn).not.toHaveClass(/avatar-menu__lang-btn--active/);
            // Status dot w TopHeader powinien dostać klasę `--offline`.
            //    Tap-em w przycisk w menu nie zamykamy menu, więc dot jest
            //    nadal widoczny w tle.
            await expect(statusDot).toHaveClass(/top-header__status-dot--offline/);

            // 5C. Tap Online (powrót) — toggle bidirectional + dot wraca do --online.
            //     UWAGA: `togglePlayMode` w AvatarMenu odpala async
            //     `transitionToOnline` które forsuje sync z Supabase. Nie
            //     czekamy na sync result — sprawdzamy że store + dot się od
            //     razu zmieniły (sync side effect żyje na backgrounder).
            await onlineBtn.tap();
            await expect(onlineBtn).toHaveClass(/avatar-menu__lang-btn--active/);
            await expect(offlineBtn).not.toHaveClass(/avatar-menu__lang-btn--active/);
            await expect(statusDot).toHaveClass(/top-header__status-dot--online/);
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
