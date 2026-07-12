
import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';

test.describe('City › Offline Hunt', { tag: '@city' }, () => {
    test.describe.configure({ timeout: 60_000 });

    test('/offline-hunt renders setup UI with skill + monster cards + sort row + start button', async ({ page }) => {
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

            await page.goto('/offline-hunt');

            await expect(page.locator('.oh__setup')).toBeVisible({ timeout: 10_000 });

            const cards = page.locator('.oh__setup .oh__card');
            await expect(cards).toHaveCount(2);

            await expect(cards.nth(0)).toContainText(/Wybierz trenowany skill/i);
            const skillChips = cards.nth(0).locator('.oh__skill-chip');
            expect(await skillChips.count()).toBeGreaterThan(0);

            await expect(cards.nth(1)).toContainText(/Wybierz potwora/i);
            const sortChips = cards.nth(1).locator('.oh__sort-chip');
            await expect(sortChips).toHaveCount(2);
            await expect(sortChips.nth(0)).toHaveClass(/oh__sort-chip--active/);
            await expect(sortChips.nth(1)).not.toHaveClass(/oh__sort-chip--active/);

            const monsterRows = cards.nth(1).locator('.oh__monster-row');
            expect(await monsterRows.count()).toBeGreaterThan(0);

            const startBtn = page.locator('.oh__btn--start');
            await expect(startBtn).toBeVisible();
            await expect(startBtn).toBeDisabled();
            await expect(startBtn).toContainText(/Rozpocznij polowanie/i);
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
