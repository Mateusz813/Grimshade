import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useBuffStore, getBuffTierGroup, type IActiveBuff } from './buffStore';
import { useCharacterStore, type ICharacter } from './characterStore';


const makeChar = (overrides: Partial<ICharacter> = {}): ICharacter => ({
    id: 'char-1',
    user_id: 'user-1',
    name: 'Tester',
    class: 'Knight',
    level: 1,
    xp: 0,
    hp: 100,
    max_hp: 100,
    mp: 30,
    max_mp: 30,
    attack: 10,
    defense: 5,
    attack_speed: 2.0,
    crit_chance: 3,
    crit_damage: 150,
    magic_level: 0,
    hp_regen: 0,
    mp_regen: 0,
    gold: 0,
    stat_points: 0,
    highest_level: 1,
    equipment: {},
    created_at: '',
    updated_at: '',
    ...overrides,
} as ICharacter);

const makeBuff = (overrides: Partial<Omit<IActiveBuff,
    'expiresAt' | 'characterId' | 'timerMode' | 'remainingMs'
>> = {}) => ({
    id: 'buff-1',
    name: 'Test Buff',
    icon: 'sparkles',
    effect: 'xp_boost',
    ...overrides,
});

beforeEach(() => {
    useBuffStore.setState({ allBuffs: [], combatSpeedMult: 1 });
    useCharacterStore.setState({ character: makeChar(), isLoading: false });
});


describe('addBuff', () => {
    it('adds a realtime buff with expiresAt = now + durationMs', () => {
        const before = Date.now();
        useBuffStore.getState().addBuff(makeBuff(), 5000);
        const buffs = useBuffStore.getState().allBuffs;
        expect(buffs).toHaveLength(1);
        const b = buffs[0];
        expect(b.timerMode).toBe('realtime');
        expect(b.expiresAt).toBeGreaterThanOrEqual(before + 5000 - 50);
        expect(b.characterId).toBe('char-1');
    });

    it('warns and skips when no character is set', () => {
        useCharacterStore.setState({ character: null });
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        useBuffStore.getState().addBuff(makeBuff(), 5000);
        expect(useBuffStore.getState().allBuffs).toHaveLength(0);
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
    });

    it('stacks duration when re-adding the same effect', () => {
        useBuffStore.getState().addBuff(makeBuff(), 5000);
        const firstExpiry = useBuffStore.getState().allBuffs[0].expiresAt;
        useBuffStore.getState().addBuff(makeBuff(), 5000);
        const stacked = useBuffStore.getState().allBuffs;
        expect(stacked).toHaveLength(1);
        expect(stacked[0].expiresAt).toBeGreaterThanOrEqual(firstExpiry);
    });

    it('only stacks for the active character — other characters are untouched', () => {
        useBuffStore.getState().addBuff(makeBuff(), 5000);
        useCharacterStore.setState({ character: makeChar({ id: 'char-2' }) });
        useBuffStore.getState().addBuff(makeBuff({ id: 'buff-2' }), 1000);
        const all = useBuffStore.getState().allBuffs;
        expect(all).toHaveLength(2);
        const c1 = all.find((b) => b.characterId === 'char-1');
        const c2 = all.find((b) => b.characterId === 'char-2');
        expect(c1).toBeDefined();
        expect(c2).toBeDefined();
    });
});


describe('addPausableBuff', () => {
    it('stores remainingMs and timerMode=pausable', () => {
        useBuffStore.getState().addPausableBuff(
            makeBuff({ effect: 'offline_training_boost' }),
            60_000,
        );
        const buffs = useBuffStore.getState().allBuffs;
        expect(buffs).toHaveLength(1);
        expect(buffs[0].timerMode).toBe('pausable');
        expect(buffs[0].remainingMs).toBe(60_000);
    });

    it('stacks remainingMs when re-adding the same effect', () => {
        useBuffStore.getState().addPausableBuff(makeBuff({ effect: 'xp_boost' }), 30_000);
        useBuffStore.getState().addPausableBuff(makeBuff({ effect: 'xp_boost' }), 60_000);
        const buffs = useBuffStore.getState().allBuffs;
        expect(buffs).toHaveLength(1);
        expect(buffs[0].remainingMs).toBe(90_000);
    });
});


