
import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';
import { waitForAppReady } from '../../fixtures/appReady';

test.describe('Chrome › Wiki', { tag: '@chrome' }, () => {
    test.describe.configure({ timeout: 60_000 });

    test('Wiki opens in a new tab from the AvatarMenu with real sections', async ({ page, context }) => {
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

            await page.getByRole('button', { name: /menu postaci/i }).tap();
            const wikiItem = page.getByRole('menuitem', { name: /wiki/i });
            await expect(wikiItem).toBeVisible({ timeout: 5_000 });

            const newPagePromise = context.waitForEvent('page');
            await wikiItem.tap();
            const wikiPage = await newPagePromise;
            await wikiPage.waitForLoadState('domcontentloaded');

            await expect(wikiPage).toHaveURL(/\/wiki$/, { timeout: 10_000 });
            await expect(wikiPage.locator('.wiki')).toBeVisible({ timeout: 10_000 });

            const sections = wikiPage.locator('.wiki__section');
            expect(await sections.count()).toBeGreaterThanOrEqual(10);

            await expect(wikiPage.locator('.wiki__tips')).toBeVisible();
            await expect(wikiPage.locator('.wiki__tips')).toContainText(/task/i);

            await wikiPage.close();
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });

    test('Wiki is reachable directly at /wiki (standalone, no character needed)', async ({ page }) => {
        await page.goto('/wiki');
        await expect(page.locator('.wiki')).toBeVisible({ timeout: 10_000 });
        await expect(page.locator('.wiki__section').first()).toBeVisible();
    });
});
