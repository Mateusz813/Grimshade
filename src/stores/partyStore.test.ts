import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Hoisted mocks ────────────────────────────────────────────────────────────
// partyStore wraps `partyApi` end-to-end; we mock every method it calls so
// no real Supabase round-trip happens. `vi.hoisted` ensures the spies are
// defined BEFORE `vi.mock` factories run (those factories are hoisted to
// the top of the file by the vitest transformer).

const {
    createPartyApi,
    joinPartyApi,
    leavePartyApi,
    kickMemberApi,
    transferLeadershipApi,
    updatePartyMetaApi,
    getMyActivePartyApi,
    listPublicPartiesApi,
    subscribePublicFeedApi,
    subscribePartyApi,
    deleteMyStaleMembershipsApi,
    extractApiErrorMock,
    offlineHuntIsActive,
    isOfflineModeMock,
} = vi.hoisted(() => ({
    createPartyApi: vi.fn(),
    joinPartyApi: vi.fn(),
    leavePartyApi: vi.fn().mockResolvedValue(undefined),
    kickMemberApi: vi.fn().mockResolvedValue(undefined),
    transferLeadershipApi: vi.fn().mockResolvedValue(undefined),
    updatePartyMetaApi: vi.fn().mockResolvedValue(undefined),
    getMyActivePartyApi: vi.fn(),
    listPublicPartiesApi: vi.fn(),
    subscribePublicFeedApi: vi.fn(() => vi.fn()),
    subscribePartyApi: vi.fn(() => vi.fn()),
    deleteMyStaleMembershipsApi: vi.fn().mockResolvedValue(undefined),
    extractApiErrorMock: vi.fn((err: unknown) => (err instanceof Error ? err.message : 'API error')),
    offlineHuntIsActive: { value: false },
    isOfflineModeMock: vi.fn(() => false),
}));

vi.mock('../api/v1/partyApi', () => ({
    partyApi: {
        createParty: createPartyApi,
        joinParty: joinPartyApi,
        leaveParty: leavePartyApi,
        kickMember: kickMemberApi,
        transferLeadership: transferLeadershipApi,
        updatePartyMeta: updatePartyMetaApi,
        getMyActiveParty: getMyActivePartyApi,
        listPublicParties: listPublicPartiesApi,
        subscribePublicFeed: subscribePublicFeedApi,
        subscribeParty: subscribePartyApi,
        deleteMyStaleMemberships: deleteMyStaleMembershipsApi,
    },
    extractApiError: extractApiErrorMock,
}));

// Block offline-hunt guard inside createParty / joinParty.
vi.mock('./offlineHuntStore', () => ({
    useOfflineHuntStore: {
        getState: () => ({ isActive: offlineHuntIsActive.value }),
    },
}));

vi.mock('./connectivityStore', () => ({
    isOfflineMode: isOfflineModeMock,
}));

import { usePartyStore } from './partyStore';
import type { IPartyMember } from '../systems/partySystem';
import type { IPartyWithMembers } from '../api/v1/partyApi';

const SELF: IPartyMember = {
    id: 'char-1',
    name: 'Tester',
    class: 'Knight',
    level: 10,
    hp: 200,
    maxHp: 200,
    isOnline: true,
};

const makeServerParty = (overrides?: Partial<IPartyWithMembers>): IPartyWithMembers => ({
    id: 'party-1',
    leader_id: 'char-1',
    name: 'Test Party',
    description: '',
    has_password: false,
    is_public: true,
    max_members: 4,
    min_join_level: 1,
    created_at: '2026-05-21T00:00:00Z',
    updated_at: '2026-05-21T00:00:00Z',
    members: [
        {
            id: 'pm-1',
            party_id: 'party-1',
            character_id: 'char-1',
            character_name: 'Tester',
            character_class: 'Knight',
            character_level: 10,
            role: 'leader',
            joined_at: '2026-05-21T00:00:00Z',
        },
    ],
    ...overrides,
} as unknown as IPartyWithMembers);

