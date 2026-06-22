import { getPotionImage } from './spriteAssets';
import { getPotionMinLevel } from './potionGating';

// Tiny helper — resolve a potion ID's PNG art with an emoji fallback.
const PI = (id: string, fallback: string): string => getPotionImage(id) ?? fallback;

/**
 * Potion conversion (Alchemy).
 *
 * Players can combine weaker potions into stronger ones for FREE (no gold).
 * Conversion ratios are based on shop prices so that the total value of
 * consumed potions roughly matches the shop price of the output:
 *
 *   5× hp_potion_sm      (5×30  = 150g)  -> 1× hp_potion_md      (shop 150g)
 *   4× hp_potion_md      (4×150 = 600g)  -> 1× hp_potion_lg      (shop 600g)
 *   4× hp_potion_lg      (4×600 = 2400g) -> 1× hp_potion_great   (shop 2000g)
 *   4× hp_potion_great   (4×2k  = 8000g) -> 1× hp_potion_super   (shop 7500g)
 *   4× hp_potion_super   (4×7.5k= 30kg)  -> 1× hp_potion_ultimate(shop 30000g)
 *   5× hp_potion_ultimate(5×30k = 150kg) -> 1× hp_potion_divine  (shop 150000g)
 *
 * Alternate flat branch (parallel to the pct branch from tier 3 onward):
 *   4× hp_potion_lg      (4×600 = 2400g) -> 1× hp_potion_mega    (Mega, +1000 flat HP)
 *
 * Same ratios for MP potions.
 * Supports mass conversion (convert N batches at once).
 */

export interface IPotionConversion {
    /** Tier index (1..6), used for UI ordering. */
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

export const POTION_CONVERSIONS: IPotionConversion[] = [
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
        inputCount: 4,
        outputId: 'hp_potion_great', outputName: 'Wielki Eliksir HP', outputIcon: PI('hp_potion_great', 'red-heart'),
        outputMinLevel: 100,
    },
    {
        tier: 4, family: 'hp',
        inputId: 'hp_potion_great', inputName: 'Wielki Eliksir HP', inputIcon: PI('hp_potion_great', 'red-heart'),
        inputCount: 4,
        outputId: 'hp_potion_super', outputName: 'Super Eliksir HP', outputIcon: PI('hp_potion_super', 'red-heart'),
        outputMinLevel: 200,
    },
    {
        tier: 5, family: 'hp',
        inputId: 'hp_potion_super', inputName: 'Super Eliksir HP', inputIcon: PI('hp_potion_super', 'red-heart'),
        inputCount: 4,
        outputId: 'hp_potion_ultimate', outputName: 'Ultimatywny Eliksir HP', outputIcon: PI('hp_potion_ultimate', 'red-heart'),
        outputMinLevel: 400,
    },
    {
        tier: 6, family: 'hp',
        inputId: 'hp_potion_ultimate', inputName: 'Ultimatywny Eliksir HP', inputIcon: PI('hp_potion_ultimate', 'red-heart'),
        inputCount: 5,
        outputId: 'hp_potion_divine', outputName: 'Boski Eliksir HP', outputIcon: PI('hp_potion_divine', 'red-heart'),
        outputMinLevel: 600,
    },
    // Alternate flat-heal branch: 4× Silny -> 1× Mega (1000 flat HP)
    {
        tier: 7, family: 'hp',
        inputId: 'hp_potion_lg', inputName: 'Silny Eliksir HP', inputIcon: PI('hp_potion_lg', 'red-heart'),
        inputCount: 4,
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
        inputCount: 4,
        outputId: 'mp_potion_great', outputName: 'Wielki Eliksir MP', outputIcon: PI('mp_potion_great', 'droplet'),
        outputMinLevel: 100,
    },
    {
        tier: 4, family: 'mp',
        inputId: 'mp_potion_great', inputName: 'Wielki Eliksir MP', inputIcon: PI('mp_potion_great', 'droplet'),
        inputCount: 4,
        outputId: 'mp_potion_super', outputName: 'Super Eliksir MP', outputIcon: PI('mp_potion_super', 'droplet'),
        outputMinLevel: 200,
    },
    {
        tier: 5, family: 'mp',
        inputId: 'mp_potion_super', inputName: 'Super Eliksir MP', inputIcon: PI('mp_potion_super', 'droplet'),
        inputCount: 4,
        outputId: 'mp_potion_ultimate', outputName: 'Ultimatywny Eliksir MP', outputIcon: PI('mp_potion_ultimate', 'droplet'),
        outputMinLevel: 400,
    },
    {
        tier: 6, family: 'mp',
        inputId: 'mp_potion_ultimate', inputName: 'Ultimatywny Eliksir MP', inputIcon: PI('mp_potion_ultimate', 'droplet'),
        inputCount: 5,
        outputId: 'mp_potion_divine', outputName: 'Boski Eliksir MP', outputIcon: PI('mp_potion_divine', 'droplet'),
        outputMinLevel: 600,
    },
    // Alternate flat-heal branch: 4× Silny -> 1× Mega (1000 flat MP)
    {
        tier: 7, family: 'mp',
        inputId: 'mp_potion_lg', inputName: 'Silny Eliksir MP', inputIcon: PI('mp_potion_lg', 'droplet'),
        inputCount: 4,
        outputId: 'mp_potion_mega', outputName: 'Mega Eliksir MP', outputIcon: PI('mp_potion_mega', 'gem-stone'),
        outputMinLevel: 100,
    },
];

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
