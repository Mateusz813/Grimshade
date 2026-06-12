// -----------------------------------------------------------------------------
// Sprite asset registry.
//
// The user dropped real PNG art for every monster, every boss and the major
// item types into `src/assets/images/{monsters,boss,items}`. The naming
// convention is fixed and predictable:
//
//   monsters/monster-{level}.png   (1 file per monster level — 60 in total)
//   boss/boss-{level}.png          (1 file per boss level — 69 in total)
//   items/<weapon-or-armor>.png    (35 files; armor pieces split into
//                                    `-ciezki` (heavy), `-lekki` (light) and
//                                    `-magiczny`/`-magic` (magic) variants)
//
// Rather than writing 164 explicit `import …` lines (and having to update them
// every time a new asset lands), we use `import.meta.glob` with `eager: true`
// so Vite hashes & inlines every URL at build time. Each map key is the bare
// filename so callers can do simple lookups like `monsterByLevel.get(5)`.
//
// Public surface is three pure functions:
//   - getMonsterImage(level)
//   - getBossImage(level)
//   - getItemImage(itemId, slot)
//
// Each returns either a string URL (Vite-hashed) or `null` when no image is
// available — at which point the caller should fall back to the original
// emoji glyph it was rendering before. That keeps all of this strictly
// additive: any new monster/boss/item without a matching PNG continues to
// render its emoji and nothing breaks.
// -----------------------------------------------------------------------------

import type { EquipmentSlot } from './itemSystem';

/* eslint-disable @typescript-eslint/no-explicit-any */

type GlobModule = { default: string } | string;

/** Build a `level -> URL` map from a Vite glob result keyed on `prefix-{level}`. */
const buildLevelMap = (
    files: Record<string, GlobModule>,
    prefix: string,
): Map<number, string> => {
    const out = new Map<number, string>();
    for (const [path, mod] of Object.entries(files)) {
        // path looks like `/src/assets/images/monsters/monster-12.png`
        const match = path.match(new RegExp(`/${prefix}-(\\d+)\\.[a-zA-Z]+$`));
        if (!match) continue;
        const level = Number(match[1]);
        if (!Number.isFinite(level)) continue;
        const url = typeof mod === 'string' ? mod : (mod as any).default;
        if (url) out.set(level, url);
    }
    return out;
};

/** Build a `filename (without extension) -> URL` map. */
const buildNameMap = (files: Record<string, GlobModule>): Map<string, string> => {
    const out = new Map<string, string>();
    for (const [path, mod] of Object.entries(files)) {
        const m = path.match(/\/([^/]+)\.[a-zA-Z]+$/);
        if (!m) continue;
        const url = typeof mod === 'string' ? mod : (mod as any).default;
        if (url) out.set(m[1], url);
    }
    return out;
};

// -- Monster sprites ---------------------------------------------------------
const MONSTER_FILES = import.meta.glob('../assets/images/monsters/monster-*.png', {
    eager: true,
}) as Record<string, GlobModule>;
const MONSTER_BY_LEVEL = buildLevelMap(MONSTER_FILES, 'monster');

/** Returns the URL for the monster art at this level, or null if missing. */
export const getMonsterImage = (level: number): string | null =>
    MONSTER_BY_LEVEL.get(level) ?? null;

/**
 * Like `getMonsterImage` but falls back to the nearest available tier
 * when an exact-level PNG isn't registered. Walks UP from the given
 * level first (so a level-79 monster shows the level-80 art when 79 is
 * missing), then DOWN if nothing higher exists. Used by the task-history
 * modal where we always want SOME monster art rather than the emoji
 * fallback the strict lookup falls back to.
 */
export const getMonsterImageNearest = (level: number): string | null => {
    const exact = MONSTER_BY_LEVEL.get(level);
    if (exact) return exact;
    const available = Array.from(MONSTER_BY_LEVEL.keys()).sort((a, b) => a - b);
    if (available.length === 0) return null;
    // Up first.
    for (const l of available) {
        if (l >= level) return MONSTER_BY_LEVEL.get(l) ?? null;
    }
    // Otherwise the closest lower level (largest in the list).
    return MONSTER_BY_LEVEL.get(available[available.length - 1]) ?? null;
};

// -- Boss sprites ------------------------------------------------------------
const BOSS_FILES = import.meta.glob('../assets/images/boss/boss-*.png', {
    eager: true,
}) as Record<string, GlobModule>;
const BOSS_BY_LEVEL = buildLevelMap(BOSS_FILES, 'boss');

