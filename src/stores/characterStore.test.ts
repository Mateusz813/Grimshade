import { useAttributeStore } from './attributeStore';
import { ATTRIBUTE_POINT_PCT, ATTRIBUTE_DEF_CAP_PCT, getMaxDefensePoints } from '../systems/attributeSystem';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { useCharacterStore, computeBaseStatFloor, type ICharacter } from './characterStore';
import { useInventoryStore } from './inventoryStore';
import { useSkillStore } from './skillStore';
import { useLevelUpStore } from './levelUpStore';
import { useBuffStore } from './buffStore';
import { EMPTY_EQUIPMENT } from '../systems/itemSystem';
import { xpToNextLevel } from '../systems/levelSystem';


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
    useBuffStore.setState({ allBuffs: [], combatSpeedMult: 1 });
};

beforeEach(() => {
    resetStores();
});


describe('setCharacter', () => {
    it('stores the provided character', () => {
        const c = makeChar({ name: 'Alice' });
        useCharacterStore.getState().setCharacter(c);
        expect(useCharacterStore.getState().character?.name).toBe('Alice');
    });

    it('migrates highest_level to at least current level', () => {
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


describe('updateCharacter', () => {
    it('merges partial fields into existing character', () => {
        useCharacterStore.getState().setCharacter(makeChar({ gold: 100 }));
        useCharacterStore.getState().updateCharacter({ gold: 250, hp: 80 });
        const c = useCharacterStore.getState().character!;
        expect(c.gold).toBe(250);
        expect(c.hp).toBe(80);
        expect(c.name).toBe('Tester');
    });

    it('is a no-op when no character is set', () => {
        useCharacterStore.getState().updateCharacter({ gold: 999 });
        expect(useCharacterStore.getState().character).toBeNull();
    });
});


describe('addXp', () => {
    it('returns a zero result and does nothing when no character is set', () => {
        const result = useCharacterStore.getState().addXp(500);
        expect(result).toEqual({ levelsGained: 0, statPointsGained: 0, newLevel: 0, xpApplied: 0 });
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

    it('returns xpApplied equal to the raw xp when no boost is active', () => {
        useCharacterStore.getState().setCharacter(makeChar({ level: 1, xp: 0 }));
        const result = useCharacterStore.getState().addXp(100);
        expect(result.xpApplied).toBe(100);
        expect(useCharacterStore.getState().character?.xp).toBe(100);
    });

    it('applies the XP boost multiplier from an active elixir (chokepoint)', () => {
        useCharacterStore.getState().setCharacter(makeChar({ level: 1, xp: 0 }));
        useBuffStore.getState().addBuff({ id: 'xp', name: 'XP', icon: 'star', effect: 'xp_boost' }, 60_000);
        const result = useCharacterStore.getState().addXp(100);
        expect(result.xpApplied).toBe(150);
        expect(useCharacterStore.getState().character?.xp).toBe(150);
    });

    it('stacks xp_boost_100 with premium_xp_boost (2 × 2 = 4×)', () => {
        useCharacterStore.getState().setCharacter(makeChar({ level: 1, xp: 0 }));
        useBuffStore.getState().addBuff({ id: 'x100', name: 'XP', icon: 'star', effect: 'xp_boost_100' }, 60_000);
        useBuffStore.getState().addBuff({ id: 'prem', name: 'Prem', icon: 'gem', effect: 'premium_xp_boost' }, 60_000);
        const result = useCharacterStore.getState().addXp(100);
        expect(result.xpApplied).toBe(400);
    });

    it('levels up, awards stat points, fully heals on level-up', () => {
        useCharacterStore.getState().setCharacter(makeChar({
            level: 1,
            xp: 0,
            hp: 1,
            max_hp: 100,
            mp: 1,
            max_mp: 30,
            highest_level: 1,
        }));
        const result = useCharacterStore.getState().addXp(xpToNextLevel(1));
        expect(result.levelsGained).toBe(1);
        expect(result.newLevel).toBe(2);
        expect(result.statPointsGained).toBe(0);
        const c = useCharacterStore.getState().character!;
        expect(c.level).toBe(2);
        expect(c.stat_points).toBe(result.statPointsGained);
        expect(c.hp).toBe(c.max_hp);
        expect(c.mp).toBe(c.max_mp);
    });

    it('GAP #4: full-heals HP AND MP to the effective max on level-up (started low)', () => {
        useCharacterStore.getState().setCharacter(makeChar({
            class: 'Mage',
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
        expect(c.hp).toBe(c.max_hp);
        expect(c.mp).toBe(c.max_mp);
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
            hp: 40,
            max_hp: 200,
            mp: 10,
            max_mp: 80,
            highest_level: 5,
        }));
        const result = useCharacterStore.getState().addXp(xpToNextLevel(5) - 1);
        expect(result.levelsGained).toBe(0);
        const c = useCharacterStore.getState().character!;
        expect(c.level).toBe(5);
        expect(c.xp).toBe(xpToNextLevel(5) - 1);
        expect(c.hp).toBe(40);
        expect(c.mp).toBe(10);
    });

    it('GAP #4: re-leveling at/below highest_level levels up but does NOT full-heal (gated branch)', () => {
        useCharacterStore.getState().setCharacter(makeChar({
            level: 3,
            xp: 0,
            hp: 20,
            max_hp: 100,
            mp: 5,
            max_mp: 30,
            highest_level: 5,
        }));
        const result = useCharacterStore.getState().addXp(xpToNextLevel(3));
        expect(result.levelsGained).toBe(1);
        const c = useCharacterStore.getState().character!;
        expect(c.level).toBe(4);
        expect(c.max_hp).toBe(100);
        expect(c.max_mp).toBe(30);
        expect(c.hp).toBe(100);
        expect(c.mp).toBe(30);
    });

    it('clamps negative XP pointer to a safe non-negative starting value', () => {
        useCharacterStore.getState().setCharacter(makeChar({ level: 1, xp: -5000 }));
        const result = useCharacterStore.getState().addXp(xpToNextLevel(1));
        expect(result.newLevel).toBe(2);
    });

    it('grants HP / MP per level up by class table', () => {
        useCharacterStore.getState().setCharacter(makeChar({
            class: 'Knight',
            level: 1,
            max_hp: 100,
            max_mp: 30,
            highest_level: 1,
        }));
        useCharacterStore.getState().addXp(xpToNextLevel(1));
        const c = useCharacterStore.getState().character!;
        expect(c.max_hp).toBe(100 + 8);
        expect(c.max_mp).toBe(30 + 2);
    });

    it('does NOT re-award stat points or HP when re-leveling above highest_level', () => {
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
        expect(c.level).toBe(4);
        expect(c.stat_points).toBe(0);
        expect(c.max_hp).toBe(100);
    });

    it('awards exactly one attribute point per 10-level milestone crossed', () => {
        useCharacterStore.getState().setCharacter(makeChar({
            level: 9,
            xp: 0,
            highest_level: 9,
            stat_points: 0,
        }));
        useCharacterStore.getState().addXp(xpToNextLevel(9));
        const c = useCharacterStore.getState().character!;
        expect(c.level).toBe(10);
        expect(c.stat_points).toBe(1);
        expect(c.highest_level).toBe(10);
    });

    it('awards no attribute point for a level-up that crosses no milestone', () => {
        useCharacterStore.getState().setCharacter(makeChar({
            level: 5,
            xp: 0,
            highest_level: 5,
            stat_points: 0,
        }));
        useCharacterStore.getState().addXp(xpToNextLevel(5));
        const c = useCharacterStore.getState().character!;
        expect(c.level).toBe(6);
        expect(c.stat_points).toBe(0);
        expect(c.highest_level).toBe(6);
    });

    it('fires the level-up notification via queueMicrotask', async () => {
        useCharacterStore.getState().setCharacter(makeChar({ level: 1, xp: 0, highest_level: 1 }));
        useCharacterStore.getState().addXp(xpToNextLevel(1));
        await Promise.resolve();
        const event = useLevelUpStore.getState().event;
        expect(event).not.toBeNull();
        expect(event?.newLevel).toBe(2);
        expect(event?.levelsGained).toBe(1);
    });

    it('grants gold milestone reward when crossing level 10 — into the SPENDABLE inventory pool', () => {
        useCharacterStore.getState().setCharacter(makeChar({
            level: 9,
            xp: 0,
            gold: 0,
            highest_level: 9,
        }));
        useInventoryStore.setState({ gold: 0 });
        useCharacterStore.getState().addXp(xpToNextLevel(9));
        const c = useCharacterStore.getState().character!;
        expect(c.level).toBe(10);
        expect(useInventoryStore.getState().gold).toBe(100000);
        expect(c.gold).toBe(0);
    });

    it('does NOT credit inventory gold on a non-milestone level-up (8 -> 9)', () => {
        useCharacterStore.getState().setCharacter(makeChar({
            level: 8,
            xp: 0,
            gold: 0,
            highest_level: 8,
        }));
        useInventoryStore.setState({ gold: 0 });
        useCharacterStore.getState().addXp(xpToNextLevel(8));
        expect(useCharacterStore.getState().character!.level).toBe(9);
        expect(useInventoryStore.getState().gold).toBe(0);
    });

    it('does NOT re-award milestone gold when re-leveling after death (gated on highest_level)', () => {
        useCharacterStore.getState().setCharacter(makeChar({
            level: 9,
            xp: 0,
            gold: 0,
            highest_level: 10,
        }));
        useInventoryStore.setState({ gold: 0 });
        useCharacterStore.getState().addXp(xpToNextLevel(9));
        expect(useCharacterStore.getState().character!.level).toBe(10);
        expect(useInventoryStore.getState().gold).toBe(0);
    });
});


describe('spendAttributePoint', () => {
    beforeEach(() => {
        useAttributeStore.getState().resetAllocation();
    });

    it('spends 1 point into attack and records it in the attribute store', () => {
        useCharacterStore.getState().setCharacter(makeChar({ stat_points: 3, class: 'Knight' }));
        const applied = useCharacterStore.getState().spendAttributePoint('attack');
        expect(applied).toBe(1);
        expect(useCharacterStore.getState().character!.stat_points).toBe(2);
        expect(useAttributeStore.getState().attackPoints).toBe(1);
        expect(useAttributeStore.getState().getMultipliers('Knight').attack)
            .toBeCloseTo(1 + ATTRIBUTE_POINT_PCT / 100, 10);
    });

    it('spends every available point at once when all=true', () => {
        useCharacterStore.getState().setCharacter(makeChar({ stat_points: 5, class: 'Knight' }));
        expect(useCharacterStore.getState().spendAttributePoint('hp', true)).toBe(5);
        expect(useCharacterStore.getState().character!.stat_points).toBe(0);
        expect(useAttributeStore.getState().hpPoints).toBe(5);
    });

    it('clamps defense at the per-class cap and refunds the excess points', () => {
        const cap = getMaxDefensePoints('Mage');
        useCharacterStore.getState().setCharacter(makeChar({ stat_points: cap + 10, class: 'Mage' }));
        const applied = useCharacterStore.getState().spendAttributePoint('defense', true);
        expect(applied).toBe(cap);
        expect(useAttributeStore.getState().defensePoints).toBe(cap);
        expect(useCharacterStore.getState().character!.stat_points).toBe(10);
        expect(useAttributeStore.getState().getMultipliers('Mage').defense)
            .toBeCloseTo(1 + ATTRIBUTE_DEF_CAP_PCT.Mage / 100, 10);
    });

    it('gives Knight the highest defense cap of all classes', () => {
        const caps = Object.entries(ATTRIBUTE_DEF_CAP_PCT);
        for (const [cls, pct] of caps) {
            if (cls === 'Knight') continue;
            expect(ATTRIBUTE_DEF_CAP_PCT.Knight).toBeGreaterThan(pct);
        }
    });

    it('is a no-op when stat_points = 0', () => {
        useCharacterStore.getState().setCharacter(makeChar({ stat_points: 0, class: 'Knight' }));
        expect(useCharacterStore.getState().spendAttributePoint('attack')).toBe(0);
        expect(useAttributeStore.getState().attackPoints).toBe(0);
    });

    it('is a no-op when no character is set', () => {
        expect(useCharacterStore.getState().spendAttributePoint('attack')).toBe(0);
        expect(useCharacterStore.getState().character).toBeNull();
    });
});


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
        expect(c.hp).toBe(200);
        expect(c.mp).toBe(50);
    });

    it('is a no-op when no character is set', () => {
        useCharacterStore.getState().fullHealEffective();
        expect(useCharacterStore.getState().character).toBeNull();
    });
});


describe('clearCharacter', () => {
    it('clears the character to null', () => {
        useCharacterStore.getState().setCharacter(makeChar());
        useCharacterStore.getState().clearCharacter();
        expect(useCharacterStore.getState().character).toBeNull();
    });

    it('is safe to call when no character is set', () => {
        expect(() => useCharacterStore.getState().clearCharacter()).not.toThrow();
        expect(useCharacterStore.getState().character).toBeNull();
    });

    it('attempts to dissolve the party for the active character (best-effort)', async () => {
        useCharacterStore.getState().setCharacter(makeChar({ id: 'char-1' }));
        expect(() => useCharacterStore.getState().clearCharacter()).not.toThrow();
        expect(useCharacterStore.getState().character).toBeNull();
        await Promise.resolve();
        await Promise.resolve();
    });
});


describe('computeBaseStatFloor', () => {
    it('Knight lvl 1 = pure base stats (no per-level / milestone yet)', () => {
        expect(computeBaseStatFloor('Knight', 1)).toEqual({ max_hp: 150, max_mp: 40 });
    });

    it('Knight lvl 30 = base + 29 levels + 3 milestones', () => {
        expect(computeBaseStatFloor('Knight', 30)).toEqual({ max_hp: 472, max_mp: 113 });
    });

    it('Mage lvl 109 = base + 108 levels + 10 milestones (Krasek case)', () => {
        expect(computeBaseStatFloor('Mage', 109)).toEqual({ max_hp: 514, max_mp: 1314 });
    });

    it('clamps a sub-1 / missing level up to 1 (defensive)', () => {
        expect(computeBaseStatFloor('Knight', 0)).toEqual({ max_hp: 150, max_mp: 40 });
    });
});


describe('healCorruptedBaseStats', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('raises a corrupted (max_mp=0) high-level char up to the floor', () => {
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        useCharacterStore.getState().setCharacter(
            makeChar({ class: 'Mage', level: 109, highest_level: 109, max_mp: 0, mp: 0, max_hp: 524, hp: 524 }),
        );
        const healed = useCharacterStore.getState().healCorruptedBaseStats();
        expect(healed).toBe(true);
        const c = useCharacterStore.getState().character!;
        expect(c.max_mp).toBe(1314);
        expect(c.mp).toBe(1314);
        expect(c.max_hp).toBe(524);
    });

    it('also collapses-and-heals HP when both stats are below the floor', () => {
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        useCharacterStore.getState().setCharacter(
            makeChar({ class: 'Mage', level: 109, highest_level: 109, max_hp: 5, hp: 5, max_mp: 0, mp: 0 }),
        );
        expect(useCharacterStore.getState().healCorruptedBaseStats()).toBe(true);
        const c = useCharacterStore.getState().character!;
        expect(c.max_hp).toBe(514);
        expect(c.max_mp).toBe(1314);
    });

    it('leaves a healthy char untouched (returns false, no mutation)', () => {
        useCharacterStore.getState().setCharacter(
            makeChar({ class: 'Mage', level: 109, highest_level: 109, max_hp: 900, hp: 900, max_mp: 5000, mp: 5000 }),
        );
        const healed = useCharacterStore.getState().healCorruptedBaseStats();
        expect(healed).toBe(false);
        const c = useCharacterStore.getState().character!;
        expect(c.max_mp).toBe(5000);
        expect(c.max_hp).toBe(900);
    });

    it('returns false when no character is loaded', () => {
        useCharacterStore.setState({ character: null });
        expect(useCharacterStore.getState().healCorruptedBaseStats()).toBe(false);
    });

    it('uses highest_level (not current level) so a death-deranked char keeps its floor', () => {
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        useCharacterStore.getState().setCharacter(
            makeChar({ class: 'Mage', level: 50, highest_level: 109, max_mp: 0, mp: 0, max_hp: 524, hp: 524 }),
        );
        expect(useCharacterStore.getState().healCorruptedBaseStats()).toBe(true);
        expect(useCharacterStore.getState().character!.max_mp).toBe(1314);
    });
});
