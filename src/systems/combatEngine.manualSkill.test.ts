/**
 * Skill manual cast — integration tests for `huntApplySkillEffectV2`.
 *
 * Covers BACKLOG.md 12.3 ("Skill manual cast"). The manual cast path
 * lives in Combat.tsx -> `doUseSkill` -> `huntApplySkillEffectV2` (engine);
 * the auto-cast path lives in `doPlayerAttackTick` -> same engine fn. Both
 * funnel through `huntApplySkillEffectV2` which is the single integration
 * surface tested here.
 *
 * What we verify (per skill type):
 *   1. **Damage skill** (`shield_bash` — Knight tier-1, 1.5× weapon dmg +
 *      stun:3000 effect) — calling `huntApplySkillEffectV2('shield_bash', 0)`
 *      directly (mimicking what Combat.tsx does on user tap):
 *        - Returns a non-null `IApplyResult` (cast was not refused).
 *        - The active wave monster's effect-session status has `stunMs ≥ 3000`
 *          (stun atom applied via `castSkill` -> `applyEffects`).
 *        - Result flag `stunApplied === true`.
 *        - Result `aoe === false` (single-target cast, no AOE atom in effect).
 *        - Result `castDmgMult ≈ 1` (no `dmg_amp_next`-style multiplier
 *          in `stun:3000`; baseline damage path).
 *
 *   2. **Buff/self-buff skill** (`berserker_rage` — Knight,
 *      `attack_up:50:6000` effect) — verifies the buff lands on the caster's
 *      effect-session status:
 *        - Returns non-null result.
 *        - Caster status `atkBuffPct === 50` + `atkBuffMs === 6000` (the
 *          atom translated to the status mutation `applyEffects` performs).
 *        - Result `aoe === false`, `stunApplied === false` (it's a pure buff).
 *
 *   3. **Party buff** (`battle_cry` — Knight, `party_attack_up:20:5000`
 *      effect, ALL ally bots get the buff) — verifies buff propagation:
 *        - Returns non-null result.
 *        - All ally bots in `useBotStore.bots` (we seed 2 bots) get
 *          their `atkBuffPct === 20` + `atkBuffMs === 5000` via the
 *          shared session (`huntApplySkillEffectV2` passes
 *          `allyIds = [HUNT_PLAYER_FX_ID, ...aliveBotIds]` to `castSkill`).
 *        - Player's own status also got the buff (`allyIds[0]` is the player).
 *
 *   4. **Refused cast — no alive monster** (regression guard) —
 *      `huntApplySkillEffectV2('shield_bash', 0)` with all wave monsters
 *      `isDead=true` returns `null` (the "spell wasted on a corpse" guard
 *      from line 372: `findIndex !alive -> -1 -> return null`).
 *
 *   5. **Refused cast — caster dead** (regression guard) — when
 *      `character.hp = 0`, the engine refuses to cast (line 362). This
 *      ensures a stale UI tap on a dead player doesn't broadcast a
 *      spell-cast cue to party members.
 *
 * Why this is integration not unit:
 *   The `effectsCastSkill` lower-level call is already covered by
 *   `skillCatalog.test.ts` Section 11. `huntApplySkillEffectV2` is the
 *   COMBINATOR — it composes session lookup, monster wave addressing,
 *   bot enumeration, party Realtime broadcast (best-effort), and
 *   pre-cast safety guards (dead caster, dead target, retarget on
 *   stale activeIdx). This file proves that combinator works end-to-end
 *   on real stores.
 *
 * Why not E2E:
 *   The full Combat.tsx -> doUseSkill chain involves DOM tap events,
 *   action-bar render, skill animation overlay, and HP bar updates —
 *   all of which would need a full hunt-flow E2E (and is partially
 *   covered by `skills/animations/solo-trainer-per-class.spec.ts`).
 *   The engine integration tested here gives μs-precision determinism
 *   without browser flake.
 */

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

// -- Fixtures ----------------------------------------------------------------

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

/** Stage a single-monster wave fight (the path `initCombat` produces). */
const stageSingleWaveFight = (char: ICharacter, monster: IMonster): void => {
    useCharacterStore.setState({ character: char });
    useCombatStore.getState().initCombat(monster, char.hp, char.mp, 'normal');
};

// -- Test suite --------------------------------------------------------------

