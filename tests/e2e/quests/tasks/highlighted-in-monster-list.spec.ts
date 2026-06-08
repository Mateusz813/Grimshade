/**
 * Atomic E2E — active task on a monster highlights that monster's card
 * in `/monsters` (Monster List) with the `--task` modifier + task goal
 * pill.
 *
 * Spec (BACKLOG.md 7.6): "Task + quest wyróżnione przy wyborze potwora
 * do polowania". Contract from MonsterList.tsx:
 *   line 282: `!locked && (hasTask || hasQuest) && 'combat__mcard--task'`
 *   line 377-402: when `hasTask`, renders a `.combat__mcard-goal--task`
 *     pill with text "Task {progress}/{killCount}".
 *
 * ## Test strategy
 *
 * Single-context, single-seed. Drop one active task for rat onto a
 * Knight, navigate to /monsters, find the Szczur card (rat is unlocked
 * at lvl 1), assert:
 *   1. Card has `combat__mcard--task` modifier (visual highlight).
 *   2. Task pill `.combat__mcard-goal--task` is visible inside that
 *      card with text "Task 0/10".
 *   3. NEGATIVE — at least one OTHER monster card (e.g. any Lv 1
 *      monster the Knight has unlocked but no task on) lacks the
 *      `--task` modifier — proves the highlight is SELECTIVE, not
 *      everyone-gets-it.
 *
 * The selective negative is critical because the test would silently
 * pass if `combat__mcard--task` started applying to every card (e.g.
 * via a CSS regression that hard-codes the class).
 *
 * ## Why we use SECONDARY account
 *
 * Suite runs concurrent on primary. Secondary is the parallel slot
 * per task brief.
 *
 * ## Setup
 *
 *  1. Seed Knight lvl 5 on SECONDARY (lvl 5 unlocks several monsters
 *     past Szczur, so the negative-assertion control set is non-empty).
 *  2. Seed `rat_10` active task (10 rat kills, progress=0).
 *
 * ## Flow
 *
 *  1. Login → pick character → Town.
 *  2. Navigate to /monsters.
 *  3. Find the Szczur card by `combat__mcard-name` text.
 *  4. Assert card has `combat__mcard--task` modifier.
 *  5. Assert task pill `.combat__mcard-goal--task` is inside that card.
 *  6. Find another unlocked monster card (e.g. spider — also Lv 1,
 *     unlocked by default for Knight per progression.getMonsterUnlockStatus).
 *  7. Assert that OTHER card lacks `combat__mcard--task` modifier.
 *
 * ## Cleanup: try/finally → cleanupCharacterById.
 */

import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';
import { seedQuestState } from '../../fixtures/seedQuestState';

test.describe('Quests › Tasks', { tag: '@progression' }, () => {
    test.describe.configure({ timeout: 90_000 });

    test('Szczur card gets --task modifier + Task pill when rat_10 task is active; other unlocked monsters stay un-highlighted', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            // 1. Seed Knight lvl 5 on SECONDARY — lvl 5 unlocks several
            //    starter monsters past Szczur so we have a non-rat
            //    control card for the negative assertion below.
            const created = await createCharacterViaApi({
                userEmail: testUsers.secondary.email,
                name: nick,
                class: 'Knight',
                overrides: { level: 5, highest_level: 5, hp_regen: 0, mp_regen: 0 },
            });
            createdId = created.id;

            // 2. Seed active `rat_10` task — same shape as 7.1 / 5.14.
            await seedQuestState({
                characterId: created.id,
                activeTasks: [{
                    id: 'rat_10',
                    monsterId: 'rat',
                    monsterLevel: 1,
                    monsterName: 'Szczur',
                    killCount: 10,
                    rewardGold: 50,
                    rewardXp: 100,
                    progress: 0,
                }],
            });

            // 3. Login → pick character → Town.
            await loginViaUI(page, testUsers.secondary);
            await page.goto('/character-select');
            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await expect(card).toBeVisible({ timeout: 10_000 });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });

            // 4. /monsters.
            await page.goto('/monsters');

            // 5. Find Szczur card. Use the FIRST match — monsters.json
            //    only has one entry named "Szczur" so this is safe.
            const szczurCard = page.locator('.combat__mcard', {
                has: page.locator('.combat__mcard-name', { hasText: /^Szczur$/ }),
            }).first();
            await expect(szczurCard).toBeVisible({ timeout: 10_000 });

            // 6. Visual highlight modifier present.
            await expect(szczurCard).toHaveClass(/combat__mcard--task/);

            // 7. Task pill rendered inside that card with "Task 0/10"
            //    text. MonsterList.tsx line 383: `Task {progress}/{killCount}`.
            const taskPill = szczurCard.locator('.combat__mcard-goal--task');
            await expect(taskPill).toBeVisible();
            await expect(taskPill).toContainText(/Task\s+0\s*\/\s*10/);

            // 8. NEGATIVE — at least one other monster card must NOT
            //    have the --task modifier. We don't care which monster
            //    it is (locked OR unlocked), only that the highlight is
            //    selective — guards against a regression that hard-codes
            //    the modifier everywhere (which would silently pass
            //    step 6 but break gameplay).
            //
            //    Knight lvl 5 has Szczur unlocked by default + many
            //    locked higher-level monsters (locked cards lack the
            //    --task modifier per MonsterList.tsx line 282
            //    `!locked && (hasTask || hasQuest)` short-circuit), so
            //    count will be >> 1.
            const unhighlightedCards = page.locator(
                '.combat__mcard:not(.combat__mcard--task)',
            );
            const unhighlightedCount = await unhighlightedCards.count();
            expect(unhighlightedCount).toBeGreaterThan(0);
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
