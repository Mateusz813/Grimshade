
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../api/v1/axiosInstance', () => ({
    default: {
        get: vi.fn(),
        post: vi.fn(),
        put: vi.fn(),
        patch: vi.fn(),
        delete: vi.fn(),
    },
}));

import {
    parseSystemMessage,
    formatSystemMessage,
    isUpgradeMilestone,
    type ISystemUpgradePayload,
    type ISystemSkillUpgradePayload,
} from './systemChatMessages';
import { chatApi } from '../api/v1/chatApi';
import api from '../api/v1/axiosInstance';
import { supabase } from '../lib/supabase';

const mockApi = api as unknown as Record<string, any>;
const mkRes = <T>(data: T) => ({ data });


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

    it('round-trips through format -> parse', () => {
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
        expect(parseSystemMessage('[SYS]{"type":"upgrade","itemId":"x","rarity":"common","upgradeLevel":5}')).toBeNull();
        expect(parseSystemMessage('[SYS]{"type":"upgrade","itemId":"x","rarity":"common","upgradeLevel":"5","itemName":"X"}')).toBeNull();
    });

    it('returns null when a skill-upgrade payload is missing required fields', () => {
        expect(parseSystemMessage('[SYS]{"type":"skillUpgrade","skillId":"x","upgradeLevel":10}')).toBeNull();
        expect(parseSystemMessage('[SYS]{"type":"skillUpgrade","skillId":"x","skillName":"X","upgradeLevel":"10"}')).toBeNull();
    });

    it('returns null when the marker is mid-string instead of leading', () => {
        expect(parseSystemMessage('hello [SYS]{"type":"upgrade"}')).toBeNull();
    });
});


describe('Integration › chatApi.postSystemEvent + format + parse (item upgrade)', () => {

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('builds an upgrade event, posts it to channel="system", and parses back the same fields Chat.tsx renders', async () => {
        const payload = {
            type: 'upgrade' as const,
            itemId: 'iron_sword',
            rarity: 'rare',
            upgradeLevel: 10,
            itemName: 'Żelazny Miecz',
        };
        const wire = formatSystemMessage(payload);
        expect(wire.startsWith('[SYS]')).toBe(true);

        vi.mocked(supabase.auth.getSession).mockResolvedValueOnce({
            data: { session: { user: { id: 'u-upgrade-test' } } as any },
            error: null,
        });
        const insertedRow = {
            id: 'sys-msg-1',
            channel: 'system',
            content: wire,
            character_name: 'Hero',
            character_class: 'Knight',
            character_level: 25,
            created_at: '2026-05-26T00:00:00Z',
        };
        mockApi.post.mockResolvedValueOnce(mkRes([insertedRow]));

        const result = await chatApi.postSystemEvent('Hero', 'Knight', 25, wire);

        const [url, body] = mockApi.post.mock.calls[0];
        expect(url).toBe('/rest/v1/messages');
        expect(body.channel).toBe('system');
        expect(body.content).toBe(wire);
        expect(body.character_name).toBe('Hero');
        expect(body.character_class).toBe('Knight');
        expect(body.character_level).toBe(25);

        expect(result).not.toBeNull();
        const parsed = parseSystemMessage(result!.content);
        expect(parsed).not.toBeNull();
        if (!parsed || parsed.type !== 'upgrade') throw new Error('parsed null or wrong type');

        expect(parsed.itemId).toBe('iron_sword');
        expect(parsed.rarity).toBe('rare');
        expect(parsed.upgradeLevel).toBe(10);
        expect(parsed.itemName).toBe('Żelazny Miecz');
    });

    it('round-trip preserves Polish characters in itemName (renderer prints them as <strong> verbatim)', () => {
        const wire = formatSystemMessage({
            type: 'upgrade',
            itemId: 'iron_sword',
            rarity: 'epic',
            upgradeLevel: 11,
            itemName: 'Świetlisty Łuk Łowcy',
        });
        const parsed = parseSystemMessage(wire);
        if (!parsed || parsed.type !== 'upgrade') throw new Error('round-trip failed');
        expect(parsed.itemName).toBe('Świetlisty Łuk Łowcy');
    });
});

describe('Integration › chatApi.postSystemEvent + format + parse (skill upgrade)', () => {

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('builds a skillUpgrade event, posts it, and parses back skillId/skillName/upgradeLevel intact', async () => {
        const payload = {
            type: 'skillUpgrade' as const,
            skillId: 'shield_bash',
            skillName: 'Uderzenie Tarczą',
            upgradeLevel: 10,
        };
        const wire = formatSystemMessage(payload);
        expect(wire.startsWith('[SYS]')).toBe(true);

        vi.mocked(supabase.auth.getSession).mockResolvedValueOnce({
            data: { session: { user: { id: 'u-skill-test' } } as any },
            error: null,
        });
        const insertedRow = {
            id: 'sys-msg-2',
            channel: 'system',
            content: wire,
            character_name: 'Hero',
            character_class: 'Knight',
            character_level: 25,
            created_at: '2026-05-26T00:00:00Z',
        };
        mockApi.post.mockResolvedValueOnce(mkRes([insertedRow]));

        const result = await chatApi.postSystemEvent('Hero', 'Knight', 25, wire);

        const [url, body] = mockApi.post.mock.calls[0];
        expect(url).toBe('/rest/v1/messages');
        expect(body.channel).toBe('system');
        expect(body.content).toBe(wire);

        expect(result).not.toBeNull();
        const parsed = parseSystemMessage(result!.content);
        expect(parsed).not.toBeNull();
        if (!parsed || parsed.type !== 'skillUpgrade') throw new Error('parsed null or wrong type');

        expect(parsed.skillId).toBe('shield_bash');
        expect(parsed.skillName).toBe('Uderzenie Tarczą');
        expect(parsed.upgradeLevel).toBe(10);
    });

    it('round-trip preserves Polish characters in skillName (Chat.tsx prints them verbatim)', () => {
        const wire = formatSystemMessage({
            type: 'skillUpgrade',
            skillId: 'whirlwind',
            skillName: 'Żywiołowy Wir Łaski',
            upgradeLevel: 15,
        });
        const parsed = parseSystemMessage(wire);
        if (!parsed || parsed.type !== 'skillUpgrade') throw new Error('round-trip failed');
        expect(parsed.skillName).toBe('Żywiołowy Wir Łaski');
        expect(parsed.upgradeLevel).toBe(15);
    });

    it('skill payload does NOT round-trip into the upgrade variant (parser branches stay distinct)', () => {
        const skillWire = formatSystemMessage({
            type: 'skillUpgrade',
            skillId: 'shield_bash',
            skillName: 'Uderzenie Tarczą',
            upgradeLevel: 10,
        });
        const parsedAsSkill = parseSystemMessage(skillWire);
        expect(parsedAsSkill?.type).toBe('skillUpgrade');

        const itemWire = formatSystemMessage({
            type: 'upgrade',
            itemId: 'iron_sword',
            rarity: 'rare',
            upgradeLevel: 10,
            itemName: 'Żelazny Miecz',
        });
        const parsedAsItem = parseSystemMessage(itemWire);
        expect(parsedAsItem?.type).toBe('upgrade');
    });
});
