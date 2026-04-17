/**
 * Parse a skill's `effect` field (e.g. "crit_chance_up_0.3_10s") and, when it
 * represents a self-buff with a timed duration, register an entry in the
 * BuffStore so the player can see the remaining time in the BuffBar.
 *
 * Enemy debuffs (stun, slow, defense_down, poison_dot, …) are intentionally
 * ignored – those are applied directly to the monster via combat logic.
 *
 * Called from both the auto-skill path in the combat tick and the manual skill
 * click handler so that every cast lights up the buff bar.
 */
import { useBuffStore } from '../stores/buffStore';
import { SKILL_ICONS } from '../data/skillIcons';
import skillsData from '../data/skills.json';

interface ISkillDef {
    id: string;
    name_pl?: string;
    name_en?: string;
    effect?: string | null;
}

/** Flat index of every active skill across all classes, keyed by skill id. */
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

/** Effect prefixes that target the enemy, NOT the player. */
const ENEMY_DEBUFF_PREFIXES = [
    'enemy_',
    'defense_down',
    'dmg_taken_up',
    'miss_chance',
    'immobilize',
    'stun',
    'root',
    'confuse_enemy',
    'slow_',
    'poison_dot',
    'bleed_dot',
    'undead_dot',
    'holy_ground_dot',
    'burn_chance',
    'armor_break',
    'doom_dmg_aoe',
    'knockback',
    'gravity_pull',
    'mana_drain',
    'armor_ignore',
    'ignore_defense',
    'ignore_all_defense',
    'magic_pen',
    'holy_armor_destroy',
    'all_attack_doom',
];

/** Extract the last numeric seconds value from a string like "x_up_0.3_10s". */
const parseDurationSec = (effect: string): number | null => {
    const matches = [...effect.matchAll(/(\d+(?:\.\d+)?)s(?!\w)/g)];
    if (matches.length === 0) return null;
    const last = matches[matches.length - 1];
    const n = parseFloat(last[1]);
    return Number.isFinite(n) && n > 0 ? n : null;
};

interface IBuffDescriptor {
    label: string;
    icon: string;
}

/** Build a human-readable label + emoji for known self-buff effects. */
const describeBuff = (effect: string, skillId: string, skillIcon: string): IBuffDescriptor | null => {
    // crit_chance_up_0.3_10s → +30% Crit Chance
    const critMatch = effect.match(/^crit_chance_up_(\d+(?:\.\d+)?)_/);
    if (critMatch) return { label: `+${Math.round(parseFloat(critMatch[1]) * 100)}% Crit`, icon: skillIcon || '🎯' };

    // attack_up_0.5_6s → +50% ATK
    const atkMatch = effect.match(/^attack_up_(\d+(?:\.\d+)?)_/);
    if (atkMatch) return { label: `+${Math.round(parseFloat(atkMatch[1]) * 100)}% ATK`, icon: skillIcon || '⚔️' };

    // attack_speed_up_0.5_8s → +50% AS
    const asMatch = effect.match(/^attack_speed_up_(\d+(?:\.\d+)?)_/);
    if (asMatch) return { label: `+${Math.round(parseFloat(asMatch[1]) * 100)}% AS`, icon: skillIcon || '⚡' };

    // defense_up_0.3_8s → +30% DEF
    const defMatch = effect.match(/^defense_up_(\d+(?:\.\d+)?)_/);
    if (defMatch) return { label: `+${Math.round(parseFloat(defMatch[1]) * 100)}% DEF`, icon: skillIcon || '🛡️' };

    // magic_level_up_5_15s → +5 MLVL
    const mlvlMatch = effect.match(/^magic_level_up_(\d+(?:\.\d+)?)_/);
    if (mlvlMatch) return { label: `+${parseFloat(mlvlMatch[1])} MLVL`, icon: skillIcon || '🔮' };

    // block_0.5_10s → +50% Block
    const blockMatch = effect.match(/^block_(\d+(?:\.\d+)?)_/);
    if (blockMatch) return { label: `+${Math.round(parseFloat(blockMatch[1]) * 100)}% Block`, icon: skillIcon || '🛡️' };

    // Party buffs
    const partyAllMatch = effect.match(/^party_all_up_(\d+(?:\.\d+)?)_/);
    if (partyAllMatch) return { label: `Party +${Math.round(parseFloat(partyAllMatch[1]) * 100)}% All`, icon: skillIcon || '🤝' };

    const partyAtkMatch = effect.match(/^party_attack_up_(\d+(?:\.\d+)?)_/);
    if (partyAtkMatch) return { label: `Party +${Math.round(parseFloat(partyAtkMatch[1]) * 100)}% ATK`, icon: skillIcon || '⚔️' };

    const partyCritMatch = effect.match(/^party_crit_up_(\d+(?:\.\d+)?)_/);
    if (partyCritMatch) return { label: `Party +${Math.round(parseFloat(partyCritMatch[1]) * 100)}% Crit`, icon: skillIcon || '🎯' };

    // Simple timed self-buffs without stacked numeric value
    if (effect.startsWith('evasion_')) return { label: 'Unik', icon: skillIcon || '💨' };
    if (effect.startsWith('evade_next_')) return { label: 'Unik następny', icon: skillIcon || '💨' };
    if (effect.startsWith('party_invincible_')) return { label: 'Party Niezniszczalny', icon: skillIcon || '✨' };
    if (effect.startsWith('invincible_')) return { label: 'Niezniszczalny', icon: skillIcon || '✨' };
    if (effect.startsWith('become_lich_')) return { label: 'Lich Form', icon: skillIcon || '💀' };
    if (effect.startsWith('party_hp_regen_')) return { label: 'Party HP Regen', icon: skillIcon || '❤️' };

    return null;
};

/**
 * Given a skill id + skill definition, check if it's a timed self-buff and,
 * if so, add it to the buff bar for the remaining duration.
 * Safe no-op for damage skills, enemy debuffs, or untimed passive effects.
 */
export const applySkillBuff = (
    skillId: string,
    skillDef: { effect?: string | null; name_pl?: string; name_en?: string },
): void => {
    const effect = skillDef.effect;
    if (!effect) return;

    // Ignore enemy debuffs – those are handled by combat logic directly.
    if (ENEMY_DEBUFF_PREFIXES.some((p) => effect.startsWith(p))) return;

    const seconds = parseDurationSec(effect);
    if (seconds === null) return; // not a timed buff

    const skillIcon = SKILL_ICONS[skillId] ?? '✨';
    const desc = describeBuff(effect, skillId, skillIcon);
    if (!desc) return;

    const skillName = skillDef.name_pl ?? skillId;

    // Refresh semantics: re-casting a skill buff should reset the timer to the
    // fresh duration, not stack on top of the remaining time. Remove any
    // existing instance for this skill before adding the new one.
    const effectKey = `skill_${skillId}`;
    useBuffStore.getState().removeBuffByEffect(effectKey);
    useBuffStore.getState().addBuff(
        {
            id: `skill_buff_${skillId}`,
            name: skillName,
            icon: desc.icon,
            effect: effectKey,
        },
        seconds * 1000,
    );
};
