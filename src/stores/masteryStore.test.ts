import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    useMasteryStore,
    MASTERY_KILL_THRESHOLD,
    MASTERY_MAX_LEVEL,
    HEROIC_DROP_RATE_AT_MAX,
    MASTERY_XP_BONUS_PER_LEVEL,
    MASTERY_GOLD_BONUS_PER_LEVEL,
    getMasteryXpMultiplier,
    getMasteryGoldMultiplier,
} from './masteryStore';


vi.mock('./questStore', () => ({
    useQuestStore: {
        getState: () => ({
            refreshMasteryProgress: vi.fn(),
        }),
    },
}));

vi.mock('./characterStore', () => ({
    useCharacterStore: {
        getState: () => ({
            character: { id: 'test-char-id' },
        }),
    },
}));

vi.mock('../api/v1/characterApi', () => ({
    characterApi: {
        bumpStat: vi.fn().mockResolvedValue(undefined),
    },
}));


const resetStore = (): void => {
    useMasteryStore.setState({ masteries: {}, masteryKills: {} });
};


describe('masteryStore — constants', () => {
    it('MASTERY_KILL_THRESHOLD is 5000', () => {
        expect(MASTERY_KILL_THRESHOLD).toBe(5000);
    });

    it('MASTERY_MAX_LEVEL is 25', () => {
        expect(MASTERY_MAX_LEVEL).toBe(25);
    });

    it('HEROIC_DROP_RATE_AT_MAX is 0.005 (0.5%)', () => {
        expect(HEROIC_DROP_RATE_AT_MAX).toBe(0.005);
    });

    it('exposes XP / gold bonus constants at 2% per level', () => {
        expect(MASTERY_XP_BONUS_PER_LEVEL).toBe(0.02);
        expect(MASTERY_GOLD_BONUS_PER_LEVEL).toBe(0.02);
    });
});

describe('masteryStore — getMasteryXpMultiplier / getMasteryGoldMultiplier', () => {
    it('returns 1.0 for level 0', () => {
        expect(getMasteryXpMultiplier(0)).toBe(1);
        expect(getMasteryGoldMultiplier(0)).toBe(1);
    });

    it('returns 1.5 (max) for level 25', () => {
        expect(getMasteryXpMultiplier(25)).toBeCloseTo(1.5, 5);
        expect(getMasteryGoldMultiplier(25)).toBeCloseTo(1.5, 5);
    });

    it('clamps to max even when input exceeds MASTERY_MAX_LEVEL', () => {
        expect(getMasteryXpMultiplier(999)).toBeCloseTo(1.5, 5);
        expect(getMasteryGoldMultiplier(999)).toBeCloseTo(1.5, 5);
    });

    it('clamps to 1.0 when given negative level (defensive)', () => {
        expect(getMasteryXpMultiplier(-5)).toBe(1);
        expect(getMasteryGoldMultiplier(-5)).toBe(1);
    });

    it('scales linearly between 0 and max', () => {
        expect(getMasteryXpMultiplier(10)).toBeCloseTo(1.2, 5);
        expect(getMasteryGoldMultiplier(13)).toBeCloseTo(1.26, 5);
    });
});

