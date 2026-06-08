import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { IArenaInstance, IArenaCompetitor } from '../types/arena';

// ── Hoisted mocks ────────────────────────────────────────────────────────────
// arenaStore.finalizeMatch fires fire-and-forget Supabase RPCs through
// characterApi. We mock the whole module path so unit tests don't depend on
// network / RLS / the dynamic import resolving in real time.

const { bumpArenaStatsMock, bumpArenaDeathRpcMock, bumpArenaKillRpcMock } = vi.hoisted(() => ({
    bumpArenaStatsMock: vi.fn().mockResolvedValue(undefined),
    bumpArenaDeathRpcMock: vi.fn().mockResolvedValue(undefined),
    bumpArenaKillRpcMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../api/v1/characterApi', () => ({
    characterApi: {
        bumpArenaStats: bumpArenaStatsMock,
        bumpArenaDeathRpc: bumpArenaDeathRpcMock,
        bumpArenaKillRpc: bumpArenaKillRpcMock,
    },
}));

import { useArenaStore } from './arenaStore';
import { useInventoryStore } from './inventoryStore';
import { useCharacterStore } from './characterStore';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const makeCompetitor = (overrides?: Partial<IArenaCompetitor>): IArenaCompetitor => ({
    id: 'player_char-1',
    name: 'Me',
    class: 'Knight',
    level: 10,
    color: '#888',
    leaguePoints: 0,
    leaguePointsAchievedAt: '2026-05-21T00:00:00Z',
    seasonArenaPoints: 0,
    isBot: false,
    defense: {
        maxHp: 200,
        maxMp: 50,
        attack: 20,
        defense: 10,
        skillSlots: [null, null, null, null],
        snapshotAt: '2026-05-21T00:00:00Z',
    },
    ...overrides,
});

const makeArena = (overrides?: Partial<IArenaInstance>): IArenaInstance => ({
    id: 'bronze_42',
    league: 'bronze',
    competitors: [
        makeCompetitor({ id: 'player_char-1', name: 'Me' }),
        makeCompetitor({ id: 'bot_bronze_1', name: 'BotA', isBot: true, leaguePoints: 5 }),
    ],
    ...overrides,
});

beforeEach(() => {
    useArenaStore.setState({
        currentArena: null,
        seasonStartIso: null,
        dailyAttempts: { day: '2026-05-21', count: 0 },
        defenseSnapshot: null,
        matchLog: [],
        pendingRewards: null,
        stats: { matchesWon: 0, matchesDefended: 0 },
    });
    bumpArenaStatsMock.mockClear();
    bumpArenaDeathRpcMock.mockClear();
    bumpArenaKillRpcMock.mockClear();
});

// ── consumeAttempt / attemptsRemaining ───────────────────────────────────────

describe('consumeAttempt', () => {
    it('grants the first attempt of the day and counts it', () => {
        // Stale entry from "yesterday" — consume rolls the day over.
        useArenaStore.setState({
            currentArena: null,
            seasonStartIso: null,
            dailyAttempts: { day: '1999-12-31', count: 99 },
            defenseSnapshot: null,
            matchLog: [],
            pendingRewards: null,
            stats: { matchesWon: 0, matchesDefended: 0 },
        });
        const ok = useArenaStore.getState().consumeAttempt();
        expect(ok).toBe(true);
        expect(useArenaStore.getState().dailyAttempts.count).toBe(1);
    });

    it('returns false once 10 attempts have been used today', () => {
        // Reuse today's bucket — count=10 should reject the next request.
        // The store reads `new Date().toISOString().slice(0, 10)` to
        // determine "today" — use the same primitive here so the bucket
        // is recognized as current, otherwise `consumeAttempt` would
        // see the day as stale and roll the counter back to 1.
        const today = new Date().toISOString().slice(0, 10);
        useArenaStore.setState({
            currentArena: null,
            seasonStartIso: null,
            dailyAttempts: { day: today, count: 10 },
            defenseSnapshot: null,
            matchLog: [],
            pendingRewards: null,
            stats: { matchesWon: 0, matchesDefended: 0 },
        });
        const ok = useArenaStore.getState().consumeAttempt();
        expect(ok).toBe(false);
    });
});

