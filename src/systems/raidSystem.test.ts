import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    getRaidWaveCount,
    getAllRaids,
    getRaidById,
    estimateRaidRewards,
    generateWaveBosses,
    rollMemberRewards,
    todayIso,
} from './raidSystem';
import type { IRaid, IRaidMemberState } from '../types/raid';

// -- Helpers ------------------------------------------------------------------

const makeMember = (id: string = 'm1'): IRaidMemberState => ({
    id,
    name: id,
    class: 'Knight',
    level: 50,
    maxHp: 1500,
    hp: 1500,
    maxMp: 300,
    mp: 300,
    attack: 100,
    defense: 60,
    isDead: false,
    isBot: false,
    hasEscaped: false,
    color: '#888',
    transformTier: 0,
});

// -- getRaidWaveCount ---------------------------------------------------------

describe('getRaidWaveCount', () => {
    it('returns 1 for raids lvl ≤ 10', () => {
        expect(getRaidWaveCount(1)).toBe(1);
        expect(getRaidWaveCount(5)).toBe(1);
        expect(getRaidWaveCount(10)).toBe(1);
    });

    it('returns 2 for raids lvl 11–50', () => {
        expect(getRaidWaveCount(11)).toBe(2);
        expect(getRaidWaveCount(30)).toBe(2);
        expect(getRaidWaveCount(50)).toBe(2);
    });

    it('returns 3 for raids lvl 51–200', () => {
        expect(getRaidWaveCount(51)).toBe(3);
        expect(getRaidWaveCount(100)).toBe(3);
        expect(getRaidWaveCount(200)).toBe(3);
    });

    it('returns 4 for raids lvl 201–500', () => {
        expect(getRaidWaveCount(201)).toBe(4);
        expect(getRaidWaveCount(350)).toBe(4);
        expect(getRaidWaveCount(500)).toBe(4);
    });

    it('returns 5 for raids lvl > 500', () => {
        expect(getRaidWaveCount(501)).toBe(5);
        expect(getRaidWaveCount(750)).toBe(5);
        expect(getRaidWaveCount(1000)).toBe(5);
    });

    it('is monotonically non-decreasing', () => {
        for (let lvl = 1; lvl < 1000; lvl += 50) {
            expect(getRaidWaveCount(lvl + 1)).toBeGreaterThanOrEqual(getRaidWaveCount(lvl));
        }
    });
});

// -- getAllRaids --------------------------------------------------------------

