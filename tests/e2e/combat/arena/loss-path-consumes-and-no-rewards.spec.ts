/**
 * Atomic E2E — arena `finalizeMatch` loss path: no rewards for attacker,
 * matchesWon stays 0, log entry tagged `won=false`.
 *
 * BACKLOG 13.18 expansion. The sibling `correct-rewards.spec.ts` proves
 * the WIN path (attacker AP+=100, LP+=1, matchesWon+=1). This test
 * proves the LOSS path: `attackerWon=false` → attacker gets nothing,
 * defender gets the bounty (defender pays out per spec).
 *
 * ## Contract from `arenaSystem.ts` line 93-105 + `arenaStore.ts` line 268-336
 *
 *  `getMatchReward(false, false)` (attacking down, lost):
 *    attacker: { arenaPoints: 0, leaguePoints: 0 }
 *    defender: { arenaPoints: 250, leaguePoints: 2 }
 *
 *  `finalizeMatch` then:
 *    • Bumps myComp (attacker) by `reward.attacker.*` = 0/0 → NO change.
 *    • Bumps opponent (defender, here a bot) by `reward.defender.*` = 250/2.
 *    • `localGain = reward.attacker.arenaPoints = 0` → skips
 *      `useInventoryStore.addArenaPoints` entirely (line 314 `if (localGain > 0)`).
 *    • `matchLog` gets new entry with `won: false`, `arenaPointsDelta: 0`,
 *      `leaguePointsDelta: 0`.
 *    • `stats.matchesWon` += `attackerWon ? 1 : 0` = +0 → stays at 0.
 *
 * ## Test assertions
 *
 *  Pre-state (no arena interactions yet):
 *    arenaPointsInInventory = 0
 *    mySeasonAp = 0
 *    myLeaguePoints = 0
 *    matchLogLength = 0
 *    matchesWon = 0
 *    botSeasonAp (the chosen opponent) = some bot-generated value (could be 0)
 *    botLeaguePoints = some bot-generated value (could be 0)
 *
 *  After loss `finalizeMatch({attackerWon: false, attackerIsHigher: false})`:
 *    (a) arenaPointsInInventory STILL 0 (no addArenaPoints call).
 *    (b) mySeasonAp STILL 0 (no attacker delta).
 *    (c) myLeaguePoints STILL 0 (no LP awarded for losing).
 *    (d) matchLogLength === 1 (entry was written even though we lost).
 *    (e) matchesWon STILL 0 (attackerWon=false → no increment).
 *    (f) Log entry's `won === false` + deltas === 0.
 *    (g) Opponent (bot) seasonAp +=250 + leaguePoints +=2 — proves the
 *        defender-pays-out branch fired (not a silent no-op for both
 *        sides).
 *
 * ## Why this matters
 *
 * Without an explicit loss test, a regression that accidentally credits
 * the attacker on loss (e.g. inverted branch in `getMatchReward`) would
 * pass `correct-rewards.spec.ts` (win case is fine) and silently break
 * arena economy on the loss side. This test is the negative regression
 * guard.
 *
 * ## Strategy
 *
 * Same as the win sibling — invoke `finalizeMatch` DIRECTLY via
 * `page.evaluate`. Live arena combat is RNG-driven (player COULD win
 * even if we tried to "intentionally lose") — direct call is the only
 * way to force the loss branch.
 *
 * Cleanup: try/finally + cleanupCharacterById (game_saves carries the
 * arenaStore persist payload; deleting character wipes it).
 *
 * ## Why SECONDARY account
 *
 * Per task brief — primary is hammered by background suite; secondary
 * is the parallel slot for char seeding.
 */

import { test, expect } from '@playwright/test';
import { testUsers } from '../../fixtures/testUsers';
import { loginViaUI } from '../../fixtures/login';
import { createCharacterViaApi, generateTestCharacterName } from '../../fixtures/createCharacter';
import { cleanupCharacterById } from '../../fixtures/cleanup';

