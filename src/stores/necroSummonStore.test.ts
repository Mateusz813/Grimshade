import { describe, it, expect, beforeEach } from 'vitest';
import {
    useNecroSummonStore,
    type NecroSummonType,
} from './necroSummonStore';

const CAPS: Record<NecroSummonType, number> = {
    skeleton: 10,
    ghost: 6,
    demon: 2,
    lich: 2,
};
const DMG_MULT: Record<NecroSummonType, number> = {
    skeleton: 0.25,
    ghost: 0.50,
    demon: 1.20,
    lich: 2.00,
};
const HP_FRAC: Record<NecroSummonType, number> = {
    skeleton: 0.25,
    ghost: 0.50,
    demon: 1.00,
    lich: 2.00,
};

const NECRO = 'necro-1';
const OTHER = 'necro-2';

beforeEach(() => {
    useNecroSummonStore.setState({ summons: {} });
});

describe('initial state', () => {
    it('summons map starts empty', () => {
        expect(useNecroSummonStore.getState().summons).toEqual({});
    });

    it('count() returns 0 for an unknown necro id', () => {
        expect(useNecroSummonStore.getState().count('whoever')).toBe(0);
    });

    it('totalAttackBonus() returns 0 for an unknown necro id', () => {
        expect(useNecroSummonStore.getState().totalAttackBonus('whoever', 100)).toBe(0);
    });
});

describe('spawn', () => {
    it('spawns the requested count for a fresh queue', () => {
        const spawned = useNecroSummonStore.getState().spawn(NECRO, 'skeleton', 3, 50, 200, 100);
        expect(spawned).toBe(3);
        expect(useNecroSummonStore.getState().count(NECRO)).toBe(3);
    });

    it('returns 0 and does NOT touch state when count <= 0', () => {
        const spawned = useNecroSummonStore.getState().spawn(NECRO, 'skeleton', 0, 50, 200);
        expect(spawned).toBe(0);
        expect(useNecroSummonStore.getState().summons[NECRO]).toBeUndefined();
    });

    it('honours per-type caps (skeleton=10)', () => {
        const cap = CAPS.skeleton;
        useNecroSummonStore.getState().spawn(NECRO, 'skeleton', cap, 50, 200);
        const extra = useNecroSummonStore.getState().spawn(NECRO, 'skeleton', 5, 50, 200);
        expect(extra).toBe(0);
        expect(useNecroSummonStore.getState().count(NECRO)).toBe(cap);
    });

    it('returns the number ACTUALLY spawned when the cap is partially exceeded', () => {
        useNecroSummonStore.getState().spawn(NECRO, 'demon', 1, 50, 200);
        const spawned = useNecroSummonStore.getState().spawn(NECRO, 'demon', 5, 50, 200);
        expect(spawned).toBe(1);
        expect(useNecroSummonStore.getState().count(NECRO)).toBe(2);
    });

    it('caps are independent per type — skeleton fill does not block lich', () => {
        useNecroSummonStore.getState().spawn(NECRO, 'skeleton', CAPS.skeleton, 50, 200);
        const spawned = useNecroSummonStore.getState().spawn(NECRO, 'lich', 2, 50, 200);
        expect(spawned).toBe(2);
        expect(useNecroSummonStore.getState().count(NECRO)).toBe(CAPS.skeleton + 2);
    });

    it('per-summon HP = floor(necroMaxHp * HP_FRAC[type]), minimum 1', () => {
        useNecroSummonStore.getState().spawn(NECRO, 'demon', 1, 50, 400, 100);
        const summon = useNecroSummonStore.getState().summons[NECRO][0];
        expect(summon.hp).toBe(Math.floor(400 * HP_FRAC.demon));
        expect(summon.maxHp).toBe(summon.hp);
    });

    it('per-summon HP never drops below 1 even with tiny necroMaxHp', () => {
        useNecroSummonStore.getState().spawn(NECRO, 'skeleton', 1, 1, 1);
        const summon = useNecroSummonStore.getState().summons[NECRO][0];
        expect(summon.hp).toBe(1);
        expect(summon.maxHp).toBe(1);
    });

    it('per-summon dmgMult matches the per-type multiplier', () => {
        useNecroSummonStore.getState().spawn(NECRO, 'lich', 1, 100, 500);
        expect(useNecroSummonStore.getState().summons[NECRO][0].dmgMult).toBe(DMG_MULT.lich);
    });

    it('MP defaults to 0 when necroMaxMp arg is omitted', () => {
        useNecroSummonStore.getState().spawn(NECRO, 'skeleton', 1, 50, 200);
        const summon = useNecroSummonStore.getState().summons[NECRO][0];
        expect(summon.mp).toBe(0);
        expect(summon.maxMp).toBe(0);
    });

    it('summons get unique-looking ids', () => {
        useNecroSummonStore.getState().spawn(NECRO, 'skeleton', 3, 50, 200);
        const ids = useNecroSummonStore.getState().summons[NECRO].map((s) => s.id);
        expect(new Set(ids).size).toBe(3);
    });

    it('keeps queues per necro id isolated', () => {
        useNecroSummonStore.getState().spawn(NECRO, 'skeleton', 2, 50, 200);
        useNecroSummonStore.getState().spawn(OTHER, 'skeleton', 4, 50, 200);
        expect(useNecroSummonStore.getState().count(NECRO)).toBe(2);
        expect(useNecroSummonStore.getState().count(OTHER)).toBe(4);
    });
});

