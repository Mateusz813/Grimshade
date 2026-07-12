import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
    ARENA_LEAGUES,
    type ArenaLeague,
    type IArenaCompetitor,
    type IArenaDefenseSnapshot,
    type IArenaInstance,
    type IArenaMatchLogEntry,
} from '../types/arena';
import {
    generateBotsForArena,
    getSeasonOutcome,
    getSeasonStart,
    rankCompetitors,
    getMatchReward,
    findRewardBucket,
    applyLeagueMultiplier,
} from '../systems/arenaSystem';
import { useCharacterStore } from './characterStore';
import { useInventoryStore } from './inventoryStore';
import { useSkillStore } from './skillStore';
import { useTransformStore } from './transformStore';
import { getEffectiveChar } from '../systems/combatEngine';


interface IArenaState {
    currentArena: IArenaInstance | null;
    seasonStartIso: string | null;
    dailyAttempts: { day: string; count: number };
    defenseSnapshot: IArenaDefenseSnapshot | null;
    matchLog: IArenaMatchLogEntry[];
    pendingRewards: {
        league: ArenaLeague;
        finalRank: number;
    } | null;
    stats: {
        matchesWon: number;
        matchesDefended: number;
    };
}

interface IArenaStore extends IArenaState {
    refreshIfNeeded: (playerLevel: number) => void;
    consumeAttempt: () => boolean;
    attemptsRemaining: () => number;
    submitDefenseSnapshot: () => void;
    finalizeMatch: (params: {
        myCompetitorId: string;
        opponentId: string;
        attackerWon: boolean;
        attackerIsHigher: boolean;
        opponentName: string;
        opponentClass: import('../types/character').TCharacterClass;
        opponentLevel: number;
    }) => { attackerAp: number; attackerLp: number; defenderAp: number; defenderLp: number };
    claimSeasonRewards: () => { league: ArenaLeague; finalRank: number } | null;
    injectOtherPlayers: (alts: Array<{
        id: string;
        name: string;
        class: import('../types/character').TCharacterClass;
        level: number;
        max_hp: number;
        max_mp: number;
        attack: number;
        defense: number;
    }>) => void;
}

const ARENA_DAILY_ATTEMPTS = 10;
const ARENA_LIST_SIZE = 100;
const STARTING_LEAGUE: ArenaLeague = 'bronze';
const MATCH_LOG_MAX = 100;

const todayIso = (): string => new Date().toISOString().slice(0, 10);

const buildPlayerCompetitor = (level: number, characterId?: string): IArenaCompetitor | null => {
    const char = useCharacterStore.getState().character;
    if (!char) return null;
    const eff = getEffectiveChar(char);
    const slots = useSkillStore.getState().activeSkillSlots;
    let completedTransforms: number[] = [];
    try {
        const ts = useTransformStore.getState();
        if (Array.isArray(ts.completedTransforms)) {
            completedTransforms = ts.completedTransforms.filter((n): n is number => typeof n === 'number');
        }
    } catch {
    }
    return {
        id: `player_${characterId ?? char.id ?? 'me'}`,
        name: char.name,
        class: char.class,
        level,
        color: '#888',
        leaguePoints: 0,
        leaguePointsAchievedAt: new Date().toISOString(),
        seasonArenaPoints: 0,
        isBot: false,
        completedTransforms,
        defense: {
            maxHp:    eff?.max_hp ?? char.max_hp,
            maxMp:    eff?.max_mp ?? char.max_mp,
            attack:   eff?.attack ?? char.attack,
            defense:  eff?.defense ?? char.defense,
            skillSlots: [...slots] as Array<string | null>,
            snapshotAt: new Date().toISOString(),
        },
    };
};

const buildFreshArena = (league: ArenaLeague, playerLevel: number): IArenaInstance => {
    const seed = Date.now() % 1_000_000_007;
    const player = buildPlayerCompetitor(playerLevel);
    const players = player ? [player] : [];
    const bots = generateBotsForArena(league, ARENA_LIST_SIZE - players.length, seed, playerLevel);
    return {
        id: `${league}_${seed}`,
        league,
        competitors: [...players, ...bots],
    };
};