interface IArenaSnapshot {
    arenaPointsInInventory: number;
    mySeasonAp: number;
    myLeaguePoints: number;
    matchLogLength: number;
    matchesWon: number;
    myCompetitorId: string | null;
    firstBotId: string | null;
    botSeasonAp: number;
    botLeaguePoints: number;
    lastLogEntry: {
        won: boolean;
        arenaPointsDelta: number;
        leaguePointsDelta: number;
    } | null;
}

const getArenaSnapshot = async (
    page: import('@playwright/test').Page,
    forBotId?: string,
): Promise<IArenaSnapshot> => {
    return await page.evaluate(async (botId): Promise<IArenaSnapshot> => {
        // @ts-expect-error — dev-time Vite URL not resolvable by tsc
        const arenaMod = await import('/src/stores/arenaStore.ts');
        // @ts-expect-error — dev-time Vite URL not resolvable by tsc
        const invMod = await import('/src/stores/inventoryStore.ts');
        // @ts-expect-error — dev-time Vite URL not resolvable by tsc
        const charMod = await import('/src/stores/characterStore.ts');

        const arenaState = (arenaMod as {
            useArenaStore: {
                getState: () => {
                    currentArena: {
                        competitors: Array<{
                            id: string;
                            isBot: boolean;
                            seasonArenaPoints: number;
                            leaguePoints: number;
                        }>;
                    } | null;
                    matchLog: Array<{
                        won: boolean;
                        arenaPointsDelta: number;
                        leaguePointsDelta: number;
                    }>;
                    stats: { matchesWon: number };
                };
            };
        }).useArenaStore.getState();

        const character = (charMod as {
            useCharacterStore: { getState: () => { character: { id?: string } | null } };
        }).useCharacterStore.getState().character;

        const myCompId = character?.id ? `player_${character.id}` : null;
        const me = arenaState.currentArena?.competitors.find((c) => c.id === myCompId);
        const firstBot = arenaState.currentArena?.competitors.find((c) => c.isBot) ?? null;
        const targetBot = botId
            ? arenaState.currentArena?.competitors.find((c) => c.id === botId)
            : firstBot;

        const inv = (invMod as {
            useInventoryStore: { getState: () => { arenaPoints: number } };
        }).useInventoryStore.getState();

        return {
            arenaPointsInInventory: inv.arenaPoints,
            mySeasonAp: me?.seasonArenaPoints ?? 0,
            myLeaguePoints: me?.leaguePoints ?? 0,
            matchLogLength: arenaState.matchLog.length,
            matchesWon: arenaState.stats.matchesWon,
            myCompetitorId: myCompId,
            firstBotId: firstBot?.id ?? null,
            botSeasonAp: targetBot?.seasonArenaPoints ?? 0,
            botLeaguePoints: targetBot?.leaguePoints ?? 0,
            lastLogEntry: arenaState.matchLog[0] ?? null,
        };
    }, forBotId ?? null);
};