/** Returns the URL for the boss art at this level, or null if missing. */
export const getBossImage = (level: number): string | null =>
    BOSS_BY_LEVEL.get(level) ?? null;

/**
 * Like `getBossImage` but falls back to the nearest available tier
 * when an exact-level PNG isn't registered. Same up-then-down walk as
 * `getMonsterImageNearest`. Used by `BossSprite` so the boss card
 * always shows real art instead of the emoji glyph fallback.
 */
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

// -- Dungeon backgrounds -----------------------------------------------------
// 77 dungeons in dungeons.json (already sorted by level) map 1:1 to the files
// dung-1.png … dung-77.png. The mapping is positional and keyed by id, so
// filtering / sorting / re-ordering inside any lobby view never reshuffles
// which background a particular dungeon shows. Legacy `dungN.png` files
// (without the dash) are ignored on purpose — the regex requires the dash.
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
        const url = typeof mod === 'string' ? mod : (mod as any).default;
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

/** Returns the background art URL for a dungeon (by id), or null if missing. */
export const getDungeonImage = (dungeonId: string): string | null =>
    DUNGEON_IMG_BY_ID[dungeonId] ?? null;

// -- Spell icons -------------------------------------------------------------
// Per-class spell artwork lives in `assets/images/spells/{class}-{idx}.png`
// (1-indexed: archer-1, archer-2, ..., archer-15 etc.). The combat action
// bar + Skills view both read these via `getSpellImage`.
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

/**
 * Returns the URL for `{class}-{index}.png`, or null if missing. Class is
 * case-insensitive ("Knight" -> "knight"), index 1-based.
 *
 * Filename aliases — historic art files use shortened class names that
 * don't match the canonical class id from skills.json. Without these
 * aliases the Necromancer (and any future class with a shortened
 * filename) would always fall back to the emoji because
 * `necromancer-1` doesn't match the on-disk `necro-1.png`.
 */
const CLASS_FILE_ALIAS: Record<string, string> = {
    necromancer: 'necro',
};
export const getSpellImage = (classId: string, index: number): string | null => {
    const lc = classId.toLowerCase();
    const alias = CLASS_FILE_ALIAS[lc] ?? lc;
    return SPELL_IMG_BY_KEY[`${alias}-${index}`] ?? SPELL_IMG_BY_KEY[`${lc}-${index}`] ?? null;
};

// -- Necromancer summon portraits --------------------------------------------
// Per-type summon art lives in `assets/images/summons/summon-{type}.png`.
// File names use Polish: szkielet / duch / demon / lisz. The necro's ally
// card swaps the avatar to whichever summon currently sits at the FRONT
// of the damage-soak queue (skeleton -> ghost -> demon -> lich) so the
// player sees who's currently shielding them.
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

// English-id -> on-disk Polish-id alias.
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

// -- Boss card backgrounds ---------------------------------------------------
// Distinct from the small `boss-{level}.png` portrait sprites above. These
// are full-card background paintings that sit behind every boss tile in the
// list view, mirroring the per-dungeon art treatment. The user adds files
// progressively under `images/boss/` named `boss1.png`, `boss2.png`, … and
// they map by INDEX to the bosses[] array (1-based: boss1.png -> bosses[0]).
// Iteration is sequential so missing files just leave their tile without a
// background — the gradient chrome still renders fine underneath.
const BOSS_CARD_FILES = import.meta.glob('../assets/images/boss/boss*.png', {
    eager: true,
}) as Record<string, GlobModule>;

const BOSS_CARD_IMG_BY_INDEX: Map<number, string> = (() => {
    const out = new Map<number, string>();
    for (const [path, mod] of Object.entries(BOSS_CARD_FILES)) {
        // Match `boss{digits}.png` — explicitly requires no dash so it doesn't
        // clash with the `boss-{level}.png` sprite naming convention used for
        // the small portrait icons.
        const match = path.match(/\/boss(\d+)\.png$/);
        if (!match) continue;
        const idx = Number(match[1]);
        if (!Number.isFinite(idx) || idx <= 0) continue;
        const url = typeof mod === 'string' ? mod : (mod as { default: string }).default;
        if (url) out.set(idx, url);
    }
    return out;
})();

/**
 * Returns the card-background art URL for a boss at the given 0-based index
 * in the bosses list (`boss1.png` for index 0, `boss2.png` for index 1, …),
 * or null if the file isn't present yet.
 */
