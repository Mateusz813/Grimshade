/**
 * Atomic E2E — combat log shows drop entries when a kill rolls loot
 * (BACKLOG 13.13 drop half — full coverage).
 *
 * Spec (BACKLOG.md punkt 13.13): "Drop + logi wyświetlają się poprawnie".
 *
 * Status before this test:
 *  • LOG half — covered by `combat-log-captures-kill-entries.spec.ts`
 *    (SKIP-fight opener "Walka z Szczur (Poziom 1) rozpoczęta" logged).
 *  • DROP half — `kill-awards-gold-and-runs-reward-flow.spec.ts` proves
 *    the kill-line "Szczur ginie! +X XP, +Y Gold" lands, but the drop
 *    suffix ("· Drop: <name>") is RNG-gated and the test intentionally
 *    didn't assert on it (rat's drop chance is BASE_DROP_CHANCES.normal
 *    = 0.08 per roll × 2 rolls = ~15% one-of-two drop probability).
 *
 * THIS test forces a drop by stubbing `Math.random` to consistently
 * return a value below ALL drop thresholds (~0.01), guaranteeing both
 * roll iterations succeed AND every downstream RNG call (rarity
 * selection, item category, item slot, bonus rolls) picks the "easy"
 * branch. With drops guaranteed, the kill-log entry includes the
 * "· Drop: <name>" suffix per combatEngine.ts line 1060.
 *
 * ## Math.random stub strategy
 *
 * Constant stub `() => 0.01` would BREAK app-side ID generators that
 * rely on `Math.random().toString(36)` for uniqueness (chatApi channel
 * names, necroSummonStore summon ids, arenaStore match ids). When every
 * call returns the same value, those IDs collide → Realtime channel
 * subscribe throws "cannot add postgres_changes callbacks after
 * subscribe()" → React crash → test fails with app in "spinner" state.
 *
 * Mitigation (same pattern as `inventory/disassemble/single-disassemble.spec.ts`
 * lines 134-137): incrementing counter `() => 0.01 + (counter++ % 9e6) * 1e-8`
 * — distinct value per call but all stay well under 0.08 (drop chance
 * threshold) and 0.55 (rarity-common threshold).
 *
 * Critical timing: install the stub AFTER `page.goto('/')` so
 * characterScope.ts has already generated its TAB_SESSION_ID with a
 * truly-random value at module-load time (line 49 reads Math.random
 * once at the top of the module). Otherwise tab-lock collisions would
 * eat our blob hydration.
 *
 * ## Kill-line format (combatEngine.ts line 1060)
 *
 * ```ts
 * s.addLog(
 *     `${s.monster.name_pl} ginie! +${s.monster.xp} XP, +${gold} Gold` +
 *     `${drops.length ? ` · Drop: ${dropNames}` : ''}`,
 *     'loot',
 * );
 * ```
 *
 * For our Knight vs Szczur kill with drops forced ON:
 *   `Szczur ginie! +3 XP, +1 Gold · Drop: <icon> <displayName>[, ...]`
 *
 * The exact item dropped is deterministic given the seeded counter:
 *   • iteration 0: random < 0.08 → drop rolled
 *   • rollRarity: roll < 0.55 → common rarity
 *   • generateRandomItem picks item category by weighted roll, then
 *     specific item — all subsequent reads return ~0.01 → first
 *     branch wins each time.
 * We don't pin the exact item name (regression-fragile if templates
 * change order in items.json) — we assert the structural presence of
 * "· Drop:" in the log line + sessionDrops non-empty.
 *
 * ## What we assert
 *
 * 1. sessionDrops > 0 — `setLastDrops` was called with non-empty array
 *    by `dropLootToInventory` (combatStore.ts line 339-343 also appends
 *    to sessionDrops cumulatively).
 * 2. log entry with type='loot' contains "ginie!" + "· Drop:" — the
 *    kill-line with drop suffix is the SAME log entry, not two
 *    separate entries.
 * 3. inventoryStore.bag has at least 1 item — the addItem path
 *    persisted the drop in bag (autoSellCommon=false default, so
 *    common drops go to bag).
 * 4. Negative regression: log entry type is 'loot' not 'system' — the
 *    addLog third arg properly tagged the entry.
 *
 * ## Cleanup
 *
 * try/finally + cleanupCharacterById. Math.random override evaporates
 * with the page session (no persistence concerns).
 */

import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';
import { killMonsterViaEngine } from '../../fixtures/combatSim';

