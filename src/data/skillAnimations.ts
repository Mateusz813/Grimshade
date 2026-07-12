
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
  cssClass: string;
  duration: number;
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

export const SKILL_ANIMATIONS: Record<string, ISkillAnimation> = {
  shield_bash:     anim('physical',  'shield'),
  battle_cry:      anim('buff',      'postal-horn'),
  whirlwind:       anim('physical',  'tornado'),
  fortify:         anim('buff',      'castle'),
  berserker_rage:  anim('fire',      'fire'),
  iron_defense:    anim('buff',      'shield'),
  charge:          anim('physical',  'high-voltage'),
  execute:         anim('physical',  'skull'),
  war_cry:         anim('buff',      'postal-horn'),
  ultimate_slash:  anim('physical',  'crossed-swords'),
  sword_mastery:   anim('physical',  'dagger'),
  titan_cleave:    anim('physical',  'collision'),
  divine_strike:   anim('holy',      'sparkles'),
  god_slash:       anim('holy',      'crossed-swords'),
  absolute_cleave: anim('physical',  'skull'),

  fireball:         anim('fire',      'fire'),
  ice_lance:        anim('ice',       'snowflake'),
  thunder_strike:   anim('lightning', 'high-voltage'),
  mana_shield:      anim('buff',      'crystal-ball'),
  arcane_bolt:      anim('arcane',    'crystal-ball'),
  blizzard:         anim('ice',       'cloud-with-snow'),
  meteor:           anim('fire',      'comet'),
  time_warp:        anim('buff',      'hourglass-not-done'),
  arcane_explosion: anim('arcane',    'dizzy'),
  apocalypse_spell: anim('fire',      'volcano'),
  void_ray:         anim('dark',      'hole'),
  reality_rend:     anim('arcane',    'cyclone'),
  singularity:      anim('dark',      'black-circle'),
  god_nova:         anim('holy',      'sun'),
  big_bang:         anim('fire',      'collision'),

  holy_strike:        anim('holy',    'sparkles'),
  heal:               anim('holy',    'green-heart'),
  divine_shield:      anim('buff',    'shield'),
  smite:              anim('holy',    'high-voltage'),
  blessing:           anim('holy',    'folded-hands'),
  resurrection_aura:  anim('holy',    'baby-angel'),
  holy_nova:          anim('holy',    'dizzy'),
  consecration:       anim('holy',    'bright-button'),
  divine_intervention:anim('holy',    'glowing-star'),
  holy_judgment:      anim('holy',    'balance-scale'),
  divine_wrath:       anim('holy',    'collision'),
  celestial_heal:     anim('holy',    'green-heart'),
  apocalypse_prayer:  anim('holy',    'folded-hands'),
  divine_pillar:      anim('holy',    'classical-building'),
  holy_apocalypse:    anim('holy',    'sun'),

  precise_shot:    anim('arrow',    'bullseye'),
  poison_arrow:    anim('poison',   'skull-and-crossbones'),
  eagle_eye:       anim('buff',     'eagle'),
  rain_of_arrows:  anim('arrow',    'bow-and-arrow'),
  trap:            anim('arrow',    'mouse-trap'),
  multishot:       anim('arrow',    'bow-and-arrow'),
  wind_arrow:      anim('arrow',    'dashing-away'),
  sniper_shot:     anim('arrow',    'bullseye'),
  shadow_step:     anim('dark',     'bust-in-silhouette'),
  death_arrow:     anim('dark',     'skull'),
  celestial_arrow: anim('holy',     'glowing-star'),
  void_shot:       anim('dark',     'hole'),
  god_arrow:       anim('holy',     'high-voltage'),
  destiny_shot:    anim('arcane',   'shooting-star'),
  universe_arrow:  anim('arcane',   'milky-way'),

  backstab:         anim('physical', 'dagger'),
  poison_blade:     anim('poison',   'skull-and-crossbones'),
  evasion:          anim('buff',     'dashing-away'),
  dual_strike:      anim('physical', 'crossed-swords'),
  smoke_bomb:       anim('dark',     'dashing-away'),
  assassinate:      anim('physical', 'skull'),
  hemorrhage:       anim('poison',   'drop-of-blood'),
  shadow_clone:     anim('dark',     'bust-in-silhouette'),
  marked_for_death: anim('dark',     'skull'),
  instant_kill:     anim('dark',     'skull-and-crossbones'),
  shadow_death:     anim('dark',     'new-moon'),
  void_strike:      anim('dark',     'hole'),
  death_touch:      anim('dark',     'skull'),
  god_assassin:     anim('dark',     'crossed-swords'),
  absolute_death:   anim('dark',     'skull-and-crossbones'),

  life_drain:       anim('dark',     'purple-heart'),
  summon_skeleton:  anim('summon',   'skull'),
  death_curse:      anim('dark',     'crystal-ball'),
  bone_spear:       anim('physical', 'bone'),
  plague:           anim('poison',   'biohazard'),
  raise_dead:       anim('summon',   'skull'),
  soul_harvest:     anim('dark',     'ghost'),
  dark_ritual:      anim('dark',     'crystal-ball'),
  army_of_darkness: anim('summon',   'skull'),
  death_coil:       anim('dark',     'cyclone'),
  apocalypse_rise:  anim('summon',   'skull'),
  death_realm:      anim('dark',     'new-moon'),
  soul_storm:       anim('dark',     'ghost'),
  lich_transformation: anim('dark',  'crown'),
  death_apocalypse: anim('dark',     'skull-and-crossbones'),

  battle_hymn:      anim('music',    'musical-note'),
  lullaby:          anim('music',    'musical-notes'),
  ballad_of_heroes: anim('music',    'musical-score'),
  dissonance:       anim('music',    'speaker-high-volume'),
  war_song:         anim('music',    'musical-note'),
  heroic_ballad:    anim('music',    'musical-notes'),
  requiem:          anim('music',    'violin'),
  sirens_call:      anim('music',    'merperson'),
  epic_saga:        anim('music',    'scroll'),
  legends_anthem:   anim('music',    'trophy'),
  divine_melody:    anim('music',    'sparkles'),
  song_of_doom:     anim('music',    'skull'),
  cosmic_hymn:      anim('music',    'milky-way'),
  god_ballad:       anim('music',    'crown'),
  universe_song:    anim('music',    'shooting-star'),

  cios:             anim('physical',  'crossed-swords'),
  pozoga:           anim('fire',      'fire'),
  mroz:             anim('ice',       'snowflake'),
  burza:            anim('lightning', 'high-voltage'),
  klatwa:           anim('dark',      'eye'),
  krwawienie:       anim('poison',    'drop-of-blood'),
  eksplozja:        anim('fire',      'collision'),
  swietlistosc:     anim('holy',      'sparkles'),
  mrocznaAura:      anim('dark',      'milky-way'),
  apokalipsa:       anim('arcane',    'skull-and-crossbones'),
  apokalipsaCienia: anim('dark',      'skull'),
};

export const getSkillAnimation = (skillId: string): ISkillAnimation | undefined => {
  return SKILL_ANIMATIONS[skillId];
};
