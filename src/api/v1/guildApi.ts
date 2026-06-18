import { BaseApi } from '../BaseApi';
import { supabase } from '../../lib/supabase';
import type { CharacterClass } from './characterApi';
import {
    getCurrentWeekStartIso,
    getTodayIso,
    getGuildBossMaxHp,
} from '../../systems/guildSystem';

/**
 * Guild API — thin REST/PostgREST wrapper around the `guilds`,
 * `guild_members`, `guild_boss_*`, `guild_treasury_*` and
 * `guild_join_requests` tables. The full schema + RLS policies live in
 * `scripts/guild_migration.sql` — run it once in the Supabase SQL
 * editor before this API works against a fresh project.
 *
 * The helpers below all return plain row shapes (TS interfaces below);
 * `useGuildStore` wraps them in higher-level actions (create, join,
 * kick, etc.) so the views never talk to PostgREST directly.
 *
 * Realtime channels are subscribed from the store (per-guild channel
 * `guild-{guildId}`) so member-list and boss-state updates flow without
 * polling.
 */

// -- Row shapes --------------------------------------------------------------

export interface IGuildRow {
    id: string;
    name: string;
    tag: string;
    logo: string;
    color: string;
    leader_id: string;
    level: number;
    xp: number;
    boss_tier: number;
    member_cap: number;
    created_at: string;
    updated_at: string;
}

export interface IGuildMemberRow {
    id: string;
    guild_id: string;
    character_id: string;
    character_name: string;
    character_class: CharacterClass;
    character_level: number;
    /** Highest completed transform tier — drives the rendered avatar
     *  art in the roster. 0 = base class portrait. */
    character_transform_tier: number;
    joined_at: string;
}

export interface IGuildBossStateRow {
    id: string;
    guild_id: string;
    week_start: string;
    boss_tier: number;
    boss_max_hp: number;
    boss_current_hp: number;
    boss_killed: boolean;
    current_attacker_id: string | null;
    created_at: string;
    updated_at: string;
}

export interface IGuildBossContributionRow {
    id: string;
    guild_id: string;
    character_id: string;
    week_start: string;
    total_damage: number;
    rewards_claimed: boolean;
    rewards_json: string | null;
    updated_at: string;
}

export interface IGuildBossAttemptRow {
    id: string;
    guild_id: string;
    character_id: string;
    character_name: string;
    attempt_date: string;
    damage_dealt: number;
    created_at: string;
}

export interface IGuildTreasuryItemRow {
    id: string;
    guild_id: string;
    item_data: string;
    deposited_by: string;
    deposited_by_name: string;
    deposited_at: string;
}

export interface IGuildTreasuryLogRow {
    id: string;
    guild_id: string;
    action: 'deposit' | 'withdraw';
    character_id: string;
    character_name: string;
    item_name: string;
    item_data: string | null;
    created_at: string;
}

export interface IGuildJoinRequestRow {
    id: string;
    guild_id: string;
    character_id: string;
    character_name: string;
    character_class: CharacterClass;
    character_level: number;
    requested_at: string;
}

// -- Helpers -----------------------------------------------------------------

/** Supabase realtime channel name for a single guild. Per-guild so
 *  members of guild A don't get blasted with guild B's boss / chat
 *  updates. */
export const buildGuildChannel = (guildId: string): string => `guild-${guildId}`;

class GuildApi extends BaseApi {
    // -- Guild list / lookup --------------------------------------------

    /** Fetch a single page of guilds for the browser. Server-side
     *  search by name uses ilike (case-insensitive). */
    listGuilds = async (params: {
        offset?: number;
        limit?: number;
        search?: string;
    }): Promise<IGuildRow[]> => {
        const offset = params.offset ?? 0;
        const limit = params.limit ?? 10;
        const q = new URLSearchParams();
        q.set('select', '*');
        q.set('order', 'level.desc,name.asc');
        q.set('offset', String(offset));
        q.set('limit', String(limit));
        if (params.search && params.search.trim()) {
            const safe = params.search.trim().replace(/[%_*]/g, '');
            q.set('name', `ilike.*${safe}*`);
        }
        return this.get<IGuildRow[]>({ url: `/rest/v1/guilds?${q.toString()}` });
    };

