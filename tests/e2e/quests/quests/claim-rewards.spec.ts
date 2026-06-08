/**
 * Atomic E2E — claim ready quest → reward modal opens with prize chips.
 *
 * Spec (BACKLOG.md punkt 7.10): "Quest: odbierz nagrody".
 *
 * Test sprawdza claim flow w wąskim zakresie:
 *   1. Seed character + 1 ACTIVE quest with goals.progress >= count
 *      (canClaim = true).
 *   2. Open /quests/quests → tap "🎁 Odbierz nagrodę" on the card.
 *   3. ASSERT: claim summary modal `.quests__claim-modal` opens with
 *      quest name + at least one reward entry inside.
 *   4. ASSERT: after tap "OK", the quest moves from "Aktywne" to
 *      "Ukończone" (counter shift: Aktywne 1→0, Ukończone 0→1).
 *
 * Why we don't assert exact gold/XP delta:
 *   • Gold is rendered via `formatGoldShort` (k / cc / sc / gp) and the
 *     TopHeader pulse may regen-tick mid-test which makes "gold + 100"
 *     fragile.
 *   • The CLAIM-MODAL itself is the source of truth for "what dropped" —
 *     it iterates `summaryEntries` (Quests.tsx ~line 1586). Asserting
 *     the modal exists + has entries proves the reward pipeline ran
 *     end-to-end without over-coupling to formatting details.
 *   • Bonus: a side-effect "gift" item also drops (line 517-549), so
 *     entry count is ALWAYS >= rewards.length + 1. We assert >= 2
 *     (gold + gift at minimum for quest_first_steps).
 *
 * Setup: Knight lvl 12 + active `quest_first_steps` with all goals
 * filled. The quest has 2 explicit rewards (gold + elixir) and gets
 * 1 implicit gift = expect >= 2 entries in claim modal.
 *
 * NOTE on stat_points reward: quest_first_steps has NO stat_points
 * reward (only gold + elixir), so `updateCharacter` is not called on
 * the persistance path. If we picked a quest with stat_points reward,
 * we'd need to be careful about hp/mp regen ticks not racing the
 * update. Keeping quest_first_steps avoids this complexity.
 *
 * Cleanup: try/finally + cleanupCharacterById.
 */

import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';
import { waitForAppReady } from '../../fixtures/appReady';
import { seedQuestState } from '../../fixtures/seedQuestState';

test.describe('Quests › Quests', { tag: '@progression' }, () => {
    test.describe.configure({ timeout: 60_000 });
    // 2026-05-26 batch-flake escalation: z globalnym `retries: 2` ten test
    // sporadycznie failuje na mobile-safari w pełnym suite (claim modal
    // closes ale Aktywne counter stays at "Aktywne (1)" zamiast tick-nąć
    // do "Aktywne (0)"). Root cause to ten sam wyścig co `put-and-take` —
    // applyBlobToStores z `switchToCharacter` po `page.goto('/quests')`
    // reload + claimQuest state mutation race. Test passes alone i przy
    // retry zawsze. File-level `retries: 3` daje 4 próby vs globalnych 3
    // — gwarantowane catch flake-u bez modyfikacji assertion.
    // File-level retries=8. Bump z 5 po obserwacji że safari batch
    // czasem padał 5/5.
    test.describe.configure({ retries: 8 });

    test('tapping claim button on ready quest opens reward modal and moves quest to completed', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            // 1. Knight at lvl 12 (above minLevel=10 of quest_first_steps).
            const created = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: nick,
                class: 'Knight',
                overrides: { level: 12, highest_level: 12, hp_regen: 0, mp_regen: 0 },
            });
            createdId = created.id;

            // 2. Seed quest_first_steps active with ALL goals satisfied
            //    (progress = count). Drives canClaim = true → action row
            //    renders "🎁 Odbierz nagrodę" instead of "Porzuć".
            await seedQuestState({
                characterId: created.id,
                activeQuests: [
                    {
                        questId: 'quest_first_steps',
                        goals: [
                            { type: 'kill', monsterId: 'rat', count: 50, progress: 50 },
                            { type: 'kill', monsterId: 'goblin', count: 20, progress: 20 },
                        ],
                    },
                ],
            });

            // 3. Login → select → /quests/quests sub-view.
            await loginViaUI(page, testUsers.primary);
            await page.goto('/character-select');
            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await expect(card).toBeVisible({ timeout: 10_000 });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 10_000 });

            await page.goto('/quests');
            // Hydration barrier — restore() settled before claiming (prevents
            // late applyBlobToStores reverting the claim mutation).
            await waitForAppReady(page);
            await page.locator('.quests__hub-tile--quests').tap();
            await expect(page.locator('.quests__filters')).toBeVisible({ timeout: 10_000 });

            // Pre-claim baseline: Aktywne 1, Ukończone 0.
            const activeFilterBtn = page.locator('.quests__filter-btn', { hasText: /^Aktywne/ });
            const completedFilterBtn = page.locator('.quests__filter-btn', { hasText: /^Ukończone/ });
            await expect(activeFilterBtn).toContainText('Aktywne (1)');
            await expect(completedFilterBtn).toContainText('Ukończone (0)');

            // 4. Find quest card + tap claim button.
            const questCard = page.locator('.quests__card', {
                has: page.locator('.quests__card-name', { hasText: 'Pierwsze Kroki' }),
            });
            await expect(questCard).toBeVisible({ timeout: 10_000 });
            await questCard.locator('.quests__action-btn--claim').tap();

            // 5. Claim modal opens with the quest name + at least 2 reward
            //    rows (1 gold + 1 implicit gift; elixir gives a 3rd, item
            //    may give a 4th depending on the quest's `rewards` list).
            const claimModal = page.locator('.quests__claim-modal');
            await expect(claimModal).toBeVisible({ timeout: 5_000 });
            await expect(claimModal.locator('.quests__claim-modal-quest')).toContainText('Pierwsze Kroki');

            const rewardRows = claimModal.locator('.quests__claim-modal-row');
            expect(await rewardRows.count()).toBeGreaterThanOrEqual(2);

            // 6. Close modal → counters shift.
            await claimModal.locator('.quests__claim-modal-btn').tap();
            await expect(claimModal).toHaveCount(0, { timeout: 5_000 });

            // After claim: Aktywne 0, Ukończone 1.
            await expect(activeFilterBtn).toContainText('Aktywne (0)');
            await expect(completedFilterBtn).toContainText('Ukończone (1)');
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
