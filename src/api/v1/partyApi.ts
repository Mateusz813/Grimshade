import axios from 'axios';

import { supabase } from '../../lib/supabase';
import { BaseApi } from '../BaseApi';
import type { CharacterClass } from './characterApi';


let hasExtendedPartyCols = true;
let lastSchemaMissingAt = 0;
const SCHEMA_REPROBE_MS = 30_000;

const shouldUseExtendedCols = (): boolean => {
    if (hasExtendedPartyCols) return true;
    if (Date.now() - lastSchemaMissingAt > SCHEMA_REPROBE_MS) {
        console.info('[partyApi] re-probing extended schema after cooldown');
        hasExtendedPartyCols = true;
        return true;
    }
    return false;
};

const isSchemaMissingError = (err: unknown): boolean => {
    if (!axios.isAxiosError(err)) return false;
    const status = err.response?.status;
    if (status !== 400 && status !== 404 && status !== 406 && status !== 422) return false;
    const data = err.response?.data as { code?: string; message?: string; details?: string } | undefined;
    const msg = `${data?.message ?? ''} ${data?.details ?? ''}`.toLowerCase();
    if (
        data?.code === '42703' ||
        data?.code === 'PGRST204' ||
        (msg.includes('column') && (msg.includes('does not exist') || msg.includes('schema cache')))
    ) {
        return true;
    }
    const url = (err.config?.url ?? '').toLowerCase();
    if ((status === 400 || status === 404) && url.includes('/rest/v1/parties')) {
        return true;
    }
    return false;
};

const isMissingColumnError = (err: unknown): boolean => {
    if (!axios.isAxiosError(err)) return false;
    if (err.response?.status !== 400) return false;
    const data = err.response?.data as { code?: string; message?: string } | undefined;
    if (data?.code !== 'PGRST204') return false;
    return /could not find the .* column/i.test(data?.message ?? '');
};

