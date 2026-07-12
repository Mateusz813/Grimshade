
import { test, expect } from '@playwright/test';
import { testUsers } from '../fixtures/testUsers';
import { loginViaUI } from '../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../fixtures/createCharacter';
import { cleanupCharacterById } from '../fixtures/cleanup';

test.describe('Training › Active', { tag: '@training' }, () => {
    test.describe.configure({ timeout: 60_000 });

    test('opens Training popup and renders skill list with per-skill levels', async ({ page }) => {
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

            await page.goto('/inventory');
            await expect(page.locator('.inventory__paperdoll-actions')).toBeVisible({ timeout: 10_000 });
            await page.getByRole('button', { name: /^trening skilli$/i }).tap();

            const popup = page.locator('.inventory__popup--training');
            await expect(popup).toBeVisible({ timeout: 5_000 });

            await expect(popup.getByText('Trening Skilli')).toBeVisible();

            await expect(popup.locator('.inventory__training-status-pill'))
                .toContainText(/Brak aktywnego treningu/i);

            const skillList = popup.locator('.inventory__training-list');
            await expect(skillList).toBeVisible();

            const cards = popup.locator('.inventory__training-card');
            const cardCount = await cards.count();
            expect(cardCount).toBeGreaterThanOrEqual(4);

            const firstCard = cards.first();
            await expect(firstCard.locator('.inventory__training-card-name')).toBeVisible();
            await expect(firstCard.locator('.inventory__training-card-level')).toContainText(/Lv 0/);

            await expect(firstCard.locator('.inventory__training-card-bar')).toBeVisible();
            await expect(firstCard.locator('.inventory__training-card-xp'))
                .toContainText(/^0 \/ \d+ XP$/);
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
