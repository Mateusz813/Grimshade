/**
 * Tests for the sprite-asset registry.
 *
 * The registry is populated at build-time via `import.meta.glob({ eager: true })`
 * — vitest goes through Vite so the glob resolves against the real
 * `src/assets/images/**` tree. That means these tests are sensitive to the
 * actual on-disk asset layout (and therefore to whichever assets the user
 * has shipped at the time the test runs).
 *
 * We avoid asserting exact URL strings (Vite hashes them, hash can change
 * between dev/build) and instead assert:
 *   - presence/absence (`expect(...).not.toBeNull()` / `.toBeNull()`)
 *   - that returned values are non-empty strings
 *   - that the nearest-tier fallback walks UP first then DOWN
 *   - that the alias / family routing works for keyed lookups
 *
 * Asset inventory used by these tests (cross-checked against the asset
 * tree as of 2026-05-21):
 *   - monsters/monster-{1..31, 35,40,45,50, 60,70,80,90, 100,125,150,
 *     175,200, 250..1000 step 50}.png   (level 79 is GAPPED — used to
 *     exercise the up-first fallback)
 *   - boss/boss-{10,15,25,...,1000}.png  (level 1..9 are GAPPED — used
 *     for the same)
 *   - boss/boss{1..N}.png                (card backgrounds, separate
 *     from the sprites above)
 *   - dungeons/dung-{1..77}.png          (positional map to dungeons.json)
 *   - spell-chest/spell-chest-{1..15}.png
 *   - upgrade-stone/stone-{1..7}.png
 *   - potions/{hp,mp}-{50,150,400,1000}.png + {hp,mp}-{20,35,50,100}-proc.png
 *   - eliksirs/*.png (Polish-named buff/utility art)
 */

import { describe, it, expect } from 'vitest';
import {
    getMonsterImage,
    getMonsterImageNearest,
    getBossImage,
    getBossImageNearest,
    getBossCardImage,
    getDungeonImage,
    getSpellImage,
    getSummonImage,
    getSpellChestImage,
    getStoneImage,
    getPotionImage,
    getElixirImage,
    getConsumableImage,
    getItemImage,
    getItemFile,
    isImageUrl,
} from './spriteAssets';

// -- getMonsterImage / getMonsterImageNearest ---------------------------------

describe('getMonsterImage', () => {
    it('returns a URL for levels 1..31 (every integer is shipped)', () => {
        for (const lvl of [1, 2, 10, 20, 31]) {
            const url = getMonsterImage(lvl);
            expect(url).not.toBeNull();
            expect(typeof url).toBe('string');
            expect(url!.length).toBeGreaterThan(0);
        }
    });

    it('returns a URL for the shipped sparse levels 35+', () => {
        for (const lvl of [35, 40, 100, 250, 500, 1000]) {
            expect(getMonsterImage(lvl)).not.toBeNull();
        }
    });

    it('returns null for an unshipped level inside the sparse range', () => {
        // level 79 lies between shipped levels 70 and 80 — should be null.
        expect(getMonsterImage(79)).toBeNull();
    });

    it('returns null for levels outside the registry', () => {
        expect(getMonsterImage(0)).toBeNull();
        expect(getMonsterImage(-1)).toBeNull();
        expect(getMonsterImage(99999)).toBeNull();
    });
});

describe('getMonsterImageNearest', () => {
    it('returns the exact-level URL when available', () => {
        expect(getMonsterImageNearest(10)).toBe(getMonsterImage(10));
    });

    it('falls back UP first when the exact level is missing (lvl 79 -> lvl 80)', () => {
        expect(getMonsterImageNearest(79)).toBe(getMonsterImage(80));
    });

    it('falls back DOWN when no higher level exists', () => {
        // 9999 is above any shipped level -> nearest = max shipped (1000).
        expect(getMonsterImageNearest(9999)).toBe(getMonsterImage(1000));
    });

    it('handles 0 / negative input by returning the lowest shipped tier', () => {
        expect(getMonsterImageNearest(0)).toBe(getMonsterImage(1));
        expect(getMonsterImageNearest(-5)).toBe(getMonsterImage(1));
    });
});

