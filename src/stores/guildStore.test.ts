import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Hoisted mocks ────────────────────────────────────────────────────────────
// guildStore makes Supabase realtime + guildApi calls in `hydrateForCharacter`
// and `setGuild`. Mock both so tests stay deterministic and offline.

const {
    findGuildForCharacterMock,
    findGuildByIdMock,
    listMembersMock,
    listRequestsMock,
    updateGuildLevelXpMock,
    buildGuildChannelMock,
    channelOnMock,
    channelSubscribeMock,
    removeChannelMock,
    channelMock,
} = vi.hoisted(() => {
    const onFn = vi.fn();
    const subscribeFn = vi.fn();
    // Each `.on()` returns the channel itself so chaining keeps working.
    onFn.mockImplementation(() => chMock);
    const chMock = { on: onFn, subscribe: subscribeFn };
    return {
        findGuildForCharacterMock: vi.fn(),
        findGuildByIdMock: vi.fn(),
        listMembersMock: vi.fn().mockResolvedValue([]),
        listRequestsMock: vi.fn().mockResolvedValue([]),
        updateGuildLevelXpMock: vi.fn().mockResolvedValue(undefined),
        buildGuildChannelMock: vi.fn((id: string) => `guild-${id}`),
        channelOnMock: onFn,
        channelSubscribeMock: subscribeFn,
        removeChannelMock: vi.fn(),
        channelMock: chMock,
    };
});

vi.mock('../api/v1/guildApi', () => ({
    guildApi: {
        findGuildForCharacter: findGuildForCharacterMock,
        findGuildById: findGuildByIdMock,
        listMembers: listMembersMock,
        listRequests: listRequestsMock,
        updateGuildLevelXp: updateGuildLevelXpMock,
    },
    buildGuildChannel: buildGuildChannelMock,
}));

vi.mock('../lib/supabase', () => ({
    supabase: {
        channel: vi.fn(() => channelMock),
        removeChannel: removeChannelMock,
    },
}));

import { useGuildStore, isCurrentCharacterGuildLeader } from './guildStore';
import type { IGuildRow, IGuildMemberRow, IGuildJoinRequestRow } from '../api/v1/guildApi';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const makeGuild = (overrides: Partial<IGuildRow> = {}): IGuildRow => ({
    id: 'g1',
    name: 'Test Guild',
    tag: 'TST',
    logo: '⚔️',
    color: '#888',
    leader_id: 'char-1',
    level: 1,
    xp: 0,
    boss_tier: 1,
    member_cap: 20,
    created_at: '2026-05-21T00:00:00Z',
    updated_at: '2026-05-21T00:00:00Z',
    ...overrides,
});

const makeMember = (overrides: Partial<IGuildMemberRow> = {}): IGuildMemberRow => ({
    id: 'gm1',
    guild_id: 'g1',
    character_id: 'char-1',
    character_name: 'Alice',
    character_class: 'Knight',
    character_level: 10,
    character_transform_tier: 0,
    joined_at: '2026-05-21T00:00:00Z',
    ...overrides,
});

const makeRequest = (overrides: Partial<IGuildJoinRequestRow> = {}): IGuildJoinRequestRow => ({
    id: 'jr1',
    guild_id: 'g1',
    character_id: 'char-2',
    character_name: 'Bob',
    character_class: 'Mage',
    character_level: 5,
    requested_at: '2026-05-21T00:00:00Z',
    ...overrides,
});

beforeEach(() => {
    useGuildStore.setState({
        guild: null,
        members: [],
        requests: [],
        loading: false,
        guildIdByCharacter: {},
        channel: null,
    });
    findGuildForCharacterMock.mockReset();
    findGuildByIdMock.mockReset();
    listMembersMock.mockReset().mockResolvedValue([]);
    listRequestsMock.mockReset().mockResolvedValue([]);
    updateGuildLevelXpMock.mockReset().mockResolvedValue(undefined);
    buildGuildChannelMock.mockClear();
    channelOnMock.mockClear();
    channelSubscribeMock.mockClear();
    removeChannelMock.mockClear();
});

// ── Initial state ────────────────────────────────────────────────────────────

describe('guildStore — initial state', () => {
    it('starts unaffiliated', () => {
        const s = useGuildStore.getState();
        expect(s.guild).toBeNull();
        expect(s.members).toEqual([]);
        expect(s.requests).toEqual([]);
        expect(s.loading).toBe(false);
        expect(s.channel).toBeNull();
        expect(s.guildIdByCharacter).toEqual({});
    });
});

