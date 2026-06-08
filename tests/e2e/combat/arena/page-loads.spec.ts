/**
 * Atomic E2E smoke — `/arena` (PvP arena lobby) renders the league strip
 * + defense card without JS errors.
 *
 * Spec (BACKLOG.md punkt 13.5 — per-combat-type smoke, arena variant):
 * "Każdy typ walki E2E smoke (polowanie/raid/dungeon/boss/arena/trainer/
 * loch/transform)".
 *
 * Co testujemy (smoke only — NIE testujemy walki PvP):
 *  - Direct nav na `/arena` z aktywną postacią poprawnie renderuje
 *    `.arena` root + `.arena__league-strip` (top league bar). Arena.tsx
 *    linia 228 = `<div className="arena">` po przejściu obu Spinner
 *    early-returns (linie 147-152).
 *  - `.arena__defense` defense snapshot card widoczny (linia 269) —
 *    Arena.tsx auto-submituje defense snapshot na każdym mount-cie więc
 *    karta zawsze się pojawia.
 *  - URL pozostaje `/arena` — OnlineOnlyGuard PASSES bo connectivityStore
 *    default = 'online' (świeży boot, brak snapshot-u w sessionStorage,
 *    `_initialMode = 'online'` w connectivityStore.ts linia 159).
 *
 * **Co NIE testujemy** (defer do osobnych speców):
 *  - Faktyczna walka PvP (tap "Walcz" → match → result).
 *  - Sezon countdown / rewards claim flow.
 *  - Leaderboard scroll-to-me behavior (Arena.tsx useEffect linia 101).
 *
 * **App-bug note**: Arena.tsx NIE ma Rules of Hooks violation jak Boss /
 * Transform / Dungeon / Trainer — wszystkie `useEffect` siedzą PRZED
 * early-return (`if (!character)` linia 147). Verified manually 2026-05-25.
 *
 * Seed: Knight lvl 1.
 *
 * Cleanup: try/finally + cleanupCharacterById.
 */

import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';

test.describe('Combat › Arena', { tag: '@combat' }, () => {
    test.describe.configure({ timeout: 60_000 });

    test('smoke: /arena renders league strip + defense card without errors', async ({ page }) => {
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
            //     zhydratowany przed direct-nav.
            await expect(page.locator('.top-header')).toBeVisible({ timeout: 10_000 });

            // 3. Direct nav na /arena. OnlineOnlyGuard PASSES bo
            //    connectivityStore default = 'online' (świeży boot, brak
            //    sessionStorage snapshot-u).
            await page.goto('/arena');

            // 4. URL pozostaje /arena (sanity — brak redirect na "/" przez
            //    OnlineOnlyGuard).
            await expect(page).toHaveURL(/\/arena$/, { timeout: 10_000 });

            // 5. Root `.arena` container widoczny. Spinner fallback z
            //    Arena.tsx linia 147 odpada po hydratacji characterStore-a +
            //    refreshIfNeeded() zainicjalizował arenaStore.currentArena
            //    (więc second Spinner z linia 150 też znika).
            await expect(page.locator('.arena')).toBeVisible({ timeout: 10_000 });

            // 6. League strip — top bar z `.arena__league-strip` zawsze
            //    renderowany jako pierwszy element w arena root. Pokazuje
            //    league icon / nazwę / AP / season countdown / rewards btn.
            await expect(page.locator('.arena__league-strip')).toBeVisible({ timeout: 15_000 });

            // 7. Defense snapshot card (`.arena__defense` linia 269). Auto-
            //    submituje defense snapshot na każdym visit — karta zawsze
            //    się pojawia. Wewnątrz: avatar + stats + "Walcz" CTA.
            await expect(page.locator('.arena__defense')).toBeVisible();
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