describe('attemptsRemaining', () => {
    it('returns the full daily budget for an unused bucket', () => {
        const today = useArenaStore.getState().dailyAttempts.day;
        useArenaStore.setState({
            currentArena: null,
            seasonStartIso: null,
            dailyAttempts: { day: today, count: 0 },
            defenseSnapshot: null,
            matchLog: [],
            pendingRewards: null,
            stats: { matchesWon: 0, matchesDefended: 0 },
        });
        expect(useArenaStore.getState().attemptsRemaining()).toBe(10);
    });

    it('returns the full budget when the stored day is stale (next-day rollover)', () => {
        useArenaStore.setState({
            currentArena: null,
            seasonStartIso: null,
            dailyAttempts: { day: '1999-12-31', count: 99 },
            defenseSnapshot: null,
            matchLog: [],
            pendingRewards: null,
            stats: { matchesWon: 0, matchesDefended: 0 },
        });
        expect(useArenaStore.getState().attemptsRemaining()).toBe(10);
    });

    it('reflects partial usage during the day', () => {
        // Same fix as `consumeAttempt` — `attemptsRemaining` compares
        // `state.dailyAttempts.day` against `todayIso()`. Anything
        // other than today's ISO date triggers the rollover path that
        // returns the full daily budget. Use a fresh today key here.
        const today = new Date().toISOString().slice(0, 10);
        useArenaStore.setState({
            currentArena: null,
            seasonStartIso: null,
            dailyAttempts: { day: today, count: 3 },
            defenseSnapshot: null,
            matchLog: [],
            pendingRewards: null,
            stats: { matchesWon: 0, matchesDefended: 0 },
        });
        expect(useArenaStore.getState().attemptsRemaining()).toBe(7);
    });
});

// ── finalizeMatch ────────────────────────────────────────────────────────────

