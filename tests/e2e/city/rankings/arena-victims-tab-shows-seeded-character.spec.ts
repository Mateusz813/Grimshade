/**
 * Atomic E2E — `/leaderboard` "Ofiary" (Arena Victims) tab pokazuje
 * naszą seedowaną postać z high `arena_deaths`.
 *
 * Spec (BACKLOG 5.11): "Rankingi: każda kategoria". Rozszerzenie pokrycia
 * — Arena Victims tab (`arena_deaths` column ranking).
 *
 * Tab definition (Leaderboard.tsx linia 154):
 *   { key: 'arena_victims', label: 'Ofiary', icon: 'skull',
 *     source: 'characters', characterColumn: 'arena_deaths',
 *     order: 'desc', valueLabel: 'Śmierci' }
 *
 * Display format: fallback formatValue -> `Śmierci 999`. Sync-hook SAFE
 * (same as arena_kills — only arenaStore bumps this column).
 *
 * Cleanup: try/finally + cleanupCharacterById.
 */

import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';
import { waitForAppReady } from '../../fixtures/appReady';
import { assertSeededRankingRow } from '../../fixtures/rankings';

test.describe('City › Rankings', { tag: '@city' }, () => {
    test.describe.configure({ timeout: 120_000 });

    test('Ofiary tab shows seeded character with arena_deaths=999', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            const created = await createCharacterViaApi({
                userEmail: testUsers.secondary.email,
                name: nick,
                class: 'Knight',
                overrides: {
                    level: 1,
                    highest_level: 1,
                    arena_deaths: 999,
                    hp_regen: 0,
                    mp_regen: 0,
                },
            });
            createdId = created.id;

            await loginViaUI(page, testUsers.secondary);
            await page.goto('/character-select');
            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await expect(card).toBeVisible({ timeout: 10_000 });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });

            await page.goto('/leaderboard');
            await waitForAppReady(page);

            await assertSeededRankingRow(page, {
                tabLabel: /^Ofiary$/,
                nick,
                value: /\b999\b/,
            });
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
