
import type { EquipmentSlot } from './itemSystem';


type GlobModule = { default: string } | string;

const buildLevelMap = (
    files: Record<string, GlobModule>,
    prefix: string,
): Map<number, string> => {
    const out = new Map<number, string>();
    for (const [path, mod] of Object.entries(files)) {
        const match = path.match(new RegExp(`/${prefix}-(\\d+)\\.[a-zA-Z]+$`));
        if (!match) continue;
        const level = Number(match[1]);
        if (!Number.isFinite(level)) continue;
        const url = typeof mod === 'string' ? mod : (mod as { default: string }).default;
        if (url) out.set(level, url);
    }
    return out;
};

const buildNameMap = (files: Record<string, GlobModule>): Map<string, string> => {
    const out = new Map<string, string>();
    for (const [path, mod] of Object.entries(files)) {
        const m = path.match(/\/([^/]+)\.[a-zA-Z]+$/);
        if (!m) continue;
        const url = typeof mod === 'string' ? mod : (mod as { default: string }).default;
        if (url) out.set(m[1], url);
    }
    return out;
};

const MONSTER_FILES = import.meta.glob('../assets/images/monsters/monster-*.png', {
    eager: true,
}) as Record<string, GlobModule>;
const MONSTER_BY_LEVEL = buildLevelMap(MONSTER_FILES, 'monster');

export const getMonsterImage = (level: number): string | null =>
    MONSTER_BY_LEVEL.get(level) ?? null;

export const getMonsterImageNearest = (level: number): string | null => {
    const exact = MONSTER_BY_LEVEL.get(level);
    if (exact) return exact;
    const available = Array.from(MONSTER_BY_LEVEL.keys()).sort((a, b) => a - b);
    if (available.length === 0) return null;
    for (const l of available) {
        if (l >= level) return MONSTER_BY_LEVEL.get(l) ?? null;
    }
    return MONSTER_BY_LEVEL.get(available[available.length - 1]) ?? null;
};

const BOSS_FILES = import.meta.glob('../assets/images/boss/boss-*.png', {
    eager: true,
}) as Record<string, GlobModule>;
const BOSS_BY_LEVEL = buildLevelMap(BOSS_FILES, 'boss');

export const getBossImage = (level: number): string | null =>
    BOSS_BY_LEVEL.get(level) ?? null;

export const getBossImageNearest = (level: number): string | null => {
    const exact = BOSS_BY_LEVEL.get(level);
    if (exact) return exact;
    const available = Array.from(BOSS_BY_LEVEL.keys()).sort((a, b) => a - b);
    if (available.length === 0) return null;
    for (const l of available) {
        if (l >= level) return BOSS_BY_LEVEL.get(l) ?? null;
    }
    return BOSS_BY_LEVEL.get(available[available.length - 1]) ?? null;
};

import dungeonsRaw from '../data/dungeons.json';

const DUNGEON_FILES = import.meta.glob('../assets/images/dungeons/dung-*.png', {
    eager: true,
}) as Record<string, GlobModule>;

const DUNGEON_IMG_BY_INDEX: Map<number, string> = (() => {
    const out = new Map<number, string>();
    for (const [path, mod] of Object.entries(DUNGEON_FILES)) {
        const match = path.match(/\/dung-(\d+)\.png$/);
        if (!match) continue;
        const idx = Number(match[1]);
        if (!Number.isFinite(idx) || idx <= 0) continue;
        const url = typeof mod === 'string' ? mod : (mod as { default: string }).default;
        if (url) out.set(idx, url);
    }
    return out;
})();

const DUNGEON_IMG_BY_ID: Record<string, string> = (() => {
    const out: Record<string, string> = {};
    (dungeonsRaw as { id: string }[]).forEach((d, idx) => {
        const url = DUNGEON_IMG_BY_INDEX.get(idx + 1);
        if (url) out[d.id] = url;
    });
    return out;
})();

export const getDungeonImage = (dungeonId: string): string | null =>
    DUNGEON_IMG_BY_ID[dungeonId] ?? null;

const SPELL_FILES = import.meta.glob('../assets/images/spells/*.png', {
    eager: true,
}) as Record<string, GlobModule>;

const SPELL_IMG_BY_KEY: Record<string, string> = (() => {
    const out: Record<string, string> = {};
    for (const [path, mod] of Object.entries(SPELL_FILES)) {
        const match = path.match(/\/([a-z_]+)-(\d+)\.png$/i);
        if (!match) continue;
        const key = `${match[1].toLowerCase()}-${match[2]}`;
        const url = typeof mod === 'string' ? mod : (mod as { default?: string }).default;
        if (url) out[key] = url;
    }
    return out;
})();

