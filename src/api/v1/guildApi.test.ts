/**
 * Tests for guildApi — guild CRUD + roster + boss state + treasury.
 *
 * guildApi uses a hybrid pattern: read paths go through BaseApi
 * (PostgREST URLs), while writes / inserts / RPC-like calls use
 * `supabase.from(...)` chains directly. We mock both layers.
 *
 * What this file covers:
 * - buildGuildChannel: pure helper.
 * - listGuilds: URL building with pagination + search.
 * - countGuilds: supabase head/count.
 * - findGuildById / findGuildForCharacter: read paths.
 * - createGuild: insert guild then auto-add leader as member; rollback
 *   on member-insert failure.
 * - leaveGuild: dissolve on leader-leave-with-no-members, transfer on
 *   leader-leave-with-members, normal leave for non-leaders.
 * - kickMember / updateMemberStats / updateGuildLevelXp.
 * - Join requests: requestJoin / listRequests / deleteRequest / accept.
 * - Boss: fetchOrCreateWeeklyBoss / claim / release / applyDamage /
 *   list attempts / log attempt / contributions.
 * - Treasury: list / deposit / withdraw / logs.
 *
 * The supabase mock uses the same chainable structure as the global
 * setup file but lets us inject results per-call.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('./axiosInstance', () => ({
    default: {
        get: vi.fn(),
        post: vi.fn(),
        put: vi.fn(),
        patch: vi.fn(),
        delete: vi.fn(),
    },
}));

import api from './axiosInstance';
import { supabase } from '../../lib/supabase';
import { guildApi, buildGuildChannel } from './guildApi';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockApi = api as unknown as Record<string, any>;
const mkRes = <T>(data: T) => ({ data });

/** Per-call supabase.from chain mock. */
const buildChain = (result: { data: unknown; error: unknown; count?: number }) => {
    const chain: Record<string, unknown> = {};
    const methods = ['select', 'insert', 'update', 'delete', 'eq', 'in', 'is', 'ilike', 'order', 'limit'];
    for (const m of methods) chain[m] = vi.fn(() => chain);
    chain.single = vi.fn().mockResolvedValue(result);
    chain.maybeSingle = vi.fn().mockResolvedValue(result);
    chain.then = (resolve: (v: unknown) => unknown) => resolve(result);
    return chain as Record<string, ReturnType<typeof vi.fn> | ((..._: unknown[]) => unknown)> & {
        single: ReturnType<typeof vi.fn>;
        maybeSingle: ReturnType<typeof vi.fn>;
    };
};

beforeEach(() => {
    vi.clearAllMocks();
});

// ── Helpers ────────────────────────────────────────────────────────────────

describe('buildGuildChannel', () => {
    it('builds a per-guild realtime channel name', () => {
        expect(buildGuildChannel('g1')).toBe('guild-g1');
    });
});

// ── List / lookup ─────────────────────────────────────────────────────────

describe('guildApi.listGuilds', () => {
    it('builds URL with offset, limit, order, and select=*', async () => {
        mockApi.get.mockResolvedValueOnce(mkRes([]));
        await guildApi.listGuilds({ offset: 20, limit: 5 });
        const url = mockApi.get.mock.calls[0][0] as string;
        expect(url).toContain('/rest/v1/guilds?');
        expect(url).toContain('select=*');
        expect(url).toContain('offset=20');
        expect(url).toContain('limit=5');
        expect(url).toContain('order=level.desc%2Cname.asc');
    });

    it('applies ilike search when search string provided', async () => {
        mockApi.get.mockResolvedValueOnce(mkRes([]));
        await guildApi.listGuilds({ search: 'dragon' });
        const url = mockApi.get.mock.calls[0][0] as string;
        expect(decodeURIComponent(url)).toContain('name=ilike.*dragon*');
    });

    it('strips %, _, and * from search to prevent injection', async () => {
        mockApi.get.mockResolvedValueOnce(mkRes([]));
        await guildApi.listGuilds({ search: 'drag%on_*' });
        const url = decodeURIComponent(mockApi.get.mock.calls[0][0] as string);
        expect(url).toContain('name=ilike.*dragon*');
    });

    it('uses defaults when offset/limit/search not provided', async () => {
        mockApi.get.mockResolvedValueOnce(mkRes([]));
        await guildApi.listGuilds({});
        const url = mockApi.get.mock.calls[0][0] as string;
        expect(url).toContain('offset=0');
        expect(url).toContain('limit=10');
        // No name= when search empty
        expect(url).not.toContain('name=ilike');
    });
});