describe('healAllPct', () => {
    it('heals every summon by the given % of its own maxHp', () => {
        useNecroSummonStore.getState().spawn(NECRO, 'skeleton', 2, 50, 400);
        const before = useNecroSummonStore.getState().summons[NECRO];
        useNecroSummonStore.setState({
            summons: { [NECRO]: before.map((s) => ({ ...s, hp: 20 })) },
        });
        useNecroSummonStore.getState().healAllPct(NECRO, 25);
        const after = useNecroSummonStore.getState().summons[NECRO];
        expect(after.every((s) => s.hp === 45)).toBe(true);
    });

    it('clamps the healed HP at maxHp (no over-heal)', () => {
        useNecroSummonStore.getState().spawn(NECRO, 'skeleton', 1, 50, 400);
        useNecroSummonStore.getState().healAllPct(NECRO, 50);
        const s = useNecroSummonStore.getState().summons[NECRO][0];
        expect(s.hp).toBe(s.maxHp);
    });

    it('uses minimum of 1 HP healed (so tiny pct on tiny maxHp still ticks)', () => {
        useNecroSummonStore.getState().spawn(NECRO, 'skeleton', 1, 50, 4);
        useNecroSummonStore.setState({
            summons: {
                [NECRO]: useNecroSummonStore
                    .getState()
                    .summons[NECRO].map((s) => ({ ...s, hp: 0 })),
            },
        });
        useNecroSummonStore.getState().healAllPct(NECRO, 1);
        const s = useNecroSummonStore.getState().summons[NECRO][0];
        expect(s.hp).toBe(1);
    });

    it('is a no-op when queue is empty', () => {
        useNecroSummonStore.getState().healAllPct(NECRO, 50);
        expect(useNecroSummonStore.getState().summons[NECRO]).toBeUndefined();
    });

    it('is a no-op when pct <= 0', () => {
        useNecroSummonStore.getState().spawn(NECRO, 'skeleton', 1, 50, 400);
        const before = useNecroSummonStore.getState().summons[NECRO][0].hp;
        useNecroSummonStore.getState().healAllPct(NECRO, 0);
        useNecroSummonStore.getState().healAllPct(NECRO, -10);
        const after = useNecroSummonStore.getState().summons[NECRO][0].hp;
        expect(after).toBe(before);
    });
});

