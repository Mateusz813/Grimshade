/**
 * Atomic E2E smoke — `/trainer` (sandbox training dummy) renders the
 * trainer arena without JS errors.
 *
 * Spec (BACKLOG.md punkt 13.5 — per-combat-type smoke, trainer variant):
 * "Każdy typ walki E2E smoke (polowanie/raid/dungeon/boss/arena/trainer/
 * loch/transform)".
 *
 * Co testujemy (smoke only — NIE testujemy spell castów / DPS-u):
 *  - Direct nav na `/trainer` z aktywną postacią poprawnie renderuje
 *    `.trainer` root + `.trainer__stats` summary box (Trainer.tsx
 *    linia 3445).
 *  - Strona NIE redirectuje — CombatGuard sprawdza
 *    `combatStore.phase === 'fighting' || 'victory'`, którego nie
 *    odpalamy. ProtectedRoute przejdzie bo session jest aktywny.
 *
 * **Co NIE testujemy** (defer do osobnych speców):
 *  - Faktyczny cast skilla na dummy -> damage delta.
 *  - Sandbox toggles (trainerAttacks / noCooldowns / dummy HP slider).
 *  - Aggro target picker -> killAlly picker -> kill/revive flow.
 *  - Best window damage tracker math.
 *
 * **App-bug note (2026-05-25)**: Trainer.tsx miał Rules of Hooks violation
 * podobnie jak Boss/Transform/Dungeon — early return `if (!character)`
 * na linii 2948 byl PRZED `useEffect` hook (linia 2958). Pierwszy render
 * z character==null pomijał subsequent hook; drugi render z character
 * hydrated registers it -> React Rules of Hooks detector crashował
 * <Trainer> subtree -> `.trainer` root nigdy nie mountuje się.
 * Fix: przesunięto early return POD wszystkie hooks (analogicznie do
 * Boss.tsx). Komentarz "// Trainer render guard (after-hooks)" dla
 * przyszłych eyes.
 *
 * Seed: Knight lvl 1 (default base stats, regen off).
 *
 * Cleanup: try/finally + cleanupCharacterById.
 */

import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';

test.describe('Combat › Trainer', { tag: '@combat' }, () => {
    test.describe.configure({ timeout: 60_000 });

    test('smoke: /trainer renders trainer arena without errors', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            // 1. Seed Knight lvl 1.
            const created = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: nick,
                class: 'Knight',
                overrides: { hp_regen: 0, mp_regen: 0 },
            });
            createdId = created.id;

            // 2. Login -> wybierz postać -> Town
            await loginViaUI(page, testUsers.primary);
            await page.goto('/character-select');
            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await expect(card).toBeVisible({ timeout: 10_000 });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 10_000 });

            // 2b. Wait dla TopHeader żeby characterStore.character zostal
            //     zhydratowany przed direct-nav.
            await expect(page.locator('.top-header')).toBeVisible({ timeout: 10_000 });

            // 3. Direct nav na /trainer. CombatGuard pozwala bo
            //    combatStore.phase = 'idle' po świeżej hydratacji.
            await page.goto('/trainer');

            // 4. URL pozostaje /trainer (sanity).
            await expect(page).toHaveURL(/\/trainer$/, { timeout: 10_000 });

            // 5. Root `.trainer` container widoczny. Loading state
            //    (`trainer--loading`) odpada po hydratacji characterStore-a
            //    i pełna render-pipeline odpala.
            await expect(page.locator('.trainer')).toBeVisible({ timeout: 10_000 });

            // 6. `.trainer__stats` summary box (Trainer.tsx linia 3445)
            //    — pokazuje "Całkowite obrażenia / Ostatnie / Best" stats.
            //    Renderowane zawsze gdy character != null, więc obecność
            //    potwierdza że pełna JSX leci.
            await expect(page.locator('.trainer__stats')).toBeVisible({ timeout: 15_000 });
            await expect(page.locator('.trainer__stats')).toContainText(/Całkowite obrażenia/);
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