describe('guildApi.countGuilds', () => {
    it('uses supabase head count', async () => {
        const chain = buildChain({ data: null, error: null, count: 42 });
        // The query is built with `select(..., { count, head })` returning
        // the chain. The final `await query` resolves to {count: 42}.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (chain.select as any).mockReturnValue({
            then: (resolve: (v: unknown) => unknown) => resolve({ count: 42 }),
            ilike: vi.fn().mockReturnValue({
                then: (resolve: (v: unknown) => unknown) => resolve({ count: 42 }),
            }),
        });
        vi.mocked(supabase.from).mockReturnValueOnce(chain as never);
        const result = await guildApi.countGuilds();
        expect(result).toBe(42);
    });

    it('returns 0 when count is null', async () => {
        const chain = buildChain({ data: null, error: null });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (chain.select as any).mockReturnValue({
            then: (resolve: (v: unknown) => unknown) => resolve({ count: null }),
            ilike: vi.fn(),
        });
        vi.mocked(supabase.from).mockReturnValueOnce(chain as never);
        const result = await guildApi.countGuilds();
        expect(result).toBe(0);
    });
});

describe('guildApi.findGuildById', () => {
    it('returns the first matching guild', async () => {
        const row = { id: 'g1', name: 'Dragons' };
        mockApi.get.mockResolvedValueOnce(mkRes([row]));
        const result = await guildApi.findGuildById('g1');
        const url = mockApi.get.mock.calls[0][0] as string;
        expect(url).toContain('id=eq.g1');
        expect(url).toContain('limit=1');
        expect(result).toEqual(row);
    });

    it('returns null when no guild found', async () => {
        mockApi.get.mockResolvedValueOnce(mkRes([]));
        const result = await guildApi.findGuildById('missing');
        expect(result).toBeNull();
    });
});

describe('guildApi.findGuildForCharacter', () => {
    it('returns the guild + membership when character is in one', async () => {
        const membership = { id: 'm1', guild_id: 'g1', character_id: 'c1' };
        const guild = { id: 'g1', name: 'Dragons' };
        mockApi.get
            .mockResolvedValueOnce(mkRes([membership]))
            .mockResolvedValueOnce(mkRes([guild]));
        const result = await guildApi.findGuildForCharacter('c1');
        expect(result).toEqual({ guild, membership });
    });

    it('returns null when character has no membership', async () => {
        mockApi.get.mockResolvedValueOnce(mkRes([]));
        const result = await guildApi.findGuildForCharacter('c1');
        expect(result).toBeNull();
    });

    it('returns null when membership exists but guild row is missing', async () => {
        mockApi.get
            .mockResolvedValueOnce(mkRes([{ guild_id: 'g-vanished' }]))
            .mockResolvedValueOnce(mkRes([])); // guild gone
        const result = await guildApi.findGuildForCharacter('c1');
        expect(result).toBeNull();
    });
});

describe('guildApi.listGuildSummaries', () => {
    it('returns empty object for empty input', async () => {
        const result = await guildApi.listGuildSummaries([]);
        expect(result).toEqual({});
        expect(mockApi.get).not.toHaveBeenCalled();
    });

    it('counts members per guild and pairs leader id → name', async () => {
        // 2 members in g1 (one is leader), 1 in g2.
        mockApi.get
            .mockResolvedValueOnce(mkRes([
                { guild_id: 'g1', character_id: 'c1', character_name: 'Alice' },
                { guild_id: 'g1', character_id: 'c2', character_name: 'Bob' },
                { guild_id: 'g2', character_id: 'c3', character_name: 'Cara' },
            ]))
            .mockResolvedValueOnce(mkRes([
                { id: 'g1', leader_id: 'c1' },
                { id: 'g2', leader_id: 'c3' },
            ]));

        const result = await guildApi.listGuildSummaries(['g1', 'g2']);

        expect(result.g1).toEqual({ memberCount: 2, leaderName: 'Alice' });
        expect(result.g2).toEqual({ memberCount: 1, leaderName: 'Cara' });
    });
});

// ── Create / leave / kick ─────────────────────────────────────────────────

