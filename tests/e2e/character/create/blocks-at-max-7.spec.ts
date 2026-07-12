
import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import {
    createCharacterViaApi,
    generateTestCharacterName,
    type CharacterClass,
} from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';

const SEED_CLASSES: ReadonlyArray<CharacterClass> = [
    'Knight',
    'Mage',
    'Cleric',
    'Archer',
    'Rogue',
    'Necromancer',
    'Bard',
];

test.describe('Character › Create', { tag: '@character' }, () => {
    test.describe.configure({ timeout: 90_000 });

    test('hides "Stwórz nową postać" button when account has 7/7 characters', async ({ page }) => {
        const createdIds: string[] = [];

        try {
            for (const cls of SEED_CLASSES) {
                const c = await createCharacterViaApi({
                    userEmail: testUsers.primary.email,
                    name: generateTestCharacterName(),
                    class: cls,
                });
                createdIds.push(c.id);
            }
            expect(createdIds).toHaveLength(7);

            await loginViaUI(page, testUsers.primary);
            if (!page.url().endsWith('/character-select')) {
                await page.goto('/character-select');
            }

            const cards = page.locator('.char-select__card');
            await expect.poll(async () => await cards.count(), { timeout: 15_000 })
                .toBeGreaterThanOrEqual(SEED_CLASSES.length);

            const createBtn = page.getByRole('button', { name: /Stwórz nową postać/i });
            await expect(createBtn).toHaveCount(0);

            await expect(page.getByRole('button', { name: /^wyloguj$/i })).toBeVisible();
        } finally {
            for (const id of createdIds) {
                await cleanupCharacterById(id);
            }
        }
    });
});
