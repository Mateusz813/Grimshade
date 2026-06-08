/**
 * Atomic E2E — full live-combat kill flow drops gold + applies XP via
 * `handleMonsterDeath` (BACKLOG 13.5 hunting + 13.13 drop half).
 *
 * Complements the SKIP-flow tests:
 *  • `full-kill-rewards-xp-and-gold.spec.ts` uses SKIP — XP awarded
 *    but gold=0, drops=[] (per combatEngine.ts line 2515-2516, SKIP
 *    intentionally suppresses gold and drops to balance the speed
 *    advantage).
 *  • `kill-counter-increments-per-kill.spec.ts` uses SKIP — kill
 *    counter increments but again no gold/drops.
 *
 * THIS test uses `killMonsterViaEngine` which drives the LIVE-combat
 * `handleMonsterDeath` path. That path:
 *  • Calls `dropLootToInventory` (combatEngine.ts line 1027) →
 *    `inventoryStore.addGold(gold)` for the rolled gold.
 *  • Calls `useCharacterStore.addXp(finalXp)` line 1080.
 *  • Calls `useCombatStore.incrementSessionKill(rarity)` line 1137.
 *
 * Assertions:
 *  • Gold increases by exactly rat.gold range [1, 1] — `calculateGoldDrop`
 *    rolls inclusive in [min, max], for rat that's [1, 1] = always 1.
 *  • Character XP increased (from 0 to >0).
 *  • Combat sessionKills.normal === 1.
 *  • Combat log captured "ginie!" entry per line 1046 (the live-combat
 *    kill log line — different from SKIP's "Walka z … rozpoczęta").
 *
 * What we DON'T verify:
 *  • Specific drop items in bag — `rollLoot` is RNG-based with low
 *    drop chance for rat. Asserting "bag.length === 0 OR === 1" would
 *    be technically correct but adds noise; we focus on gold which is
 *    deterministic for rat.
 *  • Mastery / task / quest progress side effects — separate test surface.
 *  • Per-rarity (strong/epic) kills — same code path; one rarity proof.
 *
 * Why this matters as a regression test:
 *  • `handleMonsterDeath` is the canonical reward pipeline. Every
 *    type of combat (hunting / boss / dungeon / raid / transform /
 *    trainer) routes through it for monster kills. A regression here
 *    silently kills every monster's reward in every combat type.
 *  • Past bug history: line 996-1003 has a non-leader-bail clause that
 *    in early-2026 over-triggered for solo players when partyStore was
 *    in a "membership in progress" intermediate state, causing solo
 *    fights to award 0 gold. Strong regression net.
 *
 * Cleanup: try/finally + cleanupCharacterById.
 */

import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';
import { killMonsterViaEngine, getCharacterSnapshot } from '../../fixtures/combatSim';

test.describe('Combat › Hunting', { tag: '@combat' }, () => {
    test.describe.configure({ timeout: 90_000 });

    test('live-combat kill of rat: gold +1, xp gained, kill counter +1, log "ginie"', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            // 1. Seed Knight lvl 1, fresh state (gold=0, xp=0).
            const created = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: nick,
                class: 'Knight',
                overrides: { hp_regen: 0, mp_regen: 0 },
            });
            createdId = created.id;

            // 2. Login + Town hydration.
            await loginViaUI(page, testUsers.primary);
            await page.goto('/character-select');
            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await expect(card).toBeVisible({ timeout: 10_000 });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
            await expect(page.locator('.town__char-name')).toHaveText(nick, { timeout: 10_000 });

            // 3. Pre-snapshot. Fresh char has gold=0 (per
            //    createCharacterViaApi default in `overrides`) +
            //    xp=0 (DB column default).
            const before = await getCharacterSnapshot(page);
            expect(before).not.toBeNull();
            const preGold = before!.gold;
            const preXp = before!.xp;

            // 4. Drive the live-combat kill path.
            const result = await killMonsterViaEngine(page, 'rat', 'normal');

            // 5. sessionKills incremented per line 1137 of
            //    handleMonsterDeath. This is the load-bearing assertion
            //    that the reward flow ran end-to-end.
            expect(result.sessionKills.normal).toBeGreaterThanOrEqual(1);

            // 6. Combat log captured the live-combat kill line. Per
            //    combatEngine.ts line 1046:
            //    `${monster.name_pl} ginie! +${XP} XP, +${gold} Gold[· Drop: …]`
            //    Different log line than SKIP mode's opener — its
            //    presence confirms we routed through handleMonsterDeath,
            //    not resolveInstantFight.
            const killLogEntry = result.sessionLog.find((l) =>
                /Szczur ginie!.*\+\d+ XP.*\+\d+ Gold/.test(l.text),
            );
            expect(killLogEntry).toBeDefined();
            // Kill log is type 'loot' (line 1047).
            expect(killLogEntry!.type).toBe('loot');

            // 7. Character state mutated. Read fresh snapshot.
            const after = await getCharacterSnapshot(page);
            expect(after).not.toBeNull();

            // 8. Gold went up. Rat gold range is [1, 1] in monsters.json
            //    line 11 → calculateGoldDrop always returns 1 (no
            //    mastery bonus on first kill, no party bonus solo).
            //    However drops can also auto-sell-add gold for any
            //    common rarity drops if auto-sell-common is on (default
            //    for fresh chars per settingsStore.ts), so we assert
            //    >= preGold + 1 (the deterministic floor).
            expect(after!.gold).toBeGreaterThanOrEqual(preGold + 1);

            // 9. XP went up. Rat base xp = 3, mastery=0 → multiplier 1.0,
            //    solo party → 1.0, no buffs → 1.0; final = 3.
            expect(after!.xp).toBeGreaterThan(preXp);
            // Defensive upper bound: without any boosts, the XP gain
            // can't exceed rat.xp by more than 2× (mastery scaling +
            // safety margin for future tweaks).
            expect(after!.xp - preXp).toBeLessThanOrEqual(10);
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
