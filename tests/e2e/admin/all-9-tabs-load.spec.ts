
import { test, expect, type Page } from '@playwright/test';
import { testUsers } from '../fixtures/testUsers';
import { loginViaUI } from '../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../fixtures/createCharacter';
import { cleanupCharacterById } from '../fixtures/cleanup';

const TABS = [
    { value: 'char',   label: /Postać/ },
    { value: 'inv',    label: /Inv/ },
    { value: 'skill',  label: /Skille/ },
    { value: 'tasks',  label: /Tasks/ },
    { value: 'quests', label: /Questy/ },
    { value: 'walki',  label: /Walki/ },
    { value: 'social', label: /Społ/ },
    { value: 'system', label: /System/ },
    { value: 'nuke',   label: /Reset/ },
] as const;

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
    test.describe.configure({ timeout: 180_000 });

    test('admin session: all 9 panel tabs load without crash', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            const created = await createCharacterViaApi({
                userEmail: testUsers.admin.email,
                name: nick,
                class: 'Knight',
                overrides: { level: 50, gold: 100000, hp_regen: 0, mp_regen: 0 },
            });
            createdId = created.id;

            await loginViaUI(page, testUsers.admin);
            await pickCharacterAndEnterTown(page, nick);

            const avatarBtn = page.locator('.top-header__avatar-btn');
            await expect(avatarBtn).toBeVisible({ timeout: 10_000 });
            await avatarBtn.tap();

            const adminItem = page.locator('.avatar-menu__item--admin');
            await expect(adminItem).toBeVisible({ timeout: 10_000 });

            await adminItem.tap();
            const panel = page.locator('.admin-panel');
            await expect(panel).toBeVisible({ timeout: 10_000 });

            for (const tab of TABS) {
                const tabBtn = page.locator('.admin-panel__tab', { hasText: tab.label });
                await expect(tabBtn).toBeVisible({ timeout: 5_000 });
                await tabBtn.tap();
                await expect(tabBtn).toHaveClass(/admin-panel__tab--active/, { timeout: 3_000 });

                const section = page.locator('.admin-panel__section').first();
                await expect(section).toBeVisible({ timeout: 5_000 });
            }
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