const CLASS_FILE_ALIAS: Record<string, string> = {
    necromancer: 'necro',
};
export const getSpellImage = (classId: string, index: number): string | null => {
    const lc = classId.toLowerCase();
    const alias = CLASS_FILE_ALIAS[lc] ?? lc;
    return SPELL_IMG_BY_KEY[`${alias}-${index}`] ?? SPELL_IMG_BY_KEY[`${lc}-${index}`] ?? null;
};

const SUMMON_FILES = import.meta.glob('../assets/images/summons/*.png', {
    eager: true,
}) as Record<string, GlobModule>;

const SUMMON_IMG_BY_KEY: Record<string, string> = (() => {
    const out: Record<string, string> = {};
    for (const [path, mod] of Object.entries(SUMMON_FILES)) {
        const m = path.match(/summon(?:-([a-z]+))?\.png$/i);
        if (!m) continue;
        const key = (m[1] ?? 'default').toLowerCase();
        const url = typeof mod === 'string' ? mod : (mod as { default?: string }).default;
        if (url) out[key] = url;
    }
    return out;
})();

const SUMMON_TYPE_ALIAS: Record<string, string> = {
    skeleton: 'szkielet',
    ghost: 'duch',
    demon: 'demon',
    lich: 'lisz',
};

export const getSummonImage = (type: string): string | null => {
    const key = SUMMON_TYPE_ALIAS[type.toLowerCase()] ?? type.toLowerCase();
    return SUMMON_IMG_BY_KEY[key] ?? SUMMON_IMG_BY_KEY['default'] ?? null;
};

const BOSS_CARD_FILES = import.meta.glob('../assets/images/boss/boss*.png', {
    eager: true,
}) as Record<string, GlobModule>;

const BOSS_CARD_IMG_BY_INDEX: Map<number, string> = (() => {
    const out = new Map<number, string>();
    for (const [path, mod] of Object.entries(BOSS_CARD_FILES)) {
        const match = path.match(/\/boss(\d+)\.png$/);
        if (!match) continue;
        const idx = Number(match[1]);
        if (!Number.isFinite(idx) || idx <= 0) continue;
        const url = typeof mod === 'string' ? mod : (mod as { default: string }).default;
        if (url) out.set(idx, url);
    }
    return out;
})();

export const getBossCardImage = (index: number): string | null =>
    BOSS_CARD_IMG_BY_INDEX.get(index + 1) ?? null;

const ITEM_FILES = import.meta.glob('../assets/images/items/*.png', {
    eager: true,
}) as Record<string, GlobModule>;
const ITEM_BY_NAME = buildNameMap(ITEM_FILES);

const itemFile = (name: string): string | null => ITEM_BY_NAME.get(name) ?? null;

export const getItemFile = itemFile;

const SPELL_CHEST_FILES = import.meta.glob('../assets/images/spell-chest/spell-chest-*.png', {
    eager: true,
}) as Record<string, GlobModule>;
const SPELL_CHEST_BY_LEVEL = (() => {
    const map = new Map<number, string>();
    for (const [path, mod] of Object.entries(SPELL_CHEST_FILES)) {
        const m = path.match(/spell-chest-(\d+)\.png$/);
        if (!m) continue;
        const lvl = parseInt(m[1], 10);
        if (!Number.isFinite(lvl)) continue;
        const url = typeof mod === 'string' ? mod : mod.default;
        if (url) map.set(lvl, url);
    }
    return map;
})();

const CHEST_LEVEL_TO_TIER: Record<number, number> = {
    5: 1, 10: 2, 20: 3, 30: 4, 40: 5, 50: 6, 60: 7, 70: 8,
    80: 9, 100: 10, 150: 11, 300: 12, 600: 13, 800: 14, 1000: 15,
};

export const getSpellChestImage = (level: number): string | null => {
    const tier = CHEST_LEVEL_TO_TIER[level];
    if (tier && SPELL_CHEST_BY_LEVEL.has(tier)) {
        return SPELL_CHEST_BY_LEVEL.get(tier)!;
    }
    return SPELL_CHEST_BY_LEVEL.get(15) ?? null;
};

