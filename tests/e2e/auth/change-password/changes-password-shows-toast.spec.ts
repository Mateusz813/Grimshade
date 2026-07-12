
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
            await waitForAppReady(page);

            const avatarBtn = page.getByRole('button', { name: /menu postaci/i });
            await expect(avatarBtn).toBeVisible({ timeout: 10_000 });
            await avatarBtn.tap();
            const changePwdItem = page.getByRole('menuitem', { name: /zmień hasło/i });
            await expect(changePwdItem).toBeVisible({ timeout: 5_000 });
            await changePwdItem.tap();

            const inputs = page.locator('.change-password__input');
            await expect(inputs).toHaveCount(3, { timeout: 5_000 });
            await expect(page.locator('.avatar-menu')).toHaveCount(0);
            await inputs.nth(0).fill(testUsers.primary.password);
            await inputs.nth(1).fill(newPassword);
            await inputs.nth(2).fill(newPassword);

            await page.locator('.change-password__btn--primary').tap();

            await expect(page.locator('.change-password__toast'))
                .toContainText('Hasło zmienione pomyślnie', { timeout: 10_000 });
        } finally {
            try {
                const userId = await findUserIdByEmail(testUsers.primary.email);
                if (userId) {
                    const admin = getAdminClient();
                    await admin.auth.admin.updateUserById(userId, {
                        password: testUsers.primary.password,
                    });
                }
            } catch {
            }
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
