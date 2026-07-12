
import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';
import { seedDeath } from '../../fixtures/seedDeath';

test.describe('City › Deaths', { tag: '@city' }, () => {
    test.describe.configure({ timeout: 60_000 });

    test('seeded death row appears in /deaths feed', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            const created = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: nick,
                class: 'Knight',
                overrides: { level: 7, highest_level: 7 },
            });
            createdId = created.id;

            await seedDeath({
                characterId: created.id,
                characterName: nick,
                characterClass: 'Knight',
                characterLevel: 7,
                source: 'monster',
                sourceName: 'Szczur',
                sourceLevel: 1,
            });

            await loginViaUI(page, testUsers.primary);
            await page.goto('/deaths');

            await expect(page.locator('.deaths__list')).toBeVisible({ timeout: 15_000 });

            const ourDeathRow = page.locator('.deaths__item', {
                has: page.locator('.deaths__victim-name', { hasText: nick }),
            });
            await expect(ourDeathRow).toBeVisible({ timeout: 10_000 });

            await expect(ourDeathRow.locator('.deaths__monster-name')).toContainText('Szczur');
            await expect(ourDeathRow.locator('.deaths__monster-lvl')).toContainText('Lvl 1');
            await expect(ourDeathRow.locator('.deaths__victim-lvl')).toContainText('Lvl 7');
            await expect(ourDeathRow.locator('.deaths__verb--killed')).toBeVisible();
            await expect(ourDeathRow.locator('.deaths__verb-text')).toContainText('zabił');
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
