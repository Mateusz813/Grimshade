import { create } from 'zustand';
import { supabase } from '../lib/supabase';

/**
 * Lightweight cache: characterId -> "[XXX]" guild tag, used to render
 * the guild prefix in front of player names in chat / rankings / deaths
 * / town widgets without forcing every view to query `guild_members`
 * on its own.
 *
 * Lookups are batched + cached for 5 minutes; "no guild" results are
 * cached as an empty string so the negative case doesn't keep
 * re-fetching. The local player's tag still comes straight from
 * `useGuildStore` — this cache is for OTHER characters.
 *
 * The cache invalidates on every guild join/leave broadcast (via the
 * realtime channel subscribed in AppShell) — see `useGuildTagInvalidator`.
 */

const TAG_TTL_MS = 5 * 60 * 1000;

interface ITagEntry {
    /** "[XXX]" prefix or empty string when the character isn't in any guild. */
    tag: string;
    fetchedAt: number;
}

interface IGuildTagsStore {
    tags: Record<string, ITagEntry>;
    /** Parallel cache keyed by character NAME (chat / deaths /
     *  leaderboard don't ship character ids). */
    tagsByName: Record<string, ITagEntry>;
    /** Batched fetch — returns the tag map for every id requested. Hits
     *  the local cache first, then queries Supabase for misses. */
    resolveTags: (characterIds: string[]) => Promise<Record<string, string>>;
    /** Same as `resolveTags` but keys by character display name. */
    resolveTagsByName: (names: string[]) => Promise<Record<string, string>>;
    /** Local tag for a single character (no fetch). */
    getTagSync: (characterId: string) => string;
    /** Local tag by name (no fetch). */
    getTagByNameSync: (name: string) => string;
    /** Force a refresh on the next read for the given ids (used after
     *  the player's own guild membership changes — every other tag
     *  could also have shifted). */
    invalidate: (characterIds?: string[]) => void;
}

export const useGuildTagsStore = create<IGuildTagsStore>()((set, get) => ({
    tags: {},
    tagsByName: {},

    resolveTagsByName: async (names) => {
        const unique = Array.from(new Set(names.filter(Boolean)));
        if (unique.length === 0) return {};
        const now = Date.now();
        const cache = get().tagsByName;
        const fresh: Record<string, string> = {};
        const stale: string[] = [];
        for (const n of unique) {
            const entry = cache[n];
            if (entry && now - entry.fetchedAt < TAG_TTL_MS) {
                fresh[n] = entry.tag;
            } else {
                stale.push(n);
            }
        }
        if (stale.length === 0) return fresh;
        try {
            const { data, error } = await supabase
                .from('guild_members')
                .select('character_name, guilds:guild_id(tag)')
                .in('character_name', stale);
            if (error) throw error;
            const next: Record<string, ITagEntry> = { ...cache };
            const fetched: Record<string, string> = {};
            for (const n of stale) {
                next[n] = { tag: '', fetchedAt: now };
                fetched[n] = '';
            }
            for (const row of (data ?? []) as unknown as Array<{ character_name: string; guilds: { tag: string } | null }>) {
                const tag = row.guilds?.tag ? `[${row.guilds.tag}]` : '';
                next[row.character_name] = { tag, fetchedAt: now };
                fetched[row.character_name] = tag;
            }
            set({ tagsByName: next });
            return { ...fresh, ...fetched };
        } catch {
            return fresh;
        }
    },

    getTagByNameSync: (name) => {
        if (!name) return '';
        return get().tagsByName[name]?.tag ?? '';
    },

    resolveTags: async (characterIds) => {
        const unique = Array.from(new Set(characterIds.filter(Boolean)));
        if (unique.length === 0) return {};
        const now = Date.now();
        const cache = get().tags;
        const fresh: Record<string, string> = {};
        const stale: string[] = [];
        for (const id of unique) {
            const entry = cache[id];
            if (entry && now - entry.fetchedAt < TAG_TTL_MS) {
                fresh[id] = entry.tag;
            } else {
                stale.push(id);
            }
        }
        if (stale.length === 0) return fresh;
        try {
            // Pull every membership for the stale ids; join with the
            // guild's tag via a nested select.
            const { data, error } = await supabase
                .from('guild_members')
                .select('character_id, guilds:guild_id(tag)')
                .in('character_id', stale);
            if (error) throw error;
            const next: Record<string, ITagEntry> = { ...cache };
            const fetched: Record<string, string> = {};
            // Seed every stale id with empty (no guild) — overwrite
            // below if a membership row came back.
            for (const id of stale) {
                next[id] = { tag: '', fetchedAt: now };
                fetched[id] = '';
            }
            for (const row of (data ?? []) as unknown as Array<{ character_id: string; guilds: { tag: string } | null }>) {
                const tag = row.guilds?.tag ? `[${row.guilds.tag}]` : '';
                next[row.character_id] = { tag, fetchedAt: now };
                fetched[row.character_id] = tag;
            }
            set({ tags: next });
            return { ...fresh, ...fetched };
        } catch {
            // Offline / table missing — return fresh subset only so the
            // caller can fall back to bare names without exploding.
            return fresh;
        }
    },

    getTagSync: (characterId) => {
        if (!characterId) return '';
        return get().tags[characterId]?.tag ?? '';
    },

    invalidate: (characterIds) => {
        if (!characterIds) {
            set({ tags: {}, tagsByName: {} });
            return;
        }
        set((s) => {
            const next = { ...s.tags };
            for (const id of characterIds) delete next[id];
            return { tags: next };
        });
    },
}));

/** Format a name with the cached tag (sync helper, no fetch). */
export const formatNameWithTag = (name: string, characterId?: string | null): string => {
    if (!characterId) return name;
    const tag = useGuildTagsStore.getState().getTagSync(characterId);
    return tag ? `${tag} ${name}` : name;
};
