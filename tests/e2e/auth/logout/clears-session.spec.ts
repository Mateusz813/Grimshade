
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
            const created = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: nick,
                class: 'Knight',
                overrides: { hp_regen: 0, mp_regen: 0 },
            });
            createdId = created.id;

            await loginViaUI(page, testUsers.primary);
            await page.goto('/character-select');

            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await expect(card).toBeVisible({ timeout: 10_000 });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });

            const avatarBtn = page.getByRole('button', { name: /menu postaci/i });
            await expect(avatarBtn).toBeVisible({ timeout: 10_000 });
            await avatarBtn.tap();

            const logoutBtn = page.getByRole('menuitem', { name: /wyloguj/i });
            await expect(logoutBtn).toBeVisible({ timeout: 5_000 });
            await logoutBtn.tap();

            await expect(page).toHaveURL(/\/login$/, { timeout: 15_000 });

            await expect(page.locator('input[type="email"]')).toBeVisible();
            await expect(page.locator('input[type="password"]')).toBeVisible();
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