test.describe('Combat › Hunting', { tag: '@combat' }, () => {
    test.describe.configure({ timeout: 90_000 });

    test('forced drop produces "· Drop: <name>" suffix in loot-type log entry', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            // 1. Seed Knight lvl 1 — fresh state, no inventory, no buffs.
            //    hp_regen/mp_regen=0 to keep combat snapshot deterministic
            //    (the engine reads HP at attack tick time, no need for
            //    drift between snapshots in this single-kill test).
            const created = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: nick,
                class: 'Knight',
                overrides: { hp_regen: 0, mp_regen: 0 },
            });
            createdId = created.id;

            // 2. Login + character pick + Town hydration. The Math.random
            //    stub MUST come AFTER navigation — characterScope.ts line
            //    49 generates TAB_SESSION_ID at module load using a real
            //    random; stubbing before navigation would produce a stable
            //    TAB_SESSION_ID that collides with parallel runs and
            //    refuses to save state (logged warning: "another tab owns
            //    this character").
            await loginViaUI(page, testUsers.primary);
            await page.goto('/character-select');
            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await expect(card).toBeVisible({ timeout: 10_000 });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
            await expect(page.locator('.town__char-name')).toHaveText(nick, { timeout: 10_000 });

            // 3. Stub Math.random — incrementing counter starting at 0.01,
            //    all values stay < 0.08 (BASE_DROP_CHANCES.normal) and
            //    < 0.55 (rarity-common threshold). Distinct per-call values
            //    (1e-8 step, 7-decimal precision) so any downstream
            //    `Math.random().toString(36)` ID generator still produces
            //    unique strings — avoids the chatApi / necroSummon ID
            //    collision pattern documented in
            //    `inventory/disassemble/single-disassemble.spec.ts` line
            //    112-137.
            //
            //    Counter modulo 9e6 caps it at 9M distinct values before
            //    wrap-around — far beyond what any single test would need.
            await page.evaluate(() => {
                let counter = 0;
                Math.random = () => 0.01 + (counter++ % 9_000_000) * 1e-8;
            });

            // 4. Drive the live-combat kill path. killMonsterViaEngine
            //    runs handleMonsterDeath directly — that's the function
            //    that calls dropLootToInventory → addLog with "ginie!"
            //    + drop suffix (combatEngine.ts line 1059-1062).
            //
            //    With the Math.random stub installed, BOTH drop-roll
            //    iterations succeed (each gets <0.08), so we expect
            //    sessionDrops.length === 2 — the engine just appended
            //    both rolled items.
            const result = await killMonsterViaEngine(page, 'rat', 'normal');

            // 5. sessionDrops populated. Proves dropLootToInventory ran
            //    and emitted IDropDisplay rows via setLastDrops →
            //    sessionDrops cumulative append (combatStore.ts line
            //    339-343).
            expect(result.sessionDrops.length).toBeGreaterThan(0);

            // 6. The kill-log line with drop suffix is in sessionLog.
            //    Format from combatEngine.ts line 1060:
            //      "Szczur ginie! +<XP> XP, +<Gold> Gold · Drop: <items>"
            //    The `· Drop:` substring is the load-bearing assertion —
            //    it ONLY appears when drops.length > 0 (line 1060
            //    ternary). Without the stub, this assertion would only
            //    pass ~15% of the time on rat (probabilistic flake).
            const dropLogEntry = result.sessionLog.find((l) =>
                /Szczur ginie!.*· Drop:/.test(l.text),
            );
            expect(dropLogEntry).toBeDefined();

            // 7. Log entry type is 'loot' (combatEngine.ts line 1061 —
            //    `addLog(..., 'loot')`). Guards against future regressions
            //    that might split kill-line + drop-line into separate
            //    log entries (which would silently break the CombatLogsModal
            //    filter that types-by entry kind).
            expect(dropLogEntry!.type).toBe('loot');

            // 8. The drop suffix names at least one item — `dropNames`
            //    join in line 1057 puts the icon (if any) before the name,
            //    then commas between items. Format: "🔪 Iron Sword" or
            //    just "Iron Sword" (when icon is empty per safeIcon
            //    guard at line 1048). We assert non-empty content after
            //    "· Drop:" — at least 1 char of name follows. Regex
            //    breakdown: `· Drop: ` literal + `.+` greedy match of
            //    non-empty payload.
            expect(dropLogEntry!.text).toMatch(/· Drop: .+/);

            // 9. Bag side-effect confirmation. addItem (inventoryStore.ts
            //    line 233) appends to bag when bag.length < MAX (1000)
            //    and autoSell flag is off (autoSellCommon=false default).
            //    Common-rarity drop = goes to bag. We assert bag grew
            //    >= 1 after the kill — verifies the drop wasn't just a
            //    log artifact but actually persisted.
            const bagSize = await page.evaluate(async () => {
                // @ts-expect-error — dev-time Vite URL not resolvable by tsc
                const mod = await import('/src/stores/inventoryStore.ts');
                return (mod as {
                    useInventoryStore: { getState: () => { bag: Array<unknown> } };
                }).useInventoryStore.getState().bag.length;
            });
            expect(bagSize).toBeGreaterThanOrEqual(1);
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
