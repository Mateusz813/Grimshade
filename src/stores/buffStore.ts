import { create } from 'zustand';
import { useCharacterStore } from './characterStore';

// ── Buff types ───────────────────────────────────────────────────────────────

/**
 * 'realtime'  – expiresAt counts down in real time (elixirs, AOL, etc.)
 *               — wall-clock, never speed-scales.
 * 'pausable'  – remainingMs only ticks down when explicitly consumed via
 *               `consumePausableTime`. The buff never expires on its own.
 * 'game'      – `gameMsRemaining` ticks at speed-scaled rate via
 *               `tickGameTimeBuffs(wallDelta, speedMult)`. Used for skill
 *               buffs (Tarcza Many, party_attack_up, etc.) so a 20s buff
 *               drains in 5 wall seconds at x4. Display is "game-time"
 *               seconds (always shows 20→0 on a 20s spec, regardless of
 *               speed).
 */
export type BuffTimerMode = 'realtime' | 'pausable' | 'game';

export interface IActiveBuff {
    id: string;
    characterId: string;
    name: string;
    icon: string;
    effect: string;
    /** For realtime buffs: unix timestamp (ms) when the buff expires. */
    expiresAt: number;
    /** Timer mode – defaults to 'realtime' for backwards compat. */
    timerMode: BuffTimerMode;
    /**
     * For pausable buffs: remaining duration in ms.
     * Decremented only via consumePausableTime().
     * When it reaches 0 the buff is removed.
     */
    remainingMs: number;
    /**
     * 2026-05 v6: charge-based buffs (Krok Cienia / Klon Cienia / next-N
     * effect family). When set, BuffBar renders "×N" instead of a timer
     * and `consumeBuffCharge(effect)` decrements by 1. Buff is removed
     * when charges hits 0. Re-casting the same buff stacks charges up
     * to `maxCharges` (so spamming Krok Cienia banks dodges instead of
     * refreshing a fixed count).
     */
    charges?: number;
    maxCharges?: number;
    /**
     * 2026-05 v6: game-time buffs use this counter (in ms). Drained by
     * `tickGameTimeBuffs(wallDelta, speedMult)` at speed-scaled rate so
     * a 20s spec drains in 20 wall-seconds at x1, 10s at x2, 5s at x4.
     * BuffBar always displays the remaining VALUE (not wall time) so
     * the player sees "20s → 0s" regardless of speed.
     */
    gameMsRemaining?: number;
    /**
     * Heal-over-time payload (Cleric Błogosławieństwo
     * `heal_party_dot:dur:pctPerSec`). When set, the centralised
     * TopHeader tick applies `pctPerSec/100 × wallDelta/1000` of the
     * player's max HP every tick (scaled by combatSpeedMult). Combat
     * views read it too via `getPartyHealDotPctPerSec()` to also tick
     * heal on bots / raid members. Lives on the buff so multiple
     * sources / refreshes naturally take the strongest tier.
     */
    healPctPerSec?: number;
}

