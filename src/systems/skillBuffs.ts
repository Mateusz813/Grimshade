import { useBuffStore } from '../stores/buffStore';
import { getSkillIcon } from '../data/skillIcons';
import skillsData from '../data/skills.json';

interface ISkillDef {
    id: string;
    name_pl?: string;
    name_en?: string;
    effect?: string | null;
    mpCost?: number;
    damage?: number;
    cooldown?: number;
    unlockLevel?: number;
    goldCost?: number;
}

const SKILL_INDEX: Record<string, ISkillDef> = (() => {
    const out: Record<string, ISkillDef> = {};
    const active = (skillsData as { activeSkills: Record<string, ISkillDef[]> }).activeSkills;
    for (const classSkills of Object.values(active)) {
        for (const s of classSkills) {
            out[s.id] = s;
        }
    }
    return out;
})();

export const getSkillDef = (skillId: string): ISkillDef | undefined => SKILL_INDEX[skillId];

interface IBuffSpec {
    label: string;
    icon: string;
    durationMs: number;
}

const buffFromAtom = (atom: string, skillIcon: string): IBuffSpec | null => {
    const parts = atom.trim().toLowerCase().split(':');
    const head = parts[0];
    const n1 = parseFloat(parts[1] ?? '0');
    const n2 = parseFloat(parts[2] ?? '0');
    const ic = (fallback: string) => skillIcon || fallback;
    switch (head) {
        case 'crit_buff':       return { label: `+${n1.toFixed(0)}% Crit`,  icon: ic('bullseye'), durationMs: n2 };
        case 'attack_up':       return { label: `+${n1.toFixed(0)}% ATK`,   icon: ic('crossed-swords'), durationMs: n2 };
        case 'dodge_buff':      return { label: `+${n1.toFixed(0)}% Unik`,  icon: ic('dashing-away'), durationMs: n2 };
        case 'immortal':        return { label: 'Niewrażliwość',           icon: ic('sparkles'), durationMs: n1 };
        case 'mana_shield':     return { label: 'Tarcza Many (MP->HP)',      icon: ic('shield'), durationMs: n1 };
        case 'party_attack_up':    return { label: `Party +${n1.toFixed(0)}% ATK`,  icon: ic('crossed-swords'), durationMs: n2 };
        case 'party_defense_up':   return { label: `Party +${n1.toFixed(0)}% DEF`,  icon: ic('shield'), durationMs: n2 };
        case 'party_def_pen':      return { label: `Party Ignore ${n1.toFixed(0)}% DEF`, icon: ic('dagger'), durationMs: n2 };
        case 'party_as_up':        return { label: `Party ×${n1} AS`,              icon: ic('high-voltage'), durationMs: n2 };
        case 'party_crit_up':      return { label: `Party +${n1.toFixed(0)}% Crit`, icon: ic('bullseye'), durationMs: n2 };
        case 'party_immortal':     return { label: 'Party Niewrażliwość',          icon: ic('sparkles'), durationMs: n1 };
        case 'heal_party_dot':     return { label: `Party Regen ${n2}%/s`,          icon: ic('green-heart'), durationMs: n1 };
        case 'aggro_steal':        return { label: 'Aggro Steal',          icon: ic('anger-symbol'), durationMs: 2000 };
        case 'crit_buff_next':     return { label: `+${n1.toFixed(0)}% Crit (next)`, icon: ic('bullseye'), durationMs: 6000 };
        case 'crit_next':          return { label: `Gwarant. crit ×${n2 || 1}`,      icon: ic('collision'), durationMs: 6000 };
        case 'dmg_amp_next':       return { label: `× ${n1} DMG (next ${n2 || 1})`,  icon: ic('fire'), durationMs: 6000 };
        case 'dodge_next':         return { label: `Unik 100% (next ${n1})`,         icon: ic('dashing-away'), durationMs: 6000 };
        case 'party_instant_kill_chance_next': return { label: `Party IK ${n1.toFixed(0)}% (next ${n2 || 1})`,      icon: ic('skull'), durationMs: 10000 };
        default:
            return null;
    }
};

const chargeStackCap = (chargesToAdd: number): number => Math.max(1, chargesToAdd * 2);

const CHARGE_ATOMS = new Set<string>([
    'dodge_next', 'dmg_amp_next', 'crit_next', 'crit_buff_next',
    'block_next_party', 'next_ally_heal', 'party_lifesteal_next',
    'party_instant_kill_chance_next',
]);

export const CHARGE_BUFF_EFFECT_KEY = (atomHead: string): string =>
    `skill_charge_${atomHead}`;

export const applySkillBuff = (
    skillId: string,
    skillDef: { effect?: string | null; name_pl?: string; name_en?: string },
    _speedMult: number = 1,
): void => {
    void _speedMult;
    const effect = skillDef.effect;
    if (!effect) return;

    const skillIcon = getSkillIcon(skillId);
    const skillName = skillDef.name_pl ?? skillId;
    const buffStore = useBuffStore.getState();

    const atoms = effect.split(';');
    for (let i = 0; i < atoms.length; i++) {
        const atom = atoms[i].trim();
        const head = atom.toLowerCase().split(':')[0];
        if (CHARGE_ATOMS.has(head)) {
            const parts = atom.split(':');
            let chargesToAdd: number;
            if (head === 'dmg_amp_next' || head === 'next_ally_heal' || head === 'party_lifesteal_next') {
                chargesToAdd = parseInt(parts[2] ?? '1', 10) || 1;
            } else if (head === 'crit_buff_next') {
                chargesToAdd = 1;
            } else {
                chargesToAdd = parseInt(parts[1] ?? '0', 10) || 0;
            }
            if (chargesToAdd <= 0) continue;
            const effectKey = CHARGE_BUFF_EFFECT_KEY(head);
            const cap = head === 'party_lifesteal_next'
                ? Math.max(1, chargesToAdd)
                : chargeStackCap(chargesToAdd);
            const mult = head === 'dmg_amp_next'
                ? (parseFloat(parts[1] ?? '1') || 1)
                : 0;
            let labelSuffix = mult > 1 ? ` ×${mult.toFixed(mult % 1 === 0 ? 0 : 1)}` : '';
            if (head === 'next_ally_heal') {
                const pct = parseFloat(parts[1] ?? '0') || 0;
                labelSuffix = ` ${pct}% heal`;
            } else if (head === 'party_lifesteal_next') {
                const pct = parseFloat(parts[1] ?? '0') || 0;
                labelSuffix = ` ${pct}% lifesteal`;
            }
            buffStore.addChargeBuff(
                {
                    id: `skill_charge_${skillId}_${i}`,
                    name: `${skillName}${labelSuffix}`,
                    icon: skillIcon,
                    effect: effectKey,
                },
                chargesToAdd,
                cap,
            );
            continue;
        }
        const spec = buffFromAtom(atom, skillIcon);
        if (!spec || spec.durationMs <= 0) continue;
        const effectKey = `skill_${skillId}_${i}`;
        buffStore.removeBuffByEffect(effectKey);
        const payload = head === 'heal_party_dot'
            ? { healPctPerSec: parseFloat(atom.split(':')[2] ?? '0') || 0 }
            : undefined;
        buffStore.addBuffGameTime(
            {
                id: `skill_buff_${skillId}_${i}`,
                name: spec.label.startsWith('Party')
                    ? `${skillName} (party)`
                    : skillName,
                icon: spec.icon,
                effect: effectKey,
            },
            spec.durationMs,
            payload,
        );
    }
};
