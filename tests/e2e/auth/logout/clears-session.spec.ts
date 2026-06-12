/**
 * Atomic E2E — logout czyści session i redirectuje na `/login`.
 *
 * Setup state:
 *   1. Seed character przez API dla primary konta (TopHeader renderuje
 *      się TYLKO gdy `character !== null` — bez postaci nie ma avatar
 *      button-a, więc nie ma jak otworzyć AvatarMenu).
 *   2. Login UI flow -> karta postaci w `/character-select` -> tap "Wybierz".
 *   3. Czekamy aż wejdziemy do Town (`/`) — TopHeader z avatarem dostępny.
 *
 * One action:   tap avatar button (otwiera AvatarMenu) -> tap "Wyloguj".
 * One outcome:  Po `handleLogout` (`AvatarMenu.tsx` linie 155-161):
 *               - `supabase.auth.signOut()` kasuje session
 *               - `useCharacterStore.clearCharacter()` czyści store
 *               - `navigate('/login')` redirectuje
 *               URL = `/login` + formularz email/password ponownie widoczny.
 *
 * Cleanup:      hard rule — `cleanupCharacterById(createdId)` w finally.
 *
 * Edge: BottomNav też ma "Wyloguj"-like miejsca, ale jedyne miejsce
 * z faktycznym logout-em to AvatarMenu. Test celuje tylko w nie żeby
 * pokryć krytyczną ścieżkę produkcyjną.
 */

import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';

test.describe('Auth › Logout', { tag: '@auth' }, () => {
    test.describe.configure({ timeout: 60_000 });

    test('logout from AvatarMenu clears session and redirects to /login', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            // 1. Seed postać — TopHeader wymaga character !== null żeby zrenderować
            //    avatar button (TopHeader.tsx linia 188: `if (!character) return null`).
            const created = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: nick,
                class: 'Knight',
                overrides: { hp_regen: 0, mp_regen: 0 },
            });
            createdId = created.id;

            // 2. Login -> /character-select
            await loginViaUI(page, testUsers.primary);
            await page.goto('/character-select');

            // 3. Wybierz NASZĄ postać -> Town
            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await expect(card).toBeVisible({ timeout: 10_000 });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });

            // 4. Avatar button w TopHeader musi być widoczny przed tap-em.
            //    aria-label="Menu postaci" — TopHeader.tsx linia 235.
            const avatarBtn = page.getByRole('button', { name: /menu postaci/i });
            await expect(avatarBtn).toBeVisible({ timeout: 10_000 });
            await avatarBtn.tap();

            // 5. AvatarMenu się otworzył — Wyloguj item musi być widoczny.
            //    `.avatar-menu__item--danger` ma label "Wyloguj" (AvatarMenu.tsx
            //    linie 254-262). Używamy role-base selector zamiast CSS class —
            //    bardziej semantic + odporne na rename class.
            const logoutBtn = page.getByRole('menuitem', { name: /wyloguj/i });
            await expect(logoutBtn).toBeVisible({ timeout: 5_000 });
            await logoutBtn.tap();

            // 6. Po `handleLogout` — redirect na /login.
            //    15s timeout bo Supabase signOut + state cleanup + navigate.
            await expect(page).toHaveURL(/\/login$/, { timeout: 15_000 });

            // 7. Sanity — formularz login się wyrenderował (session jest faktycznie
            //    czysta, AppRouter widzi `!session` -> renderuje Login zamiast Navigate).
            await expect(page.locator('input[type="email"]')).toBeVisible();
            await expect(page.locator('input[type="password"]')).toBeVisible();
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
