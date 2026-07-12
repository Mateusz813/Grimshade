import { describe, it, expect, beforeEach, vi } from 'vitest';


vi.mock('../api/v1/deathsApi', () => ({
    deathsApi: {
        logDeath: vi.fn().mockResolvedValue(undefined),
    },
}));

vi.mock('../stores/characterScope', () => ({
    saveCurrentCharacterStores: vi.fn().mockResolvedValue(undefined),
    saveCurrentCharacterStoresForce: vi.fn().mockResolvedValue(undefined),
    saveCurrentCharacterStoresSync: vi.fn(),
}));

import { handlePlayerDeath } from './combatEngine';
import { useCombatStore } from '../stores/combatStore';
import { useCharacterStore } from '../stores/characterStore';
import { useInventoryStore } from '../stores/inventoryStore';
import { useSkillStore } from '../stores/skillStore';
import { useBotStore } from '../stores/botStore';
import { usePartyStore } from '../stores/partyStore';
import { useDeathStore } from '../stores/deathStore';
import type { ICharacter } from '../api/v1/characterApi';
import type { IMonster } from '../types/monster';
import type { IInventoryItem } from './itemSystem';
import type { IPartyInfo, IPartyMember } from '../types/party';


const makeCharacter = (overrides: Partial<ICharacter> = {}): ICharacter => ({
    id: 'char-1',
    user_id: 'user-1',
    name: 'Hero',
    class: 'Knight',
    level: 100,
    xp: 5000,
    hp: 0,
    max_hp: 500,
    mp: 0,
    max_mp: 120,
    attack: 50,
    defense: 20,
    attack_speed: 2.0,
    crit_chance: 0.05,
    crit_damage: 2.0,
    magic_level: 0,
    hp_regen: 0,
    mp_regen: 0,
    gold: 0,
    stat_points: 0,
    highest_level: 100,
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
    level: 100,
    hp: 270,
    attack: 40,
    defense: 10,
    speed: 1.0,
    xp: 170,
    gold: [1, 5],
    ...overrides,
} as IMonster);

const makeBagItem = (overrides: Partial<IInventoryItem> = {}): IInventoryItem => ({
    uuid: 'item-uuid-1',
    itemId: 'sword_lvl1_common',
    rarity: 'common',
    bonuses: {},
    itemLevel: 1,
    upgradeLevel: 0,
    ...overrides,
});

const makePartyMember = (overrides: Partial<IPartyMember> = {}): IPartyMember => ({
    id: 'char-1',
    name: 'Hero',
    class: 'Knight',
    level: 100,
    hp: 0,
    maxHp: 500,
    isBot: false,
    isOnline: true,
    ...overrides,
});

const makeParty = (overrides: Partial<IPartyInfo> = {}): IPartyInfo => ({
    id: 'party-1',
    leaderId: 'char-1',
    members: [makePartyMember()],
    createdAt: '2024-01-01T00:00:00Z',
    ...overrides,
});

const EMPTY_EQUIPMENT = {
    helmet: null, armor: null, pants: null, gloves: null, shoulders: null,
    boots: null, mainHand: null, offHand: null, ring1: null, ring2: null,
    earrings: null, necklace: null,
};

const seedTrainedSkill = (): void => {
    useSkillStore.setState({
        ...useSkillStore.getState(),
        skillLevels: { sword_fighting: 5 },
        skillXp: { sword_fighting: 100 },
        activeSkillSlots: [null, null, null, null],
    });
};

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
    useCombatStore.getState().resetCombat();
    useBotStore.setState({ bots: [] });
    usePartyStore.setState({ party: null, loading: false, error: null });
    useDeathStore.setState({ ...useDeathStore.getState(), event: null });
};


