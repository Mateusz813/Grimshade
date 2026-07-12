import { describe, it, expect, beforeEach } from 'vitest';
import { useCooldownStore } from './cooldownStore';

beforeEach(() => {
    useCooldownStore.setState({
        hpPotionCooldown: 0,
        mpPotionCooldown: 0,
        pctHpCooldown: 0,
        pctMpCooldown: 0,
        skillCooldowns: {},
    });
});

describe('initial state', () => {
    it('all potion cooldowns default to 0', () => {
        const s = useCooldownStore.getState();
        expect(s.hpPotionCooldown).toBe(0);
        expect(s.mpPotionCooldown).toBe(0);
        expect(s.pctHpCooldown).toBe(0);
        expect(s.pctMpCooldown).toBe(0);
    });

    it('skillCooldowns starts as an empty map', () => {
        expect(useCooldownStore.getState().skillCooldowns).toEqual({});
    });
});

describe('setHpPotionCooldown', () => {
    it('stores the provided millisecond value', () => {
        useCooldownStore.getState().setHpPotionCooldown(5000);
        expect(useCooldownStore.getState().hpPotionCooldown).toBe(5000);
    });

    it('clamps negative values to 0', () => {
        useCooldownStore.getState().setHpPotionCooldown(-100);
        expect(useCooldownStore.getState().hpPotionCooldown).toBe(0);
    });

    it('accepts 0 (cooldown cleared)', () => {
        useCooldownStore.setState({ hpPotionCooldown: 3000 } as never);
        useCooldownStore.getState().setHpPotionCooldown(0);
        expect(useCooldownStore.getState().hpPotionCooldown).toBe(0);
    });
});

describe('setMpPotionCooldown', () => {
    it('stores the provided value', () => {
        useCooldownStore.getState().setMpPotionCooldown(5000);
        expect(useCooldownStore.getState().mpPotionCooldown).toBe(5000);
    });

    it('clamps negative values to 0', () => {
        useCooldownStore.getState().setMpPotionCooldown(-500);
        expect(useCooldownStore.getState().mpPotionCooldown).toBe(0);
    });
});

describe('setPctHpCooldown', () => {
    it('stores the value (separate slot from flat HP)', () => {
        useCooldownStore.getState().setPctHpCooldown(2000);
        expect(useCooldownStore.getState().pctHpCooldown).toBe(2000);
        expect(useCooldownStore.getState().hpPotionCooldown).toBe(0);
    });

    it('clamps negatives to 0', () => {
        useCooldownStore.getState().setPctHpCooldown(-1);
        expect(useCooldownStore.getState().pctHpCooldown).toBe(0);
    });
});

describe('setPctMpCooldown', () => {
    it('stores the value (separate slot from flat MP)', () => {
        useCooldownStore.getState().setPctMpCooldown(2000);
        expect(useCooldownStore.getState().pctMpCooldown).toBe(2000);
        expect(useCooldownStore.getState().mpPotionCooldown).toBe(0);
    });

    it('clamps negatives to 0', () => {
        useCooldownStore.getState().setPctMpCooldown(-9999);
        expect(useCooldownStore.getState().pctMpCooldown).toBe(0);
    });
});

describe('setSkillCooldown', () => {
    it('adds a new skill cooldown entry', () => {
        useCooldownStore.getState().setSkillCooldown('fireball', 8000);
        expect(useCooldownStore.getState().skillCooldowns).toEqual({ fireball: 8000 });
    });

    it('overwrites an existing entry without touching others', () => {
        useCooldownStore.getState().setSkillCooldown('fireball', 8000);
        useCooldownStore.getState().setSkillCooldown('heal', 5000);
        useCooldownStore.getState().setSkillCooldown('fireball', 3000);
        expect(useCooldownStore.getState().skillCooldowns).toEqual({
            fireball: 3000,
            heal: 5000,
        });
    });

    it('clamps negative ms to 0 (still creates the entry)', () => {
        useCooldownStore.getState().setSkillCooldown('fireball', -50);
        expect(useCooldownStore.getState().skillCooldowns).toEqual({ fireball: 0 });
    });

    it('does not mutate the existing map reference (immutable update)', () => {
        const before = useCooldownStore.getState().skillCooldowns;
        useCooldownStore.getState().setSkillCooldown('fireball', 1000);
        const after = useCooldownStore.getState().skillCooldowns;
        expect(after).not.toBe(before);
    });
});

describe('setSkillCooldowns', () => {
    it('replaces the entire skill cooldown map in one shot', () => {
        useCooldownStore.getState().setSkillCooldown('old', 9000);
        useCooldownStore.getState().setSkillCooldowns({ a: 1000, b: 2000 });
        expect(useCooldownStore.getState().skillCooldowns).toEqual({ a: 1000, b: 2000 });
    });

    it('accepts an empty map (clears all skill CDs)', () => {
        useCooldownStore.setState({ skillCooldowns: { a: 1000 } } as never);
        useCooldownStore.getState().setSkillCooldowns({});
        expect(useCooldownStore.getState().skillCooldowns).toEqual({});
    });
});

