/**
 * Emoji icons for every active skill and weapon skill.
 * Import this map wherever you need to display skill icons.
 */
export const SKILL_ICONS: Record<string, string> = {
  // ── Weapon / utility skills ────────────────────────────────────────────────
  sword_fighting: '⚔️',
  distance_fighting: '🏹',
  dagger_fighting: '🗡️',
  magic_level: '🔮',
  bard_level: '🎵',
  shielding: '🛡️',

  // ── Knight ─────────────────────────────────────────────────────────────────
  shield_bash: '⚔️🛡️',
  battle_cry: '📢🔴',
  whirlwind: '🌀⚔️',
  fortify: '🛡️🔵',
  berserker_rage: '😤🔥',
  iron_defense: '🛡️💎',
  charge: '⚡🏃',
  execute: '💀⚔️',
  war_cry: '📢⚔️',
  ultimate_slash: '⚔️💥',
  sword_mastery: '⚔️✨',
  titan_cleave: '🪨⚔️',
  divine_strike: '✨⚔️',
  god_slash: '👑⚔️',
  absolute_cleave: '💥🌟',

  // ── Mage ───────────────────────────────────────────────────────────────────
  fireball: '🔥',
  ice_lance: '❄️',
  thunder_strike: '⚡',
  mana_shield: '🛡️💙',
  arcane_bolt: '✨💜',
  blizzard: '❄️🌀',
  meteor: '☄️',
  time_warp: '⏳',
  arcane_explosion: '💥💜',
  apocalypse_spell: '🌋',
  void_ray: '🌑✨',
  reality_rend: '🌀💥',
  singularity: '🕳️',
  god_nova: '👑💜',
  big_bang: '💥🌌',

  // ── Cleric ─────────────────────────────────────────────────────────────────
  holy_strike: '⚡✝️',
  heal: '💚',
  divine_shield: '🛡️✨',
  smite: '⚡✝️',
  blessing: '🙏✨',
  resurrection_aura: '💛🔄',
  holy_nova: '💚🌟',
  consecration: '✝️🔥',
  divine_intervention: '🙏💛',
  holy_judgment: '⚖️✨',
  divine_wrath: '⚡💛',
  celestial_heal: '💚✨',
  apocalypse_prayer: '🙏🔥',
  divine_pillar: '✝️💎',
  holy_apocalypse: '✝️🌟',

  // ── Archer ─────────────────────────────────────────────────────────────────
  precise_shot: '🏹🎯',
  poison_arrow: '🏹☠️',
  eagle_eye: '👁️🎯',
  rain_of_arrows: '🏹🌧️',
  trap: '🪤',
  multishot: '🏹🏹',
  wind_arrow: '🏹💨',
  sniper_shot: '🎯💀',
  shadow_step: '👣💨',
  death_arrow: '🏹💀',
  celestial_arrow: '🏹✨',
  void_shot: '🏹🌑',
  god_arrow: '🏹👑',
  destiny_shot: '🏹🔮',
  universe_arrow: '🏹🌌',

  // ── Rogue ──────────────────────────────────────────────────────────────────
  backstab: '🗡️💨',
  poison_blade: '🗡️☠️',
  evasion: '💨👤',
  dual_strike: '🗡️🗡️',
  smoke_bomb: '💨💣',
  assassinate: '💀🗡️',
  hemorrhage: '🩸',
  shadow_clone: '👥',
  marked_for_death: '🎯💀',
  instant_kill: '⚡💀',
  shadow_death: '👤💀',
  void_strike: '🗡️🌑',
  death_touch: '☠️✋',
  god_assassin: '👑🗡️',
  absolute_death: '💀🌟',

  // ── Necromancer ────────────────────────────────────────────────────────────
  life_drain: '❤️‍🔥',
  summon_skeleton: '💀🦴',
  death_curse: '☠️💜',
  bone_spear: '🦴⚡',
  plague: '🦠',
  raise_dead: '💀⬆️',
  soul_harvest: '👻',
  dark_ritual: '📖💀',
  army_of_darkness: '💀💀',
  death_coil: '☠️💥',
  apocalypse_rise: '💀🌋',
  death_realm: '☠️🌑',
  soul_storm: '👻🌀',
  lich_transformation: '💀👑',
  death_apocalypse: '☠️🌟',

  // ── Bard ───────────────────────────────────────────────────────────────────
  battle_hymn: '🎵⚔️',
  lullaby: '🎵💤',
  ballad_of_heroes: '🎵🦸',
  dissonance: '🎵💜',
  war_song: '🎵🔥',
  heroic_ballad: '🎵🛡️',
  requiem: '🎵💀',
  sirens_call: '🎵🧜',
  epic_saga: '🎵📖',
  legends_anthem: '🎵👑',
  divine_melody: '🎵✨',
  song_of_doom: '🎵☠️',
  cosmic_hymn: '🎵🌌',
  god_ballad: '🎵💎',
  universe_song: '🎵🌟',
};

/**
 * Get the icon for a skill by its id.
 *
 * Now resolves to the per-class artwork at
 * `assets/images/spells/{class}-{index}.png` when available — falls back
 * to the historic emoji map (and finally a generic sparkle) so legacy
 * call sites don't break while the artwork registry is being populated.
 */
import skillsData from './skills.json';
import { getSpellImage } from '../systems/spriteAssets';

interface IActiveSkillRow { id: string }

const SKILL_TO_IMAGE_KEY: Record<string, { className: string; index: number }> = (() => {
  const out: Record<string, { className: string; index: number }> = {};
  const classes = skillsData.activeSkills as Record<string, IActiveSkillRow[]>;
  for (const [cls, skills] of Object.entries(classes)) {
    skills.forEach((s, idx) => {
      out[s.id] = { className: cls, index: idx + 1 };
    });
  }
  return out;
})();

export const getSkillIcon = (skillId: string): string => {
  const key = SKILL_TO_IMAGE_KEY[skillId];
  if (key) {
    const url = getSpellImage(key.className, key.index);
    if (url) return url;
  }
  return SKILL_ICONS[skillId] ?? '✦';
};
