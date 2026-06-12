/**
 * Atomic E2E — `/offline-hunt` renderuje setup UI (smoke).
 *
 * Spec (BACKLOG 5.12 smoke wariant): "Offline trening — wykonaj, daje
 * XP + drop + monsters count". Pełny "wykonaj hunt -> claim rewards"
 * flow wymaga serii synthetic time advancements + assert na rewards
 * modal — odłożone do osobnej sesji (`city/offline-hunt/grants-rewards`).
 *
 * Ten test pokrywa **smoke layer**:
 *  - Po nawigacji na /offline-hunt widok ładuje się bez błędu.
 *  - Renderuje 2 setup cards (krok 1 = skill, krok 2 = monster).
 *  - Lista trainable skili pokazuje min. 1 chip dla Knight-a.
 *  - Lista unlocked monsters pokazuje min. 1 wiersz (Knight lvl 1 ->
 *    Szczur unlocked by default).
 *  - Przycisk ":bullseye: Rozpocznij polowanie" jest widoczny ale disabled
 *    (brak wybranego skill + monster -> `disabled` z OfflineHunt.tsx
 *    linia 565).
 *  - Sort row pokazuje 2 chipy (Lvl v + Mastery v) i `oh__sort-chip--active`
 *    jest na "Lvl v" (default `sortMode = 'level'`).
 *
 * Nie testujemy:
 *  - Tap skill chip -> state changes (covered by other tests TODO).
 *  - Tap "Rozpocznij" -> hunt start flow.
 *  - Active hunt + claim flow.
 *
 * `/offline-hunt` NIE jest gated przez OnlineOnlyGuard (AppRouter.tsx
 * linia 276-282) — działa zarówno online jak offline. Test odpala w
 * trybie online dla prostoty (brak konieczności injectowania snapshot-u).
 *
 * Cleanup: try/finally + cleanupCharacterById.
 */

import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';

test.describe('City › Offline Hunt', { tag: '@city' }, () => {
    test.describe.configure({ timeout: 60_000 });

    test('/offline-hunt renders setup UI with skill + monster cards + sort row + start button', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            // 1. Seed Knight — świeża postać lvl 1 (zero regen + brak gold).
            //    Knight lvl 1 ma odblokowanego Szczura by default (z
            //    `progression.getMonsterUnlockStatus`), więc lista
            //    unlockedMonsters nie jest pusta.
            const created = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: nick,
                class: 'Knight',
                overrides: { hp_regen: 0, mp_regen: 0 },
            });
            createdId = created.id;

            // 2. Login + select character + go to /offline-hunt
            await loginViaUI(page, testUsers.primary);
            await page.goto('/character-select');
            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await expect(card).toBeVisible({ timeout: 10_000 });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });

            await page.goto('/offline-hunt');

            // 3. Setup container widoczny (brak active hunt -> OfflineHunt.tsx
            //    linia 480 renderuje `<div className="oh__setup">`).
            await expect(page.locator('.oh__setup')).toBeVisible({ timeout: 10_000 });

            // 4. Dwa setup cards: Step 1 (skill) + Step 2 (monster).
            const cards = page.locator('.oh__setup .oh__card');
            await expect(cards).toHaveCount(2);

            // 5. Card 1 — title zawiera "Wybierz trenowany skill" +
            //    krok numer "1" + min. 1 skill chip dla Knight-a.
            await expect(cards.nth(0)).toContainText(/Wybierz trenowany skill/i);
            const skillChips = cards.nth(0).locator('.oh__skill-chip');
            expect(await skillChips.count()).toBeGreaterThan(0);

            // 6. Card 2 — title zawiera "Wybierz potwora" + sort row + min. 1
            //    monster row.
            await expect(cards.nth(1)).toContainText(/Wybierz potwora/i);
            const sortChips = cards.nth(1).locator('.oh__sort-chip');
            await expect(sortChips).toHaveCount(2);
            // Default sortMode === 'level' -> pierwszy chip ma --active.
            await expect(sortChips.nth(0)).toHaveClass(/oh__sort-chip--active/);
            await expect(sortChips.nth(1)).not.toHaveClass(/oh__sort-chip--active/);

            const monsterRows = cards.nth(1).locator('.oh__monster-row');
            expect(await monsterRows.count()).toBeGreaterThan(0);

            // 7. Start CTA — visible ale disabled (brak picked skill +
            //    monster -> OfflineHunt.tsx linia 565: `disabled={!pickedSkillId || !pickedMonsterId}`).
            const startBtn = page.locator('.oh__btn--start');
            await expect(startBtn).toBeVisible();
            await expect(startBtn).toBeDisabled();
            await expect(startBtn).toContainText(/Rozpocznij polowanie/i);
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
