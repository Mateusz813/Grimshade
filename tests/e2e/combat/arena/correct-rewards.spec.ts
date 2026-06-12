/**
 * Atomic E2E — arena finalizeMatch reward integrity for solo player win.
 *
 * BACKLOG 13.18: "Arena: poprawne nagrody". Full UI flow (navigate
 * `/arena` -> pick opponent -> live combat in `ArenaMatch.tsx` -> assert
 * post-victory `arenaPoints` += 100) is fragile:
 *  - Live arena combat is RNG (attack rolls, crits, dodges) — even
 *    with skilled tuning the result is non-deterministic.
 *  - Opponents on the picker are bot-generated; bot stats depend on
 *    `generateBotsForArena` randomisation hooks. Seeding deterministic
 *    bots is intrusive.
 *  - The auto-fight loop in `ArenaMatch.tsx` line 405-437 only
 *    finalizes on HP=0; intermediate ticks burn 125ms wall clock each.
 *
 * We instead invoke `useArenaStore.finalizeMatch` DIRECTLY via
 * `page.evaluate` — the same call the live combat path makes when
 * `playerHp === 0` (ArenaMatch.tsx line 409 / 424 / 605). This exercises
 * the EXACT reward-application code (arenaStore.ts line 268-396) without
 * the RNG combat layer in between.
 *
 * What this proves:
 *  - Winning attacker (`attackerWon: true, attackerIsHigher: false`)
 *    receives `getMatchReward().attacker.arenaPoints = 100` and
 *    `leaguePoints = 1` per `arenaSystem.ts` line 88-91 (down-stack win).
 *  - `inventoryStore.arenaPoints` increments by exactly 100 — this is
 *    the LOCAL credit (arenaStore line 313-316:
 *    `if (localGain > 0) useInventoryStore.addArenaPoints(localGain)`).
 *  - `currentArena.competitors[me].seasonArenaPoints` += 100, and
 *    `leaguePoints` += 1 — the same player object's per-season totals
 *    used by the leaderboard renderer and the league-promotion
 *    calculator.
 *  - `matchLog` grows by 1 with the won=true entry.
 *  - `stats.matchesWon` += 1 — the dashboard tile counter.
 *
 * What we DON'T assert (and why):
 *  - `arena_kills` DB column increment — `bumpArenaStats` is fire-and-
 *    forget over HTTP, eventual consistency. Inventory + store changes
 *    are synchronous so we test the IN-MEMORY contract that the player
 *    sees instantly. DB sync is covered by `characterApi.test.ts`
 *    unit tests.
 *  - `arena_league` promotion — only triggers at season boundaries via
 *    `getSeasonOutcome` in `refreshIfNeeded`, NOT per-match. Out of
 *    scope here.
 *  - Loss / defender path — covered separately in
 *    `combat/arena/correct-rewards-loss.spec.ts` (TODO).
 *
 * Strategy:
 *  1. Seed Knight lvl 10 with 0 starting AP.
 *  2. Login + pick character -> Town.
 *  3. Navigate `/arena` to force `useArenaStore.refreshIfNeeded(level)`
 *     which builds `currentArena` with `buildPlayerCompetitor` + 9 bots.
 *  4. Pull pre-snapshot: arena AP from inventoryStore, player's
 *     seasonArenaPoints + leaguePoints from competitors, matchLog
 *     length, stats.matchesWon.
 *  5. Pick a bot opponent (any non-player competitor with bot id),
 *     call `finalizeMatch` simulating an attacker-down win.
 *  6. Pull post-snapshot, assert deltas match `getMatchReward(true, false)`.
 *
 * Cleanup: try/finally + cleanupCharacterById (game_saves carries
 * arenaStore persist payload; deleting character wipes it).
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
}

const getArenaSnapshot = async (
    page: import('@playwright/test').Page,
): Promise<IArenaSnapshot> => {
    return await page.evaluate(async (): Promise<IArenaSnapshot> => {
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
                    matchLog: unknown[];
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
        };
    });
};

test.describe('Combat › Arena', { tag: '@combat' }, () => {
    test.describe.configure({ timeout: 90_000 });

    test('finalizeMatch attacker-down win: AP+=100, LP+=1, log+=1, matchesWon+=1', async ({ page }) => {
        const nick = generateTestCharacterName();
        let createdId: string | null = null;

        try {
            // 1. Seed Knight lvl 10. Bots scale to player level — lvl 10
            //    keeps the bot roster diverse without weird edge bot
            //    generation behaviour.
            const created = await createCharacterViaApi({
                userEmail: testUsers.primary.email,
                name: nick,
                class: 'Knight',
                overrides: { level: 10, highest_level: 10, hp_regen: 0, mp_regen: 0 },
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

            // 3. Navigate to /arena. Arena.tsx mount calls
            //    `useArenaStore.refreshIfNeeded(character.level)` which
            //    invokes `buildFreshArena` -> builds the player competitor
            //    + 9 bots. This is the SAME path live players use to
            //    arrive at the arena hub.
            await page.goto('/arena');
            await expect(page).toHaveURL(/\/arena$/, { timeout: 10_000 });
            await expect(page.locator('.arena__league-strip')).toBeVisible({ timeout: 15_000 });

            // 4. Pre-snapshot. Expected: AP=0, season=0, LP=0, log=0,
            //    matchesWon=0. firstBotId MUST be non-null (proves
            //    `generateBotsForArena` populated competitors).
            const before = await getArenaSnapshot(page);
            expect(before.myCompetitorId).not.toBeNull();
            expect(before.firstBotId).not.toBeNull();
            expect(before.arenaPointsInInventory).toBe(0);
            expect(before.mySeasonAp).toBe(0);
            expect(before.myLeaguePoints).toBe(0);
            expect(before.matchLogLength).toBe(0);
            expect(before.matchesWon).toBe(0);

            // 5. Invoke finalizeMatch — SAME signature used by
            //    ArenaMatch.tsx live-combat path on victory.
            //    `attackerWon: true, attackerIsHigher: false` triggers
            //    the down-stack win bucket: AP +100, LP +1
            //    (arenaSystem.ts line 88-91).
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
                    attackerWon: true,
                    attackerIsHigher: false,
                    opponentName: 'TestOpponent',
                    opponentClass: 'Mage',
                    opponentLevel: 10,
                });
            }, { myCompetitorId: before.myCompetitorId!, firstBotId: before.firstBotId! });

            // 6. Post-snapshot. Assert per-field deltas match the
            //    reward bucket. Note: `localGain` in arenaStore.ts line
            //    313 is `reward.attacker.arenaPoints` = 100 for a win,
            //    and `addArenaPoints` is a pure +N on inventory.
            const after = await getArenaSnapshot(page);

            // (a) Inventory AP += 100 (the player's spendable currency).
            expect(after.arenaPointsInInventory).toBe(before.arenaPointsInInventory + 100);

            // (b) Per-season AP for the player's competitor row += 100
            //     (drives leaderboard ordering).
            expect(after.mySeasonAp).toBe(before.mySeasonAp + 100);

            // (c) League points += 1 (drives season-end promotion).
            expect(after.myLeaguePoints).toBe(before.myLeaguePoints + 1);

            // (d) Match log grows by 1 with the new entry (drives
            //     "ostatnie walki" history tile).
            expect(after.matchLogLength).toBe(before.matchLogLength + 1);

            // (e) Stats counter +1 (drives "wygrane" tile + Leaderboard
            //     arena ranking column).
            expect(after.matchesWon).toBe(before.matchesWon + 1);
        } finally {
            if (createdId) {
                await cleanupCharacterById(createdId);
            }
        }
    });
});
