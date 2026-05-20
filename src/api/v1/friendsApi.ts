import { BaseApi } from '../BaseApi';

/**
 * Friends API — thin wrapper over the `characters` table for social lookups.
 *
 * Friends data itself (who I added, who I blocked, favorites) lives locally
 * in `useFriendsStore` per character. This API only reads the public
 * `characters` table to translate names to metadata (class, level, online
 * state) so the Friends screen can render rich cards and PM flows work.
 *
 * Online status: `characters.updated_at` is bumped every save (characterApi
 * `syncCharacter` runs on every gameplay mutation). If a character's row
 * was updated in the last 5 minutes we treat them as online. This is a
 * heuristic — good enough for the friends list before proper presence
 * infrastructure is in place.
 */

export interface IFriendCharacterInfo {
    id: string;
    name: string;
    class: string;
    level: number;
    updated_at: string;
    online: boolean;
}

const ONLINE_THRESHOLD_MS = 5 * 60 * 1000;

interface IRawCharacter {
    id: string;
    name: string;
    class: string;
    level: number;
    updated_at: string;
}

const decorate = (row: IRawCharacter): IFriendCharacterInfo => {
    const updated = new Date(row.updated_at).getTime();
    const online = Number.isFinite(updated) && Date.now() - updated < ONLINE_THRESHOLD_MS;
    return {
        id: row.id,
        name: row.name,
        class: row.class,
        level: row.level,
        updated_at: row.updated_at,
        online,
    };
};

class FriendsApi extends BaseApi {
    /**
     * Look up a character by name — case-insensitive **prefix** match.
     *
     * 2026-05-19 spec ("Jak pisze Knigh to powinno mi znalezc gracza
     * Knight tez"): the old `name=eq.{exact}` only returned a hit on
     * a perfect literal, so typos / partial typing always landed on
     * "Nie znaleziono". The new query is `name=ilike.{q}*` —
     * PostgREST's ILIKE pattern (case-insensitive, `*` = `%`
     * wildcard) — capped at 5 results, ordered alphabetically.
     *
     * If the query exactly equals one of the candidates we prefer
     * that hit so "Knight" still resolves to "Knight" even when
     * "Knight2" sorts in front alphabetically; otherwise the first
     * prefix match wins.
     */
    findByName = async (name: string): Promise<IFriendCharacterInfo | null> => {
        const clean = name.trim();
        if (!clean) return null;
        const pattern = `${clean}*`;
        const encoded = encodeURIComponent(pattern);
        const data = await this.get<IRawCharacter[]>({
            url: `/rest/v1/characters?name=ilike.${encoded}&select=id,name,class,level,updated_at&order=name.asc&limit=5`,
        });
        if (!data.length) return null;
        const lc = clean.toLowerCase();
        const exact = data.find((r) => r.name.toLowerCase() === lc);
        return decorate(exact ?? data[0]);
    };

    /** Bulk fetch character rows for a list of friend names. */
    findManyByName = async (names: string[]): Promise<IFriendCharacterInfo[]> => {
        const clean = Array.from(new Set(names.map((n) => n.trim()).filter(Boolean)));
        if (!clean.length) return [];
        const list = clean.map((n) => `"${n.replace(/"/g, '\\"')}"`).join(',');
        const data = await this.get<IRawCharacter[]>({
            url: `/rest/v1/characters?name=in.(${encodeURIComponent(list)})&select=id,name,class,level,updated_at`,
        });
        return data.map(decorate);
    };
}

export const friendsApi = new FriendsApi();

/**
 * Build a deterministic PM channel id for two character names, independent
 * of who opens the chat first. The lower-cased names are sorted so both
 * participants end up subscribed to the exact same Supabase channel.
 */
export const buildPmChannel = (nameA: string, nameB: string): string => {
    const [first, second] = [nameA, nameB]
        .map((n) => n.trim())
        .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
    return `pm_${first}_${second}`;
};
