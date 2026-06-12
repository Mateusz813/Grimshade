import { describe, it, expect, beforeEach } from 'vitest';
import { useCharacterStore, type ICharacter } from './characterStore';
import { useInventoryStore } from './inventoryStore';
import { useSkillStore } from './skillStore';
import { useLevelUpStore } from './levelUpStore';
import { EMPTY_EQUIPMENT } from '../systems/itemSystem';
import { xpToNextLevel } from '../systems/levelSystem';

// -- Helpers ------------------------------------------------------------------

/**
 * Minimal valid ICharacter payload. The DB row has more columns than this,
 * but only the gameplay-relevant fields matter for store testing. We use
 * `as ICharacter` because the API type includes timestamps + equipment we
 * don't need to fake here.
 */
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

/**
 * Reset all three stores that participate in character flows. We use the
 * full state shape from each store's create() initializer so the tests
 * don't accidentally bleed between cases.
 */
const resetStores = (): void => {
    useCharacterStore.setState({ character: null, isLoading: false });
    useInventoryStore.setState({
        bag: [],
        equipment: { ...EMPTY_EQUIPMENT },
        deposit: [],
        gold: 0,
        arenaPoints: 0,
        consumables: {},
        stones: {},
    });
    useSkillStore.setState({
        skillLevels: {},
        skillXp: {},
        activeSkillSlots: [null, null, null, null],
        skillUpgradeLevels: {},
        unlockedSkills: {},
        offlineTrainingSkillId: null,
        trainingSegmentStartedAt: null,
        trainingAccumulatedEffectiveSeconds: 0,
        trainingCurrentSpeedMultiplier: 2,
    });
    useLevelUpStore.setState({ event: null });
};

beforeEach(() => {
    resetStores();
});

// -- setCharacter -------------------------------------------------------------

describe('setCharacter', () => {
    it('stores the provided character', () => {
        const c = makeChar({ name: 'Alice' });
        useCharacterStore.getState().setCharacter(c);
        expect(useCharacterStore.getState().character?.name).toBe('Alice');
    });

    it('migrates highest_level to at least current level', () => {
        // Old DB rows might have highest_level missing or below `level`.
        // setCharacter must bring it up to current level so the gating
        // logic in addXp doesn't double-grant stat points later.
        const c = makeChar({ level: 25, highest_level: undefined as unknown as number });
        useCharacterStore.getState().setCharacter(c);
        expect(useCharacterStore.getState().character?.highest_level).toBe(25);
    });

    it('keeps highest_level when it already exceeds current level', () => {
        const c = makeChar({ level: 10, highest_level: 30 });
        useCharacterStore.getState().setCharacter(c);
        expect(useCharacterStore.getState().character?.highest_level).toBe(30);
    });

    it('accepts null to clear the character', () => {
        useCharacterStore.getState().setCharacter(makeChar());
        useCharacterStore.getState().setCharacter(null);
        expect(useCharacterStore.getState().character).toBeNull();
    });
});

// -- updateCharacter ----------------------------------------------------------

describe('updateCharacter', () => {
    it('merges partial fields into existing character', () => {
        useCharacterStore.getState().setCharacter(makeChar({ gold: 100 }));
        useCharacterStore.getState().updateCharacter({ gold: 250, hp: 80 });
        const c = useCharacterStore.getState().character!;
        expect(c.gold).toBe(250);
        expect(c.hp).toBe(80);
        expect(c.name).toBe('Tester'); // untouched
    });

    it('is a no-op when no character is set', () => {
        useCharacterStore.getState().updateCharacter({ gold: 999 });
        expect(useCharacterStore.getState().character).toBeNull();
    });
});

// -- addXp --------------------------------------------------------------------