// ── hydrateForCharacter ──────────────────────────────────────────────────────

describe('hydrateForCharacter', () => {
    it('is a no-op when characterId is empty', async () => {
        await useGuildStore.getState().hydrateForCharacter('');
        expect(findGuildForCharacterMock).not.toHaveBeenCalled();
    });

    it('clears state and maps characterId → null when no guild membership exists', async () => {
        findGuildForCharacterMock.mockResolvedValue(null);
        await useGuildStore.getState().hydrateForCharacter('char-1');
        const s = useGuildStore.getState();
        expect(s.guild).toBeNull();
        expect(s.members).toEqual([]);
        expect(s.requests).toEqual([]);
        expect(s.loading).toBe(false);
        expect(s.guildIdByCharacter['char-1']).toBeNull();
    });

    it('populates guild + members + requests when a membership is found', async () => {
        const guild = makeGuild();
        const membership = makeMember();
        const members = [makeMember(), makeMember({ id: 'gm2', character_id: 'char-2' })];
        const requests = [makeRequest()];

        findGuildForCharacterMock.mockResolvedValue({ guild, membership });
        listMembersMock.mockResolvedValue(members);
        listRequestsMock.mockResolvedValue(requests);

        await useGuildStore.getState().hydrateForCharacter('char-1');
        const s = useGuildStore.getState();
        expect(s.guild?.id).toBe('g1');
        expect(s.members).toHaveLength(2);
        expect(s.requests).toHaveLength(1);
        expect(s.guildIdByCharacter['char-1']).toBe('g1');
        expect(s.loading).toBe(false);
    });

    it('opens a realtime channel after a successful hydrate', async () => {
        findGuildForCharacterMock.mockResolvedValue({
            guild: makeGuild({ id: 'g42' }),
            membership: makeMember(),
        });
        await useGuildStore.getState().hydrateForCharacter('char-1');
        expect(buildGuildChannelMock).toHaveBeenCalledWith('g42');
        expect(channelSubscribeMock).toHaveBeenCalled();
        expect(useGuildStore.getState().channel).not.toBeNull();
    });

    it('tears down a stale channel when re-hydrating into "no guild"', async () => {
        // First hydrate – opens channel A
        findGuildForCharacterMock.mockResolvedValueOnce({
            guild: makeGuild(),
            membership: makeMember(),
        });
        await useGuildStore.getState().hydrateForCharacter('char-1');
        expect(useGuildStore.getState().channel).not.toBeNull();

        // Second hydrate – player no longer in a guild
        findGuildForCharacterMock.mockResolvedValueOnce(null);
        await useGuildStore.getState().hydrateForCharacter('char-1');
        expect(removeChannelMock).toHaveBeenCalled();
        expect(useGuildStore.getState().channel).toBeNull();
    });

    it('sets loading=false even when the API throws', async () => {
        // Swallow the console.error from the catch arm to keep test output clean.
        const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        findGuildForCharacterMock.mockRejectedValue(new Error('offline'));
        await useGuildStore.getState().hydrateForCharacter('char-1');
        expect(useGuildStore.getState().loading).toBe(false);
        errSpy.mockRestore();
    });
});

// ── refreshMembers ───────────────────────────────────────────────────────────

describe('refreshMembers', () => {
    it('is a no-op when no guild is active', async () => {
        await useGuildStore.getState().refreshMembers();
        expect(listMembersMock).not.toHaveBeenCalled();
    });

    it('refreshes the members list from the API', async () => {
        useGuildStore.setState({ guild: makeGuild({ id: 'g7' }) });
        const fresh = [makeMember({ id: 'gm-x' })];
        listMembersMock.mockResolvedValue(fresh);
        await useGuildStore.getState().refreshMembers();
        expect(listMembersMock).toHaveBeenCalledWith('g7');
        expect(useGuildStore.getState().members).toEqual(fresh);
    });

    it('silently swallows API failures (offline)', async () => {
        useGuildStore.setState({ guild: makeGuild(), members: [makeMember()] });
        listMembersMock.mockRejectedValue(new Error('offline'));
        await expect(useGuildStore.getState().refreshMembers()).resolves.toBeUndefined();
        // Original member list intact.
        expect(useGuildStore.getState().members).toHaveLength(1);
    });
});

// ── refreshRequests ──────────────────────────────────────────────────────────

