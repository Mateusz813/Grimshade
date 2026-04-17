// ── Skill Animation Mapping ─────────────────────────────────────────────────
// Maps each active skill ID to a visual animation category shown on the monster
// when the skill fires in combat.

export type SkillAnimCategory =
  | 'fire'
  | 'ice'
  | 'lightning'
  | 'holy'
  | 'dark'
  | 'physical'
  | 'arrow'
  | 'music'
  | 'arcane'
  | 'poison'
  | 'buff'
  | 'summon';

export interface ISkillAnimation {
  category: SkillAnimCategory;
  emoji: string;
  /** CSS class suffix appended to the overlay element */
  cssClass: string;
  /** Duration in ms */
  duration: number;
  /** Primary colour (for reference / potential inline use) */
  color: string;
}

const ANIM_PRESETS: Record<SkillAnimCategory, Omit<ISkillAnimation, 'emoji'>> = {
  fire:      { category: 'fire',      cssClass: 'skill-anim--fire',      duration: 900,  color: '#ff5722' },
  ice:       { category: 'ice',       cssClass: 'skill-anim--ice',       duration: 800,  color: '#29b6f6' },
  lightning: { category: 'lightning',  cssClass: 'skill-anim--lightning', duration: 600,  color: '#ffeb3b' },
  holy:      { category: 'holy',      cssClass: 'skill-anim--holy',      duration: 1000, color: '#ffd54f' },
  dark:      { category: 'dark',      cssClass: 'skill-anim--dark',      duration: 1000, color: '#7b1fa2' },
  physical:  { category: 'physical',  cssClass: 'skill-anim--physical',  duration: 700,  color: '#ffffff' },
  arrow:     { category: 'arrow',     cssClass: 'skill-anim--arrow',     duration: 700,  color: '#66bb6a' },
  music:     { category: 'music',     cssClass: 'skill-anim--music',     duration: 1000, color: '#ff9800' },
  arcane:    { category: 'arcane',    cssClass: 'skill-anim--arcane',    duration: 900,  color: '#ce93d8' },
  poison:    { category: 'poison',    cssClass: 'skill-anim--poison',    duration: 800,  color: '#69f0ae' },
  buff:      { category: 'buff',      cssClass: 'skill-anim--buff',      duration: 800,  color: '#4fc3f7' },
  summon:    { category: 'summon',    cssClass: 'skill-anim--summon',    duration: 1000, color: '#795548' },
};

function anim(category: SkillAnimCategory, emoji: string): ISkillAnimation {
  return { ...ANIM_PRESETS[category], emoji };
}

/**
 * Mapping from skill ID -> visual animation data.
 * Skills that are pure self-buffs still get a visual so the player sees feedback.
 */
