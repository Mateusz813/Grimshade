
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { applyCombatLeaveDeath } from '../../src/systems/combatLeavePenalty';
import { useCharacterStore, type ICharacter } from '../../src/stores/characterStore';
import { useSkillStore } from '../../src/stores/skillStore';
import { useInventoryStore } from '../../src/stores/inventoryStore';
import { useDeathStore } from '../../src/stores/deathStore';
import { useCombatStore } from '../../src/stores/combatStore';
import { deathsApi } from '../../src/api/v1/deathsApi';
import { EMPTY_EQUIPMENT, buildItem } from '../../src/systems/itemSystem';


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
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }));
    logDeathSpy = vi.spyOn(deathsApi, 'logDeath').mockResolvedValue(null);
});

afterEach(() => {
    fetchSpy.mockRestore();
    logDeathSpy.mockRestore();
});


describe('death penalty cascade: character level + XP', () => {
    it('strips max(0.20, level/100) = 1 level at lvl 100', () => {
        useCharacterStore.getState().setCharacter(makeChar({ level: 100, xp: 5000 }));
        applyCombatLeaveDeath({ source: 'boss', sourceName: 'Boss', sourceLevel: 100 });

        const ch = useCharacterStore.getState().character!;
        expect(ch.level).toBe(99);
        expect(ch.xp).toBe(4925);
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
        expect(ch.hp).toBe(500);
        expect(ch.mp).toBe(100);
    });
});

describe('death penalty cascade: skill XP loss across every trained skill', () => {
    it('shaves 25% of banked XP from every trained skill', () => {
        useCharacterStore.getState().setCharacter(makeChar({ level: 100 }));
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
        expect(sk.skillLevels.sword_fighting).toBeLessThan(20);
        expect(sk.skillLevels.magic_level).toBeLessThan(10);
        expect(sk.skillLevels.shielding).toBeLessThan(8);
        expect(sk.skillLevels.sword_fighting).toBeGreaterThan(0);
    });

    it('purges locked active-skill slots when their unlock level exceeds post-penalty level', () => {
        useCharacterStore.getState().setCharacter(makeChar({ level: 100, xp: 0 }));
        useSkillStore.setState({
            skillLevels: {}, skillXp: {},
            activeSkillSlots: ['shield_bash', 'iron_defense', null, null] as [string | null, string | null, string | null, string | null],
            skillUpgradeLevels: {}, unlockedSkills: { shield_bash: true, iron_defense: true },
            offlineTrainingSkillId: null, trainingSegmentStartedAt: null,
            trainingAccumulatedEffectiveSeconds: 0, trainingCurrentSpeedMultiplier: 2,
        });

        applyCombatLeaveDeath({ source: 'boss', sourceName: 'X', sourceLevel: 100 });

        const slots = useSkillStore.getState().activeSkillSlots;
        expect(slots[0]).toBe('shield_bash');
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
        expect(ev?.skillXpLossPercent).toBe(25);
        expect(ev?.protectionUsed).toBe(false);
        expect(ev?.source).toBe('raid');
    });

    it('logs the death via deathsApi BEFORE the level update (so audit row has pre-penalty level)', () => {
        useCharacterStore.getState().setCharacter(makeChar({ level: 100, xp: 5000 }));
        applyCombatLeaveDeath({ source: 'boss', sourceName: 'B', sourceLevel: 100 });
        expect(logDeathSpy).toHaveBeenCalledTimes(1);
        const payload = logDeathSpy.mock.calls[0][0];
        expect(payload.character_level).toBe(100);
        expect(payload.result).toBe('fled');
    });
});

describe('death penalty cascade: inventory item loss runs but is bounded', () => {
    it('triggers applyDeathItemLoss without protection (protectedByAol=false)', () => {
        useCharacterStore.getState().setCharacter(makeChar({ level: 100 }));
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
        expect(ch.xp).toBe(0);
        expect(useSkillStore.getState().skillLevels.sword_fighting).toBeLessThan(5);
    });
});
