/**
 * Atomic E2E — Task filters narrow the visible monster list.
 *
 * Spec (BACKLOG.md punkt 7.3): "Task: filtry działają" — 3 chip toggles
 * + "Lvl od…" input MUST narrow the list deterministically.
 *
 * Covered here (3 of 4 controls — the 4th, ":check-mark-button: Dostępne taski", is gated
 * on a multi-monster mastery cascade per `getMonsterUnlockStatus` in
 * `src/systems/progression.ts`. Without seeding mastery for every
 * prerequisite monster only the level-1 "Szczur" is unlocked at any
 * character level. That requires its own setup helper — left to a future
 * spec dedicated to the unlock cascade):
 *
 *   1. "Lvl od…" input (`.quests__lvl-filter`) -> `monsterLevel >= N`
 *      (Quests.tsx line 977). Seed Knight + type "5" -> every monster
 *      group of level <5 disappears (rat lvl1, cave_spider lvl2,
 *      green_slime lvl3, goblin lvl4 — see `tasks.json`). Level-5+
 *      groups stay.
 *
 *   2. ":stop-sign: Nieaktywne taski" chip (`.quests__filter-chip`) -> drops every
 *      monster the player already has an active task on (Quests.tsx line
 *      994). Seed `rat_10` active -> toggle the chip -> "Szczur" group
 *      disappears.
 *
 *   3. ":down-arrow: Sortuj od najwyższego lvl" chip -> flips the sort order
 *      (Quests.tsx line 999). With "Lvl od…" pinned at 5 we get a small
 *      deterministic window. Toggle the desc chip -> first monster card
 *      changes from low-level to high-level (the page slice flips end
 *      to start).
 *
 * Setup: Knight lvl 20. Plus seeded active task `rat_10` so the
 * "Nieaktywne" assertion has a concrete monster to remove.
 *
 * Why pinning "Lvl od" first: tasks.json has ~70 monster groups, paginated
 * 20 per page. Without narrowing the list, "first" / "last" assertions
 * are at the mercy of whatever the JSON top happens to be — too brittle.
 * Pinning to "lvl >=5" leaves a deterministic window of ~5-6 mid-level
 * monsters in the first page slice (rat=1, spider=2, slime=3, goblin=4
 * all drop; bandyta=5, mrówka=6, … stay), which makes sort assertions
 * resilient even if someone adds a new monster.
 *
 * Cleanup: try/finally + cleanupCharacterById.
 */

import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';
import { seedQuestState } from '../../fixtures/seedQuestState';

test.describe('Quests › Tasks', { tag: '@progression' }, () => {
    test.describe.configure({ timeout: 60_000 });

    test('Lvl-od input + Nieaktywne chip + Sortuj desc chip each narrow / reorder the list', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            // 1. Knight lvl 20 — plenty high so the level guard never
            //    rejects any task in our test window. Regen off so the
            //    TopHeader doesn't tick + repaint during input typing.
            const created = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: nick,
                class: 'Knight',
                overrides: { level: 20, highest_level: 20, hp_regen: 0, mp_regen: 0 },
            });
            createdId = created.id;

            // 2. Seed active task on Szczur (rat) so we have a concrete
            //    monster to test the "Nieaktywne" chip against.
            await seedQuestState({
                characterId: created.id,
                activeTasks: [
                    {
                        id: 'rat_10',
                        monsterId: 'rat',
                        monsterLevel: 1,
                        monsterName: 'Szczur',
                        killCount: 10,
                        rewardGold: 50,
                        rewardXp: 100,
                        progress: 0,
                    },
                ],
            });

            // 3. Login -> select -> navigate to /quests/tasks.
            await loginViaUI(page, testUsers.primary);
            await page.goto('/character-select');
            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await expect(card).toBeVisible({ timeout: 10_000 });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 10_000 });

            await page.goto('/quests');
            await page.locator('.quests__hub-tile--tasks').tap();
            await expect(page.locator('.tasks__list')).toBeVisible({ timeout: 10_000 });

            // BASELINE: with no filters the rat group MUST be present
            // somewhere on page 1 (rat_monsterLevel=1 sorts first and
            // there are <20 groups before any other lvl 1 monsters).
            const ratGroup = page.locator('.tasks__monster-group', {
                has: page.locator('.tasks__monster-name-label', { hasText: /^Szczur$/ }),
            });
            await expect(ratGroup).toBeVisible({ timeout: 5_000 });
            // Baseline meta — at least 1 active task because we seeded it.
            await expect(page.locator('.quests__sub-controls-meta')).toContainText('1 aktywne');

            // -- ASSERTION 1: Lvl od filter -----------------------------
            // Type "5" -> keep only monsterLevel >= 5. Rat (lvl 1), spider
            // (lvl 2), slime (lvl 3), goblin (lvl 4) all drop. The rat
            // group MUST disappear entirely (count = 0).
            const lvlInput = page.locator('.quests__lvl-filter').first();
            await lvlInput.fill('5');
            await expect(ratGroup).toHaveCount(0, { timeout: 5_000 });

            // Reset for next assertion.
            await lvlInput.fill('');
            await expect(ratGroup).toBeVisible({ timeout: 5_000 });

            // -- ASSERTION 2: Nieaktywne chip ---------------------------
            // Toggle ":stop-sign: Nieaktywne taski" -> drops every monster the
            // player has an active task on. Rat is our only seeded
            // active monster -> its group MUST disappear.
            const inactiveChip = page.locator('.quests__filter-chip', {
                hasText: /Nieaktywne/,
            });
            await inactiveChip.tap();
            await expect(inactiveChip).toHaveClass(/quests__filter-chip--on/);
            await expect(ratGroup).toHaveCount(0, { timeout: 5_000 });

            // Toggle back off — rat reappears.
            await inactiveChip.tap();
            await expect(inactiveChip).not.toHaveClass(/quests__filter-chip--on/);
            await expect(ratGroup).toBeVisible({ timeout: 5_000 });

            // -- ASSERTION 3: Sortuj desc chip --------------------------
            // Pin "Lvl od" to 5 so the list has a small deterministic
            // window (level 5..N monsters). Capture the FIRST group's
            // monster name. Toggle ":down-arrow: Sortuj od najwyższego lvl" -> first
            // group MUST be a different name (it's now sorted desc =
            // highest-level first).
            await lvlInput.fill('5');
            // Wait for re-render after filter narrowing.
            await expect(ratGroup).toHaveCount(0);

            const firstGroupName = async (): Promise<string> => {
                return (
                    (await page
                        .locator('.tasks__list .tasks__monster-name-label')
                        .first()
                        .textContent()) ?? ''
                ).trim();
            };

            const ascFirst = await firstGroupName();
            expect(ascFirst.length).toBeGreaterThan(0); // sanity

            const sortChip = page.locator('.quests__filter-chip', {
                hasText: /Sortuj od najwyższego lvl/,
            });
            await sortChip.tap();
            await expect(sortChip).toHaveClass(/quests__filter-chip--on/);

            const descFirst = await firstGroupName();
            // KRYTYCZNA ASERCJA: sort flipped -> first monster name
            // changed. (We don't assert exact level because tasks.json
            // can grow/shrink; we only assert order changed.)
            expect(descFirst).not.toEqual(ascFirst);
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
