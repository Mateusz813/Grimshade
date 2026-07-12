import { useEffect } from 'react';
import { useCharacterStore } from '../stores/characterStore';
import { useTransformStore } from '../stores/transformStore';

const CLASS_COLORS: Record<string, string> = {
  Knight: '#e53935',
  Mage: '#7b1fa2',
  Cleric: '#ffc107',
  Archer: '#4caf50',
  Rogue: '#424242',
  Necromancer: '#795548',
  Bard: '#ff9800',
};

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
  accent: string;
  accentRgb: string;
}

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

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--nav-accent', accent);
    root.style.setProperty('--nav-accent-rgb', accentRgb);
  }, [accent, accentRgb]);

  return { accent, accentRgb };
};