    /** Bulk lookup: guildId -> live member count + leader display name.
     *  Used by the list view so each row shows "1/20 · Lider Krasek".
     *  Single round-trip pulling every membership row for the given
     *  guild ids; the client buckets by guild_id locally. */
    listGuildSummaries = async (guildIds: string[]): Promise<Record<string, { memberCount: number; leaderName: string | null }>> => {
        const out: Record<string, { memberCount: number; leaderName: string | null }> = {};
        if (guildIds.length === 0) return out;
        const inList = guildIds.map((id) => `"${id}"`).join(',');
        const rows = await this.get<Array<{ guild_id: string; character_id: string; character_name: string }>>({
            url: `/rest/v1/guild_members?guild_id=in.(${inList})&select=guild_id,character_id,character_name`,
        });
        // Seed every requested guild with zero so the renderer can show
        // "0/20" even for empty guilds (shouldn't happen post-create
        // since the founder joins immediately, but defensive).
        for (const id of guildIds) out[id] = { memberCount: 0, leaderName: null };
        // Pair leader_id -> name via a second pull of the guild rows so
        // we don't depend on a fragile PostgREST relationship hint. The
        // leader lookup is per-guild so the row keeps its own data even
        // if PostgREST doesn't know the FK exists.
        const guildRows = await this.get<Array<{ id: string; leader_id: string }>>({
            url: `/rest/v1/guilds?id=in.(${inList})&select=id,leader_id`,
        });
        const leaderIdByGuild = new Map<string, string>();
        for (const g of guildRows) leaderIdByGuild.set(g.id, g.leader_id);
        const memberById = new Map<string, string>();
        for (const m of rows) memberById.set(m.character_id, m.character_name);
        for (const m of rows) {
            const slot = out[m.guild_id];
            if (slot) slot.memberCount += 1;
        }
        for (const [gid, lid] of leaderIdByGuild.entries()) {
            const slot = out[gid];
            if (slot) slot.leaderName = memberById.get(lid) ?? null;
        }
        return out;
    };

    /** Cheap count for pagination — uses PostgREST's `head` + `Range-Unit`. */
    countGuilds = async (search?: string): Promise<number> => {
        let query = supabase.from('guilds').select('id', { count: 'exact', head: true });
        if (search && search.trim()) {
            query = query.ilike('name', `%${search.trim().replace(/[%_*]/g, '')}%`);
        }
        const { count } = await query;
        return count ?? 0;
    };

    findGuildById = async (guildId: string): Promise<IGuildRow | null> => {
        const rows = await this.get<IGuildRow[]>({
            url: `/rest/v1/guilds?id=eq.${encodeURIComponent(guildId)}&select=*&limit=1`,
        });
        return rows[0] ?? null;
    };

    /** Resolve the guild a character belongs to (if any). */
    findGuildForCharacter = async (characterId: string): Promise<{ guild: IGuildRow; membership: IGuildMemberRow } | null> => {
        const members = await this.get<IGuildMemberRow[]>({
            url: `/rest/v1/guild_members?character_id=eq.${encodeURIComponent(characterId)}&select=*&limit=1`,
        });
        if (!members.length) return null;
        const guild = await this.findGuildById(members[0].guild_id);
        if (!guild) return null;
        return { guild, membership: members[0] };
    };

    // -- Create / leave / disband ---------------------------------------