describe('guildApi.createGuild', () => {
    it('inserts the guild then adds the founder as first member', async () => {
        const insertedGuild = { id: 'g1', name: 'Dragons', tag: 'DRG', leader_id: 'c1' };
        const guildChain = buildChain({ data: insertedGuild, error: null });
        const memberChain = buildChain({ data: null, error: null });
        vi.mocked(supabase.from)
            .mockReturnValueOnce(guildChain as never)
            .mockReturnValueOnce(memberChain as never);

        const result = await guildApi.createGuild({
            name: 'Dragons',
            tag: 'drg',
            logo: '',
            color: '#000',
            leaderId: 'c1',
            leaderName: 'Alice',
            leaderClass: 'Knight',
            leaderLevel: 10,
            leaderTransformTier: 2,
        });

        // First insert: guild row with uppercase tag.
        const guildPayload = vi.mocked(guildChain.insert).mock.calls[0][0];
        expect(guildPayload).toMatchObject({
            name: 'Dragons',
            tag: 'DRG',
            leader_id: 'c1',
        });
        // Second insert: leader member row with transform tier.
        const memberPayload = vi.mocked(memberChain.insert).mock.calls[0][0];
        expect(memberPayload).toMatchObject({
            guild_id: 'g1',
            character_id: 'c1',
            character_name: 'Alice',
            character_class: 'Knight',
            character_level: 10,
            character_transform_tier: 2,
        });
        expect(result.id).toBe('g1');
    });

    it('truncates tag to 3 characters and uppercases', async () => {
        const guildChain = buildChain({ data: { id: 'g1' }, error: null });
        const memberChain = buildChain({ data: null, error: null });
        vi.mocked(supabase.from)
            .mockReturnValueOnce(guildChain as never)
            .mockReturnValueOnce(memberChain as never);
        await guildApi.createGuild({
            name: 'X',
            tag: 'longtag',
            logo: '',
            color: '',
            leaderId: 'c',
            leaderName: 'A',
            leaderClass: 'Knight',
            leaderLevel: 1,
        });
        const payload = vi.mocked(guildChain.insert).mock.calls[0][0];
        expect(payload.tag).toBe('LON');
    });

    it('throws when guild insert fails', async () => {
        const guildChain = buildChain({ data: null, error: { message: 'duplicate' } });
        vi.mocked(supabase.from).mockReturnValueOnce(guildChain as never);
        await expect(
            guildApi.createGuild({
                name: 'X', tag: 'X', logo: '', color: '',
                leaderId: 'c', leaderName: 'A', leaderClass: 'Knight', leaderLevel: 1,
            }),
        ).rejects.toThrow('duplicate');
    });

    it('rolls back the guild when leader-insert fails', async () => {
        const guildChain = buildChain({ data: { id: 'g1' }, error: null });
        const memberChain = buildChain({ data: null, error: { message: 'RLS denied' } });
        const rollbackChain = buildChain({ data: null, error: null });
        vi.mocked(supabase.from)
            .mockReturnValueOnce(guildChain as never)
            .mockReturnValueOnce(memberChain as never)
            .mockReturnValueOnce(rollbackChain as never);

        await expect(
            guildApi.createGuild({
                name: 'X', tag: 'X', logo: '', color: '',
                leaderId: 'c', leaderName: 'A', leaderClass: 'Knight', leaderLevel: 1,
            }),
        ).rejects.toThrow('RLS denied');
        // Rollback was attempted on the guilds table.
        expect(rollbackChain.delete).toHaveBeenCalled();
    });
});

describe('guildApi.leaveGuild', () => {
    it('returns disbanded:false when guild not found', async () => {
        mockApi.get.mockResolvedValueOnce(mkRes([]));
        const result = await guildApi.leaveGuild({ guildId: 'g-vanished', characterId: 'c1' });
        expect(result).toEqual({ disbanded: false });
    });

    it('non-leader leave just removes the member row', async () => {
        // findGuildById GET
        mockApi.get.mockResolvedValueOnce(mkRes([{ id: 'g1', leader_id: 'leader-1' }]));
        const deleteChain = buildChain({ data: null, error: null });
        vi.mocked(supabase.from).mockReturnValueOnce(deleteChain as never);

        const result = await guildApi.leaveGuild({ guildId: 'g1', characterId: 'c-member' });
        expect(deleteChain.delete).toHaveBeenCalled();
        expect(deleteChain.eq).toHaveBeenCalledWith('character_id', 'c-member');
        expect(result).toEqual({ disbanded: false });
    });

    it('leader leave with remaining members transfers leadership', async () => {
        mockApi.get.mockResolvedValueOnce(mkRes([{ id: 'g1', leader_id: 'c-leader' }]));
        const removeChain = buildChain({ data: null, error: null });
        const restChain = buildChain({
            data: [{ character_id: 'c-2nd', joined_at: '2026-01-01' }],
            error: null,
        });
        const transferChain = buildChain({ data: null, error: null });
        vi.mocked(supabase.from)
            .mockReturnValueOnce(removeChain as never)
            .mockReturnValueOnce(restChain as never)
            .mockReturnValueOnce(transferChain as never);

        const result = await guildApi.leaveGuild({ guildId: 'g1', characterId: 'c-leader' });
        // Leadership transferred.
        const updatePayload = vi.mocked(transferChain.update).mock.calls[0][0];
        expect(updatePayload).toEqual({ leader_id: 'c-2nd' });
        expect(result).toEqual({ disbanded: false });
    });

    it('leader leave with no remaining members disbands the guild', async () => {
        mockApi.get.mockResolvedValueOnce(mkRes([{ id: 'g1', leader_id: 'c-leader' }]));
        const removeChain = buildChain({ data: null, error: null });
        const restChain = buildChain({ data: [], error: null });
        const disbandChain = buildChain({ data: null, error: null });
        vi.mocked(supabase.from)
            .mockReturnValueOnce(removeChain as never)
            .mockReturnValueOnce(restChain as never)
            .mockReturnValueOnce(disbandChain as never);

        const result = await guildApi.leaveGuild({ guildId: 'g1', characterId: 'c-leader' });
        expect(disbandChain.delete).toHaveBeenCalled();
        expect(result).toEqual({ disbanded: true });
    });
});