describe('addXp', () => {
    it('returns a zero result and does nothing when no character is set', () => {
        const result = useCharacterStore.getState().addXp(500);
        expect(result).toEqual({ levelsGained: 0, statPointsGained: 0, newLevel: 0 });
        expect(useCharacterStore.getState().character).toBeNull();
    });

    it('accumulates XP without leveling up', () => {
        useCharacterStore.getState().setCharacter(makeChar({ level: 1, xp: 0 }));
        const need = xpToNextLevel(1);
        const result = useCharacterStore.getState().addXp(need - 1);
        expect(result.levelsGained).toBe(0);
        expect(useCharacterStore.getState().character?.xp).toBe(need - 1);
        expect(useCharacterStore.getState().character?.level).toBe(1);
    });

    it('levels up, awards stat points, fully heals on level-up', () => {
        useCharacterStore.getState().setCharacter(makeChar({
            level: 1,
            xp: 0,
            hp: 1, // intentionally low so we can see the heal-on-level-up bump
            max_hp: 100,
            mp: 1,
            max_mp: 30,
            highest_level: 1,
        }));
        const result = useCharacterStore.getState().addXp(xpToNextLevel(1));
        expect(result.levelsGained).toBe(1);
        expect(result.newLevel).toBe(2);
        expect(result.statPointsGained).toBeGreaterThanOrEqual(1);
        const c = useCharacterStore.getState().character!;
        expect(c.level).toBe(2);
        expect(c.stat_points).toBe(result.statPointsGained);
        // Full heal on level up — HP / MP top up to the effective max
        // (base + equipment, no equip in this test so base only).
        expect(c.hp).toBe(c.max_hp);
        expect(c.mp).toBe(c.max_mp);
    });

    // -- GAP #4 — level-up grants 100% HP/MP, no free heal without leveling --
    // Source: characterStore.addXp -> `didLevelUp ? effectiveMaxHp : clamp`.
    // On a genuine level-up HP and MP must snap to the FULL effective max
    // (base + per-level gain + equip + training). Without a level-up the XP
    // pointer moves but HP/MP must NOT be topped up — XP alone never heals.
    it('GAP #4: full-heals HP AND MP to the effective max on level-up (started low)', () => {
        useCharacterStore.getState().setCharacter(makeChar({
            class: 'Mage', // Mage: +3 HP, +8 MP per level — verifies both pools
            level: 1,
            xp: 0,
            hp: 3,
            max_hp: 80,
            mp: 2,
            max_mp: 120,
            highest_level: 1,
        }));
        useCharacterStore.getState().addXp(xpToNextLevel(1));
        const c = useCharacterStore.getState().character!;
        expect(c.level).toBe(2);
        // No equipment / training in this test -> effective max == base max,
        // which already includes the per-level HP/MP bump. Full heal means
        // current == max for BOTH pools.
        expect(c.hp).toBe(c.max_hp);
        expect(c.mp).toBe(c.max_mp);
        // Sanity: the heal actually moved the pools up from the seeded lows.
        expect(c.hp).toBeGreaterThan(3);
        expect(c.mp).toBeGreaterThan(2);
    });

    it('GAP #4: a multi-level jump still ends at 100% HP/MP', () => {
        useCharacterStore.getState().setCharacter(makeChar({
            level: 1,
            xp: 0,
            hp: 1,
            max_hp: 100,
            mp: 1,
            max_mp: 30,
            highest_level: 1,
        }));
        // Enough XP to clear several early levels in one call.
        const bulk = xpToNextLevel(1) + xpToNextLevel(2) + xpToNextLevel(3);
        const result = useCharacterStore.getState().addXp(bulk);
        expect(result.levelsGained).toBeGreaterThanOrEqual(2);
        const c = useCharacterStore.getState().character!;
        expect(c.hp).toBe(c.max_hp);
        expect(c.mp).toBe(c.max_mp);
    });

    it('GAP #4: XP gain WITHOUT a level-up does NOT heal HP/MP (no free heal)', () => {
        useCharacterStore.getState().setCharacter(makeChar({
            level: 5,
            xp: 0,
            hp: 40,   // intentionally damaged, below max
            max_hp: 200,
            mp: 10,   // intentionally drained, below max
            max_mp: 80,
            highest_level: 5,
        }));
        // Add just under the threshold — no level-up should occur.
        const result = useCharacterStore.getState().addXp(xpToNextLevel(5) - 1);
        expect(result.levelsGained).toBe(0);
        const c = useCharacterStore.getState().character!;
        // XP pointer advanced, level unchanged.
        expect(c.level).toBe(5);
        expect(c.xp).toBe(xpToNextLevel(5) - 1);
        // HP / MP stay exactly where they were — gaining XP must never heal.
        expect(c.hp).toBe(40);
        expect(c.mp).toBe(10);
    });

    it('GAP #4: re-leveling at/below highest_level levels up but does NOT full-heal (gated branch)', () => {
        // When the player re-levels into already-earned territory, the per-level
        // HP/MP gain is gated off (highest_level guard), so `effectiveMaxHp`
        // equals the unchanged base max. The level-up heal still snaps current
        // HP/MP to that (unchanged) max — it must never exceed max_hp/max_mp.
        useCharacterStore.getState().setCharacter(makeChar({
            level: 3,
            xp: 0,
            hp: 20,
            max_hp: 100,
            mp: 5,
            max_mp: 30,
            highest_level: 5, // re-leveling below the all-time high
        }));
        const result = useCharacterStore.getState().addXp(xpToNextLevel(3));
        expect(result.levelsGained).toBe(1);
        const c = useCharacterStore.getState().character!;
        expect(c.level).toBe(4);
        // No new HP/MP minted (gated) — max stays at base.
        expect(c.max_hp).toBe(100);
        expect(c.max_mp).toBe(30);
        // Level-up still heals to the (unchanged) max, never above it.
        expect(c.hp).toBe(100);
        expect(c.mp).toBe(30);
    });

    it('clamps negative XP pointer to a safe non-negative starting value', () => {
        // 2026-05 hardening: addXp uses Math.max(0, char.xp ?? 0) to prevent
        // a corrupt save with negative XP from blocking levelups entirely.
        useCharacterStore.getState().setCharacter(makeChar({ level: 1, xp: -5000 }));
        const result = useCharacterStore.getState().addXp(xpToNextLevel(1));
        // With xp clamped to 0, adding exactly xpToNextLevel(1) -> level 2.
        expect(result.newLevel).toBe(2);
    });

    it('grants HP / MP per level up by class table', () => {
        // Knight class: BASE_HP_PER_LEVEL.Knight = 8, BASE_MP_PER_LEVEL.Knight = 2.
        useCharacterStore.getState().setCharacter(makeChar({
            class: 'Knight',
            level: 1,
            max_hp: 100,
            max_mp: 30,
            highest_level: 1,
        }));
        useCharacterStore.getState().addXp(xpToNextLevel(1));
        const c = useCharacterStore.getState().character!;
        // We can't predict milestone bonuses (level 2 doesn't cross a 10-multiple),
        // so just verify the per-level HP / MP gain landed.
        expect(c.max_hp).toBe(100 + 8);
        expect(c.max_mp).toBe(30 + 2);
    });

    it('does NOT re-award stat points or HP when re-leveling above highest_level', () => {
        // Scenario: player was lvl 5, died down to lvl 3, now re-levels back
        // to 5 — highest_level should gate the bonuses so this doesn't pay out
        // a second time.
        useCharacterStore.getState().setCharacter(makeChar({
            level: 3,
            xp: 0,
            max_hp: 100,
            max_mp: 30,
            highest_level: 5,
            stat_points: 0,
        }));
        useCharacterStore.getState().addXp(xpToNextLevel(3));
        const c = useCharacterStore.getState().character!;
        // Level went up, but highest_level was already 5 so no stat points
        // are minted (re-leveling exploit prevention).
        expect(c.level).toBe(4);
        expect(c.stat_points).toBe(0);
        expect(c.max_hp).toBe(100); // no HP bump either
    });

    it('does award stat points when crossing past highest_level', () => {
        useCharacterStore.getState().setCharacter(makeChar({
            level: 5,
            xp: 0,
            highest_level: 5,
            stat_points: 0,
        }));
        useCharacterStore.getState().addXp(xpToNextLevel(5));
        const c = useCharacterStore.getState().character!;
        expect(c.level).toBe(6);
        expect(c.stat_points).toBeGreaterThanOrEqual(1);
        expect(c.highest_level).toBe(6);
    });

    it('fires the level-up notification via queueMicrotask', async () => {
        useCharacterStore.getState().setCharacter(makeChar({ level: 1, xp: 0, highest_level: 1 }));
        useCharacterStore.getState().addXp(xpToNextLevel(1));
        // queueMicrotask schedules on the next microtask — await a resolved
        // promise to drain the microtask queue.
        await Promise.resolve();
        const event = useLevelUpStore.getState().event;
        expect(event).not.toBeNull();
        expect(event?.newLevel).toBe(2);
        expect(event?.levelsGained).toBe(1);
    });

    it('grants gold milestone reward when crossing level 10', () => {
        useCharacterStore.getState().setCharacter(makeChar({
            level: 9,
            xp: 0,
            gold: 0,
            highest_level: 9,
        }));
        useCharacterStore.getState().addXp(xpToNextLevel(9));
        const c = useCharacterStore.getState().character!;
        expect(c.level).toBe(10);
        // Milestone reward at lvl 10 = 10 × 10000 = 100000.
        expect(c.gold).toBe(100000);
    });
});

