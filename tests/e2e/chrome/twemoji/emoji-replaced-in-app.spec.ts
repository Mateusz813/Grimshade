
import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';
import { waitForAppReady } from '../../fixtures/appReady';

test.describe('Chrome › Twemoji', { tag: '@chrome' }, () => {
    test.describe.configure({ timeout: 60_000 });

    test('icons render as inline <svg class="game-icon"> across the app', async ({ page }) => {
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
            await waitForAppReady(page);

            const icons = page.locator('svg.game-icon');
            await expect(icons.first()).toBeVisible({ timeout: 10_000 });
            expect(await icons.count()).toBeGreaterThan(0);

            const stats = await page.evaluate(() => {
                const gi = Array.from(document.querySelectorAll('svg.game-icon'));
                return {
                    count: gi.length,
                    withContent: gi.filter((s) => s.children.length > 0).length,
                    withName: gi.filter((s) => !!s.getAttribute('data-icon')).length,
                    oldImgs: document.querySelectorAll('img.twemoji').length,
                };
            });
            expect(stats.withContent).toBe(stats.count);
            expect(stats.withName).toBe(stats.count);
            expect(stats.oldImgs).toBe(0);
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