describe('guildApi.kickMember', () => {
    it('deletes the member row matching both guild_id and character_id', async () => {
        const chain = buildChain({ data: null, error: null });
        vi.mocked(supabase.from).mockReturnValueOnce(chain as never);
        await guildApi.kickMember({ guildId: 'g1', characterId: 'c1' });
        expect(chain.delete).toHaveBeenCalled();
        expect(chain.eq).toHaveBeenCalledWith('guild_id', 'g1');
        expect(chain.eq).toHaveBeenCalledWith('character_id', 'c1');
    });
});

describe('guildApi.listMembers', () => {
    it('queries members for a guild ordered by joined_at asc', async () => {
        mockApi.get.mockResolvedValueOnce(mkRes([]));
        await guildApi.listMembers('g1');
        const url = mockApi.get.mock.calls[0][0] as string;
        expect(url).toContain('guild_members?guild_id=eq.g1');
        expect(url).toContain('order=joined_at.asc');
    });
});

describe('guildApi.updateMemberStats', () => {
    it('patches level + class', async () => {
        const chain = buildChain({ data: null, error: null });
        vi.mocked(supabase.from).mockReturnValueOnce(chain as never);
        await guildApi.updateMemberStats({
            characterId: 'c1',
            level: 50,
            characterClass: 'Mage',
        });
        const payload = vi.mocked(chain.update).mock.calls[0][0];
        expect(payload).toEqual({
            character_level: 50,
            character_class: 'Mage',
        });
    });

    it('includes transform tier when provided', async () => {
        const chain = buildChain({ data: null, error: null });
        vi.mocked(supabase.from).mockReturnValueOnce(chain as never);
        await guildApi.updateMemberStats({
            characterId: 'c1',
            level: 50,
            characterClass: 'Mage',
            transformTier: 3,
        });
        const payload = vi.mocked(chain.update).mock.calls[0][0];
        expect(payload.character_transform_tier).toBe(3);
    });

    it('does not include transform tier when undefined', async () => {
        const chain = buildChain({ data: null, error: null });
        vi.mocked(supabase.from).mockReturnValueOnce(chain as never);
        await guildApi.updateMemberStats({
            characterId: 'c1',
            level: 50,
            characterClass: 'Mage',
        });
        const payload = vi.mocked(chain.update).mock.calls[0][0];
        expect(payload).not.toHaveProperty('character_transform_tier');
    });
});

describe('guildApi.updateGuildLevelXp', () => {
    it('patches level, xp, member_cap and stamps updated_at', async () => {
        const chain = buildChain({ data: null, error: null });
        vi.mocked(supabase.from).mockReturnValueOnce(chain as never);
        await guildApi.updateGuildLevelXp({
            guildId: 'g1',
            level: 5,
            xp: 1000,
            memberCap: 24,
        });
        const payload = vi.mocked(chain.update).mock.calls[0][0];
        expect(payload).toMatchObject({
            level: 5,
            xp: 1000,
            member_cap: 24,
        });
        expect(payload.updated_at).toBeDefined();
    });

    it('includes boss tier when provided', async () => {
        const chain = buildChain({ data: null, error: null });
        vi.mocked(supabase.from).mockReturnValueOnce(chain as never);
        await guildApi.updateGuildLevelXp({
            guildId: 'g1', level: 5, xp: 1000, memberCap: 24, bossTier: 3,
        });
        const payload = vi.mocked(chain.update).mock.calls[0][0];
        expect(payload.boss_tier).toBe(3);
    });
});

// ── Join requests ─────────────────────────────────────────────────────────

describe('guildApi.requestJoin', () => {
    it('inserts a join request', async () => {
        const chain = buildChain({ data: null, error: null });
        vi.mocked(supabase.from).mockReturnValueOnce(chain as never);
        await guildApi.requestJoin({
            guildId: 'g1',
            characterId: 'c1',
            characterName: 'Alice',
            characterClass: 'Knight',
            characterLevel: 10,
        });
        const payload = vi.mocked(chain.insert).mock.calls[0][0];
        expect(payload).toMatchObject({
            guild_id: 'g1',
            character_id: 'c1',
            character_name: 'Alice',
            character_class: 'Knight',
            character_level: 10,
        });
    });
});

describe('guildApi.listRequests', () => {
    it('queries requests ordered by requested_at asc', async () => {
        mockApi.get.mockResolvedValueOnce(mkRes([]));
        await guildApi.listRequests('g1');
        const url = mockApi.get.mock.calls[0][0] as string;
        expect(url).toContain('guild_join_requests?guild_id=eq.g1');
        expect(url).toContain('order=requested_at.asc');
    });
});

