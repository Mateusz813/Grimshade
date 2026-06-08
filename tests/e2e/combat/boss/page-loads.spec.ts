/**
 * Atomic E2E smoke — `/boss` (boss hub) renders the boss list panel
 * without JS errors.
 *
 * Spec (BACKLOG.md punkt 13.5 — per-combat-type smoke, boss variant):
 * "Każdy typ walki E2E smoke (polowanie/raid/dungeon/boss/arena/trainer/
 * loch/transform)".
 *
 * Co testujemy (smoke only — NIE testujemy walki z bossem):
 *  - Direct nav na `/boss` z aktywną postacią poprawnie renderuje
 *    `.boss` root + boss list panel (phase 'list' jest default — Boss.tsx
 *    linia 370).
 *  - Header badge (`.boss__score`) widoczny — Boss.tsx renderuje
 *    trofeum + total score TYLKO w phase='list' (linia 4135-4137).
 *  - Boss list panel (`.boss__panel`) widoczny + filter bar
 *    (`.boss__hub-filters`).
 *  - Strona NIE redirectuje — CombatGuard sprawdza tylko
 *    `combatStore.phase === 'fighting' || 'victory'`, którego nie
 *    odpalamy. ProtectedRoute przejdzie bo session jest aktywny.
 *
 * **Co NIE testujemy** (defer do osobnych speców):
 *  - Faktyczna walka z bossem (tap "Walcz" → animacja entry → spawn →
 *    damage → result).
 *  - Boss filters (Available Only / sort / min level) — analogiczne
 *    do hunt filters z `city/monsters/filters.spec.ts`.
 *  - Ready-check flow w party (multi-context).
 *  - Boss tile contents (HP/ATK/drop info) — covered by combatengine /
 *    boss data unit tests w `src/data/bosses.ts`.
 *
 * Seed: Knight lvl 1. Każdy boss będzie widoczny jako locked (Boss.tsx
 * gate sprawdza level), ale lista renderuje się tak czy siak. Spinner
 * fallback z linia 682 odpada bo character != null po hydration.
 *
 * Cleanup: try/finally + cleanupCharacterById.
 */

import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';

test.describe('Combat › Boss', { tag: '@combat' }, () => {
    test.describe.configure({ timeout: 60_000 });

    test('smoke: /boss renders boss list panel without errors', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            // 1. Seed Knight lvl 1 (default base stats, regen off).
            const created = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: nick,
                class: 'Knight',
                overrides: { hp_regen: 0, mp_regen: 0 },
            });
            createdId = created.id;

            // 2. Login → wybierz postać → Town
            await loginViaUI(page, testUsers.primary);
            await page.goto('/character-select');
            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await expect(card).toBeVisible({ timeout: 10_000 });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 10_000 });

            // 2b. Wait dla TopHeader żeby characterStore.character zostal
            //     w pełni zhydratowany. Bez tego /boss może mount-ować
            //     wcześniej niż character store dostał blob → Boss.tsx
            //     linia 682 zwraca Spinner fallback + `.boss__header`
            //     nigdy się nie pojawia w time window.
            await expect(page.locator('.top-header')).toBeVisible({ timeout: 10_000 });

            // 3. Direct nav na /boss. CombatGuard nie redirectuje bo
            //    combatStore.phase === 'idle' (default po świeżym
            //    create-character; pre-existing fight phases zostały
            //    wyczyszczone przy switchToCharacter / hydratacja game_save
            //    z pustym blob = defaults).
            await page.goto('/boss');

            // 4. URL pozostaje /boss (sanity — nie ma redirect na "/").
            await expect(page).toHaveURL(/\/boss$/, { timeout: 10_000 });

            // 5. Root `.boss` container widoczny. Spinner fallback z
            //    Boss.tsx linia 682 odpada (po hydratacji characterStore-a)
            //    i pełny pipeline renderuje się.
            await expect(page.locator('.boss')).toBeVisible({ timeout: 10_000 });

            // 6. Boss panel (motion.div z `.boss__panel` linia 4170)
            //    + filter bar (`.boss__hub-filters` linia 4176).
            //    Te dwa selektory potwierdzają że phase='list' branch
            //    odpalił (a nie fighting / result). Boss panel ma generous
            //    timeout bo Boss.tsx subscribuje do wielu store-ów i
            //    pierwszy render moze byc opozniony.
            await expect(page.locator('.boss__panel')).toBeVisible({ timeout: 15_000 });
            await expect(page.locator('.boss__hub-filters')).toBeVisible();

            // 7. Header z trofeum/score (linia 4128-4137) — renderowane
            //    tylko w phase='list' z `.boss__score` span.
            await expect(page.locator('.boss__header')).toBeVisible();
            await expect(page.locator('.boss__score')).toBeVisible();
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