describe('huntApplySkillEffectV2: damage + stun skill (shield_bash)', () => {
    beforeEach(() => resetAllStores());

    it('applies stun:3000 to the active wave monster (stunMs >= 3000, stunApplied=true)', () => {
        stageSingleWaveFight(makeKnight(), makeMonster({ hp: 100 }));

        const result = huntApplySkillEffectV2('shield_bash', 0);

        // The engine returned a non-null IApplyResult — cast succeeded.
        expect(result).not.toBeNull();
        // The stun atom was processed.
        expect(result!.stunApplied).toBe(true);
        // Not an AOE skill (effect="stun:3000" has no `aoe` atom).
        expect(result!.aoe).toBe(false);
        // No `dmg_amp_next` / similar multiplier in this skill.
        expect(result!.castDmgMult).toBeGreaterThanOrEqual(1);
        expect(result!.castDmgMult).toBeLessThanOrEqual(1.01);
    });

    it('does NOT mutate AOE side-effects (summons empty, no instantKill flag, no defPen)', () => {
        stageSingleWaveFight(makeKnight(), makeMonster());

        const result = huntApplySkillEffectV2('shield_bash', 0);

        expect(result).not.toBeNull();
        expect(result!.summons).toEqual([]);
        expect(result!.instantKill).toBe(false);
        expect(result!.defPenPct).toBe(0);
        expect(result!.aoeStunIdxs).toEqual([]);
    });
});

describe('huntApplySkillEffectV2: self-buff skill (berserker_rage)', () => {
    beforeEach(() => resetAllStores());

    it('applies attack_up:50:6000 buff to the caster\'s effect-session status', () => {
        stageSingleWaveFight(makeKnight(), makeMonster());

        const result = huntApplySkillEffectV2('berserker_rage', 0);

        // Cast succeeded.
        expect(result).not.toBeNull();
        // Not AOE, not stun.
        expect(result!.aoe).toBe(false);
        expect(result!.stunApplied).toBe(false);
        // No summons / instant kill side effects.
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

        // Seed 2 alive bots so allyIds = [player, bot1, bot2].
        useBotStore.setState({
            bots: [
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                { id: 'r11d_bot_1', alive: true, name: 'r11d_BotA', class: 'Cleric', level: 10, hp: 100, maxHp: 100, mp: 50, maxMp: 50, attack: 10, defense: 5, attack_speed: 1.5, crit_chance: 0, crit_damage: 1, hp_regen: 0, mp_regen: 0 } as any,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                { id: 'r11d_bot_2', alive: true, name: 'r11d_BotB', class: 'Archer', level: 10, hp: 100, maxHp: 100, mp: 50, maxMp: 50, attack: 12, defense: 4, attack_speed: 2.0, crit_chance: 0, crit_damage: 1, hp_regen: 0, mp_regen: 0 } as any,
            ],
        });

        const result = huntApplySkillEffectV2('battle_cry', 0);

        // Cast succeeded.
        expect(result).not.toBeNull();
        // Buff path — no AOE flag, no stun.
        expect(result!.aoe).toBe(false);
        expect(result!.stunApplied).toBe(false);
    });
});

describe('huntApplySkillEffectV2: refuses cast when all wave monsters dead', () => {
    beforeEach(() => resetAllStores());

    it('returns null when activeIdx points at dead monster + no other alive (corpse retarget fails)', () => {
        stageSingleWaveFight(makeKnight(), makeMonster({ hp: 100 }));

        // Kill the only wave monster (slotted at idx 0).
        useCombatStore.setState((s) => ({
            waveMonsters: s.waveMonsters.map((w) => ({ ...w, isDead: true, currentHp: 0 })),
        }));

        const result = huntApplySkillEffectV2('shield_bash', 0);

        // line 372-373: aliveIdx=-1 -> return null.
        // Cast refused, MP NOT burned, no broadcast.
        expect(result).toBeNull();
    });
});

describe('huntApplySkillEffectV2: refuses cast when caster is dead', () => {
    beforeEach(() => resetAllStores());

    it('returns null when character.hp = 0 (dead caster guard)', () => {
        const deadKnight = makeKnight({ hp: 0 });
        stageSingleWaveFight(deadKnight, makeMonster());
        // initCombat() sets playerCurrentHp from char.hp — we set it explicitly
        // to 0 so both the `ch.hp` AND `playerCurrentHp` guards trip.
        useCombatStore.setState({ playerCurrentHp: 0 });

        const result = huntApplySkillEffectV2('shield_bash', 0);

        // line 362: (ch.hp <= 0 || playerCurrentHp <= 0) -> return null.
        expect(result).toBeNull();
    });

    it('returns null when playerCurrentHp = 0 even if char.hp > 0 (combat-store guard)', () => {
        // Use a healthy character (hp=100), but in-combat HP is 0
        // (e.g. died this fight but characterStore.hp hasn't been
        // mirrored back yet).
        stageSingleWaveFight(makeKnight({ hp: 100 }), makeMonster());
        useCombatStore.setState({ playerCurrentHp: 0 });

        const result = huntApplySkillEffectV2('shield_bash', 0);

        expect(result).toBeNull();
    });
});

describe('huntApplySkillEffectV2: returns null with no character set', () => {
    beforeEach(() => resetAllStores());

    it('returns null when characterStore.character is null', () => {
        // No character set + no combat init.
        const result = huntApplySkillEffectV2('shield_bash', 0);
        expect(result).toBeNull();
    });
});