const STONE_FILES = import.meta.glob('../assets/images/upgrade-stone/stone-*.png', {
    eager: true,
}) as Record<string, GlobModule>;
const STONE_BY_TIER = (() => {
    const map = new Map<number, string>();
    for (const [path, mod] of Object.entries(STONE_FILES)) {
        const m = path.match(/stone-(\d+)\.png$/);
        if (!m) continue;
        const tier = parseInt(m[1], 10);
        if (!Number.isFinite(tier)) continue;
        const url = typeof mod === 'string' ? mod : mod.default;
        if (url) map.set(tier, url);
    }
    return map;
})();

const STONE_RARITY_TO_TIER: Record<string, number> = {
    common: 1,
    rare: 2,
    epic: 3,
    legendary: 4,
    mythic: 5,
    heroic: 6,
};
const STONE_ID_TO_TIER: Record<string, number> = {
    common_stone: 1,
    rare_stone: 2,
    epic_stone: 3,
    legendary_stone: 4,
    mythic_stone: 5,
    heroic_stone: 6,
};

export const getStoneImage = (key?: string | null): string | null => {
    if (!key) return STONE_BY_TIER.get(7) ?? null;
    const tier = STONE_RARITY_TO_TIER[key] ?? STONE_ID_TO_TIER[key];
    if (tier && STONE_BY_TIER.has(tier)) return STONE_BY_TIER.get(tier)!;
    return STONE_BY_TIER.get(7) ?? null;
};

const POTION_FILES = import.meta.glob('../assets/images/potions/*.png', {
    eager: true,
}) as Record<string, GlobModule>;
const POTION_BY_NAME = (() => {
    const map = new Map<string, string>();
    for (const [path, mod] of Object.entries(POTION_FILES)) {
        const m = path.match(/\/([^/]+)\.png$/);
        if (!m) continue;
        const name = m[1].toLowerCase();
        const url = typeof mod === 'string' ? mod : mod.default;
        if (url) map.set(name, url);
    }
    return map;
})();

const POTION_ID_TO_FILE: Record<string, string> = {
    hp_potion_sm:       'hp-50',
    hp_potion_md:       'hp-150',
    hp_potion_lg:       'hp-400',
    hp_potion_mega:     'hp-1000',
    hp_potion_great:    'hp-20-proc',
    hp_potion_super:    'hp-35-proc',
    hp_potion_ultimate: 'hp-50-proc',
    hp_potion_divine:   'hp-100-proc',
    mp_potion_sm:       'mp-30',
    mp_potion_md:       'mp-100',
    mp_potion_lg:       'mp-300',
    mp_potion_mega:     'mp-1000',
    mp_potion_great:    'mp-20-proc',
    mp_potion_super:    'mp-35-proc',
    mp_potion_ultimate: 'mp-50-proc',
    mp_potion_divine:   'mp-100-proc',
};

export const getPotionImage = (elixirId?: string | null): string | null => {
    if (!elixirId) return POTION_BY_NAME.get('hp-50') ?? null;
    const file = POTION_ID_TO_FILE[elixirId];
    if (file && POTION_BY_NAME.has(file)) return POTION_BY_NAME.get(file)!;
    if (POTION_BY_NAME.has(elixirId.toLowerCase())) return POTION_BY_NAME.get(elixirId.toLowerCase())!;
    return POTION_BY_NAME.get('hp-50') ?? null;
};

const ELIXIR_FILES = import.meta.glob('../assets/images/eliksirs/*.png', {
    eager: true,
}) as Record<string, GlobModule>;
const ELIXIR_BY_NAME = (() => {
    const map = new Map<string, string>();
    for (const [path, mod] of Object.entries(ELIXIR_FILES)) {
        const m = path.match(/\/([^/]+)\.png$/);
        if (!m) continue;
        const name = m[1].toLowerCase();
        const url = typeof mod === 'string' ? mod : mod.default;
        if (url) map.set(name, url);
    }
    return map;
})();