describe('addBuffGameTime', () => {
    it('stores game-time buff with gameMsRemaining', () => {
        useBuffStore.getState().addBuffGameTime(
            makeBuff({ effect: 'mana_shield' }),
            20_000,
        );
        const b = useBuffStore.getState().allBuffs[0];
        expect(b.timerMode).toBe('game');
        expect(b.gameMsRemaining).toBe(20_000);
    });

    it('re-cast picks max(existing, new) instead of replacing', () => {
        useBuffStore.getState().addBuffGameTime(makeBuff({ effect: 'mana_shield' }), 20_000);
        useBuffStore.getState().addBuffGameTime(makeBuff({ effect: 'mana_shield' }), 5_000);
        const buffs = useBuffStore.getState().allBuffs;
        expect(buffs).toHaveLength(1);
        expect(buffs[0].gameMsRemaining).toBe(20_000);
    });

    it('no-op when gameDurationMs <= 0', () => {
        useBuffStore.getState().addBuffGameTime(makeBuff({ effect: 'mana_shield' }), 0);
        expect(useBuffStore.getState().allBuffs).toHaveLength(0);
    });

    it('stores healPctPerSec payload when provided (e.g. Blessing)', () => {
        useBuffStore.getState().addBuffGameTime(
            makeBuff({ id: 'skill_buff_blessing_0', effect: 'heal_party_dot' }),
            10_000,
            { healPctPerSec: 5 },
        );
        const b = useBuffStore.getState().allBuffs[0];
        expect(b.healPctPerSec).toBe(5);
    });
});


describe('tickGameTimeBuffs', () => {
    it('drains gameMsRemaining at speed-scaled rate', () => {
        useBuffStore.getState().addBuffGameTime(makeBuff({ effect: 'mana_shield' }), 20_000);
        useBuffStore.getState().tickGameTimeBuffs(1_000, 4);
        const b = useBuffStore.getState().allBuffs[0];
        expect(b.gameMsRemaining).toBe(16_000);
    });

    it('removes the buff when gameMsRemaining hits 0', () => {
        useBuffStore.getState().addBuffGameTime(makeBuff({ effect: 'mana_shield' }), 1_000);
        useBuffStore.getState().tickGameTimeBuffs(2_000, 1);
        expect(useBuffStore.getState().allBuffs).toHaveLength(0);
    });

    it('is a no-op when wallDeltaMs <= 0', () => {
        useBuffStore.getState().addBuffGameTime(makeBuff({ effect: 'mana_shield' }), 5_000);
        useBuffStore.getState().tickGameTimeBuffs(0, 4);
        expect(useBuffStore.getState().allBuffs[0].gameMsRemaining).toBe(5_000);
    });
});


describe('addChargeBuff / consumeBuffCharge', () => {
    it('adds charges up to maxCharges', () => {
        useBuffStore.getState().addChargeBuff(makeBuff({ effect: 'shadow_step' }), 3, 6);
        expect(useBuffStore.getState().getBuffCharges('shadow_step')).toBe(3);
        useBuffStore.getState().addChargeBuff(makeBuff({ effect: 'shadow_step' }), 5, 6);
        expect(useBuffStore.getState().getBuffCharges('shadow_step')).toBe(6);
    });

    it('consumeBuffCharge decrements by 1 and returns true', () => {
        useBuffStore.getState().addChargeBuff(makeBuff({ effect: 'shadow_step' }), 3, 6);
        const ok = useBuffStore.getState().consumeBuffCharge('shadow_step');
        expect(ok).toBe(true);
        expect(useBuffStore.getState().getBuffCharges('shadow_step')).toBe(2);
    });

    it('consumeBuffCharge removes the buff when last charge runs out', () => {
        useBuffStore.getState().addChargeBuff(makeBuff({ effect: 'shadow_step' }), 1, 6);
        useBuffStore.getState().consumeBuffCharge('shadow_step');
        expect(useBuffStore.getState().getBuffCharges('shadow_step')).toBe(0);
        expect(useBuffStore.getState().allBuffs.find((b) => b.effect === 'shadow_step')).toBeUndefined();
    });

    it('consumeBuffCharge returns false when buff is missing', () => {
        const ok = useBuffStore.getState().consumeBuffCharge('shadow_step');
        expect(ok).toBe(false);
    });

    it('getBuffCharges returns 0 when no character set or buff missing', () => {
        useCharacterStore.setState({ character: null });
        expect(useBuffStore.getState().getBuffCharges('shadow_step')).toBe(0);
    });
});