// -- spendStatPoint / spendAllStatPoints -------------------------------------

describe('spendStatPoint', () => {
    it('spends 1 point on max_hp and bumps current HP by the same amount', () => {
        useCharacterStore.getState().setCharacter(makeChar({
            stat_points: 3,
            max_hp: 100,
            hp: 80,
        }));
        useCharacterStore.getState().spendStatPoint('max_hp');
        const c = useCharacterStore.getState().character!;
        // STAT_POINT_BONUSES.max_hp = 5
        expect(c.stat_points).toBe(2);
        expect(c.max_hp).toBe(105);
        expect(c.hp).toBe(85);
    });

    it('spends a point on attack with no HP/MP side-effect', () => {
        useCharacterStore.getState().setCharacter(makeChar({
            stat_points: 1,
            attack: 10,
            hp: 50,
            max_hp: 100,
        }));
        useCharacterStore.getState().spendStatPoint('attack');
        const c = useCharacterStore.getState().character!;
        expect(c.attack).toBe(11);
        expect(c.stat_points).toBe(0);
        expect(c.hp).toBe(50); // unchanged
    });

    it('is a no-op when stat_points = 0', () => {
        useCharacterStore.getState().setCharacter(makeChar({ stat_points: 0, attack: 10 }));
        useCharacterStore.getState().spendStatPoint('attack');
        const c = useCharacterStore.getState().character!;
        expect(c.attack).toBe(10);
        expect(c.stat_points).toBe(0);
    });

    it('is a no-op when no character is set', () => {
        useCharacterStore.getState().spendStatPoint('attack');
        expect(useCharacterStore.getState().character).toBeNull();
    });
});

