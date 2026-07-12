
import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';

test.describe('Chrome › Language', { tag: '@chrome' }, () => {
    test.describe.configure({ timeout: 60_000 });

    test('language toggle in AvatarMenu switches active state PL <-> EN', async ({ page }) => {
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

            const languageToggle = page.locator('.avatar-menu__lang-toggle').first();
            const plBtn = languageToggle.locator('.avatar-menu__lang-btn', { hasText: /^PL$/ });
            const enBtn = languageToggle.locator('.avatar-menu__lang-btn', { hasText: /^EN$/ });
            await expect(plBtn).toBeVisible({ timeout: 5_000 });
            await expect(enBtn).toBeVisible();

            await expect(plBtn).toHaveClass(/avatar-menu__lang-btn--active/);
            await expect(enBtn).not.toHaveClass(/avatar-menu__lang-btn--active/);

            await enBtn.tap();
            await expect(enBtn).toHaveClass(/avatar-menu__lang-btn--active/);
            await expect(plBtn).not.toHaveClass(/avatar-menu__lang-btn--active/);

            await plBtn.tap();
            await expect(plBtn).toHaveClass(/avatar-menu__lang-btn--active/);
            await expect(enBtn).not.toHaveClass(/avatar-menu__lang-btn--active/);
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
