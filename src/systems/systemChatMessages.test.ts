/**
 * Tests for the System-channel chat message codec (parse / format /
 * milestone helper). All three functions are pure — no mocks needed.
 *
 * The wire format is `[SYS]<json>`; both legacy plain-text messages and
 * malformed JSON must round-trip to `null` so the chat renderer falls
 * back to plain text without exploding.
 */

import { describe, it, expect } from 'vitest';
import {
    parseSystemMessage,
    formatSystemMessage,
    isUpgradeMilestone,
    type ISystemUpgradePayload,
    type ISystemSkillUpgradePayload,
} from './systemChatMessages';

// ── isUpgradeMilestone ──────────────────────────────────────────────────────

describe('isUpgradeMilestone', () => {
    it('treats +5 and +7 as the early-tier hype milestones', () => {
        expect(isUpgradeMilestone(5)).toBe(true);
        expect(isUpgradeMilestone(7)).toBe(true);
    });

    it('treats every level from +10 upward as a milestone', () => {
        expect(isUpgradeMilestone(10)).toBe(true);
        expect(isUpgradeMilestone(11)).toBe(true);
        expect(isUpgradeMilestone(12)).toBe(true);
        expect(isUpgradeMilestone(25)).toBe(true);
        expect(isUpgradeMilestone(100)).toBe(true);
        expect(isUpgradeMilestone(999)).toBe(true);
    });

    it('returns false for levels between the early milestones', () => {
        expect(isUpgradeMilestone(1)).toBe(false);
        expect(isUpgradeMilestone(2)).toBe(false);
        expect(isUpgradeMilestone(3)).toBe(false);
        expect(isUpgradeMilestone(4)).toBe(false);
        expect(isUpgradeMilestone(6)).toBe(false);
        expect(isUpgradeMilestone(8)).toBe(false);
        expect(isUpgradeMilestone(9)).toBe(false);
    });

    it('handles non-positive / zero levels gracefully', () => {
        expect(isUpgradeMilestone(0)).toBe(false);
        expect(isUpgradeMilestone(-1)).toBe(false);
        expect(isUpgradeMilestone(-100)).toBe(false);
    });
});

// ── formatSystemMessage ─────────────────────────────────────────────────────

describe('formatSystemMessage', () => {
    it('prefixes the marker and serialises the upgrade payload', () => {
        const payload: ISystemUpgradePayload = {
            type: 'upgrade',
            itemId: 'luk',
            rarity: 'common',
            upgradeLevel: 5,
            itemName: 'Krótki Łuk',
        };
        const out = formatSystemMessage(payload);
        expect(out.startsWith('[SYS]')).toBe(true);
        expect(JSON.parse(out.slice('[SYS]'.length))).toEqual(payload);
    });

    it('serialises the skill-upgrade payload variant', () => {
        const payload: ISystemSkillUpgradePayload = {
            type: 'skillUpgrade',
            skillId: 'power_strike',
            skillName: 'Potężny Cios',
            upgradeLevel: 10,
        };
        const out = formatSystemMessage(payload);
        expect(out.startsWith('[SYS]')).toBe(true);
        expect(JSON.parse(out.slice('[SYS]'.length))).toEqual(payload);
    });

    it('fits well under the 300-char messages.content cap for typical payloads', () => {
        const out = formatSystemMessage({
            type: 'upgrade',
            itemId: 'sword_of_beginnings_lvl5_legendary',
            rarity: 'legendary',
            upgradeLevel: 10,
            itemName: 'Sword of Beginnings (legendary)',
        });
        expect(out.length).toBeLessThan(300);
    });
});

// ── parseSystemMessage ──────────────────────────────────────────────────────

describe('parseSystemMessage', () => {
    it('parses a valid upgrade payload', () => {
        const wire = '[SYS]{"type":"upgrade","itemId":"luk","rarity":"common","upgradeLevel":5,"itemName":"Krótki Łuk"}';
        expect(parseSystemMessage(wire)).toEqual({
            type: 'upgrade',
            itemId: 'luk',
            rarity: 'common',
            upgradeLevel: 5,
            itemName: 'Krótki Łuk',
        });
    });

    it('parses a valid skill-upgrade payload', () => {
        const wire = '[SYS]{"type":"skillUpgrade","skillId":"power_strike","skillName":"Potężny Cios","upgradeLevel":10}';
        expect(parseSystemMessage(wire)).toEqual({
            type: 'skillUpgrade',
            skillId: 'power_strike',
            skillName: 'Potężny Cios',
            upgradeLevel: 10,
        });
    });

    it('round-trips through format → parse', () => {
        const payload: ISystemUpgradePayload = {
            type: 'upgrade',
            itemId: 'iron_sword',
            rarity: 'epic',
            upgradeLevel: 11,
            itemName: 'Iron Sword',
        };
        expect(parseSystemMessage(formatSystemMessage(payload))).toEqual(payload);
    });

    it('returns null for plain-text legacy system messages', () => {
        expect(parseSystemMessage('Player joined the game')).toBeNull();
        expect(parseSystemMessage('Server restarting in 5 minutes')).toBeNull();
    });

    it('returns null for the empty string', () => {
        expect(parseSystemMessage('')).toBeNull();
    });

    it('returns null when the marker is present but body is empty', () => {
        expect(parseSystemMessage('[SYS]')).toBeNull();
        expect(parseSystemMessage('[SYS]   ')).toBeNull();
    });

    it('returns null when the JSON body is malformed', () => {
        expect(parseSystemMessage('[SYS]{not json}')).toBeNull();
        expect(parseSystemMessage('[SYS]{"type":')).toBeNull();
        expect(parseSystemMessage('[SYS]undefined')).toBeNull();
    });

    it('returns null when the type field is unknown', () => {
        expect(parseSystemMessage('[SYS]{"type":"chatMessage"}')).toBeNull();
        expect(parseSystemMessage('[SYS]{"type":"unknown","x":1}')).toBeNull();
    });

    it('returns null when an upgrade payload is missing required fields', () => {
        // missing itemName
        expect(parseSystemMessage('[SYS]{"type":"upgrade","itemId":"x","rarity":"common","upgradeLevel":5}')).toBeNull();
        // upgradeLevel as a string
        expect(parseSystemMessage('[SYS]{"type":"upgrade","itemId":"x","rarity":"common","upgradeLevel":"5","itemName":"X"}')).toBeNull();
    });

    it('returns null when a skill-upgrade payload is missing required fields', () => {
        // missing skillName
        expect(parseSystemMessage('[SYS]{"type":"skillUpgrade","skillId":"x","upgradeLevel":10}')).toBeNull();
        // upgradeLevel as a string
        expect(parseSystemMessage('[SYS]{"type":"skillUpgrade","skillId":"x","skillName":"X","upgradeLevel":"10"}')).toBeNull();
    });

    it('returns null when the marker is mid-string instead of leading', () => {
        expect(parseSystemMessage('hello [SYS]{"type":"upgrade"}')).toBeNull();
    });
});
