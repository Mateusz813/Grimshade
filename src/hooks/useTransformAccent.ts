import { useEffect } from 'react';
import { useCharacterStore } from '../stores/characterStore';
import { useTransformStore } from '../stores/transformStore';

/**
 * Class-fallback colors used when the player has not completed any
 * transformation tier yet. Matches the per-class accents used elsewhere in
 * the UI (Town, Battle, character cards).
 */
const CLASS_COLORS: Record<string, string> = {
  Knight: '#e53935',
  Mage: '#7b1fa2',
  Cleric: '#ffc107',
  Archer: '#4caf50',
  Rogue: '#424242',
  Necromancer: '#795548',
  Bard: '#ff9800',
};

/** Used when neither character nor transform is available (defensive). */
const FALLBACK_HEX = '#e94560';
const FALLBACK_RGB = '233, 69, 96';

const hexToRgb = (hex: string): string => {
  const clean = hex.replace('#', '');
  if (clean.length !== 6) return FALLBACK_RGB;
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `${r}, ${g}, ${b}`;
};

export interface ITransformAccent {
  /** Hex string ready for `color: ...` / `border-color: ...`. */
  accent: string;
  /** Raw `r, g, b` triplet for use inside `rgba(<rgb>, alpha)`. */
  accentRgb: string;
}

/**
 * Returns the player's current accent color, derived from the highest
 * completed transformation tier. Before any transformation is unlocked the
 * accent falls back to the character's class color so the chrome never
 * looks foreign.
 *
 * Used to tint persistent UI chrome (TopHeader chips, BottomNav active
 * state) so the chrome reflects whichever form the character is currently
 * in.
 */
export const useTransformAccent = (): ITransformAccent => {
  const character = useCharacterStore((s) => s.character);
  const getHighestTransformColor = useTransformStore((s) => s.getHighestTransformColor);
  const transformColor = getHighestTransformColor();

  const classColor = character ? (CLASS_COLORS[character.class] ?? FALLBACK_HEX) : FALLBACK_HEX;

  let accent = classColor;
  if (transformColor) {
    if (transformColor.solid) accent = transformColor.solid;
    else if (transformColor.gradient && transformColor.gradient.length > 0) accent = transformColor.gradient[0];
  }

  const accentRgb = hexToRgb(accent);

  // ── Mirror onto :root so global rules (browser scrollbar, body chrome,
  //    anything else outside the TopHeader / BottomNav subtree) can read the
  //    transform accent via `var(--nav-accent)` too. The inline style on
  //    `<header>` cascades DOWN only — without this effect the scrollbar
  //    declared on `html` would always fall back to gold (#ffc107) regardless
  //    of which form the player is in. Both TopHeader and BottomNav call
  //    this hook, so the assignment runs redundantly but the values are
  //    identical so React's commit is a no-op after the first paint.
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--nav-accent', accent);
    root.style.setProperty('--nav-accent-rgb', accentRgb);
  }, [accent, accentRgb]);

  return { accent, accentRgb };
};
