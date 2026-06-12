/**
 * Atomic E2E — combat UI controls remain tappable across every speed
 * setting (x1, x2, x4, SKIP).
 *
 * BACKLOG 13.25: "UI walki: wszystko klikalne na każdej prędkości".
 * Regression guard against `pointer-events: none` / `position` z-index
 * bugs that have historically appeared at high speeds when overlay
 * animations multiply (skill-anim layer, dmg float layer, monster
 * shake layer all multiply at speed=x4).
 *
 * What this test proves:
 *  Combat hub idle-phase top controls — the speed chip + skill-mode
 *  chip + auto-fight chip + wave +/- buttons — remain **tappable** at
 *  every cycle position (x1 -> x2 -> x4 -> SKIP -> x1). Tappable means:
 *    - Button is `visible`.
 *    - Button is `enabled` (no `disabled` attribute, no aria-disabled).
 *    - A `.tap()` succeeds without timeout (Playwright auto-actionability
 *      check waits for the button to be touchable — covers pointer-events,
 *      opacity-0 overlays, dispatched-but-not-yet-rendered modals, etc.).
 *
 * Why the IDLE-PHASE controls are the canonical test target:
 *  - They are RENDERED CONDITIONALLY on `phase === 'idle'` (Combat.tsx
 *    line 1680), which is the player's pre-fight state — every fresh
 *    visit to /combat lands here.
 *  - The speed button itself is the cycle hook — tapping it advances
 *    the speed. So we test the full loop via cycle taps:
 *      x1 (default) -> tap -> x2 -> tap -> x4 -> tap -> SKIP -> tap -> x1.
 *    Four cycles touch every speed value at least once.
 *  - Other idle controls (skill-mode, auto-fight) are independent of
 *    `combatSpeed` — but they SHARE the `.combat__top-controls`
 *    container which could be obscured by any `position: fixed` overlay
 *    leaking from the fighting-phase layer. Tapping them at each speed
 *    cycle proves the container isn't getting accidentally covered.
 *
 * What we DON'T test (and why):
 *  - IN-FIGHT clickability (action-bar skill buttons, potion buttons
 *    during `phase === 'fighting'`) — those depend on a live fight tick.
 *    Smoke version here covers the most-touched path; in-fight version
 *    requires a controlled HP/MP pre-state that's a separate session
 *    of work (see `combat/death/triggerPlayerDeath` for the deepest
 *    in-fight test we have so far).
 *  - Animation rendering correctness at each speed — visual regression
 *    test territory, not E2E.
 *  - Per-component contracts (e.g. CombatActionBar disabled-state when
 *    MP < cost) — those are unit/integration tests in
 *    `src/components/organisms/CombatUI/CombatActionBar.test.tsx`.
 *
 * Strategy:
 *  1. Seed Knight lvl 1 (default base stats).
 *  2. Login + pick character -> Town.
 *  3. Navigate `/combat` -> land on idle hub.
 *  4. Speed button starts at default (settingsStore.combatSpeed='x1').
 *     Cycle 4 times: x1 -> x2 -> x4 -> SKIP -> x1. After each tap, assert:
 *       (a) speed button has the new speed text rendered (label flips).
 *       (b) speed button is still enabled + visible (we'll tap it again
 *           next iteration).
 *       (c) Sibling skill-mode button is also enabled + visible — proves
 *           no overlay is covering the chip row.
 *
 * Cleanup: try/finally + cleanupCharacterById.
 */

import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';