const ELIXIR_ID_TO_FILE: Record<string, string> = {
    xp_boost:                   'dopalacz-xp',
    xp_boost_100:               'wielki-dopalacz-xp',
    skill_xp_boost:             'dopalacz-skilli',
    skill_xp_boost_100:         'wielki-dopalacz-skilli',
    attack_speed_elixir:        'eliksir-szybkosci',
    cd_reduction_elixir:        'eliksir-skupienia',
    atk_dmg_elixir_25:          'eliksir-ataku-1',
    atk_dmg_elixir_50:          'eliksir-ataku-2',
    atk_dmg_elixir_100:         'eliksir-ataku-3',
    spell_dmg_elixir_25:        'eliksir-magi-1',
    spell_dmg_elixir_50:        'eliksir-magi-2',
    spell_dmg_elixir_100:       'eliksir-magi-3',
    hp_boost_elixir:            'eliksir-witalnosci',
    mp_boost_elixir:            'eliksir-many',
    atk_boost_elixir:           'eliksir-sily',
    hp_pct_elixir_25:           'eliksir-kolosa',
    mp_pct_elixir_25:           'eliksir-arcymaga',
    dungeon_reset:              'reset-dungeona',
    boss_reset:                 'reset-bossa',
    death_protection:           'eliksir-ochrony-przed-smiercia',
    amulet_of_loss:             'amulet-of-loss',
    stat_reset:                 'eliksir-resetu-statystyk',
    offline_training_boost:     'eliksir-treningu-offline',
    utamo_vita:                 'utamo-vita',
    premium_xp_boost:           'premium-eliksir-xp',
};

const BUFF_EFFECT_TO_FILE: Record<string, string> = {
    xp_boost:                'dopalacz-xp',
    xp_boost_100:            'wielki-dopalacz-xp',
    skill_xp_boost:          'dopalacz-skilli',
    skill_xp_boost_100:      'wielki-dopalacz-skilli',
    attack_speed:            'eliksir-szybkosci',
    cooldown_reduction:      'eliksir-skupienia',
    atk_dmg_25:              'eliksir-ataku-1',
    atk_dmg_50:              'eliksir-ataku-2',
    atk_dmg_100:             'eliksir-ataku-3',
    spell_dmg_25:            'eliksir-magi-1',
    spell_dmg_50:            'eliksir-magi-2',
    spell_dmg_100:           'eliksir-magi-3',
    hp_boost_500:            'eliksir-witalnosci',
    mp_boost_500:            'eliksir-many',
    atk_boost_50:            'eliksir-sily',
    def_boost_50:            'eliksir-sily',
    hp_pct_25:               'eliksir-kolosa',
    mp_pct_25:               'eliksir-arcymaga',
    offline_training_boost:  'eliksir-treningu-offline',
    utamo_vita:              'utamo-vita',
    premium_xp_boost:        'premium-eliksir-xp',
};

export const getElixirImage = (id?: string | null): string | null => {
    if (!id) return null;
    const lower = id.toLowerCase();
    const file = ELIXIR_ID_TO_FILE[id] ?? BUFF_EFFECT_TO_FILE[id];
    if (file && ELIXIR_BY_NAME.has(file)) return ELIXIR_BY_NAME.get(file)!;
    if (ELIXIR_BY_NAME.has(lower)) return ELIXIR_BY_NAME.get(lower)!;
    return null;
};

export const getConsumableImage = (id?: string | null): string | null => {
    if (!id) return null;
    if (id.startsWith('hp_potion_') || id.startsWith('mp_potion_')) {
        return getPotionImage(id);
    }
    return getElixirImage(id) ?? getPotionImage(id);
};

const TYPE_TO_FILE: Record<string, string> = {
    heavy_helmet:    'helmet-ciezki',
    heavy_armor:     'armor-ciezki',
    heavy_pants:     'legs-ciezki',
    heavy_boots:     'boots-ciezki',
    heavy_shoulders: 'shoulder-ciezki',
    heavy_gloves:    'glove-ciezki',
    light_helmet:    'helmet-lekki',
    light_armor:     'armor-lekki',
    light_pants:     'legs-lekki',
    light_boots:     'boots-lekki',
    light_shoulders: 'shoulder-lekki',
    light_gloves:    'glove-lekki',
    magic_helmet:    'helmet-magiczny',
    magic_armor:     'armor-magiczny',
    magic_pants:     'legs-magiczny',
    magic_boots:     'boots-megiczny',
    magic_shoulders: 'shoulder-magiczny',
    magic_gloves:    'glove-magiczny',
    sword:           'miecz',
    bow:             'luk',
    dagger:          'sztylet',
    harp:            'harfa',
    staff:           'kostur-maga',
    dead_staff:      'kostur-necro',
    holy_wand:       'rozdzka-clerica',
    shield:          'tarcza',
    spellbook:       'ksiega-czarow',
    magic_book:      'ksiega-czarow',
    tome:            'ksiega-czarow',
    holy_cross:      'swiety-krzyz',
    holy:            'swiety-krzyz',
    quiver:          'kolczan',
    voodoo_doll:     'lalka-voodo',
    talisman:        'talizman',
    ring:            'ring',
    necklace:        'nackle',
    earrings:        'earrings',
};