describe('guildApi.deleteRequest', () => {
    it('deletes a request by id', async () => {
        const chain = buildChain({ data: null, error: null });
        vi.mocked(supabase.from).mockReturnValueOnce(chain as never);
        await guildApi.deleteRequest({ requestId: 'r1' });
        expect(chain.delete).toHaveBeenCalled();
        expect(chain.eq).toHaveBeenCalledWith('id', 'r1');
    });
});

describe('guildApi.purgeRequestsForCharacter', () => {
    it('deletes all requests for a character', async () => {
        const chain = buildChain({ data: null, error: null });
        vi.mocked(supabase.from).mockReturnValueOnce(chain as never);
        await guildApi.purgeRequestsForCharacter('c1');
        expect(chain.delete).toHaveBeenCalled();
        expect(chain.eq).toHaveBeenCalledWith('character_id', 'c1');
    });
});

describe('guildApi.acceptRequest', () => {
    it('inserts member row then purges other pending requests for the character', async () => {
        const memberChain = buildChain({ data: null, error: null });
        const purgeChain = buildChain({ data: null, error: null });
        vi.mocked(supabase.from)
            .mockReturnValueOnce(memberChain as never)
            .mockReturnValueOnce(purgeChain as never);

        await guildApi.acceptRequest({
            requestId: 'r1',
            guildId: 'g1',
            characterId: 'c1',
            characterName: 'Alice',
            characterClass: 'Knight',
            characterLevel: 10,
        });

        const memberPayload = vi.mocked(memberChain.insert).mock.calls[0][0];
        expect(memberPayload.character_id).toBe('c1');
        // Purge was called on character_id.
        expect(purgeChain.delete).toHaveBeenCalled();
    });

    it('throws when member insert fails (does not purge)', async () => {
        const memberChain = buildChain({ data: null, error: { message: 'duplicate' } });
        vi.mocked(supabase.from).mockReturnValueOnce(memberChain as never);
        await expect(
            guildApi.acceptRequest({
                requestId: 'r1', guildId: 'g1', characterId: 'c1',
                characterName: 'A', characterClass: 'Knight', characterLevel: 1,
            }),
        ).rejects.toThrow('duplicate');
    });
});

// ── Boss ──────────────────────────────────────────────────────────────────

describe('guildApi.fetchOrCreateWeeklyBoss', () => {
    it('returns existing boss row when one already exists for the week', async () => {
        const existing = { id: 'b1', guild_id: 'g1', boss_current_hp: 100 };
        mockApi.get.mockResolvedValueOnce(mkRes([existing]));
        const result = await guildApi.fetchOrCreateWeeklyBoss({ guildId: 'g1', bossTier: 1 });
        expect(result).toBe(existing);
    });

    it('creates a fresh boss row when none exists for the week', async () => {
        mockApi.get.mockResolvedValueOnce(mkRes([]));
        const newBoss = { id: 'b-new', boss_current_hp: 1000 };
        const insertChain = buildChain({ data: newBoss, error: null });
        vi.mocked(supabase.from).mockReturnValueOnce(insertChain as never);

        const result = await guildApi.fetchOrCreateWeeklyBoss({ guildId: 'g1', bossTier: 1 });

        const payload = vi.mocked(insertChain.insert).mock.calls[0][0];
        expect(payload).toMatchObject({
            guild_id: 'g1',
            boss_tier: 1,
            boss_current_hp: payload.boss_max_hp, // freshly created → full HP
            boss_killed: false,
            current_attacker_id: null,
        });
        expect(result).toBe(newBoss);
    });

    it('throws when insert fails', async () => {
        mockApi.get.mockResolvedValueOnce(mkRes([]));
        const insertChain = buildChain({ data: null, error: { message: 'RLS' } });
        vi.mocked(supabase.from).mockReturnValueOnce(insertChain as never);
        await expect(
            guildApi.fetchOrCreateWeeklyBoss({ guildId: 'g1', bossTier: 1 }),
        ).rejects.toThrow('RLS');
    });
});

describe('guildApi.claimBossArena', () => {
    it('returns the row when the claim succeeds', async () => {
        const claimed = { id: 'b1', current_attacker_id: 'c1' };
        const chain = buildChain({ data: claimed, error: null });
        vi.mocked(supabase.from).mockReturnValueOnce(chain as never);

        const result = await guildApi.claimBossArena({
            guildId: 'g1',
            characterId: 'c1',
            weekStart: '2026-05-18',
        });

        // The `.is('current_attacker_id', null)` precondition ensures atomicity.
        expect(chain.is).toHaveBeenCalledWith('current_attacker_id', null);
        expect(result).toBe(claimed);
    });

    it('returns null when another player already holds the arena', async () => {
        const chain = buildChain({ data: null, error: null });
        vi.mocked(supabase.from).mockReturnValueOnce(chain as never);
        const result = await guildApi.claimBossArena({
            guildId: 'g1', characterId: 'c1', weekStart: '2026-05-18',
        });
        expect(result).toBeNull();
    });
});

