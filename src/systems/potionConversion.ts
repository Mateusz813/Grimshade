import { getPotionImage } from './spriteAssets';
import { getPotionMinLevel } from './potionGating';

// Tiny helper — resolve a potion ID's PNG art with an emoji fallback.
const PI = (id: string, fallback: string): string => getPotionImage(id) ?? fallback;

/**
 * Potion conversion (Alchemy).
 *
 * Players can combine weaker potions into stronger ones for FREE (no gold).
 *
 * 2026-06-24 ANTI-EXPLOIT: conversion `inputCount` MUST make crafting cost the
 * same-or-MORE than buying the output in the shop, i.e.
 *     inputCount = ceil( shopPrice(output) / shopPrice(input) ).
 * Otherwise players buy the cheapest potion en masse and craft up below shop
 * price (e.g. the old `4× lg -> 1× great` made a 200 000g potion for 2 400g).
 * Shop prices (src/stores/shopStore.ts ELIXIRS, HP==MP):
 *   sm 30 · md 150 · lg 600 · mega 15 000 · great 200 000 · super 350 000 ·
 *   ultimate 500 000 · divine 1 000 000.
 * Resulting ratios (craft cost in g vs shop price of output — always >=):
 *   5×  sm       (150g)     -> md        (150g)
 *   4×  md       (600g)     -> lg        (600g)
 *   334× lg      (200 400g) -> great     (200 000g)
 *   2×  great    (400 000g) -> super     (350 000g)
 *   2×  super    (700 000g) -> ultimate  (500 000g)
 *   2×  ultimate (1 000 000g)-> divine   (1 000 000g)
 *   25× lg       (15 000g)  -> mega      (15 000g)   [alternate flat branch]
 * The multi-step chain (sm->md->lg->great->...) is also non-exploitable end to
 * end — every tier costs >= buying it directly. Same ratios for MP potions.
 * The invariant is locked by a price-driven test in potionConversion.test.ts.
 * Supports mass conversion (convert N batches at once).
 */

export interface IPotionConversion {
    /** Tier index (1..7). Only a deterministic tiebreak now — UI order is
     *  family (HP before MP) then output unlock level ascending (see export). */
    tier: number;
    /** 'hp' or 'mp'. */
    family: 'hp' | 'mp';
    /** Source consumable id (the weaker potion consumed). */
    inputId: string;
    /** Human-readable Polish name of the input (for UI). */
    inputName: string;
    /** Emoji icon of the input. */
    inputIcon: string;
    /** How many of the input are consumed per single conversion. */
    inputCount: number;
    /** Destination consumable id (the stronger potion produced). */
    outputId: string;
    /** Human-readable Polish name of the output (for UI). */
    outputName: string;
    /** Emoji icon of the output. */
    outputIcon: string;
    /** Minimum character level to convert to this potion. */
    outputMinLevel: number;
}

