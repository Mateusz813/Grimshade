/**
 * Atomic E2E — Daily missions panel hydrates seeded "today's quests"
 * and renders them as active + claimable cards.
 *
 * Spec (BACKLOG.md punkt 7.11): "Daily missions: pobierz + wykonaj
 * (open daily tab → take daily → verify in active)".
 *
 * App-side reality check (vs the loose "pobierz + wykonaj" wording):
 *   • Daily quests are NOT manually pickable — `refreshIfNeeded` in
 *     `useDailyQuestStore` (dailyQuestStore.ts line 45) auto-seeds 12
 *     random daily defs + activeQuests with `progress: 0` the FIRST
 *     time the player opens the panel on a new day. There is no
 *     "Weź daily" button — the test "takes" by being on the panel.
 *   • "Wykonaj" (complete) happens through gameplay (combat, dungeons,
 *     potion use, …) which feeds `addProgress(goalType, amount)`. To
 *     test the complete → claimable transition deterministically we
 *     seed a daily quest with `progress = goal.count, completed: true`
 *     and assert the claim flow.
 *
 * What this test asserts:
 *   1. Daily tab unlocks at level 25 (`isDailyLocked = level < 25`,
 *      Quests.tsx line 715). Seed Knight lvl 30 → "🔒 Questy dzienne
 *      odblokuja sie na poziomie 25" placeholder MUST NOT render.
 *   2. After hub-tile tap → `.quests__daily-list` mounts with our
 *      seeded daily defs.
 *   3. Both seeded daily quest cards visible by name:
 *        • "Rozgrzewka" — pre-completed (progress = goal.count) →
 *          card carries `quests__daily-quest--completed` modifier +
 *          "🎁 Odbierz nagrodę" claim button.
 *        • "Polowanie" — in-progress (progress = 3, goal = 10) → card
 *          has NEITHER `--completed` NOR `--claimed` modifier.
 *   4. Bulk "Odbierz wszystkie daily (N)" CTA visible because at least
 *      one daily is claimable (Quests.tsx line 740-748).
 *   5. Tapping the "Rozgrzewka" claim button transitions the card from
 *      `--completed` to `--claimed` (UI source of truth for the
 *      "wykonaj" flow). The "✓ Odebrane" label appears in the action
 *      row (line 832).
 *
 * Why seed both states: covers both "freshly picked / in progress" AND
 * "ready to claim" — the two key visual states of the daily flow.
 *
 * Why pick Rozgrzewka + Polowanie (not random from json): both are
 * `kill_any` goals at minLevel=25, easy to read in assertions, present
 * in dailyQuests.json (first two rows). Pre-completing "Rozgrzewka"
 * gives us a deterministic claim button to tap.
 *
 * Cleanup: try/finally + cleanupCharacterById.
 */

import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';
import { seedQuestState } from '../../fixtures/seedQuestState';

