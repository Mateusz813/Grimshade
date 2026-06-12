import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useTransformAccent } from './useTransformAccent';
import { useCharacterStore } from '../stores/characterStore';
import { useTransformStore } from '../stores/transformStore';
import type { ICharacter, CharacterClass } from '../api/v1/characterApi';

/**
 * useTransformAccent picks the dominant accent color shown in the
 * top-header and bottom-nav chrome. Resolution order:
 *
 *   1. If a transform with `solid` is unlocked -> use solid hex.
 *   2. Else if a transform with `gradient` is unlocked -> use gradient[0].
 *   3. Else -> class-specific fallback color (Knight=red, Mage=purple…).
 *   4. Else (no character at all) -> hardcoded FALLBACK_HEX (#e94560).
 *
 * The hook also mirrors the resolved values onto `:root` CSS vars
 * (--nav-accent / --nav-accent-rgb) for global rules like the scrollbar.
 */

const makeCharacter = (cls: CharacterClass): ICharacter => ({
    id: 'me-1',
    user_id: 'user-1',
    name: 'Hero',
    class: cls,
    level: 1,
    xp: 0,
    xp_to_next: 100,
    hp: 100,
    max_hp: 100,
    mp: 30,
    max_mp: 30,
    hp_regen: 0,
    mp_regen: 0,
    attack: 10,
    defense: 5,
    attack_speed: 2,
    crit_chance: 5,
    crit_damage: 200,
    magic_level: 0,
    stat_points: 0,
    gold: 0,
} as unknown as ICharacter);

beforeEach(() => {
    useCharacterStore.setState({ character: null });
    // Default: no transform color.
    vi.spyOn(useTransformStore.getState(), 'getHighestTransformColor').mockReturnValue(null);
    // Wipe whatever CSS the previous test bled onto :root.
    document.documentElement.style.removeProperty('--nav-accent');
    document.documentElement.style.removeProperty('--nav-accent-rgb');
});

describe('useTransformAccent — class fallbacks', () => {
    it('falls back to Knight red when no transform completed', () => {
        useCharacterStore.setState({ character: makeCharacter('Knight') });
        const { result } = renderHook(() => useTransformAccent());
        expect(result.current.accent).toBe('#e53935');
        // hexToRgb('#e53935') => '229, 57, 53'
        expect(result.current.accentRgb).toBe('229, 57, 53');
    });

    it('uses Mage purple', () => {
        useCharacterStore.setState({ character: makeCharacter('Mage') });
        const { result } = renderHook(() => useTransformAccent());
        expect(result.current.accent).toBe('#7b1fa2');
    });

    it('uses Cleric gold', () => {
        useCharacterStore.setState({ character: makeCharacter('Cleric') });
        const { result } = renderHook(() => useTransformAccent());
        expect(result.current.accent).toBe('#ffc107');
    });

    it('uses Archer green', () => {
        useCharacterStore.setState({ character: makeCharacter('Archer') });
        const { result } = renderHook(() => useTransformAccent());
        expect(result.current.accent).toBe('#4caf50');
    });

    it('uses Rogue dark gray', () => {
        useCharacterStore.setState({ character: makeCharacter('Rogue') });
        const { result } = renderHook(() => useTransformAccent());
        expect(result.current.accent).toBe('#424242');
    });

    it('uses Necromancer brown', () => {
        useCharacterStore.setState({ character: makeCharacter('Necromancer') });
        const { result } = renderHook(() => useTransformAccent());
        expect(result.current.accent).toBe('#795548');
    });

    it('uses Bard orange', () => {
        useCharacterStore.setState({ character: makeCharacter('Bard') });
        const { result } = renderHook(() => useTransformAccent());
        expect(result.current.accent).toBe('#ff9800');
    });
});