// Raw recipes. The `outputMinLevel` literals below are IGNORED — see the
// derived export beneath the array. They're kept only for readability/diffing.
const RAW_POTION_CONVERSIONS: IPotionConversion[] = [
    // -- HP Potions --
    {
        tier: 1, family: 'hp',
        inputId: 'hp_potion_sm', inputName: 'Maly Eliksir HP', inputIcon: PI('hp_potion_sm', 'red-heart'),
        inputCount: 5,
        outputId: 'hp_potion_md', outputName: 'Eliksir HP', outputIcon: PI('hp_potion_md', 'red-heart'),
        outputMinLevel: 20,
    },
    {
        tier: 2, family: 'hp',
        inputId: 'hp_potion_md', inputName: 'Eliksir HP', inputIcon: PI('hp_potion_md', 'red-heart'),
        inputCount: 4,
        outputId: 'hp_potion_lg', outputName: 'Silny Eliksir HP', outputIcon: PI('hp_potion_lg', 'red-heart'),
        outputMinLevel: 50,
    },
    {
        tier: 3, family: 'hp',
        inputId: 'hp_potion_lg', inputName: 'Silny Eliksir HP', inputIcon: PI('hp_potion_lg', 'red-heart'),
        inputCount: 334, // 200000/600 = 333.33 -> ceil 334 (craft >= shop buy)
        outputId: 'hp_potion_great', outputName: 'Wielki Eliksir HP', outputIcon: PI('hp_potion_great', 'red-heart'),
        outputMinLevel: 100,
    },
    {
        tier: 4, family: 'hp',
        inputId: 'hp_potion_great', inputName: 'Wielki Eliksir HP', inputIcon: PI('hp_potion_great', 'red-heart'),
        inputCount: 2, // 350000/200000 = 1.75 -> ceil 2 (craft >= shop buy)
        outputId: 'hp_potion_super', outputName: 'Super Eliksir HP', outputIcon: PI('hp_potion_super', 'red-heart'),
        outputMinLevel: 200,
    },
    {
        tier: 5, family: 'hp',
        inputId: 'hp_potion_super', inputName: 'Super Eliksir HP', inputIcon: PI('hp_potion_super', 'red-heart'),
        inputCount: 2, // 500000/350000 = 1.43 -> ceil 2 (craft >= shop buy)
        outputId: 'hp_potion_ultimate', outputName: 'Ultimatywny Eliksir HP', outputIcon: PI('hp_potion_ultimate', 'red-heart'),
        outputMinLevel: 400,
    },
    {
        tier: 6, family: 'hp',
        inputId: 'hp_potion_ultimate', inputName: 'Ultimatywny Eliksir HP', inputIcon: PI('hp_potion_ultimate', 'red-heart'),
        inputCount: 2, // 1000000/500000 = 2.0 -> ceil 2 (craft >= shop buy)
        outputId: 'hp_potion_divine', outputName: 'Boski Eliksir HP', outputIcon: PI('hp_potion_divine', 'red-heart'),
        outputMinLevel: 600,
    },
    // Alternate flat-heal branch: 4× Silny -> 1× Mega (1000 flat HP)
    {
        tier: 7, family: 'hp',
        inputId: 'hp_potion_lg', inputName: 'Silny Eliksir HP', inputIcon: PI('hp_potion_lg', 'red-heart'),
        inputCount: 25, // 15000/600 = 25.0 -> ceil 25 (craft >= shop buy)
        outputId: 'hp_potion_mega', outputName: 'Mega Eliksir HP', outputIcon: PI('hp_potion_mega', 'heart-on-fire'),
        outputMinLevel: 100,
    },
    // -- MP Potions --
    {
        tier: 1, family: 'mp',
        inputId: 'mp_potion_sm', inputName: 'Maly Eliksir MP', inputIcon: PI('mp_potion_sm', 'droplet'),
        inputCount: 5,
        outputId: 'mp_potion_md', outputName: 'Eliksir MP', outputIcon: PI('mp_potion_md', 'droplet'),
        outputMinLevel: 20,
    },
    {
        tier: 2, family: 'mp',
        inputId: 'mp_potion_md', inputName: 'Eliksir MP', inputIcon: PI('mp_potion_md', 'droplet'),
        inputCount: 4,
        outputId: 'mp_potion_lg', outputName: 'Silny Eliksir MP', outputIcon: PI('mp_potion_lg', 'droplet'),
        outputMinLevel: 50,
    },
    {
        tier: 3, family: 'mp',
        inputId: 'mp_potion_lg', inputName: 'Silny Eliksir MP', inputIcon: PI('mp_potion_lg', 'droplet'),
        inputCount: 334, // 200000/600 = 333.33 -> ceil 334 (craft >= shop buy)
        outputId: 'mp_potion_great', outputName: 'Wielki Eliksir MP', outputIcon: PI('mp_potion_great', 'droplet'),
        outputMinLevel: 100,
    },
    {
        tier: 4, family: 'mp',
        inputId: 'mp_potion_great', inputName: 'Wielki Eliksir MP', inputIcon: PI('mp_potion_great', 'droplet'),
        inputCount: 2, // 350000/200000 = 1.75 -> ceil 2 (craft >= shop buy)
        outputId: 'mp_potion_super', outputName: 'Super Eliksir MP', outputIcon: PI('mp_potion_super', 'droplet'),
        outputMinLevel: 200,
    },
    {
        tier: 5, family: 'mp',
        inputId: 'mp_potion_super', inputName: 'Super Eliksir MP', inputIcon: PI('mp_potion_super', 'droplet'),
        inputCount: 2, // 500000/350000 = 1.43 -> ceil 2 (craft >= shop buy)
        outputId: 'mp_potion_ultimate', outputName: 'Ultimatywny Eliksir MP', outputIcon: PI('mp_potion_ultimate', 'droplet'),
        outputMinLevel: 400,
    },
    {
        tier: 6, family: 'mp',
        inputId: 'mp_potion_ultimate', inputName: 'Ultimatywny Eliksir MP', inputIcon: PI('mp_potion_ultimate', 'droplet'),
        inputCount: 2, // 1000000/500000 = 2.0 -> ceil 2 (craft >= shop buy)
        outputId: 'mp_potion_divine', outputName: 'Boski Eliksir MP', outputIcon: PI('mp_potion_divine', 'droplet'),
        outputMinLevel: 600,
    },
    // Alternate flat-heal branch: 4× Silny -> 1× Mega (1000 flat MP)
    {
        tier: 7, family: 'mp',
        inputId: 'mp_potion_lg', inputName: 'Silny Eliksir MP', inputIcon: PI('mp_potion_lg', 'droplet'),
        inputCount: 25, // 15000/600 = 25.0 -> ceil 25 (craft >= shop buy)
        outputId: 'mp_potion_mega', outputName: 'Mega Eliksir MP', outputIcon: PI('mp_potion_mega', 'gem-stone'),
        outputMinLevel: 100,
    },
];

