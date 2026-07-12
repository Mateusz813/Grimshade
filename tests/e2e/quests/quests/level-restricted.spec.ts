
import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';

test.describe('Quests › Quests', { tag: '@progression' }, () => {
    test.describe.configure({ timeout: 60_000 });

    test('quest whose minLevel > character level shows locked label + dropped by "Dostępne" filter', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            const created = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: nick,
                class: 'Knight',
                overrides: { level: 5, highest_level: 5, hp_regen: 0, mp_regen: 0 },
            });
            createdId = created.id;

            await loginViaUI(page, testUsers.primary);
            await page.goto('/character-select');
            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await expect(card).toBeVisible({ timeout: 10_000 });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 10_000 });

            await page.goto('/quests');
            await expect(page.locator('.quests__hub-tile--quests')).toBeVisible({ timeout: 10_000 });

            await page.locator('.quests__hub-tile--quests').tap();

            await expect(page.locator('.quests__filters')).toBeVisible({ timeout: 10_000 });

            const lvlInput = page.locator('.quests__lvl-filter--inline');
            await lvlInput.fill('10');

            const firstStepsCard = page.locator('.quests__card', {
                has: page.locator('.quests__card-name', { hasText: 'Pierwsze Kroki' }),
            });
            await expect(firstStepsCard).toBeVisible({ timeout: 10_000 });

            await expect(firstStepsCard).toHaveClass(/quests__card--locked/);

            await expect(firstStepsCard.locator('.quests__locked-label')).toContainText('10');

            const availableFilter = page.locator('.quests__filter-btn', { hasText: /^Dostępne/ });
            await availableFilter.tap();
            await expect(availableFilter).toHaveClass(/quests__filter-btn--active/);

            await expect(firstStepsCard).toHaveCount(0, { timeout: 5_000 });

            await expect(page.locator('.quests__empty')).toContainText('Brak questów');
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
