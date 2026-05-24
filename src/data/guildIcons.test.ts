/**
 * Tests for the guild logo / palette registry.
 *
 * Three exports:
 *   • GUILD_ICONS   — 20-entry array of { id, icon, label }.
 *   • GUILD_COLORS  — 20-entry palette of hex strings.
 *   • getGuildIcon  — id → emoji, falls back to '🏰' (castle) when
 *                     the id isn't registered.
 *
 * We intentionally don't hard-code the emoji glyph for each id (the
 * artwork might be tweaked later) — instead we assert structural
 * invariants and the resolver's lookup + fallback contract.
 */

import { describe, it, expect } from 'vitest';
import { GUILD_ICONS, GUILD_COLORS, getGuildIcon } from './guildIcons';

// ── GUILD_ICONS structural invariants ───────────────────────────────────────

describe('GUILD_ICONS', () => {
    it('ships exactly 20 icons (matches the documented picker grid)', () => {
        expect(GUILD_ICONS).toHaveLength(20);
    });

    it('every entry has id, icon and label as non-empty strings', () => {
        for (const entry of GUILD_ICONS) {
            expect(typeof entry.id).toBe('string');
            expect(entry.id.length).toBeGreaterThan(0);
            expect(typeof entry.icon).toBe('string');
            expect(entry.icon.length).toBeGreaterThan(0);
            expect(typeof entry.label).toBe('string');
            expect(entry.label.length).toBeGreaterThan(0);
        }
    });

    it('ids are unique (no duplicate lookup keys)', () => {
        const ids = GUILD_ICONS.map((g) => g.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('includes the documented canonical ids', () => {
        const ids = GUILD_ICONS.map((g) => g.id);
        // Spot-check a few documented entries from the source file.
        expect(ids).toContain('castle');
        expect(ids).toContain('dragon');
        expect(ids).toContain('skull');
        expect(ids).toContain('phoenix');
    });
});

// ── GUILD_COLORS structural invariants ──────────────────────────────────────

describe('GUILD_COLORS', () => {
    it('ships exactly 20 swatches', () => {
        expect(GUILD_COLORS).toHaveLength(20);
    });

    it('every swatch is a 7-char hex string (#rrggbb)', () => {
        for (const c of GUILD_COLORS) {
            expect(c).toMatch(/^#[0-9a-f]{6}$/i);
        }
    });

    it('swatches are unique (full palette spread)', () => {
        expect(new Set(GUILD_COLORS).size).toBe(GUILD_COLORS.length);
    });
});

// ── getGuildIcon resolver ───────────────────────────────────────────────────

describe('getGuildIcon', () => {
    it('returns the icon glyph for every shipped id', () => {
        for (const entry of GUILD_ICONS) {
            expect(getGuildIcon(entry.id)).toBe(entry.icon);
        }
    });

    it('falls back to the castle (🏰) for an unknown id', () => {
        expect(getGuildIcon('not_a_real_icon_id')).toBe('🏰');
    });

    it('falls back to castle for the empty string', () => {
        expect(getGuildIcon('')).toBe('🏰');
    });

    it("is case-sensitive — 'CASTLE' isn't found, falls back", () => {
        // The lookup uses .find with strict equality, so different casings
        // miss the registry and hit the fallback (which happens to be
        // castle either way — verify by checking a NON-castle id).
        expect(getGuildIcon('DRAGON')).toBe('🏰');
        // The lowercase variant resolves correctly.
        expect(getGuildIcon('dragon')).toBe('🐉');
    });
});
