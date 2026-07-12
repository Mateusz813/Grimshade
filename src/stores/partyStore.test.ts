import { describe, it, expect, beforeEach, vi } from 'vitest';


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
    backendState,
    backendCreateParty,
    backendJoinParty,
    backendLeaveParty,
    backendKickParty,
    backendUpdateParty,
    backendHandoverParty,
    backendMyActiveParty,
    backendListPublicParties,
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
    backendState: { on: false },
    backendCreateParty: vi.fn(),
    backendJoinParty: vi.fn(),
    backendLeaveParty: vi.fn().mockResolvedValue({ ok: true, dissolved: true, party: null }),
    backendKickParty: vi.fn(),
    backendUpdateParty: vi.fn(),
    backendHandoverParty: vi.fn(),
    backendMyActiveParty: vi.fn(),
    backendListPublicParties: vi.fn(),
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

vi.mock('./offlineHuntStore', () => ({
    useOfflineHuntStore: {
        getState: () => ({ isActive: offlineHuntIsActive.value }),
    },
}));

vi.mock('./connectivityStore', () => ({
    isOfflineMode: isOfflineModeMock,
}));

vi.mock('../config/backendMode', () => ({
    isBackendMode: () => backendState.on,
}));
vi.mock('../api/backend/backendApi', () => ({
    backendApi: {
        createParty: backendCreateParty,
        joinParty: backendJoinParty,
        leaveParty: backendLeaveParty,
        kickParty: backendKickParty,
        updateParty: backendUpdateParty,
        handoverParty: backendHandoverParty,
        myActiveParty: backendMyActiveParty,
        listPublicParties: backendListPublicParties,
    },
}));
vi.mock('./characterStore', () => ({
    useCharacterStore: {
        getState: () => ({ character: { id: 'char-1' } }),
    },
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
    backendState.on = false;
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
        backendCreateParty,
        backendJoinParty,
        backendLeaveParty,
        backendKickParty,
        backendUpdateParty,
        backendHandoverParty,
        backendMyActiveParty,
        backendListPublicParties,
    ].forEach((fn) => fn.mockClear());
    backendLeaveParty.mockResolvedValue({ ok: true, dissolved: true, party: null });
});


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

    it('allows creating a party while an offline hunt is running (owner request 2026-07-11)', async () => {
        offlineHuntIsActive.value = true;
        createPartyApi.mockResolvedValueOnce(makeServerParty({ id: 'party-oh' }));
        await usePartyStore.getState().createParty(SELF, {
            name: 'x', description: '', password: null, isPublic: true,
        });
        expect(createPartyApi).toHaveBeenCalled();
        const state = usePartyStore.getState();
        expect(state.party!.id).toBe('party-oh');
        expect(state.error).toBeNull();
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


describe('joinPartyById', () => {
    it('stores the party on a successful join', async () => {
        joinPartyApi.mockResolvedValueOnce(makeServerParty({ id: 'party-2' }));
        await usePartyStore.getState().joinPartyById('party-2', SELF);
        expect(usePartyStore.getState().party!.id).toBe('party-2');
    });

    it('allows joining a party while an offline hunt is running (owner request 2026-07-11)', async () => {
        offlineHuntIsActive.value = true;
        joinPartyApi.mockResolvedValueOnce(makeServerParty({ id: 'party-2' }));
        await usePartyStore.getState().joinPartyById('party-2', SELF);
        expect(joinPartyApi).toHaveBeenCalled();
        expect(usePartyStore.getState().party!.id).toBe('party-2');
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
        expect(usePartyStore.getState().party).toBeNull();
    });
});


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

    it('preserves local-only bot helpers when the server returns a party without bots', async () => {
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
        getMyActivePartyApi.mockResolvedValueOnce(makeServerParty({ id: 'party-1' }));
        await usePartyStore.getState().hydrateActiveParty('char-1');
        const members = usePartyStore.getState().party!.members;
        expect(members.some((m) => m.isBot && m.id === 'bot-1')).toBe(true);
        expect(members.filter((m) => m.isBot)).toHaveLength(1);
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
        expect(usePartyStore.getState().party!.id).toBe('local-party');
    });
});


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


describe('addBotHelper', () => {
    it('is a no-op when no party is loaded', () => {
        usePartyStore.getState().addBotHelper();
        expect(usePartyStore.getState().party).toBeNull();
    });
});