export const getBossCardImage = (index: number): string | null =>
    BOSS_CARD_IMG_BY_INDEX.get(index + 1) ?? null;

// -- Item sprites ------------------------------------------------------------
const ITEM_FILES = import.meta.glob('../assets/images/items/*.png', {
    eager: true,
}) as Record<string, GlobModule>;
const ITEM_BY_NAME = buildNameMap(ITEM_FILES);

/**
 * Translates a filename key (e.g. `helmet-ciezki`) to its URL. Logs nothing if
 * missing — callers handle the null case by falling back to emoji.
 */
const itemFile = (name: string): string | null => ITEM_BY_NAME.get(name) ?? null;

/**
 * Public lookup so callers (Inventory slot-filter row, etc.) can grab a
 * specific item PNG by its base filename without going through
 * getItemImage's slot/type detection. Returns null when missing so the
 * caller can fall back to emoji.
 */
export const getItemFile = itemFile;

// -- Spell chest sprites (2026-05) -------------------------------------------
// Player-supplied art lives in `/assets/images/spell-chest/spell-chest-{N}.png`
// for N = 1..15. We expose a single `getSpellChestImage(level)` helper that
// returns the URL for a specific level, or the level-15 art as the universal
// "spell chest" fallback (used by drop-table summaries that don't carry a
// specific chest level). Returns null when the registry is empty so callers
// can fall back to the legacy :package: emoji.
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

/** Game-side chest LEVEL -> art TIER (1-15). The game spawns chests at
 *  these 15 levels (matches `SPELL_CHEST_LEVELS` in skillSystem) — we
 *  map them ordinally to the 15 PNG tiers shipped under
 *  `/spell-chest/spell-chest-{1..15}.png` so every distinct chest
 *  level shows its own art. Generic / unknown levels fall back to the
 *  highest tier (15) per the 2026-05 art spec.
 */
const CHEST_LEVEL_TO_TIER: Record<number, number> = {
    5: 1, 10: 2, 20: 3, 30: 4, 40: 5, 50: 6, 60: 7, 70: 8,
    80: 9, 100: 10, 150: 11, 300: 12, 600: 13, 800: 14, 1000: 15,
};

/** Returns the PNG URL for a given chest level. Maps the game's 15 chest
 *  level tiers to the 15 art tiers (1-15) ordinally. Anything off-grid
 *  falls back to art tier 15 (the universal "spell chest" art). */
export const getSpellChestImage = (level: number): string | null => {
    const tier = CHEST_LEVEL_TO_TIER[level];
    if (tier && SPELL_CHEST_BY_LEVEL.has(tier)) {
        return SPELL_CHEST_BY_LEVEL.get(tier)!;
    }
    return SPELL_CHEST_BY_LEVEL.get(15) ?? null;
};

// -- Upgrade-stone sprites (2026-05) ----------------------------------------
// Stones live in `/assets/images/upgrade-stone/stone-{N}.png` where N maps
// to rarity tier: 1 = common, 2 = rare, 3 = epic, 4 = legendary, 5 = mythic,
// 6 = heroic. `stone-7.png` is the universal "any stone" fallback used by
// generic chrome (e.g. enhancement-cost summaries).
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

/** Returns the PNG URL for an upgrade stone keyed by rarity OR stone ID
 *  (`common_stone`, `rare`, etc). Falls back to `stone-7.png` (the universal
 *  generic-stone art) when called with no key or an unknown one. */
export const getStoneImage = (key?: string | null): string | null => {
    if (!key) return STONE_BY_TIER.get(7) ?? null;
    const tier = STONE_RARITY_TO_TIER[key] ?? STONE_ID_TO_TIER[key];
    if (tier && STONE_BY_TIER.has(tier)) return STONE_BY_TIER.get(tier)!;
    return STONE_BY_TIER.get(7) ?? null;
};

// -- Potion / elixir sprites (2026-05) --------------------------------------
// Files in `/assets/images/potions/` follow descriptive names like `hp-50`,
// `hp-150`, `hp-20-proc`, `mp-30`, `mp-100-proc`. We map the canonical
// elixir IDs from the shop to the matching PNG. Anything not on the list
// (buff elixirs, dungeon resets, stat-reset, etc.) falls back to the
// universal +50 HP art per the spec.
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