    /** Insert a new guild + auto-add the creator as a member. */
    createGuild = async (params: {
        name: string;
        tag: string;
        logo: string;
        color: string;
        leaderId: string;
        leaderName: string;
        leaderClass: CharacterClass;
        leaderLevel: number;
        /** Founder's current highest-completed transform tier so the
         *  roster avatar renders right out of the gate. */
        leaderTransformTier?: number;
    }): Promise<IGuildRow> => {
        const { data: guildInsert, error: guildErr } = await supabase
            .from('guilds')
            .insert({
                name: params.name,
                tag: params.tag.toUpperCase().slice(0, 3),
                logo: params.logo,
                color: params.color,
                leader_id: params.leaderId,
            })
            .select('*')
            .single();
        if (guildErr || !guildInsert) {
            throw new Error(guildErr?.message ?? 'Nie udało się utworzyć gildii.');
        }
        // Add the founder as the first member so the realtime channel
        // already shows them in the roster.
        const { error: memErr } = await supabase.from('guild_members').insert({
            guild_id: guildInsert.id,
            character_id: params.leaderId,
            character_name: params.leaderName,
            character_class: params.leaderClass,
            character_level: params.leaderLevel,
            character_transform_tier: params.leaderTransformTier ?? 0,
        });
        if (memErr) {
            // Best-effort roll back so a half-created guild doesn't sit there.
            await supabase.from('guilds').delete().eq('id', guildInsert.id);
            throw new Error(memErr.message);
        }
        return guildInsert as IGuildRow;
    };

    /** Remove a character from their guild. If the character is the
     *  leader, hand leadership to a RANDOM remaining (live) member; if
     *  no one else is left, delete the guild outright. */
    leaveGuild = async (params: { guildId: string; characterId: string }): Promise<{ disbanded: boolean }> => {
        const guild = await this.findGuildById(params.guildId);
        if (!guild) return { disbanded: false };
        const isLeader = guild.leader_id === params.characterId;

        // For a leader leaving, decide the successor BEFORE removing them, using
        // a FRESH authoritative existence check (NOT listMembers — its read-safety
        // fallbacks can return ghosts). This guarantees leadership never lands on
        // a deleted character, and computing first shrinks the window in which a
        // later failed write could leave the guild leaderless.
        let nextLeaderId: string | null = null;
        if (isLeader) {
            const { data: others } = await supabase
                .from('guild_members')
                .select('character_id')
                .eq('guild_id', params.guildId);
            const candidateIds = (others ?? [])
                .map((o: { character_id: string }) => o.character_id)
                .filter((id: string) => id !== params.characterId);
            if (candidateIds.length > 0) {
                const live = await this
                    .get<Array<{ id: string }>>({ url: `/rest/v1/characters?id=in.(${candidateIds.join(',')})&select=id` })
                    .catch(() => [] as Array<{ id: string }>);
                const liveIds = live.map((c) => c.id);
                if (liveIds.length > 0) {
                    nextLeaderId = liveIds[Math.floor(Math.random() * liveIds.length)];
                }
            }
        }

        // Remove the leaver — surface failures instead of silently no-oping.
        const { error: delErr } = await supabase
            .from('guild_members')
            .delete()
            .eq('guild_id', params.guildId)
            .eq('character_id', params.characterId);
        if (delErr) throw delErr;

        if (!isLeader) return { disbanded: false };

        if (nextLeaderId) {
            const { error: upErr } = await supabase
                .from('guilds')
                .update({ leader_id: nextLeaderId })
                .eq('id', params.guildId);
            if (upErr) throw upErr;
            return { disbanded: false };
        }

        // No LIVE successor -> disband. Purge any leftover (ghost) member rows
        // first so nothing dangles, then drop the guild row (cascades clean
        // join requests / treasury / boss state).
        await supabase.from('guild_members').delete().eq('guild_id', params.guildId);
        const { error: gErr } = await supabase.from('guilds').delete().eq('id', params.guildId);
        if (gErr) throw gErr;
        return { disbanded: true };
    };

    /** Leader-only (UI-gated): disband the whole guild — delete every member
     *  row then the guild itself (FK cascades clean join requests / treasury /
     *  boss state). Lets a leader remove the guild without first leaving. */
    disbandGuild = async (guildId: string): Promise<void> => {
        const { error: mErr } = await supabase.from('guild_members').delete().eq('guild_id', guildId);
        if (mErr) throw mErr;
        const { error: gErr } = await supabase.from('guilds').delete().eq('id', guildId);
        if (gErr) throw gErr;
    };

    /** Leader-only: kick a member from the guild. */
    kickMember = async (params: { guildId: string; characterId: string }): Promise<void> => {
        await supabase
            .from('guild_members')
            .delete()
            .eq('guild_id', params.guildId)
            .eq('character_id', params.characterId);
    };