interface IBuffStore {
    allBuffs: IActiveBuff[];
    /**
     * Live combat speed multiplier. Combat views call `setCombatSpeedMult`
     * when they mount / change speed; out of combat it's 1 so game-time
     * skill buffs drain at real time (Zaklęcie Apokalipsy / Berserk
     * keep counting down even when the player walks away from combat).
     */
    combatSpeedMult: number;
    setCombatSpeedMult: (mult: number) => void;
    /**
     * Add a realtime buff (standard behaviour, ticks down in wall-clock time).
     * If a buff with the same effect already exists for this character,
     * the duration is STACKED (added on top of existing remaining time).
     */
    addBuff: (buff: Omit<IActiveBuff, 'expiresAt' | 'characterId' | 'timerMode' | 'remainingMs'>, durationMs: number) => void;
    /**
     * Add a pausable buff whose timer only decreases when you call
     * consumePausableTime(). Duration stacks if the same effect exists.
     */
    addPausableBuff: (buff: Omit<IActiveBuff, 'expiresAt' | 'characterId' | 'timerMode' | 'remainingMs'>, durationMs: number) => void;
    /**
     * Add a game-time buff. `gameDurationMs` is the spec'd in-game
     * duration (e.g. 20000 for a 20s skill buff). Speed-scaling happens
     * during `tickGameTimeBuffs`, NOT at cast time, so re-casting at a
     * different speed doesn't mangle the timer.
     *
     * `payload.healPctPerSec` (optional) attaches a heal-over-time tick
     * spec — Cleric Błogosławieństwo registers `heal_party_dot:10000:5`
     * with `healPctPerSec: 5` so the TopHeader tick can apply the regen.
     */
    addBuffGameTime: (
        buff: Omit<IActiveBuff, 'expiresAt' | 'characterId' | 'timerMode' | 'remainingMs' | 'gameMsRemaining'>,
        gameDurationMs: number,
        payload?: { healPctPerSec?: number },
    ) => void;
    /**
     * Live max heal-pct/sec across all active heal_party_dot buffs for
     * the local character. 0 when no Błogosławieństwo / similar buff
     * is active. Read by TopHeader's tick (always running) and by each
     * combat view's tick (so bots / raid members regen too).
     */
    getPartyHealDotPctPerSec: () => number;
    /**
     * Skill id of the strongest active heal_party_dot buff (matches
     * the buff returning the max pct/sec from
     * `getPartyHealDotPctPerSec`). Combat views feed it into
     * `triggerAllySkillAnim` so each per-second pulse plays the
     * spell's themed animation overlay (Blessing → 🙏 holy) on every
     * ally slot. Returns null when no such buff is active.
     */
    getPartyHealDotSkillId: () => string | null;
    /**
     * Drain every game-time buff by `wallDeltaMs × speedMult` so 1 real
     * second at x4 burns 4 game-seconds. Combat views call this from
     * their tick intervals (250 ms wall) with the current speed mult.
     * No-op when there are no game-time buffs.
     */
    tickGameTimeBuffs: (wallDeltaMs: number, speedMult: number) => void;
    /**
     * Add (or stack) a charge-based buff. Re-casting stacks `charges` up
     * to `maxCharges`. Idempotent on max — a 6/6 buff stays at 6 even if
     * the player keeps casting. Use `consumeBuffCharge(effect)` to spend
     * one charge per enemy hit (or whatever trigger). Buff auto-removes
     * when charges hits 0.
     */
    addChargeBuff: (
        buff: Omit<IActiveBuff, 'expiresAt' | 'characterId' | 'timerMode' | 'remainingMs' | 'charges' | 'maxCharges'>,
        chargesToAdd: number,
        maxCharges: number,
    ) => void;
    /** Decrement a charge buff by 1. Removes the buff when charges = 0.
     *  Returns true when a charge was consumed (i.e. the dodge fires). */
    consumeBuffCharge: (effect: string) => boolean;
    /**
     * Rescale every active realtime buff's `expiresAt` when combat speed
     * changes. Maps remaining wall-clock time so the buff drains at the
     * new game-time rate going forward. Example:
     *   • Cast 15s buff at x1 → expires 15s wall later
     *   • Switch to x4 → rebase: remaining 15s wall × (1/4) = 3.75s wall
     *   • Switch back to x1 → rebase: remaining 3.75s × (4/1) = 15s
     * Skips pausable buffs (elixirs / charge buffs) — those are wall-time
     * by design (an XP boost shouldn't drain faster just because the
     * player switched to x4 in trainer).
     */
    rebaseRealtimeBuffsSpeed: (oldSpeed: number, newSpeed: number) => void;
    /** Read the current charge count for a charge buff (0 when missing). */
    getBuffCharges: (effect: string) => number;
    removeBuff: (id: string) => void;
    removeBuffByEffect: (effect: string) => void;
    cleanExpired: () => void;
    hasBuff: (effect: string) => boolean;
    getBuffMultiplier: (effect: string) => number;
    getActiveBuffs: () => IActiveBuff[];
    clearCharacterBuffs: () => void;
    /**
     * Consume time from a pausable buff. Returns the actual ms consumed
     * (may be less than requested if the buff ran out).
     * When remainingMs reaches 0 the buff is automatically removed.
     */
    consumePausableTime: (effect: string, ms: number) => number;
    /** Get remaining ms for a pausable buff (0 if not active). */
    getPausableRemaining: (effect: string) => number;
}

const getCharId = (): string => useCharacterStore.getState().character?.id ?? '';