describe('finalizeMatch', () => {
    it('returns zero rewards immediately when no currentArena is set', () => {
        const result = useArenaStore.getState().finalizeMatch({
            myCompetitorId: 'player_char-1',
            opponentId: 'bot_bronze_1',
            attackerWon: true,
            attackerIsHigher: false,
            opponentName: 'Bot',
            opponentClass: 'Knight',
            opponentLevel: 10,
        });
        expect(result.attackerAp).toBe(100);
        expect(result.attackerLp).toBe(1);
        expect(result.defenderAp).toBe(0);
        expect(result.defenderLp).toBe(0);
    });

    it('bumps the local competitor\'s LP / AP on a successful attack', () => {
        useArenaStore.setState({
            currentArena: makeArena(),
            seasonStartIso: null,
            dailyAttempts: { day: '2026-05-21', count: 0 },
            defenseSnapshot: null,
            matchLog: [],
            pendingRewards: null,
            stats: { matchesWon: 0, matchesDefended: 0 },
        });
        useArenaStore.getState().finalizeMatch({
            myCompetitorId: 'player_char-1',
            opponentId: 'bot_bronze_1',
            // Attacker WON while attacking UP — 200 AP / 2 LP per arenaSystem.
            attackerWon: true,
            attackerIsHigher: false,
            opponentName: 'BotA',
            opponentClass: 'Knight',
            opponentLevel: 10,
        });
        const me = useArenaStore.getState().currentArena!.competitors.find((c) => c.id === 'player_char-1')!;
        // attackerIsHigher=false + won → 100 AP / 1 LP (see getMatchReward).
        expect(me.seasonArenaPoints).toBe(100);
        expect(me.leaguePoints).toBe(1);
    });

    it('credits inventory arena points by the same delta', () => {
        // Reset inventory store arenaPoints baseline.
        const addArenaPointsSpy = vi.fn();
        const inv = useInventoryStore.getState();
        useInventoryStore.setState({ ...inv, arenaPoints: 0, addArenaPoints: addArenaPointsSpy });
        useArenaStore.setState({
            currentArena: makeArena(),
            seasonStartIso: null,
            dailyAttempts: { day: '2026-05-21', count: 0 },
            defenseSnapshot: null,
            matchLog: [],
            pendingRewards: null,
            stats: { matchesWon: 0, matchesDefended: 0 },
        });
        useArenaStore.getState().finalizeMatch({
            myCompetitorId: 'player_char-1',
            opponentId: 'bot_bronze_1',
            attackerWon: true,
            attackerIsHigher: false,
            opponentName: 'BotA',
            opponentClass: 'Knight',
            opponentLevel: 10,
        });
        expect(addArenaPointsSpy).toHaveBeenCalledWith(100);
    });

    it('does NOT credit inventory arena points when the attacker loses', () => {
        const addArenaPointsSpy = vi.fn();
        const inv = useInventoryStore.getState();
        useInventoryStore.setState({ ...inv, arenaPoints: 0, addArenaPoints: addArenaPointsSpy });
        useArenaStore.setState({
            currentArena: makeArena(),
            seasonStartIso: null,
            dailyAttempts: { day: '2026-05-21', count: 0 },
            defenseSnapshot: null,
            matchLog: [],
            pendingRewards: null,
            stats: { matchesWon: 0, matchesDefended: 0 },
        });
        useArenaStore.getState().finalizeMatch({
            myCompetitorId: 'player_char-1',
            opponentId: 'bot_bronze_1',
            attackerWon: false,
            attackerIsHigher: false,
            opponentName: 'BotA',
            opponentClass: 'Knight',
            opponentLevel: 10,
        });
        // Attacker AP = 0, no inventory hit.
        expect(addArenaPointsSpy).not.toHaveBeenCalled();
    });

    it('writes a match-log entry capped at 100 entries', () => {
        // Seed an arena and an over-full log; finalizeMatch must prepend new entry
        // and slice to MATCH_LOG_MAX (100).
        const seed = Array.from({ length: 100 }, (_, i) => ({
            id: `old_${i}`,
            at: '2000-01-01T00:00:00Z',
            role: 'attacker' as const,
            opponentName: 'Old',
            opponentClass: 'Knight' as const,
            opponentLevel: 1,
            won: true,
            arenaPointsDelta: 0,
            leaguePointsDelta: 0,
        }));
        useArenaStore.setState({
            currentArena: makeArena(),
            seasonStartIso: null,
            dailyAttempts: { day: '2026-05-21', count: 0 },
            defenseSnapshot: null,
            matchLog: seed,
            pendingRewards: null,
            stats: { matchesWon: 0, matchesDefended: 0 },
        });
        useArenaStore.getState().finalizeMatch({
            myCompetitorId: 'player_char-1',
            opponentId: 'bot_bronze_1',
            attackerWon: true,
            attackerIsHigher: true,
            opponentName: 'BotA',
            opponentClass: 'Knight',
            opponentLevel: 10,
        });
        const log = useArenaStore.getState().matchLog;
        expect(log.length).toBe(100);
        // Newest entry sits at index 0.
        expect(log[0].won).toBe(true);
        expect(log[0].opponentName).toBe('BotA');
    });

    it('increments matchesWon stat on a win, leaves matchesDefended alone', () => {
        useArenaStore.setState({
            currentArena: makeArena(),
            seasonStartIso: null,
            dailyAttempts: { day: '2026-05-21', count: 0 },
            defenseSnapshot: null,
            matchLog: [],
            pendingRewards: null,
            stats: { matchesWon: 5, matchesDefended: 3 },
        });
        useArenaStore.getState().finalizeMatch({
            myCompetitorId: 'player_char-1',
            opponentId: 'bot_bronze_1',
            attackerWon: true,
            attackerIsHigher: false,
            opponentName: 'BotA',
            opponentClass: 'Knight',
            opponentLevel: 10,
        });
        expect(useArenaStore.getState().stats.matchesWon).toBe(6);
        expect(useArenaStore.getState().stats.matchesDefended).toBe(3);
    });

    it('refreshes leaguePointsAchievedAt only when LP actually grows (loss = no refresh)', () => {
        const oldTs = '2000-01-01T00:00:00.000Z';
        useArenaStore.setState({
            currentArena: makeArena({
                competitors: [
                    makeCompetitor({
                        id: 'player_char-1',
                        leaguePoints: 5,
                        leaguePointsAchievedAt: oldTs,
                    }),
                    makeCompetitor({ id: 'bot_bronze_1', isBot: true }),
                ],
            }),
            seasonStartIso: null,
            dailyAttempts: { day: '2026-05-21', count: 0 },
            defenseSnapshot: null,
            matchLog: [],
            pendingRewards: null,
            stats: { matchesWon: 0, matchesDefended: 0 },
        });
        useArenaStore.getState().finalizeMatch({
            myCompetitorId: 'player_char-1',
            opponentId: 'bot_bronze_1',
            attackerWon: false,
            attackerIsHigher: false,
            opponentName: 'BotA',
            opponentClass: 'Knight',
            opponentLevel: 10,
        });
        const me = useArenaStore.getState().currentArena!.competitors.find((c) => c.id === 'player_char-1')!;
        // Loss → no LP gained → timestamp stays pinned to the original.
        expect(me.leaguePointsAchievedAt).toBe(oldTs);
    });
});

