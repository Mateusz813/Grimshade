
import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';
import { seedDeath } from '../../fixtures/seedDeath';

test.describe('Combat › Flee', { tag: '@combat' }, () => {
    test.describe.configure({ timeout: 60_000 });

    test('seeded fled row appears in /deaths feed with "przegnał" verb', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            const created = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: nick,
                class: 'Knight',
                overrides: { level: 5, highest_level: 5 },
            });
            createdId = created.id;

            await seedDeath({
                characterId: created.id,
                characterName: nick,
                characterClass: 'Knight',
                characterLevel: 5,
                source: 'dungeon',
                sourceName: 'Krypta Cesarza (uciekłeś z gry)',
                sourceLevel: 1,
                result: 'fled',
            });

            await loginViaUI(page, testUsers.primary);
            await page.goto('/deaths');

            await expect(page.locator('.deaths__list')).toBeVisible({ timeout: 15_000 });

            const ourFleeRow = page.locator('.deaths__item', {
                has: page.locator('.deaths__victim-name', { hasText: nick }),
            });
            await expect(ourFleeRow).toBeVisible({ timeout: 10_000 });

            await expect(ourFleeRow).toHaveClass(/deaths__item--fled/);
            await expect(ourFleeRow.locator('.deaths__verb--fled')).toBeVisible();
            await expect(ourFleeRow.locator('.deaths__verb-text')).toContainText('przegnał');
            await expect(ourFleeRow.locator('.deaths__verb--killed')).toHaveCount(0);
            await expect(ourFleeRow.locator('.deaths__monster-name')).toContainText('Krypta Cesarza');
            await expect(ourFleeRow.locator('.deaths__monster-lvl')).toContainText('Lvl 1');
            await expect(ourFleeRow.locator('.deaths__victim-lvl')).toContainText('Lvl 5');
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