describe('guildApi.releaseBossArena', () => {
    it('clears current_attacker_id', async () => {
        const chain = buildChain({ data: null, error: null });
        vi.mocked(supabase.from).mockReturnValueOnce(chain as never);
        await guildApi.releaseBossArena({ guildId: 'g1', weekStart: '2026-05-18' });
        const payload = vi.mocked(chain.update).mock.calls[0][0];
        expect(payload.current_attacker_id).toBeNull();
    });
});

describe('guildApi.applyBossDamage', () => {
    it('clamps remaining HP at 0 and marks killed', async () => {
        mockApi.get.mockResolvedValueOnce(mkRes([{
            id: 'b1',
            boss_current_hp: 100,
            current_attacker_id: 'c1',
        }]));
        const updateChain = buildChain({
            data: { id: 'b1', boss_current_hp: 0, boss_killed: true },
            error: null,
        });
        vi.mocked(supabase.from).mockReturnValueOnce(updateChain as never);

        const result = await guildApi.applyBossDamage({
            guildId: 'g1', weekStart: '2026-05-18', damage: 500,
        });
        const payload = vi.mocked(updateChain.update).mock.calls[0][0];
        expect(payload.boss_current_hp).toBe(0);
        expect(payload.boss_killed).toBe(true);
        expect(payload.current_attacker_id).toBeNull();
        expect(result?.boss_killed).toBe(true);
    });

    it('keeps current attacker when boss survives the hit', async () => {
        mockApi.get.mockResolvedValueOnce(mkRes([{
            id: 'b1',
            boss_current_hp: 200,
            current_attacker_id: 'c1',
        }]));
        const updateChain = buildChain({ data: { id: 'b1' }, error: null });
        vi.mocked(supabase.from).mockReturnValueOnce(updateChain as never);
        await guildApi.applyBossDamage({
            guildId: 'g1', weekStart: '2026-05-18', damage: 50,
        });
        const payload = vi.mocked(updateChain.update).mock.calls[0][0];
        expect(payload.boss_current_hp).toBe(150);
        expect(payload.boss_killed).toBe(false);
        expect(payload.current_attacker_id).toBe('c1');
    });

    it('returns null when boss row does not exist', async () => {
        mockApi.get.mockResolvedValueOnce(mkRes([]));
        const result = await guildApi.applyBossDamage({
            guildId: 'g1', weekStart: '2026-05-18', damage: 100,
        });
        expect(result).toBeNull();
    });

    it('floors negative damage at 0', async () => {
        mockApi.get.mockResolvedValueOnce(mkRes([{
            id: 'b1', boss_current_hp: 100, current_attacker_id: 'c1',
        }]));
        const updateChain = buildChain({ data: { id: 'b1' }, error: null });
        vi.mocked(supabase.from).mockReturnValueOnce(updateChain as never);
        await guildApi.applyBossDamage({
            guildId: 'g1', weekStart: '2026-05-18', damage: -50,
        });
        const payload = vi.mocked(updateChain.update).mock.calls[0][0];
        expect(payload.boss_current_hp).toBe(100); // unchanged
    });
});

describe('guildApi.listAttemptsToday', () => {
    it('queries attempts for the character today', async () => {
        mockApi.get.mockResolvedValueOnce(mkRes([]));
        await guildApi.listAttemptsToday({ guildId: 'g1', characterId: 'c1' });
        const url = mockApi.get.mock.calls[0][0] as string;
        expect(url).toContain('guild_boss_attempts');
        expect(url).toContain('guild_id=eq.g1');
        expect(url).toContain('character_id=eq.c1');
        expect(url).toContain('attempt_date=eq.');
    });
});

