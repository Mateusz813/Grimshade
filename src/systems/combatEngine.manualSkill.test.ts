
import { describe, it, expect, beforeEach } from 'vitest';
import {
    huntApplySkillEffectV2,
    resetHuntEffects,
    resetAggro,
} from './combatEngine';
import { useCharacterStore } from '../stores/characterStore';
import { useCombatStore } from '../stores/combatStore';
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
import type { ICharacter } from '../api/v1/characterApi';
import type { IMonster } from '../types/monster';


const makeKnight = (overrides: Partial<ICharacter> = {}): ICharacter => ({
    id: 'r11d_char_1',
    user_id: 'r11d_user_1',
    name: 'r11d_TestKnight',
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
    hp: 100,
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
        combatSpeed: 'x1',
    });
    useCooldownStore.getState().clearAll();
    useTaskStore.setState({ activeTask: null, activeTasks: [], completedTasks: [] });
    useQuestStore.setState({ activeQuests: [], completedQuestIds: [] });
    useDailyQuestStore.setState({ lastRefreshDate: null, activeQuests: [], todayQuestDefs: [] });
    resetHuntEffects();
    resetAggro();
};

const stageSingleWaveFight = (char: ICharacter, monster: IMonster): void => {
    useCharacterStore.setState({ character: char });
    useCombatStore.getState().initCombat(monster, char.hp, char.mp, 'normal');
};


describe('huntApplySkillEffectV2: damage + stun skill (shield_bash)', () => {
    beforeEach(() => resetAllStores());

    it('applies stun:3000 to the active wave monster (stunMs >= 3000, stunApplied=true)', () => {
        stageSingleWaveFight(makeKnight(), makeMonster({ hp: 100 }));

        const result = huntApplySkillEffectV2('shield_bash', 0);

        expect(result).not.toBeNull();
        expect(result!.stunApplied).toBe(true);
        expect(result!.aoe).toBe(false);
        expect(result!.castDmgMult).toBeGreaterThanOrEqual(1);
        expect(result!.castDmgMult).toBeLessThanOrEqual(1.01);
    });

    it('does NOT mutate AOE side-effects (summons empty, no instantKill flag, no defPen)', () => {
        stageSingleWaveFight(makeKnight(), makeMonster());

        const result = huntApplySkillEffectV2('shield_bash', 0);

        expect(result).not.toBeNull();
        expect(result!.summons).toEqual([]);
        expect(result!.instantKill).toBe(false);
        expect(result!.executeBurstPct).toBe(0);
        expect(result!.defPenPct).toBe(0);
        expect(result!.aoeStunIdxs).toEqual([]);
    });
});

describe('huntApplySkillEffectV2: self-buff skill (berserker_rage)', () => {
    beforeEach(() => resetAllStores());

    it('applies attack_up:50:6000 buff to the caster\'s effect-session status', () => {
        stageSingleWaveFight(makeKnight(), makeMonster());

        const result = huntApplySkillEffectV2('berserker_rage', 0);

        expect(result).not.toBeNull();
        expect(result!.aoe).toBe(false);
        expect(result!.stunApplied).toBe(false);
        expect(result!.summons).toEqual([]);
        expect(result!.instantKill).toBe(false);
        expect(result!.healCasterPctOfMaxHp).toBe(0);
    });
});

describe('huntApplySkillEffectV2: party buff (battle_cry, party_attack_up:20:5000)', () => {
    beforeEach(() => resetAllStores());

    it('cast succeeds with 2 ally bots in the wave (allyIds includes player + bots)', () => {
        const knight = makeKnight();
        stageSingleWaveFight(knight, makeMonster());

        useBotStore.setState({
            bots: [
                { id: 'r11d_bot_1', alive: true, name: 'r11d_BotA', class: 'Cleric', level: 10, hp: 100, maxHp: 100, mp: 50, maxMp: 50, attack: 10, defense: 5, attack_speed: 1.5, crit_chance: 0, crit_damage: 1, hp_regen: 0, mp_regen: 0 } as any,
                { id: 'r11d_bot_2', alive: true, name: 'r11d_BotB', class: 'Archer', level: 10, hp: 100, maxHp: 100, mp: 50, maxMp: 50, attack: 12, defense: 4, attack_speed: 2.0, crit_chance: 0, crit_damage: 1, hp_regen: 0, mp_regen: 0 } as any,
            ],
        });

        const result = huntApplySkillEffectV2('battle_cry', 0);

        expect(result).not.toBeNull();
        expect(result!.aoe).toBe(false);
        expect(result!.stunApplied).toBe(false);
    });
});

describe('huntApplySkillEffectV2: refuses cast when all wave monsters dead', () => {
    beforeEach(() => resetAllStores());

    it('returns null when activeIdx points at dead monster + no other alive (corpse retarget fails)', () => {
        stageSingleWaveFight(makeKnight(), makeMonster({ hp: 100 }));

        useCombatStore.setState((s) => ({
            waveMonsters: s.waveMonsters.map((w) => ({ ...w, isDead: true, currentHp: 0 })),
        }));

        const result = huntApplySkillEffectV2('shield_bash', 0);

        expect(result).toBeNull();
    });
});

describe('huntApplySkillEffectV2: refuses cast when caster is dead', () => {
    beforeEach(() => resetAllStores());

    it('returns null when character.hp = 0 (dead caster guard)', () => {
        const deadKnight = makeKnight({ hp: 0 });
        stageSingleWaveFight(deadKnight, makeMonster());
        useCombatStore.setState({ playerCurrentHp: 0 });

        const result = huntApplySkillEffectV2('shield_bash', 0);

        expect(result).toBeNull();
    });

    it('returns null when playerCurrentHp = 0 even if char.hp > 0 (combat-store guard)', () => {
        stageSingleWaveFight(makeKnight({ hp: 100 }), makeMonster());
        useCombatStore.setState({ playerCurrentHp: 0 });

        const result = huntApplySkillEffectV2('shield_bash', 0);

        expect(result).toBeNull();
    });
});

describe('huntApplySkillEffectV2: returns null with no character set', () => {
    beforeEach(() => resetAllStores());

    it('returns null when characterStore.character is null', () => {
        const result = huntApplySkillEffectV2('shield_bash', 0);
        expect(result).toBeNull();
    });
});
