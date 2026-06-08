/**
 * Atomic E2E — header TaskBadge zmienia stan na "claimable" gdy task
 * jest gotowy do odbioru.
 *
 * Spec (BACKLOG.md punkt 7.12): "Notification w header po complete".
 *
 * Test sprawdza globalny TaskBadge (`src/components/layout/TopHeader/
 * TaskBadge.tsx`) — pasek w headerze pokazujący wszystkie aktywne
 * task-i + quest-y. Gdy choć jeden ma progress >= goal:
 *   • Button dostaje modifier class `top-header__tasks-btn--claimable`.
 *   • Ikona zmienia się z 📋 (przy 0 claim) na 🎁 (line 169 TaskBadge.tsx).
 *   • Pojawia się "status dot" `.top-header__tasks-status-dot--claim`.
 *   • Aria-label kończy się "X do odebrania" (line 150).
 *
 * Liczba `claimableCount` w props TaskBadge jest obliczana w TopHeader
 * — sumuje tasks claimable + quests claimable + daily claimable.
 *
 * Setup: postać Knight + 1 active task z progress >= killCount
 * (rat_10 z progress=10 → done). Hydration uruchamia TaskBadge
 * render — sprawdzamy modifier class + ikonę po wejściu do dowolnego
 * widoku (TopHeader siedzi we wszystkich routes per AppRouter).
 *
 * Pre-condition assertion: bez claimable task, TaskBadge button też
 * istnieje (rows.length > 0 = at least 1 active task), ale BEZ klasy
 * --claimable. Test seeduje claimable → asercja na obecność klasy.
 *
 * Cleanup: try/finally + cleanupCharacterById.
 */

import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';
import { seedQuestState } from '../../fixtures/seedQuestState';

test.describe('Quests › Notifications', { tag: '@progression' }, () => {
    test.describe.configure({ timeout: 60_000 });

    test('TopHeader TaskBadge gets --claimable modifier when at least one task is ready to claim', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            // 1. Knight lvl 20 — task rat_10 minLevel=1 więc trywialnie się
            //    kwalifikuje. Wysoki level usuwa też zaburzenia od level guard
            //    w questStore (nie istotne dla tasków, ale future-proof).
            const created = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: nick,
                class: 'Knight',
                overrides: { level: 20, highest_level: 20, hp_regen: 0, mp_regen: 0 },
            });
            createdId = created.id;

            // 2. Seed active task `rat_10` z progress=killCount=10 → claimable.
            //    Wartości z `src/data/tasks.json`.
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
                        // progress === killCount → claimable=true.
                        progress: 10,
                    },
                ],
            });

            // 3. Login → wybór postaci → wejście do Town view (TopHeader
            //    jest mounted od momentu wybrania postaci).
            await loginViaUI(page, testUsers.primary);
            await page.goto('/character-select');
            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await expect(card).toBeVisible({ timeout: 10_000 });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 10_000 });

            // 4. TopHeader na Town view musi być widoczny.
            await expect(page.locator('.top-header')).toBeVisible({ timeout: 10_000 });

            // 5. TaskBadge button istnieje (rows.length > 0 → component
            //    render-uje się; przy 0 rows render-uje null per line 138).
            const taskBadgeBtn = page.locator('.top-header__tasks-btn');
            await expect(taskBadgeBtn).toBeVisible({ timeout: 10_000 });

            // 6. KRYTYCZNA ASERCJA: button ma modifier `--claimable`.
            //    Klasa dodawana gdy `hasClaim = claimableCount > 0`
            //    (TaskBadge.tsx line 162). claimableCount przychodzi z
            //    parent TopHeader który sumuje task + quest + daily claims.
            await expect(taskBadgeBtn).toHaveClass(/top-header__tasks-btn--claimable/);

            // 7. Ikona zmienia się na 🎁 (gift) przy claim mode
            //    (TaskBadge.tsx line 169). Sprawdzamy text content
            //    bezpośrednio w span ikony.
            await expect(taskBadgeBtn.locator('.top-header__tasks-icon')).toHaveText('🎁');

            // 8. Status dot z modifier --claim (purple pulse) widoczny.
            await expect(
                taskBadgeBtn.locator('.top-header__tasks-status-dot--claim'),
            ).toBeVisible();

            // 9. Aria-label kończy się "do odebrania" (zawiera literal
            //    string z TaskBadge.tsx line 150).
            const ariaLabel = await taskBadgeBtn.getAttribute('aria-label');
            expect(ariaLabel).toContain('do odebrania');

            // 10. Count = 1 (jedna aktywna pozycja w liście rows).
            await expect(taskBadgeBtn.locator('.top-header__tasks-count')).toHaveText('1');
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
