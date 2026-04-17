import { ELIXIRS, type IElixir } from '../stores/shopStore';

// ── Potion categorization ────────────────────────────────────────────────────

/** IDs of percentage-based HP potions (Great, Super, Ultimate, Divine). */
export const PCT_HP_POTION_IDS = new Set([
  'hp_potion_great',
  'hp_potion_super',
  'hp_potion_ultimate',
  'hp_potion_divine',
]);

/** IDs of percentage-based MP potions (Great, Super, Ultimate, Divine). */
export const PCT_MP_POTION_IDS = new Set([
  'mp_potion_great',
  'mp_potion_super',
  'mp_potion_ultimate',
  'mp_potion_divine',
]);

/** IDs of flat (non-percentage) HP potions (Small, normal, Strong). */
export const FLAT_HP_POTION_IDS = new Set([
  'hp_potion_sm',
  'hp_potion_md',
  'hp_potion_lg',
]);

/** IDs of flat (non-percentage) MP potions (Small, normal, Strong). */
export const FLAT_MP_POTION_IDS = new Set([
  'mp_potion_sm',
  'mp_potion_md',
  'mp_potion_lg',
]);

/** Check if a potion effect is percentage-based. */
export const isPctPotion = (effect: string): boolean =>
  effect.includes('_pct_');

/** Check if a potion ID is a percentage-based potion. */
export const isPctPotionId = (potionId: string): boolean =>
  PCT_HP_POTION_IDS.has(potionId) || PCT_MP_POTION_IDS.has(potionId);

/** Check if a potion ID is a flat (non-percentage) potion. */
export const isFlatPotionId = (potionId: string): boolean =>
  FLAT_HP_POTION_IDS.has(potionId) || FLAT_MP_POTION_IDS.has(potionId);

// ── Cooldown durations ───────────────────────────────────────────────────────

/** Cooldown for flat potions (ms) – 1 second. */
export const FLAT_POTION_COOLDOWN_MS = 1000;

/** Cooldown for percentage-based potions (ms) – 0.5 seconds. */
export const PCT_POTION_COOLDOWN_MS = 500;

/** Get the appropriate cooldown duration for a potion. */
export const getPotionCooldownMs = (potionId: string): number =>
  isPctPotionId(potionId) ? PCT_POTION_COOLDOWN_MS : FLAT_POTION_COOLDOWN_MS;

// ── Potion lists ─────────────────────────────────────────────────────────────

/** All HP potions from ELIXIRS. */
export const ALL_HP_POTIONS: IElixir[] = ELIXIRS.filter((e) => e.effect.startsWith('heal_hp'));

/** All MP potions from ELIXIRS. */
export const ALL_MP_POTIONS: IElixir[] = ELIXIRS.filter((e) => e.effect.startsWith('heal_mp'));

/** Flat HP potions only. */
export const FLAT_HP_POTIONS: IElixir[] = ALL_HP_POTIONS.filter((e) => !isPctPotion(e.effect));

/** Flat MP potions only. */
export const FLAT_MP_POTIONS: IElixir[] = ALL_MP_POTIONS.filter((e) => !isPctPotion(e.effect));

/** Percentage HP potions only. */
export const PCT_HP_POTIONS: IElixir[] = ALL_HP_POTIONS.filter((e) => isPctPotion(e.effect));

/** Percentage MP potions only. */
export const PCT_MP_POTIONS: IElixir[] = ALL_MP_POTIONS.filter((e) => isPctPotion(e.effect));

// ── Display helpers ──────────────────────────────────────────────────────────

/** Extract display label from potion effect string. */
export const getPotionLabel = (effect: string): string => {
  const flatMatch = effect.match(/^heal_(hp|mp)_(\d+)$/);
  if (flatMatch) return `+${flatMatch[2]} ${flatMatch[1].toUpperCase()}`;
  const pctMatch = effect.match(/^heal_(hp|mp)_pct_(\d+)$/);
  if (pctMatch) return `+${pctMatch[2]}% ${pctMatch[1].toUpperCase()}`;
  return effect;
};

/** Find the strongest potion the player owns from a given list. */
export const getBestPotion = (
  potions: IElixir[],
  consumables: Record<string, number>,
): IElixir | null => {
  const reversed = [...potions].reverse();
  return reversed.find((e) => (consumables[e.id] ?? 0) > 0) ?? reversed[0] ?? null;
};

/**
 * Resolve the elixir to use for an auto-potion slot.
 * Prefers the user-configured potion; if count is 0, falls back to the
 * strongest owned potion from the matching pool. Returns null if nothing.
 */
export const resolveAutoPotionElixir = (
  preferredId: string | undefined,
  hpOrMp: 'hp' | 'mp',
  slotKind: 'flat' | 'pct',
  consumables: Record<string, number>,
): IElixir | null => {
  if (preferredId) {
    const preferred = ELIXIRS.find((e) => e.id === preferredId);
    if (preferred && (consumables[preferred.id] ?? 0) > 0) return preferred;
  }
  const pool =
    hpOrMp === 'hp'
      ? (slotKind === 'pct' ? PCT_HP_POTIONS : FLAT_HP_POTIONS)
      : (slotKind === 'pct' ? PCT_MP_POTIONS : FLAT_MP_POTIONS);
  const fallback = [...pool].reverse().find((e) => (consumables[e.id] ?? 0) > 0);
  return fallback ?? null;
};

/** Minimum level required for percentage potions (Great HP/MP = lvl 100). */
export const PCT_POTION_MIN_LEVEL = 100;