export const useArenaStore = create<IArenaStore>()(
    persist(
        (set, get) => ({
            currentArena: null,
            seasonStartIso: null,
            dailyAttempts: { day: todayIso(), count: 0 },
            defenseSnapshot: null,
            matchLog: [],
            pendingRewards: null,
            stats: { matchesWon: 0, matchesDefended: 0 },

            refreshIfNeeded: (playerLevel) => {
                const state = get();
                const currentSeasonStart = getSeasonStart().toISOString();
                const seasonChanged = state.seasonStartIso !== currentSeasonStart;

                if (state.dailyAttempts.day !== todayIso()) {
                    set({ dailyAttempts: { day: todayIso(), count: 0 } });
                }

                if (!state.currentArena) {
                    set({
                        currentArena: buildFreshArena(STARTING_LEAGUE, playerLevel),
                        seasonStartIso: currentSeasonStart,
                    });
                    return;
                }

                if (!seasonChanged) {
                    return;
                }

                if (!state.pendingRewards) {
                    const me = state.currentArena.competitors.find((c) => !c.isBot);
                    if (me) {
                        const ranked = rankCompetitors(state.currentArena.competitors);
                        const myEntry = ranked.find((r) => r.competitor.id === me.id);
                        if (myEntry) {
                            set({ pendingRewards: { league: state.currentArena.league, finalRank: myEntry.rank } });
                        }
                    }
                }
            },

            consumeAttempt: () => {
                const state = get();
                if (state.dailyAttempts.day !== todayIso()) {
                    set({ dailyAttempts: { day: todayIso(), count: 1 } });
                    return true;
                }
                if (state.dailyAttempts.count >= ARENA_DAILY_ATTEMPTS) return false;
                set({ dailyAttempts: { day: state.dailyAttempts.day, count: state.dailyAttempts.count + 1 } });
                return true;
            },

            attemptsRemaining: () => {
                const state = get();
                if (state.dailyAttempts.day !== todayIso()) return ARENA_DAILY_ATTEMPTS;
                return Math.max(0, ARENA_DAILY_ATTEMPTS - state.dailyAttempts.count);
            },

            submitDefenseSnapshot: () => {
                const char = useCharacterStore.getState().character;
                if (!char) return;
                const eff = getEffectiveChar(char);
                const slots = useSkillStore.getState().activeSkillSlots;
                const snap: IArenaDefenseSnapshot = {
                    maxHp:    eff?.max_hp ?? char.max_hp,
                    maxMp:    eff?.max_mp ?? char.max_mp,
                    attack:   eff?.attack ?? char.attack,
                    defense:  eff?.defense ?? char.defense,
                    skillSlots: [...slots] as Array<string | null>,
                    snapshotAt: new Date().toISOString(),
                };
                set({ defenseSnapshot: snap });
                const arena = get().currentArena;
                if (arena) {
                    const myId = `player_${char.id ?? 'me'}`;
                    const next = {
                        ...arena,
                        competitors: arena.competitors.map((c) =>
                            c.id === myId ? { ...c, defense: snap, level: char.level } : c,
                        ),
                    };
                    set({ currentArena: next });
                }
            },

            finalizeMatch: ({ myCompetitorId, opponentId, attackerWon, attackerIsHigher, opponentName, opponentClass, opponentLevel }) => {
                const reward = getMatchReward(attackerWon, attackerIsHigher);
                const arena = get().currentArena;
                if (!arena) {
                    return {
                        attackerAp: reward.attacker.arenaPoints,
                        attackerLp: reward.attacker.leaguePoints,
                        defenderAp: reward.defender.arenaPoints,
                        defenderLp: reward.defender.leaguePoints,
                    };
                }

                const nowIso = new Date().toISOString();
                const updated: IArenaInstance = {
                    ...arena,
                    competitors: arena.competitors.map((c) => {
                        if (c.id === myCompetitorId) {
                            const lpDelta = reward.attacker.leaguePoints;
                            return {
                                ...c,
                                seasonArenaPoints: c.seasonArenaPoints + reward.attacker.arenaPoints,
                                leaguePoints:      c.leaguePoints      + lpDelta,
                                leaguePointsAchievedAt: lpDelta > 0 ? nowIso : c.leaguePointsAchievedAt,
                            };
                        }
                        if (c.id === opponentId) {
                            const lpDelta = reward.defender.leaguePoints;
                            return {
                                ...c,
                                seasonArenaPoints: c.seasonArenaPoints + reward.defender.arenaPoints,
                                leaguePoints:      c.leaguePoints      + lpDelta,
                                leaguePointsAchievedAt: lpDelta > 0 ? nowIso : c.leaguePointsAchievedAt,
                            };
                        }
                        return c;
                    }),
                };

                const localGain = reward.attacker.arenaPoints;
                if (localGain > 0) {
                    useInventoryStore.getState().addArenaPoints?.(localGain);
                }

                const log: IArenaMatchLogEntry = {
                    id: `match_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                    at: new Date().toISOString(),
                    role: 'attacker',
                    opponentName,
                    opponentClass,
                    opponentLevel,
                    won: attackerWon,
                    arenaPointsDelta: reward.attacker.arenaPoints,
                    leaguePointsDelta: reward.attacker.leaguePoints,
                };
                set((s) => ({
                    currentArena: updated,
                    matchLog: [log, ...s.matchLog].slice(0, MATCH_LOG_MAX),
                    stats: {
                        matchesWon: s.stats.matchesWon + (attackerWon ? 1 : 0),
                        matchesDefended: s.stats.matchesDefended,
                    },
                }));

                const myComp = updated.competitors.find((c) => c.id === myCompetitorId);
                if (myComp && myCompetitorId.startsWith('player_')) {
                    const realCharId = myCompetitorId.slice('player_'.length);
                    void import('../api/v1/characterApi').then(({ characterApi }) => {
                        void characterApi.bumpArenaStats({
                            characterId: realCharId,
                            winDelta: attackerWon ? 1 : 0,
                            lossDelta: attackerWon ? 0 : 1,
                            league: updated.league,
                            leaguePoints: myComp.leaguePoints,
                        }).catch(() => { });

                        let opCharId: string | null = null;
                        if (opponentId.startsWith('player_')) {
                            opCharId = opponentId.slice('player_'.length);
                        } else if (opponentId.startsWith('alt_')) {
                            opCharId = opponentId.slice('alt_'.length);
                        }
                        if (opCharId) {
                            if (attackerWon) {
                                void characterApi.bumpArenaDeathRpc(opCharId);
                            } else {
                                void characterApi.bumpArenaKillRpc(opCharId);
                            }
                        }
                    }).catch(() => { });
                }

                return {
                    attackerAp: reward.attacker.arenaPoints,
                    attackerLp: reward.attacker.leaguePoints,
                    defenderAp: reward.defender.arenaPoints,
                    defenderLp: reward.defender.leaguePoints,
                };
            },

            claimSeasonRewards: () => {
                const state = get();
                const pending = state.pendingRewards;
                if (!pending) return null;
                const bucket = findRewardBucket(pending.finalRank);
                if (bucket) {
                    const scaled = applyLeagueMultiplier(bucket, pending.league);
                    const inv = useInventoryStore.getState();
                    inv.addGold(scaled.gold);
                    inv.addArenaPoints?.(scaled.arenaPoints);
                    if (scaled.commonStones    > 0) inv.addStones?.('common_stone',    scaled.commonStones);
                    if (scaled.rareStones      > 0) inv.addStones?.('rare_stone',      scaled.rareStones);
                    if (scaled.epicStones      > 0) inv.addStones?.('epic_stone',      scaled.epicStones);
                    if (scaled.legendaryStones > 0) inv.addStones?.('legendary_stone', scaled.legendaryStones);
                    if (scaled.mythicStones    > 0) inv.addStones?.('mythic_stone',    scaled.mythicStones);
                    if (scaled.pctHpPotion     > 0) inv.addConsumable('hp_potion_divine', scaled.pctHpPotion);
                    if (scaled.pctMpPotion     > 0) inv.addConsumable('mp_potion_divine', scaled.pctMpPotion);
                }

                const outcome = getSeasonOutcome(pending.league, pending.finalRank);
                let newLeague: ArenaLeague = state.currentArena?.league ?? pending.league;
                if (outcome.type === 'promote') newLeague = outcome.toLeague;
                else if (outcome.type === 'relegate') newLeague = outcome.toLeague;
                const playerLevel = useCharacterStore.getState().character?.level ?? 1;

                set({
                    pendingRewards: null,
                    currentArena: buildFreshArena(newLeague, playerLevel),
                    seasonStartIso: getSeasonStart().toISOString(),
                    matchLog: [],
                    stats: { matchesWon: 0, matchesDefended: 0 },
                });
                return pending;
            },

            injectOtherPlayers: (alts) => {
                const state = get();
                if (!state.currentArena || alts.length === 0) return;
                const activePlayerId = useCharacterStore.getState().character?.id;
                const filtered = alts.filter((c) => c.id !== activePlayerId);
                if (filtered.length === 0) return;

                const presentIds = new Set(state.currentArena.competitors.map((c) => c.id));
                const fresh = filtered.filter((c) => !presentIds.has(`alt_${c.id}`));
                if (fresh.length === 0) return;

                const readAltTransforms = (charId: string): number[] => {
                    try {
                        const raw = localStorage.getItem(`dungeon_rpg_save_char_${charId}`);
                        if (!raw) return [];
                        const parsed = JSON.parse(raw) as { state?: { transforms?: { completedTransforms?: unknown } } };
                        const arr = parsed?.state?.transforms?.completedTransforms;
                        if (!Array.isArray(arr)) return [];
                        return arr.filter((n): n is number => typeof n === 'number');
                    } catch {
                        return [];
                    }
                };

                const nowIso = new Date().toISOString();
                const altCompetitors: IArenaCompetitor[] = fresh.map((c) => ({
                    id: `alt_${c.id}`,
                    name: c.name,
                    class: c.class,
                    level: c.level,
                    color: '#888',
                    leaguePoints: 0,
                    leaguePointsAchievedAt: nowIso,
                    seasonArenaPoints: 0,
                    isBot: false,
                    completedTransforms: readAltTransforms(c.id),
                    defense: {
                        maxHp: c.max_hp,
                        maxMp: c.max_mp,
                        attack: c.attack,
                        defense: c.defense,
                        skillSlots: [null, null, null, null],
                        snapshotAt: new Date().toISOString(),
                    },
                }));

                const competitors = [...state.currentArena.competitors];
                const botIndices = competitors
                    .map((c, idx) => ({ c, idx }))
                    .filter(({ c }) => c.isBot)
                    .sort((a, b) => a.c.leaguePoints - b.c.leaguePoints);
                const toDrop = Math.min(altCompetitors.length, botIndices.length);
                const dropSet = new Set(botIndices.slice(0, toDrop).map((b) => b.idx));
                const trimmed = competitors.filter((_, idx) => !dropSet.has(idx));
                const next: IArenaInstance = {
                    ...state.currentArena,
                    competitors: [...trimmed, ...altCompetitors],
                };
                set({ currentArena: next });
            },
        }),
        {
            name: 'arena-store',
            partialize: (state): Partial<IArenaState> => ({
                currentArena:    state.currentArena,
                seasonStartIso:  state.seasonStartIso,
                dailyAttempts:   state.dailyAttempts,
                defenseSnapshot: state.defenseSnapshot,
                matchLog:        state.matchLog,
                pendingRewards:  state.pendingRewards,
                stats:           state.stats,
            }),
        },
    ),
);

void ARENA_LEAGUES;
