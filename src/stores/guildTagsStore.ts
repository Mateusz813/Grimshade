import { create } from 'zustand';
import { supabase } from '../lib/supabase';


const TAG_TTL_MS = 5 * 60 * 1000;

interface ITagEntry {
    tag: string;
    fetchedAt: number;
}

interface IGuildTagsStore {
    tags: Record<string, ITagEntry>;
    tagsByName: Record<string, ITagEntry>;
    resolveTags: (characterIds: string[]) => Promise<Record<string, string>>;
    resolveTagsByName: (names: string[]) => Promise<Record<string, string>>;
    getTagSync: (characterId: string) => string;
    getTagByNameSync: (name: string) => string;
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
            const { data, error } = await supabase
                .from('guild_members')
                .select('character_id, guilds:guild_id(tag)')
                .in('character_id', stale);
            if (error) throw error;
            const next: Record<string, ITagEntry> = { ...cache };
            const fetched: Record<string, string> = {};
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

export const formatNameWithTag = (name: string, characterId?: string | null): string => {
    if (!characterId) return name;
    const tag = useGuildTagsStore.getState().getTagSync(characterId);
    return tag ? `${tag} ${name}` : name;
};
