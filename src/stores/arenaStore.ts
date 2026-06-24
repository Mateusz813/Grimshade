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

// -- Types ------------------------------------------------------------------

interface IArenaState {
    /** The arena instance the player currently belongs to. Refreshed when
     *  the player promotes / relegates, or when a new season starts. */
    currentArena: IArenaInstance | null;
    /** ISO of the current season's start (Monday 00:00 UTC). When the
     *  next call to `refreshIfNeeded` sees a new Monday, the arena is
     *  rebuilt and any pending rewards from the previous season are
     *  staged for collection. */
    seasonStartIso: string | null;
    /** Day-keyed daily attempts counter. `{ day: 'YYYY-MM-DD', count }`. */
    dailyAttempts: { day: string; count: number };
    /** Defense snapshot the player has confirmed — what attackers see. */
    defenseSnapshot: IArenaDefenseSnapshot | null;
    /** Per-season attack history (max 100 entries). */
    matchLog: IArenaMatchLogEntry[];
    /** Pending reward bundle from last week's final standing — claimable
     *  Monday once via `claimSeasonRewards`. */
    pendingRewards: {
        league: ArenaLeague;
        finalRank: number;
    } | null;
    /** Stats counters used for the rankings tab. */
    stats: {
        matchesWon: number;
        matchesDefended: number;
    };
}