describe('damageFirst (type-priority soak: skeleton -> ghost -> demon -> lich)', () => {
    it('returns {dmgConsumed:0, queueEmpty:true} when queue is empty', () => {
        const res = useNecroSummonStore.getState().damageFirst(NECRO, 50);
        expect(res).toEqual({ dmgConsumed: 0, queueEmpty: true });
    });

    it('damages the lowest-priority summon first (skeleton before lich)', () => {
        useNecroSummonStore.getState().spawn(NECRO, 'lich', 1, 50, 200);
        useNecroSummonStore.getState().spawn(NECRO, 'skeleton', 1, 50, 200);
        const sizeBefore = useNecroSummonStore.getState().count(NECRO);
        const res = useNecroSummonStore.getState().damageFirst(NECRO, 10);
        expect(res.queueEmpty).toBe(false);
        expect(sizeBefore).toBe(2);
        const queue = useNecroSummonStore.getState().summons[NECRO];
        const skeleton = queue.find((s) => s.type === 'skeleton')!;
        const lich = queue.find((s) => s.type === 'lich')!;
        expect(skeleton.hp).toBeLessThan(skeleton.maxHp);
        expect(lich.hp).toBe(lich.maxHp);
        expect(res.dmgConsumed).toBe(10);
    });

    it('caps dmgConsumed at the summon current HP (excess does NOT carry over)', () => {
        useNecroSummonStore.getState().spawn(NECRO, 'skeleton', 1, 50, 200);
        const res = useNecroSummonStore.getState().damageFirst(NECRO, 9999);
        expect(res.dmgConsumed).toBe(50);
        expect(res.queueEmpty).toBe(true);
        expect(useNecroSummonStore.getState().count(NECRO)).toBe(0);
    });

    it('splices out the dead summon and promotes the next of the same tier', () => {
        useNecroSummonStore.getState().spawn(NECRO, 'skeleton', 2, 50, 200);
        const initial = useNecroSummonStore.getState().summons[NECRO];
        const firstSkeletonId = initial[0].id;
        useNecroSummonStore.getState().damageFirst(NECRO, 9999);
        const afterQ = useNecroSummonStore.getState().summons[NECRO];
        expect(afterQ.length).toBe(1);
        expect(afterQ[0].id).not.toBe(firstSkeletonId);
    });

    it('within same type uses FIFO (oldest dies first)', () => {
        useNecroSummonStore.getState().spawn(NECRO, 'ghost', 2, 50, 400);
        const queue = useNecroSummonStore.getState().summons[NECRO];
        const oldestGhostId = queue[0].id;
        useNecroSummonStore.getState().spawn(NECRO, 'ghost', 1, 50, 400);
        useNecroSummonStore.getState().damageFirst(NECRO, 9999);
        const survivors = useNecroSummonStore.getState().summons[NECRO];
        expect(survivors.map((s) => s.id)).not.toContain(oldestGhostId);
        expect(survivors.length).toBe(2);
    });
});

describe('damageAll (AOE)', () => {
    it('hits every summon for the full dmg amount', () => {
        useNecroSummonStore.getState().spawn(NECRO, 'skeleton', 3, 50, 400);
        useNecroSummonStore.getState().damageAll(NECRO, 30);
        const queue = useNecroSummonStore.getState().summons[NECRO];
        expect(queue.every((s) => s.hp === 70)).toBe(true);
    });

    it('removes summons whose HP drops to 0 or below', () => {
        useNecroSummonStore.getState().spawn(NECRO, 'skeleton', 2, 50, 400);
        useNecroSummonStore.getState().spawn(NECRO, 'lich', 1, 50, 400);
        useNecroSummonStore.getState().damageAll(NECRO, 200);
        const queue = useNecroSummonStore.getState().summons[NECRO];
        expect(queue.length).toBe(1);
        expect(queue[0].type).toBe('lich');
        expect(queue[0].hp).toBe(600);
    });

    it('is a no-op when queue is empty', () => {
        useNecroSummonStore.getState().damageAll(NECRO, 100);
        expect(useNecroSummonStore.getState().summons[NECRO]).toBeUndefined();
    });

    it('damaging EXACTLY HP removes that summon (boundary)', () => {
        useNecroSummonStore.getState().spawn(NECRO, 'skeleton', 1, 50, 400);
        useNecroSummonStore.getState().damageAll(NECRO, 100);
        expect(useNecroSummonStore.getState().count(NECRO)).toBe(0);
    });
});

describe('count', () => {
    it('returns the queue length', () => {
        useNecroSummonStore.getState().spawn(NECRO, 'skeleton', 4, 50, 400);
        expect(useNecroSummonStore.getState().count(NECRO)).toBe(4);
    });

    it('returns 0 for an absent necro id', () => {
        expect(useNecroSummonStore.getState().count('missing')).toBe(0);
    });
});