test.describe('Quests › Daily', { tag: '@progression' }, () => {
    test.describe.configure({ timeout: 60_000 });

    test('daily tab shows seeded today-quests; claim button on a completed daily moves it to claimed state', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            // 1. Knight lvl 30 — clears the lvl-25 unlock gate
            //    (`isDailyLocked = level < 25`, Quests.tsx line 715).
            //    Pin regen to 0 so TopHeader pulse doesn't repaint during
            //    the test.
            const created = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: nick,
                class: 'Knight',
                overrides: { level: 30, highest_level: 30, hp_regen: 0, mp_regen: 0 },
            });
            createdId = created.id;

            // 2. Seed today's daily quests. `lastRefreshDate = today`
            //    (default in seedQuestState) so `refreshIfNeeded` no-ops
            //    in the Quests.tsx mount effect (line 365) and keeps our
            //    pinned `todayQuestDefs` + `activeQuests`.
            //
            //    First daily: pre-completed → claim button. Values
            //    mirror `src/data/dailyQuests.json` rows 1-19.
            //    Second daily: progress mid-flight → in-progress UI.
            await seedQuestState({
                characterId: created.id,
                dailyQuests: {
                    todayQuestDefs: [
                        {
                            id: 'daily_kill_5',
                            name_pl: 'Rozgrzewka',
                            name_en: 'Warm Up',
                            description_pl: 'Zabij 5 dowolnych potworow',
                            minLevel: 25,
                            goal: { type: 'kill_any', count: 5 },
                            rewards: { gold: 200, xp: 100 },
                        },
                        {
                            id: 'daily_kill_10',
                            name_pl: 'Polowanie',
                            name_en: 'Hunt',
                            description_pl: 'Zabij 10 dowolnych potworow',
                            minLevel: 25,
                            goal: { type: 'kill_any', count: 10 },
                            rewards: { gold: 400, xp: 200 },
                        },
                    ],
                    activeQuests: [
                        // Pre-completed (progress >= goal.count) → renders
                        // "🎁 Odbierz nagrodę" button.
                        {
                            questId: 'daily_kill_5',
                            progress: 5,
                            completed: true,
                            claimed: false,
                        },
                        // In-progress (3/10) → neither --completed nor
                        // --claimed; no claim button.
                        {
                            questId: 'daily_kill_10',
                            progress: 3,
                            completed: false,
                            claimed: false,
                        },
                    ],
                },
            });

            // 3. Login → character select → Town → /quests.
            await loginViaUI(page, testUsers.primary);
            await page.goto('/character-select');
            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await expect(card).toBeVisible({ timeout: 10_000 });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 10_000 });

            await page.goto('/quests');
            // Daily hub tile (id='daily' → class `quests__hub-tile--daily`).
            const dailyHubTile = page.locator('.quests__hub-tile--daily');
            await expect(dailyHubTile).toBeVisible({ timeout: 10_000 });
            await dailyHubTile.tap();

            // 4. ASSERTION #1: NOT locked (we're at lvl 30 >= 25).
            await expect(page.locator('.quests__daily-locked')).toHaveCount(0);

            // 5. ASSERTION #2: daily list mounted.
            const dailyList = page.locator('.quests__daily-list');
            await expect(dailyList).toBeVisible({ timeout: 10_000 });

            // 6. ASSERTION #3a: Rozgrzewka card visible + --completed
            //    modifier present + claim button rendered.
            const rozgrzewkaCard = page.locator('.quests__daily-quest', {
                has: page.locator('.quests__daily-quest-name', { hasText: 'Rozgrzewka' }),
            });
            await expect(rozgrzewkaCard).toBeVisible({ timeout: 10_000 });
            await expect(rozgrzewkaCard).toHaveClass(/quests__daily-quest--completed/);
            const claimBtn = rozgrzewkaCard.locator('.quests__action-btn--claim');
            await expect(claimBtn).toBeVisible();

            // 7. ASSERTION #3b: Polowanie card visible + NEITHER modifier
            //    (in-progress state).
            const polowanieCard = page.locator('.quests__daily-quest', {
                has: page.locator('.quests__daily-quest-name', { hasText: 'Polowanie' }),
            });
            await expect(polowanieCard).toBeVisible();
            await expect(polowanieCard).not.toHaveClass(/quests__daily-quest--completed/);
            await expect(polowanieCard).not.toHaveClass(/quests__daily-quest--claimed/);

            // 8. ASSERTION #4: bulk "Odbierz wszystkie daily" CTA visible
            //    (at least one daily is claimable). The bulk row
            //    container has --center modifier per line 744.
            const bulkClaimBtn = page.locator(
                '.quests__bulk-actions--center .quests__bulk-btn--claim',
            );
            await expect(bulkClaimBtn).toBeVisible();
            await expect(bulkClaimBtn).toContainText('Odbierz wszystkie daily (1)');

            // 9. ASSERTION #5: tap the per-card claim button → Rozgrzewka
            //    transitions from --completed to --claimed; "✓ Odebrane"
            //    label replaces the claim button (Quests.tsx line 832).
            await claimBtn.tap();
            await expect(rozgrzewkaCard).toHaveClass(/quests__daily-quest--claimed/, {
                timeout: 5_000,
            });
            await expect(rozgrzewkaCard.locator('.quests__completed-label')).toContainText(
                'Odebrane',
            );
            // Claim button gone.
            await expect(rozgrzewkaCard.locator('.quests__action-btn--claim')).toHaveCount(0);
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