describe('handlePlayerDeath — GAP #12 resurrected ally keeps progress (no penalty)', () => {
    beforeEach(() => {
        resetStores();
    });

    it('NON-leader party member at HP 0 -> no level / xp / skill / item loss (awaits revive)', () => {
        const char = makeCharacter({ id: 'char-1', level: 100, xp: 5000, hp: 0 });
        useCharacterStore.setState({ character: char });
        seedTrainedSkill();
        useInventoryStore.setState({
            ...useInventoryStore.getState(),
            bag: [makeBagItem({ uuid: 'a' }), makeBagItem({ uuid: 'b' })],
            equipment: { ...EMPTY_EQUIPMENT, mainHand: makeBagItem({ uuid: 'eq-1' }) },
        });
        usePartyStore.setState({
            party: makeParty({
                leaderId: 'leader-human',
                members: [
                    makePartyMember({ id: 'leader-human', name: 'Boss' }),
                    makePartyMember({ id: 'char-1', name: 'Hero' }),
                ],
            }),
            loading: false,
            error: null,
        });
        useCombatStore.getState().initCombat(makeMonster(), 500, 120, 'normal');

        const skillLvlBefore = useSkillStore.getState().skillLevels.sword_fighting;
        const skillXpBefore = useSkillStore.getState().skillXp.sword_fighting;
        const bagBefore = useInventoryStore.getState().bag.length;
        const eqBefore = useInventoryStore.getState().equipment.mainHand;

        handlePlayerDeath(false);

        const c = useCharacterStore.getState().character!;
        expect(c.level).toBe(100);
        expect(c.xp).toBe(5000);
        expect(useSkillStore.getState().skillLevels.sword_fighting).toBe(skillLvlBefore);
        expect(useSkillStore.getState().skillXp.sword_fighting).toBe(skillXpBefore);
        expect(useInventoryStore.getState().bag.length).toBe(bagBefore);
        expect(useInventoryStore.getState().equipment.mainHand).toEqual(eqBefore);
        expect(useDeathStore.getState().event).toBeNull();
        expect(c.hp).toBeGreaterThan(0);
    });

    it('LEADER in a multi-human party at HP 0 with forceConfirm=false -> no penalty (death popup gate)', () => {
        const char = makeCharacter({ id: 'char-1', level: 100, xp: 5000, hp: 0 });
        useCharacterStore.setState({ character: char });
        seedTrainedSkill();
        useInventoryStore.setState({
            ...useInventoryStore.getState(),
            bag: [makeBagItem({ uuid: 'a' }), makeBagItem({ uuid: 'b' })],
        });
        usePartyStore.setState({
            party: makeParty({
                leaderId: 'char-1',
                members: [
                    makePartyMember({ id: 'char-1', name: 'Hero' }),
                    makePartyMember({ id: 'ally-human', name: 'Cleric' }),
                ],
            }),
            loading: false,
            error: null,
        });
        useCombatStore.getState().initCombat(makeMonster(), 500, 120, 'normal');

        handlePlayerDeath(false);

        const c = useCharacterStore.getState().character!;
        expect(c.level).toBe(100);
        expect(c.xp).toBe(5000);
        expect(useSkillStore.getState().skillLevels.sword_fighting).toBe(5);
        expect(useSkillStore.getState().skillXp.sword_fighting).toBe(100);
        expect(useInventoryStore.getState().bag.length).toBe(2);
        expect(useDeathStore.getState().event).toBeNull();
    });

    it('CONTRAST: a real solo death (forceConfirm=true) DOES apply the full penalty', () => {
        const char = makeCharacter({ id: 'char-1', level: 100, xp: 5000, hp: 0 });
        useCharacterStore.setState({ character: char });
        seedTrainedSkill();
        usePartyStore.setState({ party: null, loading: false, error: null });
        useCombatStore.getState().initCombat(makeMonster(), 500, 120, 'normal');

        const skillXpBefore = useSkillStore.getState().skillXp.sword_fighting;

        handlePlayerDeath(true);

        const c = useCharacterStore.getState().character!;
        expect(c.level).toBe(99);
        expect(c.level).toBeLessThan(100);
        const skillXpAfter = useSkillStore.getState().skillXp.sword_fighting;
        const skillLvlAfter = useSkillStore.getState().skillLevels.sword_fighting;
        const totalDropped = skillLvlAfter < 5 || skillXpAfter < skillXpBefore;
        expect(totalDropped).toBe(true);
        expect(useDeathStore.getState().event).not.toBeNull();
        expect(useDeathStore.getState().event?.newLevel).toBe(99);
        expect(c.highest_level).toBe(100);
    });

    it('CONTRAST: a SOLO player passing forceConfirm=false still dies + is penalized (no party to wait on)', () => {
        const char = makeCharacter({ id: 'char-1', level: 50, xp: 200, hp: 0 });
        useCharacterStore.setState({ character: char });
        seedTrainedSkill();
        usePartyStore.setState({ party: null, loading: false, error: null });
        useCombatStore.getState().initCombat(makeMonster({ level: 50 }), 500, 120, 'normal');

        handlePlayerDeath(false);

        const c = useCharacterStore.getState().character!;
        expect(c.level).toBe(49);
        expect(useDeathStore.getState().event).not.toBeNull();
    });

    it('CONTRAST: a leader in a BOT-only party (no other humans) dies + is penalized', () => {
        const char = makeCharacter({ id: 'char-1', level: 100, xp: 5000, hp: 0 });
        useCharacterStore.setState({ character: char });
        seedTrainedSkill();
        usePartyStore.setState({
            party: makeParty({
                leaderId: 'char-1',
                members: [
                    makePartyMember({ id: 'char-1', name: 'Hero' }),
                    makePartyMember({ id: 'bot-1', name: 'Sir Bot', isBot: true }),
                ],
            }),
            loading: false,
            error: null,
        });
        useCombatStore.getState().initCombat(makeMonster(), 500, 120, 'normal');

        handlePlayerDeath(false);

        const c = useCharacterStore.getState().character!;
        expect(c.level).toBe(99);
        expect(useDeathStore.getState().event).not.toBeNull();
    });
});
