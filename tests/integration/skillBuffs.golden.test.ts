import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { applySkillBuff, getSkillDef, CHARGE_BUFF_EFFECT_KEY } from '../../src/systems/skillBuffs';
import { useBuffStore } from '../../src/stores/buffStore';


type TOp = Record<string, string | number | boolean | null>;

let sink: TOp[] = [];

useBuffStore.setState({
    addChargeBuff: (buff, chargesToAdd, maxCharges) => {
        sink.push({
            op: 'addChargeBuff',
            id: buff.id,
            effect: buff.effect,
            chargesToAdd,
            cap: maxCharges,
        });
    },
    removeBuffByEffect: (effect) => {
        sink.push({ op: 'removeBuffByEffect', effect });
    },
    addBuffGameTime: (buff, gameDurationMs, payload) => {
        sink.push({
            op: 'addBuffGameTime',
            id: buff.id,
            effect: buff.effect,
            durationMs: gameDurationMs,
            isParty: buff.name.endsWith(' (party)'),
            healPctPerSec: payload?.healPctPerSec ?? null,
        });
    },
});

const runApply = (skillId: string, effect: string | null): TOp[] => {
    sink = [];
    applySkillBuff(skillId, { effect });
    return sink;
};

const APPLY_CASES: Array<[string, string | null]> = [
    ['eagle_eye', 'crit_buff:30:10000'],
    ['berserker_rage', 'attack_up:50:6000'],
    ['smoke_bomb', 'dodge_buff:50:4000'],
    ['absolute_cleave', 'immortal:10000'],
    ['mana_shield', 'mana_shield:20000'],
    ['battle_cry', 'party_attack_up:20:5000'],
    ['fortify', 'party_defense_up:30:8000'],
    ['heroic_ballad', 'party_def_pen:40:10000'],
    ['ballad_of_heroes', 'party_as_up:1.5:12000'],
    ['war_song', 'party_crit_up:30:12000'],
    ['legends_anthem', 'party_immortal:3000'],
    ['blessing', 'heal_party_dot:10000:5'],
    ['whirlwind', 'aoe;aggro_steal'],
    ['evasion', 'dodge_next:3:non_magic'],
    ['god_arrow', 'dmg_amp_next:2:8'],
    ['arcane_bolt', 'dmg_amp_next:3:1'],
    ['backstab', 'crit_next:1:1'],
    ['precise_shot', 'crit_buff_next:30'],
    ['divine_shield', 'block_next_party:1'],
    ['divine_intervention', 'next_ally_heal:7.5:3'],
    ['divine_wrath', 'party_lifesteal_next:100:5'],
    ['shadow_clone', 'dmg_amp_next:2:1'],
    ['god_slash', 'aggro_steal;crit_next:1:1;dmg_amp_next:5:1'],
    ['divine_melody', 'party_as_up:2:10000;party_attack_up:40:10000'],
    ['universe_song', 'party_immortal:3000;party_attack_up:100:30000;party_as_up:2.2:10000'],
    ['god_ballad', 'aoe;party_attack_up:50:30000'],
    ['apocalypse_spell', 'aoe;immortal:5000'],
    ['holy_apocalypse', 'aoe;party_immortal:5000;revive_party:5000:10000'],
    ['absolute_death', 'instant_kill_chance:8;dodge_next:1:non_magic'],
    ['song_of_doom', 'aoe;party_attack_up:20:20000'],
    ['blizzard', 'aoe'],
    ['assassinate', 'execute_below:20'],
    ['summon_skeleton', 'summon:skeleton:1'],
    ['dark_ritual', 'dark_ritual:10000:25'],
    ['hemorrhage', 'dot:8000:4'],
    ['syn_empty', ''],
    ['syn_null', null],
    ['syn_ws', '  attack_up:50:6000  '],
    ['syn_ws2', 'aoe; party_attack_up:50:5000'],
    ['syn_upper', 'ATTACK_UP:50:6000'],
    ['syn_upper_charge', 'DODGE_NEXT:2:NON_MAGIC'],
    ['syn_zero_dur', 'attack_up:50:0'],
    ['syn_neg_dur', 'attack_up:50:-5000'],
    ['syn_crit_no_dur', 'crit_buff:30'],
    ['syn_immortal_bare', 'immortal'],
    ['syn_heal_dot_zero_dur', 'heal_party_dot:0:5'],
    ['syn_dodge_bare', 'dodge_next'],
    ['syn_dmg_amp_1arg', 'dmg_amp_next:2'],
    ['syn_dmg_amp_0arg', 'dmg_amp_next'],
    ['syn_next_ally_1arg', 'next_ally_heal:7.5'],
    ['syn_lifesteal_1arg', 'party_lifesteal_next:100'],
    ['syn_critbuffnext_extra', 'crit_buff_next:30:99'],
    ['syn_block_bare', 'block_next_party'],
    ['syn_crit_next_2', 'crit_next:2:1'],
    ['syn_next_ally_float', 'next_ally_heal:5:3.9'],
    ['syn_dodge_float_charge', 'dodge_next:2.9:non_magic'],
    ['syn_neg_charge', 'dodge_next:-3:non_magic'],
    ['syn_big_charge', 'dodge_next:100:x'],
    ['syn_heal_dot_no_pct', 'heal_party_dot:10000'],
    ['syn_unknown', 'totally_unknown:1:2'],
    ['syn_all_ignored', 'aoe;summon:skeleton:5'],
    ['syn_index', 'aoe;aoe;party_attack_up:10:5000'],
    ['syn_multi_charge_mix', 'dmg_amp_next:2:3;crit_next:1:1;party_lifesteal_next:50:4'],
];

const SKILL_DEF_IDS = [
    'shield_bash',
    'eagle_eye',
    'blessing',
    'universe_song',
    'absolute_death',
    'sword_fighting',
    'does_not_exist',
];

const CHARGE_KEY_HEADS = [
    'dodge_next',
    'dmg_amp_next',
    'crit_next',
    'crit_buff_next',
    'block_next_party',
    'next_ally_heal',
    'party_lifesteal_next',
    'arbitrary_head',
];

const buildGolden = (): Record<string, unknown> => ({
    system: 'skillBuffs',
    note: 'Generowane z src/systems/skillBuffs.ts. NIE edytuj ręcznie — regeneruj UPDATE_GOLDEN=1. Etykiety/ikony UI pominięte, op-log = liczby + klucze.',
    chargeBuffEffectKey: CHARGE_KEY_HEADS.map((head) => ({ head, value: CHARGE_BUFF_EFFECT_KEY(head) })),
    getSkillDef: SKILL_DEF_IDS.map((skillId) => ({ skillId, value: getSkillDef(skillId) ?? null })),
    applySkillBuff: APPLY_CASES.map(([skillId, effect]) => ({ skillId, effect, ops: runApply(skillId, effect) })),
});

const outPath = resolve(process.cwd(), 'golden/skillBuffs.json');
const computed = buildGolden();

if (process.env.UPDATE_GOLDEN) {
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, `${JSON.stringify(computed, null, 2)}\n`);
}

describe('skillBuffs golden vectors (TS↔PHP parity source)', () => {
    it('committed fixture matches current skillBuffs output', () => {
        expect(existsSync(outPath), 'brak golden/skillBuffs.json — uruchom UPDATE_GOLDEN=1').toBe(true);
        const fixture = JSON.parse(readFileSync(outPath, 'utf8'));
        expect(JSON.parse(JSON.stringify(computed))).toEqual(fixture);
    });
});