// Maps shop elixir ID -> potion filename (without extension). Buff /
// utility elixirs that have no dedicated art fall through to the default.
const POTION_ID_TO_FILE: Record<string, string> = {
    // HP potions (flat)
    hp_potion_sm:       'hp-50',
    hp_potion_md:       'hp-150',
    hp_potion_lg:       'hp-400',
    hp_potion_mega:     'hp-1000',
    // HP potions (percent)
    hp_potion_great:    'hp-20-proc',
    hp_potion_super:    'hp-35-proc',
    hp_potion_ultimate: 'hp-50-proc',
    hp_potion_divine:   'hp-100-proc',
    // MP potions (flat)
    mp_potion_sm:       'mp-30',
    mp_potion_md:       'mp-100',
    mp_potion_lg:       'mp-300',
    mp_potion_mega:     'mp-1000',
    // MP potions (percent)
    mp_potion_great:    'mp-20-proc',
    mp_potion_super:    'mp-35-proc',
    mp_potion_ultimate: 'mp-50-proc',
    mp_potion_divine:   'mp-100-proc',
};

/** Returns the PNG URL for a potion identified by elixir ID. Unknown IDs
 *  (buffs, utility elixirs, etc.) fall back to the generic +50 HP art. */
export const getPotionImage = (elixirId?: string | null): string | null => {
    if (!elixirId) return POTION_BY_NAME.get('hp-50') ?? null;
    const file = POTION_ID_TO_FILE[elixirId];
    if (file && POTION_BY_NAME.has(file)) return POTION_BY_NAME.get(file)!;
    // Best-effort name match: e.g. an elixir whose ID itself matches the file.
    if (POTION_BY_NAME.has(elixirId.toLowerCase())) return POTION_BY_NAME.get(elixirId.toLowerCase())!;
    return POTION_BY_NAME.get('hp-50') ?? null;
};

// 2026-05-08: dedicated elixir-art registry. The user dropped a fresh
// pack of buff/utility elixir PNGs into `assets/images/eliksirs/`
// (Polish filenames matching each elixir's display name). Map the
// internal elixir IDs to those filenames so the entire app — Shop,
// BuffBar, BuffPopover, quest rewards, drop floats — can resolve the
// real artwork instead of the placeholder emoji.
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

// Internal elixir-id -> filename mapping. Filenames are taken verbatim
// from the user-provided pack and lower-cased for the lookup table.
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

// BuffBar uses the active-buff EFFECT id (e.g. `xp_boost_100`,
// `attack_speed`) which differs from the inventory consumable id. Map
// effect->filename so the same lookup serves both surfaces.
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

/**
 * Returns the PNG URL for a buff/utility elixir. Looks up:
 *   1. user-supplied art for `elixirId` (consumable inventory id) OR
 *      `effect` (BuffBar active-buff effect string)
 *   2. raw lower-cased filename match (e.g. id === 'utamo-vita')
 *   3. null -> caller falls back to its existing emoji
 *
 * HP/MP potions return their dedicated potion art via `getPotionImage`
 * — this helper is for the buff/utility set only.
 */
export const getElixirImage = (id?: string | null): string | null => {
    if (!id) return null;
    const lower = id.toLowerCase();
    const file = ELIXIR_ID_TO_FILE[id] ?? BUFF_EFFECT_TO_FILE[id];
    if (file && ELIXIR_BY_NAME.has(file)) return ELIXIR_BY_NAME.get(file)!;
    if (ELIXIR_BY_NAME.has(lower)) return ELIXIR_BY_NAME.get(lower)!;
    return null;
};

/**
 * Unified image resolver — tries potion art first, then elixir art.
 * Use this anywhere a UI surfaces a "consumable thumbnail" without
 * caring which family it belongs to.
 */
export const getConsumableImage = (id?: string | null): string | null => {
    if (!id) return null;
    if (id.startsWith('hp_potion_') || id.startsWith('mp_potion_')) {
        return getPotionImage(id);
    }
    return getElixirImage(id) ?? getPotionImage(id);
};

/**
 * Maps the canonical item `type` field (set by itemTemplates.json) to the right
 * art file. Heavy/light/magic armor variants live in separate files. Single-
 * weapon types map to a single file. Anything not listed here returns null.
 *
 * Note: the user shipped the magic boots file as `boots-megiczny.png` (typo),
 * so the entry uses that exact filename.
 */
