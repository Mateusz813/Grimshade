import { describe, it, expect, beforeEach, vi } from 'vitest';

// -- Mocks --------------------------------------------------------------------
// `handlePlayerDeath` fires two best-effort, network-touching side effects:
//   - `deathsApi.logDeath(...)`           — writes a death row (axios -> Supabase)
//   - `saveCurrentCharacterStoresForce()` — force-flush to Supabase / game_saves
// Both are `void`-prefixed fire-and-forget. We stub them so the integration
// test never attempts real HTTP and stays deterministic + silent. Everything
// else (combat / character / skill / inventory / party / death stores) runs
// against the REAL Zustand stores so we exercise the actual penalty wiring.

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

// -- Fixtures -----------------------------------------------------------------

const makeCharacter = (overrides: Partial<ICharacter> = {}): ICharacter => ({
    id: 'char-1',
    user_id: 'user-1',
    name: 'Hero',
    class: 'Knight',
    level: 100,
    xp: 5000,
    hp: 0, // downed by default — the scenario under test
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

/** Seed a Knight with a trained weapon skill so the -50% skill XP penalty is
 *  observable. sword_fighting at level 5 with 100 banked XP toward the next. */
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

// -- Tests --------------------------------------------------------------------
//
// GAP #12 — A resurrected ally keeps XP / skill XP / EQ (no death penalty).
//
// `handlePlayerDeath` is the engine entry point for a player hitting 0 HP. The
// death penalty (level loss + skill-XP −50% + item loss) lives at the BOTTOM of
// that function. The "wait for an ally Cleric to revive me" path is implemented
// as an EARLY RETURN near the top:
//
//   - A NON-LEADER member of a multi-human party (combatEngine.ts ~1349):
//     member death is leader-authoritative -> local death is a no-op + a
//     defensive heal. The member is later revived by the Cleric; no penalty.
//
//   - The LEADER of a multi-human party with `forceConfirm=false`
//     (combatEngine.ts ~1370): the engine bails so Combat.tsx can show the
//     PartyDeathChoice popup. If the player picks "Czekaj na wskrzeszenie",
//     the Cleric's Aura Wskrzeszenia heals them to 50% HP and the penalty is
//     NEVER applied. The penalty only runs if they pick "Wróć do miasta",
//     which re-calls with `forceConfirm=true`.
//
// These tests prove: the revive-wait paths apply ZERO penalty, while a real
// (solo / force-confirmed) death applies the full penalty.

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
        // Party: leader is SOMEONE ELSE (a human), so `char-1` is a non-leader
        // member -> its local death must be a no-op (leader-authoritative).
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
        // No level / XP loss — the member keeps everything (will be revived).
        expect(c.level).toBe(100);
        expect(c.xp).toBe(5000);
        // Skill XP untouched (no −50%).
        expect(useSkillStore.getState().skillLevels.sword_fighting).toBe(skillLvlBefore);
        expect(useSkillStore.getState().skillXp.sword_fighting).toBe(skillXpBefore);
        // No item loss.
        expect(useInventoryStore.getState().bag.length).toBe(bagBefore);
        expect(useInventoryStore.getState().equipment.mainHand).toEqual(eqBefore);
        // No death overlay triggered (player isn't actually dead — awaiting revive).
        expect(useDeathStore.getState().event).toBeNull();
        // Defensive heal kicked in so the next view doesn't show a corpse.
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
        // `char-1` IS the leader, but there is another HUMAN member -> the
        // engine defers to the PartyDeathChoice popup instead of auto-dying.
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

        handlePlayerDeath(false); // player has NOT confirmed bail-to-town

        const c = useCharacterStore.getState().character!;
        // Penalty must NOT run — they can still wait for a Cleric revive.
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
        // Solo — no party at all.
        usePartyStore.setState({ party: null, loading: false, error: null });
        useCombatStore.getState().initCombat(makeMonster(), 500, 120, 'normal');

        const skillXpBefore = useSkillStore.getState().skillXp.sword_fighting;

        handlePlayerDeath(true);

        const c = useCharacterStore.getState().character!;
        // Level dropped: lvl 100 loses floor(100 * 0.02) = 2 levels -> 98.
        expect(c.level).toBe(98);
        expect(c.level).toBeLessThan(100);
        // Skill XP was reduced by the death penalty (−50% of banked XP),
        // so the in-progress XP pointer is strictly lower than before.
        const skillXpAfter = useSkillStore.getState().skillXp.sword_fighting;
        const skillLvlAfter = useSkillStore.getState().skillLevels.sword_fighting;
        // Banked total halved -> either the level dropped or the current-xp
        // pointer dropped (or both). It can never be MORE than before.
        const totalDropped = skillLvlAfter < 5 || skillXpAfter < skillXpBefore;
        expect(totalDropped).toBe(true);
        // Death overlay fired.
        expect(useDeathStore.getState().event).not.toBeNull();
        expect(useDeathStore.getState().event?.newLevel).toBe(98);
        // highest_level preserved (re-leveling exploit guard) — bonuses gated.
        expect(c.highest_level).toBe(100);
    });

    it('CONTRAST: a SOLO player passing forceConfirm=false still dies + is penalized (no party to wait on)', () => {
        // No party member to revive -> the early-return gates don't apply and
        // the penalty runs even without forceConfirm. Proves the no-penalty
        // path is specifically the party-revive case, not a blanket skip.
        const char = makeCharacter({ id: 'char-1', level: 50, xp: 200, hp: 0 });
        useCharacterStore.setState({ character: char });
        seedTrainedSkill();
        usePartyStore.setState({ party: null, loading: false, error: null });
        useCombatStore.getState().initCombat(makeMonster({ level: 50 }), 500, 120, 'normal');

        handlePlayerDeath(false);

        const c = useCharacterStore.getState().character!;
        // lvl 50 loses floor(50 * 0.02) = 1 level -> 49.
        expect(c.level).toBe(49);
        expect(useDeathStore.getState().event).not.toBeNull();
    });

    it('CONTRAST: a leader in a BOT-only party (no other humans) dies + is penalized', () => {
        // The revive-wait gate requires another HUMAN member. A party of just
        // the leader + bots is effectively solo for death purposes.
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
        expect(c.level).toBe(98); // penalty applied — bots don't gate the death
        expect(useDeathStore.getState().event).not.toBeNull();
    });
});