describe('refreshRequests', () => {
    it('is a no-op when no guild is active', async () => {
        await useGuildStore.getState().refreshRequests();
        expect(listRequestsMock).not.toHaveBeenCalled();
    });

    it('refreshes pending join requests from the API', async () => {
        useGuildStore.setState({ guild: makeGuild({ id: 'g9' }) });
        const reqs = [makeRequest({ id: 'jr-x' })];
        listRequestsMock.mockResolvedValue(reqs);
        await useGuildStore.getState().refreshRequests();
        expect(listRequestsMock).toHaveBeenCalledWith('g9');
        expect(useGuildStore.getState().requests).toEqual(reqs);
    });

    it('silently swallows API failures', async () => {
        useGuildStore.setState({ guild: makeGuild(), requests: [makeRequest()] });
        listRequestsMock.mockRejectedValue(new Error('offline'));
        await expect(useGuildStore.getState().refreshRequests()).resolves.toBeUndefined();
        expect(useGuildStore.getState().requests).toHaveLength(1);
    });
});

// ── setGuild ─────────────────────────────────────────────────────────────────

describe('setGuild', () => {
    it('replaces the current guild', () => {
        const g = makeGuild({ id: 'g-new' });
        useGuildStore.getState().setGuild(g);
        expect(useGuildStore.getState().guild?.id).toBe('g-new');
    });

    it('accepts null (clears the guild ref)', () => {
        useGuildStore.setState({ guild: makeGuild() });
        useGuildStore.getState().setGuild(null);
        expect(useGuildStore.getState().guild).toBeNull();
    });

    it('does NOT push a cap update when stored member_cap already matches level', () => {
        // level=1 → cap=20 per guildMemberCap; matches the stored cap so
        // no API call is made.
        const g = makeGuild({ level: 1, member_cap: 20 });
        useGuildStore.getState().setGuild(g);
        expect(updateGuildLevelXpMock).not.toHaveBeenCalled();
    });

    it('pushes a cap update when the level implies a different cap than what is stored', () => {
        // level=5 → cap=24 (20 + 4) per guildMemberCap. Stored cap is stale (20).
        const g = makeGuild({ level: 5, xp: 999, member_cap: 20 });
        useGuildStore.getState().setGuild(g);
        expect(updateGuildLevelXpMock).toHaveBeenCalledWith(
            expect.objectContaining({
                guildId: g.id,
                level: 5,
                xp: 999,
                memberCap: 24,
            }),
        );
    });
});

// ── clear ────────────────────────────────────────────────────────────────────

describe('clear', () => {
    it('resets guild/members/requests/loading/channel', () => {
        useGuildStore.setState({
            guild: makeGuild(),
            members: [makeMember(), makeMember()],
            requests: [makeRequest()],
            loading: true,
            channel: channelMock as never,
        });
        useGuildStore.getState().clear();
        const s = useGuildStore.getState();
        expect(s.guild).toBeNull();
        expect(s.members).toEqual([]);
        expect(s.requests).toEqual([]);
        expect(s.loading).toBe(false);
        expect(s.channel).toBeNull();
    });

    it('asks supabase to tear down the channel if one was open', () => {
        useGuildStore.setState({ channel: channelMock as never });
        useGuildStore.getState().clear();
        expect(removeChannelMock).toHaveBeenCalled();
    });

    it('is safe when no channel was ever opened', () => {
        useGuildStore.setState({ channel: null });
        expect(() => useGuildStore.getState().clear()).not.toThrow();
    });
});

// ── isCurrentCharacterGuildLeader ────────────────────────────────────────────

describe('isCurrentCharacterGuildLeader', () => {
    it('returns true when the character is the guild leader', () => {
        useGuildStore.setState({ guild: makeGuild({ leader_id: 'char-1' }) });
        expect(isCurrentCharacterGuildLeader('char-1')).toBe(true);
    });

    it('returns false when the character is a regular member', () => {
        useGuildStore.setState({ guild: makeGuild({ leader_id: 'char-1' }) });
        expect(isCurrentCharacterGuildLeader('char-2')).toBe(false);
    });

    it('returns false when there is no guild', () => {
        useGuildStore.setState({ guild: null });
        expect(isCurrentCharacterGuildLeader('char-1')).toBe(false);
    });

    it('returns false for undefined characterId', () => {
        useGuildStore.setState({ guild: makeGuild({ leader_id: 'char-1' }) });
        expect(isCurrentCharacterGuildLeader(undefined)).toBe(false);
    });
});
