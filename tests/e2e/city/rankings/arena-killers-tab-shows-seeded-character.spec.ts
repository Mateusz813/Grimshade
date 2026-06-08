/**
 * Atomic E2E — `/leaderboard` "Zabójcy" (Arena Killers) tab pokazuje
 * naszą seedowaną postać z high `arena_kills`.
 *
 * Spec (BACKLOG 5.11): "Rankingi: każda kategoria". Rozszerzenie pokrycia
 * — Arena Killers tab (`arena_kills` column ranking).
 *
 * Tab definition (Leaderboard.tsx linia 153):
 *   { key: 'arena_killers', label: 'Zabójcy', icon: '🗡️',
 *     source: 'characters', characterColumn: 'arena_kills',
 *     order: 'desc', valueLabel: 'Zabicia' }
 *
 * Sort: `arena_kills DESC, limit 100`. Format `valueOverride` brak →
 * fallback `formatValue` → `Zabicia 999` (Leaderboard.tsx linia 404).
 *
 * **Sync-hook SAFE**: `useLeaderboardStatSync` (src/hooks/useLeaderboardStatSync.ts)
 * NIE dotyka `arena_kills` — column jest bumpowana wyłącznie przez
 * `arenaStore.bumpArenaStats` po victory w arenie. Pre-seed via column
 * override przetrwa character switch.
 *
 * Test flow:
 *   1. Seed Knight z arena_kills=999.
 *   2. Login + select character + /leaderboard.
 *   3. Tap tab "Zabójcy" → assert wiersz `.leaderboard__row--me` z "Zabicia 999".
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

    test('Zabójcy tab shows seeded character with arena_kills=999', async ({ page }) => {
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
                    arena_kills: 999,
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

            // valueLabel='Zabicia' + value=999 → "Zabicia 999". Re-fetch poll
            // helper absorbs full-suite DB contention (stale first read).
            await assertSeededRankingRow(page, {
                tabLabel: /^Zabójcy$/,
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