/** Display/order: HP family before MP family. */
const FAMILY_ORDER: Record<IPotionConversion['family'], number> = { hp: 0, mp: 1 };

/**
 * 2026-06-24: alchemy crafting levels are now DERIVED from `getPotionMinLevel`
 * (the same single source the shop buy-gate + drink-gate use), so a player can
 * only ever craft a potion at the exact level they could buy/drink it — no more
 * stale hardcoded alchemy levels drifting from the shop (great 200 / super 350 /
 * ultimate 500 / divine 700 / mega 100, etc.).
 *
 * 2026-06-24: also SORTED for the Alchemia UI — all HP recipes first, then all
 * MP, each ordered by the output potion's unlock level ascending (so mega, L100,
 * now sits right after lg instead of dead-last after divine). `tier` is only a
 * deterministic tiebreak now, not the primary order.
 */
export const POTION_CONVERSIONS: IPotionConversion[] = RAW_POTION_CONVERSIONS
    .map((c) => ({
        ...c,
        outputMinLevel: getPotionMinLevel(c.outputId),
    }))
    .sort((a, b) =>
        FAMILY_ORDER[a.family] - FAMILY_ORDER[b.family]   // HP before MP
        || a.outputMinLevel - b.outputMinLevel             // ascending output level
        || a.tier - b.tier,                                // stable tiebreak
    );

/**
 * How many times can this conversion be performed given current inventory?
 */
export const getMaxConversions = (
    conv: IPotionConversion,
    ownedInput: number,
): number => Math.floor(ownedInput / conv.inputCount);

export interface IConversionAvailability {
    canConvert: boolean;
    maxBatches: number;
    /** True when the character's level is below the output potion's unlock level. */
    levelLocked: boolean;
    /** The character level required to craft the output (single source: potionGating). */
    requiredLevel: number;
}

/**
 * 2026-06-21: alchemy is now level-gated — you cannot craft UP into a potion
 * tier you cannot use yet (spec: "nie mozna ich ... przetworzyc w alchemii z
 * mniejszego na wiekszy jezeli nie mamy tego poziomu"). The required level is
 * read from `potionGating` (the same source the shop buy gate + the
 * `useConsumable` drink gate use), so `conv.outputMinLevel` is no longer
 * authoritative — this helper is.
 *
 * `characterLevel` defaults to Infinity so older callers that don't pass it
 * keep their owned-input-only behaviour, but the Inventory alchemy UI always
 * passes the real level.
 */
export const checkConversionAvailability = (
    conv: IPotionConversion,
    ownedInput: number,
    characterLevel: number = Number.POSITIVE_INFINITY,
): IConversionAvailability => {
    const maxBatches = getMaxConversions(conv, ownedInput);
    const requiredLevel = getPotionMinLevel(conv.outputId);
    const levelLocked = characterLevel < requiredLevel;
    return { canConvert: !levelLocked && maxBatches > 0, maxBatches, levelLocked, requiredLevel };
};