beforeEach(() => {
    usePartyStore.setState({
        party: null,
        loading: false,
        error: null,
        publicParties: [],
    });
    offlineHuntIsActive.value = false;
    isOfflineModeMock.mockReset();
    isOfflineModeMock.mockReturnValue(false);
    [
        createPartyApi,
        joinPartyApi,
        leavePartyApi,
        kickMemberApi,
        transferLeadershipApi,
        updatePartyMetaApi,
        getMyActivePartyApi,
        listPublicPartiesApi,
        subscribePublicFeedApi,
        subscribePartyApi,
        deleteMyStaleMembershipsApi,
    ].forEach((fn) => fn.mockClear());
});

// ── createParty ──────────────────────────────────────────────────────────────

describe('createParty', () => {
    it('round-trips through partyApi and stores the adapted party on success', async () => {
        createPartyApi.mockResolvedValueOnce(makeServerParty());
        await usePartyStore.getState().createParty(SELF, {
            name: 'Test Party',
            description: 'hi',
            password: null,
            isPublic: true,
        });
        const state = usePartyStore.getState();
        expect(state.party).not.toBeNull();
        expect(state.party!.id).toBe('party-1');
        expect(state.party!.leaderId).toBe('char-1');
        expect(state.party!.members).toHaveLength(1);
        expect(state.loading).toBe(false);
        expect(state.error).toBeNull();
    });

    it('refuses to create party while an offline hunt is running', async () => {
        offlineHuntIsActive.value = true;
        await usePartyStore.getState().createParty(SELF, {
            name: 'x', description: '', password: null, isPublic: true,
        });
        // partyApi.createParty should never be reached.
        expect(createPartyApi).not.toHaveBeenCalled();
        const state = usePartyStore.getState();
        expect(state.party).toBeNull();
        expect(state.error).toContain('Najpierw zakończ polowanie offline');
    });

    it('surfaces the API error and leaves party=null on failure', async () => {
        createPartyApi.mockRejectedValueOnce(new Error('boom'));
        await usePartyStore.getState().createParty(SELF, {
            name: 'x', description: '', password: null, isPublic: true,
        });
        const state = usePartyStore.getState();
        expect(state.party).toBeNull();
        expect(state.loading).toBe(false);
        expect(state.error).toBe('boom');
    });

    it('surfaces an error when the API resolves to null (server insert returned nothing)', async () => {
        createPartyApi.mockResolvedValueOnce(null);
        await usePartyStore.getState().createParty(SELF, {
            name: 'x', description: '', password: null, isPublic: true,
        });
        const state = usePartyStore.getState();
        expect(state.party).toBeNull();
        expect(state.error).not.toBeNull();
    });
});

// ── joinPartyById ────────────────────────────────────────────────────────────

describe('joinPartyById', () => {
    it('stores the party on a successful join', async () => {
        joinPartyApi.mockResolvedValueOnce(makeServerParty({ id: 'party-2' }));
        await usePartyStore.getState().joinPartyById('party-2', SELF);
        expect(usePartyStore.getState().party!.id).toBe('party-2');
    });

    it('refuses to join while an offline hunt is running', async () => {
        offlineHuntIsActive.value = true;
        await usePartyStore.getState().joinPartyById('party-2', SELF);
        expect(joinPartyApi).not.toHaveBeenCalled();
        expect(usePartyStore.getState().error).toContain('Najpierw zakończ polowanie offline');
    });

    it('records the API-returned soft error (e.g. wrong password) without throwing', async () => {
        joinPartyApi.mockResolvedValueOnce({ error: 'Bad password' });
        await usePartyStore.getState().joinPartyById('party-2', SELF, 'nope');
        const state = usePartyStore.getState();
        expect(state.party).toBeNull();
        expect(state.error).toBe('Bad password');
        expect(state.loading).toBe(false);
    });

    it('routes thrown errors through extractApiError', async () => {
        joinPartyApi.mockRejectedValueOnce(new Error('network down'));
        await usePartyStore.getState().joinPartyById('party-2', SELF);
        expect(extractApiErrorMock).toHaveBeenCalled();
        expect(usePartyStore.getState().error).toBe('network down');
    });
});

// ── leaveParty ───────────────────────────────────────────────────────────────

