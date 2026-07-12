
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';

const monstersPath = resolve(process.cwd(), 'src/data/monsters.json');
const MONSTER_COUNT = (JSON.parse(readFileSync(monstersPath, 'utf-8')) as ReadonlyArray<unknown>).length;

test.describe('City › Monsters', { tag: '@city' }, () => {
    test.describe.configure({ timeout: 60_000 });

    test('renders all monsters from monsters.json on /monsters', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            const created = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: nick,
                class: 'Knight',
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

            await page.goto('/monsters');

            await expect(page.locator('.combat__hub-monsters')).toBeVisible({ timeout: 10_000 });

            const cards = page.locator('.combat__mcard');
            await expect(cards.first()).toBeVisible({ timeout: 10_000 });

            const count = await cards.count();
            expect(count).toBeGreaterThanOrEqual(MONSTER_COUNT);
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