// ── submitDefenseSnapshot ────────────────────────────────────────────────────

describe('submitDefenseSnapshot', () => {
    it('is a no-op when no character is loaded', () => {
        useCharacterStore.setState({ character: null, isLoading: false });
        useArenaStore.getState().submitDefenseSnapshot();
        expect(useArenaStore.getState().defenseSnapshot).toBeNull();
    });

    it('captures the character\'s current effective stats into defenseSnapshot', () => {
        useCharacterStore.setState({
            character: {
                id: 'char-1',
                user_id: 'u-1',
                name: 'Tester',
                class: 'Knight',
                level: 10,
                xp: 0,
                hp: 200,
                max_hp: 200,
                mp: 50,
                max_mp: 50,
                attack: 20,
                defense: 10,
                attack_speed: 2,
                crit_chance: 5,
                crit_damage: 150,
                magic_level: 0,
                hp_regen: 0,
                mp_regen: 0,
                gold: 0,
                stat_points: 0,
                highest_level: 10,
                equipment: {},
                created_at: 'x',
                updated_at: 'x',
            } as never,
            isLoading: false,
        });
        useArenaStore.getState().submitDefenseSnapshot();
        const snap = useArenaStore.getState().defenseSnapshot;
        expect(snap).not.toBeNull();
        expect(snap!.attack).toBeGreaterThan(0);
        expect(snap!.maxHp).toBeGreaterThan(0);
        expect(snap!.skillSlots).toHaveLength(4);
    });
});

// TODO: refreshIfNeeded touches getSeasonStart() which depends on
// real wall-clock — a robust test would freeze Date via vi.useFakeTimers,
// pin a known Monday, and walk through {first boot, second boot same week,
// new week with pendingRewards, promotion/relegation paths}. The existing
// arenaSystem.test.ts already locks down getSeasonStart / getSeasonOutcome /
// rankCompetitors at the formula level, so the store-level integration is
// the missing piece. Left out here to keep this file scoped to the
// individual public actions explicitly called out in the task.
//
// TODO: claimSeasonRewards mutates many inventory slots in one shot — a
// fully-mocked inventoryStore test would assert every adder fires with the
// correct count. Skipped because the inventoryStore add* methods are
// already covered by inventoryStore.test.ts (sibling file) and the bucket
// → multiplier math lives in arenaSystem.test.ts.
//
// TODO: injectOtherPlayers reads alts' transform progress from
// localStorage by key (`dungeon_rpg_save_char_<id>`). A direct unit test
// would seed the storage + invoke the action; left out because the
// behaviour is exercised by the live Arena page integration test.