describe('tick', () => {
    it('decrements every potion cooldown by `decMs`', () => {
        useCooldownStore.setState({
            hpPotionCooldown: 5000,
            mpPotionCooldown: 4000,
            pctHpCooldown: 2000,
            pctMpCooldown: 1500,
            skillCooldowns: {},
        });
        useCooldownStore.getState().tick(1000);
        const s = useCooldownStore.getState();
        expect(s.hpPotionCooldown).toBe(4000);
        expect(s.mpPotionCooldown).toBe(3000);
        expect(s.pctHpCooldown).toBe(1000);
        expect(s.pctMpCooldown).toBe(500);
    });

    it('clamps each potion cooldown at 0 (never goes negative)', () => {
        useCooldownStore.setState({
            hpPotionCooldown: 200,
            mpPotionCooldown: 100,
            pctHpCooldown: 50,
            pctMpCooldown: 0,
            skillCooldowns: {},
        });
        useCooldownStore.getState().tick(1000);
        const s = useCooldownStore.getState();
        expect(s.hpPotionCooldown).toBe(0);
        expect(s.mpPotionCooldown).toBe(0);
        expect(s.pctHpCooldown).toBe(0);
        expect(s.pctMpCooldown).toBe(0);
    });

    it('decrements each skill cooldown', () => {
        useCooldownStore.setState({
            hpPotionCooldown: 0,
            mpPotionCooldown: 0,
            pctHpCooldown: 0,
            pctMpCooldown: 0,
            skillCooldowns: { fireball: 5000, heal: 3000 },
        });
        useCooldownStore.getState().tick(1000);
        expect(useCooldownStore.getState().skillCooldowns).toEqual({
            fireball: 4000,
            heal: 2000,
        });
    });

    it('REMOVES skill entries that hit 0 (so the map stays small)', () => {
        useCooldownStore.setState({
            hpPotionCooldown: 0,
            mpPotionCooldown: 0,
            pctHpCooldown: 0,
            pctMpCooldown: 0,
            skillCooldowns: { ready: 500, busy: 5000 },
        });
        useCooldownStore.getState().tick(1000);
        expect(useCooldownStore.getState().skillCooldowns).toEqual({ busy: 4000 });
    });

    it('also prunes entries that go negative (defensive)', () => {
        useCooldownStore.setState({
            hpPotionCooldown: 0,
            mpPotionCooldown: 0,
            pctHpCooldown: 0,
            pctMpCooldown: 0,
            skillCooldowns: { stale: 100 },
        });
        useCooldownStore.getState().tick(99999);
        expect(useCooldownStore.getState().skillCooldowns).toEqual({});
    });

    it('is a no-op when called with 0 ms', () => {
        useCooldownStore.setState({
            hpPotionCooldown: 1000,
            mpPotionCooldown: 2000,
            pctHpCooldown: 0,
            pctMpCooldown: 0,
            skillCooldowns: { fireball: 5000 },
        });
        useCooldownStore.getState().tick(0);
        const s = useCooldownStore.getState();
        expect(s.hpPotionCooldown).toBe(1000);
        expect(s.mpPotionCooldown).toBe(2000);
        expect(s.skillCooldowns).toEqual({ fireball: 5000 });
    });

    it('ticks all four potion slots AND skills together in one call', () => {
        useCooldownStore.setState({
            hpPotionCooldown: 5000,
            mpPotionCooldown: 5000,
            pctHpCooldown: 2000,
            pctMpCooldown: 2000,
            skillCooldowns: { fireball: 6000, heal: 1500, blink: 200 },
        });
        useCooldownStore.getState().tick(500);
        const s = useCooldownStore.getState();
        expect(s.hpPotionCooldown).toBe(4500);
        expect(s.mpPotionCooldown).toBe(4500);
        expect(s.pctHpCooldown).toBe(1500);
        expect(s.pctMpCooldown).toBe(1500);
        expect(s.skillCooldowns).toEqual({ fireball: 5500, heal: 1000 });
    });
});

describe('clearAll', () => {
    it('zeroes all four potion cooldowns and empties skill map', () => {
        useCooldownStore.setState({
            hpPotionCooldown: 4000,
            mpPotionCooldown: 3000,
            pctHpCooldown: 1000,
            pctMpCooldown: 500,
            skillCooldowns: { a: 5000, b: 6000 },
        });
        useCooldownStore.getState().clearAll();
        const s = useCooldownStore.getState();
        expect(s.hpPotionCooldown).toBe(0);
        expect(s.mpPotionCooldown).toBe(0);
        expect(s.pctHpCooldown).toBe(0);
        expect(s.pctMpCooldown).toBe(0);
        expect(s.skillCooldowns).toEqual({});
    });

    it('is safe on an already-clear store', () => {
        expect(() => useCooldownStore.getState().clearAll()).not.toThrow();
        const s = useCooldownStore.getState();
        expect(s.skillCooldowns).toEqual({});
    });
});

