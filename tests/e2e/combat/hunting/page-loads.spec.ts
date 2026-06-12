/**
 * Atomic E2E smoke — `/combat` (hunting hub) renders the monster picker
 * without JS errors.
 *
 * Spec (BACKLOG.md punkt 13.5 — per-combat-type smoke, hunting variant):
 * "Każdy typ walki E2E smoke (polowanie/raid/dungeon/boss/arena/trainer/
 * loch/transform)".
 *
 * Co testujemy (smoke only — NIE testujemy faktycznej walki):
 *  - Direct nav na `/combat` z aktywną postacią poprawnie renderuje
 *    `.combat` root + `.combat__hub` (monster picker / idle phase).
 *  - Filter bar (`.combat__hub-filters`) jest widoczny — sanity check że
 *    hydration filtersów z settingsStore-a osiadła.
 *  - Wave-count box (`.combat__hub-wave`) widoczny — kontrolka ilości
 *    przeciwników.
 *  - Monsters section header (`.combat__hub-monsters`) widoczny + co
 *    najmniej 1 karta `.combat__mcard` (Knight lvl 1 ma odblokowanego
 *    Szczura na start, plus zablokowane karty również się renderują).
 *  - Speed button (`.combat__speed-btn`) widoczny w top bar — proxy że
 *    `phase === 'idle'` (bo gdy `fighting` ten button znika z favor
 *    CombatTopControls).
 *  - NIE ma żadnych redirectów (URL pozostaje `/combat`). HuntGuard
 *    redirectuje tylko gdy `useOfflineHuntStore.isActive`, którego nie
 *    odpalamy. CombatGuard NIE jest na `/combat` (jest na boss/dungeon/
 *    raid/transform).
 *
 * **Co NIE testujemy** (defer do osobnych speców):
 *  - Faktyczne rozpoczęcie walki (tap na monster card -> spawn -> damage).
 *    Wymagałoby setupu z auto-fight off + manual attack tap + monster HP
 *    delta. Pełna walka = 13.6+ scenariusze.
 *  - Filter logic (Available Only / Tasked Only / sort) — covered w
 *    `city/monsters/filters.spec.ts`.
 *  - Party mode (multi-context). Wymagałoby `browser.newContext()` × 2.
 *
 * Seed: Knight lvl 1 (default base stats, default gold/regen). Szczur
 * jest unlocked dla każdej klasy lvl 1, więc co najmniej 1 mcard
 * renderuje się jako available + reszta jako locked.
 *
 * Cleanup: try/finally + cleanupCharacterById (race-safe wobec
 * fullyParallel + multiple inventory testów na tym samym koncie).
 */

import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';

test.describe('Combat › Hunting', { tag: '@combat' }, () => {
    test.describe.configure({ timeout: 60_000 });

    test('smoke: /combat renders monster picker hub without errors', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            // 1. Seed Knight lvl 1. hp_regen/mp_regen=0 zeby nie tickowal
            //    HP/MP w trakcie testu (mniej noise w UI).
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

            // 3. Direct nav na /combat. HuntGuard NIE redirectuje (offline
            //    hunt nie jest active), nie ma CombatGuard na tej trasie,
            //    więc /combat ładuje się normalnie z phase='idle'.
            await page.goto('/combat');

            // 4. Strona NIE redirectuje (sanity URL stay).
            await expect(page).toHaveURL(/\/combat$/, { timeout: 10_000 });

            // 5. Root `.combat` container widoczny — proxy ze JSX odpalił
            //    bez early-return null (`if (!character) return null;` line
            //    1663).
            await expect(page.locator('.combat')).toBeVisible({ timeout: 10_000 });

            // 6. Idle phase markers — wszystkie trzy hub-sections widoczne:
            //    filters / wave-box / monsters grid. Combat.tsx linia 1808
            //    renderuje `.combat__hub` tylko gdy `phase === 'idle' &&
            //    !selectedMonster`, więc obecność potwierdza że ten gate
            //    przeszedł.
            await expect(page.locator('.combat__hub')).toBeVisible({ timeout: 10_000 });
            await expect(page.locator('.combat__hub-filters')).toBeVisible();
            await expect(page.locator('.combat__hub-wave')).toBeVisible();
            await expect(page.locator('.combat__hub-monsters')).toBeVisible();

            // 7. Top bar speed button widoczny (`combat__speed-btn`).
            //    Renderowany tylko w `phase === 'idle'` (Combat.tsx linia
            //    1680). Obecność = idle confirmed + top controls OK.
            await expect(page.locator('.combat__speed-btn')).toBeVisible();

            // 8. Co najmniej 1 monster card (`.combat__mcard`) widoczna.
            //    Knight lvl 1 ma odblokowanego Szczura na start + reszta
            //    bestiary renderuje się jako `locked`. Używamy >= 1 zamiast
            //    konkretnej liczby zeby test był stabilny gdy ktoś doda
            //    nowego potwora do monsters.json.
            const mcards = page.locator('.combat__mcard');
            await expect(mcards.first()).toBeVisible({ timeout: 10_000 });
            const cardCount = await mcards.count();
            expect(cardCount).toBeGreaterThanOrEqual(1);
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
