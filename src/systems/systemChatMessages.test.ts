/**
 * Tests for the System-channel chat message codec (parse / format /
 * milestone helper). The three pure helpers (no mocks needed) are
 * covered by the first describes. The bottom of the file holds
 * integration tests (BACKLOG 6.11 + 12.7) that round-trip the wire
 * format through `chatApi.postSystemEvent` — these mock axiosInstance
 * so no network call fires.
 *
 * The wire format is `[SYS]<json>`; both legacy plain-text messages and
 * malformed JSON must round-trip to `null` so the chat renderer falls
 * back to plain text without exploding.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the axios instance BEFORE importing chatApi — vitest hoists
// `vi.mock` to the top of the file regardless of ordering, but
// declaring the mock above the chatApi import keeps reader intent clear.
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockApi = api as unknown as Record<string, any>;
const mkRes = <T>(data: T) => ({ data });

// -- isUpgradeMilestone ------------------------------------------------------

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

// -- formatSystemMessage -----------------------------------------------------

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

// -- parseSystemMessage ------------------------------------------------------

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

// -- Integration: chatApi.postSystemEvent + format + parse round-trip ---------
//
// The chatApi insert is mocked at axiosInstance level (declared at top
// of file). Each test intercepts the wire body, asserts the encoded
// payload is the canonical `[SYS]{...}` shape, then feeds the SAME wire
// content through `parseSystemMessage` to prove the parser yields a shape
// that Chat.tsx (line 358-417) can render without optional-chain null-prop
// crashes. Mock pattern mirrors `chatApi.test.ts` line 16-24.

describe('Integration › chatApi.postSystemEvent + format + parse (item upgrade)', () => {
    // BACKLOG 6.11 closure. Pin the contract:
    //   formatSystemMessage({ type: 'upgrade', ... })
    //     -> chatApi.postSystemEvent  (wire = `[SYS]{...}` string)
    //     -> DB stores `messages.content`
    //     -> parseSystemMessage(wire) yields ALL fields Chat.tsx renders
    //
    // Why this matters: the E2E spec (`inventory/upgrade/system-chat-message.spec.ts`)
    // seeds the wire content directly via service_role to avoid running
    // the upgrade-roll RNG. That E2E proves the renderer behaviour, but
    // NEVER exercises the FORMAT side. This integration test closes the
    // gap by going through `formatSystemMessage` first.

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('builds an upgrade event, posts it to channel="system", and parses back the same fields Chat.tsx renders', async () => {
        // Step 1 — caller builds the payload (production path: Inventory.tsx line ~1007).
        const payload = {
            type: 'upgrade' as const,
            itemId: 'iron_sword',
            rarity: 'rare',
            upgradeLevel: 10,
            itemName: 'Żelazny Miecz',
        };
        const wire = formatSystemMessage(payload);
        // Belt-and-braces guard — the marker prefix is the contract Chat.tsx
        // anchors on (parseSystemMessage line 82 checks `startsWith(SYS_MARKER)`).
        expect(wire.startsWith('[SYS]')).toBe(true);

        // Step 2 — postSystemEvent inserts via the mocked PostgREST endpoint.
        vi.mocked(supabase.auth.getSession).mockResolvedValueOnce({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            data: { session: { user: { id: 'u-upgrade-test' } } as any },
            error: null,
        });
        const insertedRow = {
            id: 'sys-msg-1',
            channel: 'system',
            content: wire, // <- server echoes the wire content back
            character_name: 'Hero',
            character_class: 'Knight',
            character_level: 25,
            created_at: '2026-05-26T00:00:00Z',
        };
        mockApi.post.mockResolvedValueOnce(mkRes([insertedRow]));

        const result = await chatApi.postSystemEvent('Hero', 'Knight', 25, wire);

        // Step 3 — assertions on the OUTGOING wire payload.
        //   - channel MUST be 'system' (Chat.tsx subscribes per-channel).
        //   - content MUST be the canonical [SYS]{...} string, untouched
        //     by trim/slice (well under 300-char cap).
        const [url, body] = mockApi.post.mock.calls[0];
        expect(url).toBe('/rest/v1/messages');
        expect(body.channel).toBe('system');
        expect(body.content).toBe(wire);
        expect(body.character_name).toBe('Hero');
        expect(body.character_class).toBe('Knight');
        expect(body.character_level).toBe(25);

        // Step 4 — parse the SAME content the server stored. This is the
        // shape Chat.tsx (line 358) sees on read-back via getMessages /
        // Realtime sub.
        expect(result).not.toBeNull();
        const parsed = parseSystemMessage(result!.content);
        expect(parsed).not.toBeNull();
        // narrow to the upgrade variant — TS knows after the type-guard.
        if (!parsed || parsed.type !== 'upgrade') throw new Error('parsed null or wrong type');

        // Step 5 — every field Chat.tsx upgrade branch reads MUST be present.
        // Source: Chat.tsx line 382-416 references sys.itemId / sys.rarity /
        // sys.upgradeLevel / sys.itemName. If any field is missing/typo'd
        // the rarity-tinted span class collapses to `--rarity-undefined`
        // and the strong tags render `undefined`.
        expect(parsed.itemId).toBe('iron_sword');          // -> getItemDisplayInfo(sys.itemId)
        expect(parsed.rarity).toBe('rare');                // -> className `chat__msg-text--rarity-rare`
        expect(parsed.upgradeLevel).toBe(10);              // -> <strong>+{sys.upgradeLevel}</strong>
        expect(parsed.itemName).toBe('Żelazny Miecz');     // -> <strong>{sys.itemName}</strong>
    });

    it('round-trip preserves Polish characters in itemName (renderer prints them as <strong> verbatim)', () => {
        // Guard against future JSON-stringify mishaps (e.g. someone forces
        // ASCII escape). Polish letters in itemName MUST survive the
        // serialize -> parse cycle so Chat.tsx renders `Żelazny Miecz`,
        // not `Żelazny Miecz` or a UTF-mangled string.
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
    // BACKLOG 12.7 closure. Same pattern as 6.11 above, but for the
    // skillUpgrade payload variant. Distinct describe block so a failure
    // in one branch (item vs skill) flags clearly in the report.

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('builds a skillUpgrade event, posts it, and parses back skillId/skillName/upgradeLevel intact', async () => {
        // Step 1 — caller builds the payload (production path: Inventory.tsx line 2185).
        const payload = {
            type: 'skillUpgrade' as const,
            skillId: 'shield_bash',
            skillName: 'Uderzenie Tarczą',
            upgradeLevel: 10,
        };
        const wire = formatSystemMessage(payload);
        expect(wire.startsWith('[SYS]')).toBe(true);

        // Step 2 — post via mocked PostgREST.
        vi.mocked(supabase.auth.getSession).mockResolvedValueOnce({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

        // Step 3 — wire assertions (same shape contract as item upgrade).
        const [url, body] = mockApi.post.mock.calls[0];
        expect(url).toBe('/rest/v1/messages');
        expect(body.channel).toBe('system');
        expect(body.content).toBe(wire);

        // Step 4 — parse the server-stored content back.
        expect(result).not.toBeNull();
        const parsed = parseSystemMessage(result!.content);
        expect(parsed).not.toBeNull();
        if (!parsed || parsed.type !== 'skillUpgrade') throw new Error('parsed null or wrong type');

        // Step 5 — every field Chat.tsx skillUpgrade branch reads
        // (lines 359-381) MUST survive the round-trip:
        //   - sys.skillId -> getSkillIcon(sys.skillId) -> TinyIcon
        //   - sys.skillName -> <strong>{sys.skillName}</strong>
        //   - sys.upgradeLevel -> <strong>+{sys.upgradeLevel}</strong>
        expect(parsed.skillId).toBe('shield_bash');
        expect(parsed.skillName).toBe('Uderzenie Tarczą');
        expect(parsed.upgradeLevel).toBe(10);
    });

    it('round-trip preserves Polish characters in skillName (Chat.tsx prints them verbatim)', () => {
        // Mirror of the item-side Polish-character guard. Skill names
        // come from skills.json and include diacritics extensively.
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
        // Regression guard for Chat.tsx line 358-417: the renderer
        // branches on `sys.type` — `skillUpgrade` MUST NOT silently
        // collapse to `upgrade` (would render the wrong icon: ItemIcon
        // instead of TinyIcon+getSkillIcon) and vice versa.
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
