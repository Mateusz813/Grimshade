
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';

interface IMonsterRow { level: number }
const monstersPath = resolve(process.cwd(), 'src/data/monsters.json');
const MONSTERS = JSON.parse(readFileSync(monstersPath, 'utf-8')) as ReadonlyArray<IMonsterRow>;
const MONSTER_COUNT = MONSTERS.length;
const MONSTERS_LVL_30_PLUS = MONSTERS.filter((m) => m.level >= 30).length;
const TOP_LEVEL = MONSTERS.reduce((max, m) => Math.max(max, m.level), 0);

test.describe('City › Monsters', { tag: '@city' }, () => {
    test.describe.configure({ timeout: 60_000 });

    test('Lvl filter + sort desc + clear button — each changes monster card count or order', async ({ page }) => {
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
            await expect(page).toHaveURL(/\/$/, { timeout: 10_000 });

            await page.goto('/monsters');
            await expect(page.locator('.combat__hub-monsters')).toBeVisible({ timeout: 10_000 });

            const cards = page.locator('.combat__mcard');
            await expect(cards.first()).toBeVisible({ timeout: 10_000 });
            const initialCount = await cards.count();
            expect(initialCount).toBeGreaterThanOrEqual(MONSTER_COUNT);

            await expect(cards.first().locator('.combat__mcard-name')).toContainText('Szczur');

            const lvlInput = page.locator('.combat__filter-input input[type="number"]');
            await lvlInput.fill('30');
            await expect(cards).toHaveCount(MONSTERS_LVL_30_PLUS, { timeout: 5_000 });

            const clearBtn = page.locator('.combat__filter-clear');
            await expect(clearBtn).toBeVisible();
            await clearBtn.tap();
            await expect(cards).toHaveCount(initialCount, { timeout: 5_000 });

            const sortToggle = page.locator('.combat__filter-toggle', {
                hasText: 'Od najwyższego poziomu',
            });
            await sortToggle.tap();
            await expect(sortToggle).toHaveClass(/combat__filter-toggle--active/);
            await expect(cards).toHaveCount(initialCount, { timeout: 5_000 });
            await expect(cards.first().locator('.combat__mcard-level')).toContainText(`Lvl ${TOP_LEVEL}`);
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