const parseMissingColumn = (err: unknown): string | null => {
    if (!axios.isAxiosError(err)) return null;
    const msg = (err.response?.data as { message?: string } | undefined)?.message ?? '';
    const m = msg.match(/['"`]([a-zA-Z0-9_]+)['"`]\s+column/i);
    return m?.[1] ?? null;
};

const isPermissionError = (err: unknown): boolean => {
    if (!axios.isAxiosError(err)) return false;
    const status = err.response?.status;
    if (status !== 401 && status !== 403) return false;
    const data = err.response?.data as { code?: string; message?: string; details?: string } | undefined;
    const msg = `${data?.message ?? ''} ${data?.details ?? ''}`.toLowerCase();
    return (
        data?.code === '42501' ||
        msg.includes('permission denied') ||
        msg.includes('row-level security') ||
        msg.includes('row level security') ||
        msg.includes('new row violates')
    );
};

export const extractApiError = (err: unknown): string => {
    if (!axios.isAxiosError(err)) {
        return err instanceof Error ? err.message : 'Nieznany błąd.';
    }
    const data = err.response?.data as { code?: string; message?: string; details?: string; hint?: string } | undefined;
    if (data?.message) {
        const extras = [data.details, data.hint].filter(Boolean).join(' · ');
        return extras ? `${data.message} (${extras})` : data.message;
    }
    return err.message;
};

export class PartyMigrationMissingError extends Error {
    constructor(kind: 'schema' | 'rls' | 'rls-members', underlying: string) {
        const prefix =
            kind === 'schema' ? 'Brak kolumn w tabeli `parties`.'
          : kind === 'rls-members' ? 'Brak uprawnień do tabeli `party_members` (RLS).'
          : 'Brak uprawnień do tabeli `parties` (RLS).';
        super(
            `${prefix} Otwórz Supabase -> SQL Editor -> New query i wklej zawartość pliku ` +
            `scripts/party_migration.sql z repo, a potem kliknij Run. ` +
            `Skrypt dodaje kolumny description/password/is_public, czyści stare ` +
            `unikalne ograniczenia i ustawia permisywne polityki RLS. ` +
            `Pod spodem: ${underlying}`,
        );
        this.name = 'PartyMigrationMissingError';
    }
}

const onSchemaMissing = (where: string): void => {
    lastSchemaMissingAt = Date.now();
    if (!hasExtendedPartyCols) return;
    hasExtendedPartyCols = false;
    console.warn(
        `[partyApi] ${where}: Supabase "parties" table is missing the browser columns ` +
        `(description/password/is_public). Running in fallback mode — run scripts/party_migration.sql ` +
        `in Supabase Dashboard -> SQL Editor to enable the full party browser.`,
    );
};

export interface IPartyRow {
    id: string;
    leader_id: string;
    name: string;
    description: string | null;
    max_members: number;
    is_public: boolean;
    has_password: boolean;
    created_at: string;
    min_join_level: number;
}

export interface IPartyMemberRow {
    id: string;
    party_id: string;
    character_id: string;
    character_name: string;
    character_class: CharacterClass;
    character_level: number;
    role?: string | null;
    joined_at: string;
}

export interface IPartyWithMembers extends IPartyRow {
    members: IPartyMemberRow[];
}

export interface ICreatePartyInput {
    leaderId: string;
    name: string;
    description: string;
    password: string | null;
    isPublic: boolean;
    maxMembers?: number;
    minJoinLevel?: number;
}

export interface IJoinPartyInput {
    partyId: string;
    characterId: string;
    characterName: string;
    characterClass: CharacterClass;
    characterLevel: number;
}

interface IRawPartyRow {
    id: string;
    leader_id: string;
    name: string;
    description: string | null;
    max_members: number;
    is_public: boolean;
    password: string | null;
    created_at: string;
    min_join_level?: number;
}

interface IRawPartyRowWithMembers extends IRawPartyRow {
    party_members: IPartyMemberRow[];
}

const sanitize = (row: IRawPartyRow): IPartyRow => ({
    id: row.id,
    leader_id: row.leader_id,
    name: row.name,
    description: row.description ?? '',
    max_members: row.max_members,
    is_public: row.is_public ?? true,
    has_password: row.password !== null && row.password !== undefined && row.password !== '',
    created_at: row.created_at,
    min_join_level: row.min_join_level ?? 1,
});

const FULL_PARTY_SELECT =
    'id,leader_id,name,description,max_members,is_public,password,min_join_level,created_at,' +
    'party_members(id,party_id,character_id,character_name,character_class,character_level,joined_at)';
const MIN_PARTY_SELECT =
    'id,leader_id,name,max_members,created_at,' +
    'party_members(id,party_id,character_id,character_name,character_class,character_level,joined_at)';
const NO_EMBED_PARTY_SELECT =
    'id,leader_id,name,max_members,created_at';
const FULL_PARTY_SINGLE_SELECT = 'id,leader_id,name,description,max_members,is_public,password,min_join_level,created_at';
const MIN_PARTY_SINGLE_SELECT  = 'id,leader_id,name,max_members,created_at';

class PartyApi extends BaseApi {
    private hydrateMembersSeparately = async (
        parties: IRawPartyRow[],
    ): Promise<IRawPartyRowWithMembers[]> => {
        if (parties.length === 0) return [];
        const ids = parties.map((p) => `"${p.id}"`).join(',');
        let members: IPartyMemberRow[];
        try {
            members = await this.get<IPartyMemberRow[]>({
                url:
                    `/rest/v1/party_members?select=id,party_id,character_id,character_name,character_class,character_level,role,joined_at` +
                    `&party_id=in.(${ids})`,
            });
        } catch {
            members = [];
        }
        const byParty = new Map<string, IPartyMemberRow[]>();
        for (const m of members) {
            const arr = byParty.get(m.party_id) ?? [];
            arr.push(m);
            byParty.set(m.party_id, arr);
        }
        return parties.map((p) => ({ ...p, party_members: byParty.get(p.id) ?? [] }));
    };

    listPublicParties = async (): Promise<IPartyWithMembers[]> => {
        const fetchRows = async (select: string, filter: string): Promise<IRawPartyRowWithMembers[]> =>
            this.get<IRawPartyRowWithMembers[]>({
                url:
                    '/rest/v1/parties' +
                    (filter ? `?${filter}&` : '?') +
                    `select=${select}` +
                    '&order=created_at.desc' +
                    '&limit=50',
            });
        try {
            if (shouldUseExtendedCols()) {
                const rows = await fetchRows(FULL_PARTY_SELECT, 'or=(is_public.eq.true,is_public.is.null)');
                return await this.cleanupEmptyParties(rows.map((r) => ({ ...sanitize(r), members: r.party_members ?? [] })));
            }
        } catch (err) {
            if (isSchemaMissingError(err)) {
                onSchemaMissing('listPublicParties');
            } else {
                throw err;
            }
        }
        try {
            const rows = await fetchRows(MIN_PARTY_SELECT, '');
            return await this.cleanupEmptyParties(rows.map((r) => ({ ...sanitize(r), members: r.party_members ?? [] })));
        } catch (err) {
            if (!axios.isAxiosError(err) || (err.response?.status !== 400 && err.response?.status !== 404)) {
                throw err;
            }
            console.warn('[partyApi] embed fallback failed, hydrating members separately:', err);
        }
        const plainRows = await this.get<IRawPartyRow[]>({
            url:
                '/rest/v1/parties?select=' + NO_EMBED_PARTY_SELECT +
                '&order=created_at.desc&limit=50',
        });
        const hydrated = await this.hydrateMembersSeparately(plainRows);
        return await this.cleanupEmptyParties(hydrated.map((r) => ({ ...sanitize(r), members: r.party_members ?? [] })));
    };

    getPartyWithMembers = async (partyId: string): Promise<IPartyWithMembers | null> => {
        const fetchOne = async (select: string): Promise<IRawPartyRowWithMembers[]> =>
            this.get<IRawPartyRowWithMembers[]>({
                url:
                    `/rest/v1/parties?id=eq.${encodeURIComponent(partyId)}` +
                    `&select=${select}` +
                    '&limit=1',
            });
        try {
            if (shouldUseExtendedCols()) {
                const rows = await fetchOne(FULL_PARTY_SELECT);
                if (!rows.length) return null;
                return { ...sanitize(rows[0]), members: rows[0].party_members ?? [] };
            }
        } catch (err) {
            if (isSchemaMissingError(err)) {
                onSchemaMissing('getPartyWithMembers');
            } else {
                throw err;
            }
        }
        try {
            const rows = await fetchOne(MIN_PARTY_SELECT);
            if (!rows.length) return null;
            return { ...sanitize(rows[0]), members: rows[0].party_members ?? [] };
        } catch (err) {
            if (!axios.isAxiosError(err) || (err.response?.status !== 400 && err.response?.status !== 404)) {
                throw err;
            }
            console.warn('[partyApi] embed fallback failed on single fetch, hydrating members separately:', err);
        }
        const plainRows = await this.get<IRawPartyRow[]>({
            url:
                `/rest/v1/parties?id=eq.${encodeURIComponent(partyId)}` +
                `&select=${NO_EMBED_PARTY_SELECT}&limit=1`,
        });
        if (!plainRows.length) return null;
        const hydrated = await this.hydrateMembersSeparately(plainRows);
        const row = hydrated[0];
        return { ...sanitize(row), members: row.party_members ?? [] };
    };

    getMyActiveParty = async (characterId: string): Promise<IPartyWithMembers | null> => {
        try {
            const rows = await this.get<{ party_id: string }[]>({
                url: `/rest/v1/party_members?character_id=eq.${encodeURIComponent(characterId)}&select=party_id&limit=1`,
            });
            if (!rows.length) return null;
            return this.getPartyWithMembers(rows[0].party_id);
        } catch {
            return null;
        }
    };

    deleteMyStaleMemberships = async (characterId: string): Promise<void> => {
        try {
            await this.delete({
                url: `/rest/v1/party_members?character_id=eq.${encodeURIComponent(characterId)}`,
            });
        } catch {
        }
    };

    private insertMemberWithRetry = async (data: Record<string, unknown>): Promise<void> => {
        const ESSENTIAL_KEYS = new Set(['party_id', 'character_id']);
        let payload = { ...data };
        for (let attempt = 0; attempt < 5; attempt++) {
            try {
                await this.post<Record<string, unknown>, IPartyMemberRow[]>({
                    url: '/rest/v1/party_members',
                    data: payload,
                    config: { headers: { Prefer: 'return=representation' } },
                });
                return;
            } catch (err) {
                if (!isMissingColumnError(err)) throw err;
                const missing = parseMissingColumn(err);
                if (!missing || ESSENTIAL_KEYS.has(missing) || !(missing in payload)) throw err;
                console.warn(`[partyApi] party_members missing column "${missing}" — retrying without it.`);
                const next = { ...payload };
                delete next[missing];
                payload = next;
            }
        }
        throw new Error('party_members INSERT failed after column-strip retries.');
    };

    createParty = async (input: ICreatePartyInput & IJoinPartyInput): Promise<IPartyWithMembers | null> => {
        const buildBody = (extended: boolean): Partial<IRawPartyRow> => (
            extended
                ? {
                    leader_id: input.leaderId,
                    name: input.name.slice(0, 40),
                    description: input.description.slice(0, 140),
                    password: input.password && input.password.length > 0 ? input.password : null,
                    is_public: input.isPublic,
                    max_members: input.maxMembers ?? 4,
                    min_join_level: input.minJoinLevel && input.minJoinLevel > 1 ? input.minJoinLevel : 1,
                }
                : {
                    leader_id: input.leaderId,
                    name: input.name.slice(0, 40),
                    max_members: input.maxMembers ?? 4,
                }
        );
        const insertParty = async (extended: boolean): Promise<IRawPartyRow[]> =>
            this.post<Partial<IRawPartyRow>, IRawPartyRow[]>({
                url: '/rest/v1/parties',
                data: buildBody(extended),
                config: { headers: { Prefer: 'return=representation' } },
            });

        let partyRows: IRawPartyRow[];
        try {
            partyRows = await insertParty(shouldUseExtendedCols());
        } catch (err) {
            if (isSchemaMissingError(err)) {
                onSchemaMissing('createParty');
                try {
                    partyRows = await insertParty(false);
                } catch (err2) {
                    if (isPermissionError(err2)) {
                        throw new PartyMigrationMissingError('rls', extractApiError(err2));
                    }
                    throw new Error(extractApiError(err2));
                }
            } else if (isPermissionError(err)) {
                throw new PartyMigrationMissingError('rls', extractApiError(err));
            } else {
                throw new Error(extractApiError(err));
            }
        }
        if (!Array.isArray(partyRows) || partyRows.length === 0) return null;
        const party = partyRows[0];

        try {
            await this.delete({
                url: `/rest/v1/party_members?character_id=eq.${encodeURIComponent(input.characterId)}`,
            });
        } catch {
        }
        try {
            await this.insertMemberWithRetry({
                party_id: party.id,
                character_id: input.characterId,
                character_name: input.characterName,
                character_class: input.characterClass,
                character_level: input.characterLevel,
            });
        } catch (err) {
            try {
                await this.delete({ url: `/rest/v1/parties?id=eq.${encodeURIComponent(party.id)}` });
            } catch { }
            console.error('[partyApi] party_members INSERT failed:', err);
            if (isPermissionError(err)) {
                throw new PartyMigrationMissingError('rls-members', extractApiError(err));
            }
            throw new Error(`party_members INSERT: ${extractApiError(err)}`);
        }

        return this.getPartyWithMembers(party.id);
    };

    joinParty = async (
        input: IJoinPartyInput & { password?: string },
    ): Promise<IPartyWithMembers | { error: string }> => {
        const fetchTarget = async (select: string): Promise<IRawPartyRow[]> =>
            this.get<IRawPartyRow[]>({
                url:
                    `/rest/v1/parties?id=eq.${encodeURIComponent(input.partyId)}` +
                    `&select=${select}&limit=1`,
            });
        let rows: IRawPartyRow[];
        try {
            rows = await fetchTarget(shouldUseExtendedCols() ? FULL_PARTY_SINGLE_SELECT : MIN_PARTY_SINGLE_SELECT);
        } catch (err) {
            if (isSchemaMissingError(err)) {
                onSchemaMissing('joinParty');
                rows = await fetchTarget(MIN_PARTY_SINGLE_SELECT);
            } else {
                throw err;
            }
        }
        if (!rows.length) return { error: 'Party nie istnieje.' };
        const target = rows[0];
        if (target.password && target.password !== (input.password ?? '')) {
            return { error: 'Nieprawidłowe hasło.' };
        }
        const minLevel = target.min_join_level ?? 1;
        if (minLevel > 1 && input.characterLevel < minLevel) {
            return { error: `To party wymaga poziomu ${minLevel}+.` };
        }

        const existing = await this.getPartyWithMembers(input.partyId);
        if (!existing) return { error: 'Party nie istnieje.' };
        if (existing.members.length >= existing.max_members) {
            return { error: 'Party jest pełne.' };
        }
        if (existing.members.some((m) => m.character_id === input.characterId)) {
            return existing;
        }

        await this.insertMemberWithRetry({
            party_id: input.partyId,
            character_id: input.characterId,
            character_name: input.characterName,
            character_class: input.characterClass,
            character_level: input.characterLevel,
        });

        return (await this.getPartyWithMembers(input.partyId)) ?? { error: 'Dołączono, ale party zniknęło.' };
    };

    leaveParty = async (partyId: string, characterId: string): Promise<void> => {
        const party = await this.getPartyWithMembers(partyId);
        if (!party) return;
        if (party.leader_id === characterId) {
            await this.delete({
                url: `/rest/v1/parties?id=eq.${encodeURIComponent(partyId)}`,
            });
            return;
        }
        await this.delete({
            url:
                `/rest/v1/party_members?party_id=eq.${encodeURIComponent(partyId)}` +
                `&character_id=eq.${encodeURIComponent(characterId)}`,
        });
        const remaining = (party.members ?? []).filter((m) => m.character_id !== characterId);
        if (remaining.length === 0) {
            try {
                await this.delete({
                    url: `/rest/v1/parties?id=eq.${encodeURIComponent(partyId)}`,
                });
            } catch {
            }
        }
    };

    private cleanupEmptyParties = async (parties: IPartyWithMembers[]): Promise<IPartyWithMembers[]> => {
        const now = Date.now();
        const empty: IPartyWithMembers[] = [];
        const kept: IPartyWithMembers[] = [];
        const STALE_AGE_MS = 6 * 60 * 60 * 1000;
        for (const p of parties) {
            const ageMs = now - new Date(p.created_at).getTime();
            const isEmptyAndOld = (p.members?.length ?? 0) === 0 && ageMs > 30_000;
            const isVeryStale = ageMs > STALE_AGE_MS;
            if (isEmptyAndOld || isVeryStale) {
                empty.push(p);
            } else {
                kept.push(p);
            }
        }
        if (empty.length > 0) {
            const ids = empty.map((p) => `"${p.id}"`).join(',');
            try {
                await this.delete({
                    url: `/rest/v1/party_members?party_id=in.(${ids})`,
                });
            } catch {
            }
            try {
                await this.delete({
                    url: `/rest/v1/parties?id=in.(${ids})`,
                });
            } catch {
            }
        }
        return kept;
    };

    kickMember = async (partyId: string, memberRowId: string): Promise<void> => {
        await this.delete({
            url: `/rest/v1/party_members?party_id=eq.${encodeURIComponent(partyId)}&id=eq.${encodeURIComponent(memberRowId)}`,
        });
    };

    transferLeadership = async (partyId: string, newLeaderId: string): Promise<void> => {
        try {
            await this.patch({
                url: `/rest/v1/parties?id=eq.${encodeURIComponent(partyId)}`,
                data: { leader_id: newLeaderId },
            });
        } catch (err) {
            if (isSchemaMissingError(err)) {
                onSchemaMissing('transferLeadership');
                return;
            }
            throw err;
        }
    };

    updatePartyMeta = async (
        partyId: string,
        patch: { description?: string; password?: string | null; is_public?: boolean },
    ): Promise<void> => {
        if (!shouldUseExtendedCols()) return;
        try {
            await this.patch({
                url: `/rest/v1/parties?id=eq.${encodeURIComponent(partyId)}`,
                data: patch,
            });
        } catch (err) {
            if (isSchemaMissingError(err)) {
                onSchemaMissing('updatePartyMeta');
                return;
            }
            throw err;
        }
    };

    subscribeParty = (
        partyId: string,
        onChange: (fresh: IPartyWithMembers | null) => void,
    ): (() => void) => {
        const refresh = () => {
            this.getPartyWithMembers(partyId).then(onChange).catch(() => onChange(null));
        };
        const uniqueName = `party:${partyId}:${Math.random().toString(36).slice(2, 10)}:${Date.now()}`;
        const sub = supabase
            .channel(uniqueName)
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'party_members',
                    filter: `party_id=eq.${partyId}`,
                },
                refresh,
            )
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'parties',
                    filter: `id=eq.${partyId}`,
                },
                (payload) => {
                    if (payload.eventType === 'DELETE') {
                        onChange(null);
                    } else {
                        refresh();
                    }
                },
            )
            .subscribe();
        return () => { void supabase.removeChannel(sub); };
    };

    subscribePublicFeed = (
        onChange: (parties: IPartyWithMembers[]) => void,
        onError?: (err: unknown) => void,
    ): (() => void) => {
        const refresh = () => {
            this.listPublicParties()
                .then(onChange)
                .catch((err) => {
                    console.warn('[partyApi] subscribePublicFeed refresh failed:', err);
                    if (onError) onError(err);
                });
        };
        refresh();
        const uniqueName = `parties:feed:${Math.random().toString(36).slice(2, 10)}:${Date.now()}`;
        const sub = supabase
            .channel(uniqueName)
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'parties' },
                refresh,
            )
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'party_members' },
                refresh,
            )
            .subscribe();
        return () => { void supabase.removeChannel(sub); };
    };
}

export const partyApi = new PartyApi();