describe('masteryStore — addMasteryKills', () => {
    beforeEach(() => {
        resetStore();
    });

    it('records partial progress when kill count is below threshold', () => {
        useMasteryStore.getState().addMasteryKills('rat', 100);
        expect(useMasteryStore.getState().getMasteryKills('rat')).toBe(100);
        expect(useMasteryStore.getState().getMasteryLevel('rat')).toBe(0);
    });

    it('accumulates kills across multiple calls', () => {
        useMasteryStore.getState().addMasteryKills('rat', 1000);
        useMasteryStore.getState().addMasteryKills('rat', 2000);
        expect(useMasteryStore.getState().getMasteryKills('rat')).toBe(3000);
        expect(useMasteryStore.getState().getMasteryLevel('rat')).toBe(0);
    });

    it('levels up at exactly the kill threshold (5000)', () => {
        useMasteryStore.getState().addMasteryKills('rat', MASTERY_KILL_THRESHOLD);
        expect(useMasteryStore.getState().getMasteryLevel('rat')).toBe(1);
        expect(useMasteryStore.getState().getMasteryKills('rat')).toBe(0);
    });

    it('carries over excess kills as progress towards next level', () => {
        useMasteryStore.getState().addMasteryKills('rat', MASTERY_KILL_THRESHOLD + 123);
        expect(useMasteryStore.getState().getMasteryLevel('rat')).toBe(1);
        expect(useMasteryStore.getState().getMasteryKills('rat')).toBe(123);
    });

    it('requires more kills per level as mastery climbs (5000 * (lvl+1))', () => {
        useMasteryStore.getState().addMasteryKills('rat', MASTERY_KILL_THRESHOLD);
        expect(useMasteryStore.getState().getMasteryLevel('rat')).toBe(1);
        useMasteryStore.getState().addMasteryKills('rat', MASTERY_KILL_THRESHOLD * 2);
        expect(useMasteryStore.getState().getMasteryLevel('rat')).toBe(2);
        expect(useMasteryStore.getState().getMasteryKills('rat')).toBe(0);
    });

    it('does NOT advance past MASTERY_MAX_LEVEL (no-op when already maxed)', () => {
        useMasteryStore.setState({
            masteries: { rat: { level: MASTERY_MAX_LEVEL } },
            masteryKills: { rat: 0 },
        });
        useMasteryStore.getState().addMasteryKills('rat', 999_999);
        expect(useMasteryStore.getState().getMasteryLevel('rat')).toBe(MASTERY_MAX_LEVEL);
        expect(useMasteryStore.getState().getMasteryKills('rat')).toBe(0);
    });

    it('zeroes kills at max level (no further tracking)', () => {
        useMasteryStore.setState({
            masteries: { rat: { level: 24 } },
            masteryKills: { rat: 0 },
        });
        useMasteryStore.getState().addMasteryKills('rat', 5000 * 25 + 999);
        expect(useMasteryStore.getState().getMasteryLevel('rat')).toBe(MASTERY_MAX_LEVEL);
        expect(useMasteryStore.getState().getMasteryKills('rat')).toBe(0);
    });

    it('tracks each monster independently', () => {
        useMasteryStore.getState().addMasteryKills('rat', 3000);
        useMasteryStore.getState().addMasteryKills('goblin', 1500);
        expect(useMasteryStore.getState().getMasteryKills('rat')).toBe(3000);
        expect(useMasteryStore.getState().getMasteryKills('goblin')).toBe(1500);
        expect(useMasteryStore.getState().getMasteryKills('skeleton')).toBe(0);
    });
});

describe('masteryStore — addMasteryLevel (deprecated direct level bump)', () => {
    beforeEach(() => {
        resetStore();
    });

    it('increments level by 1 from 0 -> 1', () => {
        useMasteryStore.getState().addMasteryLevel('rat');
        expect(useMasteryStore.getState().getMasteryLevel('rat')).toBe(1);
    });

    it('is a no-op when already at max level', () => {
        useMasteryStore.setState({
            masteries: { rat: { level: MASTERY_MAX_LEVEL } },
            masteryKills: {},
        });
        useMasteryStore.getState().addMasteryLevel('rat');
        expect(useMasteryStore.getState().getMasteryLevel('rat')).toBe(MASTERY_MAX_LEVEL);
    });

    it('handles unknown monsters by initialising at level 1', () => {
        useMasteryStore.getState().addMasteryLevel('unknown_monster');
        expect(useMasteryStore.getState().getMasteryLevel('unknown_monster')).toBe(1);
    });
});

describe('masteryStore — getMasteryLevel', () => {
    beforeEach(() => {
        resetStore();
    });

    it('returns 0 for an unknown monster', () => {
        expect(useMasteryStore.getState().getMasteryLevel('nope')).toBe(0);
    });

    it('returns the stored level for a known monster', () => {
        useMasteryStore.setState({
            masteries: { rat: { level: 7 } },
            masteryKills: {},
        });
        expect(useMasteryStore.getState().getMasteryLevel('rat')).toBe(7);
    });

    it('returns 0 when monsters record exists but is empty', () => {
        useMasteryStore.setState({ masteries: {}, masteryKills: {} });
        expect(useMasteryStore.getState().getMasteryLevel('rat')).toBe(0);
    });
});