describe('removeBuff / removeBuffByEffect', () => {
    it('removeBuff strips by buff id', () => {
        useBuffStore.getState().addBuff(makeBuff({ id: 'b1' }), 5_000);
        useBuffStore.getState().removeBuff('b1');
        expect(useBuffStore.getState().allBuffs).toHaveLength(0);
    });

    it('removeBuffByEffect strips matching effect for the active char', () => {
        useBuffStore.getState().addBuff(makeBuff({ effect: 'xp_boost' }), 5_000);
        useBuffStore.getState().addBuff(makeBuff({ id: 'b2', effect: 'attack_speed' }), 5_000);
        useBuffStore.getState().removeBuffByEffect('xp_boost');
        const buffs = useBuffStore.getState().allBuffs;
        expect(buffs).toHaveLength(1);
        expect(buffs[0].effect).toBe('attack_speed');
    });
});


describe('cleanExpired', () => {
    it('removes realtime buffs whose expiresAt is in the past', () => {
        useBuffStore.setState({
            allBuffs: [{
                id: 'old',
                characterId: 'char-1',
                name: 'Old',
                icon: 'sparkles',
                effect: 'xp_boost',
                expiresAt: Date.now() - 1000,
                timerMode: 'realtime',
                remainingMs: 0,
            }],
        });
        useBuffStore.getState().cleanExpired();
        expect(useBuffStore.getState().allBuffs).toHaveLength(0);
    });

    it('keeps realtime buffs whose expiresAt is still in the future', () => {
        useBuffStore.getState().addBuff(makeBuff(), 10_000);
        useBuffStore.getState().cleanExpired();
        expect(useBuffStore.getState().allBuffs).toHaveLength(1);
    });

    it('keeps pausable buffs with remainingMs > 0', () => {
        useBuffStore.getState().addPausableBuff(makeBuff({ effect: 'xp_boost' }), 5_000);
        useBuffStore.getState().cleanExpired();
        expect(useBuffStore.getState().allBuffs).toHaveLength(1);
    });

    it('keeps charge buffs as long as charges > 0', () => {
        useBuffStore.getState().addChargeBuff(makeBuff({ effect: 'shadow_step' }), 2, 6);
        useBuffStore.getState().cleanExpired();
        expect(useBuffStore.getState().allBuffs).toHaveLength(1);
    });
});


describe('hasBuff', () => {
    it('returns true for active realtime buff', () => {
        useBuffStore.getState().addBuff(makeBuff(), 5_000);
        expect(useBuffStore.getState().hasBuff('xp_boost')).toBe(true);
    });

    it('returns false when no character is set', () => {
        useBuffStore.getState().addBuff(makeBuff(), 5_000);
        useCharacterStore.setState({ character: null });
        expect(useBuffStore.getState().hasBuff('xp_boost')).toBe(false);
    });

    it('returns true for active pausable buff', () => {
        useBuffStore.getState().addPausableBuff(makeBuff({ effect: 'offline_training_boost' }), 10_000);
        expect(useBuffStore.getState().hasBuff('offline_training_boost')).toBe(true);
    });

    it('returns false for expired pausable buff', () => {
        useBuffStore.setState({
            allBuffs: [{
                id: 'b1',
                characterId: 'char-1',
                name: 'X',
                icon: 'sparkles',
                effect: 'xp_boost',
                expiresAt: Infinity,
                timerMode: 'pausable',
                remainingMs: 0,
            }],
        });
        expect(useBuffStore.getState().hasBuff('xp_boost')).toBe(false);
    });
});