describe('guildApi.logAttempt', () => {
    it('UPDATEs existing attempt row when one exists for today', async () => {
        mockApi.get.mockResolvedValueOnce(mkRes([{ id: 'a-existing' }]));
        const updateChain = buildChain({ data: null, error: null });
        vi.mocked(supabase.from).mockReturnValueOnce(updateChain as never);
        await guildApi.logAttempt({
            guildId: 'g1', characterId: 'c1', characterName: 'Alice', damageDealt: 100,
        });
        expect(updateChain.update).toHaveBeenCalled();
        expect(updateChain.eq).toHaveBeenCalledWith('id', 'a-existing');
    });

    it('INSERTs new attempt row when none exists', async () => {
        mockApi.get.mockResolvedValueOnce(mkRes([]));
        const insertChain = buildChain({ data: null, error: null });
        vi.mocked(supabase.from).mockReturnValueOnce(insertChain as never);
        await guildApi.logAttempt({
            guildId: 'g1', characterId: 'c1', characterName: 'Alice', damageDealt: 100,
        });
        const payload = vi.mocked(insertChain.insert).mock.calls[0][0];
        expect(payload).toMatchObject({
            guild_id: 'g1',
            character_id: 'c1',
            character_name: 'Alice',
            damage_dealt: 100,
        });
    });

    it('throws when update fails', async () => {
        mockApi.get.mockResolvedValueOnce(mkRes([{ id: 'a' }]));
        const updateChain = buildChain({ data: null, error: { message: 'denied' } });
        vi.mocked(supabase.from).mockReturnValueOnce(updateChain as never);
        const err = vi.spyOn(console, 'error').mockImplementation(() => {});
        await expect(guildApi.logAttempt({
            guildId: 'g1', characterId: 'c1', characterName: 'A', damageDealt: 1,
        })).rejects.toThrow('denied');
        err.mockRestore();
    });
});

describe('guildApi.listWeeklyAttempts', () => {
    it('queries attempts >= week_start, newest first', async () => {
        mockApi.get.mockResolvedValueOnce(mkRes([]));
        await guildApi.listWeeklyAttempts({ guildId: 'g1', weekStart: '2026-05-18' });
        const url = mockApi.get.mock.calls[0][0] as string;
        expect(url).toContain('attempt_date=gte.2026-05-18');
        expect(url).toContain('order=created_at.desc');
    });
});

describe('guildApi.fetchContribution', () => {
    it('returns the first contribution row or null', async () => {
        const row = { id: 'c1', total_damage: 500 };
        mockApi.get.mockResolvedValueOnce(mkRes([row]));
        const result = await guildApi.fetchContribution({
            guildId: 'g1', characterId: 'c1', weekStart: '2026-05-18',
        });
        expect(result).toBe(row);
    });

    it('returns null when no contribution exists', async () => {
        mockApi.get.mockResolvedValueOnce(mkRes([]));
        const result = await guildApi.fetchContribution({
            guildId: 'g1', characterId: 'c1', weekStart: '2026-05-18',
        });
        expect(result).toBeNull();
    });
});

describe('guildApi.addContribution', () => {
    it('updates existing contribution with cumulative damage', async () => {
        mockApi.get.mockResolvedValueOnce(mkRes([{ id: 'contrib-1', total_damage: 200 }]));
        const updateChain = buildChain({ data: null, error: null });
        vi.mocked(supabase.from).mockReturnValueOnce(updateChain as never);

        await guildApi.addContribution({
            guildId: 'g1', characterId: 'c1', weekStart: '2026-05-18', damageAdd: 150,
        });

        const payload = vi.mocked(updateChain.update).mock.calls[0][0];
        expect(payload.total_damage).toBe(350); // 200 + 150
    });

    it('inserts new contribution row when none exists', async () => {
        mockApi.get.mockResolvedValueOnce(mkRes([]));
        const insertChain = buildChain({ data: null, error: null });
        vi.mocked(supabase.from).mockReturnValueOnce(insertChain as never);

        await guildApi.addContribution({
            guildId: 'g1', characterId: 'c1', weekStart: '2026-05-18', damageAdd: 250,
        });

        const payload = vi.mocked(insertChain.insert).mock.calls[0][0];
        expect(payload).toMatchObject({
            guild_id: 'g1',
            character_id: 'c1',
            week_start: '2026-05-18',
            total_damage: 250,
        });
    });
});

describe('guildApi.markContributionClaimed', () => {
    it('sets rewards_claimed=true and saves rewards JSON', async () => {
        const chain = buildChain({ data: null, error: null });
        vi.mocked(supabase.from).mockReturnValueOnce(chain as never);
        await guildApi.markContributionClaimed({
            contributionId: 'c1',
            rewardsJson: '{"gold":1000}',
        });
        const payload = vi.mocked(chain.update).mock.calls[0][0];
        expect(payload).toMatchObject({
            rewards_claimed: true,
            rewards_json: '{"gold":1000}',
        });
    });
});

// ── Treasury ──────────────────────────────────────────────────────────────

describe('guildApi.listTreasury', () => {
    it('queries items ordered by deposited_at desc, limit 1000', async () => {
        mockApi.get.mockResolvedValueOnce(mkRes([]));
        await guildApi.listTreasury('g1');
        const url = mockApi.get.mock.calls[0][0] as string;
        expect(url).toContain('guild_treasury_items?guild_id=eq.g1');
        expect(url).toContain('order=deposited_at.desc');
        expect(url).toContain('limit=1000');
    });
});