describe('leaveParty', () => {
    it('is a no-op when no party is loaded', async () => {
        await usePartyStore.getState().leaveParty('char-1');
        expect(leavePartyApi).not.toHaveBeenCalled();
    });

    it('clears local party state IMMEDIATELY before awaiting partyApi.leaveParty', async () => {
        usePartyStore.setState({
            party: { id: 'party-1', leaderId: 'char-1', members: [], createdAt: 'x' },
            loading: false,
            error: null,
            publicParties: [],
        });
        let partyDuringApiCall: unknown = 'unset';
        leavePartyApi.mockImplementationOnce(async () => {
            partyDuringApiCall = usePartyStore.getState().party;
        });
        await usePartyStore.getState().leaveParty('char-1');
        // By the time the API fires, the local store should already be null.
        expect(partyDuringApiCall).toBeNull();
        expect(usePartyStore.getState().party).toBeNull();
    });

    it('still clears local state even when the server leave call rejects', async () => {
        usePartyStore.setState({
            party: { id: 'party-1', leaderId: 'char-1', members: [], createdAt: 'x' },
            loading: false,
            error: null,
            publicParties: [],
        });
        leavePartyApi.mockRejectedValueOnce(new Error('rls denied'));
        await usePartyStore.getState().leaveParty('char-1');
        // Defensive: UI must NOT get stuck on a stale party row.
        expect(usePartyStore.getState().party).toBeNull();
    });
});

// ── transferLeadership ───────────────────────────────────────────────────────

describe('transferLeadership', () => {
    it('optimistically updates leaderId locally then commits via partyApi', async () => {
        usePartyStore.setState({
            party: {
                id: 'party-1',
                leaderId: 'char-1',
                members: [],
                createdAt: 'x',
            },
            loading: false,
            error: null,
            publicParties: [],
        });
        let leaderDuringApiCall: string | null = null;
        transferLeadershipApi.mockImplementationOnce(async () => {
            leaderDuringApiCall = usePartyStore.getState().party!.leaderId;
        });
        await usePartyStore.getState().transferLeadership('char-2');
        expect(leaderDuringApiCall).toBe('char-2');
        expect(usePartyStore.getState().party!.leaderId).toBe('char-2');
    });

    it('rolls back to the previous leader on API failure + records an error', async () => {
        const original = {
            id: 'party-1',
            leaderId: 'char-1',
            members: [],
            createdAt: 'x',
        };
        usePartyStore.setState({
            party: original,
            loading: false,
            error: null,
            publicParties: [],
        });
        transferLeadershipApi.mockRejectedValueOnce(new Error('not leader'));
        await usePartyStore.getState().transferLeadership('char-2');
        const state = usePartyStore.getState();
        expect(state.party).toEqual(original);
        expect(state.error).toBe('not leader');
    });

    it('is a no-op when no party is loaded', async () => {
        await usePartyStore.getState().transferLeadership('char-2');
        expect(transferLeadershipApi).not.toHaveBeenCalled();
    });
});

// ── kickByRowId ──────────────────────────────────────────────────────────────

describe('kickByRowId', () => {
    it('calls partyApi.kickMember when a party is loaded', async () => {
        usePartyStore.setState({
            party: { id: 'party-1', leaderId: 'char-1', members: [], createdAt: 'x' },
            loading: false,
            error: null,
            publicParties: [],
        });
        await usePartyStore.getState().kickByRowId('pm-2');
        expect(kickMemberApi).toHaveBeenCalledWith('party-1', 'pm-2');
    });

    it('records the API error without throwing', async () => {
        usePartyStore.setState({
            party: { id: 'party-1', leaderId: 'char-1', members: [], createdAt: 'x' },
            loading: false,
            error: null,
            publicParties: [],
        });
        kickMemberApi.mockRejectedValueOnce(new Error('forbidden'));
        await usePartyStore.getState().kickByRowId('pm-2');
        expect(usePartyStore.getState().error).toBe('forbidden');
    });

    it('is a no-op when no party is loaded', async () => {
        await usePartyStore.getState().kickByRowId('pm-2');
        expect(kickMemberApi).not.toHaveBeenCalled();
    });
});

// ── removeMember (local-only, bot path) ──────────────────────────────────────

