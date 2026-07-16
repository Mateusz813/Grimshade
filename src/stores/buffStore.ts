import { create } from 'zustand';
import { useCharacterStore } from './characterStore';


export type BuffTimerMode = 'realtime' | 'pausable' | 'game';

export interface IActiveBuff {
    id: string;
    characterId: string;
    name: string;
    icon: string;
    effect: string;
    expiresAt: number;
    timerMode: BuffTimerMode;
    remainingMs: number;
    charges?: number;
    maxCharges?: number;
    gameMsRemaining?: number;
    healPctPerSec?: number;
}

interface IBuffStore {
    allBuffs: IActiveBuff[];
    combatSpeedMult: number;
    setCombatSpeedMult: (mult: number) => void;
    addBuff: (buff: Omit<IActiveBuff, 'expiresAt' | 'characterId' | 'timerMode' | 'remainingMs'>, durationMs: number) => void;
    addPausableBuff: (buff: Omit<IActiveBuff, 'expiresAt' | 'characterId' | 'timerMode' | 'remainingMs'>, durationMs: number) => void;
    addBuffGameTime: (
        buff: Omit<IActiveBuff, 'expiresAt' | 'characterId' | 'timerMode' | 'remainingMs' | 'gameMsRemaining'>,
        gameDurationMs: number,
        payload?: { healPctPerSec?: number },
    ) => void;
    getPartyHealDotPctPerSec: () => number;
    getPartyHealDotSkillId: () => string | null;
    tickGameTimeBuffs: (wallDeltaMs: number, speedMult: number) => void;
    addChargeBuff: (
        buff: Omit<IActiveBuff, 'expiresAt' | 'characterId' | 'timerMode' | 'remainingMs' | 'charges' | 'maxCharges'>,
        chargesToAdd: number,
        maxCharges: number,
    ) => void;
    consumeBuffCharge: (effect: string) => boolean;
    rebaseRealtimeBuffsSpeed: (oldSpeed: number, newSpeed: number) => void;
    getBuffCharges: (effect: string) => number;
    removeBuff: (id: string) => void;
    removeBuffByEffect: (effect: string) => void;
    cleanExpired: () => void;
    hasBuff: (effect: string) => boolean;
    getBuffMultiplier: (effect: string) => number;
    getXpBoostMultiplier: () => number;
    getSkillXpBoostMultiplier: () => number;
    getActiveBuffs: () => IActiveBuff[];
    clearCharacterBuffs: () => void;
    consumePausableTime: (effect: string, ms: number) => number;
    getPausableRemaining: (effect: string) => number;
}

const getCharId = (): string => useCharacterStore.getState().character?.id ?? '';

const ATK_DMG_TIERS = ['atk_dmg_100', 'atk_dmg_50', 'atk_dmg_25'];
const SPELL_DMG_TIERS = ['spell_dmg_100', 'spell_dmg_50', 'spell_dmg_25'];
const XP_BOOST_TIERS = ['xp_boost_100', 'xp_boost'];
const SKILL_XP_BOOST_TIERS = ['skill_xp_boost_100', 'skill_xp_boost'];

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
                        expiresAt = existing.expiresAt + durationMs;
                    } else {
                        expiresAt = Date.now() + durationMs;
                    }
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

            getXpBoostMultiplier: () => {
                const base = get().hasBuff('xp_boost_100') ? 2.0 : get().hasBuff('xp_boost') ? 1.5 : 1;
                const premium = get().hasBuff('premium_xp_boost') ? 2.0 : 1;
                return base * premium;
            },

            getSkillXpBoostMultiplier: () => (
                get().hasBuff('skill_xp_boost_100') ? 2.0 : get().hasBuff('skill_xp_boost') ? 1.5 : 1
            ),

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
