
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
    kind: TGuildBossSpellKind;
    dmgPctOfPlayerMaxHp: number;
    color: string;
    icon: string;
}

const SPELLS: Record<string, IGuildBossSpell> = {
    cios:           { id: 'cios',           name: 'Cios',              kind: 'physical',   dmgPctOfPlayerMaxHp: 0.030, color: '#bdbdbd', icon: 'crossed-swords' },
    pozoga:         { id: 'pozoga',         name: 'Pożoga',            kind: 'fire',       dmgPctOfPlayerMaxHp: 0.045, color: '#ff5722', icon: 'fire' },
    mroz:           { id: 'mroz',           name: 'Lodowa Lanca',      kind: 'ice',        dmgPctOfPlayerMaxHp: 0.050, color: '#29b6f6', icon: 'snowflake' },
    burza:          { id: 'burza',          name: 'Burza Pioruna',     kind: 'lightning',  dmgPctOfPlayerMaxHp: 0.060, color: '#ffeb3b', icon: 'high-voltage' },
    klatwa:         { id: 'klatwa',         name: 'Klątwa Cienia',     kind: 'dark',       dmgPctOfPlayerMaxHp: 0.055, color: '#9c27b0', icon: 'eye' },
    krwawienie:     { id: 'krwawienie',     name: 'Krwawienie',        kind: 'poison',     dmgPctOfPlayerMaxHp: 0.045, color: '#4caf50', icon: 'drop-of-blood' },
    eksplozja:      { id: 'eksplozja',      name: 'Eksplozja Ognia',   kind: 'fire',       dmgPctOfPlayerMaxHp: 0.075, color: '#f4511e', icon: 'collision' },
    swietlistosc:   { id: 'swietlistosc',   name: 'Świetlistość',      kind: 'holy',       dmgPctOfPlayerMaxHp: 0.080, color: '#fff176', icon: 'sparkles' },
    mrocznaAura:    { id: 'mrocznaAura',    name: 'Mroczna Aura',      kind: 'dark',       dmgPctOfPlayerMaxHp: 0.090, color: '#673ab7', icon: 'milky-way' },
    apokalipsa:     { id: 'apokalipsa',     name: 'Apokalipsa',        kind: 'apocalypse', dmgPctOfPlayerMaxHp: 0.130, color: '#e91e63', icon: 'skull-and-crossbones' },
    apokalipsaCienia: { id: 'apokalipsaCienia', name: 'Apokalipsa Cienia', kind: 'apocalypse', dmgPctOfPlayerMaxHp: 0.160, color: '#d500f9', icon: 'skull' },
};

interface ITierKit {
    pool: string[];
    castIntervalMs: number;
    damageMult: number;
    label: string;
}

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

export const getGuildBossKit = (tier: number): ITierKit => {
    return TIER_KITS[safeTier(tier)];
};

export const pickGuildBossSpell = (tier: number): IGuildBossSpell => {
    const kit = getGuildBossKit(tier);
    const id = kit.pool[Math.floor(Math.random() * kit.pool.length)];
    return SPELLS[id] ?? SPELLS.cios;
};

export const computeBossSpellDamage = (
    spell: IGuildBossSpell,
    tier: number,
    playerMaxHp: number,
): number => {
    const kit = getGuildBossKit(tier);
    const raw = playerMaxHp * spell.dmgPctOfPlayerMaxHp * kit.damageMult;
    return Math.max(1, Math.floor(raw));
};

export const getBossCastIntervalMs = (tier: number, speedMult: number): number => {
    const kit = getGuildBossKit(tier);
    return Math.max(250, Math.floor(kit.castIntervalMs / Math.max(1, speedMult)));
};

export const getGuildBossLabel = (tier: number): string => {
    return getGuildBossKit(tier).label;
};