describe('removeMember', () => {
    it('drops the member by id from the local roster', () => {
        usePartyStore.setState({
            party: {
                id: 'party-1',
                leaderId: 'char-1',
                members: [
                    { id: 'char-1', name: 'Tester', class: 'Knight', level: 10, hp: 200, maxHp: 200 },
                    { id: 'bot-1',  name: 'Bot',    class: 'Cleric', level: 10, hp: 200, maxHp: 200, isBot: true },
                ],
                createdAt: 'x',
            },
            loading: false,
            error: null,
            publicParties: [],
        });
        usePartyStore.getState().removeMember('bot-1');
        const state = usePartyStore.getState();
        expect(state.party!.members).toHaveLength(1);
        expect(state.party!.members[0].id).toBe('char-1');
    });

    it('clears the whole party object when removing the LAST member', () => {
        usePartyStore.setState({
            party: {
                id: 'party-1',
                leaderId: 'char-1',
                members: [
                    { id: 'char-1', name: 'Tester', class: 'Knight', level: 10, hp: 200, maxHp: 200 },
                ],
                createdAt: 'x',
            },
            loading: false,
            error: null,
            publicParties: [],
        });
        usePartyStore.getState().removeMember('char-1');
        expect(usePartyStore.getState().party).toBeNull();
    });

    it('is a no-op when no party is loaded', () => {
        expect(() => usePartyStore.getState().removeMember('char-x')).not.toThrow();
        expect(usePartyStore.getState().party).toBeNull();
    });
});

// ── hydrateActiveParty ───────────────────────────────────────────────────────

describe('hydrateActiveParty', () => {
    it('adopts a server-side party when one is found', async () => {
        getMyActivePartyApi.mockResolvedValueOnce(makeServerParty({ id: 'restored' }));
        await usePartyStore.getState().hydrateActiveParty('char-1');
        expect(usePartyStore.getState().party!.id).toBe('restored');
    });

    it('deletes stale memberships when the server returns nothing and the store has no party', async () => {
        getMyActivePartyApi.mockResolvedValueOnce(null);
        await usePartyStore.getState().hydrateActiveParty('char-1');
        expect(deleteMyStaleMembershipsApi).toHaveBeenCalledWith('char-1');
    });

    it('does not clobber a locally-loaded party when API throws', async () => {
        usePartyStore.setState({
            party: { id: 'local-party', leaderId: 'char-1', members: [], createdAt: 'x' },
            loading: false,
            error: null,
            publicParties: [],
        });
        getMyActivePartyApi.mockRejectedValueOnce(new Error('offline'));
        await usePartyStore.getState().hydrateActiveParty('char-1');
        // Non-fatal: keeps whatever we had.
        expect(usePartyStore.getState().party!.id).toBe('local-party');
    });
});

// ── refreshPublicParties ─────────────────────────────────────────────────────

describe('refreshPublicParties', () => {
    it('fills publicParties on success', async () => {
        const rows = [makeServerParty({ id: 'p-1' }), makeServerParty({ id: 'p-2' })];
        listPublicPartiesApi.mockResolvedValueOnce(rows);
        await usePartyStore.getState().refreshPublicParties();
        const state = usePartyStore.getState();
        expect(state.publicParties).toHaveLength(2);
        expect(state.loading).toBe(false);
        expect(state.error).toBeNull();
    });

    it('records an error and clears loading on failure', async () => {
        listPublicPartiesApi.mockRejectedValueOnce(new Error('server down'));
        await usePartyStore.getState().refreshPublicParties();
        const state = usePartyStore.getState();
        expect(state.loading).toBe(false);
        expect(state.error).toBe('server down');
    });
});

// ── addBotHelper ─────────────────────────────────────────────────────────────

describe('addBotHelper', () => {
    it('is a no-op when no party is loaded', () => {
        usePartyStore.getState().addBotHelper();
        // No party means no bot — nothing to assert on the store other than
        // it didn't throw. isOfflineMode shouldn't be invoked either (early
        // return triggers before the import).
        expect(usePartyStore.getState().party).toBeNull();
    });
});

// TODO: subscribePublicFeed / subscribeToActiveParty wire Supabase Realtime
// callbacks; covered indirectly via the mocked partyApi factories. A direct
// test would need to capture the callbacks passed in and replay them, which
// is best done in an integration test with the real realtime layer (out
// of scope for the store unit test).
//
// TODO: addBotHelper happy path needs a partial dynamic-import await on
// './connectivityStore', and the test framework's microtask scheduling
// makes that flaky here. The no-party guard above is the most valuable
// branch to lock down at unit level.