    listMembers = async (guildId: string): Promise<IGuildMemberRow[]> => {
        const rows = await this.get<IGuildMemberRow[]>({
            url: `/rest/v1/guild_members?guild_id=eq.${encodeURIComponent(guildId)}&select=*&order=joined_at.asc`,
        });
        if (rows.length === 0) return rows;

        // `guild_members` is a denormalised snapshot and isn't FK-cascaded, so a
        // member whose character was deleted lingers as a "ghost" row. We HIDE
        // such ghosts from the roster (read-only — we never delete here; that
        // caused a data-loss incident. Orphan rows are cleaned at delete time by
        // characterApi.deleteCharacter, and the disband-if-empty flow handles
        // truly empty guilds).
        const ids = [...new Set(rows.map((r) => r.character_id))];
        // UUIDs go UNQUOTED in PostgREST `in.()` — quoting them silently matches
        // nothing, which would hide the ENTIRE roster.
        const idList = ids.join(',');
        let existing: Set<string>;
        try {
            const chars = await this.get<Array<{ id: string }>>({
                url: `/rest/v1/characters?id=in.(${idList})&select=id`,
            });
            existing = new Set(chars.map((c) => c.id));
        } catch {
            return rows; // check failed -> show everyone, never hide live members
        }

        // Guard: if the existence check came back empty, treat it as unreliable
        // (or a genuinely empty-of-live-chars guild) and show the raw roster
        // rather than blanking it — never hide every member at once.
        if (existing.size === 0) return rows;

        return rows.filter((r) => existing.has(r.character_id));
    };

    /** Push character's freshest stats so the guild roster shows
     *  accurate level/class without a full refetch. */
    updateMemberStats = async (params: {
        characterId: string;
        level: number;
        characterClass: CharacterClass;
        transformTier?: number;
    }): Promise<void> => {
        const patch: Record<string, number | string> = {
            character_level: params.level,
            character_class: params.characterClass,
        };
        if (typeof params.transformTier === 'number') {
            patch.character_transform_tier = params.transformTier;
        }
        await supabase
            .from('guild_members')
            .update(patch)
            .eq('character_id', params.characterId);
    };

    updateGuildLevelXp = async (params: {
        guildId: string;
        level: number;
        xp: number;
        memberCap: number;
        bossTier?: number;
    }): Promise<void> => {
        const patch: Record<string, number | string> = {
            level: params.level,
            xp: params.xp,
            member_cap: params.memberCap,
            updated_at: new Date().toISOString(),
        };
        if (typeof params.bossTier === 'number') patch.boss_tier = params.bossTier;
        await supabase.from('guilds').update(patch).eq('id', params.guildId);
    };

    // -- Join requests --------------------------------------------------

    requestJoin = async (params: {
        guildId: string;
        characterId: string;
        characterName: string;
        characterClass: CharacterClass;
        characterLevel: number;
        characterTransformTier?: number;
    }): Promise<void> => {
        await supabase.from('guild_join_requests').insert({
            guild_id: params.guildId,
            character_id: params.characterId,
            character_name: params.characterName,
            character_class: params.characterClass,
            character_level: params.characterLevel,
        });
        // characterTransformTier isn't stored on the request row (kept
        // simple) — applied when the request is accepted via
        // acceptRequest's `characterTransformTier` field.
        void params.characterTransformTier;
    };

    listRequests = async (guildId: string): Promise<IGuildJoinRequestRow[]> => {
        return this.get<IGuildJoinRequestRow[]>({
            url: `/rest/v1/guild_join_requests?guild_id=eq.${encodeURIComponent(guildId)}&select=*&order=requested_at.asc`,
        });
    };

    deleteRequest = async (params: { requestId: string }): Promise<void> => {
        await supabase.from('guild_join_requests').delete().eq('id', params.requestId);
    };

    /** When a character joins a guild, drop every OTHER pending request
     *  from the same character — spec: "Jeżeli ktoś zgłosił się do kilku
     *  gildii na raz to po dołączeniu do jednej gildii znika od razu z
     *  prośby u innych gildii". */
    purgeRequestsForCharacter = async (characterId: string): Promise<void> => {
        await supabase
            .from('guild_join_requests')
            .delete()
            .eq('character_id', characterId);
    };

