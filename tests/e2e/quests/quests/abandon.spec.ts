/**
 * Atomic E2E — porzucenie aktywnego questa usuwa go z listy aktywnych.
 *
 * Spec (BACKLOG.md punkt 7.9): "Quest: porzuć".
 *
 * Test sprawdza pełny user flow:
 *   1. Seed character + 1 active quest in `quests.activeQuests`.
 *   2. Open /quests/quests → active quest visible (Aktywne filter
 *      shows it; the card carries `quests__card--active` class).
 *   3. Tap "✖ Porzuć" button on the active card → confirm modal opens.
 *   4. Tap "✖ Porzuć" confirm button inside the modal.
 *   5. ASSERT: card no longer has `quests__card--active`, and the
 *      "Aktywne (N)" counter dropped from 1 → 0.
 *
 * Setup choice: seed `quest_first_steps` (minLevel=10) AT a character
 * level >= 10 so the quest is "valid" (otherwise the level guard in
 * `addProgress` doesn't matter, but `tooHigh` would mark it locked and
 * the "Porzuć" button would coexist with a `--locked` class which
 * obscures the asserts). Knight level 12 — comfortably above minLevel.
 *
 * Goals seeded with progress: 0 — this drives `canClaim = false`, so
 * the action row renders the "Porzuć" button (not the "Odbierz" button
 * which is only shown when canClaim is true; see Quests.tsx ~line 1506).
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

    test('abandon confirm removes active quest from list and decrements counter', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            // 1. Knight at lvl 12 — meets minLevel=10 of quest_first_steps.
            const created = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: nick,
                class: 'Knight',
                overrides: { level: 12, highest_level: 12, hp_regen: 0, mp_regen: 0 },
            });
            createdId = created.id;

            // 2. Seed quest_first_steps as active with 0 progress on both
            //    goals (kill rat ×50 + kill goblin ×20). Goals shape mirrors
            //    `IQuestGoal` from questStore.ts — type + monsterId + count
            //    + progress. Whatever the JSON spec says about extra fields
            //    is ignored by the store on hydrate.
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
                ],
            });

            // 3. Login → select → navigate to /quests/quests sub-view.
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

            // 4. Active filter button shows "(1)" — verify the seed landed.
            const activeFilterBtn = page.locator('.quests__filter-btn', { hasText: /^Aktywne/ });
            await expect(activeFilterBtn).toContainText('Aktywne (1)');

            // Find the seeded quest card (Pierwsze Kroki) and verify it's
            // marked active.
            const questCard = page.locator('.quests__card', {
                has: page.locator('.quests__card-name', { hasText: 'Pierwsze Kroki' }),
            });
            await expect(questCard).toBeVisible({ timeout: 10_000 });
            await expect(questCard).toHaveClass(/quests__card--active/);

            // 5. Tap "✖ Porzuć" on the active card → confirm modal opens.
            //    Selector: `.quests__action-btn--abandon` inside that
            //    specific card (Quests.tsx line 1508).
            await questCard.locator('.quests__action-btn--abandon').tap();

            // Modal: `.quests__abandon-modal` with confirm button
            // `.quests__abandon-modal-btn--confirm` (line 1786).
            const modal = page.locator('.quests__abandon-modal');
            await expect(modal).toBeVisible({ timeout: 5_000 });
            await modal.locator('.quests__abandon-modal-btn--confirm').tap();

            // 6. Modal closes + Aktywne counter drops to 0.
            await expect(modal).toHaveCount(0, { timeout: 5_000 });
            await expect(activeFilterBtn).toContainText('Aktywne (0)');

            // The same quest card should no longer carry the --active
            // class (it's now "available" again — the player could re-take).
            await expect(questCard).not.toHaveClass(/quests__card--active/);
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
