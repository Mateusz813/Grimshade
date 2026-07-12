import { create } from 'zustand';
import {
    guildApi,
    type IGuildRow,
    type IGuildMemberRow,
    type IGuildJoinRequestRow,
    buildGuildChannel,
} from '../api/v1/guildApi';
import { supabase } from '../lib/supabase';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { guildMemberCap } from '../systems/guildSystem';
import { isBackendMode } from '../config/backendMode';
import { backendApi } from '../api/backend/backendApi';


interface IGuildStoreState {
    guild: IGuildRow | null;
    members: IGuildMemberRow[];
    requests: IGuildJoinRequestRow[];
    loading: boolean;
    guildIdByCharacter: Record<string, string | null>;
    channel: RealtimeChannel | null;

    hydrateForCharacter: (characterId: string) => Promise<void>;
    refreshMembers: () => Promise<void>;
    refreshRequests: () => Promise<void>;
    setGuild: (g: IGuildRow | null) => void;
    clear: () => void;
}

export const useGuildStore = create<IGuildStoreState>()((set, get) => ({
    guild: null,
    members: [],
    requests: [],
    loading: false,
    guildIdByCharacter: {},
    channel: null,

    hydrateForCharacter: async (characterId) => {
        if (!characterId) return;
        set({ loading: true });
        if (isBackendMode()) {
            try {
                let knownId = get().guildIdByCharacter[characterId] ?? get().guild?.id ?? null;
                if (!knownId) {
                    const found = await guildApi.findGuildForCharacter(characterId);
                    knownId = found?.guild?.id ?? null;
                }
                if (!knownId) {
                    set((s) => ({
                        guild: null,
                        members: [],
                        requests: [],
                        loading: false,
                        guildIdByCharacter: { ...s.guildIdByCharacter, [characterId]: null },
                    }));
                    return;
                }
                const res = await backendApi.showGuild(characterId, knownId) as {
                    guild: IGuildRow;
                    members: IGuildMemberRow[];
                    requests: IGuildJoinRequestRow[];
                };
                set((s) => ({
                    guild: res.guild,
                    members: res.members ?? [],
                    requests: res.requests ?? [],
                    loading: false,
                    guildIdByCharacter: { ...s.guildIdByCharacter, [characterId]: res.guild.id },
                }));
            } catch (err) {
                console.error('[guildStore] backend hydrate failed:', err);
                set({ loading: false });
            }
            return;
        }
        try {
            const res = await guildApi.findGuildForCharacter(characterId);
            if (!res) {
                set((s) => ({
                    guild: null,
                    members: [],
                    requests: [],
                    loading: false,
                    guildIdByCharacter: {
                        ...s.guildIdByCharacter,
                        [characterId]: null,
                    },
                }));
                const ch = get().channel;
                if (ch) {
                    try { void supabase.removeChannel(ch); } catch { }
                    set({ channel: null });
                }
                return;
            }
            set((s) => ({
                guild: res.guild,
                loading: false,
                guildIdByCharacter: {
                    ...s.guildIdByCharacter,
                    [characterId]: res.guild.id,
                },
            }));
            const [members, requests] = await Promise.all([
                guildApi.listMembers(res.guild.id),
                guildApi.listRequests(res.guild.id),
            ]);
            set({ members, requests });
            const guildId = res.guild.id;
            const existing = get().channel;
            if (existing) {
                try { void supabase.removeChannel(existing); } catch { }
            }
            const ch = supabase.channel(buildGuildChannel(guildId), {
                config: { broadcast: { self: true } },
            });
            ch.on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'guild_members', filter: `guild_id=eq.${guildId}` },
                () => { void get().refreshMembers(); },
            );
            ch.on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'guild_join_requests', filter: `guild_id=eq.${guildId}` },
                () => { void get().refreshRequests(); },
            );
            ch.on(
                'postgres_changes',
                { event: 'UPDATE', schema: 'public', table: 'guilds', filter: `id=eq.${guildId}` },
                async () => {
                    const refreshed = await guildApi.findGuildById(guildId);
                    if (refreshed) set({ guild: refreshed });
                },
            );
            ch.subscribe();
            set({ channel: ch });
        } catch (err) {
            console.error('[guildStore] hydrate failed:', err);
            set({ loading: false });
        }
    },

    refreshMembers: async () => {
        const g = get().guild;
        if (!g) return;
        try {
            const members = await guildApi.listMembers(g.id);
            set({ members });
        } catch { }
    },

    refreshRequests: async () => {
        const g = get().guild;
        if (!g) return;
        try {
            const requests = await guildApi.listRequests(g.id);
            set({ requests });
        } catch { }
    },

    setGuild: (g) => {
        set({ guild: g });
        if (g && !isBackendMode()) {
            const cap = guildMemberCap(g.level);
            if (cap !== g.member_cap) {
                void guildApi.updateGuildLevelXp({
                    guildId: g.id,
                    level: g.level,
                    xp: g.xp,
                    memberCap: cap,
                }).catch(() => { });
            }
        }
    },

    clear: () => {
        const ch = get().channel;
        if (ch) {
            try { void supabase.removeChannel(ch); } catch { }
        }
        set({
            guild: null,
            members: [],
            requests: [],
            loading: false,
            channel: null,
        });
    },
}));

export const isCurrentCharacterGuildLeader = (characterId: string | undefined): boolean => {
    const g = useGuildStore.getState().guild;
    if (!g || !characterId) return false;
    return g.leader_id === characterId;
};
