
import { test, expect, type Page } from '@playwright/test';
import { testUsers } from '../fixtures/testUsers';
import { loginViaUI } from '../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../fixtures/createCharacter';
import { cleanupCharacterById } from '../fixtures/cleanup';

const pickCharacterAndEnterTown = async (page: Page, nick: string): Promise<void> => {
    await page.goto('/character-select');
    const card = page.locator('.char-select__card', {
        has: page.locator('.char-select__card-name', { hasText: nick }),
    });
    await expect(card).toBeVisible({ timeout: 15_000 });
    await card.getByRole('button', { name: /Wybierz/i }).tap();
    await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
};

test.describe('Admin › Panel', { tag: '@admin' }, () => {
    test.describe.configure({ timeout: 90_000 });

    test('non-admin session: avatar menu hides "Panel admina" entry', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            const created = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: nick,
                class: 'Knight',
                overrides: { level: 1, hp_regen: 0, mp_regen: 0 },
            });
            createdId = created.id;

            await loginViaUI(page, testUsers.primary);
            await pickCharacterAndEnterTown(page, nick);

            const avatarBtn = page.locator('.top-header__avatar-btn');
            await expect(avatarBtn).toBeVisible({ timeout: 10_000 });
            await avatarBtn.tap();

            const logoutItem = page.locator('.avatar-menu__item--danger', { hasText: /Wyloguj/i });
            await expect(logoutItem).toBeVisible({ timeout: 10_000 });

            const adminItem = page.locator('.avatar-menu__item--admin');
            await expect(adminItem).toHaveCount(0);

            const adminByLabel = page.locator('.avatar-menu__item', { hasText: /Panel admina/i });
            await expect(adminByLabel).toHaveCount(0);

            const changeCharItem = page.locator('.avatar-menu__item', { hasText: /Zmień postać/i });
            await expect(changeCharItem).toBeVisible();
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });

});
