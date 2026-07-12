import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
    getLeagueMultiplier,
    getNextLeague,
    getPreviousLeague,
    getMatchReward,
    getSeasonOutcome,
    findRewardBucket,
    applyLeagueMultiplier,
} from '../../src/systems/arenaSystem';
import { ARENA_LEAGUES } from '../../src/types/arena';


const SEASON_RANKS = [1, 5, 10, 15, 17, 20, 30, 33, 35, 40, 41, 50, 60, 70, 80, 81, 100];
const BUCKET_RANKS = [1, 2, 3, 5, 10, 50, 100, 101, 0];

const buildGolden = (): Record<string, unknown> => ({
    system: 'arenaSystem',
    note: 'Generowane z src/systems/arenaSystem.ts (podzbiór czysty). NIE edytuj ręcznie.',
    getLeagueMultiplier: ARENA_LEAGUES.map((l) => ({ league: l, value: getLeagueMultiplier(l) })),
    getNextLeague: ARENA_LEAGUES.map((l) => ({ league: l, value: getNextLeague(l) })),
    getPreviousLeague: ARENA_LEAGUES.map((l) => ({ league: l, value: getPreviousLeague(l) })),
    getMatchReward: [true, false].flatMap((won) =>
        [true, false].map((higher) => ({ won, higher, result: getMatchReward(won, higher) })),
    ),
    getSeasonOutcome: ARENA_LEAGUES.flatMap((league) =>
        SEASON_RANKS.map((rank) => ({ league, rank, result: getSeasonOutcome(league, rank) })),
    ),
    findRewardBucket: BUCKET_RANKS.map((rank) => ({ rank, result: findRewardBucket(rank) })),
    applyLeagueMultiplier: ['bronze', 'gold', 'legend'].map((league) => ({
        league,
        result: applyLeagueMultiplier(findRewardBucket(1)!, league as never),
    })),
});

const outPath = resolve(process.cwd(), 'golden/arenaSystem.json');
const computed = buildGolden();

if (process.env.UPDATE_GOLDEN) {
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, `${JSON.stringify(computed, null, 2)}\n`);
}

describe('arenaSystem golden vectors (TS↔PHP parity source)', () => {
    it('committed fixture matches current arenaSystem output', () => {
        expect(existsSync(outPath), 'brak golden/arenaSystem.json — uruchom UPDATE_GOLDEN=1').toBe(true);
        const fixture = JSON.parse(readFileSync(outPath, 'utf8'));
        expect(computed).toEqual(fixture);
    });
});
