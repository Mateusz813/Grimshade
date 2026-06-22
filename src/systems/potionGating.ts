/**
 * Potion level-gating — single source of truth.
 *
 * Player spec (2026-06-21): HP/MP potions unlock by character level, and you
 * can NEITHER buy, drink, NOR alchemy-craft a potion tier above your level:
 *
 *   tier            HP / MP id suffix    unlock level
 *   ----            -----------------    ------------
 *   50  flat        _sm                  1
 *   150 flat        _md                  20
 *   400 flat        _lg                  50
 *   1000 flat       _mega                100
 *   20%  max        _great               200
 *   35%  max        _super               350
 *   50%  max        _ultimate            500
 *   100% max        _divine              700
 *
 * This module has **zero imports** on purpose: it sits at the bottom of the
 * dependency graph so it can be consumed by `shopStore` (sets each elixir's
 * `minLevel`), `inventoryStore` (hard USE gate in `useConsumable`),
 * `potionConversion` (alchemy craft gate) and `Shop`/UI alike without ever
 * forming an import cycle (shopStore ⇄ inventoryStore ⇄ characterStore).
 */

/** Unlock level keyed by the potion-id tier suffix. */
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

/** True for HP/MP potion ids (`hp_potion_*` / `mp_potion_*`). */
export const isHpMpPotionId = (id: string): boolean =>
    id.startsWith('hp_potion_') || id.startsWith('mp_potion_');

/**
 * Character level required to buy / use / craft this potion. Non-potion ids
 * (buff elixirs, amulets, stat-reset, etc.) and unknown tiers return 1 — they
 * are not level-gated by this system.
 */
export const getPotionMinLevel = (id: string): number => {
    if (!isHpMpPotionId(id)) return 1;
    const tier = id.slice(id.lastIndexOf('_') + 1); // 'hp_potion_mega' -> 'mega'
    return TIER_MIN_LEVEL[tier] ?? 1;
};

/** Can a character of `level` use (drink / buy / craft) this potion? */
export const canUsePotionAtLevel = (id: string, level: number): boolean =>
    level >= getPotionMinLevel(id);