describe('totalAttackBonus', () => {
    it('sums floor(necroAttack * dmgMult) across all summons', () => {
        useNecroSummonStore.getState().spawn(NECRO, 'skeleton', 2, 100, 400);
        useNecroSummonStore.getState().spawn(NECRO, 'demon', 1, 100, 400);
        expect(useNecroSummonStore.getState().totalAttackBonus(NECRO, 100)).toBe(170);
    });

    it('returns 0 when no summons exist', () => {
        expect(useNecroSummonStore.getState().totalAttackBonus('nobody', 100)).toBe(0);
    });

    it('floors fractional results per summon', () => {
        useNecroSummonStore.getState().spawn(NECRO, 'skeleton', 1, 7, 400);
        expect(useNecroSummonStore.getState().totalAttackBonus(NECRO, 7)).toBe(1);
    });
});

describe('clear', () => {
    it('removes a single necro queue but leaves the others intact', () => {
        useNecroSummonStore.getState().spawn(NECRO, 'skeleton', 2, 50, 400);
        useNecroSummonStore.getState().spawn(OTHER, 'ghost', 2, 50, 400);
        useNecroSummonStore.getState().clear(NECRO);
        const state = useNecroSummonStore.getState().summons;
        expect(state[NECRO]).toBeUndefined();
        expect(state[OTHER]).toBeDefined();
        expect(state[OTHER].length).toBe(2);
    });

    it('is a no-op for an unknown id', () => {
        useNecroSummonStore.getState().spawn(NECRO, 'skeleton', 1, 50, 400);
        expect(() => useNecroSummonStore.getState().clear('ghost-necro')).not.toThrow();
        expect(useNecroSummonStore.getState().count(NECRO)).toBe(1);
    });
});

describe('clearAll', () => {
    it('wipes every queue across all necros', () => {
        useNecroSummonStore.getState().spawn(NECRO, 'skeleton', 2, 50, 400);
        useNecroSummonStore.getState().spawn(OTHER, 'demon', 1, 50, 400);
        useNecroSummonStore.getState().clearAll();
        expect(useNecroSummonStore.getState().summons).toEqual({});
    });

    it('is safe on an already-empty store', () => {
        expect(() => useNecroSummonStore.getState().clearAll()).not.toThrow();
        expect(useNecroSummonStore.getState().summons).toEqual({});
    });
});

describe('despawnOne', () => {
    it('removes the oldest summon of the given type and returns true', () => {
        useNecroSummonStore.getState().spawn(NECRO, 'skeleton', 2, 50, 400);
        useNecroSummonStore.getState().spawn(NECRO, 'demon', 1, 50, 400);
        const queueBefore = useNecroSummonStore.getState().summons[NECRO];
        const oldestSkelId = queueBefore.find((s) => s.type === 'skeleton')!.id;

        const result = useNecroSummonStore.getState().despawnOne(NECRO, 'skeleton');

        expect(result).toBe(true);
        const queueAfter = useNecroSummonStore.getState().summons[NECRO];
        expect(queueAfter.length).toBe(2);
        expect(queueAfter.map((s) => s.id)).not.toContain(oldestSkelId);
        expect(queueAfter.some((s) => s.type === 'demon')).toBe(true);
    });

    it('returns false when no summon of that type exists', () => {
        useNecroSummonStore.getState().spawn(NECRO, 'skeleton', 1, 50, 400);
        const result = useNecroSummonStore.getState().despawnOne(NECRO, 'lich');
        expect(result).toBe(false);
        expect(useNecroSummonStore.getState().count(NECRO)).toBe(1);
    });

    it('returns false when queue does not exist', () => {
        const result = useNecroSummonStore.getState().despawnOne('nobody', 'skeleton');
        expect(result).toBe(false);
    });

    it('removing the last summon of a type leaves room to re-summon (caps re-apply)', () => {
        useNecroSummonStore.getState().spawn(NECRO, 'demon', CAPS.demon, 50, 400);
        useNecroSummonStore.getState().despawnOne(NECRO, 'demon');
        const spawned = useNecroSummonStore.getState().spawn(NECRO, 'demon', 1, 50, 400);
        expect(spawned).toBe(1);
        expect(useNecroSummonStore.getState().count(NECRO)).toBe(CAPS.demon);
    });
});

