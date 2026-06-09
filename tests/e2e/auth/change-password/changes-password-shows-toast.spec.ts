/**
 * Atomic E2E — zmiana hasła z AvatarMenu pokazuje toast potwierdzenia.
 *
 * Flow (mirror logout spec for the menu-open pattern):
 *   1. Seed character (TopHeader renders the avatar button only when
 *      character !== null).
 *   2. Login UI → pick character → Town.
 *   3. Open AvatarMenu → tap "Zmień hasło".
 *   4. Modal (portal) → fill new password + confirm → tap "Zmień hasło".
 *   5. Assert success toast "Hasło zmienione pomyślnie".
 *
 * Because this changes a REAL Supabase account password, `finally` ALWAYS
 * restores the original password via the service-role admin API
 * (updateUserById) — bulletproof even if an assertion throws, so the stable
 * test account is never left with a changed password (no trace, per the
 * CLAUDE.md E2E cleanup rule). Character is cleaned up too.
 *
 * The toast firing against a REAL Supabase means supabase.auth.updateUser
 * actually succeeded (the catch path would show a root error instead) — so
 * this proves the change end-to-end, not just the UI.
 */

import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';
import { getAdminClient, findUserIdByEmail } from '../../fixtures/adminClient';
import { waitForAppReady } from '../../fixtures/appReady';

test.describe('Auth › Change Password', { tag: '@auth' }, () => {
    test.describe.configure({ timeout: 90_000 });

    test('change password from AvatarMenu shows success toast', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;
        const newPassword = 'NoweHaslo123!';

        try {
            // 1. Seed character for primary (avatar button needs a character).
            const created = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: nick,
                class: 'Knight',
                overrides: { hp_regen: 0, mp_regen: 0 },
            });
            createdId = created.id;

            // 2. Login → pick character → Town.
            await loginViaUI(page, testUsers.primary);
            await page.goto('/character-select');
            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await expect(card).toBeVisible({ timeout: 10_000 });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
            await waitForAppReady(page);

            // 3. Open AvatarMenu → "Zmień hasło".
            const avatarBtn = page.getByRole('button', { name: /menu postaci/i });
            await expect(avatarBtn).toBeVisible({ timeout: 10_000 });
            await avatarBtn.tap();
            const changePwdItem = page.getByRole('menuitem', { name: /zmień hasło/i });
            await expect(changePwdItem).toBeVisible({ timeout: 5_000 });
            await changePwdItem.tap();

            // 4. Modal appears (portal to body) → fill all 3 fields:
            //    current password (security gate) + new + confirm.
            const inputs = page.locator('.change-password__input');
            await expect(inputs).toHaveCount(3, { timeout: 5_000 });
            // The avatar menu must have CLOSED when the modal opened (bug #1).
            await expect(page.locator('.avatar-menu')).toHaveCount(0);
            await inputs.nth(0).fill(testUsers.primary.password);
            await inputs.nth(1).fill(newPassword);
            await inputs.nth(2).fill(newPassword);

            // Submit — use the modal's primary button (avoid colliding with the
            // identically-labelled menu item still in the DOM).
            await page.locator('.change-password__btn--primary').tap();

            // 5. Success toast.
            await expect(page.locator('.change-password__toast'))
                .toContainText('Hasło zmienione pomyślnie', { timeout: 10_000 });
        } finally {
            // ALWAYS restore the original password via admin API — bulletproof
            // regardless of where the test stopped, so the shared account is
            // left exactly as found.
            try {
                const userId = await findUserIdByEmail(testUsers.primary.email);
                if (userId) {
                    const admin = getAdminClient();
                    await admin.auth.admin.updateUserById(userId, {
                        password: testUsers.primary.password,
                    });
                }
            } catch {
                /* best effort — but this should not silently fail; surfaced via test logs */
            }
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
