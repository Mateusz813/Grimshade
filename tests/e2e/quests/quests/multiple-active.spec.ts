/**
 * Atomic E2E — multiple quests can be active simultaneously.
 *
 * Spec (BACKLOG.md punkt 7.8): "Quest: kilka na raz" — player can hold
 * unlimited concurrent quests (Quests.tsx line 1368 inline comment:
 * "No limit — player can have unlimited concurrent quests").
 *
 * Test verifies:
 *   1. Seed 2 quests as active in `quests.activeQuests` slice.
 *   2. Land on the Questy sub-view.
 *   3. The "Aktywne (N)" filter counter reads "(2)".
 *   4. Both quest cards are visible AND each carries the
 *      `quests__card--active` modifier (Quests.tsx line 1377).
 *
 * Setup: Knight lvl 12 (above minLevel=10 of both seeded quests).
 * Quests picked:
 *   • `quest_first_steps`  (Pierwsze Kroki) — kill rat ×50 + goblin ×20
 *   • `quest_undead_hunter` (Lowca Nieumarych) — kill skeleton ×30 +
 *     zombie ×30
 * Both seeded with progress=0 so neither lights up the claim button
 * (canClaim=false → action row stays in the "Porzuć" state, which is
 * irrelevant for the test but keeps the UI in the cleanest assertion
 * surface — no claim modal popping during the test run).
 *
 * Why a level filter is needed to keep both cards on page 1:
 *   The quest list is sorted by minLevel ASC and paginated 20 per page
 *   (Quests.tsx line 1354, QUESTS_PER_PAGE=20). At Knight lvl 12 both
 *   our quests are visible without pagination, but the test also wants
 *   to ASSERT both cards are mounted. Pinning the inline lvl input to
 *   "10" (Quests.tsx line 1349 exact-match: `q.minLevel === lvlNum`)
 *   narrows the visible list to ONLY minLevel=10 quests, guaranteeing
 *   both our cards land on page 1 even if quests.json grows.
 *
 * Cleanup: try/finally + cleanupCharacterById.
 */

import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';
import { seedQuestState } from '../../fixtures/seedQuestState';

test.describe('Quests › Quests', { tag: '@progression' }, () => {
    test.describe.configure({ timeout: 60_000 });

    test('two active quests on the same character render side-by-side with --active modifier and counter "(2)"', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            // 1. Knight at lvl 12 — clears minLevel=10 of both seeded
            //    quests. Regen pinned to 0 so TopHeader's HP/MP pulse
            //    doesn't tick during the test.
            const created = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: nick,
                class: 'Knight',
                overrides: { level: 12, highest_level: 12, hp_regen: 0, mp_regen: 0 },
            });
            createdId = created.id;

            // 2. Seed 2 active quests with progress=0 on every goal.
            //    The goal shape mirrors `IQuestGoal` (questStore.ts line
            //    18); keys not listed in `stateKeys` are silently
            //    filtered by characterScope on rehydrate.
            await seedQuestState({
                characterId: created.id,
                activeQuests: [
                    {
                        questId: 'quest_first_steps',
                        goals: [
                            { type: 'kill', monsterId: 'rat', count: 50, progress: 0 },
                            { type: 'kill', monsterId: 'goblin', count: 20, progress: 0 },
                        ],
                    },
                    {
                        questId: 'quest_undead_hunter',
                        goals: [
                            { type: 'kill', monsterId: 'skeleton', count: 30, progress: 0 },
                            { type: 'kill', monsterId: 'zombie', count: 30, progress: 0 },
                        ],
                    },
                ],
            });

            // 3. Login → select character → /quests → tap Questy hub tile.
            await loginViaUI(page, testUsers.primary);
            await page.goto('/character-select');
            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await expect(card).toBeVisible({ timeout: 10_000 });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 10_000 });

            await page.goto('/quests');
            await page.locator('.quests__hub-tile--quests').tap();
            await expect(page.locator('.quests__filters')).toBeVisible({ timeout: 10_000 });

            // 4. KRYTYCZNA ASERCJA #1: "Aktywne (N)" filter reads (2).
            //    This counter reads from `activeCount = activeQuests.length`
            //    (Quests.tsx line 711) which is hydrated from our seed.
            const activeFilterBtn = page.locator('.quests__filter-btn', {
                hasText: /^Aktywne/,
            });
            await expect(activeFilterBtn).toContainText('Aktywne (2)');

            // 5. Pin the inline lvl filter to 10 so both our minLevel=10
            //    quests land on page 1 regardless of how quests.json
            //    grows in the future. Quests.tsx line 1349 does exact
            //    match: `q.minLevel === lvlNum`.
            const lvlInput = page.locator('.quests__lvl-filter--inline');
            await lvlInput.fill('10');

            // 6. KRYTYCZNA ASERCJA #2: both quest cards visible.
            const firstStepsCard = page.locator('.quests__card', {
                has: page.locator('.quests__card-name', { hasText: 'Pierwsze Kroki' }),
            });
            const undeadCard = page.locator('.quests__card', {
                has: page.locator('.quests__card-name', { hasText: 'Lowca Nieumarych' }),
            });
            await expect(firstStepsCard).toBeVisible({ timeout: 10_000 });
            await expect(undeadCard).toBeVisible({ timeout: 10_000 });

            // 7. KRYTYCZNA ASERCJA #3: BOTH cards carry the --active
            //    modifier (proves both are recognised as active, not
            //    just rendered as the default available card).
            await expect(firstStepsCard).toHaveClass(/quests__card--active/);
            await expect(undeadCard).toHaveClass(/quests__card--active/);

            // 8. Bonus sanity: filter explicitly to "Aktywne" — both
            //    cards still render (proves they live in the active
            //    category, not just visible because lvl filter caught
            //    them).
            await activeFilterBtn.tap();
            await expect(activeFilterBtn).toHaveClass(/quests__filter-btn--active/);
            await expect(firstStepsCard).toBeVisible();
            await expect(undeadCard).toBeVisible();
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
