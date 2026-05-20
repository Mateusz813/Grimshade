/**
 * Per-tier boss spell kits + visual themes for the guild loch.
 *
 * Every tier of the dungeon boss casts a different mix of spells —
 * lower tiers focus on basic strikes, higher tiers layer on AOE,
 * curses and apocalyptic finishers. The fight UI reads each spell's
 * `kind` to pick the matching CSS animation (fire glow, lightning
 * arc, dark shroud, etc.) and shows a damage float using the spell's
 * `color` so the player can read at a glance what hit them.
 *
 * Difficulty scales TWO axes:
 *   • `castIntervalMs` falls with tier — boss casts more often.
 *   • `damageMult` multiplies the base hit so every cast at tier 10
 *     drops a meaningful chunk of the player's max HP.
 *
 * Damage formula (in GuildBoss combat loop):
 *   dmg = floor(playerMaxHp × spell.dmgPctOfPlayerMaxHp × tierMult)
 * where `tierMult` ramps from 0.6× at tier 1 to ~2.4× at tier 10.
 * Net effect: a tier-1 basic chip is ~3 % player HP, a tier-10
 * apocalypse ~30 %.
 */

export type TGuildBossSpellKind =
    | 'fire'
    | 'ice'
    | 'lightning'
    | 'dark'
    | 'holy'
    | 'poison'
    | 'physical'
    | 'apocalypse';

export interface IGuildBossSpell {
    id: string;
    name: string;
    /** Visual theme — drives the CSS animation + tint colour. */
    kind: TGuildBossSpellKind;
    /** Base damage as a fraction of the player's max HP. */
    dmgPctOfPlayerMaxHp: number;
    /** Hex colour used by the damage float + cast overlay. */
    color: string;
    /** Emoji glyph rendered alongside the float — quick at-a-glance
     *  for what just hit. */
    icon: string;
}

const SPELLS: Record<string, IGuildBossSpell> = {
    cios:           { id: 'cios',           name: 'Cios',              kind: 'physical',   dmgPctOfPlayerMaxHp: 0.030, color: '#bdbdbd', icon: '⚔️' },
    pozoga:         { id: 'pozoga',         name: 'Pożoga',            kind: 'fire',       dmgPctOfPlayerMaxHp: 0.045, color: '#ff5722', icon: '🔥' },
    mroz:           { id: 'mroz',           name: 'Lodowa Lanca',      kind: 'ice',        dmgPctOfPlayerMaxHp: 0.050, color: '#29b6f6', icon: '❄️' },
    burza:          { id: 'burza',          name: 'Burza Pioruna',     kind: 'lightning',  dmgPctOfPlayerMaxHp: 0.060, color: '#ffeb3b', icon: '⚡' },
    klatwa:         { id: 'klatwa',         name: 'Klątwa Cienia',     kind: 'dark',       dmgPctOfPlayerMaxHp: 0.055, color: '#9c27b0', icon: '👁️' },
    krwawienie:     { id: 'krwawienie',     name: 'Krwawienie',        kind: 'poison',     dmgPctOfPlayerMaxHp: 0.045, color: '#4caf50', icon: '🩸' },
    eksplozja:      { id: 'eksplozja',      name: 'Eksplozja Ognia',   kind: 'fire',       dmgPctOfPlayerMaxHp: 0.075, color: '#f4511e', icon: '💥' },
    swietlistosc:   { id: 'swietlistosc',   name: 'Świetlistość',      kind: 'holy',       dmgPctOfPlayerMaxHp: 0.080, color: '#fff176', icon: '✨' },
    mrocznaAura:    { id: 'mrocznaAura',    name: 'Mroczna Aura',      kind: 'dark',       dmgPctOfPlayerMaxHp: 0.090, color: '#673ab7', icon: '🌌' },
    apokalipsa:     { id: 'apokalipsa',     name: 'Apokalipsa',        kind: 'apocalypse', dmgPctOfPlayerMaxHp: 0.130, color: '#e91e63', icon: '☠️' },
    apokalipsaCienia: { id: 'apokalipsaCienia', name: 'Apokalipsa Cienia', kind: 'apocalypse', dmgPctOfPlayerMaxHp: 0.160, color: '#d500f9', icon: '💀' },
};

interface ITierKit {
    /** Spell ids this boss draws from each cast. */
    pool: string[];
    /** Milliseconds between casts at speedMult=1. Scales down per tier
     *  → higher tiers cast more often. */
    castIntervalMs: number;
    /** Damage multiplier applied on top of `spell.dmgPctOfPlayerMaxHp`. */
    damageMult: number;
    /** Banner label for the boss-info panel. */
    label: string;
}