// ── Mutually-exclusive buff groups ──────────────────────────────────────────
// Some elixirs belong to a logical "category" where only one tier may be
// active at a time (e.g. ATK damage tiers 25/50/100 + flat +50 ATK should be
// mutually exclusive — picking a stronger one replaces the weaker one).
//
// Returns the list of OTHER effects in the same group that must be removed
// before the new buff is added (excludes the incoming effect itself — that
// is handled separately by the same-effect dedup in addPausableBuff/addBuff).
// 2026-05-08: per spec the player CAN have I/II/III active at the same
// time — they don't stack their multipliers, but the higher tier just
// "covers" the lower until it expires. So we no longer hard-mutex the
// buff groups; instead the damage helpers pick the highest active tier
// (already do via if-else cascade) and `tickCombatElixirs` only drains
// the highest active tier per group so the lower tiers preserve full
// duration until they're actually used.
const ATK_DMG_TIERS = ['atk_dmg_100', 'atk_dmg_50', 'atk_dmg_25'];
const SPELL_DMG_TIERS = ['spell_dmg_100', 'spell_dmg_50', 'spell_dmg_25'];
const XP_BOOST_TIERS = ['xp_boost_100', 'xp_boost'];
const SKILL_XP_BOOST_TIERS = ['skill_xp_boost_100', 'skill_xp_boost'];

/** Lookup helper: which tier-group does this effect belong to (or null)? */
export const getBuffTierGroup = (effect: string): string[] | null => {
    if (ATK_DMG_TIERS.includes(effect)) return ATK_DMG_TIERS;
    if (SPELL_DMG_TIERS.includes(effect)) return SPELL_DMG_TIERS;
    if (XP_BOOST_TIERS.includes(effect)) return XP_BOOST_TIERS;
    if (SKILL_XP_BOOST_TIERS.includes(effect)) return SKILL_XP_BOOST_TIERS;
    return null;
};

const getMutexEffects = (_effect: string): string[] => {
    void _effect;
    return [];
};

