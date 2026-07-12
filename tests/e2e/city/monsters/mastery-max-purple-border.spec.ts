
import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';
import { seedGameSave, findUserIdByEmail } from '../../fixtures/seedGameSave';

test.describe('City › Monsters', { tag: '@city' }, () => {
    test.describe.configure({ timeout: 60_000 });

    test('mastery 25/25 on monster -> card has mastery-max class (purple border)', async ({ page }) => {
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

            const userId = await findUserIdByEmail(testUsers.primary.email);
            await seedGameSave({
                characterId: created.id,
                userId,
                masteries: { rat: { level: 25 } },
            });

            await loginViaUI(page, testUsers.primary);
            await page.goto('/character-select');
            const charCard = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await expect(charCard).toBeVisible({ timeout: 10_000 });
            await charCard.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 10_000 });

            await page.goto('/monsters');
            await expect(page.locator('.combat__hub-monsters')).toBeVisible({ timeout: 10_000 });

            const ratCard = page.locator('.combat__mcard', {
                has: page.locator('.combat__mcard-name', { hasText: /^Szczur$/ }),
            });
            await expect(ratCard).toBeVisible({ timeout: 10_000 });

            await expect(ratCard).toHaveClass(/combat__mcard--mastery-max/);

            const masteryChip = ratCard.locator('.combat__mcard-mastery');
            await expect(masteryChip).toContainText('25/25');
            await expect(masteryChip).toHaveClass(/combat__mcard-mastery--max/);

            const secondCard = page.locator('.combat__mcard').nth(1);
            await expect(secondCard).not.toHaveClass(/combat__mcard--mastery-max/);
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