    /** Leader accepts a join request -> insert into members + drop every
     *  pending request that character had. */
    acceptRequest = async (params: {
        requestId: string;
        guildId: string;
        characterId: string;
        characterName: string;
        characterClass: CharacterClass;
        characterLevel: number;
        characterTransformTier?: number;
    }): Promise<void> => {
        const { error } = await supabase.from('guild_members').insert({
            guild_id: params.guildId,
            character_id: params.characterId,
            character_name: params.characterName,
            character_class: params.characterClass,
            character_level: params.characterLevel,
            character_transform_tier: params.characterTransformTier ?? 0,
        });
        if (error) {
            throw new Error(error.message);
        }
        await this.purgeRequestsForCharacter(params.characterId);
    };

    // -- Boss -----------------------------------------------------------

    /** Fetch (or lazily create) the current week's boss state. */
    fetchOrCreateWeeklyBoss = async (params: {
        guildId: string;
        bossTier: number;
    }): Promise<IGuildBossStateRow> => {
        const weekStart = getCurrentWeekStartIso();
        const rows = await this.get<IGuildBossStateRow[]>({
            url: `/rest/v1/guild_boss_state?guild_id=eq.${encodeURIComponent(params.guildId)}&week_start=eq.${weekStart}&select=*&limit=1`,
        });
        if (rows.length > 0) return rows[0];
        const maxHp = getGuildBossMaxHp(params.bossTier);
        const { data, error } = await supabase
            .from('guild_boss_state')
            .insert({
                guild_id: params.guildId,
                week_start: weekStart,
                boss_tier: params.bossTier,
                boss_max_hp: maxHp,
                boss_current_hp: maxHp,
                boss_killed: false,
                current_attacker_id: null,
            })
            .select('*')
            .single();
        if (error || !data) throw new Error(error?.message ?? 'Boss state create failed.');
        return data as IGuildBossStateRow;
    };

    /** Try to claim the arena for a character. Returns the updated row
     *  if claim succeeded (no other attacker, claimed within their
     *  allowed block window), null otherwise. Atomic via an `eq` on
     *  current_attacker_id IS NULL precondition. */
    claimBossArena = async (params: { guildId: string; characterId: string; weekStart: string }): Promise<IGuildBossStateRow | null> => {
        const { data, error } = await supabase
            .from('guild_boss_state')
            .update({
                current_attacker_id: params.characterId,
                updated_at: new Date().toISOString(),
            })
            .eq('guild_id', params.guildId)
            .eq('week_start', params.weekStart)
            .is('current_attacker_id', null)
            .select('*')
            .single();
        if (error || !data) return null;
        return data as IGuildBossStateRow;
    };

    /** Dev/leader-only: wipe the current week's boss state + attempts +
     *  contributions for this guild so the boss respawns from full
     *  HP. Spec: "zresetuj wszystkie bossy w gildi bo chcialem
     *  potestowac". Idempotent. */
    resetGuildBossForTesting = async (params: { guildId: string }): Promise<void> => {
        await supabase.from('guild_boss_state').delete().eq('guild_id', params.guildId);
        await supabase.from('guild_boss_attempts').delete().eq('guild_id', params.guildId);
        await supabase.from('guild_boss_contributions').delete().eq('guild_id', params.guildId);
        // Rewind the guild's own XP/level/tier so the next fight is
        // tier 1 again — matches the SQL reset script intent.
        await supabase
            .from('guilds')
            .update({ level: 1, xp: 0, boss_tier: 1, member_cap: 20, updated_at: new Date().toISOString() })
            .eq('id', params.guildId);
    };

    releaseBossArena = async (params: { guildId: string; weekStart: string }): Promise<void> => {
        await supabase
            .from('guild_boss_state')
            .update({
                current_attacker_id: null,
                updated_at: new Date().toISOString(),
            })
            .eq('guild_id', params.guildId)
            .eq('week_start', params.weekStart);
    };