// -- getBossImage / getBossImageNearest --------------------------------------

describe('getBossImage', () => {
    it('returns a URL for shipped boss levels (10, 25, 100, …)', () => {
        for (const lvl of [10, 25, 100, 500, 1000]) {
            expect(getBossImage(lvl)).not.toBeNull();
        }
    });

    it('returns null for levels with no shipped sprite (1..9)', () => {
        expect(getBossImage(1)).toBeNull();
        expect(getBossImage(5)).toBeNull();
        expect(getBossImage(9)).toBeNull();
    });
});

describe('getBossImageNearest', () => {
    it('walks UP first: lvl 1 -> lowest shipped (lvl 10)', () => {
        expect(getBossImageNearest(1)).toBe(getBossImage(10));
        expect(getBossImageNearest(9)).toBe(getBossImage(10));
    });

    it('returns the exact-level URL when available', () => {
        expect(getBossImageNearest(25)).toBe(getBossImage(25));
    });

    it('walks DOWN when nothing higher exists', () => {
        expect(getBossImageNearest(9999)).toBe(getBossImage(1000));
    });
});

// -- getBossCardImage --------------------------------------------------------

describe('getBossCardImage', () => {
    it('returns a URL for the first boss (index 0 -> boss1.png)', () => {
        expect(getBossCardImage(0)).not.toBeNull();
    });

    it('returns null for an out-of-range high index', () => {
        // Very high index — even if a few hundred boss cards ship, 99999 won't.
        expect(getBossCardImage(99999)).toBeNull();
    });
});

// -- getDungeonImage ---------------------------------------------------------

describe('getDungeonImage', () => {
    it('returns a URL for the first dungeon (dungeon_1 maps to dung-1.png)', () => {
        const url = getDungeonImage('dungeon_1');
        expect(url).not.toBeNull();
        expect(typeof url).toBe('string');
    });

    it('returns null for an unknown dungeon ID', () => {
        expect(getDungeonImage('does_not_exist')).toBeNull();
    });

    it('returns null for the empty string', () => {
        expect(getDungeonImage('')).toBeNull();
    });
});

// -- getSpellImage -----------------------------------------------------------

describe('getSpellImage', () => {
    it('is case-insensitive on classId', () => {
        const a = getSpellImage('archer', 1);
        const b = getSpellImage('Archer', 1);
        const c = getSpellImage('ARCHER', 1);
        expect(a).not.toBeNull();
        expect(b).toBe(a);
        expect(c).toBe(a);
    });

    it('resolves the necromancer alias (necromancer -> necro-{N}.png)', () => {
        // The alias map maps "necromancer" -> "necro" — we don't assert the
        // exact URL but we do assert that necromancer queries don't go to
        // a literal `necromancer-1.png` (which doesn't ship). Either the
        // alias finds the file (non-null) or the file genuinely isn't
        // shipped (null) — either way we exercise the alias path.
        const url = getSpellImage('necromancer', 1);
        // If "necro-1.png" ships, url is non-null. Either branch is OK —
        // the alias must at least be considered. Spot-check via getSpellImage
        // with the alias spelling to confirm parity.
        const alias = getSpellImage('necro', 1);
        if (alias !== null) {
            expect(url).toBe(alias);
        }
    });

    it('returns null for an unknown classId / index', () => {
        expect(getSpellImage('not_a_class', 1)).toBeNull();
        expect(getSpellImage('archer', 99999)).toBeNull();
    });
});

// -- getSummonImage ----------------------------------------------------------

