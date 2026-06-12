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

/**
 * Guild membership store — caches the player's current guild + its
 * members, and surfaces helpers for the leader UI (kick, promote,
 * accept join requests).
 *
 * Membership lookup runs on character switch / login via
 * `hydrateForCharacter`; once we know the guild id, a per-guild
 * Realtime channel keeps the local roster + join-request list in sync.
 *
 * The store is intentionally character-scoped — every store action
 * passes the active character id explicitly. That keeps multi-character
 * sessions on the same browser independent (character A in guild X,
 * character B in guild Y).
 */

interface IGuildStoreState {
    /** Current guild metadata, or null when the player is unaffiliated. */
    guild: IGuildRow | null;
    /** Live member list (always sorted by joined_at asc). */
    members: IGuildMemberRow[];
    /** Pending join requests for the active guild (leader-only UI). */
    requests: IGuildJoinRequestRow[];
    /** True while membership is being hydrated. */
    loading: boolean;
    /** Per-character map: characterId -> guildId. Used by routing to
     *  decide whether /guild lands on the list or the detail view. */
    guildIdByCharacter: Record<string, string | null>;
    /** Active realtime channel (per-guild). */
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
                // Tear down any stale channel.
                const ch = get().channel;
                if (ch) {
                    try { void supabase.removeChannel(ch); } catch { /* ignore */ }
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
            // Open realtime channel for the guild.
            const guildId = res.guild.id;
            const existing = get().channel;
            if (existing) {
                try { void supabase.removeChannel(existing); } catch { /* ignore */ }
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
        } catch { /* offline */ }
    },

    refreshRequests: async () => {
        const g = get().guild;
        if (!g) return;
        try {
            const requests = await guildApi.listRequests(g.id);
            set({ requests });
        } catch { /* offline */ }
    },

    setGuild: (g) => {
        set({ guild: g });
        if (g) {
            const cap = guildMemberCap(g.level);
            if (cap !== g.member_cap) {
                // Keep the server row in sync when the client computes a
                // newer cap from the (possibly higher) live level — no-op
                // server-side if already correct.
                void guildApi.updateGuildLevelXp({
                    guildId: g.id,
                    level: g.level,
                    xp: g.xp,
                    memberCap: cap,
                }).catch(() => { /* offline */ });
            }
        }
    },

    clear: () => {
        const ch = get().channel;
        if (ch) {
            try { void supabase.removeChannel(ch); } catch { /* ignore */ }
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

/** Convenience selector — returns true when the active character is the
 *  guild leader. */
export const isCurrentCharacterGuildLeader = (characterId: string | undefined): boolean => {
    const g = useGuildStore.getState().guild;
    if (!g || !characterId) return false;
    return g.leader_id === characterId;
};