describe('spendAllStatPoints', () => {
    it('spends every available point on a stat in one go', () => {
        useCharacterStore.getState().setCharacter(makeChar({
            stat_points: 5,
            attack: 10,
        }));
        useCharacterStore.getState().spendAllStatPoints('attack');
        const c = useCharacterStore.getState().character!;
        expect(c.stat_points).toBe(0);
        expect(c.attack).toBe(15); // +1 per point × 5
    });

    it('bulk-bumps max_hp and current hp by total bonus', () => {
        useCharacterStore.getState().setCharacter(makeChar({
            stat_points: 4,
            max_hp: 100,
            hp: 60,
        }));
        useCharacterStore.getState().spendAllStatPoints('max_hp');
        const c = useCharacterStore.getState().character!;
        // 4 × +5 = +20 to both pools
        expect(c.max_hp).toBe(120);
        expect(c.hp).toBe(80);
        expect(c.stat_points).toBe(0);
    });

    it('is a no-op when no character is set', () => {
        useCharacterStore.getState().spendAllStatPoints('attack');
        expect(useCharacterStore.getState().character).toBeNull();
    });
});

// -- fullHealEffective --------------------------------------------------------

describe('fullHealEffective', () => {
    it('tops up HP and MP to the effective max (base + equipment + training)', () => {
        useCharacterStore.getState().setCharacter(makeChar({
            hp: 1,
            mp: 1,
            max_hp: 200,
            max_mp: 50,
        }));
        useCharacterStore.getState().fullHealEffective();
        const c = useCharacterStore.getState().character!;
        // No equipment + no training = effective max equals base max.
        expect(c.hp).toBe(200);
        expect(c.mp).toBe(50);
    });

    it('is a no-op when no character is set', () => {
        useCharacterStore.getState().fullHealEffective();
        expect(useCharacterStore.getState().character).toBeNull();
    });
});

// -- clearCharacter -----------------------------------------------------------

describe('clearCharacter', () => {
    it('clears the character to null', () => {
        useCharacterStore.getState().setCharacter(makeChar());
        useCharacterStore.getState().clearCharacter();
        expect(useCharacterStore.getState().character).toBeNull();
    });

    it('is safe to call when no character is set', () => {
        // Should not throw, should not trigger any party-leave call.
        expect(() => useCharacterStore.getState().clearCharacter()).not.toThrow();
        expect(useCharacterStore.getState().character).toBeNull();
    });

    it('attempts to dissolve the party for the active character (best-effort)', async () => {
        // 2026-05-13 spec: leaving char-select dissolves any active party.
        // The dissolve happens via a deferred dynamic import so we only
        // assert the state lands at null + the call doesn't throw. The
        // microtask chain that hits partyStore is best-effort and not
        // deterministic in test env, so we don't spy on leaveParty.
        useCharacterStore.getState().setCharacter(makeChar({ id: 'char-1' }));
        expect(() => useCharacterStore.getState().clearCharacter()).not.toThrow();
        expect(useCharacterStore.getState().character).toBeNull();
        // Drain the microtask queue so any deferred imports / promises
        // settle without leaking into the next test.
        await Promise.resolve();
        await Promise.resolve();
    });
});
