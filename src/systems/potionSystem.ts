import { ELIXIRS, type IElixir } from '../stores/shopStore';
import { canUsePotionAtLevel } from './potionGating';


export const PCT_HP_POTION_IDS = new Set([
  'hp_potion_great',
  'hp_potion_super',
  'hp_potion_ultimate',
  'hp_potion_divine',
]);

export const PCT_MP_POTION_IDS = new Set([
  'mp_potion_great',
  'mp_potion_super',
  'mp_potion_ultimate',
  'mp_potion_divine',
]);

export const FLAT_HP_POTION_IDS = new Set([
  'hp_potion_sm',
  'hp_potion_md',
  'hp_potion_lg',
]);

export const FLAT_MP_POTION_IDS = new Set([
  'mp_potion_sm',
  'mp_potion_md',
  'mp_potion_lg',
]);

export const isPctPotion = (effect: string): boolean =>
  effect.includes('_pct_');

export const isPctPotionId = (potionId: string): boolean =>
  PCT_HP_POTION_IDS.has(potionId) || PCT_MP_POTION_IDS.has(potionId);

export const isFlatPotionId = (potionId: string): boolean =>
  FLAT_HP_POTION_IDS.has(potionId) || FLAT_MP_POTION_IDS.has(potionId);


export const FLAT_POTION_COOLDOWN_MS = 1000;

export const PCT_POTION_COOLDOWN_MS = 500;

export const getPotionCooldownMs = (potionId: string): number =>
  isPctPotionId(potionId) ? PCT_POTION_COOLDOWN_MS : FLAT_POTION_COOLDOWN_MS;


export const ALL_HP_POTIONS: IElixir[] = ELIXIRS.filter((e) => e.effect.startsWith('heal_hp'));

export const ALL_MP_POTIONS: IElixir[] = ELIXIRS.filter((e) => e.effect.startsWith('heal_mp'));

export const FLAT_HP_POTIONS: IElixir[] = ALL_HP_POTIONS.filter((e) => !isPctPotion(e.effect));

export const FLAT_MP_POTIONS: IElixir[] = ALL_MP_POTIONS.filter((e) => !isPctPotion(e.effect));

export const PCT_HP_POTIONS: IElixir[] = ALL_HP_POTIONS.filter((e) => isPctPotion(e.effect));

export const PCT_MP_POTIONS: IElixir[] = ALL_MP_POTIONS.filter((e) => isPctPotion(e.effect));


export const getPotionLabel = (effect: string): string => {
  const flatMatch = effect.match(/^heal_(hp|mp)_(\d+)$/);
  if (flatMatch) return `+${flatMatch[2]} ${flatMatch[1].toUpperCase()}`;
  const pctMatch = effect.match(/^heal_(hp|mp)_pct_(\d+)$/);
  if (pctMatch) return `+${pctMatch[2]}% ${pctMatch[1].toUpperCase()}`;
  return effect;
};

export const getBestPotion = (
  potions: IElixir[],
  consumables: Record<string, number>,
  characterLevel: number = Number.POSITIVE_INFINITY,
): IElixir | null => {
  const reversed = [...potions].reverse();
  return (
    reversed.find((e) => (consumables[e.id] ?? 0) > 0 && canUsePotionAtLevel(e.id, characterLevel))
    ?? reversed.find((e) => canUsePotionAtLevel(e.id, characterLevel))
    ?? null
  );
};

export const resolveAutoPotionElixir = (
  preferredId: string | undefined,
  hpOrMp: 'hp' | 'mp',
  slotKind: 'flat' | 'pct',
  consumables: Record<string, number>,
  characterLevel: number = Number.POSITIVE_INFINITY,
): IElixir | null => {
  if (preferredId) {
    const preferred = ELIXIRS.find((e) => e.id === preferredId);
    if (preferred && (consumables[preferred.id] ?? 0) > 0 && canUsePotionAtLevel(preferred.id, characterLevel)) {
      return preferred;
    }
  }
  const pool =
    hpOrMp === 'hp'
      ? (slotKind === 'pct' ? PCT_HP_POTIONS : FLAT_HP_POTIONS)
      : (slotKind === 'pct' ? PCT_MP_POTIONS : FLAT_MP_POTIONS);
  const fallback = [...pool].reverse().find(
    (e) => (consumables[e.id] ?? 0) > 0 && canUsePotionAtLevel(e.id, characterLevel),
  );
  return fallback ?? null;
};

export const PCT_POTION_MIN_LEVEL = 100;