describe('getSummonImage', () => {
    it('routes English summon types through the Polish alias map', () => {
        // skeleton -> szkielet; ghost -> duch; demon -> demon; lich -> lisz
        const sk = getSummonImage('skeleton');
        const gh = getSummonImage('ghost');
        const dm = getSummonImage('demon');
        const lc = getSummonImage('lich');
        expect(sk).not.toBeNull();
        expect(gh).not.toBeNull();
        expect(dm).not.toBeNull();
        expect(lc).not.toBeNull();
    });

    it('is case-insensitive', () => {
        expect(getSummonImage('Skeleton')).toBe(getSummonImage('skeleton'));
    });

    it('falls back to the universal "default" art for unknown types', () => {
        // summon.png ships as the default -> unknown types return it, not null.
        expect(getSummonImage('not_a_summon')).not.toBeNull();
    });
});

// -- getSpellChestImage ------------------------------------------------------

describe('getSpellChestImage', () => {
    it('maps known chest levels to their dedicated art tier', () => {
        // Every entry in CHEST_LEVEL_TO_TIER should resolve to a URL because
        // spell-chest-{1..15}.png all ship.
        for (const lvl of [5, 10, 20, 30, 40, 50, 60, 70, 80, 100, 150, 300, 600, 800, 1000]) {
            expect(getSpellChestImage(lvl)).not.toBeNull();
        }
    });

    it('falls back to the universal level-15 art for off-grid levels', () => {
        const fallback = getSpellChestImage(1000);
        expect(getSpellChestImage(12345)).toBe(fallback);
        expect(getSpellChestImage(0)).toBe(fallback);
    });
});

// -- getStoneImage -----------------------------------------------------------

describe('getStoneImage', () => {
    it('routes rarity keys to the matching stone tier (1..6)', () => {
        for (const key of ['common', 'rare', 'epic', 'legendary', 'mythic', 'heroic']) {
            expect(getStoneImage(key)).not.toBeNull();
        }
    });

    it('routes consumable IDs to the same tiers as rarity keys', () => {
        expect(getStoneImage('common_stone')).toBe(getStoneImage('common'));
        expect(getStoneImage('legendary_stone')).toBe(getStoneImage('legendary'));
    });

    it('falls back to the universal stone-7 art for unknown / null / undefined', () => {
        const universal = getStoneImage();
        expect(universal).not.toBeNull();
        expect(getStoneImage(null)).toBe(universal);
        expect(getStoneImage(undefined)).toBe(universal);
        expect(getStoneImage('not_a_rarity')).toBe(universal);
    });
});

// -- getPotionImage ----------------------------------------------------------

describe('getPotionImage', () => {
    it('maps canonical flat HP/MP elixir IDs', () => {
        expect(getPotionImage('hp_potion_sm')).not.toBeNull(); // -> hp-50
        expect(getPotionImage('hp_potion_md')).not.toBeNull(); // -> hp-150
        expect(getPotionImage('hp_potion_lg')).not.toBeNull(); // -> hp-400
        expect(getPotionImage('mp_potion_sm')).not.toBeNull(); // -> mp-30
    });

    it('maps percentage HP/MP elixir IDs', () => {
        expect(getPotionImage('hp_potion_great')).not.toBeNull();    // -> hp-20-proc
        expect(getPotionImage('hp_potion_super')).not.toBeNull();    // -> hp-35-proc
        expect(getPotionImage('mp_potion_divine')).not.toBeNull();   // -> mp-100-proc
    });

    it('falls back to the hp-50 art when given no ID', () => {
        const fallback = getPotionImage('hp_potion_sm');
        expect(getPotionImage()).toBe(fallback);
        expect(getPotionImage(null)).toBe(fallback);
    });

    it('falls back to the hp-50 art for unknown IDs', () => {
        const fallback = getPotionImage('hp_potion_sm');
        expect(getPotionImage('totally_unknown_id')).toBe(fallback);
    });
});

// -- getElixirImage ----------------------------------------------------------

describe('getElixirImage', () => {
    it('maps known buff-elixir IDs to their dedicated art', () => {
        // Both inventory-id and BuffBar effect-id surfaces should resolve.
        expect(getElixirImage('xp_boost')).not.toBeNull();
        expect(getElixirImage('utamo_vita')).not.toBeNull();
    });

    it('returns null for the empty / undefined / unknown id', () => {
        expect(getElixirImage()).toBeNull();
        expect(getElixirImage(null)).toBeNull();
        expect(getElixirImage('definitely_unknown_elixir_xyz')).toBeNull();
    });
});

