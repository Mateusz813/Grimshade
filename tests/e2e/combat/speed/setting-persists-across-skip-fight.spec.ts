/**
 * Atomic E2E — combat speed restored after SKIP-resolved fight (BACKLOG 13.7
 * partial — speed change mid-combat).
 *
 * Spec 13.7: "Speed X1/X2/X4 zmiana w trakcie walki" — full integration
 * would require a live real-time fight where the user taps the speed
 * chip mid-fight and we observe the next-tick interval changing. That's
 * fragile for the same reasons documented in `combatSim.ts` JSDoc:
 * timing-based assertions on attack ticks compound RNG + auto-fight
 * chain effects + WebKit/Chromium scheduler differences.
 *
 * THIS test instead exercises a critical CONTRACT inside the combat-sim
 * fixture itself: `runCombatViaSkip` advertises that it "restores the
 * previous value before returning so the next navigation / test doesn't
 * inherit `'SKIP'` mode in the UI" (combatSim.ts line 84). That promise
 * is load-bearing because:
 *   • If broken, every test that follows runCombatViaSkip would silently
 *     observe SKIP mode in the UI even though the .tap()-on-speed-chip
 *     workflow would still cycle through x1/x2/x4 — masking bugs.
 *   • A real combat test that wants to set speed=x2, observe a few
 *     attacks at x2 cadence, would have its speed RESET to x1 by an
 *     earlier SKIP fight if this contract were broken.
 *
 * The contract is:
 *
 *   Before runCombatViaSkip:  settingsStore.combatSpeed = X
 *   During runCombatViaSkip:  settingsStore.combatSpeed = 'SKIP'
 *                             (engine reads it; resolveInstantFight fires)
 *   After runCombatViaSkip:   settingsStore.combatSpeed = X (restored)
 *
 * Test sequence:
 *  1. Seed Knight lvl 1 + login + Town.
 *  2. Set combat speed to 'x4' via direct store call (page.evaluate).
 *     Why x4 not x1? x1 is the default (settingsStore.ts line 103) —
 *     if the restore was a no-op, the value would still be the default
 *     and the test would falsely pass. Using a non-default value
 *     forces the assertion to verify the actual restore wrote x4 back.
 *  3. Snapshot speed → 'x4'.
 *  4. `runCombatViaSkip(page, 'rat')` → fight resolves via SKIP path.
 *  5. Post-fight snapshot speed → MUST equal 'x4' (restored).
 *  6. Sanity: the fight DID resolve to victory — proves SKIP mode was
 *     actually engaged inside the helper (vs. silently no-oping which
 *     could mask the speed-restore problem).
 *
 * What we DON'T test:
 *  • Real-time cadence at x4 vs x1 — that's TIMING coverage which would
 *    require a live combat tick + setInterval observation. The DPS test
 *    in BACKLOG 13.9 (basic attack cadence) is the right home for that.
 *  • UI chip click ↔ store sync — covered by Combat.tsx unit tests +
 *    the existing 12.6 trainer per-class smoke (which taps action bar
 *    buttons and proves chip clicks work).
 *
 * Cleanup: try/finally + cleanupCharacterById.
 */

import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';
import { runCombatViaSkip } from '../../fixtures/combatSim';

test.describe('Combat › Speed', { tag: '@combat' }, () => {
    test.describe.configure({ timeout: 90_000 });

    test('combat speed x4 restored after SKIP-resolved fight (combatSim restore contract)', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            const created = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: nick,
                class: 'Knight',
                overrides: { hp_regen: 0, mp_regen: 0 },
            });
            createdId = created.id;

            await loginViaUI(page, testUsers.primary);
            await page.goto('/character-select');
            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await expect(card).toBeVisible({ timeout: 10_000 });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
            await expect(page.locator('.town__char-name')).toHaveText(nick, { timeout: 10_000 });

            // Set combat speed to x4 (non-default value).
            await page.evaluate(async () => {
                // @ts-expect-error — dev-time Vite URL not resolvable by tsc
                const mod = await import('/src/stores/settingsStore.ts');
                (mod as {
                    useSettingsStore: { getState: () => { setCombatSpeed: (s: string) => void } };
                }).useSettingsStore.getState().setCombatSpeed('x4');
            });

            // Pre-fight snapshot. Must be 'x4' (proves the setter call landed).
            const preSpeed = await page.evaluate(async () => {
                // @ts-expect-error — dev-time Vite URL not resolvable by tsc
                const mod = await import('/src/stores/settingsStore.ts');
                return (mod as {
                    useSettingsStore: { getState: () => { combatSpeed: string } };
                }).useSettingsStore.getState().combatSpeed;
            });
            expect(preSpeed).toBe('x4');

            // Run SKIP-mode fight. The helper stashes the prior speed ('x4'),
            // sets speed to 'SKIP', fires startNewFight + resolveInstantFight,
            // then restores ('x4') in its finally block.
            const result = await runCombatViaSkip(page, 'rat');

            // Sanity: fight did actually resolve — proves SKIP mode
            // engaged during the helper call (otherwise phase stays
            // 'idle' and combat never happened).
            expect(result.phase).toBe('victory');

            // Critical assertion: speed restored to 'x4', NOT left at 'SKIP'.
            const postSpeed = await page.evaluate(async () => {
                // @ts-expect-error — dev-time Vite URL not resolvable by tsc
                const mod = await import('/src/stores/settingsStore.ts');
                return (mod as {
                    useSettingsStore: { getState: () => { combatSpeed: string } };
                }).useSettingsStore.getState().combatSpeed;
            });
            expect(postSpeed).toBe('x4');
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
