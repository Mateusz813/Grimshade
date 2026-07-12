import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { IArenaInstance, IArenaCompetitor } from '../types/arena';


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
import { getSeasonStart } from '../systems/arenaSystem';


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


describe('consumeAttempt', () => {
    it('grants the first attempt of the day and counts it', () => {
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
            attackerWon: true,
            attackerIsHigher: false,
            opponentName: 'BotA',
            opponentClass: 'Knight',
            opponentLevel: 10,
        });
        const me = useArenaStore.getState().currentArena!.competitors.find((c) => c.id === 'player_char-1')!;
        expect(me.seasonArenaPoints).toBe(100);
        expect(me.leaguePoints).toBe(1);
    });

    it('credits inventory arena points by the same delta', () => {
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
        expect(addArenaPointsSpy).not.toHaveBeenCalled();
    });

    it('writes a match-log entry capped at 100 entries', () => {
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
        expect(me.leaguePointsAchievedAt).toBe(oldTs);
    });
});


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



describe('refreshIfNeeded — season boundary preserves AP/LP (BUG #1)', () => {
    it('does NOT rebuild/zero the arena at the season boundary — keeps AP/LP + sets pendingRewards', () => {
        useArenaStore.setState({
            currentArena: makeArena({
                id: 'bronze_42',
                competitors: [
                    makeCompetitor({ id: 'player_char-1', seasonArenaPoints: 2000, leaguePoints: 50 }),
                    makeCompetitor({ id: 'bot_1', name: 'Bot', isBot: true, leaguePoints: 5 }),
                ],
            }),
            seasonStartIso: '2020-01-01T00:00:00.000Z',
            pendingRewards: null,
        });

        useArenaStore.getState().refreshIfNeeded(10);

        const s = useArenaStore.getState();
        const me = s.currentArena?.competitors.find((c) => !c.isBot);
        expect(me?.seasonArenaPoints).toBe(2000);
        expect(me?.leaguePoints).toBe(50);
        expect(s.currentArena?.id).toBe('bronze_42');
        expect(s.pendingRewards).not.toBeNull();
        expect(s.seasonStartIso).toBe('2020-01-01T00:00:00.000Z');
    });

    it('does nothing when the season has not changed', () => {
        useArenaStore.setState({
            currentArena: makeArena(),
            seasonStartIso: getSeasonStart().toISOString(),
            pendingRewards: null,
        });
        useArenaStore.getState().refreshIfNeeded(10);
        expect(useArenaStore.getState().pendingRewards).toBeNull();
        expect(useArenaStore.getState().currentArena?.id).toBe('bronze_42');
    });
});

describe('claimSeasonRewards — reset + promotion AFTER claim (BUG #1)', () => {
    it('rebuilds a fresh season, advances seasonStartIso, resets stats + clears pendingRewards', () => {
        useCharacterStore.setState({ character: null, isLoading: false });
        useArenaStore.setState({
            currentArena: makeArena({ id: 'bronze_42' }),
            seasonStartIso: '2020-01-01T00:00:00.000Z',
            pendingRewards: { league: 'bronze', finalRank: 55 },
            stats: { matchesWon: 9, matchesDefended: 3 },
        });

        const result = useArenaStore.getState().claimSeasonRewards();

        const s = useArenaStore.getState();
        expect(result).toEqual({ league: 'bronze', finalRank: 55 });
        expect(s.pendingRewards).toBeNull();
        expect(s.seasonStartIso).toBe(getSeasonStart().toISOString());
        expect(s.stats).toEqual({ matchesWon: 0, matchesDefended: 0 });
        expect(s.currentArena?.id).not.toBe('bronze_42');
        expect(s.currentArena?.league).toBe('bronze');
    });

    it('promotes the league on claim when finalRank is in the promotion zone', () => {
        useCharacterStore.setState({ character: null, isLoading: false });
        useArenaStore.setState({
            currentArena: makeArena({ id: 'bronze_42', league: 'bronze' }),
            seasonStartIso: '2020-01-01T00:00:00.000Z',
            pendingRewards: { league: 'bronze', finalRank: 1 },
        });
        useArenaStore.getState().claimSeasonRewards();
        expect(useArenaStore.getState().currentArena?.league).toBe('silver');
    });

    it('returns null + no-ops when there is no pending reward', () => {
        useArenaStore.setState({ currentArena: makeArena(), pendingRewards: null });
        expect(useArenaStore.getState().claimSeasonRewards()).toBeNull();
    });
});
