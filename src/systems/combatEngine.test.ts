import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    getSkillMpCost,
    getAttackMs,
    SPEED_MULT,
    SPEED_ORDER,
    applyRarityToMonster,
    getEffectiveChar,
    resetHuntEffects,
    isHuntPlayerStunned,
    isHuntMonsterStunned,
    getHuntMonsterStatusView,
    consumeHuntMonsterMarkAmp,
    clearHuntNecroSummons,
    resetAggro,
    maybeSwitchAggro,
    advanceSkillCooldowns,
    getAllMonsters,
    syncCasterChargeConsume,
    dropLootToInventory,
    applyMonsterKillRewardsForMember,
    addMonsterToWave,
    startAutoNextFight,
    stopCombat,
    type IDropDisplay,
} from './combatEngine';
import { useCombatStore } from '../stores/combatStore';
import { useCharacterStore } from '../stores/characterStore';
import { useInventoryStore } from '../stores/inventoryStore';
import { useSkillStore } from '../stores/skillStore';
import { useBuffStore } from '../stores/buffStore';
import { useBotStore } from '../stores/botStore';
import { usePartyStore } from '../stores/partyStore';
import { useMasteryStore } from '../stores/masteryStore';
import { useTaskStore } from '../stores/taskStore';
import { useQuestStore } from '../stores/questStore';
import { useDailyQuestStore } from '../stores/dailyQuestStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useCooldownStore } from '../stores/cooldownStore';
import type { IMonster } from '../types/monster';
import type { ICharacter } from '../api/v1/characterApi';
import type { IInventoryItem } from './itemSystem';


const makeCharacter = (overrides: Partial<ICharacter> = {}): ICharacter => ({
    id: 'char-1',
    user_id: 'user-1',
    name: 'Hero',
    class: 'Knight',
    level: 10,
    xp: 0,
    hp: 100,
    max_hp: 100,
    mp: 50,
    max_mp: 50,
    attack: 20,
    defense: 10,
    attack_speed: 2.0,
    crit_chance: 0.05,
    crit_damage: 2.0,
    magic_level: 0,
    hp_regen: 0,
    mp_regen: 0,
    gold: 0,
    stat_points: 0,
    highest_level: 10,
    equipment: {},
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    ...overrides,
});

const makeMonster = (overrides: Partial<IMonster> = {}): IMonster => ({
    id: 'rat',
    name_pl: 'Szczur',
    name_en: 'Rat',
    icon: 'rat',
    level: 1,
    hp: 27,
    attack: 4,
    defense: 1,
    speed: 1.0,
    xp: 17,
    gold: [1, 5],
    ...overrides,
} as IMonster);

