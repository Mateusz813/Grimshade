/**
 * Gold display formatter.
 *
 * Currency tiers (each unit = 100 of the previous):
 *   gp        : 0 – 999          -> "0 gp" – "999 gp"
 *   k         : 1 000 – 99 999    -> "1,00 k" – "99,99 k"        (1k    = 1 000 gp)
 *   cc        : 100 000 – 9 999 999 -> "1,00 cc" – "99,99 cc"     (1cc   = 100 000 gp)
 *   sc        : 10 000 000+        -> "1,00 sc" – "Nsc"          (1sc   = 10 000 000 gp)
 *
 * The compact form ALWAYS shows just the highest non-zero tier with two
 * decimal places (Polish comma separator). So 5 138 755 gold reads as
 * "51,38 cc", and 1 sc + 500 gold reads as "1,00 sc" — the player can pop
 * the breakdown for the exact split (sc / cc / k / gold).
 *
 * Decimals are TRUNCATED, not rounded — we never want to display a value
 * that exceeds what the player actually has (rounding 51.387 -> 51.39 cc
 * would show 0.003 cc more than they own).
 */

export const GOLD_PER_K = 1_000;
export const GOLD_PER_CC = 100_000;       // 100 × k
export const GOLD_PER_SC = 10_000_000;    // 100 × cc

/** Truncate to 2 decimals and format with a Polish comma separator. */
const formatTwoDecimals = (n: number): string => {
    const truncated = Math.floor(n * 100) / 100;
    return truncated.toFixed(2).replace('.', ',');
};

/** Compact display: highest tier only, 2 decimal places, Polish comma. */
export const formatGoldShort = (gold: number): string => {
    const g = Math.max(0, Math.floor(gold));
    if (g >= GOLD_PER_SC) return `${formatTwoDecimals(g / GOLD_PER_SC)} sc`;
    if (g >= GOLD_PER_CC) return `${formatTwoDecimals(g / GOLD_PER_CC)} cc`;
    if (g >= GOLD_PER_K) return `${formatTwoDecimals(g / GOLD_PER_K)} k`;
    return `${g} gp`;
};

export interface IGoldBreakdown {
    sc: number;
    cc: number;
    k: number;
    gold: number;
}

/** Decompose a raw gold amount into the four tiers (each tier 0-99 except sc). */
export const getGoldBreakdown = (gold: number): IGoldBreakdown => {
    let remaining = Math.max(0, Math.floor(gold));
    const sc = Math.floor(remaining / GOLD_PER_SC); remaining -= sc * GOLD_PER_SC;
    const cc = Math.floor(remaining / GOLD_PER_CC); remaining -= cc * GOLD_PER_CC;
    const k  = Math.floor(remaining / GOLD_PER_K);  remaining -= k  * GOLD_PER_K;
    return { sc, cc, k, gold: remaining };
};
