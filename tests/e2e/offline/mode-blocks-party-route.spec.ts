
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

            const modeToggle = page.locator('.avatar-menu__lang-toggle').nth(1);
            const offlineBtn = modeToggle.locator('.avatar-menu__lang-btn', { hasText: /^Offline$/ });
            await expect(offlineBtn).toBeVisible({ timeout: 5_000 });
            await offlineBtn.tap();

            const statusDot = page.locator('.top-header__status-dot');
            await expect(statusDot).toHaveClass(/top-header__status-dot--offline/, { timeout: 5_000 });

            await page.goto('/party');
            await expect(page).not.toHaveURL(/\/party$/, { timeout: 15_000 });
            await expect(page.locator('.party')).toHaveCount(0);
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
