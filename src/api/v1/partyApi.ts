import axios from 'axios';

import { supabase } from '../../lib/supabase';
import { BaseApi } from '../BaseApi';
import type { CharacterClass } from './characterApi';

/**
 * Party multiplayer API — reads/writes the `parties` and `party_members`
 * tables and streams membership changes over Supabase Realtime so every
 * client in a party sees joins/leaves/kicks instantly.
 *
 * -- Schema migration -------------------------------------------------------
 * The client expects these optional columns on `parties`:
 *
 *   description TEXT DEFAULT '',
 *   password    TEXT,
 *   is_public   BOOLEAN DEFAULT TRUE,
 *   updated_at  TIMESTAMPTZ DEFAULT NOW()
 *
 * The full migration (columns + RLS + realtime publication) is in
 *   scripts/party_migration.sql
 *
 * Run it ONCE in Supabase Dashboard -> SQL Editor. The API below gracefully
 * degrades if the migration hasn't been run yet: it detects PostgREST
 * "column does not exist" / "schema cache" errors and retries with only
 * the columns that existed in the original schema so /party still renders
 * instead of 400-ing into an empty screen.
 *
 * NOTE on passwords: this is a free browser RPG, not a banking app. The
 * password column stores plain text and any client can read it via the
 * join flow. That's fine — it's gated coordination ("please don't join
 * without saying hi in chat"), not authentication.
 */

// -- Schema-tolerance helpers ------------------------------------------------
// Set to `false` as soon as we see a PostgREST error that mentions a missing
// column. Once flipped we stop asking for those columns in subsequent calls,
// so the browser keeps working on un-migrated Supabase instances.
//
// 2026-05-09: re-promote to `true` after 30 s. Without this, a single
// schema-missing error during the migration window permanently locks the
// session into the minimal-payload path even AFTER the user runs the
// migration — they'd see "0/4 graczy" forever until a hard refresh because
// the embedded `party_members(*)` SELECT got skipped. The 30 s probe means
// we self-heal: the next call after the migration lands re-tries with the
// full payload and succeeds.
let hasExtendedPartyCols = true;
let lastSchemaMissingAt = 0;
const SCHEMA_REPROBE_MS = 30_000;

/**
 * Returns whether to send the FULL payload / SELECT extended columns. Re-probes
 * (returns true) every SCHEMA_REPROBE_MS so a session that latched into
 * fallback mode self-heals once the migration runs.
 */
const shouldUseExtendedCols = (): boolean => {
    if (hasExtendedPartyCols) return true;
    if (Date.now() - lastSchemaMissingAt > SCHEMA_REPROBE_MS) {
        // eslint-disable-next-line no-console
        console.info('[partyApi] re-probing extended schema after cooldown');
        hasExtendedPartyCols = true;
        return true;
    }
    return false;
};

/** PostgREST error code for "column does not exist" / missing in schema cache. */
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
    // Broader net: any 400/404 on a /rest/v1/parties request while the
    // extended-columns flag is still set almost certainly means the migration
    // hasn't been run. Fall back to the minimal schema rather than error the UI.
    const url = (err.config?.url ?? '').toLowerCase();
    if ((status === 400 || status === 404) && url.includes('/rest/v1/parties')) {
        return true;
    }
    return false;
};

/** Strict version of isSchemaMissingError — fires ONLY for PGRST204
 *  "Could not find the 'X' column" responses. Used by
 *  `insertMemberWithRetry` to know whether stripping the offending
 *  column will make the request succeed. */
const isMissingColumnError = (err: unknown): boolean => {
    if (!axios.isAxiosError(err)) return false;
    if (err.response?.status !== 400) return false;
    const data = err.response?.data as { code?: string; message?: string } | undefined;
    if (data?.code !== 'PGRST204') return false;
    return /could not find the .* column/i.test(data?.message ?? '');
};

/** Pull the offending column name out of a PGRST204 message like:
 *  "Could not find the 'character_class' column of 'party_members' in the schema cache" */
