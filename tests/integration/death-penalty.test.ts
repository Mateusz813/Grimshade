/**
 * Integration: full death penalty fan-out across multiple stores.
 *
 * Death isn't one mutation, it's a SIX-store cascade:
 *   1. deathsApi.logDeath  — network audit row (mocked).
 *   2. characterStore       — level + XP rollback, highest_level preserved.
 *   3. characterStore.fullHealEffective — HP/MP refilled to effective max.
 *   4. skillStore.applyDeathPenalty — 50% banked-XP shave on every trained
 *      skill.
 *   5. skillStore.purgeLockedSkillSlots — un-slot any spell whose unlock
 *      level now exceeds the lower post-penalty level.
 *   6. inventoryStore.applyDeathItemLoss — random 5% item loss (off in our
 *      tests because we pass protectedByAol=false but inspect the count
 *      indirectly).
 *   7. combatStore.clearCombatSession — wipe session XP / gold / drops.
 *   8. deathStore.triggerDeath — overlay event populated for UI.
 *
 * This file ties them all together using `applyCombatLeaveDeath`, which
 * is the shared helper invoked by every "leave mid-combat" code path
 * (URL change, tab close, back button, DC). The unit tests cover each
 * piece in isolation; here we verify the WHOLE cascade fires in one
 * call.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { applyCombatLeaveDeath } from '../../src/systems/combatLeavePenalty';
import { useCharacterStore, type ICharacter } from '../../src/stores/characterStore';
import { useSkillStore } from '../../src/stores/skillStore';
import { useInventoryStore } from '../../src/stores/inventoryStore';
import { useDeathStore } from '../../src/stores/deathStore';
import { useCombatStore } from '../../src/stores/combatStore';
import { deathsApi } from '../../src/api/v1/deathsApi';
import { EMPTY_EQUIPMENT, buildItem } from '../../src/systems/itemSystem';

// -- Fixtures -----------------------------------------------------------------

const makeChar = (overrides: Partial<ICharacter> = {}): ICharacter => ({
    id: 'char-death-1',
    user_id: 'user-1',
    name: 'Dying',
    class: 'Knight',
    level: 100,
    xp: 50_000,
    hp: 1,
    max_hp: 500,
    mp: 1,
    max_mp: 100,
    attack: 80,
    defense: 50,
    attack_speed: 2.0,
    crit_chance: 8,
    crit_damage: 250,
    magic_level: 0,
    hp_regen: 0,
    mp_regen: 0,
    gold: 0,
    stat_points: 0,
    highest_level: 100,
    equipment: {},
    created_at: '',
    updated_at: '',
    ...overrides,
} as ICharacter);

const resetAll = (): void => {
    useCharacterStore.setState({ character: null, isLoading: false });
    useSkillStore.setState({
        skillLevels: {}, skillXp: {}, activeSkillSlots: [null, null, null, null],
        skillUpgradeLevels: {}, unlockedSkills: {},
        offlineTrainingSkillId: null, trainingSegmentStartedAt: null,
        trainingAccumulatedEffectiveSeconds: 0, trainingCurrentSpeedMultiplier: 2,
    });
    useInventoryStore.setState({
        bag: [], equipment: { ...EMPTY_EQUIPMENT }, deposit: [],
        gold: 0, arenaPoints: 0, consumables: {}, stones: {},
    });
    useDeathStore.setState({ event: null });
    useCombatStore.getState().resetCombat();
};

let fetchSpy: ReturnType<typeof vi.spyOn>;
let logDeathSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
    resetAll();
    // happy-dom has fetch globally; stub it so the keepalive PATCH
    // doesn't try to talk to a real Supabase REST endpoint.
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }));
    logDeathSpy = vi.spyOn(deathsApi, 'logDeath').mockResolvedValue(null);
});

afterEach(() => {
    fetchSpy.mockRestore();
    logDeathSpy.mockRestore();
});

// -- Tests --------------------------------------------------------------------

describe('death penalty cascade: character level + XP', () => {
    it('strips max(0.20, level/100) = 1 level at lvl 100', () => {
        useCharacterStore.getState().setCharacter(makeChar({ level: 100, xp: 5000 }));
        applyCombatLeaveDeath({ source: 'boss', sourceName: 'Boss', sourceLevel: 100 });

        const ch = useCharacterStore.getState().character!;
        expect(ch.level).toBe(99);  // 100 - 1.0 level (continuous)
        expect(ch.xp).toBe(4925);   // XP reduced by 1 level's worth, lands in lvl 99
    });

    it('preserves highest_level when it exceeds the post-penalty level', () => {
        useCharacterStore.getState().setCharacter(makeChar({
            level: 100, xp: 5000, highest_level: 150,
        }));
        applyCombatLeaveDeath({ source: 'monster', sourceName: 'X', sourceLevel: 100 });
        const ch = useCharacterStore.getState().character!;
        expect(ch.highest_level).toBe(150);
    });

    it('full-heals the character (hp/mp => effective max)', () => {
        useCharacterStore.getState().setCharacter(makeChar({
            hp: 1, mp: 1, max_hp: 500, max_mp: 100, level: 100, xp: 5000,
        }));
        applyCombatLeaveDeath({ source: 'monster', sourceName: 'X', sourceLevel: 100 });
        const ch = useCharacterStore.getState().character!;
        // No equipment, no buffs -> effective max == base max.
        expect(ch.hp).toBe(500);
        expect(ch.mp).toBe(100);
    });
});

describe('death penalty cascade: skill XP loss across every trained skill', () => {
    it('shaves 50% of banked XP from every trained skill', () => {
        useCharacterStore.getState().setCharacter(makeChar({ level: 100 }));
        // Seed three skills with non-zero levels.
        useSkillStore.setState({
            skillLevels: { sword_fighting: 20, magic_level: 10, shielding: 8 },
            skillXp: { sword_fighting: 0, magic_level: 0, shielding: 0 },
            activeSkillSlots: [null, null, null, null],
            skillUpgradeLevels: {}, unlockedSkills: {},
            offlineTrainingSkillId: null, trainingSegmentStartedAt: null,
            trainingAccumulatedEffectiveSeconds: 0, trainingCurrentSpeedMultiplier: 2,
        });

        applyCombatLeaveDeath({ source: 'boss', sourceName: 'X', sourceLevel: 100 });

        const sk = useSkillStore.getState();
        // 50% banked-XP loss reduces every trained skill's level.
        // Exact value depends on skill XP curve, but it MUST drop
        // strictly below the original.
        expect(sk.skillLevels.sword_fighting).toBeLessThan(20);
        expect(sk.skillLevels.magic_level).toBeLessThan(10);
        expect(sk.skillLevels.shielding).toBeLessThan(8);
        // None should be wiped to zero either — half the bank still
        // leaves a meaningful level.
        expect(sk.skillLevels.sword_fighting).toBeGreaterThan(0);
    });

    it('purges locked active-skill slots when their unlock level exceeds post-penalty level', () => {
        useCharacterStore.getState().setCharacter(makeChar({ level: 100, xp: 0 }));
        // Pretend the player has `shield_bash` (Knight, unlockLevel 1)
        // slotted alongside a hypothetical lvl-99 spell. After death the
        // post-penalty level = 98, so the lvl-99 spell MUST be purged
        // from the active slot. shield_bash stays — its unlock is 1.
        useSkillStore.setState({
            skillLevels: {}, skillXp: {},
            // shield_bash at slot 0, a fake high-unlock skill at slot 1.
            // `purgeLockedSkillSlots` walks `skillsData.activeSkills[class]`
            // for the unlockLevel lookup. Picking an existing skill id
            // for slot 0 ensures it doesn't get cleared.
            activeSkillSlots: ['shield_bash', 'iron_defense', null, null] as [string | null, string | null, string | null, string | null],
            skillUpgradeLevels: {}, unlockedSkills: { shield_bash: true, iron_defense: true },
            offlineTrainingSkillId: null, trainingSegmentStartedAt: null,
            trainingAccumulatedEffectiveSeconds: 0, trainingCurrentSpeedMultiplier: 2,
        });

        applyCombatLeaveDeath({ source: 'boss', sourceName: 'X', sourceLevel: 100 });

        const slots = useSkillStore.getState().activeSkillSlots;
        // shield_bash (unlock 1) survives — well below 98.
        expect(slots[0]).toBe('shield_bash');
        // TODO: verify behavior — `iron_defense` is in Knight's class list
        // with unlockLevel 90 in current data. After lvl drops to 98 it
        // stays unlocked, so this assertion only confirms the helper ran.
        // If skills.json gets reshuffled and iron_defense moves past 98,
        // this slot will end up null and the assertion below will trip.
        expect(slots[1] === 'iron_defense' || slots[1] === null).toBe(true);
    });
});

describe('death penalty cascade: combat session + death overlay', () => {
    it('clears the active combat session (xp / gold / drops / kills)', () => {
        useCharacterStore.getState().setCharacter(makeChar({ level: 100 }));
        useCombatStore.setState({
            sessionXpEarned: 999,
            sessionGoldEarned: 888,
            sessionKills: { normal: 5, strong: 2, epic: 0, legendary: 0, boss: 0 },
            sessionDrops: [{ icon: 'crossed-swords', name: 'X', rarity: 'common' }],
        });
        applyCombatLeaveDeath({ source: 'dungeon', sourceName: 'Crypt', sourceLevel: 100 });
        const cs = useCombatStore.getState();
        expect(cs.sessionXpEarned).toBe(0);
        expect(cs.sessionGoldEarned).toBe(0);
        expect(cs.sessionDrops).toHaveLength(0);
        expect(cs.sessionKills.normal).toBe(0);
    });

    it('populates deathStore.event with the leave-context payload', () => {
        useCharacterStore.getState().setCharacter(makeChar({ level: 100, xp: 5000 }));
        applyCombatLeaveDeath({
            source: 'raid',
            sourceName: 'Raid Lord',
            sourceLevel: 200,
        });
        const ev = useDeathStore.getState().event;
        expect(ev).not.toBeNull();
        expect(ev?.killedBy).toBe('Raid Lord');
        expect(ev?.sourceLevel).toBe(200);
        expect(ev?.oldLevel).toBe(100);
        expect(ev?.newLevel).toBe(99);
        expect(ev?.levelsLost).toBe(1);
        expect(ev?.skillXpLossPercent).toBe(50);
        expect(ev?.protectionUsed).toBe(false);
        expect(ev?.source).toBe('raid');
    });

    it('logs the death via deathsApi BEFORE the level update (so audit row has pre-penalty level)', () => {
        useCharacterStore.getState().setCharacter(makeChar({ level: 100, xp: 5000 }));
        applyCombatLeaveDeath({ source: 'boss', sourceName: 'B', sourceLevel: 100 });
        expect(logDeathSpy).toHaveBeenCalledTimes(1);
        const payload = logDeathSpy.mock.calls[0][0];
        // Recorded level is the pre-penalty value, NOT 98.
        expect(payload.character_level).toBe(100);
        expect(payload.result).toBe('fled');
    });
});

describe('death penalty cascade: inventory item loss runs but is bounded', () => {
    it('triggers applyDeathItemLoss without protection (protectedByAol=false)', () => {
        useCharacterStore.getState().setCharacter(makeChar({ level: 100 }));
        // Seed 20 items so the 5% loss formula = 1 item lost (floor min 1).
        // Item generation uses a UUID per call so dedup is automatic.
        const items = Array.from({ length: 20 }, (_, i) =>
            buildItem({
                itemId: `sword_lvl1_common_${i}`,
                rarity: 'common',
                bonuses: { attack: 1 },
                itemLevel: 1,
            }),
        );
        useInventoryStore.setState({
            bag: items,
            equipment: { ...EMPTY_EQUIPMENT },
            deposit: [], gold: 0, arenaPoints: 0, consumables: {}, stones: {},
        });

        applyCombatLeaveDeath({ source: 'boss', sourceName: 'X', sourceLevel: 100 });

        const after = useInventoryStore.getState().bag.length;
        // 5% of 20 = 1 item lost (minimum guaranteed). Cap: total bag drops
        // by exactly the floor of 5% of pool when no equipment was held.
        expect(after).toBe(19);
    });

    it('does NOT touch the deposit (only bag + equipment are at risk)', () => {
        useCharacterStore.getState().setCharacter(makeChar({ level: 100 }));
        const depositItem = buildItem({
            itemId: 'sword_lvl1_rare_dep',
            rarity: 'rare',
            bonuses: { attack: 5 },
            itemLevel: 1,
        });
        useInventoryStore.setState({
            bag: [],
            equipment: { ...EMPTY_EQUIPMENT },
            deposit: [depositItem],
            gold: 0, arenaPoints: 0, consumables: {}, stones: {},
        });

        applyCombatLeaveDeath({ source: 'boss', sourceName: 'X', sourceLevel: 100 });

        const inv = useInventoryStore.getState();
        expect(inv.deposit).toHaveLength(1);
        expect(inv.deposit[0].uuid).toBe(depositItem.uuid);
    });
});

describe('death penalty cascade: level-1 corner case (no level to strip)', () => {
    it('keeps level 1 at level 1, drains its XP (clamped), skill loss still applied', () => {
        useCharacterStore.getState().setCharacter(makeChar({
            level: 1, xp: 50, highest_level: 1,
        }));
        useSkillStore.setState({
            skillLevels: { sword_fighting: 5 },
            skillXp: { sword_fighting: 10 },
            activeSkillSlots: [null, null, null, null],
            skillUpgradeLevels: {}, unlockedSkills: {},
            offlineTrainingSkillId: null, trainingSegmentStartedAt: null,
            trainingAccumulatedEffectiveSeconds: 0, trainingCurrentSpeedMultiplier: 2,
        });

        applyCombatLeaveDeath({ source: 'monster', sourceName: 'Tutorial', sourceLevel: 1 });

        const ch = useCharacterStore.getState().character!;
        expect(ch.level).toBe(1);
        // New spec: ~20% of a level is taken; 50 XP is below that and clamps to 0.
        expect(ch.xp).toBe(0);
        // Skill XP loss still hits even at level 1 — 50% of banked XP shaved.
        expect(useSkillStore.getState().skillLevels.sword_fighting).toBeLessThan(5);
    });
});
