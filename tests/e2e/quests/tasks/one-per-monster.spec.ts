/**
 * Atomic E2E — tylko 1 task per potwór: kolejne threshold-y dla tego samego
 * potwora są disabled gdy jest już aktywny task.
 *
 * Spec (BACKLOG.md punkt 7.1): "Task: tylko 1 per potwór".
 *
 * Test sprawdza UI enforcement reguły:
 *   - W `taskStore.startTask` jest hard guard: `activeTasks.some((t) =>
 *     t.monsterId === task.monsterId)` -> return wcześnie (taskStore.ts
 *     line 68).
 *   - W Quests.tsx threshold button ma `disabled = !isActive &&
 *     (monsterTaken || isLocked)` (line 1237). `monsterTaken` =
 *     `activeTasks.some(t => t.monsterId === monsterId)`.
 *   - Karta potwora dostaje też `tasks__monster-group--taken` modifier
 *     class oraz ":clipboard: Aktywny" badge (line 1228).
 *
 * Setup: postać Knight + 1 active task `rat_10` (10 zabójstw Szczura).
 * Po hydration UI powinno:
 *   - Pokazać ":clipboard: Aktywny" badge przy Szczurze.
 *   - `tasks__threshold-btn--active` na rat_10 button (active, klikalny
 *     dla cancel — ale cancel idzie przez confirm modal).
 *   - Pozostałe rat_* threshold buttons (rat_50, rat_100, rat_200, …)
 *     mają attribute `disabled` = true.
 *
 * Asercja: tap na disabled rat_50 button NIE WYWOŁA `startTask` w
 * storze -> liczba activeTasks zostaje 1. Drugim asercja: button
 * fizycznie ma atrybut `disabled`.
 *
 * Setup level: Knight lvl 20 (powyżej wszystkich rat_* tasków i
 * monster unlock thresholds — żeby getMonsterUnlockStatus zwracało
 * `unlocked: true` i nie mieszało z 'monsterTaken' disable check-iem).
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

    test('second task on same monster is disabled while another task on that monster is active', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            // 1. Knight lvl 20 — powyżej wszystkich rat task threshold-ów
            //    i monster unlock window (rat monster level = 1, unlocked
            //    od początku).
            const created = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: nick,
                class: 'Knight',
                overrides: { level: 20, highest_level: 20, hp_regen: 0, mp_regen: 0 },
            });
            createdId = created.id;

            // 2. Seed activeTask `rat_10` (10 zabójstw Szczura). Progress 0
            //    żeby card NIE pokazał "v Gotowe!" + claim button — chcemy
            //    czystą active state.
            //    Wartości z `src/data/tasks.json` linia 2-10.
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

            // 3. Login -> wybór postaci -> nawigacja do /quests/tasks.
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

            // 4. Znajdź "Szczur" monster group card. tasks__monster-name-label
            //    nosi nazwę potwora w pl (Quests.tsx line 1227).
            const ratGroup = page.locator('.tasks__monster-group', {
                has: page.locator('.tasks__monster-name-label', { hasText: /^Szczur$/ }),
            });
            await expect(ratGroup).toBeVisible({ timeout: 10_000 });

            // 5. ":clipboard: Aktywny" badge widoczny w headerze grupy szczura
            //    (tasks__monster-active-badge — line 1228).
            await expect(ratGroup.locator('.tasks__monster-active-badge')).toBeVisible();

            // 6. Karta monster-group ma modifier --taken.
            await expect(ratGroup).toHaveClass(/tasks__monster-group--taken/);

            // 7. Threshold buttons inside this group:
            //    rat_10 = active (klasa --active)
            //    rat_50, rat_100, ... = disabled
            const thresholdButtons = ratGroup.locator('.tasks__threshold-btn');
            // Sprawdź że są conajmniej 2 thresholdy (rat_10 + rat_50)
            // — sanity że JSON nie zubożał poniżej zakresu testu.
            expect(await thresholdButtons.count()).toBeGreaterThanOrEqual(2);

            // 8. Pierwszy threshold (rat_10) jest --active.
            //    Sortowanie w renderTasksTab jest po killCount (line 1003).
            const firstBtn = thresholdButtons.first();
            await expect(firstBtn).toHaveClass(/tasks__threshold-btn--active/);

            // 9. KRYTYCZNA ASERCJA: drugi threshold (rat_50) ma attribute
            //    disabled === true. Tap-nięcie go NIE wywołuje startTask
            //    (verify via "no count change" — patrz krok 10).
            const secondBtn = thresholdButtons.nth(1);
            await expect(secondBtn).toBeDisabled();

            // 10. Sanity check zachowania: tap na disabled button —
            //     Playwright force-tap żeby pominąć "element is disabled"
            //     auto-bail; assert NIC się nie zmieniło.
            //     Active counter w sub-controls-meta zostaje "1 aktywne".
            await secondBtn.tap({ force: true });
            await expect(page.locator('.quests__sub-controls-meta')).toContainText('1 aktywne');

            // 11. Liczba threshold-ów z klasą --active w obrębie grupy
            //     Szczura nadal = 1 (nie urosła do 2 mimo force-tap).
            await expect(
                ratGroup.locator('.tasks__threshold-btn--active'),
            ).toHaveCount(1);
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
