
const TIER_MIN_LEVEL: Record<string, number> = {
    sm: 1,
    md: 20,
    lg: 50,
    mega: 100,
    great: 200,
    super: 350,
    ultimate: 500,
    divine: 700,
};

export const isHpMpPotionId = (id: string): boolean =>
    id.startsWith('hp_potion_') || id.startsWith('mp_potion_');

export const getPotionMinLevel = (id: string): number => {
    if (!isHpMpPotionId(id)) return 1;
    const tier = id.slice(id.lastIndexOf('_') + 1);
    return TIER_MIN_LEVEL[tier] ?? 1;
};

export const canUsePotionAtLevel = (id: string, level: number): boolean =>
    level >= getPotionMinLevel(id);