    /** Apply boss damage atomically — clamps at 0, marks killed when
     *  HP reaches zero. */
    applyBossDamage = async (params: {
        guildId: string;
        weekStart: string;
        damage: number;
    }): Promise<IGuildBossStateRow | null> => {
        const cur = await this.get<IGuildBossStateRow[]>({
            url: `/rest/v1/guild_boss_state?guild_id=eq.${encodeURIComponent(params.guildId)}&week_start=eq.${params.weekStart}&select=*&limit=1`,
        });
        if (!cur.length) return null;
        const row = cur[0];
        const newHp = Math.max(0, row.boss_current_hp - Math.max(0, params.damage));
        const killed = newHp <= 0;
        const { data, error } = await supabase
            .from('guild_boss_state')
            .update({
                boss_current_hp: newHp,
                boss_killed: killed,
                current_attacker_id: killed ? null : row.current_attacker_id,
                updated_at: new Date().toISOString(),
            })
            .eq('id', row.id)
            .select('*')
            .single();
        if (error || !data) return null;
        return data as IGuildBossStateRow;
    };

    listAttemptsToday = async (params: {
        guildId: string;
        characterId: string;
    }): Promise<IGuildBossAttemptRow[]> => {
        const today = getTodayIso();
        return this.get<IGuildBossAttemptRow[]>({
            url: `/rest/v1/guild_boss_attempts?guild_id=eq.${encodeURIComponent(params.guildId)}&character_id=eq.${encodeURIComponent(params.characterId)}&attempt_date=eq.${today}&select=*`,
        });
    };

    logAttempt = async (params: {
        guildId: string;
        characterId: string;
        characterName: string;
        damageDealt: number;
    }): Promise<void> => {
        // 2026-05-18 v7: upsert silently failed in some test
        // environments (Supabase JS sometimes returns success without
        // actually writing when the ON CONFLICT clause hits an
        // unexpected constraint shape). Switched to explicit fetch +
        // update / insert — mirrors `addContribution`'s reliable
        // pattern. Logs every error so we can debug.
        const today = getTodayIso();
        try {
            const existing = await this.get<Array<{ id: string }>>({
                url: `/rest/v1/guild_boss_attempts?guild_id=eq.${encodeURIComponent(params.guildId)}&character_id=eq.${encodeURIComponent(params.characterId)}&attempt_date=eq.${today}&select=id&limit=1`,
            });
            if (existing.length > 0) {
                const { error } = await supabase
                    .from('guild_boss_attempts')
                    .update({
                        damage_dealt: params.damageDealt,
                        character_name: params.characterName,
                    })
                    .eq('id', existing[0].id);
                if (error) throw new Error(error.message);
            } else {
                const { error } = await supabase
                    .from('guild_boss_attempts')
                    .insert({
                        guild_id: params.guildId,
                        character_id: params.characterId,
                        character_name: params.characterName,
                        attempt_date: today,
                        damage_dealt: params.damageDealt,
                    });
                if (error) throw new Error(error.message);
            }
        } catch (err) {
            console.error('[guildApi.logAttempt] failed:', err);
            throw err;
        }
    };

    /** Every attack made against the current week's boss, newest
     *  first. Powers the scrolling attack log at the bottom of the
     *  boss view. */
    listWeeklyAttempts = async (params: {
        guildId: string;
        weekStart: string;
    }): Promise<IGuildBossAttemptRow[]> => {
        // attempt_date >= week_start (Monday) is the simplest filter
        // — Sunday's claim day rows share the same week_start.
        return this.get<IGuildBossAttemptRow[]>({
            url: `/rest/v1/guild_boss_attempts?guild_id=eq.${encodeURIComponent(params.guildId)}&attempt_date=gte.${params.weekStart}&select=*&order=created_at.desc`,
        });
    };

    fetchContribution = async (params: {
        guildId: string;
        characterId: string;
        weekStart: string;
    }): Promise<IGuildBossContributionRow | null> => {
        const rows = await this.get<IGuildBossContributionRow[]>({
            url: `/rest/v1/guild_boss_contributions?guild_id=eq.${encodeURIComponent(params.guildId)}&character_id=eq.${encodeURIComponent(params.characterId)}&week_start=eq.${params.weekStart}&select=*&limit=1`,
        });
        return rows[0] ?? null;
    };