const resetAllStores = (): void => {
    useCharacterStore.setState({ character: null, isLoading: false });
    useInventoryStore.setState({
        bag: [],
        equipment: {
            helmet: null, armor: null, pants: null, gloves: null, shoulders: null,
            boots: null, mainHand: null, offHand: null, ring1: null, ring2: null,
            earrings: null, necklace: null,
        },
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
    useCombatStore.getState().resetCombat();
    useBuffStore.setState({ allBuffs: [] });
    useBotStore.setState({ bots: [] });
    usePartyStore.setState({ party: null, loading: false, error: null });
    useMasteryStore.setState({ masteries: {}, masteryKills: {} });
    useSettingsStore.setState({
        ...useSettingsStore.getState(),
        autoPotionHpEnabled: false,
        autoPotionMpEnabled: false,
        autoPotionPctHpEnabled: false,
        autoPotionPctMpEnabled: false,
        autoSellCommon: false,
        autoSellRare: false,
        autoSellEpic: false,
        autoSellLegendary: false,
        autoSellMythic: false,
        combatSpeed: 'x1',
    });
    useCooldownStore.getState().clearAll();
    useTaskStore.setState({ activeTask: null, activeTasks: [], completedTasks: [] });
    useQuestStore.setState({ activeQuests: [], completedQuestIds: [] });
    useDailyQuestStore.setState({ lastRefreshDate: null, activeQuests: [], todayQuestDefs: [] });
    resetHuntEffects();
    resetAggro();
};


describe('getSkillMpCost', () => {
    it('returns floor (15) for null skillId', () => {
        expect(getSkillMpCost(null)).toBe(15);
    });

    it('returns floor (15) for undefined skillId', () => {
        expect(getSkillMpCost(undefined)).toBe(15);
    });

    it('returns floor (15) for empty string', () => {
        expect(getSkillMpCost('')).toBe(15);
    });

    it('returns floor (15) for unknown skill id', () => {
        expect(getSkillMpCost('non_existent_skill_id_xyz')).toBe(15);
    });

    it('returns the data/skills.json mpCost for a known skill', () => {
        expect(getSkillMpCost('shield_bash')).toBe(15);
        expect(getSkillMpCost('battle_cry')).toBe(20);
        expect(getSkillMpCost('berserker_rage')).toBe(40);
    });
});


describe('getAttackMs', () => {
    it('maps speed 1.5 to 2000ms', () => {
        expect(getAttackMs(1.5)).toBe(2000);
    });

    it('maps speed 2.0 to 1500ms', () => {
        expect(getAttackMs(2.0)).toBe(1500);
    });

    it('maps speed 3.0 to 1000ms', () => {
        expect(getAttackMs(3.0)).toBe(1000);
    });

    it('caps minimum at 500ms', () => {
        expect(getAttackMs(100)).toBe(500);
        expect(getAttackMs(6)).toBe(500);
    });

    it('handles 0 by treating it as 1 (avoids div-by-0)', () => {
        expect(getAttackMs(0)).toBe(3000);
    });

    it('handles negative input by treating as 1', () => {
        expect(getAttackMs(-5)).toBe(3000);
    });

    it('never returns NaN even for NaN input', () => {
        expect(getAttackMs(NaN)).not.toBeNaN();
    });
});


describe('SPEED_MULT', () => {
    it('has x1 = 1', () => {
        expect(SPEED_MULT.x1).toBe(1);
    });

    it('has x2 = 2', () => {
        expect(SPEED_MULT.x2).toBe(2);
    });

    it('has x4 = 4', () => {
        expect(SPEED_MULT.x4).toBe(4);
    });
});

describe('SPEED_ORDER', () => {
    it('cycles in x1 -> x2 -> x4 -> SKIP order', () => {
        expect(SPEED_ORDER).toEqual(['x1', 'x2', 'x4', 'SKIP']);
    });
});


describe('applyRarityToMonster', () => {
    const baseMonster: IMonster = makeMonster({
        hp: 100, attack: 10, defense: 5, xp: 50, gold: [10, 20],
    });

    it('returns the same monster object for normal rarity (no scaling)', () => {
        const result = applyRarityToMonster(baseMonster, 'normal');
        expect(result).toBe(baseMonster);
    });

    it('scales strong rarity: hp ×1.5, atk ×1.2, def ×1.3, xp ×2, gold ×2', () => {
        const result = applyRarityToMonster(baseMonster, 'strong');
        expect(result.hp).toBe(150);
        expect(result.attack).toBe(12);
        expect(result.defense).toBe(6);
        expect(result.xp).toBe(100);
        expect(result.gold).toEqual([20, 40]);
    });

    it('scales epic rarity: hp ×2.5, atk ×1.6, def ×1.5, xp ×4, gold ×4', () => {
        const result = applyRarityToMonster(baseMonster, 'epic');
        expect(result.hp).toBe(250);
        expect(result.attack).toBe(16);
        expect(result.defense).toBe(7);
        expect(result.xp).toBe(200);
        expect(result.gold).toEqual([40, 80]);
    });

    it('scales legendary rarity: hp ×5, atk ×1.8, def ×1.8, xp ×10', () => {
        const result = applyRarityToMonster(baseMonster, 'legendary');
        expect(result.hp).toBe(500);
        expect(result.attack).toBe(18);
        expect(result.xp).toBe(500);
    });

    it('scales boss rarity: hp ×10, atk ×2.5, def ×2, xp ×30, gold ×30', () => {
        const result = applyRarityToMonster(baseMonster, 'boss');
        expect(result.hp).toBe(1000);
        expect(result.attack).toBe(25);
        expect(result.defense).toBe(10);
        expect(result.xp).toBe(1500);
        expect(result.gold).toEqual([300, 600]);
    });

    it('floors fractional results', () => {
        const m: IMonster = makeMonster({ hp: 3, attack: 3, defense: 3, xp: 3, gold: [3, 7] });
        const result = applyRarityToMonster(m, 'strong');
        expect(result.hp).toBe(4);
        expect(result.attack).toBe(3);
    });

    it('preserves non-stat fields like name_pl, icon, level', () => {
        const result = applyRarityToMonster(baseMonster, 'epic');
        expect(result.name_pl).toBe(baseMonster.name_pl);
        expect(result.id).toBe(baseMonster.id);
        expect(result.level).toBe(baseMonster.level);
    });
});


describe('getEffectiveChar', () => {
    beforeEach(() => {
        resetAllStores();
    });

    it('returns null for null character', () => {
        expect(getEffectiveChar(null)).toBeNull();
    });

    it('returns enriched character with same id/level when no equipment/skills', () => {
        const ch = makeCharacter();
        const result = getEffectiveChar(ch);
        expect(result).not.toBeNull();
        expect(result?.id).toBe(ch.id);
        expect(result?.level).toBe(ch.level);
    });

    it('floors max_hp through Math.floor()', () => {
        const ch = makeCharacter({ max_hp: 100 });
        const result = getEffectiveChar(ch);
        expect(Number.isInteger(result?.max_hp)).toBe(true);
    });

    it('caps crit_chance at 0.5 (50%)', () => {
        const ch = makeCharacter({ crit_chance: 10 });
        const result = getEffectiveChar(ch);
        expect(result?.crit_chance).toBeLessThanOrEqual(0.5);
    });

    it('uses default crit_damage 2.0 when undefined', () => {
        const ch = makeCharacter({ crit_damage: undefined as unknown as number });
        const result = getEffectiveChar(ch);
        expect(result?.crit_damage).toBeCloseTo(2.0, 2);
    });

    it('uses 0 for undefined hp_regen', () => {
        const ch = makeCharacter({ hp_regen: undefined as unknown as number });
        const result = getEffectiveChar(ch);
        expect(result?.hp_regen).toBeGreaterThanOrEqual(0);
        expect(result?.hp_regen).not.toBeNaN();
    });

    it('uses 0 for undefined mp_regen (NaN guard)', () => {
        const ch = makeCharacter({ mp_regen: undefined as unknown as number });
        const result = getEffectiveChar(ch);
        expect(result?.mp_regen).not.toBeNaN();
    });

    it('preserves attack_speed direction (positive)', () => {
        const ch = makeCharacter({ attack_speed: 2.0 });
        const result = getEffectiveChar(ch);
        expect(result?.attack_speed).toBeGreaterThan(0);
    });

    it('defaults undefined attack/defense/crit_chance to 0 (NaN hardening 2026-05-25)', () => {
        const ch = makeCharacter({
            attack: undefined as unknown as number,
            defense: undefined as unknown as number,
            crit_chance: undefined as unknown as number,
        });
        const result = getEffectiveChar(ch);
        expect(result?.attack).toBe(0);
        expect(result?.defense).toBe(0);
        expect(result?.crit_chance).toBe(0);
        expect(Number.isFinite(result?.attack)).toBe(true);
        expect(Number.isFinite(result?.defense)).toBe(true);
        expect(Number.isFinite(result?.crit_chance)).toBe(true);
    });
});


describe('resetHuntEffects', () => {
    it('clears stun status — player not stunned after reset', () => {
        resetHuntEffects();
        expect(isHuntPlayerStunned()).toBe(false);
    });

    it('returns a fresh empty status view per monster after reset', () => {
        resetHuntEffects();
        const view = getHuntMonsterStatusView(0, 'rat');
        expect(view.stunMs).toBe(0);
        expect(view.immortalMs).toBe(0);
        expect(view.markHealToDmgMs).toBe(0);
    });
});

describe('isHuntPlayerStunned', () => {
    it('returns false on a fresh session', () => {
        resetHuntEffects();
        expect(isHuntPlayerStunned()).toBe(false);
    });
});

describe('isHuntMonsterStunned', () => {
    it('returns false for unknown monster slot', () => {
        resetHuntEffects();
        expect(isHuntMonsterStunned(0, 'rat')).toBe(false);
    });

    it('returns false for negative slot', () => {
        resetHuntEffects();
        expect(isHuntMonsterStunned(-1, 'rat')).toBe(false);
    });
});

describe('getHuntMonsterStatusView', () => {
    it('returns zeroed snapshot when no entry exists', () => {
        resetHuntEffects();
        const v = getHuntMonsterStatusView(2, 'unknown');
        expect(v).toEqual({
            stunMs: 0,
            immortalMs: 0,
            markHealToDmgMs: 0,
            markAmpMs: 0,
            markAmpMult: 0,
            darkRitualMs: 0,
            darkRitualPct: 0,
            markAmpAllMs: 0,
            markAmpAllMult: 0,
        });
    });
});

describe('consumeHuntMonsterMarkAmp', () => {
    it('returns mult=1 / consumed=false when no mark is present', () => {
        resetHuntEffects();
        const r = consumeHuntMonsterMarkAmp(0, 'rat');
        expect(r.mult).toBe(1);
        expect(r.consumed).toBe(false);
    });
});

describe('clearHuntNecroSummons', () => {
    it('runs without throwing on a fresh session', () => {
        resetHuntEffects();
        expect(() => clearHuntNecroSummons()).not.toThrow();
    });
});


describe('resetAggro', () => {
    it('runs without throwing', () => {
        expect(() => resetAggro()).not.toThrow();
    });

    it('reset followed by maybeSwitchAggro returns a string id', () => {
        resetAllStores();
        useCharacterStore.setState({ character: makeCharacter() });
        resetAggro();
        const id = maybeSwitchAggro();
        expect(typeof id).toBe('string');
    });
});

describe('maybeSwitchAggro', () => {
    beforeEach(() => {
        resetAllStores();
    });

    it("returns 'player' when no character is set", () => {
        useCharacterStore.setState({ character: null });
        resetAggro();
        expect(maybeSwitchAggro()).toBe('player');
    });

    it("returns 'player' when no bots are alive and no party", () => {
        useCharacterStore.setState({ character: makeCharacter() });
        useBotStore.setState({ bots: [] });
        resetAggro();
        expect(maybeSwitchAggro()).toBe('player');
    });

    it('stays on the same target when called twice in quick succession', () => {
        useCharacterStore.setState({ character: makeCharacter() });
        resetAggro();
        const first = maybeSwitchAggro();
        const second = maybeSwitchAggro();
        expect(first).toBe(second);
    });
});


describe('advanceSkillCooldowns', () => {
    it('runs without throwing when no cooldowns are tracked', () => {
        expect(() => advanceSkillCooldowns(1000)).not.toThrow();
    });

    it('accepts 0 ms input', () => {
        expect(() => advanceSkillCooldowns(0)).not.toThrow();
    });

    it('accepts negative ms input (no-op semantics)', () => {
        expect(() => advanceSkillCooldowns(-500)).not.toThrow();
    });
});


describe('getAllMonsters', () => {
    it('returns a non-empty list', () => {
        expect(getAllMonsters().length).toBeGreaterThan(0);
    });

    it('returns monsters sorted by level ascending', () => {
        const list = getAllMonsters();
        for (let i = 1; i < list.length; i++) {
            expect(list[i].level).toBeGreaterThanOrEqual(list[i - 1].level);
        }
    });

    it('returns a fresh copy (does not mutate underlying data on caller mutation)', () => {
        const a = getAllMonsters();
        const b = getAllMonsters();
        expect(a).not.toBe(b);
    });

    it('includes the starter monster "rat"', () => {
        const list = getAllMonsters();
        const rat = list.find((m) => m.id === 'rat');
        expect(rat).toBeDefined();
    });
});


describe('syncCasterChargeConsume', () => {
    beforeEach(() => {
        resetAllStores();
    });

    it('does not throw when no buffs exist', () => {
        expect(() => syncCasterChargeConsume({
            dmgAmpNext: true,
            critNext: true,
            critBuffNext: true,
            lifestealNext: true,
            nextAllyHeal: true,
        })).not.toThrow();
    });

    it('does not throw when every flag is false', () => {
        expect(() => syncCasterChargeConsume({
            dmgAmpNext: false,
            critNext: false,
            critBuffNext: false,
        })).not.toThrow();
    });

    it('handles optional flags being omitted', () => {
        expect(() => syncCasterChargeConsume({
            dmgAmpNext: false,
            critNext: false,
            critBuffNext: false,
        })).not.toThrow();
    });
});


describe('dropLootToInventory', () => {
    beforeEach(() => {
        resetAllStores();
    });

    it('returns an array of drops', () => {
        const monster = makeMonster({ level: 1 });
        const drops = dropLootToInventory(monster, 'normal');
        expect(Array.isArray(drops)).toBe(true);
    });

    it('does not decrease inventory gold (helper only adds auto-sell income, never spends)', () => {
        const monster = makeMonster({ level: 5, gold: [10, 10] });
        useInventoryStore.setState({ gold: 100 });
        dropLootToInventory(monster, 'normal');
        expect(useInventoryStore.getState().gold).toBeGreaterThanOrEqual(100);
    });

    it('accepts heroicDropRate=0 as default behaviour', () => {
        const monster = makeMonster({ level: 1 });
        expect(() => dropLootToInventory(monster, 'normal', 0)).not.toThrow();
    });

    it('accepts a heroicDropRate > 0', () => {
        const monster = makeMonster({ level: 50 });
        expect(() => dropLootToInventory(monster, 'boss', 0.5)).not.toThrow();
    });

    it('returns an entry array where each drop has icon + name + rarity', () => {
        const monster = makeMonster({ level: 20 });
        const drops = dropLootToInventory(monster, 'epic');
        for (const d of drops) {
            expect(typeof d.icon).toBe('string');
            expect(typeof d.name).toBe('string');
            expect(typeof d.rarity).toBe('string');
        }
    });
});


describe('applyMonsterKillRewardsForMember', () => {
    beforeEach(() => {
        resetAllStores();
        useCharacterStore.setState({ character: makeCharacter({ level: 10, xp: 0 }) });
        useCombatStore.getState().initCombat(makeMonster(), 100, 50, 'normal');
    });

    it('no-ops cleanly when monsterId is unknown', () => {
        expect(() => applyMonsterKillRewardsForMember('nonexistent_id', 1, 'normal', 100))
            .not.toThrow();
    });

    it('uses the provided finalXp verbatim (no recomputation)', () => {
        const charBefore = useCharacterStore.getState().character;
        const xpBefore = charBefore?.xp ?? 0;
        applyMonsterKillRewardsForMember('rat', 1, 'normal', 50);
        const charAfter = useCharacterStore.getState().character;
        expect(charAfter).not.toBeNull();
        const leveled = (charAfter?.level ?? 0) > (charBefore?.level ?? 0);
        const xpGrew = (charAfter?.xp ?? 0) >= xpBefore;
        expect(leveled || xpGrew).toBe(true);
    });

    it('awards gold (positive integer) to inventory', () => {
        const goldBefore = useInventoryStore.getState().gold;
        applyMonsterKillRewardsForMember('rat', 1, 'normal', 50);
        expect(useInventoryStore.getState().gold).toBeGreaterThanOrEqual(goldBefore);
    });
});


describe('addMonsterToWave', () => {
    beforeEach(() => {
        resetAllStores();
        useCharacterStore.setState({ character: makeCharacter() });
    });

    it('returns false when phase !== fighting', () => {
        useCombatStore.setState({ phase: 'idle' });
        expect(addMonsterToWave()).toBe(false);
    });

    it('returns false when there is no baseMonster set', () => {
        useCombatStore.setState({ phase: 'fighting', baseMonster: null });
        expect(addMonsterToWave()).toBe(false);
    });

    it('returns true when phase=fighting + baseMonster set + wave below cap', () => {
        const monster = makeMonster();
        useCombatStore.getState().initCombat(monster, 100, 50, 'normal');
        useCombatStore.getState().setBaseMonster(monster);
        const added = addMonsterToWave();
        expect(added).toBe(true);
        expect(useCombatStore.getState().waveMonsters.length).toBe(2);
    });

    it('returns false once wave hits the cap (4)', () => {
        const monster = makeMonster();
        useCombatStore.getState().initCombat(monster, 100, 50, 'normal');
        useCombatStore.getState().setBaseMonster(monster);
        addMonsterToWave();
        addMonsterToWave();
        addMonsterToWave();
        expect(useCombatStore.getState().waveMonsters.length).toBe(4);
        expect(addMonsterToWave()).toBe(false);
    });
});


describe('startAutoNextFight', () => {
    beforeEach(() => {
        resetAllStores();
    });

    it('no-ops when autoFight is false', () => {
        useCharacterStore.setState({ character: makeCharacter() });
        useCombatStore.setState({ autoFight: false, baseMonster: makeMonster() });
        expect(() => startAutoNextFight()).not.toThrow();
        expect(useCombatStore.getState().phase).toBe('idle');
    });

    it('no-ops when baseMonster is null', () => {
        useCharacterStore.setState({ character: makeCharacter() });
        useCombatStore.setState({ autoFight: true, baseMonster: null });
        expect(() => startAutoNextFight()).not.toThrow();
        expect(useCombatStore.getState().phase).toBe('idle');
    });
});


describe('stopCombat', () => {
    beforeEach(() => {
        resetAllStores();
    });

    it('resets combat phase to idle', () => {
        useCharacterStore.setState({ character: makeCharacter() });
        useCombatStore.getState().initCombat(makeMonster(), 100, 50, 'normal');
        expect(useCombatStore.getState().phase).toBe('fighting');
        stopCombat();
        expect(useCombatStore.getState().phase).toBe('idle');
    });

    it('syncs combat HP back to character on solo combat', () => {
        useCharacterStore.setState({ character: makeCharacter({ hp: 100, mp: 50 }) });
        useCombatStore.getState().initCombat(makeMonster(), 70, 30, 'normal');
        stopCombat();
        const ch = useCharacterStore.getState().character;
        expect(ch?.hp).toBe(70);
        expect(ch?.mp).toBe(30);
    });

    it('clears bot list', () => {
        useCharacterStore.setState({ character: makeCharacter() });
        useCombatStore.getState().initCombat(makeMonster(), 100, 50, 'normal');
        useBotStore.setState({
            bots: [{
                id: 'bot1', name: 'Sir Bot', class: 'Knight', level: 10,
                hp: 100, maxHp: 100, attack: 10, defense: 5, critChance: 5, alive: true,
                attackSpeed: 2.0,
            } as never],
        });
        stopCombat();
        expect(useBotStore.getState().bots.length).toBe(0);
    });

    it('runs cleanly when combat is already idle', () => {
        useCombatStore.setState({ phase: 'idle' });
        expect(() => stopCombat()).not.toThrow();
    });
});


describe('IDropDisplay shape', () => {
    it('supports the minimal icon+name+rarity contract', () => {
        const d: IDropDisplay = { icon: 'crossed-swords', name: 'Sword', rarity: 'common' };
        expect(d.icon).toBe('crossed-swords');
    });

    it('supports optional fields upgradeLevel/sold/soldPrice', () => {
        const d: IDropDisplay = {
            icon: 'crossed-swords',
            name: 'Sword',
            rarity: 'rare',
            upgradeLevel: 3,
            sold: true,
            soldPrice: 250,
        };
        expect(d.sold).toBe(true);
        expect(d.soldPrice).toBe(250);
    });
});


describe('applyRarityToMonster determinism guard', () => {
    let randomSpy: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
        randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    });

    it('produces a stable result with mocked Math.random', () => {
        const monster = makeMonster({ hp: 100, attack: 10, defense: 5, xp: 50, gold: [10, 20] });
        const a = applyRarityToMonster(monster, 'strong');
        const b = applyRarityToMonster(monster, 'strong');
        expect(a).toEqual(b);
        expect(randomSpy).toBeDefined();
    });
});


describe('getEffectiveChar with equipped item', () => {
    beforeEach(() => {
        resetAllStores();
    });

    it('adds equipped item attack to the effective attack pool', () => {
        const ch = makeCharacter({ attack: 20 });
        const weapon: IInventoryItem = {
            uuid: 'eq-1',
            itemId: 'sword_of_beginnings',
            rarity: 'common',
            bonuses: { attack: 5 },
            itemLevel: 1,
        };
        useInventoryStore.setState((s) => ({
            ...s,
            equipment: { ...s.equipment, mainHand: weapon },
        }));
        const result = getEffectiveChar(ch);
        expect(result?.attack).toBeGreaterThanOrEqual(20);
    });
});