interface IArenaStore extends IArenaState {
    /**
     * Boot / hot-rebuild the player's arena — call from views before
     * reading. Idempotent: a no-op when `currentArena` is already set
     * for the active week and matches the player's league.
     */
    refreshIfNeeded: (playerLevel: number) => void;
    /** Bumps `dailyAttempts.count`; returns false when the daily cap is hit. */
    consumeAttempt: () => boolean;
    /** How many attacks remain today. */
    attemptsRemaining: () => number;
    /** Snapshot the player's CURRENT live combat stats and freeze them as
     *  the defense the next attacker will fight. */
    submitDefenseSnapshot: () => void;
    /** Apply a match result — bumps both competitors' AP / LP, writes
     *  the matching log entry, and (when the local player is the winner
     *  attacker) credits inventory arena points. */
    finalizeMatch: (params: {
        myCompetitorId: string;
        opponentId: string;
        attackerWon: boolean;
        attackerIsHigher: boolean;
        opponentName: string;
        opponentClass: import('../types/character').TCharacterClass;
        opponentLevel: number;
    }) => { attackerAp: number; attackerLp: number; defenderAp: number; defenderLp: number };
    /** Pull the pending reward bundle, apply it to inventory + arena
     *  points, and clear it from state. Returns the consumed bundle so
     *  the UI can show a summary popup. */
    claimSeasonRewards: () => { league: ArenaLeague; finalRank: number } | null;
    /** Replace bot competitors with the user's other characters. Per
     *  spec each player's roster of alts auto-joins their league, so the
     *  view fetches them async (Supabase) and dispatches this action.
     *  We pop the lowest-LP bots first to make room and slot the alts
     *  in their place — preserves the 100-competitor cap and keeps the
     *  skewed-LP curve roughly intact. */
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
    // Pull the active player's completed transforms straight from the
    // store so the leaderboard avatar reflects the current tier (cyan,
    // violet, gold, …) without needing a separate fetch in the view.
    let completedTransforms: number[] = [];
    try {
        const ts = useTransformStore.getState();
        if (Array.isArray(ts.completedTransforms)) {
            completedTransforms = ts.completedTransforms.filter((n): n is number => typeof n === 'number');
        }
    } catch {
        // store not initialised yet — leave empty.
    }
    return {
        id: `player_${characterId ?? char.id ?? 'me'}`,
        name: char.name,
        class: char.class,
        level,
        color: '#888',
        leaguePoints: 0,
        // Stamp the achievement clock at "right now" so a fresh-week
        // player sits BEHIND any bot that already had a higher LP at
        // arena-build time. `finalizeMatch` refreshes this every time
        // the player gains LP from a win.
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

                // Daily attempt rollover.
                if (state.dailyAttempts.day !== todayIso()) {
                    set({ dailyAttempts: { day: todayIso(), count: 0 } });
                }

                // First-ever run — no arena yet. Build one for the current season.
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

                // -- Season rolled over (weekly) -----------------------------------
                // 2026-06-23 FIX (BUG #1): do NOT rebuild/reset the arena here.
                // The player KEEPS their AP / LP / stats until they CLAIM the
                // season rewards — `claimSeasonRewards` performs the actual
                // reset + promotion/relegation ("reset z awansem PO odbiorze
                // nagród"). Previously the boundary rebuilt the arena and zeroed
                // seasonArenaPoints immediately, so a player who crossed the
                // Monday boundary before collecting saw "0 AP next day".
                //
                // We only SETTLE the final standing into a pending reward (once)
                // and leave `seasonStartIso` UN-advanced so the season stays
                // "ended, awaiting claim". `claimSeasonRewards` advances it.
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
                // Mirror into the live arena instance so opponents see the
                // updated defense immediately (no cross-tab sync needed).
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

                // Refresh `leaguePointsAchievedAt` only when LP actually
                // grows. The timestamp is the secondary tiebreak — keeping
                // it pinned to the first time the competitor reached its
                // current LP means a stable climb is rewarded over a
                // last-second arrival at the same score.
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

                // Local player gets the actual inventory credit. Bots' AP
                // pile is bookkeeping only.
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

                // 2026-05-19 v15 spec ("Dodać do rankingu arenę"):
                // mirror the player's current arena standing to the
                // Supabase `characters` row so the global leaderboard
                // can show them. Reads the just-updated local
                // competitor for LP / league, derives the actual
                // character id from the `player_${id}` prefix, and
                // fires a fire-and-forget patch.
                //
                // 2026-05-19 v18 ("Zabilem clerica i barda na arenie i
                // nie naliczyly im sie smierci w ofiarach"): also
                // bump the OPPONENT's arena_deaths / arena_kills
                // (whichever applies) via a SECURITY DEFINER RPC,
                // so the loser sees their death count climb on the
                // leaderboard. Skipped for bots (id prefix `bot_`).
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
                        }).catch(() => { /* offline / RLS */ });

                        // 2026-05-19 v19 spec ("Zaatakowalem na arenie
                        // przeciwnika i jak przegralem to on powinien
                        // miec zabojstw wiecej a nie naliczylo mu sie"
                        // + "To samo ze smierciami"): cross-player
                        // update for the opponent if they're a real
                        // character — either the local player (id
                        // prefix `player_`) or one of the account's
                        // other characters that's been injected as a
                        // competitor (id prefix `alt_`). Bots have
                        // `bot_` prefix and are skipped.
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
                    }).catch(() => { /* offline */ });
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
                // Give the season rewards. Top ranks have a bucket; low ranks may
                // have none — in that case we still fall through to the reset below
                // (a low finisher must NOT get stuck unable to start a new season).
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

                // 2026-06-23 FIX (BUG #1): the weekly reset + promotion/relegation
                // happens HERE — AFTER the player collects the season rewards —
                // not at the calendar boundary. Apply the league outcome, rebuild
                // a fresh arena (seasonArenaPoints / LP / stats reset to 0 for the
                // new season), and advance `seasonStartIso` to the current week.
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
                // Filter out the active player from the alt list — that
                // character is already in the arena via the player slot.
                const activePlayerId = useCharacterStore.getState().character?.id;
                const filtered = alts.filter((c) => c.id !== activePlayerId);
                if (filtered.length === 0) return;

                // De-duplicate: skip alts already in the arena (re-runs of
                // this action — e.g. on refresh — don't double-insert).
                const presentIds = new Set(state.currentArena.competitors.map((c) => c.id));
                const fresh = filtered.filter((c) => !presentIds.has(`alt_${c.id}`));
                if (fresh.length === 0) return;

                // Read each alt's transform progress from their per-char
                // localStorage save. The save key is
                // `dungeon_rpg_save_char_<id>` and the transform slice
                // lives at `state.transforms.completedTransforms`.
                // Reading sync from localStorage is fine here — the saves
                // are tiny and we only do this once per arena boot.
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

                // Build IArenaCompetitor entries from the alt characters.
                // The defense snapshot is generated from their CURRENT live
                // stats (saved to Supabase). League/season points start at
                // 0 — they'll accumulate through their own combat sessions.
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

                // Replace the lowest-LP bots so the alt list slots in
                // without exceeding 100 competitors. Sort bots ascending
                // by LP, drop as many as we need, then concat.
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
            // 2026-05-19 v20 spec ("Jak odswiezam strone to nie
            // zapisuja sie rzeczy zwiazane z arena to znaczy jak
            // zabije kogos dostaje 200AP i 2 LP i po refreshu
            // wszystko sie kasuje"): persist `currentArena` too.
            // The previous partialize excluded it under the
            // assumption that bots-from-seed should rebuild on
            // mount, but that wiped the local player's LP / AP
            // every refresh. `refreshIfNeeded` already gates on
            // seasonStartIso so the persisted arena is only
            // replaced when the season actually changes.
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

// Touch the league list so it isn't tree-shaken as unused (re-exported by views).
void ARENA_LEAGUES;