test.describe('Combat › Arena', { tag: '@combat' }, () => {
    test.describe.configure({ timeout: 90_000 });

    test('finalizeMatch attacker-down loss: no AP/LP gained, matchesWon=0, log entry tagged won=false, defender bot paid out 250/2', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            // 1. Seed Knight lvl 10 on SECONDARY. lvl 10 keeps the bot
            //    roster on the same scaling as the win sibling test.
            const created = await createCharacterViaApi({
                userEmail: testUsers.secondary.email,
                name: nick,
                class: 'Knight',
                overrides: { level: 10, highest_level: 10, hp_regen: 0, mp_regen: 0 },
            });
            createdId = created.id;

            // 2. Login → wybierz postać → Town
            await loginViaUI(page, testUsers.secondary);
            await page.goto('/character-select');
            const card = page.locator('.char-select__card', {
                has: page.locator('.char-select__card-name', { hasText: nick }),
            });
            await expect(card).toBeVisible({ timeout: 10_000 });
            await card.getByRole('button', { name: /Wybierz/i }).tap();
            await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
            await expect(page.locator('.top-header')).toBeVisible({ timeout: 10_000 });

            // 3. Navigate to /arena. Forces `useArenaStore.refreshIfNeeded`
            //    → `buildFreshArena` builds player competitor + 9 bots.
            await page.goto('/arena');
            await expect(page).toHaveURL(/\/arena$/, { timeout: 10_000 });
            await expect(page.locator('.arena__league-strip')).toBeVisible({ timeout: 15_000 });

            // 4. Pre-snapshot. Expected fresh state: AP=0, season=0, LP=0,
            //    log=0, matchesWon=0. firstBotId MUST be non-null.
            const before = await getArenaSnapshot(page);
            expect(before.myCompetitorId).not.toBeNull();
            expect(before.firstBotId).not.toBeNull();
            expect(before.arenaPointsInInventory).toBe(0);
            expect(before.mySeasonAp).toBe(0);
            expect(before.myLeaguePoints).toBe(0);
            expect(before.matchLogLength).toBe(0);
            expect(before.matchesWon).toBe(0);

            // Capture pre-loss bot state for diff after finalizeMatch.
            // Bots have non-zero seedAP/LP from generateBotsForArena's
            // distribution — we measure DELTA, not absolute.
            const botBefore = await getArenaSnapshot(page, before.firstBotId!);

            // 5. Invoke finalizeMatch with loss params:
            //    `attackerWon: false, attackerIsHigher: false` triggers
            //    `getMatchReward(false, false)` → defender bucket
            //    (250 AP, 2 LP for the defender, 0/0 for attacker) per
            //    arenaSystem.ts line 102-105.
            await page.evaluate(async (args) => {
                // @ts-expect-error — dev-time Vite URL not resolvable by tsc
                const mod = await import('/src/stores/arenaStore.ts');
                const arena = (mod as {
                    useArenaStore: {
                        getState: () => {
                            finalizeMatch: (m: unknown) => unknown;
                        };
                    };
                }).useArenaStore;
                arena.getState().finalizeMatch({
                    myCompetitorId: args.myCompetitorId,
                    opponentId: args.firstBotId,
                    attackerWon: false,
                    attackerIsHigher: false,
                    opponentName: 'TestOpponent',
                    opponentClass: 'Mage',
                    opponentLevel: 10,
                });
            }, { myCompetitorId: before.myCompetitorId!, firstBotId: before.firstBotId! });

            // 6. Post-snapshot.
            const after = await getArenaSnapshot(page, before.firstBotId!);

            // (a) Inventory AP UNCHANGED. Loss → `localGain = 0` → branch
            //     line 314 `if (localGain > 0)` skipped → addArenaPoints
            //     never called.
            expect(after.arenaPointsInInventory).toBe(before.arenaPointsInInventory);

            // (b) Player's per-season AP UNCHANGED. attacker reward.AP = 0.
            expect(after.mySeasonAp).toBe(before.mySeasonAp);

            // (c) Player's LP UNCHANGED. attacker reward.LP = 0.
            //     (Losing the attack does NOT cost the attacker LP per
            //     spec — defender gets bonus, attacker just gets nothing.)
            expect(after.myLeaguePoints).toBe(before.myLeaguePoints);

            // (d) matchLog grew by 1 — entry IS written even on loss.
            //     Drives "ostatnie walki" tile in the arena hub.
            expect(after.matchLogLength).toBe(before.matchLogLength + 1);

            // (e) matchesWon UNCHANGED. `s.stats.matchesWon + (attackerWon ? 1 : 0)`
            //     evaluates to `0 + 0 = 0`.
            expect(after.matchesWon).toBe(before.matchesWon);

            // (f) Log entry has won=false + deltas 0/0. Drives the
            //     red "Przegrana" pill in MatchLog tile + the
            //     "AP±0, LP±0" copy.
            expect(after.lastLogEntry).not.toBeNull();
            expect(after.lastLogEntry!.won).toBe(false);
            expect(after.lastLogEntry!.arenaPointsDelta).toBe(0);
            expect(after.lastLogEntry!.leaguePointsDelta).toBe(0);

            // (g) Defender bot DID receive the bounty. seasonAp += 250,
            //     leaguePoints += 2 per `getMatchReward(false, false)`
            //     defender bucket (line 102-105). Proves the loss branch
            //     ACTUALLY ran and didn't silently no-op for both sides.
            expect(after.botSeasonAp).toBe(botBefore.botSeasonAp + 250);
            expect(after.botLeaguePoints).toBe(botBefore.botLeaguePoints + 2);
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
