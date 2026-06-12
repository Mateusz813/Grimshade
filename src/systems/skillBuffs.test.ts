import { describe, it, expect, beforeEach } from 'vitest';
import {
    applySkillBuff,
    getSkillDef,
    CHARGE_BUFF_EFFECT_KEY,
} from './skillBuffs';
import { useBuffStore } from '../stores/buffStore';
import { useCharacterStore } from '../stores/characterStore';
import type { ICharacter } from '../api/v1/characterApi';

// -- Helpers ------------------------------------------------------------------

const CHAR_ID = 'char-skillbuff-test';

const makeChar = (overrides: Partial<ICharacter> = {}): ICharacter => ({
    id: CHAR_ID,
    user_id: 'user-1',
    name: 'Test',
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
    crit_chance: 5,
    crit_damage: 200,
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

beforeEach(() => {
    useCharacterStore.setState({ character: makeChar(), isLoading: false });
    useBuffStore.setState({ allBuffs: [], combatSpeedMult: 1 });
});

const charBuffs = () =>
    useBuffStore.getState().allBuffs.filter((b) => b.characterId === CHAR_ID);

// -- CHARGE_BUFF_EFFECT_KEY ---------------------------------------------------

describe('CHARGE_BUFF_EFFECT_KEY', () => {
    it('prefixes the atom head with skill_charge_', () => {
        expect(CHARGE_BUFF_EFFECT_KEY('dodge_next')).toBe('skill_charge_dodge_next');
        expect(CHARGE_BUFF_EFFECT_KEY('dmg_amp_next')).toBe('skill_charge_dmg_amp_next');
        expect(CHARGE_BUFF_EFFECT_KEY('crit_next')).toBe('skill_charge_crit_next');
    });
});

// -- getSkillDef --------------------------------------------------------------

describe('getSkillDef', () => {
    it('returns undefined for unknown skill ids', () => {
        expect(getSkillDef('this_skill_does_not_exist_xyz')).toBeUndefined();
    });

    it('returns the skill def for a known active skill (Knight Shield Bash)', () => {
        // From skills.json (Knight active skill list): id=shield_bash.
        const def = getSkillDef('shield_bash');
        expect(def).toBeDefined();
        expect(def!.id).toBe('shield_bash');
        expect(def!.effect).toContain('stun');
    });

    it('returns a skill def with effect, mpCost, cooldown when present', () => {
        const def = getSkillDef('shield_bash');
        expect(def?.mpCost).toBeTypeOf('number');
        expect(def?.cooldown).toBeTypeOf('number');
    });
});

// -- applySkillBuff — early returns -------------------------------------------

describe('applySkillBuff — early returns', () => {
    it('is a no-op when effect is null', () => {
        applySkillBuff('any', { effect: null });
        expect(charBuffs()).toHaveLength(0);
    });

    it('is a no-op when effect is undefined', () => {
        applySkillBuff('any', {});
        expect(charBuffs()).toHaveLength(0);
    });

    it('is a no-op when effect is empty string', () => {
        applySkillBuff('any', { effect: '' });
        expect(charBuffs()).toHaveLength(0);
    });
});

// -- applySkillBuff — timed self buffs ----------------------------------------

describe('applySkillBuff — timed self buffs', () => {
    it('registers a crit_buff atom as a game-time buff', () => {
        applySkillBuff('skill_x', { effect: 'crit_buff:30:10000', name_pl: 'Test Spell' });
        const buffs = charBuffs();
        expect(buffs).toHaveLength(1);
        expect(buffs[0].timerMode).toBe('game');
        expect(buffs[0].gameMsRemaining).toBe(10000);
        expect(buffs[0].effect).toBe('skill_skill_x_0');
        expect(buffs[0].name).toBe('Test Spell');
    });

    it('registers attack_up as a self timed buff', () => {
        applySkillBuff('skill_y', { effect: 'attack_up:50:6000', name_pl: 'Berserk' });
        const b = charBuffs()[0];
        expect(b.gameMsRemaining).toBe(6000);
        expect(b.effect).toBe('skill_skill_y_0');
    });

    it('registers dodge_buff with the provided duration', () => {
        applySkillBuff('skill_z', { effect: 'dodge_buff:40:5000', name_pl: 'Evade' });
        const b = charBuffs()[0];
        expect(b.gameMsRemaining).toBe(5000);
    });

    it('registers immortal using parts[1] as the duration', () => {
        // immortal:durationMs — durationMs lives in parts[1] (n1), per buffFromAtom.
        applySkillBuff('s', { effect: 'immortal:3000' });
        const b = charBuffs()[0];
        expect(b.gameMsRemaining).toBe(3000);
    });

    it('registers mana_shield using parts[1] as the duration', () => {
        applySkillBuff('s', { effect: 'mana_shield:8000' });
        const b = charBuffs()[0];
        expect(b.gameMsRemaining).toBe(8000);
    });

    it('skips atoms whose duration parses to 0', () => {
        // crit_buff:30:0 -> durationMs = 0 -> spec.durationMs <= 0 -> skipped.
        applySkillBuff('s', { effect: 'crit_buff:30:0' });
        expect(charBuffs()).toHaveLength(0);
    });

    it('falls back to the skill id when name_pl is missing', () => {
        applySkillBuff('skill_abc', { effect: 'attack_up:50:6000' });
        const b = charBuffs()[0];
        expect(b.name).toBe('skill_abc');
    });
});

// -- applySkillBuff — party buffs ---------------------------------------------

describe('applySkillBuff — party buffs', () => {
    it('registers party_attack_up with "(party)" suffix', () => {
        applySkillBuff('battle_cry', { effect: 'party_attack_up:20:5000', name_pl: 'Okrzyk' });
        const b = charBuffs()[0];
        expect(b.gameMsRemaining).toBe(5000);
        expect(b.name).toContain('(party)');
    });

    it('registers party_defense_up', () => {
        applySkillBuff('fortify', { effect: 'party_defense_up:30:8000', name_pl: 'Umoc' });
        const b = charBuffs()[0];
        expect(b.gameMsRemaining).toBe(8000);
    });

    it('registers party_immortal using parts[1]', () => {
        // party_immortal:N (n1=duration).
        applySkillBuff('s', { effect: 'party_immortal:4000' });
        const b = charBuffs()[0];
        expect(b.gameMsRemaining).toBe(4000);
    });

    it('attaches healPctPerSec payload for heal_party_dot', () => {
        // heal_party_dot:durationMs:pctPerSec -> duration = n1, pct = parts[2].
        applySkillBuff('blessing', { effect: 'heal_party_dot:10000:5', name_pl: 'Heal' });
        const b = charBuffs()[0];
        expect(b.gameMsRemaining).toBe(10000);
        expect(b.healPctPerSec).toBe(5);
    });
});

// -- applySkillBuff — multi-atom effects --------------------------------------

describe('applySkillBuff — multi-atom effects', () => {
    it('emits ONE BuffBar entry per qualifying atom', () => {
        applySkillBuff('s', { effect: 'aoe;party_attack_up:50:30000', name_pl: 'Combo' });
        // `aoe` is not a buff atom -> no entry. `party_attack_up` -> 1 entry.
        expect(charBuffs()).toHaveLength(1);
        expect(charBuffs()[0].effect).toBe('skill_s_1');
    });

    it('emits two entries when the skill has two timed buff atoms', () => {
        applySkillBuff('s', { effect: 'attack_up:50:6000;dodge_buff:20:3000', name_pl: 'X' });
        const buffs = charBuffs();
        expect(buffs).toHaveLength(2);
        // Each atom gets a distinct effect key suffixed by its index.
        const keys = buffs.map((b) => b.effect).sort();
        expect(keys).toEqual(['skill_s_0', 'skill_s_1']);
    });

    it('replaces (refreshes) a buff with the same effect key on re-cast', () => {
        applySkillBuff('s', { effect: 'attack_up:50:6000' });
        applySkillBuff('s', { effect: 'attack_up:50:9000' });
        const buffs = charBuffs().filter((b) => b.effect === 'skill_s_0');
        expect(buffs).toHaveLength(1);
        // addBuffGameTime uses max(existing.remaining, new) — older has been
        // wiped by removeBuffByEffect first, so the new 9000 wins.
        expect(buffs[0].gameMsRemaining).toBe(9000);
    });
});

// -- applySkillBuff — charge-based atoms --------------------------------------

describe('applySkillBuff — charge buffs', () => {
    it('registers dodge_next as a charge buff (parts[1] = N charges)', () => {
        // dodge_next:N:scope -> N is parts[1].
        applySkillBuff('shadow_step', { effect: 'dodge_next:3', name_pl: 'Krok Cienia' });
        const b = charBuffs()[0];
        expect(b.effect).toBe('skill_charge_dodge_next');
        expect(b.charges).toBe(3);
        // chargeStackCap = chargesToAdd × 2.
        expect(b.maxCharges).toBe(6);
    });

    it('stacks dodge_next charges up to maxCharges on repeat casts', () => {
        applySkillBuff('shadow_step', { effect: 'dodge_next:3' });
        applySkillBuff('shadow_step', { effect: 'dodge_next:3' });
        const b = charBuffs().find((x) => x.effect === 'skill_charge_dodge_next')!;
        // 3 + 3 = 6 charges; cap = 6 — at cap.
        expect(b.charges).toBe(6);
    });

    it('registers dmg_amp_next using parts[2] as the charge count and parts[1] as the multiplier', () => {
        // dmg_amp_next:M:N (M=mult, N=count).
        applySkillBuff('god_arrow', { effect: 'dmg_amp_next:2:8' });
        const b = charBuffs()[0];
        expect(b.effect).toBe('skill_charge_dmg_amp_next');
        expect(b.charges).toBe(8);
        expect(b.maxCharges).toBe(16); // 8 * 2
        // Label tagged with ×2 multiplier.
        expect(b.name).toContain('×2');
    });

    it('registers crit_next using parts[1] as the charge count', () => {
        // crit_next:N:chance.
        applySkillBuff('s', { effect: 'crit_next:1:1' });
        const b = charBuffs()[0];
        expect(b.effect).toBe('skill_charge_crit_next');
        expect(b.charges).toBe(1);
        expect(b.maxCharges).toBe(2);
    });

    it('registers crit_buff_next with exactly 1 charge', () => {
        applySkillBuff('s', { effect: 'crit_buff_next:30' });
        const b = charBuffs()[0];
        expect(b.effect).toBe('skill_charge_crit_buff_next');
        expect(b.charges).toBe(1);
        expect(b.maxCharges).toBe(2);
    });

    it('registers block_next_party with parts[1] as the count', () => {
        applySkillBuff('divine_shield', { effect: 'block_next_party:1' });
        const b = charBuffs()[0];
        expect(b.effect).toBe('skill_charge_block_next_party');
        expect(b.charges).toBe(1);
    });

    it('registers next_ally_heal using parts[2] as the charge count', () => {
        // next_ally_heal:pct:N (pct=parts[1], N=parts[2]).
        applySkillBuff('s', { effect: 'next_ally_heal:7.5:3' });
        const b = charBuffs()[0];
        expect(b.effect).toBe('skill_charge_next_ally_heal');
        expect(b.charges).toBe(3);
        // Label suffix shows the heal pct.
        expect(b.name).toContain('7.5% heal');
    });

    it('registers party_lifesteal_next with FLAT cap (no ×2 stack rule)', () => {
        // party_lifesteal_next:pct:N — per spec cap = chargesToAdd (no ×2).
        applySkillBuff('s', { effect: 'party_lifesteal_next:100:5' });
        const b = charBuffs()[0];
        expect(b.effect).toBe('skill_charge_party_lifesteal_next');
        expect(b.charges).toBe(5);
        expect(b.maxCharges).toBe(5); // FLAT cap = 5, NOT 10
        expect(b.name).toContain('100% lifesteal');
    });

    it('skips charge atoms with 0 charges', () => {
        applySkillBuff('s', { effect: 'dodge_next:0' });
        expect(charBuffs()).toHaveLength(0);
    });

    it('defaults dmg_amp_next charge count to 1 when parts[2] is missing', () => {
        // `dmg_amp_next:2` — only mult, no count -> defaults to 1.
        applySkillBuff('s', { effect: 'dmg_amp_next:2' });
        const b = charBuffs()[0];
        expect(b.charges).toBe(1);
    });

    it('uses a unique buff id per cast index', () => {
        // The store-side filter only keys by effect (skill_charge_<head>),
        // not by id — but the spec ids the buff `skill_charge_<id>_<i>`.
        applySkillBuff('test_skill', { effect: 'dodge_next:3' });
        const b = charBuffs()[0];
        expect(b.id).toBe('skill_charge_test_skill_0');
    });
});

// -- applySkillBuff — non-buff atoms ------------------------------------------

describe('applySkillBuff — non-buff atoms (no BuffBar entry)', () => {
    it('does not register entries for damage / enemy-debuff atoms', () => {
        applySkillBuff('s', { effect: 'aoe' });
        expect(charBuffs()).toHaveLength(0);

        applySkillBuff('s', { effect: 'stun:3000' });
        expect(charBuffs()).toHaveLength(0);

        applySkillBuff('s', { effect: 'dot:5000:5' });
        expect(charBuffs()).toHaveLength(0);

        applySkillBuff('s', { effect: 'def_pen:50' });
        expect(charBuffs()).toHaveLength(0);
    });

    it('does not register entries for summons', () => {
        applySkillBuff('s', { effect: 'summon:skeleton:2' });
        expect(charBuffs()).toHaveLength(0);
    });
});

// -- applySkillBuff — special timed atoms with implicit duration --------------

describe('applySkillBuff — special atoms', () => {
    it('aggro_steal gets a 2000 ms display window', () => {
        applySkillBuff('s', { effect: 'aggro_steal' });
        const b = charBuffs()[0];
        expect(b.gameMsRemaining).toBe(2000);
    });

    it('party_instant_kill_chance_next is registered as a charge buff', () => {
        // Per CHARGE_ATOMS list, party_instant_kill_chance_next goes through
        // the charge branch. It falls into the default arm (no special parts
        // layout), so chargesToAdd = parseInt(parts[1]) = 20 — i.e. parts[1]
        // is treated as the charge count, parts[2] is dropped.
        applySkillBuff('s', { effect: 'party_instant_kill_chance_next:20:5' });
        const b = charBuffs()[0];
        expect(b.effect).toBe('skill_charge_party_instant_kill_chance_next');
        // Charge buffs use timerMode='pausable' — no gameMsRemaining field.
        expect(b.gameMsRemaining).toBeUndefined();
        // chargesToAdd = parseInt(parts[1]) = 20.
        expect(b.charges).toBe(20);
        // maxCharges = chargesToAdd × 2 = 40.
        expect(b.maxCharges).toBe(40);
    });
});

// -- applySkillBuff — speedMult ignored ---------------------------------------

describe('applySkillBuff — _speedMult is ignored', () => {
    it('ignores the deprecated speedMult arg (game-time buffs scale via tickGameTimeBuffs)', () => {
        applySkillBuff('s', { effect: 'attack_up:50:8000' }, 4);
        const b = charBuffs()[0];
        // Spec'd duration is passed unchanged — drain happens later in tick.
        expect(b.gameMsRemaining).toBe(8000);
    });
});
