/**
 * Atomic E2E — kill counter accuracy across multiple kills.
 *
 * BACKLOG 13.12: "Kill counter zlicza poprawnie".
 *
 * What we test:
 *  - Run THREE consecutive SKIP-resolve fights against rat.
 *  - After each fight, `combatStore.sessionKills.normal` MUST equal the
 *    cumulative number of kills (1, then 2, then 3). This is the same
 *    field rendered by `HuntedTally.tsx` line 30 (`sessionKills[t.id]`).
 *  - At the end, `sessionKills.normal === 3` is the load-bearing
 *    assertion — proves the counter is additive, not accidentally
 *    reset between fights (regression guard against e.g. somebody
 *    pushing `resetSession()` into the per-fight init path).
 *
 * Why this matters as a regression test:
 *  - The session-kills tally drives quest progress (`addProgress` in
 *    combatEngine.ts), task progress (`addKill`), mastery progress
 *    (`addMasteryKills`). If the counter desyncs, every progression
 *    feedback loop in the game gets wrong.
 *  - `sessionKills` persists across waves via `sessionLog` cap path —
 *    a separate code path from per-fight `earnedXp` (which DOES reset).
 *    Conflating the two has happened in the past (commit history
 *    shows "kill counter on victory always shows 1" bug ~5 weeks ago).
 *
 * Why we DON'T verify (and why):
 *  - Per-rarity bucket (strong / epic / legendary) — rarity rolls are
 *    RNG. We'd need to seed `Math.random()` which is brittle. We assert
 *    only the `normal` bucket which is the default rarity.
 *  - Cumulative XP — multipliers can compound differently per kill
 *    (mastery progresses each kill -> tiny multiplier bump). Hard to
 *    pin a specific value; we just verify each fight earns "some XP".
 *
 * Cleanup: try/finally + cleanupCharacterById.
 */

import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';
import { runCombatViaSkip } from '../../fixtures/combatSim';

test.describe('Combat › Hunting', { tag: '@combat' }, () => {
    test.describe.configure({ timeout: 90_000 });

    test('three SKIP fights -> sessionKills.normal increments 0 -> 1 -> 2 -> 3', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            // Seed Knight lvl 1 — easiest one-shot vs rat.
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

            // Kill #1 — fresh sessionKills starts at 0 (set by initial
            // store defaults at combatStore.ts line 188). One SKIP fight
            // -> sessionKills.normal = 1.
            const k1 = await runCombatViaSkip(page, 'rat');
            expect(k1.phase).toBe('victory');
            expect(k1.sessionKills.normal).toBe(1);

            // Kill #2 — count goes to 2.
            const k2 = await runCombatViaSkip(page, 'rat');
            expect(k2.phase).toBe('victory');
            expect(k2.sessionKills.normal).toBe(2);

            // Kill #3 — count goes to 3. Load-bearing assertion: this
            // is the regression-guard payload — proves the counter is
            // cumulative across fights, not reset by `initCombat`
            // (combatStore.ts line 202-223, which does NOT touch
            // sessionKills) or by `startNewFight` (combatEngine.ts line
            // 2575, also leaves sessionKills alone).
            const k3 = await runCombatViaSkip(page, 'rat');
            expect(k3.phase).toBe('victory');
            expect(k3.sessionKills.normal).toBe(3);

            // Per-kill XP positive (each one earned XP). Belt-and-
            // suspenders — proves no kill was a no-op due to a hidden
            // bail in the engine.
            expect(k1.earnedXp).toBeGreaterThan(0);
            expect(k2.earnedXp).toBeGreaterThan(0);
            expect(k3.earnedXp).toBeGreaterThan(0);
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
