/**
 * Potion conversion (Alchemy).
 *
 * Players can combine weaker potions into stronger ones for FREE (no gold).
 * Conversion ratios are based on shop prices so that the total value of
 * consumed potions roughly matches the shop price of the output:
 *
 *   5× hp_potion_sm      (5×30  = 150g)  → 1× hp_potion_md      (shop 150g)
 *   4× hp_potion_md      (4×150 = 600g)  → 1× hp_potion_lg      (shop 600g)
 *   4× hp_potion_lg      (4×600 = 2400g) → 1× hp_potion_great   (shop 2000g)
 *   4× hp_potion_great   (4×2k  = 8000g) → 1× hp_potion_super   (shop 7500g)
 *   4× hp_potion_super   (4×7.5k= 30kg)  → 1× hp_potion_ultimate(shop 30000g)
 *   5× hp_potion_ultimate(5×30k = 150kg) → 1× hp_potion_divine  (shop 150000g)
 *
 * Alternate flat branch (parallel to the pct branch from tier 3 onward):
 *   4× hp_potion_lg      (4×600 = 2400g) → 1× hp_potion_mega    (Mega, +1000 flat HP)
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
    // ── HP Potions ──
    {
        tier: 1, family: 'hp',
        inputId: 'hp_potion_sm', inputName: 'Maly Eliksir HP', inputIcon: '❤️',
        inputCount: 5,
        outputId: 'hp_potion_md', outputName: 'Eliksir HP', outputIcon: '❤️',
        outputMinLevel: 20,
    },
    {
        tier: 2, family: 'hp',
        inputId: 'hp_potion_md', inputName: 'Eliksir HP', inputIcon: '❤️',
        inputCount: 4,
        outputId: 'hp_potion_lg', outputName: 'Silny Eliksir HP', outputIcon: '❤️',
        outputMinLevel: 50,
    },
    {
        tier: 3, family: 'hp',
        inputId: 'hp_potion_lg', inputName: 'Silny Eliksir HP', inputIcon: '❤️',
        inputCount: 4,
        outputId: 'hp_potion_great', outputName: 'Wielki Eliksir HP', outputIcon: '❤️',
        outputMinLevel: 100,
    },
    {
        tier: 4, family: 'hp',
        inputId: 'hp_potion_great', inputName: 'Wielki Eliksir HP', inputIcon: '❤️',
        inputCount: 4,
        outputId: 'hp_potion_super', outputName: 'Super Eliksir HP', outputIcon: '❤️',
        outputMinLevel: 200,
    },
    {
        tier: 5, family: 'hp',
        inputId: 'hp_potion_super', inputName: 'Super Eliksir HP', inputIcon: '❤️',
        inputCount: 4,
        outputId: 'hp_potion_ultimate', outputName: 'Ultimatywny Eliksir HP', outputIcon: '❤️',
        outputMinLevel: 400,
    },
    {
        tier: 6, family: 'hp',
        inputId: 'hp_potion_ultimate', inputName: 'Ultimatywny Eliksir HP', inputIcon: '❤️',
        inputCount: 5,
        outputId: 'hp_potion_divine', outputName: 'Boski Eliksir HP', outputIcon: '❤️',
        outputMinLevel: 600,
    },
    // Alternate flat-heal branch: 4× Silny → 1× Mega (1000 flat HP)
    {
        tier: 7, family: 'hp',
        inputId: 'hp_potion_lg', inputName: 'Silny Eliksir HP', inputIcon: '❤️',
        inputCount: 4,
        outputId: 'hp_potion_mega', outputName: 'Mega Eliksir HP', outputIcon: '❤️‍🔥',
        outputMinLevel: 100,
    },
    // ── MP Potions ──
    {
        tier: 1, family: 'mp',
        inputId: 'mp_potion_sm', inputName: 'Maly Eliksir MP', inputIcon: '💧',
        inputCount: 5,
        outputId: 'mp_potion_md', outputName: 'Eliksir MP', outputIcon: '💧',
        outputMinLevel: 20,
    },
    {
        tier: 2, family: 'mp',
        inputId: 'mp_potion_md', inputName: 'Eliksir MP', inputIcon: '💧',
        inputCount: 4,
        outputId: 'mp_potion_lg', outputName: 'Silny Eliksir MP', outputIcon: '💧',
        outputMinLevel: 50,
    },
    {
        tier: 3, family: 'mp',
        inputId: 'mp_potion_lg', inputName: 'Silny Eliksir MP', inputIcon: '💧',
        inputCount: 4,
        outputId: 'mp_potion_great', outputName: 'Wielki Eliksir MP', outputIcon: '💧',
        outputMinLevel: 100,
    },
    {
        tier: 4, family: 'mp',
        inputId: 'mp_potion_great', inputName: 'Wielki Eliksir MP', inputIcon: '💧',
        inputCount: 4,
        outputId: 'mp_potion_super', outputName: 'Super Eliksir MP', outputIcon: '💧',
        outputMinLevel: 200,
    },
    {
        tier: 5, family: 'mp',
        inputId: 'mp_potion_super', inputName: 'Super Eliksir MP', inputIcon: '💧',
        inputCount: 4,
        outputId: 'mp_potion_ultimate', outputName: 'Ultimatywny Eliksir MP', outputIcon: '💧',
        outputMinLevel: 400,
    },
    {
        tier: 6, family: 'mp',
        inputId: 'mp_potion_ultimate', inputName: 'Ultimatywny Eliksir MP', inputIcon: '💧',
        inputCount: 5,
        outputId: 'mp_potion_divine', outputName: 'Boski Eliksir MP', outputIcon: '💧',
        outputMinLevel: 600,
    },
    // Alternate flat-heal branch: 4× Silny → 1× Mega (1000 flat MP)
    {
        tier: 7, family: 'mp',
        inputId: 'mp_potion_lg', inputName: 'Silny Eliksir MP', inputIcon: '💧',
        inputCount: 4,
        outputId: 'mp_potion_mega', outputName: 'Mega Eliksir MP', outputIcon: '💎',
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
}

export const checkConversionAvailability = (
    conv: IPotionConversion,
    ownedInput: number,
): IConversionAvailability => {
    const maxBatches = getMaxConversions(conv, ownedInput);
    return { canConvert: maxBatches > 0, maxBatches };
};
