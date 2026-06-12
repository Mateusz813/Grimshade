/**
 * Parse a skill's `effect` field (v2 colon-separated format from skills.json,
 * e.g. "crit_buff:30:10000" or "aoe;party_attack_up:50:30000") and, when it
 * represents a timed self/party buff, register entries in the BuffStore so
 * the player sees the remaining time in the BuffBar (header).
 *
 * Enemy debuffs (stun, paralyze, dot, def_pen, mark_no_heal, …) are
 * intentionally ignored – those are applied directly to the monster status
 * via `skillEffectsV2.applyEffects`.
 *
 * Called from both the auto-skill path in the combat tick and the manual
 * skill click handler so that every cast lights up the buff bar.
 *
 * 2026-05 v6: rewritten from scratch — the previous regex pack only knew the
 * legacy underscore format ("crit_chance_up_0.3_10s"), so EVERY new skill's
 * timed buff was silently dropped. Now we walk the same `;`-separated atoms
 * the v2 engine parses and emit one BuffBar entry per qualifying atom.
 */
import { useBuffStore } from '../stores/buffStore';
import { getSkillIcon } from '../data/skillIcons';
import skillsData from '../data/skills.json';

interface ISkillDef {
    id: string;
    name_pl?: string;
    name_en?: string;
    effect?: string | null;
    /** 2026-05-12 spec ("niech zabiera MP zgodnie z opisem"): per-skill
     *  MP cost from data/skills.json. Falls back to engine default
     *  when missing. Higher-level skills cost meaningfully more
     *  (e.g. god_arrow: 220 MP, universe_arrow: 400 MP). */
    mpCost?: number;
    /** Numeric damage multiplier — runtime field, present in
     *  data/skills.json. Kept untyped before; declared here so
     *  downstream code can read it without `as unknown as` casts. */
    damage?: number;
    /** Cooldown in ms — used by the engine's per-skill CD logic. */
    cooldown?: number;
    /** Minimum character level required to unlock the slot. */
    unlockLevel?: number;
    /** Training-shop gold price to learn the skill. */
    goldCost?: number;
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

interface IBuffSpec {
    label: string;
    icon: string;
    /** Duration in ms. */
    durationMs: number;
}

/**
 * Map a v2 effect atom (already split by `;`) to a BuffBar entry.
 * Returns null for non-buff atoms (damage flags, enemy debuffs, summons).
 *
 * Convention: party_* buffs are still entered into the LOCAL player's
 * BuffBar — they describe what the cast did to *me* (and my party). Each
 * party member would see their own copy via their own client; bots don't
 * need a buff bar.
 */
const buffFromAtom = (atom: string, skillIcon: string): IBuffSpec | null => {
    const parts = atom.trim().toLowerCase().split(':');
    const head = parts[0];
    const n1 = parseFloat(parts[1] ?? '0');
    const n2 = parseFloat(parts[2] ?? '0');
    // Helper — choose `icon` first, fall back to a stat-themed default.
    const ic = (fallback: string) => skillIcon || fallback;
    switch (head) {
        // -- Self timed buffs ---------------------------------------------
        case 'crit_buff':       return { label: `+${n1.toFixed(0)}% Crit`,  icon: ic('bullseye'), durationMs: n2 };
        case 'attack_up':       return { label: `+${n1.toFixed(0)}% ATK`,   icon: ic('crossed-swords'), durationMs: n2 };
        case 'dodge_buff':      return { label: `+${n1.toFixed(0)}% Unik`,  icon: ic('dashing-away'), durationMs: n2 };
        case 'immortal':        return { label: 'Niewrażliwość',           icon: ic('sparkles'), durationMs: n1 };
        case 'mana_shield':     return { label: 'Tarcza Many (MP->HP)',      icon: ic('shield'), durationMs: n1 };
        // -- Party timed buffs --------------------------------------------
        case 'party_attack_up':    return { label: `Party +${n1.toFixed(0)}% ATK`,  icon: ic('crossed-swords'), durationMs: n2 };
        case 'party_defense_up':   return { label: `Party +${n1.toFixed(0)}% DEF`,  icon: ic('shield'), durationMs: n2 };
        case 'party_def_pen':      return { label: `Party Ignore ${n1.toFixed(0)}% DEF`, icon: ic('dagger'), durationMs: n2 };
        case 'party_as_up':        return { label: `Party ×${n1} AS`,              icon: ic('high-voltage'), durationMs: n2 };
        case 'party_crit_up':      return { label: `Party +${n1.toFixed(0)}% Crit`, icon: ic('bullseye'), durationMs: n2 };
        case 'party_immortal':     return { label: 'Party Niewrażliwość',          icon: ic('sparkles'), durationMs: n1 };
        // Cleric Błogosławieństwo — heal_party_dot:durationMs:pctPerSec.
        // Shows the timer in the BuffBar; the actual HP regen tick is
        // driven by TopHeader's centralised tick (so it works in town
        // too) plus per-view ticks (so bots / raid members get healed
        // when in combat).
        case 'heal_party_dot':     return { label: `Party Regen ${n2}%/s`,          icon: ic('green-heart'), durationMs: n1 };
        // -- Marker effects (no duration in the engine but worth showing) -
        case 'aggro_steal':        return { label: 'Aggro Steal',          icon: ic('anger-symbol'), durationMs: 2000 };
        // -- Charge-style "next N attacks" buffs — show a short flash so
        //    the player knows their buff is queued (real consumption is
        //    tracked in the v2 status; bar entry is purely visual). -----
        case 'crit_buff_next':     return { label: `+${n1.toFixed(0)}% Crit (next)`, icon: ic('bullseye'), durationMs: 6000 };
        case 'crit_next':          return { label: `Gwarant. crit ×${n2 || 1}`,      icon: ic('collision'), durationMs: 6000 };
        case 'dmg_amp_next':       return { label: `× ${n1} DMG (next ${n2 || 1})`,  icon: ic('fire'), durationMs: 6000 };
        case 'dodge_next':         return { label: `Unik 100% (next ${n1})`,         icon: ic('dashing-away'), durationMs: 6000 };
        // party_lifesteal_next + next_ally_heal are CHARGE buffs now
        // (CHARGE_ATOMS list above) — BuffBar renders them as "×N"
        // instead of a timer, consumed per qualifying basic attack.
        case 'party_instant_kill_chance_next': return { label: `Party IK ${n1.toFixed(0)}% (next ${n2 || 1})`,      icon: ic('skull'), durationMs: 10000 };
        // block_next_party is now a charge buff (CHARGE_ATOMS list above);
        // BuffBar renders it as "×N" instead of a timer, consumed on the
        // next basic monster hit. Don't return a timed spec here — the
        // charge branch in `applySkillBuff` handles registration.
        default:
            return null;
    }
};

/**
 * Stack cap for charge buffs = chargesToAdd × 2. Stackable to "two
 * casts worth" so a player can pre-load one cast in advance but can't
 * spam-stack indefinitely. Maps cleanly to spec values:
 *   - Krok Cienia    `dodge_next:3`        -> 3 × 2 = 6
 *   - Strzał Boga    `dmg_amp_next:2:8`    -> 8 × 2 = 16
 *   - Cięcie Boga    `dmg_amp_next:5:1`    -> 1 × 2 = 2
 *   - Cięcie Boga    `crit_next:1:1`       -> 1 × 2 = 2
 *   - Knight Ostat.  `crit_next:1:1`       -> 1 × 2 = 2
 *   - Klon Cienia    `dmg_amp_next:2:1`    -> 1 × 2 = 2
 *   - Precyzyjny     `crit_buff_next:30`   -> 1 × 2 = 2
 */
const chargeStackCap = (chargesToAdd: number): number => Math.max(1, chargesToAdd * 2);

/**
 * Atoms that should be tracked as CHARGE-based buffs in the BuffBar
 * (rendered as "×N" instead of a timer; consumed per relevant action
 * via `consumeBuffCharge`).
 *
 * dodge_next         -> consumed when the player takes a basic enemy hit
 * dmg_amp_next       -> consumed when the player lands a basic attack
 *                      (×N dmg multiplier comes from the v2 status queue;
 *                      charge buff is the visible counter)
 * crit_next          -> consumed when the player lands a basic attack
 * crit_buff_next     -> consumed on the next basic attack (one-shot bump)
 * block_next_party   -> Cleric Boska Tarcza. Consumed when the player
 *                      takes a basic monster hit; eats the entire hit
 *                      (BLOCK float). Stacks per cast up to 2 max
 *                      (chargesToAdd × 2 = 1 × 2 = 2). Was previously
 *                      time-based (8s timer) which never blocked
 *                      anything because no consumer was wired.
 * next_ally_heal     -> Cleric Sąd Boży. Each charge fires a
 *                      heal-lowest-ally pulse on the player's next
 *                      basic attack (`next_ally_heal:7.5:3` -> 3
 *                      charges, cap 6).
 * party_lifesteal_next -> Cleric Boski Filar. Each charge heals the
 *                      attacker for pct% of damage dealt this swing.
 *                      Per spec uses a FLAT cap (chargesToAdd, no
 *                      ×2) so `party_lifesteal_next:100:5` -> 5 max.
 */
const CHARGE_ATOMS = new Set<string>([
    'dodge_next', 'dmg_amp_next', 'crit_next', 'crit_buff_next',
    'block_next_party', 'next_ally_heal', 'party_lifesteal_next',
    'party_instant_kill_chance_next',
]);

/**
 * Effect-key the BuffStore uses for a charge buff. Keep stable across
 * the engine + view so `consumeBuffCharge('skill_charge_dodge_next')`
 * always finds the same buff regardless of which skill cast it.
 */
export const CHARGE_BUFF_EFFECT_KEY = (atomHead: string): string =>
    `skill_charge_${atomHead}`;

/**
 * Given a skill id + skill definition, walk its effect atoms and add every
 * timed buff to the BuffBar. Safe no-op for damage skills, enemy debuffs,
 * untimed passive effects, and summons.
 *
 * @param speedMult Combat-speed multiplier (1 / 2 / 4). When > 1 the
 *                  spec'd duration is divided so a 10s buff cast at x4
 *                  expires in 2.5 wall-clock seconds — keeps "10 in-game
 *                  seconds" consistent across speed settings. Default 1
 *                  preserves the legacy behaviour for callers that don't
 *                  know their current speed.
 */
export const applySkillBuff = (
    skillId: string,
    skillDef: { effect?: string | null; name_pl?: string; name_en?: string },
    // 2026-05 v6: speedMult arg deprecated — game-time buffs handle
    // speed scaling via tickGameTimeBuffs in combat views. Kept for
    // backwards compat with old callers; ignored.
    _speedMult: number = 1,
): void => {
    void _speedMult;
    const effect = skillDef.effect;
    if (!effect) return;

    // 2026-05 v6: prefer the per-class spell PNG (assets/images/spells/
    // {class}-{idx}.png) over the legacy emoji map so the BuffBar shows
    // the actual spell artwork instead of "sparkles". `getSkillIcon` falls back
    // to the emoji and finally a generic sparkle so this is safe for any
    // skill id even before the artwork registry is fully populated.
    const skillIcon = getSkillIcon(skillId);
    const skillName = skillDef.name_pl ?? skillId;
    const buffStore = useBuffStore.getState();

    // Multi-atom skills (e.g. "aoe;party_attack_up:50:30000") emit one
    // BuffBar entry per qualifying atom — same caster, distinct effect
    // keys so each can be refreshed independently on re-cast.
    const atoms = effect.split(';');
    for (let i = 0; i < atoms.length; i++) {
        const atom = atoms[i].trim();
        const head = atom.toLowerCase().split(':')[0];
        // -- Charge-based buff branch (Krok Cienia / Unik) -----------------
        // Stacks ×N up to 6 instead of using a timer. Engine consumes one
        // charge per qualifying enemy basic hit via consumeBuffCharge().
        if (CHARGE_ATOMS.has(head)) {
            const parts = atom.split(':');
            // Per-atom charge count layout:
            //   dodge_next:N:scope         -> N is parts[1]
            //   dmg_amp_next:M:N           -> N is parts[2] (M is mult)
            //   crit_next:N:chance         -> N is parts[1]
            //   crit_buff_next:N           -> 1 charge (N is the % bump)
            //   block_next_party:N         -> N is parts[1]
            //   next_ally_heal:pct:N       -> N is parts[2] (pct is heal %)
            //   party_lifesteal_next:pct:N -> N is parts[2] (pct is steal %)
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
            // Per-spec cap rules:
            //   - Boski Filar -> flat cap (no ×2). User explicitly asked
            //     for max stack 5 on `party_lifesteal_next:100:5`.
            //   - Other charge atoms -> standard chargesToAdd × 2 rule.
            const cap = head === 'party_lifesteal_next'
                ? Math.max(1, chargesToAdd)
                : chargeStackCap(chargesToAdd);
            // Tag the BuffBar label with the multiplier when it matters
            // (dmg_amp_next ×2 vs ×5 etc.) so the player sees what the
            // stack actually does. For lifesteal/heal-on-attack we
            // surface the % via the same suffix mechanism.
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
        // Refresh semantics: re-casting the same skill resets the timer.
        // Using `skill_<id>_<idx>` so the same skill firing on two slots
        // (or two skills sharing an atom) don't cancel each other.
        const effectKey = `skill_${skillId}_${i}`;
        buffStore.removeBuffByEffect(effectKey);
        // 2026-05 v6: skill buffs use GAME-TIME mode. Pass the spec'd
        // duration unchanged — `tickGameTimeBuffs` drains it at speed-
        // scaled rate per combat-view tick. So a 20s buff cast at x1
        // drains in 20 wall-seconds; cast at x4 it drains in 5 wall-
        // seconds; switching speed mid-buff just changes the rate.
        // For heal_party_dot we attach pctPerSec on the buff so the
        // centralised TopHeader tick can apply regen even out of
        // combat (it reads getPartyHealDotPctPerSec from BuffStore).
        // `head` is already computed at the top of this loop.
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