// 2026-05-18 v10 spec ("Bossy sa troche za slabe"): every tier
// damageMult bumped ~1.5× so spell hits feel threatening and the
// boss can actually kill an unprepared solo player before they
// chip the 10% block-gate. Cast intervals tightened ~12% so spells
// land more often, especially at higher tiers.
//
// 2026-05-18 v13: roster extended 10 → 20 tiers ("Dodalem kolejne
// bossy do lochu gildii do numer 20"). Tiers 11–20 continue the
// curve — cast cadence shaves ~75ms / tier and damageMult climbs
// ~0.45 / tier, so a tier-20 boss casts every ~1.05s with a 9.10×
// kit multiplier (≈ 3× the tier-10 baseline). Pools are biased
// toward apocalypse-class spells so the visual identity feels
// genuinely terminal.
const TIER_KITS: Record<number, ITierKit> = {
    1:  { pool: ['cios', 'pozoga'],                                                                      castIntervalMs: 3700, damageMult: 0.95, label: 'Strażnik Lochu' },
    2:  { pool: ['cios', 'pozoga', 'mroz'],                                                              castIntervalMs: 3400, damageMult: 1.15, label: 'Cienisty Lord' },
    3:  { pool: ['pozoga', 'mroz', 'burza'],                                                             castIntervalMs: 3100, damageMult: 1.35, label: 'Burzowy Władca' },
    4:  { pool: ['mroz', 'burza', 'klatwa'],                                                             castIntervalMs: 2800, damageMult: 1.55, label: 'Mroczny Pan' },
    5:  { pool: ['burza', 'klatwa', 'krwawienie', 'eksplozja'],                                          castIntervalMs: 2600, damageMult: 1.80, label: 'Krwawy Tyran' },
    6:  { pool: ['klatwa', 'eksplozja', 'krwawienie', 'mrocznaAura'],                                    castIntervalMs: 2400, damageMult: 2.05, label: 'Antyczna Bestia' },
    7:  { pool: ['eksplozja', 'mrocznaAura', 'swietlistosc', 'klatwa'],                                  castIntervalMs: 2200, damageMult: 2.30, label: 'Strażnik Świtu' },
    8:  { pool: ['mrocznaAura', 'swietlistosc', 'eksplozja', 'apokalipsa'],                              castIntervalMs: 2000, damageMult: 2.55, label: 'Pradawny Demon' },
    9:  { pool: ['swietlistosc', 'apokalipsa', 'mrocznaAura', 'klatwa', 'eksplozja'],                    castIntervalMs: 1900, damageMult: 2.85, label: 'Cesarz Otchłani' },
    10: { pool: ['apokalipsa', 'apokalipsaCienia', 'swietlistosc', 'mrocznaAura', 'eksplozja', 'burza'], castIntervalMs: 1700, damageMult: 3.40, label: 'Ostateczny Strażnik' },
    11: { pool: ['apokalipsa', 'apokalipsaCienia', 'mrocznaAura', 'klatwa', 'eksplozja'],                castIntervalMs: 1600, damageMult: 3.85, label: 'Władca Bezdni' },
    12: { pool: ['apokalipsa', 'apokalipsaCienia', 'swietlistosc', 'mrocznaAura', 'burza'],              castIntervalMs: 1500, damageMult: 4.30, label: 'Pan Pustki' },
    13: { pool: ['apokalipsaCienia', 'apokalipsa', 'eksplozja', 'mrocznaAura', 'swietlistosc'],          castIntervalMs: 1400, damageMult: 4.80, label: 'Tyran Czasu' },
    14: { pool: ['apokalipsaCienia', 'apokalipsa', 'mrocznaAura', 'swietlistosc', 'burza', 'eksplozja'], castIntervalMs: 1350, damageMult: 5.30, label: 'Niszczyciel Światów' },
    15: { pool: ['apokalipsaCienia', 'apokalipsa', 'mrocznaAura', 'klatwa', 'swietlistosc'],             castIntervalMs: 1300, damageMult: 5.85, label: 'Pierwotny Bóg' },
    16: { pool: ['apokalipsaCienia', 'apokalipsa', 'mrocznaAura', 'eksplozja', 'burza'],                 castIntervalMs: 1250, damageMult: 6.40, label: 'Zwiastun Końca' },
    17: { pool: ['apokalipsaCienia', 'apokalipsa', 'swietlistosc', 'mrocznaAura', 'klatwa'],             castIntervalMs: 1200, damageMult: 7.00, label: 'Ostatnia Pieczęć' },
    18: { pool: ['apokalipsaCienia', 'apokalipsa', 'mrocznaAura', 'eksplozja', 'krwawienie'],            castIntervalMs: 1150, damageMult: 7.65, label: 'Architekt Zagłady' },
    19: { pool: ['apokalipsaCienia', 'apokalipsa', 'mrocznaAura', 'klatwa', 'swietlistosc', 'burza'],    castIntervalMs: 1100, damageMult: 8.35, label: 'Sędzia Wszechrzeczy' },
    20: { pool: ['apokalipsaCienia', 'apokalipsa', 'mrocznaAura', 'swietlistosc', 'eksplozja', 'burza'], castIntervalMs: 1050, damageMult: 9.10, label: 'Praboga Otchłani' },
    // 2026-05-19 v21: tiers 21-50. Apocalypse-class spell pools at
    // every level (the kit's spell pool is irrelevant past tier 20
    // since every entry is already maximum-rarity).  castIntervalMs
    // floors at 700ms so basic-attack cadence stays readable, and
    // damageMult climbs ~0.5 per tier so tier 50 hits ~24× the
    // base spell damage — strong enough to demand top-end gear /
    // transforms even for veteran guilds.
    21: { pool: ['apokalipsaCienia', 'apokalipsa', 'mrocznaAura', 'swietlistosc', 'eksplozja'], castIntervalMs: 1020, damageMult:  9.60, label: 'Konglomerat Otchłani' },
    22: { pool: ['apokalipsaCienia', 'apokalipsa', 'mrocznaAura', 'klatwa', 'burza'],            castIntervalMs:  990, damageMult: 10.10, label: 'Czarny Lewiatan' },
    23: { pool: ['apokalipsaCienia', 'apokalipsa', 'eksplozja', 'mrocznaAura'],                  castIntervalMs:  960, damageMult: 10.60, label: 'Pożeracz Czasu' },
    24: { pool: ['apokalipsaCienia', 'apokalipsa', 'swietlistosc', 'klatwa', 'burza'],           castIntervalMs:  930, damageMult: 11.10, label: 'Wielki Wąż' },
    25: { pool: ['apokalipsaCienia', 'apokalipsa', 'mrocznaAura', 'eksplozja', 'krwawienie'],    castIntervalMs:  900, damageMult: 11.60, label: 'Kowal Końca' },
    26: { pool: ['apokalipsaCienia', 'apokalipsa', 'mrocznaAura', 'swietlistosc'],               castIntervalMs:  880, damageMult: 12.10, label: 'Pan Eonów' },
    27: { pool: ['apokalipsaCienia', 'apokalipsa', 'klatwa', 'burza', 'eksplozja'],              castIntervalMs:  860, damageMult: 12.60, label: 'Pierwotna Cisza' },
    28: { pool: ['apokalipsaCienia', 'apokalipsa', 'mrocznaAura', 'swietlistosc', 'eksplozja'],  castIntervalMs:  840, damageMult: 13.10, label: 'Pierwsze Echo' },
    29: { pool: ['apokalipsaCienia', 'apokalipsa', 'krwawienie', 'klatwa', 'burza'],             castIntervalMs:  820, damageMult: 13.60, label: 'Krwawy Lord' },
    30: { pool: ['apokalipsaCienia', 'apokalipsa', 'mrocznaAura', 'swietlistosc', 'burza'],      castIntervalMs:  800, damageMult: 14.10, label: 'Eternalny Tyran' },
    31: { pool: ['apokalipsaCienia', 'apokalipsa', 'eksplozja', 'mrocznaAura', 'klatwa'],        castIntervalMs:  790, damageMult: 14.60, label: 'Pradawny Bóg' },
    32: { pool: ['apokalipsaCienia', 'apokalipsa', 'mrocznaAura', 'swietlistosc', 'burza'],      castIntervalMs:  780, damageMult: 15.10, label: 'Bogobój' },
    33: { pool: ['apokalipsaCienia', 'apokalipsa', 'eksplozja', 'krwawienie', 'klatwa'],         castIntervalMs:  770, damageMult: 15.60, label: 'Władca Smoków' },
    34: { pool: ['apokalipsaCienia', 'apokalipsa', 'mrocznaAura', 'swietlistosc'],               castIntervalMs:  760, damageMult: 16.10, label: 'Tron Otchłani' },
    35: { pool: ['apokalipsaCienia', 'apokalipsa', 'mrocznaAura', 'eksplozja', 'burza'],         castIntervalMs:  750, damageMult: 16.60, label: 'Bestia z Otchłani' },
    36: { pool: ['apokalipsaCienia', 'apokalipsa', 'klatwa', 'krwawienie', 'mrocznaAura'],       castIntervalMs:  745, damageMult: 17.10, label: 'Strażnik Eonu' },
    37: { pool: ['apokalipsaCienia', 'apokalipsa', 'swietlistosc', 'mrocznaAura', 'burza'],      castIntervalMs:  740, damageMult: 17.60, label: 'Niszczyciel Sfer' },
    38: { pool: ['apokalipsaCienia', 'apokalipsa', 'mrocznaAura', 'eksplozja', 'klatwa'],        castIntervalMs:  735, damageMult: 18.10, label: 'Imperator Ciemności' },
    39: { pool: ['apokalipsaCienia', 'apokalipsa', 'krwawienie', 'mrocznaAura', 'klatwa'],       castIntervalMs:  730, damageMult: 18.60, label: 'Cień Zagłady' },
    40: { pool: ['apokalipsaCienia', 'apokalipsa', 'mrocznaAura', 'swietlistosc', 'eksplozja'],  castIntervalMs:  725, damageMult: 19.10, label: 'Wielki Niszczyciel' },
    41: { pool: ['apokalipsaCienia', 'apokalipsa', 'mrocznaAura', 'klatwa', 'burza'],            castIntervalMs:  720, damageMult: 19.60, label: 'Ojciec Cieni' },
    42: { pool: ['apokalipsaCienia', 'apokalipsa', 'eksplozja', 'swietlistosc', 'mrocznaAura'],  castIntervalMs:  715, damageMult: 20.10, label: 'Matka Bestii' },
    43: { pool: ['apokalipsaCienia', 'apokalipsa', 'mrocznaAura', 'krwawienie', 'klatwa'],       castIntervalMs:  712, damageMult: 20.60, label: 'Smoczy Cesarz' },
    44: { pool: ['apokalipsaCienia', 'apokalipsa', 'mrocznaAura', 'eksplozja', 'burza'],         castIntervalMs:  709, damageMult: 21.10, label: 'Strażnik Bram' },
    45: { pool: ['apokalipsaCienia', 'apokalipsa', 'swietlistosc', 'mrocznaAura', 'klatwa'],     castIntervalMs:  706, damageMult: 21.60, label: 'Wielki Praboga' },
    46: { pool: ['apokalipsaCienia', 'apokalipsa', 'mrocznaAura', 'eksplozja', 'krwawienie'],    castIntervalMs:  704, damageMult: 22.10, label: 'Mściciel Pierwotnych' },
    47: { pool: ['apokalipsaCienia', 'apokalipsa', 'klatwa', 'swietlistosc', 'mrocznaAura'],     castIntervalMs:  702, damageMult: 22.60, label: 'Bóg-Pożeracz' },
    48: { pool: ['apokalipsaCienia', 'apokalipsa', 'mrocznaAura', 'burza', 'eksplozja'],         castIntervalMs:  701, damageMult: 23.10, label: 'Pan Wszechrzeczy' },
    49: { pool: ['apokalipsaCienia', 'apokalipsa', 'swietlistosc', 'klatwa', 'krwawienie'],      castIntervalMs:  700, damageMult: 23.60, label: 'Stwórca Otchłani' },
    50: { pool: ['apokalipsaCienia', 'apokalipsa', 'mrocznaAura', 'swietlistosc', 'eksplozja', 'burza', 'klatwa'], castIntervalMs: 700, damageMult: 24.10, label: 'Praboga Wszechświata' },
};

