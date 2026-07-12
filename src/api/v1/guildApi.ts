import { BaseApi } from '../BaseApi';
import { supabase } from '../../lib/supabase';
import type { CharacterClass } from './characterApi';
import {
    getCurrentWeekStartIso,
    getTodayIso,
    getGuildBossMaxHp,
} from '../../systems/guildSystem';



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


export const buildGuildChannel = (guildId: string): string => `guild-${guildId}`;

class GuildApi extends BaseApi {

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

    listGuildSummaries = async (guildIds: string[]): Promise<Record<string, { memberCount: number; leaderName: string | null }>> => {
        const out: Record<string, { memberCount: number; leaderName: string | null }> = {};
        if (guildIds.length === 0) return out;
        const inList = guildIds.map((id) => `"${id}"`).join(',');
        const rows = await this.get<Array<{ guild_id: string; character_id: string; character_name: string }>>({
            url: `/rest/v1/guild_members?guild_id=in.(${inList})&select=guild_id,character_id,character_name`,
        });
        for (const id of guildIds) out[id] = { memberCount: 0, leaderName: null };
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

    findGuildForCharacter = async (characterId: string): Promise<{ guild: IGuildRow; membership: IGuildMemberRow } | null> => {
        const members = await this.get<IGuildMemberRow[]>({
            url: `/rest/v1/guild_members?character_id=eq.${encodeURIComponent(characterId)}&select=*&limit=1`,
        });
        if (!members.length) return null;
        const guild = await this.findGuildById(members[0].guild_id);
        if (!guild) return null;
        return { guild, membership: members[0] };
    };


    createGuild = async (params: {
        name: string;
        tag: string;
        logo: string;
        color: string;
        leaderId: string;
        leaderName: string;
        leaderClass: CharacterClass;
        leaderLevel: number;
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
        const { error: memErr } = await supabase.from('guild_members').insert({
            guild_id: guildInsert.id,
            character_id: params.leaderId,
            character_name: params.leaderName,
            character_class: params.leaderClass,
            character_level: params.leaderLevel,
            character_transform_tier: params.leaderTransformTier ?? 0,
        });
        if (memErr) {
            await supabase.from('guilds').delete().eq('id', guildInsert.id);
            throw new Error(memErr.message);
        }
        return guildInsert as IGuildRow;
    };

    leaveGuild = async (params: { guildId: string; characterId: string }): Promise<{ disbanded: boolean }> => {
        const guild = await this.findGuildById(params.guildId);
        if (!guild) return { disbanded: false };
        const isLeader = guild.leader_id === params.characterId;

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

        await supabase.from('guild_members').delete().eq('guild_id', params.guildId);
        const { error: gErr } = await supabase.from('guilds').delete().eq('id', params.guildId);
        if (gErr) throw gErr;
        return { disbanded: true };
    };

    disbandGuild = async (guildId: string): Promise<void> => {
        const { error: mErr } = await supabase.from('guild_members').delete().eq('guild_id', guildId);
        if (mErr) throw mErr;
        const { error: gErr } = await supabase.from('guilds').delete().eq('id', guildId);
        if (gErr) throw gErr;
    };

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

        const ids = [...new Set(rows.map((r) => r.character_id))];
        const idList = ids.join(',');
        let existing: Set<string>;
        try {
            const chars = await this.get<Array<{ id: string }>>({
                url: `/rest/v1/characters?id=in.(${idList})&select=id`,
            });
            existing = new Set(chars.map((c) => c.id));
        } catch {
            return rows;
        }

        if (existing.size === 0) return rows;

        return rows.filter((r) => existing.has(r.character_id));
    };

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

    purgeRequestsForCharacter = async (characterId: string): Promise<void> => {
        await supabase
            .from('guild_join_requests')
            .delete()
            .eq('character_id', characterId);
    };

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

    resetGuildBossForTesting = async (params: { guildId: string }): Promise<void> => {
        await supabase.from('guild_boss_state').delete().eq('guild_id', params.guildId);
        await supabase.from('guild_boss_attempts').delete().eq('guild_id', params.guildId);
        await supabase.from('guild_boss_contributions').delete().eq('guild_id', params.guildId);
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

    listWeeklyAttempts = async (params: {
        guildId: string;
        weekStart: string;
    }): Promise<IGuildBossAttemptRow[]> => {
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
