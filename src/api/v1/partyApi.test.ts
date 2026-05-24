/**
 * Tests for partyApi — multiplayer party CRUD with schema-tolerant fallbacks.
 *
 * partyApi is the most complex API in the project — it has to cope with
 * THREE possible schema states:
 *   1. Fully migrated (description / password / is_public / min_join_level columns + RLS).
 *   2. Partially migrated (some columns missing → schema-missing errors).
 *   3. Pre-migration (no extended columns, RLS may block).
 *
 * We mock the underlying axios instance + supabase here so we can:
 * - Assert URL/payload shape for the happy path (extended schema).
 * - Simulate PGRST204 / 400 / 401 errors and verify the fallback branches.
 * - Verify the `insertMemberWithRetry` strips missing columns and retries.
 * - Verify free helpers (extractApiError, PartyMigrationMissingError).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AxiosError } from 'axios';

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
import {
    partyApi,
    extractApiError,
    PartyMigrationMissingError,
} from './partyApi';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockApi = api as unknown as Record<string, any>;
const mkRes = <T>(data: T) => ({ data });

beforeEach(() => {
    vi.clearAllMocks();
});

const makeAxiosError = (status: number, data?: unknown, config?: { url?: string }): AxiosError => {
    const err = new AxiosError('Request failed');
    err.isAxiosError = true;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    err.response = { status, data, statusText: '', headers: {}, config: {} as any };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    err.config = (config ?? {}) as any;
    return err;
};

// ── extractApiError ──────────────────────────────────────────────────────

describe('extractApiError', () => {
    it('returns the message field from PostgREST JSON', () => {
        const err = makeAxiosError(400, { message: 'duplicate key', details: 'id=42' });
        expect(extractApiError(err)).toBe('duplicate key (id=42)');
    });

    it('handles message without details/hint', () => {
        const err = makeAxiosError(400, { message: 'plain message' });
        expect(extractApiError(err)).toBe('plain message');
    });

    it('falls back to axios message when no JSON body', () => {
        const err = makeAxiosError(500, undefined);
        expect(extractApiError(err)).toBe('Request failed');
    });

    it('handles plain Error inputs', () => {
        expect(extractApiError(new Error('boom'))).toBe('boom');
    });

    it('handles non-error inputs', () => {
        expect(extractApiError('something')).toBe('Nieznany błąd.');
    });
});

// ── PartyMigrationMissingError ────────────────────────────────────────────

describe('PartyMigrationMissingError', () => {
    it('produces the schema-missing prefix', () => {
        const err = new PartyMigrationMissingError('schema', 'underlying msg');
        expect(err.name).toBe('PartyMigrationMissingError');
        expect(err.message).toContain('Brak kolumn');
        expect(err.message).toContain('underlying msg');
    });

    it('produces the RLS-parties prefix', () => {
        const err = new PartyMigrationMissingError('rls', 'denied');
        expect(err.message).toContain('Brak uprawnień do tabeli `parties`');
    });

    it('produces the RLS-members prefix', () => {
        const err = new PartyMigrationMissingError('rls-members', 'denied');
        expect(err.message).toContain('Brak uprawnień do tabeli `party_members`');
    });
});

// ── listPublicParties ─────────────────────────────────────────────────────

describe('partyApi.listPublicParties', () => {
    it('queries with the full schema first and returns sanitized parties', async () => {
        const rawRow = {
            id: 'p1',
            leader_id: 'c1',
            name: 'Test Party',
            description: 'Casual',
            max_members: 4,
            is_public: true,
            password: null,
            created_at: new Date().toISOString(),
            min_join_level: 1,
            party_members: [
                { id: 'm1', party_id: 'p1', character_id: 'c1', character_name: 'Alice', character_class: 'Knight', character_level: 10, joined_at: '2026-01-01' },
            ],
        };
        mockApi.get.mockResolvedValueOnce(mkRes([rawRow]));

        const result = await partyApi.listPublicParties();

        const url = mockApi.get.mock.calls[0][0] as string;
        expect(url).toContain('/rest/v1/parties');
        expect(url).toContain('select=');
        expect(url).toContain('party_members(');
        // Password stripped from output.
        expect(result[0]).not.toHaveProperty('password');
        expect(result[0].has_password).toBe(false);
        expect(result[0].members).toHaveLength(1);
    });

    it('marks has_password=true when the row has a non-null password', async () => {
        const rawRow = {
            id: 'p1',
            leader_id: 'c1',
            name: 'Locked',
            description: '',
            max_members: 4,
            is_public: true,
            password: 'secret',
            created_at: new Date().toISOString(),
            party_members: [{ id: 'm1', party_id: 'p1', character_id: 'c1', character_name: 'A', character_class: 'Knight', character_level: 5, joined_at: '2026-01-01' }],
        };
        mockApi.get.mockResolvedValueOnce(mkRes([rawRow]));
        const result = await partyApi.listPublicParties();
        expect(result[0].has_password).toBe(true);
        expect(result[0]).not.toHaveProperty('password');
    });

    it('defaults missing description to empty string and min_join_level to 1', async () => {
        const rawRow = {
            id: 'p1',
            leader_id: 'c1',
            name: 'Legacy',
            max_members: 4,
            created_at: new Date().toISOString(),
            party_members: [{ id: 'm1', party_id: 'p1', character_id: 'c1', character_name: 'A', character_class: 'Knight', character_level: 5, joined_at: '2026-01-01' }],
        };
        mockApi.get.mockResolvedValueOnce(mkRes([rawRow]));
        const result = await partyApi.listPublicParties();
        expect(result[0].description).toBe('');
        expect(result[0].min_join_level).toBe(1);
    });
});

// ── getPartyWithMembers ───────────────────────────────────────────────────

describe('partyApi.getPartyWithMembers', () => {
    it('returns sanitized party with members', async () => {
        const rawRow = {
            id: 'p1',
            leader_id: 'c1',
            name: 'X',
            description: 'Y',
            max_members: 4,
            is_public: true,
            password: null,
            created_at: '2026-05-21',
            min_join_level: 5,
            party_members: [
                { id: 'm1', party_id: 'p1', character_id: 'c1', character_name: 'A', character_class: 'Knight', character_level: 10, joined_at: '2026' },
            ],
        };
        mockApi.get.mockResolvedValueOnce(mkRes([rawRow]));
        const result = await partyApi.getPartyWithMembers('p1');
        expect(result?.id).toBe('p1');
        expect(result?.min_join_level).toBe(5);
        expect(result?.members).toHaveLength(1);
    });

    it('returns null when no party matches', async () => {
        mockApi.get.mockResolvedValueOnce(mkRes([]));
        const result = await partyApi.getPartyWithMembers('missing');
        expect(result).toBeNull();
    });

    it('URL-encodes the party id', async () => {
        mockApi.get.mockResolvedValueOnce(mkRes([]));
        await partyApi.getPartyWithMembers('p/1');
        const url = mockApi.get.mock.calls[0][0] as string;
        expect(url).toContain(encodeURIComponent('p/1'));
    });
});

// ── getMyActiveParty ──────────────────────────────────────────────────────

describe('partyApi.getMyActiveParty', () => {
    it('resolves the membership lookup to the full party row', async () => {
        // First GET: membership lookup.
        // Second GET: full party.
        mockApi.get
            .mockResolvedValueOnce(mkRes([{ party_id: 'p1' }]))
            .mockResolvedValueOnce(mkRes([{
                id: 'p1', leader_id: 'c1', name: 'X',
                description: '', max_members: 4, is_public: true, password: null,
                created_at: '2026-01-01',
                party_members: [],
            }]));
        const result = await partyApi.getMyActiveParty('c1');
        expect(result?.id).toBe('p1');
    });

    it('returns null when character has no active party', async () => {
        mockApi.get.mockResolvedValueOnce(mkRes([]));
        const result = await partyApi.getMyActiveParty('lonely');
        expect(result).toBeNull();
    });

    it('returns null and swallows when the membership query throws', async () => {
        mockApi.get.mockRejectedValueOnce(new Error('network'));
        const result = await partyApi.getMyActiveParty('c1');
        expect(result).toBeNull();
    });
});

// ── deleteMyStaleMemberships ─────────────────────────────────────────────

describe('partyApi.deleteMyStaleMemberships', () => {
    it('issues DELETE on party_members filtered by character_id', async () => {
        mockApi.delete.mockResolvedValueOnce(mkRes(undefined));
        await partyApi.deleteMyStaleMemberships('c1');
        const url = mockApi.delete.mock.calls[0][0] as string;
        expect(url).toContain('party_members?character_id=eq.c1');
    });

    it('swallows errors silently', async () => {
        mockApi.delete.mockRejectedValueOnce(new Error('RLS'));
        await expect(partyApi.deleteMyStaleMemberships('c1')).resolves.toBeUndefined();
    });
});

// ── createParty ────────────────────────────────────────────────────────────

describe('partyApi.createParty', () => {
    it('inserts party + leader member then fetches the full row', async () => {
        // 1) party insert succeeds.
        mockApi.post
            .mockResolvedValueOnce(mkRes([{ id: 'p1', leader_id: 'c1', name: 'X', description: '', max_members: 4, is_public: true, password: null, created_at: '2026' }]))
            // 2) member insert succeeds.
            .mockResolvedValueOnce(mkRes([]));
        // 3) cleanup delete for stale memberships.
        mockApi.delete.mockResolvedValueOnce(mkRes(undefined));
        // 4) getPartyWithMembers re-fetch.
        mockApi.get.mockResolvedValueOnce(mkRes([{
            id: 'p1', leader_id: 'c1', name: 'X', description: '', max_members: 4, is_public: true, password: null, created_at: '2026',
            party_members: [{ id: 'm1', party_id: 'p1', character_id: 'c1', character_name: 'Alice', character_class: 'Knight', character_level: 10, joined_at: '2026' }],
        }]));

        const result = await partyApi.createParty({
            leaderId: 'c1',
            name: 'My Party',
            description: 'Hi',
            password: null,
            isPublic: true,
            partyId: '', // ignored by createParty — it generates its own id
            characterId: 'c1',
            characterName: 'Alice',
            characterClass: 'Knight',
            characterLevel: 10,
        });

        expect(result?.id).toBe('p1');
        // First post: party row, with the extended fields.
        const [partyUrl, partyBody] = mockApi.post.mock.calls[0];
        expect(partyUrl).toBe('/rest/v1/parties');
        expect(partyBody).toMatchObject({
            leader_id: 'c1',
            name: 'My Party',
            description: 'Hi',
            is_public: true,
            max_members: 4,
        });
        // Second post: member row.
        const [memberUrl, memberBody] = mockApi.post.mock.calls[1];
        expect(memberUrl).toBe('/rest/v1/party_members');
        expect(memberBody).toMatchObject({
            party_id: 'p1',
            character_id: 'c1',
            character_name: 'Alice',
            character_class: 'Knight',
            character_level: 10,
        });
    });

    it('truncates description to 140 chars and name to 40 chars', async () => {
        mockApi.post
            .mockResolvedValueOnce(mkRes([{ id: 'p1', leader_id: 'c1', name: '', description: '', max_members: 4, is_public: true, password: null, created_at: '2026' }]))
            .mockResolvedValueOnce(mkRes([]));
        mockApi.delete.mockResolvedValueOnce(mkRes(undefined));
        mockApi.get.mockResolvedValueOnce(mkRes([{
            id: 'p1', leader_id: 'c1', name: '', description: '', max_members: 4, is_public: true, password: null, created_at: '2026',
            party_members: [],
        }]));

        await partyApi.createParty({
            leaderId: 'c1',
            name: 'X'.repeat(80),
            description: 'D'.repeat(300),
            password: null,
            isPublic: true,
            partyId: '',
            characterId: 'c1',
            characterName: 'A',
            characterClass: 'Knight',
            characterLevel: 1,
        });
        const partyBody = mockApi.post.mock.calls[0][1];
        expect((partyBody.name as string).length).toBe(40);
        expect((partyBody.description as string).length).toBe(140);
    });

    it('preserves min_join_level=1 when not specified', async () => {
        mockApi.post
            .mockResolvedValueOnce(mkRes([{ id: 'p1', leader_id: 'c1', name: 'X', description: '', max_members: 4, is_public: true, password: null, created_at: '2026' }]))
            .mockResolvedValueOnce(mkRes([]));
        mockApi.delete.mockResolvedValueOnce(mkRes(undefined));
        mockApi.get.mockResolvedValueOnce(mkRes([{
            id: 'p1', leader_id: 'c1', name: 'X', description: '', max_members: 4, is_public: true, password: null, created_at: '2026',
            party_members: [],
        }]));
        await partyApi.createParty({
            leaderId: 'c1', name: 'X', description: '', password: null, isPublic: true,
            partyId: '',
            characterId: 'c1', characterName: 'A', characterClass: 'Knight', characterLevel: 1,
        });
        const partyBody = mockApi.post.mock.calls[0][1];
        expect(partyBody.min_join_level).toBe(1);
    });

    it('passes through provided min_join_level > 1', async () => {
        mockApi.post
            .mockResolvedValueOnce(mkRes([{ id: 'p1', leader_id: 'c1', name: 'X', description: '', max_members: 4, is_public: true, password: null, created_at: '2026' }]))
            .mockResolvedValueOnce(mkRes([]));
        mockApi.delete.mockResolvedValueOnce(mkRes(undefined));
        mockApi.get.mockResolvedValueOnce(mkRes([{
            id: 'p1', leader_id: 'c1', name: 'X', description: '', max_members: 4, is_public: true, password: null, created_at: '2026',
            party_members: [],
        }]));
        await partyApi.createParty({
            leaderId: 'c1', name: 'X', description: '', password: null, isPublic: true,
            minJoinLevel: 50,
            partyId: '',
            characterId: 'c1', characterName: 'A', characterClass: 'Knight', characterLevel: 60,
        });
        const partyBody = mockApi.post.mock.calls[0][1];
        expect(partyBody.min_join_level).toBe(50);
    });

    it('passes password through to insert when provided', async () => {
        mockApi.post
            .mockResolvedValueOnce(mkRes([{ id: 'p1', leader_id: 'c1', name: 'X', description: '', max_members: 4, is_public: true, password: 'secret', created_at: '2026' }]))
            .mockResolvedValueOnce(mkRes([]));
        mockApi.delete.mockResolvedValueOnce(mkRes(undefined));
        mockApi.get.mockResolvedValueOnce(mkRes([{
            id: 'p1', leader_id: 'c1', name: 'X', description: '', max_members: 4, is_public: true, password: 'secret', created_at: '2026',
            party_members: [],
        }]));
        await partyApi.createParty({
            leaderId: 'c1', name: 'X', description: '', password: 'secret', isPublic: false,
            partyId: '',
            characterId: 'c1', characterName: 'A', characterClass: 'Knight', characterLevel: 1,
        });
        const partyBody = mockApi.post.mock.calls[0][1];
        expect(partyBody.password).toBe('secret');
    });

    it('coerces empty password string to null', async () => {
        mockApi.post
            .mockResolvedValueOnce(mkRes([{ id: 'p1', leader_id: 'c1', name: 'X', description: '', max_members: 4, is_public: true, password: null, created_at: '2026' }]))
            .mockResolvedValueOnce(mkRes([]));
        mockApi.delete.mockResolvedValueOnce(mkRes(undefined));
        mockApi.get.mockResolvedValueOnce(mkRes([{
            id: 'p1', leader_id: 'c1', name: 'X', description: '', max_members: 4, is_public: true, password: null, created_at: '2026',
            party_members: [],
        }]));
        await partyApi.createParty({
            leaderId: 'c1', name: 'X', description: '', password: '', isPublic: true,
            partyId: '',
            characterId: 'c1', characterName: 'A', characterClass: 'Knight', characterLevel: 1,
        });
        const partyBody = mockApi.post.mock.calls[0][1];
        expect(partyBody.password).toBeNull();
    });

    it('throws a friendly migration error on RLS permission denied for parties insert', async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rlsErr = makeAxiosError(403, { code: '42501', message: 'permission denied for table parties' });
        mockApi.post.mockRejectedValueOnce(rlsErr);
        await expect(partyApi.createParty({
            leaderId: 'c1', name: 'X', description: '', password: null, isPublic: true,
            partyId: '',
            characterId: 'c1', characterName: 'A', characterClass: 'Knight', characterLevel: 1,
        })).rejects.toBeInstanceOf(PartyMigrationMissingError);
    });

    it('returns null when party insert returns empty array', async () => {
        mockApi.post.mockResolvedValueOnce(mkRes([]));
        const result = await partyApi.createParty({
            leaderId: 'c1', name: 'X', description: '', password: null, isPublic: true,
            partyId: '',
            characterId: 'c1', characterName: 'A', characterClass: 'Knight', characterLevel: 1,
        });
        expect(result).toBeNull();
    });

    it('throws a friendly migration error on RLS denial for member insert', async () => {
        mockApi.post
            // party insert OK
            .mockResolvedValueOnce(mkRes([{ id: 'p1', leader_id: 'c1', name: 'X', description: '', max_members: 4, is_public: true, password: null, created_at: '2026' }]))
            // member insert fails with RLS
            .mockRejectedValueOnce(makeAxiosError(403, { code: '42501', message: 'new row violates row-level security' }));
        mockApi.delete
            .mockResolvedValueOnce(mkRes(undefined)) // stale cleanup
            .mockResolvedValueOnce(mkRes(undefined)); // best-effort rollback
        const consoleErr = vi.spyOn(console, 'error').mockImplementation(() => {});

        await expect(partyApi.createParty({
            leaderId: 'c1', name: 'X', description: '', password: null, isPublic: true,
            partyId: '',
            characterId: 'c1', characterName: 'A', characterClass: 'Knight', characterLevel: 1,
        })).rejects.toBeInstanceOf(PartyMigrationMissingError);
        consoleErr.mockRestore();
    });

    it('retries member insert dropping columns when PGRST204 fires', async () => {
        mockApi.post
            // party insert OK
            .mockResolvedValueOnce(mkRes([{ id: 'p1', leader_id: 'c1', name: 'X', description: '', max_members: 4, is_public: true, password: null, created_at: '2026' }]))
            // first member insert fails: missing 'character_class' column
            .mockRejectedValueOnce(makeAxiosError(400, {
                code: 'PGRST204',
                message: "Could not find the 'character_class' column of 'party_members' in the schema cache",
            }))
            // retry succeeds
            .mockResolvedValueOnce(mkRes([]));
        mockApi.delete.mockResolvedValueOnce(mkRes(undefined));
        mockApi.get.mockResolvedValueOnce(mkRes([{
            id: 'p1', leader_id: 'c1', name: 'X', description: '', max_members: 4, is_public: true, password: null, created_at: '2026',
            party_members: [],
        }]));
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        const result = await partyApi.createParty({
            leaderId: 'c1', name: 'X', description: '', password: null, isPublic: true,
            partyId: '',
            characterId: 'c1', characterName: 'A', characterClass: 'Knight', characterLevel: 1,
        });
        expect(result?.id).toBe('p1');
        // Retry payload should not have character_class.
        const retryBody = mockApi.post.mock.calls[2][1];
        expect(retryBody).not.toHaveProperty('character_class');
        expect(retryBody.character_id).toBe('c1');
        warn.mockRestore();
    });
});

// ── joinParty ─────────────────────────────────────────────────────────────

describe('partyApi.joinParty', () => {
    const baseInput = {
        partyId: 'p1',
        characterId: 'c2',
        characterName: 'Bob',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        characterClass: 'Mage' as any,
        characterLevel: 10,
    };

    it('returns error when the party row is missing', async () => {
        mockApi.get.mockResolvedValueOnce(mkRes([]));
        const result = await partyApi.joinParty({ ...baseInput });
        expect(result).toEqual({ error: 'Party nie istnieje.' });
    });

    it('returns "wrong password" error when password mismatch', async () => {
        mockApi.get.mockResolvedValueOnce(mkRes([{
            id: 'p1', leader_id: 'c1', name: 'X', description: '',
            max_members: 4, is_public: true, password: 'right', created_at: '2026',
        }]));
        const result = await partyApi.joinParty({ ...baseInput, password: 'wrong' });
        expect(result).toEqual({ error: 'Nieprawidłowe hasło.' });
    });

    it('returns minimum-level error when character is too low', async () => {
        mockApi.get.mockResolvedValueOnce(mkRes([{
            id: 'p1', leader_id: 'c1', name: 'X', description: '',
            max_members: 4, is_public: true, password: null, created_at: '2026',
            min_join_level: 50,
        }]));
        const result = await partyApi.joinParty({ ...baseInput, characterLevel: 10 });
        expect(result).toEqual({ error: 'To party wymaga poziomu 50+.' });
    });

    it('returns full error when party is at capacity', async () => {
        // First GET: party detail (no password gate).
        mockApi.get.mockResolvedValueOnce(mkRes([{
            id: 'p1', leader_id: 'c1', name: 'X', description: '',
            max_members: 2, is_public: true, password: null, created_at: '2026',
        }]));
        // Second GET: full party with members (already at capacity).
        mockApi.get.mockResolvedValueOnce(mkRes([{
            id: 'p1', leader_id: 'c1', name: 'X', description: '',
            max_members: 2, is_public: true, password: null, created_at: '2026',
            party_members: [
                { id: 'm1', party_id: 'p1', character_id: 'x', character_name: 'X', character_class: 'Knight', character_level: 1, joined_at: '2026' },
                { id: 'm2', party_id: 'p1', character_id: 'y', character_name: 'Y', character_class: 'Mage', character_level: 1, joined_at: '2026' },
            ],
        }]));
        const result = await partyApi.joinParty({ ...baseInput });
        expect(result).toEqual({ error: 'Party jest pełne.' });
    });

    it('returns existing party when character already a member', async () => {
        mockApi.get.mockResolvedValueOnce(mkRes([{
            id: 'p1', leader_id: 'c1', name: 'X', description: '',
            max_members: 4, is_public: true, password: null, created_at: '2026',
        }]));
        mockApi.get.mockResolvedValueOnce(mkRes([{
            id: 'p1', leader_id: 'c1', name: 'X', description: '',
            max_members: 4, is_public: true, password: null, created_at: '2026',
            party_members: [
                { id: 'm-x', party_id: 'p1', character_id: 'c2', character_name: 'Bob', character_class: 'Mage', character_level: 10, joined_at: '2026' },
            ],
        }]));
        const result = await partyApi.joinParty({ ...baseInput });
        expect((result as { id?: string }).id).toBe('p1');
    });

    it('inserts member and returns full party on success', async () => {
        mockApi.get.mockResolvedValueOnce(mkRes([{
            id: 'p1', leader_id: 'c1', name: 'X', description: '',
            max_members: 4, is_public: true, password: null, created_at: '2026',
        }]));
        // existing.members empty
        mockApi.get.mockResolvedValueOnce(mkRes([{
            id: 'p1', leader_id: 'c1', name: 'X', description: '',
            max_members: 4, is_public: true, password: null, created_at: '2026',
            party_members: [],
        }]));
        // insertMemberWithRetry → post
        mockApi.post.mockResolvedValueOnce(mkRes([]));
        // final getPartyWithMembers
        mockApi.get.mockResolvedValueOnce(mkRes([{
            id: 'p1', leader_id: 'c1', name: 'X', description: '',
            max_members: 4, is_public: true, password: null, created_at: '2026',
            party_members: [
                { id: 'm-new', party_id: 'p1', character_id: 'c2', character_name: 'Bob', character_class: 'Mage', character_level: 10, joined_at: '2026' },
            ],
        }]));

        const result = await partyApi.joinParty({ ...baseInput });
        expect((result as { id?: string }).id).toBe('p1');
        // Insert payload check.
        const insertBody = mockApi.post.mock.calls[0][1];
        expect(insertBody).toMatchObject({
            party_id: 'p1',
            character_id: 'c2',
            character_name: 'Bob',
            character_class: 'Mage',
            character_level: 10,
        });
    });
});

// ── leaveParty ────────────────────────────────────────────────────────────

describe('partyApi.leaveParty', () => {
    it('returns early when party not found', async () => {
        mockApi.get.mockResolvedValueOnce(mkRes([]));
        await partyApi.leaveParty('p-missing', 'c1');
        expect(mockApi.delete).not.toHaveBeenCalled();
    });

    it('dissolves the party when the leader leaves', async () => {
        mockApi.get.mockResolvedValueOnce(mkRes([{
            id: 'p1', leader_id: 'c1', name: 'X', description: '',
            max_members: 4, is_public: true, password: null, created_at: '2026',
            party_members: [],
        }]));
        mockApi.delete.mockResolvedValueOnce(mkRes(undefined));

        await partyApi.leaveParty('p1', 'c1');
        const url = mockApi.delete.mock.calls[0][0] as string;
        expect(url).toContain('/rest/v1/parties?id=eq.p1');
    });

    it('removes only the member when a non-leader leaves with others remaining', async () => {
        mockApi.get.mockResolvedValueOnce(mkRes([{
            id: 'p1', leader_id: 'c-leader', name: 'X', description: '',
            max_members: 4, is_public: true, password: null, created_at: '2026',
            party_members: [
                { id: 'm-leader', party_id: 'p1', character_id: 'c-leader', character_name: 'L', character_class: 'Knight', character_level: 1, joined_at: '2026' },
                { id: 'm-me', party_id: 'p1', character_id: 'c-me', character_name: 'M', character_class: 'Mage', character_level: 1, joined_at: '2026' },
            ],
        }]));
        mockApi.delete.mockResolvedValueOnce(mkRes(undefined));

        await partyApi.leaveParty('p1', 'c-me');
        const url = mockApi.delete.mock.calls[0][0] as string;
        expect(url).toContain('party_members?party_id=eq.p1');
        expect(url).toContain('character_id=eq.c-me');
    });

    it('cascades to delete the party when the last non-leader leaves', async () => {
        mockApi.get.mockResolvedValueOnce(mkRes([{
            id: 'p1', leader_id: 'c-leader', name: 'X', description: '',
            max_members: 4, is_public: true, password: null, created_at: '2026',
            party_members: [
                { id: 'm-me', party_id: 'p1', character_id: 'c-me', character_name: 'M', character_class: 'Mage', character_level: 1, joined_at: '2026' },
            ],
        }]));
        // member delete + cascade party delete
        mockApi.delete.mockResolvedValueOnce(mkRes(undefined)).mockResolvedValueOnce(mkRes(undefined));

        await partyApi.leaveParty('p1', 'c-me');
        expect(mockApi.delete).toHaveBeenCalledTimes(2);
        const lastUrl = mockApi.delete.mock.calls[1][0] as string;
        expect(lastUrl).toContain('/rest/v1/parties?id=eq.p1');
    });
});

// ── kickMember ────────────────────────────────────────────────────────────

describe('partyApi.kickMember', () => {
    it('deletes by row id + party id', async () => {
        mockApi.delete.mockResolvedValueOnce(mkRes(undefined));
        await partyApi.kickMember('p1', 'm-row-1');
        const url = mockApi.delete.mock.calls[0][0] as string;
        expect(url).toContain('party_members?party_id=eq.p1');
        expect(url).toContain('id=eq.m-row-1');
    });
});

// ── transferLeadership ────────────────────────────────────────────────────

describe('partyApi.transferLeadership', () => {
    it('patches parties.leader_id', async () => {
        mockApi.patch.mockResolvedValueOnce(mkRes(undefined));
        await partyApi.transferLeadership('p1', 'c-new-leader');
        const [url, body] = mockApi.patch.mock.calls[0];
        expect(url).toContain('parties?id=eq.p1');
        expect(body).toEqual({ leader_id: 'c-new-leader' });
    });

    it('rethrows unrelated errors', async () => {
        mockApi.patch.mockRejectedValueOnce(new Error('server down'));
        await expect(partyApi.transferLeadership('p1', 'c1')).rejects.toThrow('server down');
    });
});

// ── updatePartyMeta ───────────────────────────────────────────────────────

describe('partyApi.updatePartyMeta', () => {
    it('patches the parties row with the partial', async () => {
        mockApi.patch.mockResolvedValueOnce(mkRes(undefined));
        await partyApi.updatePartyMeta('p1', { description: 'new desc', password: null });
        const [url, body] = mockApi.patch.mock.calls[0];
        expect(url).toContain('parties?id=eq.p1');
        expect(body).toEqual({ description: 'new desc', password: null });
    });

    it('rethrows unrelated errors', async () => {
        mockApi.patch.mockRejectedValueOnce(new Error('boom'));
        await expect(
            partyApi.updatePartyMeta('p1', { description: 'x' }),
        ).rejects.toThrow('boom');
    });
});

// TODO: subscribeParty / subscribePublicFeed install supabase realtime
// channels — partially exercised by chatApi.test.ts which uses the same
// `supabase.channel().on(...).subscribe()` pattern. Direct coverage
// would require asserting the cleanup function calls supabase.removeChannel,
// which is mechanically identical to the assertions in chatApi.test.ts.
