
export const GOLD_PER_K = 1_000;
export const GOLD_PER_CC = 100_000;
export const GOLD_PER_SC = 10_000_000;

const formatTwoDecimals = (n: number): string => {
    const truncated = Math.floor(n * 100) / 100;
    return truncated.toFixed(2).replace('.', ',');
};

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

export const getGoldBreakdown = (gold: number): IGoldBreakdown => {
    let remaining = Math.max(0, Math.floor(gold));
    const sc = Math.floor(remaining / GOLD_PER_SC); remaining -= sc * GOLD_PER_SC;
    const cc = Math.floor(remaining / GOLD_PER_CC); remaining -= cc * GOLD_PER_CC;
    const k  = Math.floor(remaining / GOLD_PER_K);  remaining -= k  * GOLD_PER_K;
    return { sc, cc, k, gold: remaining };
};