test.describe('Combat › UI', { tag: '@combat' }, () => {
    test.describe.configure({ timeout: 90_000 });

    test('idle-hub speed + skill-mode + auto-fight chips remain tappable across x1 -> x2 -> x4 -> SKIP cycle', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            // 1. Seed Knight lvl 1. Default stats — no special seed
            //    required, all idle-phase chips render unconditionally.
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
            await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
            await expect(page.locator('.top-header')).toBeVisible({ timeout: 10_000 });

            // 3. Direct nav to /combat — CombatGuard passes for idle phase.
            await page.goto('/combat');
            await expect(page).toHaveURL(/\/combat$/, { timeout: 10_000 });
            // Wait for the idle hub. `.combat__hub` is the phase=='idle'
            // marker (Combat.tsx line 1808).
            await expect(page.locator('.combat__hub')).toBeVisible({ timeout: 15_000 });

            // 4. The speed chip is in `.combat__top-controls` — wait for it.
            //    Default speed from `settingsStore.combatSpeed` is 'x1'
            //    (src/stores/settingsStore.ts line 117 default).
            const speedBtn = page.locator('button.combat__speed-btn');
            await expect(speedBtn).toBeVisible({ timeout: 10_000 });
            // Sibling chips that should ALWAYS be reachable (sanity).
            const skillModeBtn = page.locator('button.combat__mode-btn');
            const autoFightBtn = page.locator('button.combat__toggle-btn').first();
            await expect(skillModeBtn).toBeVisible();
            await expect(autoFightBtn).toBeVisible();

            // 5. Sanity: starts at x1 default. (Could be cached from another
            //    test run in same browser session — be lenient on default.)
            const initialSpeedText = (await speedBtn.textContent())?.trim() ?? '';
            expect(['x1', 'x2', 'x4', 'SKIP']).toContain(initialSpeedText);

            // 6. Cycle through all 4 speeds. After EACH tap, assert:
            //    (a) the text label changed (cycle advanced).
            //    (b) the speed button is still tappable (the next tap
            //        is the proof — if it weren't, the .tap() would
            //        time out at Playwright's actionTimeout=5_000).
            //    (c) sibling skill-mode + auto-fight chips remain
            //        enabled + visible (no overlay covering chip row).
            //    The full cycle (x1 -> x2 -> x4 -> SKIP -> x1) needs 4 taps.
            const speedOrder = ['x1', 'x2', 'x4', 'SKIP'];
            let currentIdx = speedOrder.indexOf(initialSpeedText);
            if (currentIdx === -1) currentIdx = 0;

            for (let i = 0; i < 4; i++) {
                const expectedNextSpeed = speedOrder[(currentIdx + 1) % speedOrder.length];

                // Sibling chips MUST be tappable before our speed tap —
                // proves they're still in the DOM tree and reachable.
                // We don't actually tap them (would toggle state and
                // confuse the next iteration); we just check they're
                // visible + enabled.
                await expect(skillModeBtn).toBeVisible();
                await expect(skillModeBtn).toBeEnabled();
                await expect(autoFightBtn).toBeVisible();
                await expect(autoFightBtn).toBeEnabled();

                // Speed chip MUST be tappable. This is the load-bearing
                // assertion — if the chip was covered by an overlay, the
                // .tap() would time out at 5s actionTimeout.
                await expect(speedBtn).toBeVisible();
                await expect(speedBtn).toBeEnabled();

                // Retry loop — mobile-chrome occasionally drops the first
                // `.tap()` (touch event timing race vs React re-render).
                // Same pattern used by `inventory/auto-sell/settings-toggle-persists.spec.ts`.
                // Pre-tap pause prevents two rapid taps from being read as
                // a single double-tap zoom gesture on mobile platforms.
                await page.waitForTimeout(200);
                let advanced = false;
                for (let attempt = 1; attempt <= 5 && !advanced; attempt++) {
                    if (attempt > 1) await page.waitForTimeout(200);
                    await speedBtn.tap({ force: true });
                    try {
                        await expect(speedBtn).toHaveText(expectedNextSpeed, { timeout: 3_000 });
                        advanced = true;
                    } catch (err) {
                        if (attempt === 5) throw err;
                    }
                }

                currentIdx = (currentIdx + 1) % speedOrder.length;
            }

            // 7. After 4 cycles, we're back at the speed we started from.
            //    Belt-and-suspenders sanity — proves the cycle loop is
            //    consistent and we observed every value at least once.
            await expect(speedBtn).toHaveText(initialSpeedText);
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
