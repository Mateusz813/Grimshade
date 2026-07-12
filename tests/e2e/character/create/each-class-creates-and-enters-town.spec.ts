
import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterByName } from '../../fixtures/cleanup';

interface IClassUnderTest {
    id: string;
    namePl: string;
    icon: string;
}

const CLASSES: ReadonlyArray<IClassUnderTest> = [
    { id: 'Knight',      namePl: 'Rycerz',     icon: 'crossed-swords' },
    { id: 'Mage',        namePl: 'Mag',        icon: 'crystal-ball' },
    { id: 'Cleric',      namePl: 'Kleryk',     icon: 'sparkles' },
    { id: 'Archer',      namePl: 'Łucznik',    icon: 'bow-and-arrow' },
    { id: 'Rogue',       namePl: 'Łotr',       icon: 'dagger' },
    { id: 'Necromancer', namePl: 'Nekromanta', icon: 'skull' },
    { id: 'Bard',        namePl: 'Bard',       icon: 'musical-note' },
];

test.describe('Character › Create', { tag: '@character' }, () => {
    test.describe.configure({ timeout: 60_000, mode: 'serial' });

    for (const cls of CLASSES) {
        test(`creates ${cls.id} (${cls.namePl}) and enters Town with correct nick + class + level 1`, async ({ page }) => {
            const nick = generateTestCharacterName();

            try {
                await loginViaUI(page, testUsers.primary);

                if (!page.url().endsWith('/character-select')) {
                    await page.goto('/character-select');
                }

                const createBtn = page.getByRole('button', { name: /Stwórz nową postać/i });
                await createBtn.scrollIntoViewIfNeeded();
                await createBtn.tap();
                await expect(page).toHaveURL(/\/create-character$/, { timeout: 10_000 });

                const classButton = page.locator('.character-create__class-btn').filter({
                    hasText: cls.namePl,
                });
                await classButton.tap();
                await expect(classButton).toHaveClass(/character-create__class-btn--selected/);

                await page.locator('.character-create__input').fill(nick);

                await page.getByRole('button', { name: /Stwórz postać/i }).tap();

                await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });

                await expect(page.locator('.town__char-name')).toHaveText(nick);
                await expect(page.locator('.town__char-level')).toHaveText('Poziom 1');
                await expect(page.locator('.town__char-class')).toBeVisible();
            } finally {
                await cleanupCharacterByName(testUsers.primary.email, nick);
            }
        });
    }
});