describe('useTransformAccent — defensive fallback', () => {
    it('returns the hardcoded fallback when there is no character', () => {
        useCharacterStore.setState({ character: null });
        const { result } = renderHook(() => useTransformAccent());
        expect(result.current.accent).toBe('#e94560');
        expect(result.current.accentRgb).toBe('233, 69, 96');
    });

    it('returns the hardcoded fallback for an unknown class string', () => {
        // Class is typed CharacterClass at the source, but defensively the
        // hook resolves via Record lookup — pass an unknown string to
        // ensure it doesn't crash and uses FALLBACK_HEX.
        useCharacterStore.setState({
            character: { ...makeCharacter('Knight'), class: 'NotAClass' as unknown as CharacterClass },
        });
        const { result } = renderHook(() => useTransformAccent());
        expect(result.current.accent).toBe('#e94560');
    });
});

describe('useTransformAccent — transform color overrides class color', () => {
    it('uses the transform `solid` value when available', () => {
        useCharacterStore.setState({ character: makeCharacter('Knight') });
        vi.spyOn(useTransformStore.getState(), 'getHighestTransformColor').mockReturnValue({
            solid: '#00aaff',
            gradient: null,
            css: '#00aaff',
        });
        const { result } = renderHook(() => useTransformAccent());
        expect(result.current.accent).toBe('#00aaff');
    });

    it('uses gradient[0] when no solid is provided', () => {
        useCharacterStore.setState({ character: makeCharacter('Knight') });
        vi.spyOn(useTransformStore.getState(), 'getHighestTransformColor').mockReturnValue({
            solid: null,
            gradient: ['#ff00ff', '#00ff00'],
            css: 'linear-gradient(...)',
        });
        const { result } = renderHook(() => useTransformAccent());
        expect(result.current.accent).toBe('#ff00ff');
    });

    it('falls back to class color when transform returns an empty gradient', () => {
        useCharacterStore.setState({ character: makeCharacter('Knight') });
        vi.spyOn(useTransformStore.getState(), 'getHighestTransformColor').mockReturnValue({
            solid: null,
            gradient: null,
            css: '',
        });
        const { result } = renderHook(() => useTransformAccent());
        // No solid, no gradient -> Knight class color.
        expect(result.current.accent).toBe('#e53935');
    });
});

describe('useTransformAccent — :root CSS variables', () => {
    it('writes --nav-accent and --nav-accent-rgb on the document root', () => {
        useCharacterStore.setState({ character: makeCharacter('Mage') });
        renderHook(() => useTransformAccent());
        expect(document.documentElement.style.getPropertyValue('--nav-accent')).toBe('#7b1fa2');
        expect(document.documentElement.style.getPropertyValue('--nav-accent-rgb')).toBe('123, 31, 162');
    });

    it('updates the CSS vars when the character class changes', () => {
        useCharacterStore.setState({ character: makeCharacter('Knight') });
        const { rerender } = renderHook(() => useTransformAccent());
        expect(document.documentElement.style.getPropertyValue('--nav-accent')).toBe('#e53935');
        useCharacterStore.setState({ character: makeCharacter('Archer') });
        rerender();
        expect(document.documentElement.style.getPropertyValue('--nav-accent')).toBe('#4caf50');
    });
});

describe('useTransformAccent — hexToRgb conversion', () => {
    it('handles a malformed hex by returning the FALLBACK_RGB triplet', () => {
        // If a transform somehow returns a non-6-char hex, the conversion
        // falls back to the hardcoded RGB instead of throwing.
        useCharacterStore.setState({ character: makeCharacter('Knight') });
        vi.spyOn(useTransformStore.getState(), 'getHighestTransformColor').mockReturnValue({
            solid: '#abc', // 3-char shorthand — hook's parser only accepts 6.
            gradient: null,
            css: '#abc',
        });
        const { result } = renderHook(() => useTransformAccent());
        expect(result.current.accent).toBe('#abc');
        expect(result.current.accentRgb).toBe('233, 69, 96'); // FALLBACK_RGB
    });
});
