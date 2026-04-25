import { create } from 'zustand';
import { useCharacterStore } from './characterStore';

// ── Buff types ───────────────────────────────────────────────────────────────

/**
 * 'realtime'  – expiresAt counts down in real time (standard buffs).
 * 'pausable'  – remainingMs only ticks down when explicitly consumed via
 *               `consumePausableTime`. The buff never expires on its own.
 */
export type BuffTimerMode = 'realtime' | 'pausable';

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
}

interface IBuffStore {
    allBuffs: IActiveBuff[];
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
const ATK_BUFF_GROUP = ['atk_dmg_25', 'atk_dmg_50', 'atk_dmg_100', 'atk_boost_50'];
const SPELL_BUFF_GROUP = ['spell_dmg_25', 'spell_dmg_50', 'spell_dmg_100'];

const getMutexEffects = (effect: string): string[] => {
    if (ATK_BUFF_GROUP.includes(effect)) {
        return ATK_BUFF_GROUP.filter((e) => e !== effect);
    }
    if (SPELL_BUFF_GROUP.includes(effect)) {
        return SPELL_BUFF_GROUP.filter((e) => e !== effect);
    }
    return [];
};

export const useBuffStore = create<IBuffStore>()(
        (set, get) => ({
            allBuffs: [],

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
                    if (b.timerMode === 'pausable') return b.remainingMs > 0;
                    return b.expiresAt > now;
                });
            },

            getBuffMultiplier: (effect) => {
                if (!get().hasBuff(effect)) return 1;
                if (effect === 'xp_boost') return 1.5;
                if (effect === 'premium_xp_boost') return 2.0;
                if (effect === 'skill_xp_boost') return 1.5;
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
