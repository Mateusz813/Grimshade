/**
 * Atomic E2E — "Tylko z taskiem / questem" filter w `/monsters` faktycznie
 * zostawia TYLKO potwory na których gracz ma aktywny task lub quest.
 *
 * Spec (BACKLOG.md punkt 5.4 expansion): rozszerzenie pokrycia filtrów
 * monster-list o `filterTaskedOnly` (oryginalny test `filters.spec.ts`
 * pokrywał 3 z 4 kontrolek; ten dorzuca 4-tą).
 *
 * Mechanika (`MonsterList.tsx` linia 167-171):
 *   ```
 *   if (filterTaskedOnly) {
 *       const hasT = activeTasks.some((t) => t.monsterId === m.id);
 *       const hasQ = getActiveQuestKillProgress(activeQuests, m.id).length > 0;
 *       if (!hasT && !hasQ) return false;
 *   }
 *   ```
 *
 * Toggle filtra pozostawia w liście WYŁĄCZNIE potwory na których
 * jest active task lub active quest kill goal. Bez seedu wszystkie
 * inne karty znikają — bardzo deterministyczna asercja (count = N gdzie
 * N to liczba seedowanych task-/quest-monsterów).
 *
 * ## Setup
 *
 * - Knight lvl 5 — task na rat (lvl 1) sortuje się jako pierwsza karta.
 * - Active task `rat_10` (monsterId=`rat`, threshold 10 kills) — `Szczur`
 *   pojawia się w "Tylko z taskiem" filter.
 *
 * Bez questu — sam task wystarczy bo `hasT || hasQ` (warunek alternative).
 *
 * ## Selektor + asercja
 *
 * - `combat__filter-toggle` z textem "Tylko z taskiem / questem"
 *   (MonsterList.tsx linia 214).
 * - Po tap → class `combat__filter-toggle--active` (linia 206) + filter
 *   się aplikuje natychmiast (controlled checkbox onChange).
 * - Asercja: `combat__mcard` count = 1 (rat) + sprawdzamy że karta to
 *   właśnie "Szczur".
 *
 * ## Comparison vs default state
 *
 * - PRE-toggle: wszystkie potwory z monsters.json renderują się (>= MONSTER_COUNT).
 * - POST-toggle: tylko `rat` → count = 1.
 *
 * Powrót do default po toggle off → count wraca do initial.
 *
 * Cleanup: try/finally + cleanupCharacterById.
 */

import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';
import { seedQuestState } from '../../fixtures/seedQuestState';

test.describe('City › Monsters', { tag: '@city' }, () => {
    test.describe.configure({ timeout: 60_000 });

    test('"Tylko z taskiem / questem" filter narrows list to only monsters with active tasks', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            // 1. Seed Knight lvl 5. Filtry monster-list nie patrzą na unlock-state —
            //    działają na pełnej liście z monsters.json.
            const created = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: nick,
                class: 'Knight',
                overrides: { level: 5, highest_level: 5, hp_regen: 0, mp_regen: 0 },
            });
            createdId = created.id;

            // 2. Seed active task na `rat` — filterTaskedOnly zostawi
            //    TYLKO ten monster w liście.
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

            // 3. Login + select + nawigacja do /monsters
            await loginViaUI(page, testUsers.primary);
            await page.goto('/character-select');
            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await expect(card).toBeVisible({ timeout: 10_000 });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 10_000 });

            await page.goto('/monsters');
            await expect(page.locator('.combat__hub-monsters')).toBeVisible({ timeout: 10_000 });

            // 4. BASELINE: wszystkie karty (initial > 1 bo monsters.json ma 50+ wpisów).
            const cards = page.locator('.combat__mcard');
            await expect(cards.first()).toBeVisible({ timeout: 10_000 });
            const initialCount = await cards.count();
            expect(initialCount).toBeGreaterThan(1);

            // 5. Toggle "Tylko z taskiem / questem" filter.
            //    Selektor: `combat__filter-toggle` z hasText "Tylko z taskiem".
            const taskedToggle = page.locator('.combat__filter-toggle', {
                hasText: /Tylko z taskiem/,
            });
            await taskedToggle.tap();
            // Visual confirm — class `--active` po tap.
            await expect(taskedToggle).toHaveClass(/combat__filter-toggle--active/);

            // 6. ASERCJA: TYLKO `rat` zostaje (1 karta).
            await expect(cards).toHaveCount(1, { timeout: 5_000 });

            // 7. Sanity: pojedyncza karta to faktycznie Szczur (rat).
            //    `.combat__mcard-name` jest direct child każdej karty.
            await expect(cards.first().locator('.combat__mcard-name')).toContainText('Szczur');

            // 8. Toggle OFF → count wraca do initial (filter się wyłącza).
            await taskedToggle.tap();
            await expect(taskedToggle).not.toHaveClass(/combat__filter-toggle--active/);
            await expect(cards).toHaveCount(initialCount, { timeout: 5_000 });
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