const parseMissingColumn = (err: unknown): string | null => {
    if (!axios.isAxiosError(err)) return null;
    const msg = (err.response?.data as { message?: string } | undefined)?.message ?? '';
    const m = msg.match(/['"`]([a-zA-Z0-9_]+)['"`]\s+column/i);
    return m?.[1] ?? null;
};

/**
 * Detect Supabase RLS / permission errors. When the `parties` table has RLS
 * enabled but no policy allows INSERT, PostgREST returns 401/403 with code
 * `42501`. The schema-column fallback won't help here — the user needs to run
 * the migration script to install the policies.
 */
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

/**
 * Extract a human-readable error message from an axios error. PostgREST
 * returns JSON with `message`/`details`/`hint` — prefer those over the bare
 * axios error message ("Request failed with status code 400").
 */
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

/**
 * Friendly migration-missing error — shown in the UI when the user hasn't
 * run `scripts/party_migration.sql` yet. The message tells her exactly what
 * to do (open Supabase -> SQL Editor -> paste the script -> Run).
 */
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
    // eslint-disable-next-line no-console
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
    has_password: boolean; // derived client-side (password !== null)
    created_at: string;
    /** Optional minimum character level a joiner must meet. NULL / 1 = no
     *  restriction. Added 2026-05-13 — older parties default to 1 client-
     *  side so they stay joinable. */
    min_join_level: number;
}

export interface IPartyMemberRow {
    id: string;
    party_id: string;
    character_id: string;
    character_name: string;
    character_class: CharacterClass;
    character_level: number;
    /** Optional — older schemas don't have this column. Leader detection
     *  uses `parties.leader_id` everywhere; `role` is never read. */
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
    /** Optional min level to join. Omit / 1 for no restriction. */
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

/** Strip the plain-text password off a raw row and expose `has_password`. */
const sanitize = (row: IRawPartyRow): IPartyRow => ({
    id: row.id,
    leader_id: row.leader_id,
    name: row.name,
    description: row.description ?? '',
    max_members: row.max_members,
    is_public: row.is_public ?? true,
    has_password: row.password !== null && row.password !== undefined && row.password !== '',
    created_at: row.created_at,
    // Default to 1 (no restriction) for legacy rows without the column.
    min_join_level: row.min_join_level ?? 1,
});

/** PostgREST column lists — with or without the optional browser columns.
 *  2026-05-09: dropped `role` from the embedded `party_members(...)` select.
 *  The DB column doesn't exist on every install, and selecting it 400's the
 *  WHOLE query with `column party_members_1.role does not exist`, which then
 *  cascaded into the no-embed fallback that drops members entirely -> roster
 *  rendered as 0/4 even though the membership row was there. The client
 *  doesn't read `role` anywhere (leader detection uses `parties.leader_id`),
 *  so removing it from the projection is a pure win. */
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
    /**
     * Fallback when PostgREST can't embed `party_members` (missing FK between
     * parties.id and party_members.party_id, or party_members table missing).
     * Fetches parties without the embed, then fetches all members in a single
     * follow-up query filtered by the party IDs we just retrieved.
     */
    private hydrateMembersSeparately = async (
        parties: IRawPartyRow[],
    ): Promise<IRawPartyRowWithMembers[]> => {
        if (parties.length === 0) return [];
        const ids = parties.map((p) => `"${p.id}"`).join(',');
        let members: IPartyMemberRow[] = [];
        try {
            members = await this.get<IPartyMemberRow[]>({
                url:
                    `/rest/v1/party_members?select=id,party_id,character_id,character_name,character_class,character_level,role,joined_at` +
                    `&party_id=in.(${ids})`,
            });
        } catch {
            // party_members table probably doesn't exist yet — show parties with empty rosters
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

    /** Fetch all public parties with their member counts, for the party browser. */
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
        // Try the full schema first.
        try {
            if (shouldUseExtendedCols()) {
                // Include parties where is_public is either TRUE or NULL — older rows
                // created before the column existed have NULL and should still be
                // visible in the browser.
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
        // Fallback #1: minimal schema with embed.
        try {
            const rows = await fetchRows(MIN_PARTY_SELECT, '');
            return await this.cleanupEmptyParties(rows.map((r) => ({ ...sanitize(r), members: r.party_members ?? [] })));
        } catch (err) {
            if (!axios.isAxiosError(err) || (err.response?.status !== 400 && err.response?.status !== 404)) {
                throw err;
            }
            // eslint-disable-next-line no-console
            console.warn('[partyApi] embed fallback failed, hydrating members separately:', err);
        }
        // Fallback #2: no embed — hydrate party_members in a second query.
        const plainRows = await this.get<IRawPartyRow[]>({
            url:
                '/rest/v1/parties?select=' + NO_EMBED_PARTY_SELECT +
                '&order=created_at.desc&limit=50',
        });
        const hydrated = await this.hydrateMembersSeparately(plainRows);
        return await this.cleanupEmptyParties(hydrated.map((r) => ({ ...sanitize(r), members: r.party_members ?? [] })));
    };

    /** Fetch a single party including its members (used after create/join). */
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
            // eslint-disable-next-line no-console
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

    /**
     * Find the party (if any) the given character is currently a member
     * of. Returns the full IPartyWithMembers snapshot or null.
     *
     * Used on Party.tsx mount so a refresh restores the user's active
     * party from the DB instead of leaving them in a "ghost" state
     * where the row exists but the local store is empty.
     */
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

    /**
     * Delete every party_members row for the given character. Called
     * when Party.tsx mount detects the local user has no active party
     * but might have stale member rows from prior sessions that are
     * keeping a zombie party alive in the public feed.
     */
    deleteMyStaleMemberships = async (characterId: string): Promise<void> => {
        try {
            await this.delete({
                url: `/rest/v1/party_members?character_id=eq.${encodeURIComponent(characterId)}`,
            });
        } catch {
            // Best-effort — RLS may block; ignore.
        }
    };

    /**
     * Insert a `party_members` row, retrying with progressively-stripped
     * payload when PostgREST rejects unknown columns (PGRST204). Lets a
     * party_members table that's missing optional columns
     * (character_name / character_class / character_level / joined_at)
     * still accept the leader / new joiner — the row keeps the only
     * truly required fields (party_id + character_id) and the UI fills
     * in the missing meta from the local character store at render time.
     *
     * Throws the FINAL error (not a column-strip detection) so callers
     * can still surface RLS / FK / etc. failures to the user.
     */
    private insertMemberWithRetry = async (data: Record<string, unknown>): Promise<void> => {
        const ESSENTIAL_KEYS = new Set(['party_id', 'character_id']);
        let payload = { ...data };
        // Up to 4 retries — one per optional column that could be missing.
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
                // eslint-disable-next-line no-console
                console.warn(`[partyApi] party_members missing column "${missing}" — retrying without it.`);
                const next = { ...payload };
                delete next[missing];
                payload = next;
            }
        }
        throw new Error('party_members INSERT failed after column-strip retries.');
    };

    /** Create a new party and insert the leader as the first member in one flow. */
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
                    // 2026-05-13: minimum level to join (NULL/1 = no gate).
                    // Older schemas without the column drop this field via
                    // the PGRST204 retry path below.
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

        let partyRows: IRawPartyRow[] = [];
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

        // Insert leader as first member.
        // 2026-05-09 spec follow-up: a single failed create from a
        // previous session can leave a stale `party_members` row whose
        // UNIQUE(character_id) constraint blocks every subsequent
        // attempt with "duplicate key value". Wipe any orphan rows
        // for THIS character first so a retry always succeeds. The
        // delete is scoped tightly so we never touch a real active
        // membership.
        try {
            await this.delete({
                url: `/rest/v1/party_members?character_id=eq.${encodeURIComponent(input.characterId)}`,
            });
        } catch {
            // Non-fatal — if the delete is blocked we'll see the same
            // failure on the insert below and surface it through the
            // toast/console-error path.
        }
        try {
            // 2026-05-09: column-aware retry. If PostgREST 400s with
            // PGRST204 ("Could not find the 'X' column"), strip X from
            // the payload and retry — up to 4 times so a single bad
            // schema can lose all of {character_name, character_class,
            // character_level, joined_at} without crashing the create.
            // The party row stays usable even if the member row only
            // has {party_id, character_id} — leader detection uses
            // parties.leader_id, and the UI can resolve the missing
            // character meta from the local store at render time.
            await this.insertMemberWithRetry({
                party_id: party.id,
                character_id: input.characterId,
                character_name: input.characterName,
                character_class: input.characterClass,
                character_level: input.characterLevel,
            });
        } catch (err) {
            // The party row was already created — best-effort cleanup so
            // we don't leave a leaderless ghost row in the public feed.
            try {
                await this.delete({ url: `/rest/v1/parties?id=eq.${encodeURIComponent(party.id)}` });
            } catch { /* ignore — RLS may block, the cleanup-empty-parties pass will get it */ }
            // eslint-disable-next-line no-console
            console.error('[partyApi] party_members INSERT failed:', err);
            if (isPermissionError(err)) {
                throw new PartyMigrationMissingError('rls-members', extractApiError(err));
            }
            throw new Error(`party_members INSERT: ${extractApiError(err)}`);
        }

        return this.getPartyWithMembers(party.id);
    };

    /**
     * Join a party. If the party has a password, pass it as `password` — this
     * method fetches the target party, verifies the password client-side, and
     * then inserts the member row.
     */
    joinParty = async (
        input: IJoinPartyInput & { password?: string },
    ): Promise<IPartyWithMembers | { error: string }> => {
        const fetchTarget = async (select: string): Promise<IRawPartyRow[]> =>
            this.get<IRawPartyRow[]>({
                url:
                    `/rest/v1/parties?id=eq.${encodeURIComponent(input.partyId)}` +
                    `&select=${select}&limit=1`,
            });
        let rows: IRawPartyRow[] = [];
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
        // 2026-05-13: minimum-level gate. Older schemas may not have the
        // column — treat undefined as no restriction. Joining your own
        // already-in-progress party (e.g. re-joining after disconnect)
        // still passes if the character meets the floor.
        const minLevel = target.min_join_level ?? 1;
        if (minLevel > 1 && input.characterLevel < minLevel) {
            return { error: `To party wymaga poziomu ${minLevel}+.` };
        }

        // Check capacity
        const existing = await this.getPartyWithMembers(input.partyId);
        if (!existing) return { error: 'Party nie istnieje.' };
        if (existing.members.length >= existing.max_members) {
            return { error: 'Party jest pełne.' };
        }
        if (existing.members.some((m) => m.character_id === input.characterId)) {
            return existing; // already in party
        }

        // Same `role` drop as createParty — column is never read client-side.
        // Same column-aware retry too so missing-column schemas don't break joining.
        await this.insertMemberWithRetry({
            party_id: input.partyId,
            character_id: input.characterId,
            character_name: input.characterName,
            character_class: input.characterClass,
            character_level: input.characterLevel,
        });

        return (await this.getPartyWithMembers(input.partyId)) ?? { error: 'Dołączono, ale party zniknęło.' };
    };

    /**
     * Remove a member by character id. The party row is dissolved when:
     *   1. The leader leaves, or
     *   2. The member leaving is the last one in the party.
     * Without (2) empty parties linger forever and pollute the browser.
     */
    leaveParty = async (partyId: string, characterId: string): Promise<void> => {
        const party = await this.getPartyWithMembers(partyId);
        if (!party) return;
        if (party.leader_id === characterId) {
            // Leader leaving dissolves the party entirely.
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
        // Cascade: if that was the last member, drop the party row too.
        const remaining = (party.members ?? []).filter((m) => m.character_id !== characterId);
        if (remaining.length === 0) {
            try {
                await this.delete({
                    url: `/rest/v1/parties?id=eq.${encodeURIComponent(partyId)}`,
                });
            } catch {
                // Non-fatal — a realtime peer may have already cleaned it up.
            }
        }
    };

    /**
     * Delete every party row that has zero members. Called opportunistically
     * from `listPublicParties` so stale disbanded parties stop appearing in
     * the browser. Non-fatal on error (RLS may block cross-account deletes —
     * in that case the owner's client will clean up once they log in).
     */
    private cleanupEmptyParties = async (parties: IPartyWithMembers[]): Promise<IPartyWithMembers[]> => {
        const now = Date.now();
        const empty: IPartyWithMembers[] = [];
        const kept: IPartyWithMembers[] = [];
        // 2026-05-09 spec ("dalej widze zamkniete juz party"): also
        // delete ANY party older than 6 hours regardless of member
        // count. Without an activity heartbeat we can't tell if those
        // members are still online; in practice 6 h+ old parties are
        // dead test rows from earlier sessions and should be GC'd.
        const STALE_AGE_MS = 6 * 60 * 60 * 1000; // 6 hours
        for (const p of parties) {
            // Grace period: keep parties <30s old regardless — the leader member
            // row may not have landed in PostgREST yet for other viewers.
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
                // Defensive: delete child rows first so old schemas
                // without ON DELETE CASCADE don't leave orphan
                // party_members rows whose parent gets removed below.
                await this.delete({
                    url: `/rest/v1/party_members?party_id=in.(${ids})`,
                });
            } catch {
                // Non-fatal — RLS may block; continue.
            }
            try {
                await this.delete({
                    url: `/rest/v1/parties?id=in.(${ids})`,
                });
            } catch {
                // Non-fatal — the next viewer will try again.
            }
        }
        return kept;
    };

    /** Leader action: delete a member by row id (kick). */
    kickMember = async (partyId: string, memberRowId: string): Promise<void> => {
        await this.delete({
            url: `/rest/v1/party_members?party_id=eq.${encodeURIComponent(partyId)}&id=eq.${encodeURIComponent(memberRowId)}`,
        });
    };

    /**
     * Leader action: hand off leadership to another party member by
     * patching `parties.leader_id`. The Realtime subscription pushes
     * the change to every member's client immediately. RLS must allow
     * the current leader to update the row — same policy that lets
     * them update party meta.
     */
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

    /** Leader action: edit party meta (description, password, is_public). */
    updatePartyMeta = async (
        partyId: string,
        patch: { description?: string; password?: string | null; is_public?: boolean },
    ): Promise<void> => {
        // Skip entirely on un-migrated schemas — the columns don't exist to patch.
        if (!shouldUseExtendedCols()) return;
        try {
            await this.patch({
                url: `/rest/v1/parties?id=eq.${encodeURIComponent(partyId)}`,
                data: patch,
            });
        } catch (err) {
            if (isSchemaMissingError(err)) {
                onSchemaMissing('updatePartyMeta');
                return; // swallow — feature gracefully disabled
            }
            throw err;
        }
    };

    /**
     * Subscribe to membership changes and party meta updates for a specific
     * party. Called whenever a member joins, leaves, is kicked, or the leader
     * edits the description/password. The callback is fired with the fresh
     * full-party snapshot so UI doesn't have to splice rows manually.
     */
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

    /**
     * Subscribe to the public parties feed. Every insert/delete/update on
     * `parties` reruns the listPublicParties query so the browser stays live.
     */
    subscribePublicFeed = (
        onChange: (parties: IPartyWithMembers[]) => void,
        onError?: (err: unknown) => void,
    ): (() => void) => {
        const refresh = () => {
            this.listPublicParties()
                .then(onChange)
                .catch((err) => {
                    // eslint-disable-next-line no-console
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