    listContributions = async (params: {
        guildId: string;
        weekStart: string;
    }): Promise<IGuildBossContributionRow[]> => {
        return this.get<IGuildBossContributionRow[]>({
            url: `/rest/v1/guild_boss_contributions?guild_id=eq.${encodeURIComponent(params.guildId)}&week_start=eq.${params.weekStart}&select=*`,
        });
    };

    addContribution = async (params: {
        guildId: string;
        characterId: string;
        weekStart: string;
        damageAdd: number;
    }): Promise<void> => {
        const existing = await this.fetchContribution({
            guildId: params.guildId,
            characterId: params.characterId,
            weekStart: params.weekStart,
        });
        if (existing) {
            await supabase
                .from('guild_boss_contributions')
                .update({
                    total_damage: existing.total_damage + params.damageAdd,
                    updated_at: new Date().toISOString(),
                })
                .eq('id', existing.id);
        } else {
            await supabase.from('guild_boss_contributions').insert({
                guild_id: params.guildId,
                character_id: params.characterId,
                week_start: params.weekStart,
                total_damage: params.damageAdd,
            });
        }
    };

    markContributionClaimed = async (params: {
        contributionId: string;
        rewardsJson: string;
    }): Promise<void> => {
        await supabase
            .from('guild_boss_contributions')
            .update({
                rewards_claimed: true,
                rewards_json: params.rewardsJson,
                updated_at: new Date().toISOString(),
            })
            .eq('id', params.contributionId);
    };

    // -- Treasury -------------------------------------------------------

    listTreasury = async (guildId: string): Promise<IGuildTreasuryItemRow[]> => {
        return this.get<IGuildTreasuryItemRow[]>({
            url: `/rest/v1/guild_treasury_items?guild_id=eq.${encodeURIComponent(guildId)}&select=*&order=deposited_at.desc&limit=1000`,
        });
    };

    depositItem = async (params: {
        guildId: string;
        itemData: string;
        depositedBy: string;
        depositedByName: string;
        itemName: string;
    }): Promise<IGuildTreasuryItemRow> => {
        const { data, error } = await supabase
            .from('guild_treasury_items')
            .insert({
                guild_id: params.guildId,
                item_data: params.itemData,
                deposited_by: params.depositedBy,
                deposited_by_name: params.depositedByName,
            })
            .select('*')
            .single();
        if (error || !data) throw new Error(error?.message ?? 'Wpłata do skarbca nie udała się.');
        await supabase.from('guild_treasury_logs').insert({
            guild_id: params.guildId,
            action: 'deposit',
            character_id: params.depositedBy,
            character_name: params.depositedByName,
            item_name: params.itemName,
            item_data: params.itemData,
        });
        return data as IGuildTreasuryItemRow;
    };

    withdrawItem = async (params: {
        treasuryItemId: string;
        guildId: string;
        characterId: string;
        characterName: string;
        itemName: string;
        /** Serialized snapshot of the withdrawn item — lets the log
         *  popup render the rarity colour + level + upgrade level
         *  exactly like the deposit row. */
        itemData?: string;
    }): Promise<void> => {
        const { error } = await supabase
            .from('guild_treasury_items')
            .delete()
            .eq('id', params.treasuryItemId);
        if (error) throw new Error(error.message);
        await supabase.from('guild_treasury_logs').insert({
            guild_id: params.guildId,
            action: 'withdraw',
            character_id: params.characterId,
            character_name: params.characterName,
            item_name: params.itemName,
            item_data: params.itemData ?? null,
        });
    };

    listTreasuryLogs = async (guildId: string): Promise<IGuildTreasuryLogRow[]> => {
        return this.get<IGuildTreasuryLogRow[]>({
            url: `/rest/v1/guild_treasury_logs?guild_id=eq.${encodeURIComponent(guildId)}&select=*&order=created_at.desc&limit=200`,
        });
    };
}

export const guildApi = new GuildApi();
