/**
 * Atomic E2E — quests below player's minLevel are flagged as locked.
 *
 * Spec (BACKLOG.md punkt 7.7): "Quest: tylko na swój poziom".
 *
 * Test sprawdza że Quests view marks every quest whose `minLevel`
 * exceeds the character's level with the `quests__card--locked` class
 * + `quests__locked-label` text ("🔒 Wymagany poziom N"), AND that the
 * "Dostępne" filter (`available`) hides them entirely.
 *
 * Setup: Knight, level 5 (under the minLevel=10 floor of every quest
 * in `src/data/quests.json` — checked via
 * `grep -E '"minLevel": [0-9]+' quests.json | head -1` returns 10).
 *
 * Flow:
 *   1. Seed character (no quest state — fresh) at level 5.
 *   2. Login → select character → navigate to /quests.
 *   3. Tap "Questy" hub tile → enter quests sub-view.
 *   4. Type "10" into the "Lvl od…" level filter input — the filter is
 *      EXACT-match (Quests.tsx line 1349: `q.minLevel === lvlNum`), so
 *      this narrows the list to ONLY minLevel=10 quests. At charLevel=5
 *      every quest in this subset is `tooHigh = true` (locked).
 *   5. Assert the "Pierwsze Kroki" card (minLevel=10) shows
 *      `quests__card--locked` + `quests__locked-label` containing "10".
 *   6. Tap "Dostępne" filter → the level-10 list collapses to 0 because
 *      `isQuestAvailable` returns false for tooHigh quests, and the
 *      empty placeholder `Brak questów w tej kategorii` appears.
 *
 * Why level filter instead of relying on default sort: quests are sorted
 * by minLevel ASC and paginated 20 per page. At charLevel=5 there are
 * 4 level-5 quests + many higher-level quests — without narrowing, the
 * "Pierwsze Kroki" card might land on page 2+ depending on JSON order.
 * Using the level filter to pin to minLevel=10 is deterministic.
 *
 * Why we don't seed quest state: the test verifies STATIC rendering of
 * the quest list against character level, not progression state. Empty
 * `activeQuests` + empty `completedQuestIds` is what a fresh character
 * has, and that's exactly the case we're testing.
 *
 * Cleanup: try/finally + cleanupCharacterById.
 *
 * Edge case parallelism: primary account ran in parallel with other
 * tests; unique nick + per-character cleanup by UUID = no race.
 */

import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';

test.describe('Quests › Quests', { tag: '@progression' }, () => {
    test.describe.configure({ timeout: 60_000 });

    test('quest whose minLevel > character level shows locked label + dropped by "Dostępne" filter', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            // 1. Seed Knight at level 5 — under the level-10 floor of
            //    every JSON quest, so EVERY quest in the list is locked.
            const created = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: nick,
                class: 'Knight',
                overrides: { level: 5, highest_level: 5, hp_regen: 0, mp_regen: 0 },
            });
            createdId = created.id;

            // 2. Login → /character-select → tap Wybierz on our card.
            await loginViaUI(page, testUsers.primary);
            await page.goto('/character-select');
            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await expect(card).toBeVisible({ timeout: 10_000 });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 10_000 });

            // 3. Navigate to /quests → land on the 3-tile hub picker.
            await page.goto('/quests');
            await expect(page.locator('.quests__hub-tile--quests')).toBeVisible({ timeout: 10_000 });

            // Tap the "Questy" hub tile to enter the quests sub-view.
            await page.locator('.quests__hub-tile--quests').tap();

            // 4. Wait for filter row + quest list to render.
            await expect(page.locator('.quests__filters')).toBeVisible({ timeout: 10_000 });

            // 5. Type "10" into the inline level filter — narrows the
            //    quest list to ONLY minLevel=10 entries (exact-match per
            //    Quests.tsx line 1349). Deterministic regardless of how
            //    pagination + ASC sort orders the broader list.
            const lvlInput = page.locator('.quests__lvl-filter--inline');
            await lvlInput.fill('10');

            // Find the "Pierwsze Kroki" quest card (minLevel=10, locked
            // at charLevel=5). With the filter at 10, this card MUST be
            // on page 1.
            const firstStepsCard = page.locator('.quests__card', {
                has: page.locator('.quests__card-name', { hasText: 'Pierwsze Kroki' }),
            });
            await expect(firstStepsCard).toBeVisible({ timeout: 10_000 });

            // CRITICAL ASSERTION 1: locked class on the card.
            await expect(firstStepsCard).toHaveClass(/quests__card--locked/);

            // CRITICAL ASSERTION 2: "🔒 Wymagany poziom 10" label appears
            //   inside the card. The label exists only when `tooHigh &&
            //   !completed` (Quests.tsx ~line 1537-1541).
            await expect(firstStepsCard.locator('.quests__locked-label')).toContainText('10');

            // 6. Tap "Dostępne" filter — drops ALL tooHigh quests
            //    (isQuestAvailable returns false). Combined with the
            //    level=10 filter, the visible list collapses to 0.
            const availableFilter = page.locator('.quests__filter-btn', { hasText: /^Dostępne/ });
            await availableFilter.tap();
            await expect(availableFilter).toHaveClass(/quests__filter-btn--active/);

            // Pierwsze Kroki card should be GONE — Dostępne filter
            // dropped it.
            await expect(firstStepsCard).toHaveCount(0, { timeout: 5_000 });

            // Empty placeholder confirms the filter did the job (and that
            // we're not accidentally on a completely different screen).
            // The level filter is still set to 10, and available∩lvl10 =
            // empty set at charLevel=5.
            await expect(page.locator('.quests__empty')).toContainText('Brak questów');
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
