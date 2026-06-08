/**
 * Atomic E2E — combat log captures attack + kill entries (BACKLOG 13.13
 * "Drop + logi wyświetlają się poprawnie", log half).
 *
 * What we test:
 *  • Run a SKIP fight against rat (Knight one-shots; entries are
 *    deterministic regardless of damage RNG because SKIP collapses to
 *    "fight starts → fight ends" with the same fixed event sequence).
 *  • Assert the sessionLog contains the expected event tags:
 *      1. "system" entry: `Walka z Szczur (Poziom 1) rozpoczęta!`
 *         (combatEngine.ts line 2637).
 *      2. Either a "system" Awans entry (level-up if XP threshold hit)
 *         OR no awans line — both acceptable, we don't pin level-ups
 *         because Knight lvl 1 needs 35 XP for lvl 2 and one rat is ~2.
 *  • Assert sessionLog grew (length > 0) after the fight — proves
 *    `addLog` actually pushed into the per-session array, not the
 *    capped legacy `log` array.
 *  • Assert at least one log entry has type 'system' (the "Walka z … rozpoczęta"
 *    line is always system-typed per line 2635/2637).
 *
 * Why this matters:
 *  • `sessionLog` is the source of truth for the `CombatLogsModal`
 *    (CombatSubControls.tsx line 155 → `<CombatLogsModal>` reads
 *    `useCombatStore.sessionLog` directly). If combat doesn't write
 *    log entries, the modal renders an empty list and the player can't
 *    audit what happened.
 *  • The legacy 50-entry-capped `log` field powers the inline ticker
 *    in the combat hud — same write site (`addLog` writes both). If
 *    that desyncs, players lose attack/kill visibility mid-fight.
 *  • Past bug history: a refactor swapped `addLog` for a no-op stub
 *    in an experimental "silent SKIP" branch — every fight succeeded
 *    but no log entries were created. Players reported "where did my
 *    kill go" — undetected until they manually opened the modal.
 *
 * Why we DON'T verify (and why):
 *  • Specific kill-log text — `handleMonsterDeath` (line 1046) writes
 *    `${monster.name_pl} ginie!`, but SKIP mode uses a DIFFERENT path
 *    (`resolveInstantFight`) which only writes the "rozpoczęta" opener
 *    + possible Awans logs. We assert what's actually guaranteed by
 *    SKIP, not what live combat would write.
 *  • Drop-line entries — rat has `dropTable: []` and dynamic drops are
 *    RNG-low. Not deterministic enough for an assertion.
 *
 * Cleanup: try/finally + cleanupCharacterById.
 */

import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';
import { runCombatViaSkip, getCombatSnapshot } from '../../fixtures/combatSim';

test.describe('Combat › Hunting', { tag: '@combat' }, () => {
    test.describe.configure({ timeout: 90_000 });

    test('SKIP fight populates sessionLog with system entries', async ({ page }) => {
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

            // Pre-snapshot: sessionLog should be empty (fresh character,
            // no prior combat). Defends against test-pollution where a
            // previous test left state on this account; if it's non-zero,
            // the cleanup-flow already broke (we test that elsewhere).
            const pre = await getCombatSnapshot(page);
            expect(pre).not.toBeNull();
            const preLogCount = pre!.sessionLog.length;

            // Run the fight.
            const result = await runCombatViaSkip(page, 'rat');
            expect(result.phase).toBe('victory');

            // 1. Log grew. Proves engine actually pushed log entries
            //    during the SKIP resolution.
            expect(result.sessionLog.length).toBeGreaterThan(preLogCount);

            // 2. The opener log entry is present. This is the
            //    deterministic line — combatEngine.ts line 2637 writes
            //    `Walka z ${monster.name_pl} (Poziom ${monster.level}) rozpoczęta!`
            //    unconditionally for non-rare normal monsters.
            const openLogEntry = result.sessionLog.find((l) =>
                /Walka z Szczur \(Poziom 1\) rozpoczęta/.test(l.text),
            );
            expect(openLogEntry).toBeDefined();
            // Open-fight entry is system-tagged (third arg of addLog).
            expect(openLogEntry!.type).toBe('system');

            // 3. At least one entry is type 'system' (redundant with the
            //    `openLogEntry.type` assert above but anchors that the
            //    type metadata didn't get lost in the
            //    sessionLog.map serialization in combatSim).
            const systemEntries = result.sessionLog.filter((l) => l.type === 'system');
            expect(systemEntries.length).toBeGreaterThanOrEqual(1);
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
