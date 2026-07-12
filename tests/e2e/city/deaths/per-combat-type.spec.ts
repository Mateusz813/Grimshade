
import { test, expect } from '@playwright/test';
import type { TDeathSource } from '../../../../src/api/v1/deathsApi';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';
import { seedDeath } from '../../fixtures/seedDeath';

interface IDeathTypeCase {
    source: TDeathSource;
    sourceName: string;
    sourceLevel: number;
    expectedBadgeLabel: string;
}

const DEATH_TYPE_CASES: IDeathTypeCase[] = [
    {
        source: 'monster',
        sourceName: 'Szczur',
        sourceLevel: 1,
        expectedBadgeLabel: 'Potwór',
    },
    {
        source: 'dungeon',
        sourceName: 'Ruiny Starego Fortu',
        sourceLevel: 1,
        expectedBadgeLabel: 'Dungeon',
    },
    {
        source: 'boss',
        sourceName: 'Cesarz Chaosu',
        sourceLevel: 25,
        expectedBadgeLabel: 'Boss',
    },
    {
        source: 'transform',
        sourceName: 'Transformacja I',
        sourceLevel: 1,
        expectedBadgeLabel: 'Transform',
    },
];

test.describe('City › Deaths › per-combat-type', { tag: '@city' }, () => {
    test.describe.configure({ timeout: 120_000 });

    for (const c of DEATH_TYPE_CASES) {
        test(`source='${c.source}' -> /deaths shows row with badge "${c.expectedBadgeLabel}"`, async ({ page }) => {
            const nick = generateTestCharacterName();
            let createdId: string | null = null;

            try {
                const created = await createCharacterViaApi({
                    userEmail: testUsers.secondary.email,
                    name: nick,
                    class: 'Knight',
                    overrides: { level: 7, highest_level: 7, hp_regen: 0, mp_regen: 0 },
                });
                createdId = created.id;

                await seedDeath({
                    characterId: created.id,
                    characterName: nick,
                    characterClass: 'Knight',
                    characterLevel: 7,
                    source: c.source,
                    sourceName: c.sourceName,
                    sourceLevel: c.sourceLevel,
                });

                await loginViaUI(page, testUsers.secondary);
                await page.goto('/deaths');

                await expect(page.locator('.deaths__list')).toBeVisible({ timeout: 15_000 });

                const ourDeathRow = page.locator('.deaths__item', {
                    has: page.locator('.deaths__victim-name', { hasText: nick }),
                });
                await expect(ourDeathRow).toBeVisible({ timeout: 10_000 });

                const badge = ourDeathRow.locator('.deaths__item-badge');
                await expect(badge).toBeVisible();
                await expect(badge).toContainText(c.expectedBadgeLabel);

                await expect(ourDeathRow.locator('.deaths__monster-name'))
                    .toContainText(c.sourceName);
                await expect(ourDeathRow.locator('.deaths__monster-lvl'))
                    .toContainText(`Lvl ${c.sourceLevel}`);
                await expect(ourDeathRow.locator('.deaths__victim-lvl'))
                    .toContainText('Lvl 7');
                await expect(ourDeathRow.locator('.deaths__verb--killed')).toBeVisible();
                await expect(ourDeathRow.locator('.deaths__verb-text')).toContainText('zabił');
            } finally {
                if (createdId) {
                    await cleanupCharacterById(createdId);
                }
            }
        });
    }
});