describe('getAllRaids', () => {
    it('returns at least one raid', () => {
        const raids = getAllRaids();
        expect(raids.length).toBeGreaterThan(0);
    });

    it('every raid has the required fields', () => {
        const raids = getAllRaids();
        for (const r of raids) {
            expect(r.id).toMatch(/^raid_/);
            expect(typeof r.name_pl).toBe('string');
            expect(r.name_pl.length).toBeGreaterThan(0);
            expect(r.level).toBeGreaterThan(0);
            expect(r.waves).toBeGreaterThanOrEqual(1);
            expect(r.waves).toBeLessThanOrEqual(5);
            expect(r.sourceDungeonId).toMatch(/^dungeon_/);
            expect(r.dailyAttempts).toBe(5);
        }
    });

    it('every raid has unique id', () => {
        const ids = getAllRaids().map((r) => r.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('every raid id derives from its source dungeon id', () => {
        const raids = getAllRaids();
        for (const r of raids) {
            const expectedSuffix = r.sourceDungeonId.replace('dungeon_', '');
            expect(r.id).toBe(`raid_${expectedSuffix}`);
        }
    });

    it('wave count matches getRaidWaveCount for the raid level', () => {
        const raids = getAllRaids();
        for (const r of raids) {
            expect(r.waves).toBe(getRaidWaveCount(r.level));
        }
    });

    it('returns a fresh array each call (independence)', () => {
        const a = getAllRaids();
        const b = getAllRaids();
        expect(a).not.toBe(b);
        // But shape should be equal.
        expect(a.length).toBe(b.length);
    });
});

// -- getRaidById --------------------------------------------------------------

describe('getRaidById', () => {
    it('returns null for non-existent id', () => {
        expect(getRaidById('raid_does_not_exist_999')).toBeNull();
    });

    it('returns null for empty string', () => {
        expect(getRaidById('')).toBeNull();
    });

    it('returns the correct raid for a known id', () => {
        // Use the first raid as a known fixture.
        const first = getAllRaids()[0];
        const fetched = getRaidById(first.id);
        expect(fetched).not.toBeNull();
        expect(fetched?.id).toBe(first.id);
        expect(fetched?.level).toBe(first.level);
    });
});

// -- estimateRaidRewards ------------------------------------------------------

describe('estimateRaidRewards', () => {
    it('returns goldMin <= goldMax', () => {
        for (const raid of getAllRaids()) {
            const est = estimateRaidRewards(raid);
            expect(est.goldMin).toBeLessThanOrEqual(est.goldMax);
        }
    });

    it('returns positive xp/gold for any raid', () => {
        for (const raid of getAllRaids()) {
            const est = estimateRaidRewards(raid);
            expect(est.xp).toBeGreaterThan(0);
            expect(est.goldMin).toBeGreaterThan(0);
            expect(est.goldMax).toBeGreaterThan(0);
        }
    });

    it('higher-level raids award more XP (level bonus dominates)', () => {
        const raids = getAllRaids().sort((a, b) => a.level - b.level);
        const low = estimateRaidRewards(raids[0]);
        const high = estimateRaidRewards(raids[raids.length - 1]);
        expect(high.xp).toBeGreaterThan(low.xp);
    });

    it('uses level² as the XP bonus floor (lvl 1 raid still includes +1)', () => {
        // For any raid, est.xp >= level² (the completion bonus alone).
        // Per-kill xp is also added, so the inequality is strict, but we
        // verify the lower bound to lock the formula shape.
        for (const raid of getAllRaids()) {
            const est = estimateRaidRewards(raid);
            expect(est.xp).toBeGreaterThanOrEqual(raid.level * raid.level);
        }
    });
});

// -- generateWaveBosses -------------------------------------------------------

describe('generateWaveBosses', () => {
    const raid: IRaid = getAllRaids()[0];

    it('returns exactly 4 boss slots per wave', () => {
        const bosses = generateWaveBosses(raid, 0);
        expect(bosses).toHaveLength(4);
    });

    it('every boss starts at full HP', () => {
        const bosses = generateWaveBosses(raid, 0);
        for (const b of bosses) {
            expect(b.currentHp).toBe(b.maxHp);
            expect(b.maxHp).toBeGreaterThan(0);
        }
    });

    it('every boss starts not dead', () => {
        const bosses = generateWaveBosses(raid, 0);
        for (const b of bosses) {
            expect(b.isDead).toBe(false);
        }
    });

    it('every boss has positive attack & defense', () => {
        const bosses = generateWaveBosses(raid, 0);
        for (const b of bosses) {
            expect(b.attack).toBeGreaterThan(0);
            expect(b.defense).toBeGreaterThan(0);
        }
    });

    it('every boss in a wave has unique id', () => {
        const bosses = generateWaveBosses(raid, 0);
        const ids = bosses.map((b) => b.id);
        expect(new Set(ids).size).toBe(bosses.length);
    });

    it('bosses are labelled with their slotIdx', () => {
        const bosses = generateWaveBosses(raid, 0);
        for (let i = 0; i < bosses.length; i++) {
            expect(bosses[i].slotIdx).toBe(i);
            expect(bosses[i].waveIdx).toBe(0);
            expect(bosses[i].name).toContain(`#${i + 1}`);
        }
    });

    it('later waves are harder than wave 0 (HP higher)', () => {
        // Use a multi-wave raid (lvl > 10).
        const multiWaveRaid = getAllRaids().find((r) => r.waves >= 2);
        if (!multiWaveRaid) {
            // Skip: every raid is single-wave (shouldn't happen with
            // bestiary as-is, but bail gracefully if it does).
            return;
        }
        const wave0 = generateWaveBosses(multiWaveRaid, 0);
        const wave1 = generateWaveBosses(multiWaveRaid, 1);
        // Compare averages because per-slot HPs are identical between
        // bosses in the same wave (no per-slot randomness in this code).
        const avg0 = wave0.reduce((s, b) => s + b.maxHp, 0) / wave0.length;
        const avg1 = wave1.reduce((s, b) => s + b.maxHp, 0) / wave1.length;
        expect(avg1).toBeGreaterThan(avg0);
    });

    it('wave index carries to every boss slot', () => {
        const bosses = generateWaveBosses(raid, 3);
        for (const b of bosses) {
            expect(b.waveIdx).toBe(3);
        }
    });
});

// -- rollMemberRewards --------------------------------------------------------

describe('rollMemberRewards', () => {
    let randomSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        // Pin Math.random to 0.5 by default — deterministic mid-range rolls.
        randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    });

    afterEach(() => {
        randomSpy.mockRestore();
    });

    it('returns 0 XP / 0 gold when 0 bosses defeated', () => {
        const raid = getAllRaids()[0];
        const result = rollMemberRewards({ member: makeMember(), raid, bossesDefeated: 0 });
        // No bosses defeated AND no completion bonus -> 0 across the board
        // (cleared check is bossesDefeated >= waves*4; 0 fails that).
        expect(result.xp).toBe(0);
        expect(result.gold).toBe(0);
    });

    it('awards positive XP/gold for any boss kill', () => {
        const raid = getAllRaids()[0];
        const result = rollMemberRewards({ member: makeMember(), raid, bossesDefeated: 1 });
        expect(result.xp).toBeGreaterThan(0);
        expect(result.gold).toBeGreaterThan(0);
    });

    it('XP and gold scale roughly linearly with bosses defeated', () => {
        const raid = getAllRaids()[5]; // some mid-level raid
        const one = rollMemberRewards({ member: makeMember(), raid, bossesDefeated: 1 });
        const two = rollMemberRewards({ member: makeMember(), raid, bossesDefeated: 2 });
        // 2 kills should be more than 1 kill (linear-ish, ignoring bonus).
        expect(two.xp).toBeGreaterThan(one.xp);
        expect(two.gold).toBeGreaterThan(one.gold);
    });

    it('full clear awards the level completion bonus', () => {
        const raid = getAllRaids()[0];
        const totalSlots = raid.waves * 4;
        const partial = rollMemberRewards({ member: makeMember(), raid, bossesDefeated: totalSlots - 1 });
        const full = rollMemberRewards({ member: makeMember(), raid, bossesDefeated: totalSlots });
        // The completion bonus is `raid.level²` XP + `raid.level * 1000` gold,
        // PLUS the bonus from one extra kill — so full > partial by at least
        // the completion bonus delta.
        expect(full.xp).toBeGreaterThan(partial.xp);
        expect(full.gold).toBeGreaterThan(partial.gold);
    });

    it('emits drops for every defeated boss', () => {
        const raid = getAllRaids()[5];
        const member = makeMember();
        const result = rollMemberRewards({ member, raid, bossesDefeated: 2 });
        // Always includes xp + gold lines at minimum, plus per-boss rolls.
        expect(result.drops.length).toBeGreaterThanOrEqual(2);
        // Every drop is keyed to this member id.
        for (const d of result.drops) {
            expect(d.memberId).toBe(member.id);
        }
    });

    it('drops include an xp-kind and gold-kind line', () => {
        const raid = getAllRaids()[0];
        const result = rollMemberRewards({ member: makeMember(), raid, bossesDefeated: 1 });
        const kinds = result.drops.map((d) => d.kind);
        expect(kinds).toContain('xp');
        expect(kinds).toContain('gold');
    });

    it('XP and gold drop lines match the returned amounts', () => {
        const raid = getAllRaids()[0];
        const result = rollMemberRewards({ member: makeMember(), raid, bossesDefeated: 1 });
        const xpLine = result.drops.find((d) => d.kind === 'xp');
        const goldLine = result.drops.find((d) => d.kind === 'gold');
        expect(xpLine?.amount).toBe(result.xp);
        expect(goldLine?.amount).toBe(result.gold);
    });

    it('always rolls an upgrade stone per boss (chances sum to 100%)', () => {
        const raid = getAllRaids()[0];
        const result = rollMemberRewards({ member: makeMember(), raid, bossesDefeated: 3 });
        const stones = result.drops.filter((d) => d.kind === 'upgrade_stone');
        expect(stones.length).toBe(3);
    });

    it('always rolls a completion-bonus item (guaranteed per spec)', () => {
        const raid = getAllRaids()[0];
        const result = rollMemberRewards({ member: makeMember(), raid, bossesDefeated: 1 });
        const bonusItem = result.drops.find((d) => d.kind === 'item' && d.isBonus === true);
        expect(bonusItem).toBeDefined();
        expect(bonusItem?.rarity).toBeDefined();
    });

    it('member id propagates to every drop entry', () => {
        const raid = getAllRaids()[0];
        const member = makeMember('hero42');
        const result = rollMemberRewards({ member, raid, bossesDefeated: 2 });
        for (const d of result.drops) {
            expect(d.memberId).toBe('hero42');
        }
    });

    it('with Math.random=0 picks the first rarity in every roll table', () => {
        // First entry in ITEM_RARITY_CHANCES is 'heroic'.
        // First in STONE_DROPS is 'heroic'.
        // First in COMPLETION_ROLL is 'heroic'.
        randomSpy.mockReturnValue(0);
        const raid = getAllRaids()[0];
        const result = rollMemberRewards({ member: makeMember(), raid, bossesDefeated: 1 });
        const stoneLine = result.drops.find((d) => d.kind === 'upgrade_stone');
        expect(stoneLine?.rarity).toBe('heroic');
    });

    it('items array is populated with generated items', () => {
        const raid = getAllRaids()[0];
        const result = rollMemberRewards({ member: makeMember(), raid, bossesDefeated: 1 });
        // At minimum the completion bonus item lands here.
        expect(result.items.length).toBeGreaterThanOrEqual(1);
        for (const item of result.items) {
            expect(item.uuid).toBeDefined();
            expect(item.itemId).toBeDefined();
            expect(item.rarity).toBeDefined();
        }
    });
});

// -- todayIso -----------------------------------------------------------------

describe('todayIso', () => {
    it('returns YYYY-MM-DD format', () => {
        const iso = todayIso();
        expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('matches today (slice of current ISO)', () => {
        const expected = new Date().toISOString().slice(0, 10);
        expect(todayIso()).toBe(expected);
    });

    it('is stable when called twice in quick succession', () => {
        const a = todayIso();
        const b = todayIso();
        expect(a).toBe(b);
    });
});