describe('backend mode', () => {
    const setActiveParty = (overrides?: Parameters<typeof makeServerParty>[0]) => {
        usePartyStore.setState({
            party: adaptForStore(makeServerParty(overrides)),
            loading: false,
            error: null,
            publicParties: [],
        });
    };
    const adaptForStore = (raw: IPartyWithMembers) => ({
        id: raw.id,
        leaderId: raw.leader_id,
        members: raw.members.map((m) => ({
            id: m.character_id,
            name: m.character_name,
            class: m.character_class,
            level: m.character_level,
            hp: 0,
            maxHp: 1,
            isOnline: true,
        })),
        createdAt: raw.created_at,
        name: raw.name,
        description: raw.description ?? '',
        hasPassword: raw.has_password,
        isPublic: raw.is_public,
        maxMembers: raw.max_members,
        minJoinLevel: raw.min_join_level ?? 1,
    });

    describe('createParty', () => {
        it('routes through backendApi.createParty and skips the Supabase write', async () => {
            backendState.on = true;
            backendCreateParty.mockResolvedValueOnce(makeServerParty({ id: 'be-party' }));
            await usePartyStore.getState().createParty(SELF, {
                name: 'BE', description: 'hi', password: null, isPublic: true, minJoinLevel: 5,
            });
            expect(backendCreateParty).toHaveBeenCalledWith('char-1', {
                name: 'BE', description: 'hi', password: null, isPublic: true, minJoinLevel: 5,
            });
            expect(createPartyApi).not.toHaveBeenCalled();
            expect(usePartyStore.getState().party!.id).toBe('be-party');
            expect(usePartyStore.getState().loading).toBe(false);
        });

        it('allows creating a party during an offline hunt in backend mode (owner request 2026-07-11)', async () => {
            backendState.on = true;
            offlineHuntIsActive.value = true;
            backendCreateParty.mockResolvedValueOnce(makeServerParty({ id: 'be-oh' }));
            await usePartyStore.getState().createParty(SELF, {
                name: 'x', description: '', password: null, isPublic: true,
            });
            expect(backendCreateParty).toHaveBeenCalled();
            expect(usePartyStore.getState().party!.id).toBe('be-oh');
        });

        it('surfaces the backend error and leaves party=null on failure', async () => {
            backendState.on = true;
            backendCreateParty.mockRejectedValueOnce(new Error('be boom'));
            await usePartyStore.getState().createParty(SELF, {
                name: 'x', description: '', password: null, isPublic: true,
            });
            expect(usePartyStore.getState().party).toBeNull();
            expect(usePartyStore.getState().error).toBe('be boom');
        });

        it('flag OFF still runs the legacy partyApi path', async () => {
            createPartyApi.mockResolvedValueOnce(makeServerParty());
            await usePartyStore.getState().createParty(SELF, {
                name: 'x', description: '', password: null, isPublic: true,
            });
            expect(createPartyApi).toHaveBeenCalled();
            expect(backendCreateParty).not.toHaveBeenCalled();
        });
    });

    describe('joinPartyById', () => {
        it('routes through backendApi.joinParty(charId, partyId, password) and skips Supabase', async () => {
            backendState.on = true;
            backendJoinParty.mockResolvedValueOnce(makeServerParty({ id: 'joined' }));
            await usePartyStore.getState().joinPartyById('joined', SELF, 'secret');
            expect(backendJoinParty).toHaveBeenCalledWith('char-1', 'joined', 'secret');
            expect(joinPartyApi).not.toHaveBeenCalled();
            expect(usePartyStore.getState().party!.id).toBe('joined');
        });

        it('records the backend error via extractApiError', async () => {
            backendState.on = true;
            backendJoinParty.mockRejectedValueOnce(new Error('full'));
            await usePartyStore.getState().joinPartyById('joined', SELF);
            expect(usePartyStore.getState().error).toBe('full');
            expect(usePartyStore.getState().party).toBeNull();
        });
    });

    describe('leaveParty', () => {
        it('clears local party + calls backendApi.leaveParty(charId, partyId), skips Supabase', async () => {
            backendState.on = true;
            setActiveParty();
            await usePartyStore.getState().leaveParty('char-1');
            expect(backendLeaveParty).toHaveBeenCalledWith('char-1', 'party-1');
            expect(leavePartyApi).not.toHaveBeenCalled();
            expect(usePartyStore.getState().party).toBeNull();
        });

        it('clears local state even when the backend call rejects', async () => {
            backendState.on = true;
            setActiveParty();
            backendLeaveParty.mockRejectedValueOnce(new Error('nope'));
            await usePartyStore.getState().leaveParty('char-1');
            expect(usePartyStore.getState().party).toBeNull();
        });
    });

    describe('disbandParty', () => {
        it('calls backendApi.leaveParty and sets party null (dissolved response)', async () => {
            backendState.on = true;
            setActiveParty();
            await usePartyStore.getState().disbandParty('char-1');
            expect(backendLeaveParty).toHaveBeenCalledWith('char-1', 'party-1');
            expect(leavePartyApi).not.toHaveBeenCalled();
            expect(usePartyStore.getState().party).toBeNull();
        });
    });

    describe('kickByRowId', () => {
        it('calls backendApi.kickParty(leaderId, partyId, rowId) and applies the snapshot', async () => {
            backendState.on = true;
            setActiveParty();
            backendKickParty.mockResolvedValueOnce(makeServerParty({ id: 'party-1' }));
            await usePartyStore.getState().kickByRowId('pm-2');
            expect(backendKickParty).toHaveBeenCalledWith('char-1', 'party-1', 'pm-2');
            expect(kickMemberApi).not.toHaveBeenCalled();
        });

        it('records the backend error without throwing', async () => {
            backendState.on = true;
            setActiveParty();
            backendKickParty.mockRejectedValueOnce(new Error('forbidden'));
            await usePartyStore.getState().kickByRowId('pm-2');
            expect(usePartyStore.getState().error).toBe('forbidden');
        });
    });

    describe('updateMeta', () => {
        it('calls backendApi.updateParty(leaderId, partyId, patch) mapping null password to ""', async () => {
            backendState.on = true;
            setActiveParty();
            backendUpdateParty.mockResolvedValueOnce(makeServerParty({ id: 'party-1', description: 'new' }));
            await usePartyStore.getState().updateMeta({ description: 'new', password: null, isPublic: false });
            expect(backendUpdateParty).toHaveBeenCalledWith('char-1', 'party-1', {
                description: 'new', isPublic: false, password: '',
            });
            expect(updatePartyMetaApi).not.toHaveBeenCalled();
            expect(usePartyStore.getState().party!.description).toBe('new');
        });
    });

    describe('transferLeadership', () => {
        it('optimistically flips, then applies backendApi.handoverParty snapshot; skips Supabase', async () => {
            backendState.on = true;
            setActiveParty();
            backendHandoverParty.mockResolvedValueOnce(makeServerParty({ id: 'party-1', leader_id: 'char-2' }));
            await usePartyStore.getState().transferLeadership('char-2');
            expect(backendHandoverParty).toHaveBeenCalledWith('char-1', 'party-1', 'char-2');
            expect(transferLeadershipApi).not.toHaveBeenCalled();
            expect(usePartyStore.getState().party!.leaderId).toBe('char-2');
        });

        it('rolls back to the previous party on backend failure', async () => {
            backendState.on = true;
            setActiveParty();
            const before = usePartyStore.getState().party;
            backendHandoverParty.mockRejectedValueOnce(new Error('not leader'));
            await usePartyStore.getState().transferLeadership('char-2');
            expect(usePartyStore.getState().party).toEqual(before);
            expect(usePartyStore.getState().error).toBe('not leader');
        });
    });

    describe('hydrateActiveParty', () => {
        it('adopts the backend /active snapshot and skips stale-membership deletes', async () => {
            backendState.on = true;
            backendMyActiveParty.mockResolvedValueOnce(makeServerParty({ id: 'restored' }));
            await usePartyStore.getState().hydrateActiveParty('char-1');
            expect(backendMyActiveParty).toHaveBeenCalledWith('char-1');
            expect(getMyActivePartyApi).not.toHaveBeenCalled();
            expect(deleteMyStaleMembershipsApi).not.toHaveBeenCalled();
            expect(usePartyStore.getState().party!.id).toBe('restored');
        });

        it('clears the local party when the server reports no active party', async () => {
            backendState.on = true;
            setActiveParty();
            backendMyActiveParty.mockResolvedValueOnce(null);
            await usePartyStore.getState().hydrateActiveParty('char-1');
            expect(usePartyStore.getState().party).toBeNull();
            expect(deleteMyStaleMembershipsApi).not.toHaveBeenCalled();
        });
    });

    describe('refreshPublicParties', () => {
        it('fills publicParties from backendApi.listPublicParties, skips Supabase', async () => {
            backendState.on = true;
            backendListPublicParties.mockResolvedValueOnce([makeServerParty({ id: 'p-1' })]);
            await usePartyStore.getState().refreshPublicParties();
            expect(backendListPublicParties).toHaveBeenCalled();
            expect(listPublicPartiesApi).not.toHaveBeenCalled();
            expect(usePartyStore.getState().publicParties).toHaveLength(1);
            expect(usePartyStore.getState().loading).toBe(false);
        });
    });

    describe('subscribePublicFeed', () => {
        it('returns a poller (no supabase.channel) and does an initial backend fetch', () => {
            backendState.on = true;
            backendListPublicParties.mockResolvedValue([]);
            const unsub = usePartyStore.getState().subscribePublicFeed();
            expect(subscribePublicFeedApi).not.toHaveBeenCalled();
            expect(backendListPublicParties).toHaveBeenCalled();
            expect(typeof unsub).toBe('function');
            unsub();
        });
    });

    describe('subscribeToActiveParty', () => {
        it('returns a poller cleanup fn and does NOT open a supabase channel', () => {
            backendState.on = true;
            setActiveParty();
            const unsub = usePartyStore.getState().subscribeToActiveParty();
            expect(subscribePartyApi).not.toHaveBeenCalled();
            expect(typeof unsub).toBe('function');
            unsub();
        });
    });
});