const SLOT_TO_FILE: Partial<Record<EquipmentSlot, string>> = {
    ring1:    'ring',
    ring2:    'ring',
    necklace: 'nackle',
    earrings: 'earrings',
};

export const getItemImage = (
    itemId: string,
    slot?: string,
    type?: string,
): string | null => {
    if (type && TYPE_TO_FILE[type]) {
        return itemFile(TYPE_TO_FILE[type])!;
    }

    const id = itemId.toLowerCase();

    for (const t of Object.keys(TYPE_TO_FILE)) {
        if (id.startsWith(`${t}_`) || id === t) {
            const file = TYPE_TO_FILE[t];
            const url = itemFile(file);
            if (url) return url;
        }
    }

    const weightHint = id.includes('heavy') || id.includes('plate') || id.includes('iron')
        ? 'heavy'
        : (id.includes('robe') || id.includes('mage') || id.includes('cloth')
            ? 'magic'
            : (id.includes('leather') || id.includes('hide') || id.includes('light')
                ? 'light'
                : null));

    if (weightHint) {
        const armorMap: Record<string, Record<string, string>> = {
            heavy: {
                helmet: 'helmet-ciezki', armor: 'armor-ciezki', pants: 'legs-ciezki',
                boots: 'boots-ciezki',  gloves: 'glove-ciezki', shoulders: 'shoulder-ciezki',
            },
            light: {
                helmet: 'helmet-lekki', armor: 'armor-lekki', pants: 'legs-lekki',
                boots: 'boots-lekki',  gloves: 'glove-lekki', shoulders: 'shoulder-lekki',
            },
            magic: {
                helmet: 'helmet-magiczny', armor: 'armor-magiczny', pants: 'legs-magiczny',
                boots: 'boots-megiczny',   gloves: 'glove-magiczny', shoulders: 'shoulder-magiczny',
            },
        };
        const slotKeys = ['helmet', 'armor', 'pants', 'boots', 'gloves', 'shoulders'] as const;
        for (const s of slotKeys) {
            if (id.includes(s) || (s === 'pants' && (id.includes('legs') || id.includes('greaves')))) {
                const file = armorMap[weightHint][s];
                const url = itemFile(file);
                if (url) return url;
            }
        }
        if (slot && (slot === 'helmet' || slot === 'armor' || slot === 'pants'
            || slot === 'boots' || slot === 'gloves' || slot === 'shoulders')) {
            const file = armorMap[weightHint][slot];
            const url = itemFile(file);
            if (url) return url;
        }
    }

    if (id.includes('sword') || id.includes('blade') || id.includes('saber') || id.includes('claymore')) {
        return itemFile('miecz');
    }
    if (id.includes('bow') && !id.includes('elbow')) return itemFile('luk');
    if (id.includes('dagger') || id.includes('knife') || id.includes('stiletto')) return itemFile('sztylet');
    if (id.includes('staff') || id.includes('rod')) {
        return itemFile(id.includes('necro') || id.includes('dead') ? 'kostur-necro' : 'kostur-maga');
    }
    if (id.includes('wand')) return itemFile('rozdzka-clerica');
    if (id.includes('harp') || id.includes('lute') || id.includes('flute')) return itemFile('harfa');
    if (id.includes('shield') || id.includes('buckler')) return itemFile('tarcza');
    if (id.includes('spellbook') || id.includes('grimoire') || id.includes('book') || id.includes('tome')) return itemFile('ksiega-czarow');
    if (id.includes('cross') || id.includes('crucifix')) return itemFile('swiety-krzyz');
    if (id.includes('quiver')) return itemFile('kolczan');
    if (id.includes('voodoo')) return itemFile('lalka-voodo');
    if (id.includes('talisman')) return itemFile('talizman');

    if (slot && SLOT_TO_FILE[slot as EquipmentSlot]) {
        const file = SLOT_TO_FILE[slot as EquipmentSlot]!;
        const url = itemFile(file);
        if (url) return url;
    }

    return null;
};

export const isImageUrl = (value: string): boolean =>
    value.startsWith('/') || value.startsWith('http') || value.startsWith('data:')
    || value.startsWith('blob:');