describe('guildApi.depositItem', () => {
    it('inserts the item then logs the deposit action', async () => {
        const inserted = { id: 'item-1' };
        const insertChain = buildChain({ data: inserted, error: null });
        const logChain = buildChain({ data: null, error: null });
        vi.mocked(supabase.from)
            .mockReturnValueOnce(insertChain as never)
            .mockReturnValueOnce(logChain as never);

        const result = await guildApi.depositItem({
            guildId: 'g1',
            itemData: '{"id":"sword"}',
            depositedBy: 'c1',
            depositedByName: 'Alice',
            itemName: 'Sword',
        });

        expect(result.id).toBe('item-1');
        const logPayload = vi.mocked(logChain.insert).mock.calls[0][0];
        expect(logPayload).toMatchObject({
            guild_id: 'g1',
            action: 'deposit',
            character_id: 'c1',
            character_name: 'Alice',
            item_name: 'Sword',
        });
    });

    it('throws when the insert returns an error', async () => {
        const insertChain = buildChain({ data: null, error: { message: 'full' } });
        vi.mocked(supabase.from).mockReturnValueOnce(insertChain as never);
        await expect(guildApi.depositItem({
            guildId: 'g', itemData: '', depositedBy: 'c', depositedByName: 'A', itemName: 'I',
        })).rejects.toThrow('full');
    });
});

describe('guildApi.withdrawItem', () => {
    it('deletes the treasury item then logs withdraw with the item snapshot', async () => {
        const deleteChain = buildChain({ data: null, error: null });
        const logChain = buildChain({ data: null, error: null });
        vi.mocked(supabase.from)
            .mockReturnValueOnce(deleteChain as never)
            .mockReturnValueOnce(logChain as never);

        await guildApi.withdrawItem({
            treasuryItemId: 't1',
            guildId: 'g1',
            characterId: 'c1',
            characterName: 'Alice',
            itemName: 'Sword',
            itemData: '{"id":"sword"}',
        });

        expect(deleteChain.delete).toHaveBeenCalled();
        const logPayload = vi.mocked(logChain.insert).mock.calls[0][0];
        expect(logPayload).toMatchObject({
            action: 'withdraw',
            item_name: 'Sword',
            item_data: '{"id":"sword"}',
        });
    });

    it('logs item_data as null when not provided', async () => {
        const deleteChain = buildChain({ data: null, error: null });
        const logChain = buildChain({ data: null, error: null });
        vi.mocked(supabase.from)
            .mockReturnValueOnce(deleteChain as never)
            .mockReturnValueOnce(logChain as never);
        await guildApi.withdrawItem({
            treasuryItemId: 't1',
            guildId: 'g1',
            characterId: 'c1',
            characterName: 'Alice',
            itemName: 'Sword',
        });
        const logPayload = vi.mocked(logChain.insert).mock.calls[0][0];
        expect(logPayload.item_data).toBeNull();
    });

    it('throws when delete fails', async () => {
        const deleteChain = buildChain({ data: null, error: { message: 'RLS' } });
        vi.mocked(supabase.from).mockReturnValueOnce(deleteChain as never);
        await expect(guildApi.withdrawItem({
            treasuryItemId: 't', guildId: 'g', characterId: 'c',
            characterName: 'A', itemName: 'I',
        })).rejects.toThrow('RLS');
    });
});

describe('guildApi.listTreasuryLogs', () => {
    it('queries logs newest first, limit 200', async () => {
        mockApi.get.mockResolvedValueOnce(mkRes([]));
        await guildApi.listTreasuryLogs('g1');
        const url = mockApi.get.mock.calls[0][0] as string;
        expect(url).toContain('guild_treasury_logs?guild_id=eq.g1');
        expect(url).toContain('order=created_at.desc');
        expect(url).toContain('limit=200');
    });
});

describe('guildApi.resetGuildBossForTesting', () => {
    it('deletes boss state + attempts + contributions and rewinds guild to tier 1', async () => {
        const bossDel = buildChain({ data: null, error: null });
        const attDel = buildChain({ data: null, error: null });
        const contribDel = buildChain({ data: null, error: null });
        const guildUpdate = buildChain({ data: null, error: null });
        vi.mocked(supabase.from)
            .mockReturnValueOnce(bossDel as never)
            .mockReturnValueOnce(attDel as never)
            .mockReturnValueOnce(contribDel as never)
            .mockReturnValueOnce(guildUpdate as never);

        await guildApi.resetGuildBossForTesting({ guildId: 'g1' });

        expect(bossDel.delete).toHaveBeenCalled();
        expect(attDel.delete).toHaveBeenCalled();
        expect(contribDel.delete).toHaveBeenCalled();
        const payload = vi.mocked(guildUpdate.update).mock.calls[0][0];
        expect(payload).toMatchObject({
            level: 1,
            xp: 0,
            boss_tier: 1,
            member_cap: 20,
        });
    });
});

// TODO: realtime channel subscriptions aren't covered — they're thin
// wrappers over supabase.channel().on(...).subscribe() and our supabase
// mock already returns the chainable channel object, so the contract is
// already exercised through indirect calls.