describe('getBuffMultiplier', () => {
    it('returns 1 when the buff is not active', () => {
        expect(useBuffStore.getState().getBuffMultiplier('xp_boost')).toBe(1);
    });

    it('returns 1.5 for xp_boost when active', () => {
        useBuffStore.getState().addBuff(makeBuff({ effect: 'xp_boost' }), 5_000);
        expect(useBuffStore.getState().getBuffMultiplier('xp_boost')).toBe(1.5);
    });

    it('returns 2.0 for xp_boost_100 when active', () => {
        useBuffStore.getState().addBuff(makeBuff({ effect: 'xp_boost_100' }), 5_000);
        expect(useBuffStore.getState().getBuffMultiplier('xp_boost_100')).toBe(2.0);
    });

    it('returns 2.0 for offline_training_boost (pausable) when active', () => {
        useBuffStore.getState().addPausableBuff(makeBuff({ effect: 'offline_training_boost' }), 5_000);
        expect(useBuffStore.getState().getBuffMultiplier('offline_training_boost')).toBe(2.0);
    });

    it('returns 1 for any unknown active effect', () => {
        useBuffStore.getState().addBuff(makeBuff({ effect: 'totally_made_up' }), 5_000);
        expect(useBuffStore.getState().getBuffMultiplier('totally_made_up')).toBe(1);
    });
});


describe('consumePausableTime', () => {
    it('consumes the requested ms when buff has enough remaining', () => {
        useBuffStore.getState().addPausableBuff(makeBuff({ effect: 'xp_boost' }), 10_000);
        const consumed = useBuffStore.getState().consumePausableTime('xp_boost', 3_000);
        expect(consumed).toBe(3_000);
        expect(useBuffStore.getState().getPausableRemaining('xp_boost')).toBe(7_000);
    });

    it('clamps consumption to the buff remainingMs', () => {
        useBuffStore.getState().addPausableBuff(makeBuff({ effect: 'xp_boost' }), 1_000);
        const consumed = useBuffStore.getState().consumePausableTime('xp_boost', 5_000);
        expect(consumed).toBe(1_000);
        expect(useBuffStore.getState().getPausableRemaining('xp_boost')).toBe(0);
        expect(useBuffStore.getState().allBuffs).toHaveLength(0);
    });

    it('returns 0 when the buff does not exist', () => {
        const consumed = useBuffStore.getState().consumePausableTime('xp_boost', 1_000);
        expect(consumed).toBe(0);
    });

    it('does NOT consume from a realtime buff (timerMode mismatch)', () => {
        useBuffStore.getState().addBuff(makeBuff({ effect: 'xp_boost' }), 5_000);
        const consumed = useBuffStore.getState().consumePausableTime('xp_boost', 1_000);
        expect(consumed).toBe(0);
    });
});


describe('getActiveBuffs', () => {
    it('returns only active buffs for the current character', () => {
        useBuffStore.getState().addBuff(makeBuff(), 5_000);
        useCharacterStore.setState({ character: makeChar({ id: 'char-2' }) });
        expect(useBuffStore.getState().getActiveBuffs()).toHaveLength(0);
    });

    it('filters expired buffs out of active results', () => {
        useBuffStore.setState({
            allBuffs: [{
                id: 'old',
                characterId: 'char-1',
                name: 'Old',
                icon: 'sparkles',
                effect: 'xp_boost',
                expiresAt: Date.now() - 1000,
                timerMode: 'realtime',
                remainingMs: 0,
            }],
        });
        expect(useBuffStore.getState().getActiveBuffs()).toHaveLength(0);
    });
});