describe('masteryStore — getMasteryProgress', () => {
    beforeEach(() => {
        resetStore();
    });

    it('returns zero kills/required/level for an untouched monster', () => {
        const p = useMasteryStore.getState().getMasteryProgress('rat');
        expect(p.level).toBe(0);
        expect(p.kills).toBe(0);
        expect(p.required).toBe(MASTERY_KILL_THRESHOLD);
    });

    it('reports the kills needed for the NEXT level', () => {
        useMasteryStore.setState({
            masteries: { rat: { level: 3 } },
            masteryKills: { rat: 500 },
        });
        const p = useMasteryStore.getState().getMasteryProgress('rat');
        expect(p.level).toBe(3);
        expect(p.kills).toBe(500);
        expect(p.required).toBe(MASTERY_KILL_THRESHOLD * 4);
    });

    it('returns 0 required when at max level', () => {
        useMasteryStore.setState({
            masteries: { rat: { level: MASTERY_MAX_LEVEL } },
            masteryKills: {},
        });
        const p = useMasteryStore.getState().getMasteryProgress('rat');
        expect(p.level).toBe(MASTERY_MAX_LEVEL);
        expect(p.required).toBe(0);
    });
});

describe('masteryStore — getMasteryBonuses', () => {
    beforeEach(() => {
        resetStore();
    });

    it('returns all-zero bonuses for level 0', () => {
        const b = useMasteryStore.getState().getMasteryBonuses('rat');
        expect(b).toEqual({ strong: 0, epic: 0, legendary: 0, mythic: 0, heroic: 0 });
    });

    it('scales bonuses linearly with mastery level', () => {
        useMasteryStore.setState({
            masteries: { rat: { level: 10 } },
            masteryKills: {},
        });
        const b = useMasteryStore.getState().getMasteryBonuses('rat');
        expect(b.strong).toBeCloseTo(10, 5);
        expect(b.epic).toBeCloseTo(5, 5);
        expect(b.legendary).toBeCloseTo(2.5, 5);
        expect(b.mythic).toBeCloseTo(1, 5);
        expect(b.heroic).toBe(0);
    });

    it('unlocks the heroic drop bonus exactly at max level', () => {
        useMasteryStore.setState({
            masteries: { rat: { level: MASTERY_MAX_LEVEL } },
            masteryKills: {},
        });
        const b = useMasteryStore.getState().getMasteryBonuses('rat');
        expect(b.heroic).toBe(HEROIC_DROP_RATE_AT_MAX);
        expect(b.strong).toBeCloseTo(25, 5);
        expect(b.epic).toBeCloseTo(12.5, 5);
    });
});

describe('masteryStore — isMaxMastery', () => {
    beforeEach(() => {
        resetStore();
    });

    it('returns false for level 0', () => {
        expect(useMasteryStore.getState().isMaxMastery('rat')).toBe(false);
    });

    it('returns false for any level below max', () => {
        useMasteryStore.setState({
            masteries: { rat: { level: MASTERY_MAX_LEVEL - 1 } },
            masteryKills: {},
        });
        expect(useMasteryStore.getState().isMaxMastery('rat')).toBe(false);
    });

    it('returns true exactly at max level', () => {
        useMasteryStore.setState({
            masteries: { rat: { level: MASTERY_MAX_LEVEL } },
            masteryKills: {},
        });
        expect(useMasteryStore.getState().isMaxMastery('rat')).toBe(true);
    });
});

describe('masteryStore — getMasteryData', () => {
    beforeEach(() => {
        resetStore();
    });

    it('returns a default { level: 0 } object for unknown monsters', () => {
        expect(useMasteryStore.getState().getMasteryData('nope')).toEqual({ level: 0 });
    });

    it('returns the stored data for known monsters', () => {
        useMasteryStore.setState({
            masteries: { rat: { level: 12 } },
            masteryKills: {},
        });
        expect(useMasteryStore.getState().getMasteryData('rat')).toEqual({ level: 12 });
    });
});