const safeTier = (tier: number): number => {
    if (!Number.isFinite(tier) || tier < 1) return 1;
    return Math.min(50, Math.max(1, Math.floor(tier)));
};

/** Return the tier kit (clamped to 1..50). */
export const getGuildBossKit = (tier: number): ITierKit => {
    return TIER_KITS[safeTier(tier)];
};

/** Pick one random spell from the tier's pool. */
export const pickGuildBossSpell = (tier: number): IGuildBossSpell => {
    const kit = getGuildBossKit(tier);
    const id = kit.pool[Math.floor(Math.random() * kit.pool.length)];
    return SPELLS[id] ?? SPELLS.cios;
};

/** Damage dealt to the player when the boss casts `spell` at `tier`
 *  against a character whose live max HP is `playerMaxHp`. */
export const computeBossSpellDamage = (
    spell: IGuildBossSpell,
    tier: number,
    playerMaxHp: number,
): number => {
    const kit = getGuildBossKit(tier);
    const raw = playerMaxHp * spell.dmgPctOfPlayerMaxHp * kit.damageMult;
    return Math.max(1, Math.floor(raw));
};

/** Tier-1 → ~3 700 ms, tier-10 → ~1 700 ms, tier-20 → ~1 050 ms,
 *  tier-50 → ~700 ms (floor). Scales by combat-speed multiplier
 *  (X1/X2/X4) on top. */
export const getBossCastIntervalMs = (tier: number, speedMult: number): number => {
    const kit = getGuildBossKit(tier);
    return Math.max(250, Math.floor(kit.castIntervalMs / Math.max(1, speedMult)));
};

/** Display label for the boss (e.g. "Strażnik Lochu") shown next to
 *  the dungeon-tier in the header. */
export const getGuildBossLabel = (tier: number): string => {
    return getGuildBossKit(tier).label;
};