const TYPE_TO_FILE: Record<string, string> = {
    // Heavy armor (Knight)
    heavy_helmet:    'helmet-ciezki',
    heavy_armor:     'armor-ciezki',
    heavy_pants:     'legs-ciezki',
    heavy_boots:     'boots-ciezki',
    heavy_shoulders: 'shoulder-ciezki',
    heavy_gloves:    'glove-ciezki',
    // Light armor (Archer / Rogue / Bard)
    light_helmet:    'helmet-lekki',
    light_armor:     'armor-lekki',
    light_pants:     'legs-lekki',
    light_boots:     'boots-lekki',
    light_shoulders: 'shoulder-lekki',
    light_gloves:    'glove-lekki',
    // Magic armor (Mage / Cleric / Necromancer)
    magic_helmet:    'helmet-magiczny',
    magic_armor:     'armor-magiczny',
    magic_pants:     'legs-magiczny',
    magic_boots:     'boots-megiczny', // user-side filename has a typo; keep verbatim
    magic_shoulders: 'shoulder-magiczny',
    magic_gloves:    'glove-magiczny',
    // Weapons (mainHand)
    sword:           'miecz',
    bow:             'luk',
    dagger:          'sztylet',
    harp:            'harfa',
    staff:           'kostur-maga',
    dead_staff:      'kostur-necro',
    holy_wand:       'rozdzka-clerica',
    // Offhands
    shield:          'tarcza',
    spellbook:       'ksiega-czarow',
    magic_book:      'ksiega-czarow',
    tome:            'ksiega-czarow',
    holy_cross:      'swiety-krzyz',
    holy:            'swiety-krzyz',
    quiver:          'kolczan',
    voodoo_doll:     'lalka-voodo',
    talisman:        'talizman',
    // Accessories
    ring:            'ring',
    necklace:        'nackle',
    earrings:        'earrings',
};

/**
 * Slot-based fallback for items that have no `type` field but a known slot
 * (legacy items.json entries for rings/necklaces/earrings, etc.).
 */
const SLOT_TO_FILE: Partial<Record<EquipmentSlot, string>> = {
    ring1:    'ring',
    ring2:    'ring',
    necklace: 'nackle',
    earrings: 'earrings',
};

/**
 * Best-guess art lookup for an item. Tries (in order):
 *   1. canonical `type` mapping (heavy_helmet -> helmet-ciezki, etc.)
 *   2. ID prefix detection for generated armor/weapon IDs (`heavy_helmet_lvl5_rare`)
 *   3. ID substring detection for legacy items.json IDs (`leather_cap`, `iron_sword`)
 *   4. equipment slot fallback (rings/necklaces/earrings)
 *
 * Returns null when no match exists; callers fall back to the existing emoji.
 */
export const getItemImage = (
    itemId: string,
    slot?: string,
    type?: string,
): string | null => {
    // 1. Direct type mapping — the cheapest and most reliable path.
    if (type && TYPE_TO_FILE[type]) {
        return itemFile(TYPE_TO_FILE[type])!;
    }

    const id = itemId.toLowerCase();

    // 2. Generated-item ID prefix detection. IDs look like `heavy_helmet_lvl5_rare`
    //    or `sword_lvl3_common` — we already know every prefix listed in
    //    TYPE_TO_FILE, so just check if any of them prefix the ID.
    for (const t of Object.keys(TYPE_TO_FILE)) {
        if (id.startsWith(`${t}_`) || id === t) {
            const file = TYPE_TO_FILE[t];
            const url = itemFile(file);
            if (url) return url;
        }
    }

    // 3. Legacy items.json keyword detection. Mirrors the existing emoji
    //    fall-through in `getItemIcon`. We only bother with item words that
    //    actually have art on disk; everything else falls through to emoji.
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
        // Slot-based fallback when the ID itself doesn't tell us the piece.
        if (slot && (slot === 'helmet' || slot === 'armor' || slot === 'pants'
            || slot === 'boots' || slot === 'gloves' || slot === 'shoulders')) {
            const file = armorMap[weightHint][slot];
            const url = itemFile(file);
            if (url) return url;
        }
    }

    // Single-asset weapon keywords (no weight class needed).
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

    // 4. Slot-based fallback for accessories without distinguishing words.
    if (slot && SLOT_TO_FILE[slot as EquipmentSlot]) {
        const file = SLOT_TO_FILE[slot as EquipmentSlot]!;
        const url = itemFile(file);
        if (url) return url;
    }

    return null;
};

/** True when a string looks like a Vite-served image URL (vs. an emoji). */
export const isImageUrl = (value: string): boolean =>
    value.startsWith('/') || value.startsWith('http') || value.startsWith('data:')
    || value.startsWith('blob:');
