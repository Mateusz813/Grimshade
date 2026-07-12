
import { test, expect } from '@playwright/test';
import { testUsers } from '../fixtures/testUsers';
import { loginViaUI } from '../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../fixtures/createCharacter';
import { cleanupCharacterById } from '../fixtures/cleanup';

test.describe('Offline › Mode', { tag: '@offline' }, () => {
    test.describe.configure({ timeout: 60_000 });

    test('AvatarMenu Tryb gry toggle flips status dot Online <-> Offline', async ({ page }) => {
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

            const statusDot = page.locator('.top-header__status-dot');
            await expect(statusDot).toBeVisible({ timeout: 10_000 });
            await expect(statusDot).toHaveClass(/top-header__status-dot--online/);

            const avatarBtn = page.getByRole('button', { name: /menu postaci/i });
            await expect(avatarBtn).toBeVisible();
            await avatarBtn.tap();

            const modeToggle = page.locator('.avatar-menu__lang-toggle').nth(1);
            const onlineBtn  = modeToggle.locator('.avatar-menu__lang-btn', { hasText: /^Online$/ });
            const offlineBtn = modeToggle.locator('.avatar-menu__lang-btn', { hasText: /^Offline$/ });
            await expect(onlineBtn).toBeVisible({ timeout: 5_000 });
            await expect(offlineBtn).toBeVisible();

            await expect(onlineBtn).toHaveClass(/avatar-menu__lang-btn--active/);
            await expect(offlineBtn).not.toHaveClass(/avatar-menu__lang-btn--active/);

            await offlineBtn.tap();
            await expect(offlineBtn).toHaveClass(/avatar-menu__lang-btn--active/);
            await expect(onlineBtn).not.toHaveClass(/avatar-menu__lang-btn--active/);
            await expect(statusDot).toHaveClass(/top-header__status-dot--offline/);

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