describe('clearCharacterBuffs', () => {
    it('removes every buff for the active character', () => {
        useBuffStore.getState().addBuff(makeBuff(), 5_000);
        useBuffStore.getState().addPausableBuff(makeBuff({ id: 'b2', effect: 'offline_training_boost' }), 5_000);
        useBuffStore.getState().clearCharacterBuffs();
        expect(useBuffStore.getState().allBuffs).toHaveLength(0);
    });

    it('leaves other characters\' buffs alone', () => {
        useBuffStore.getState().addBuff(makeBuff(), 5_000);
        useCharacterStore.setState({ character: makeChar({ id: 'char-2' }) });
        useBuffStore.getState().addBuff(makeBuff({ id: 'b2' }), 5_000);
        useBuffStore.getState().clearCharacterBuffs();
        const remaining = useBuffStore.getState().allBuffs;
        expect(remaining).toHaveLength(1);
        expect(remaining[0].characterId).toBe('char-1');
    });
});


describe('setCombatSpeedMult', () => {
    it('clamps to a minimum of 1', () => {
        useBuffStore.getState().setCombatSpeedMult(0.1);
        expect(useBuffStore.getState().combatSpeedMult).toBe(1);
    });

    it('stores normal values', () => {
        useBuffStore.getState().setCombatSpeedMult(4);
        expect(useBuffStore.getState().combatSpeedMult).toBe(4);
    });
});

describe('rebaseRealtimeBuffsSpeed', () => {
    it('shortens expiresAt when accelerating x1 -> x4', () => {
        useBuffStore.getState().addBuff(makeBuff(), 8_000);
        const before = useBuffStore.getState().allBuffs[0].expiresAt;
        useBuffStore.getState().rebaseRealtimeBuffsSpeed(1, 4);
        const after = useBuffStore.getState().allBuffs[0].expiresAt;
        expect(after).toBeLessThan(before);
    });

    it('extends expiresAt when slowing down x4 -> x1', () => {
        useBuffStore.getState().addBuff(makeBuff(), 8_000);
        const before = useBuffStore.getState().allBuffs[0].expiresAt;
        useBuffStore.getState().rebaseRealtimeBuffsSpeed(4, 1);
        const after = useBuffStore.getState().allBuffs[0].expiresAt;
        expect(after).toBeGreaterThan(before);
    });

    it('is a no-op when speed unchanged', () => {
        useBuffStore.getState().addBuff(makeBuff(), 8_000);
        const before = useBuffStore.getState().allBuffs[0].expiresAt;
        useBuffStore.getState().rebaseRealtimeBuffsSpeed(2, 2);
        expect(useBuffStore.getState().allBuffs[0].expiresAt).toBe(before);
    });
});


describe('getBuffTierGroup', () => {
    it('groups atk_dmg tiers together', () => {
        const g = getBuffTierGroup('atk_dmg_50');
        expect(g).toContain('atk_dmg_25');
        expect(g).toContain('atk_dmg_100');
    });

    it('returns null for an unknown effect', () => {
        expect(getBuffTierGroup('totally_made_up')).toBeNull();
    });
});


describe('party heal dot helpers', () => {
    it('returns the strongest healPctPerSec across game-time buffs', () => {
        useBuffStore.getState().addBuffGameTime(
            makeBuff({ id: 'skill_buff_blessing_0', effect: 'heal_party_dot:1' }),
            10_000,
            { healPctPerSec: 5 },
        );
        useBuffStore.getState().addBuffGameTime(
            makeBuff({ id: 'skill_buff_holy_nova_0', effect: 'heal_party_dot:2' }),
            10_000,
            { healPctPerSec: 8 },
        );
        expect(useBuffStore.getState().getPartyHealDotPctPerSec()).toBe(8);
        expect(useBuffStore.getState().getPartyHealDotSkillId()).toBe('holy_nova');
    });

    it('returns 0 / null when no heal-dot buff is active', () => {
        expect(useBuffStore.getState().getPartyHealDotPctPerSec()).toBe(0);
        expect(useBuffStore.getState().getPartyHealDotSkillId()).toBeNull();
    });
});