export const SKILL_ANIMATIONS: Record<string, ISkillAnimation> = {
  // ── Knight ──────────────────────────────────────────────────────────────────
  shield_bash:     anim('physical',  '🛡️'),
  battle_cry:      anim('buff',      '📯'),
  whirlwind:       anim('physical',  '🌪️'),
  fortify:         anim('buff',      '🏰'),
  berserker_rage:  anim('fire',      '🔥'),
  iron_defense:    anim('buff',      '🛡️'),
  charge:          anim('physical',  '⚡'),
  execute:         anim('physical',  '💀'),
  war_cry:         anim('buff',      '📯'),
  ultimate_slash:  anim('physical',  '⚔️'),
  sword_mastery:   anim('physical',  '🗡️'),
  titan_cleave:    anim('physical',  '💥'),
  divine_strike:   anim('holy',      '✨'),
  god_slash:       anim('holy',      '⚔️'),
  absolute_cleave: anim('physical',  '💀'),

  // ── Mage ────────────────────────────────────────────────────────────────────
  fireball:         anim('fire',      '🔥'),
  ice_lance:        anim('ice',       '❄️'),
  thunder_strike:   anim('lightning', '⚡'),
  mana_shield:      anim('buff',      '🔮'),
  arcane_bolt:      anim('arcane',    '🔮'),
  blizzard:         anim('ice',       '🌨️'),
  meteor:           anim('fire',      '☄️'),
  time_warp:        anim('buff',      '⏳'),
  arcane_explosion: anim('arcane',    '💫'),
  apocalypse_spell: anim('fire',      '🌋'),
  void_ray:         anim('dark',      '🕳️'),
  reality_rend:     anim('arcane',    '🌀'),
  singularity:      anim('dark',      '⚫'),
  god_nova:         anim('holy',      '☀️'),
  big_bang:         anim('fire',      '💥'),

  // ── Cleric ──────────────────────────────────────────────────────────────────
  holy_strike:        anim('holy',    '✨'),
  heal:               anim('holy',    '💚'),
  divine_shield:      anim('buff',    '🛡️'),
  smite:              anim('holy',    '⚡'),
  blessing:           anim('holy',    '🙏'),
  resurrection_aura:  anim('holy',    '👼'),
  holy_nova:          anim('holy',    '💫'),
  consecration:       anim('holy',    '🔆'),
  divine_intervention:anim('holy',    '🌟'),
  holy_judgment:      anim('holy',    '⚖️'),
  divine_wrath:       anim('holy',    '💥'),
  celestial_heal:     anim('holy',    '💚'),
  apocalypse_prayer:  anim('holy',    '🙏'),
  divine_pillar:      anim('holy',    '🏛️'),
  holy_apocalypse:    anim('holy',    '☀️'),

  // ── Archer ──────────────────────────────────────────────────────────────────
  precise_shot:    anim('arrow',    '🎯'),
  poison_arrow:    anim('poison',   '☠️'),
  eagle_eye:       anim('buff',     '🦅'),
  rain_of_arrows:  anim('arrow',    '🏹'),
  trap:            anim('arrow',    '🪤'),
  multishot:       anim('arrow',    '🏹'),
  wind_arrow:      anim('arrow',    '💨'),
  sniper_shot:     anim('arrow',    '🎯'),
  shadow_step:     anim('dark',     '👤'),
  death_arrow:     anim('dark',     '💀'),
  celestial_arrow: anim('holy',     '🌟'),
  void_shot:       anim('dark',     '🕳️'),
  god_arrow:       anim('holy',     '⚡'),
  destiny_shot:    anim('arcane',   '🌠'),
  universe_arrow:  anim('arcane',   '🌌'),

  // ── Rogue ───────────────────────────────────────────────────────────────────
  backstab:         anim('physical', '🗡️'),
  poison_blade:     anim('poison',   '☠️'),
  evasion:          anim('buff',     '💨'),
  dual_strike:      anim('physical', '⚔️'),
  smoke_bomb:       anim('dark',     '💨'),
  assassinate:      anim('physical', '💀'),
  hemorrhage:       anim('poison',   '🩸'),
  shadow_clone:     anim('dark',     '👤'),
  marked_for_death: anim('dark',     '💀'),
  instant_kill:     anim('dark',     '☠️'),
  shadow_death:     anim('dark',     '🌑'),
  void_strike:      anim('dark',     '🕳️'),
  death_touch:      anim('dark',     '💀'),
  god_assassin:     anim('dark',     '⚔️'),
  absolute_death:   anim('dark',     '☠️'),

  // ── Necromancer ─────────────────────────────────────────────────────────────
  life_drain:       anim('dark',     '💜'),
  summon_skeleton:  anim('summon',   '💀'),
  death_curse:      anim('dark',     '🔮'),
  bone_spear:       anim('physical', '🦴'),
  plague:           anim('poison',   '☣️'),
  raise_dead:       anim('summon',   '💀'),
  soul_harvest:     anim('dark',     '👻'),
  dark_ritual:      anim('dark',     '🔮'),
  army_of_darkness: anim('summon',   '💀'),
  death_coil:       anim('dark',     '🌀'),
  apocalypse_rise:  anim('summon',   '💀'),
  death_realm:      anim('dark',     '🌑'),
  soul_storm:       anim('dark',     '👻'),
  lich_transformation: anim('dark',  '👑'),
  death_apocalypse: anim('dark',     '☠️'),

  // ── Bard ────────────────────────────────────────────────────────────────────
  battle_hymn:      anim('music',    '🎵'),
  lullaby:          anim('music',    '🎶'),
  ballad_of_heroes: anim('music',    '🎼'),
  dissonance:       anim('music',    '🔊'),
  war_song:         anim('music',    '🎵'),
  heroic_ballad:    anim('music',    '🎶'),
  requiem:          anim('music',    '🎻'),
  sirens_call:      anim('music',    '🧜'),
  epic_saga:        anim('music',    '📜'),
  legends_anthem:   anim('music',    '🏆'),
  divine_melody:    anim('music',    '✨'),
  song_of_doom:     anim('music',    '💀'),
  cosmic_hymn:      anim('music',    '🌌'),
  god_ballad:       anim('music',    '👑'),
  universe_song:    anim('music',    '🌠'),
};

/**
 * Look up the animation data for a skill. Returns undefined for unknown IDs.
 */
export const getSkillAnimation = (skillId: string): ISkillAnimation | undefined => {
  return SKILL_ANIMATIONS[skillId];
};