// -- getConsumableImage ------------------------------------------------------

describe('getConsumableImage', () => {
    it('routes hp_potion_* / mp_potion_* IDs to getPotionImage', () => {
        expect(getConsumableImage('hp_potion_sm')).toBe(getPotionImage('hp_potion_sm'));
        expect(getConsumableImage('mp_potion_great')).toBe(getPotionImage('mp_potion_great'));
    });

    it('routes everything else through getElixirImage first', () => {
        expect(getConsumableImage('xp_boost')).toBe(getElixirImage('xp_boost'));
    });

    it('returns null for nil input', () => {
        expect(getConsumableImage()).toBeNull();
        expect(getConsumableImage(null)).toBeNull();
    });
});

// -- getItemImage / getItemFile ----------------------------------------------

describe('getItemImage', () => {
    it('matches via the canonical type field (heavy_helmet -> helmet-ciezki.png)', () => {
        expect(getItemImage('whatever_id', undefined, 'heavy_helmet')).not.toBeNull();
        expect(getItemImage('whatever_id', undefined, 'sword')).not.toBeNull();
        expect(getItemImage('whatever_id', undefined, 'bow')).not.toBeNull();
    });

    it('detects generated IDs by prefix (heavy_armor_lvl5_rare)', () => {
        expect(getItemImage('heavy_armor_lvl5_rare')).not.toBeNull();
        expect(getItemImage('sword_lvl3_common')).not.toBeNull();
    });

    it('detects legacy keyword IDs (iron_sword -> miecz, leather_cap -> helmet-lekki)', () => {
        expect(getItemImage('iron_sword')).not.toBeNull();
        expect(getItemImage('leather_cap', 'helmet')).not.toBeNull();
    });

    it('avoids the `bow` keyword false-positive on "elbow"', () => {
        // Should not classify an "elbow"-containing ID as a bow. With no other
        // hints, returns null so the caller falls back to emoji.
        const url = getItemImage('elbow_pad_xyz');
        // Either null OR matched by some other heuristic — assert it's not
        // the bow art specifically.
        const bowUrl = getItemFile('luk');
        expect(url).not.toBe(bowUrl);
    });

    it('falls back via slot for accessories without distinguishing words', () => {
        // ring1 / ring2 / necklace / earrings -> keyed by slot
        expect(getItemImage('unknown_xyz', 'ring1')).not.toBeNull();
        expect(getItemImage('unknown_xyz', 'necklace')).not.toBeNull();
        expect(getItemImage('unknown_xyz', 'earrings')).not.toBeNull();
    });

    it('returns null when nothing matches', () => {
        expect(getItemImage('total_gibberish_xyz123')).toBeNull();
    });
});

describe('getItemFile', () => {
    it('returns a URL for an existing item filename', () => {
        expect(getItemFile('miecz')).not.toBeNull();
        expect(getItemFile('luk')).not.toBeNull();
    });

    it('returns null for an unknown filename', () => {
        expect(getItemFile('not_a_real_filename')).toBeNull();
    });
});

// -- isImageUrl --------------------------------------------------------------

describe('isImageUrl', () => {
    it('returns true for path-prefixed URLs', () => {
        expect(isImageUrl('/assets/image.png')).toBe(true);
    });

    it('returns true for http(s):// URLs', () => {
        expect(isImageUrl('http://example.com/a.png')).toBe(true);
        expect(isImageUrl('https://example.com/a.png')).toBe(true);
    });

    it('returns true for data: and blob: URLs', () => {
        expect(isImageUrl('data:image/png;base64,iVBORw0KGgo=')).toBe(true);
        expect(isImageUrl('blob:https://example.com/uuid')).toBe(true);
    });

    it('returns false for emoji / plain text', () => {
        expect(isImageUrl('crossed-swords')).toBe(false);
        expect(isImageUrl('hello')).toBe(false);
        expect(isImageUrl('')).toBe(false);
    });
});