export const useBuffStore = create<IBuffStore>()(
        (set, get) => ({
            allBuffs: [],
            combatSpeedMult: 1,
            setCombatSpeedMult: (mult) => set({ combatSpeedMult: Math.max(1, mult) }),

            addBuff: (buff, durationMs) => {
                const charId = getCharId();
                if (!charId) {
                    console.warn('[BuffStore] addBuff failed: no character ID. Buff not added:', buff.id);
                    return;
                }
                set((s) => {
                    const existing = s.allBuffs.find(
                        (b) => b.characterId === charId && b.effect === buff.effect && b.timerMode === 'realtime',
                    );
                    let expiresAt: number;
                    if (existing && existing.expiresAt > Date.now()) {
                        // Stack duration on top of existing remaining time
                        expiresAt = existing.expiresAt + durationMs;
                    } else {
                        expiresAt = Date.now() + durationMs;
                    }
                    // Drop same-effect dupes AND any mutually-exclusive sibling effects.
                    const mutex = getMutexEffects(buff.effect);
                    return {
                        allBuffs: [
                            ...s.allBuffs.filter((b) => !(b.characterId === charId && (b.effect === buff.effect || mutex.includes(b.effect)))),
                            { ...buff, characterId: charId, expiresAt, timerMode: 'realtime' as BuffTimerMode, remainingMs: 0 },
                        ],
                    };
                });
            },

            addPausableBuff: (buff, durationMs) => {
                const charId = getCharId();
                if (!charId) {
                    console.warn('[BuffStore] addPausableBuff failed: no character ID.');
                    return;
                }
                set((s) => {
                    const existing = s.allBuffs.find(
                        (b) => b.characterId === charId && b.effect === buff.effect && b.timerMode === 'pausable',
                    );
                    const newRemaining = (existing ? existing.remainingMs : 0) + durationMs;
                    // Drop same-effect dupes AND any mutually-exclusive sibling effects
                    // (e.g. activating ATK +100% removes any active ATK +25/50% and +50 flat ATK).
                    const mutex = getMutexEffects(buff.effect);
                    return {
                        allBuffs: [
                            ...s.allBuffs.filter((b) => !(b.characterId === charId && (b.effect === buff.effect || mutex.includes(b.effect)))),
                            {
                                ...buff,
                                characterId: charId,
                                expiresAt: Infinity,
                                timerMode: 'pausable' as BuffTimerMode,
                                remainingMs: newRemaining,
                            },
                        ],
                    };
                });
            },

            // 2026-05 v6: game-time buff (Tarcza Many, party_attack_up,
            // attack_up, dodge_buff, immortal, etc.). Stores spec'd
            // duration in `gameMsRemaining` and lets `tickGameTimeBuffs`
            // drain it at speed-scaled rate. Re-cast: max(remaining, new)
            // so it never shrinks if you re-pop early.
            addBuffGameTime: (buff, gameDurationMs, payload) => {
                const charId = getCharId();
                if (!charId || gameDurationMs <= 0) return;
                set((s) => {
                    const existing = s.allBuffs.find(
                        (b) => b.characterId === charId && b.effect === buff.effect && b.timerMode === 'game',
                    );
                    const newRem = Math.max(existing?.gameMsRemaining ?? 0, gameDurationMs);
                    const mutex = getMutexEffects(buff.effect);
                    return {
                        allBuffs: [
                            ...s.allBuffs.filter((b) => !(b.characterId === charId && (b.effect === buff.effect || mutex.includes(b.effect)))),
                            {
                                ...buff,
                                characterId: charId,
                                expiresAt: Number.POSITIVE_INFINITY,
                                timerMode: 'game' as BuffTimerMode,
                                remainingMs: 0,
                                gameMsRemaining: newRem,
                                healPctPerSec: payload?.healPctPerSec,
                            },
                        ],
                    };
                });
            },

            getPartyHealDotPctPerSec: () => {
                const charId = getCharId();
                if (!charId) return 0;
                let max = 0;
                for (const b of get().allBuffs) {
                    if (b.characterId !== charId) continue;
                    if (b.timerMode !== 'game') continue;
                    if ((b.gameMsRemaining ?? 0) <= 0) continue;
                    const pct = b.healPctPerSec ?? 0;
                    if (pct > max) max = pct;
                }
                return max;
            },

            getPartyHealDotSkillId: () => {
                const charId = getCharId();
                if (!charId) return null;
                let bestPct = 0;
                let bestId: string | null = null;
                for (const b of get().allBuffs) {
                    if (b.characterId !== charId) continue;
                    if (b.timerMode !== 'game') continue;
                    if ((b.gameMsRemaining ?? 0) <= 0) continue;
                    const pct = b.healPctPerSec ?? 0;
                    if (pct <= 0) continue;
                    if (pct < bestPct) continue;
                    // Buff id schema: `skill_buff_<skillId>_<atomIdx>`.
                    // Extract the middle segment so the animation hook
                    // can pull the right per-class artwork.
                    const m = /^skill_buff_(.+)_(\d+)$/.exec(b.id);
                    if (m) {
                        bestPct = pct;
                        bestId = m[1];
                    }
                }
                return bestId;
            },

            tickGameTimeBuffs: (wallDeltaMs, speedMult) => {
                if (wallDeltaMs <= 0) return;
                const drain = wallDeltaMs * Math.max(1, speedMult);
                set((s) => {
                    let dirty = false;
                    const next = s.allBuffs.flatMap((b) => {
                        if (b.timerMode !== 'game') return [b];
                        const left = (b.gameMsRemaining ?? 0) - drain;
                        if (left <= 0) { dirty = true; return []; }
                        if (left !== b.gameMsRemaining) dirty = true;
                        return [{ ...b, gameMsRemaining: left }];
                    });
                    return dirty ? { allBuffs: next } : s;
                });
            },

            addChargeBuff: (buff, chargesToAdd, maxCharges) => {
                const charId = getCharId();
                if (!charId) return;
                set((s) => {
                    const existing = s.allBuffs.find(
                        (b) => b.characterId === charId && b.effect === buff.effect && (b.charges ?? 0) > 0,
                    );
                    const cap = Math.max(1, maxCharges);
                    const next = Math.min(cap, (existing?.charges ?? 0) + chargesToAdd);
                    return {
                        allBuffs: [
                            ...s.allBuffs.filter((b) => !(b.characterId === charId && b.effect === buff.effect)),
                            {
                                ...buff,
                                characterId: charId,
                                expiresAt: Number.POSITIVE_INFINITY,
                                timerMode: 'pausable' as BuffTimerMode,
                                remainingMs: 0,
                                charges: next,
                                maxCharges: cap,
                            },
                        ],
                    };
                });
            },

            consumeBuffCharge: (effect) => {
                const charId = getCharId();
                if (!charId) return false;
                let consumed = false;
                set((s) => {
                    const next = s.allBuffs.flatMap((b) => {
                        if (b.characterId !== charId || b.effect !== effect) return [b];
                        const left = (b.charges ?? 0) - 1;
                        if (left <= 0) { consumed = true; return []; }
                        consumed = true;
                        return [{ ...b, charges: left }];
                    });
                    return { allBuffs: next };
                });
                return consumed;
            },

            getBuffCharges: (effect) => {
                const charId = getCharId();
                if (!charId) return 0;
                const b = get().allBuffs.find((x) => x.characterId === charId && x.effect === effect);
                return b?.charges ?? 0;
            },

            rebaseRealtimeBuffsSpeed: (oldSpeed, newSpeed) => {
                if (oldSpeed === newSpeed || oldSpeed <= 0 || newSpeed <= 0) return;
                const charId = getCharId();
                if (!charId) return;
                const now = Date.now();
                const ratio = oldSpeed / newSpeed;
                set((s) => ({
                    allBuffs: s.allBuffs.map((b) => {
                        // Only rebase realtime buffs for the active char.
                        // Charge buffs (charges > 0) and pausable buffs
                        // (elixirs) are wall-time by design.
                        if (b.characterId !== charId) return b;
                        if (b.timerMode !== 'realtime') return b;
                        if ((b.charges ?? 0) > 0) return b;
                        const remaining = Math.max(0, b.expiresAt - now);
                        return { ...b, expiresAt: now + Math.round(remaining * ratio) };
                    }),
                }));
            },

            removeBuff: (id) => {
                set((s) => ({
                    allBuffs: s.allBuffs.filter((b) => b.id !== id),
                }));
            },

            removeBuffByEffect: (effect) => {
                const charId = getCharId();
                set((s) => ({
                    allBuffs: s.allBuffs.filter((b) => !(b.characterId === charId && b.effect === effect)),
                }));
            },

            cleanExpired: () => {
                const now = Date.now();
                set((s) => ({
                    allBuffs: s.allBuffs.filter((b) => {
                        // Charge buffs survive cleanup as long as they
                        // still have charges left — they don't expire on
                        // a clock, only when consumed.
                        if ((b.charges ?? 0) > 0) return true;
                        if (b.timerMode === 'game') return (b.gameMsRemaining ?? 0) > 0;
                        if (b.timerMode === 'pausable') return b.remainingMs > 0;
                        return b.expiresAt > now;
                    }),
                }));
            },

            hasBuff: (effect) => {
                const charId = getCharId();
                const now = Date.now();
                return get().allBuffs.some((b) => {
                    if (b.characterId !== charId || b.effect !== effect) return false;
                    if ((b.charges ?? 0) > 0) return true;
                    if (b.timerMode === 'game') return (b.gameMsRemaining ?? 0) > 0;
                    if (b.timerMode === 'pausable') return b.remainingMs > 0;
                    return b.expiresAt > now;
                });
            },

            getBuffMultiplier: (effect) => {
                if (!get().hasBuff(effect)) return 1;
                if (effect === 'xp_boost') return 1.5;
                if (effect === 'xp_boost_100') return 2.0;
                if (effect === 'premium_xp_boost') return 2.0;
                if (effect === 'skill_xp_boost') return 1.5;
                if (effect === 'skill_xp_boost_100') return 2.0;
                if (effect === 'attack_speed') return 1.2;
                if (effect === 'cooldown_reduction') return 0.8;
                if (effect === 'offline_training_boost') return 2.0;
                return 1;
            },

            getActiveBuffs: () => {
                const charId = getCharId();
                const now = Date.now();
                return get().allBuffs.filter((b) => {
                    if (b.characterId !== charId) return false;
                    if ((b.charges ?? 0) > 0) return true;
                    if (b.timerMode === 'game') return (b.gameMsRemaining ?? 0) > 0;
                    if (b.timerMode === 'pausable') return b.remainingMs > 0;
                    return b.expiresAt > now;
                });
            },

            clearCharacterBuffs: () => {
                const charId = getCharId();
                set((s) => ({
                    allBuffs: s.allBuffs.filter((b) => b.characterId !== charId),
                }));
            },

            consumePausableTime: (effect, ms) => {
                const charId = getCharId();
                const state = get();
                const buff = state.allBuffs.find(
                    (b) => b.characterId === charId && b.effect === effect && b.timerMode === 'pausable' && b.remainingMs > 0,
                );
                if (!buff) return 0;
                const consumed = Math.min(ms, buff.remainingMs);
                const newRemaining = buff.remainingMs - consumed;
                set((s) => ({
                    allBuffs: newRemaining <= 0
                        ? s.allBuffs.filter((b) => b.id !== buff.id)
                        : s.allBuffs.map((b) => b.id === buff.id ? { ...b, remainingMs: newRemaining } : b),
                }));
                return consumed;
            },

            getPausableRemaining: (effect) => {
                const charId = getCharId();
                const buff = get().allBuffs.find(
                    (b) => b.characterId === charId && b.effect === effect && b.timerMode === 'pausable' && b.remainingMs > 0,
                );
                return buff?.remainingMs ?? 0;
            },
        }),
);
