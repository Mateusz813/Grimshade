/**
 * Atomic E2E — `/leaderboard` "Daily" tab pokazuje naszą seedowaną
 * postać z high `quests_daily_done`.
 *
 * Spec (BACKLOG 5.11): "Rankingi: każda kategoria". Rozszerzenie pokrycia
 * — Daily Quests Done tab.
 *
 * Tab definition (Leaderboard.tsx linia 165):
 *   { key: 'quests_daily_done', label: 'Daily', icon: '🗓️',
 *     source: 'characters', characterColumn: 'quests_daily_done',
 *     order: 'desc', valueLabel: 'Daily' }
 *
 * Sort: `quests_daily_done DESC, limit 100`. Format fallback formatValue
 * → `Daily 999`.
 *
 * **Sync-hook SAFE (max mode)**: `useLeaderboardStatSync` (linia 79-87
 * src/hooks/useLeaderboardStatSync.ts) używa `mode: 'max'` dla tej
 * kolumny (komentarz: "Daily resets each day; this back-fill captures
 * TODAY's claimed count. The per-claim hook keeps the lifetime total
 * ticking up across days. ... never overwrite a higher lifetime total").
 * Pre-seed wysoką wartością (999) PRZETRWA character switch bo lokalna
 * `dailyClaimed` jest 0 → 0 < 999, NIE nadpisze.
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

    test('Daily tab shows seeded character with quests_daily_done=999', async ({ page }) => {
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
                    quests_daily_done: 999,
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
                tabLabel: /^Daily$/,
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
