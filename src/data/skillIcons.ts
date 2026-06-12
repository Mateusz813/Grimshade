/**
 * Emoji icons for every active skill and weapon skill.
 * Import this map wherever you need to display skill icons.
 */
export const SKILL_ICONS: Record<string, string> = {
  // -- Weapon / utility skills ------------------------------------------------
  sword_fighting: 'crossed-swords',
  distance_fighting: 'bow-and-arrow',
  dagger_fighting: 'dagger',
  magic_level: 'crystal-ball',
  bard_level: 'musical-note',
  shielding: 'shield',

  // -- Knight -----------------------------------------------------------------
  shield_bash: ':crossed-swords::shield:',
  battle_cry: ':loudspeaker::red-circle:',
  whirlwind: ':cyclone::crossed-swords:',
  fortify: ':shield::blue-circle:',
  berserker_rage: ':face-with-steam-from-nose::fire:',
  iron_defense: ':shield::gem-stone:',
  charge: ':high-voltage::person-running:',
  execute: ':skull::crossed-swords:',
  war_cry: ':loudspeaker::crossed-swords:',
  ultimate_slash: ':crossed-swords::collision:',
  sword_mastery: ':crossed-swords::sparkles:',
  titan_cleave: ':rock::crossed-swords:',
  divine_strike: ':sparkles::crossed-swords:',
  god_slash: ':crown::crossed-swords:',
  absolute_cleave: ':collision::glowing-star:',

  // -- Mage -------------------------------------------------------------------
  fireball: 'fire',
  ice_lance: 'snowflake',
  thunder_strike: 'high-voltage',
  mana_shield: ':shield::blue-heart:',
  arcane_bolt: ':sparkles::purple-heart:',
  blizzard: ':snowflake::cyclone:',
  meteor: 'comet',
  time_warp: 'hourglass-not-done',
  arcane_explosion: ':collision::purple-heart:',
  apocalypse_spell: 'volcano',
  void_ray: ':new-moon::sparkles:',
  reality_rend: ':cyclone::collision:',
  singularity: 'hole',
  god_nova: ':crown::purple-heart:',
  big_bang: ':collision::milky-way:',

  // -- Cleric -----------------------------------------------------------------
  holy_strike: ':high-voltage::latin-cross:',
  heal: 'green-heart',
  divine_shield: ':shield::sparkles:',
  smite: ':high-voltage::latin-cross:',
  blessing: ':folded-hands::sparkles:',
  resurrection_aura: ':yellow-heart::counterclockwise-arrows-button:',
  holy_nova: ':green-heart::glowing-star:',
  consecration: ':latin-cross::fire:',
  divine_intervention: ':folded-hands::yellow-heart:',
  holy_judgment: ':balance-scale::sparkles:',
  divine_wrath: ':high-voltage::yellow-heart:',
  celestial_heal: ':green-heart::sparkles:',
  apocalypse_prayer: ':folded-hands::fire:',
  divine_pillar: ':latin-cross::gem-stone:',
  holy_apocalypse: ':latin-cross::glowing-star:',

  // -- Archer -----------------------------------------------------------------
  precise_shot: ':bow-and-arrow::bullseye:',
  poison_arrow: ':bow-and-arrow::skull-and-crossbones:',
  eagle_eye: ':eye::bullseye:',
  rain_of_arrows: ':bow-and-arrow::cloud-with-rain:',
  trap: 'mouse-trap',
  multishot: ':bow-and-arrow::bow-and-arrow:',
  wind_arrow: ':bow-and-arrow::dashing-away:',
  sniper_shot: ':bullseye::skull:',
  shadow_step: ':footprints::dashing-away:',
  death_arrow: ':bow-and-arrow::skull:',
  celestial_arrow: ':bow-and-arrow::sparkles:',
  void_shot: ':bow-and-arrow::new-moon:',
  god_arrow: ':bow-and-arrow::crown:',
  destiny_shot: ':bow-and-arrow::crystal-ball:',
  universe_arrow: ':bow-and-arrow::milky-way:',

  // -- Rogue ------------------------------------------------------------------
  backstab: ':dagger::dashing-away:',
  poison_blade: ':dagger::skull-and-crossbones:',
  evasion: ':dashing-away::bust-in-silhouette:',
  dual_strike: ':dagger::dagger:',
  smoke_bomb: ':dashing-away::bomb:',
  assassinate: ':skull::dagger:',
  hemorrhage: 'drop-of-blood',
  shadow_clone: 'busts-in-silhouette',
  marked_for_death: ':bullseye::skull:',
  instant_kill: ':high-voltage::skull:',
  shadow_death: ':bust-in-silhouette::skull:',
  void_strike: ':dagger::new-moon:',
  death_touch: ':skull-and-crossbones::raised-hand:',
  god_assassin: ':crown::dagger:',
  absolute_death: ':skull::glowing-star:',

  // -- Necromancer ------------------------------------------------------------
  life_drain: 'heart-on-fire',
  summon_skeleton: ':skull::bone:',
  death_curse: ':skull-and-crossbones::purple-heart:',
  bone_spear: ':bone::high-voltage:',
  plague: 'microbe',
  raise_dead: ':skull::up-arrow:',
  soul_harvest: 'ghost',
  dark_ritual: ':open-book::skull:',
  army_of_darkness: ':skull::skull:',
  death_coil: ':skull-and-crossbones::collision:',
  apocalypse_rise: ':skull::volcano:',
  death_realm: ':skull-and-crossbones::new-moon:',
  soul_storm: ':ghost::cyclone:',
  lich_transformation: ':skull::crown:',
  death_apocalypse: ':skull-and-crossbones::glowing-star:',

  // -- Bard -------------------------------------------------------------------
  battle_hymn: ':musical-note::crossed-swords:',
  lullaby: ':musical-note::zzz:',
  ballad_of_heroes: ':musical-note::superhero:',
  dissonance: ':musical-note::purple-heart:',
  war_song: ':musical-note::fire:',
  heroic_ballad: ':musical-note::shield:',
  requiem: ':musical-note::skull:',
  sirens_call: ':musical-note::merperson:',
  epic_saga: ':musical-note::open-book:',
  legends_anthem: ':musical-note::crown:',
  divine_melody: ':musical-note::sparkles:',
  song_of_doom: ':musical-note::skull-and-crossbones:',
  cosmic_hymn: ':musical-note::milky-way:',
  god_ballad: ':musical-note::gem-stone:',
  universe_song: ':musical-note::glowing-star:',
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
  return SKILL_ICONS[skillId] ?? 'sparkles';
};
