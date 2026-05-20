import { BaseApi } from '../BaseApi';
import { supabase } from '../../lib/supabase';

export type TCharacterClass = 'Knight' | 'Mage' | 'Cleric' | 'Archer' | 'Rogue' | 'Necromancer' | 'Bard';

/** @deprecated Use TCharacterClass instead */
export type CharacterClass = TCharacterClass;

export interface ICharacterPayload {
    name: string;
    class: TCharacterClass;
    hp?: number;
    max_hp?: number;
    mp?: number;
    max_mp?: number;
    attack?: number;
    defense?: number;
    attack_speed?: number;
    crit_chance?: number;
    crit_damage?: number;
    magic_level?: number;
    hp_regen?: number;
    mp_regen?: number;
    gold?: number;
    stat_points?: number;
    highest_level?: number;
}

export interface ICharacter {
    id: string;
    user_id: string;
    name: string;
    class: TCharacterClass;
    level: number;
    xp: number;
    hp: number;
    max_hp: number;
    mp: number;
    max_mp: number;
    attack: number;
    defense: number;
    attack_speed: number;
    crit_chance: number;
    crit_damage: number;
    magic_level: number;
    hp_regen: number;
    mp_regen: number;
    gold: number;
    stat_points: number;
    highest_level: number;
    equipment: Record<string, string | null>;
    created_at: string;
    updated_at: string;
}

const SUPABASE_RETURN_HEADERS = { headers: { 'Prefer': 'return=representation' } };

class CharacterApi extends BaseApi {
    getCharacter = async (userId: string): Promise<ICharacter> => {
        const data = await this.get<ICharacter[]>({
            url: `/rest/v1/characters?user_id=eq.${userId}&select=*&limit=1`,
        });
        return data[0];
    };

    getCharacters = async (userId: string): Promise<ICharacter[]> => {
        return this.get<ICharacter[]>({
            url: `/rest/v1/characters?user_id=eq.${userId}&select=*&order=created_at.asc`,
        });
    };

    createCharacter = async (userId: string, payload: ICharacterPayload): Promise<ICharacter> => {
        const data = await this.post<ICharacterPayload & { user_id: string }, ICharacter[]>({
            url: '/rest/v1/characters',
            data: { ...payload, user_id: userId },
            config: SUPABASE_RETURN_HEADERS,
        });
        return data[0];
    };

    updateCharacter = async (id: string, payload: Partial<ICharacter>): Promise<ICharacter> => {
        const data = await this.patch<Partial<ICharacter>, ICharacter[]>({
            url: `/rest/v1/characters?id=eq.${id}`,
            data: { ...payload, updated_at: new Date().toISOString() },
            config: SUPABASE_RETURN_HEADERS,
        });
        return data[0];
    };

    /**
     * 2026-05-19 v15 spec ("Dodać do rankingu arenę"): increment the
     * player's arena_kills / arena_deaths counters AND overwrite
     * their current league + LP snapshot. Two PostgREST calls so we
     * can read the existing kill/death counters, add the delta, then
     * patch them back — Supabase doesn't support `+ 1` increments
     * via the REST API.
     *
     * Fire-and-forget by the arena store after every match
     * resolution. Failures get surfaced via console.warn so the
     * player can see in DevTools whether the migration column
     * exists / RLS allows the update.
     *
     * 2026-05-19 v16 spec ("Zabilem na arenie nekromante i nie
     * zaliczylo mu tego jako zabojstwo"): added explicit logging
     * + `Prefer: return=representation` on the PATCH so we know
     * the column actually persisted and the next leaderboard
     * fetch will see the new value.
     */
    bumpArenaStats = async (params: {
        characterId: string;
        winDelta: number;
        lossDelta: number;
        league: string;
        leaguePoints: number;
    }): Promise<void> => {
        try {
            const rows = await this.get<Array<Pick<ICharacter, 'arena_kills' | 'arena_deaths'>>>({
                url: `/rest/v1/characters?id=eq.${params.characterId}&select=arena_kills,arena_deaths&limit=1`,
            });
            const current = rows[0] ?? { arena_kills: 0, arena_deaths: 0 };
            const nextKills = (current.arena_kills ?? 0) + Math.max(0, params.winDelta);
            const nextDeaths = (current.arena_deaths ?? 0) + Math.max(0, params.lossDelta);
            const result = await this.patch<Partial<ICharacter>, ICharacter[]>({
                url: `/rest/v1/characters?id=eq.${params.characterId}`,
                data: {
                    arena_kills: nextKills,
                    arena_deaths: nextDeaths,
                    arena_league: params.league,
                    arena_league_points: params.leaguePoints,
                    updated_at: new Date().toISOString(),
                },
                config: SUPABASE_RETURN_HEADERS,
            });
            // eslint-disable-next-line no-console
            console.log('[arena-sync] bumped', {
                charId: params.characterId,
                winDelta: params.winDelta,
                lossDelta: params.lossDelta,
                league: params.league,
                leaguePoints: params.leaguePoints,
                resultKills: result?.[0]?.arena_kills,
                resultDeaths: result?.[0]?.arena_deaths,
            });
        } catch (err) {
            // Surface failures so the user can see whether the
            // migration was applied / RLS allows the patch.
            // eslint-disable-next-line no-console
            console.warn('[arena-sync] bumpArenaStats failed:', err);
        }
    };

    /**
     * 2026-05-19 v16 spec ("Dodaj jeszcze zakladke z punktami
     * masteri, wykonanymi questami ..."): generic counter bumper
     * for the per-character activity stats that drive the new
     * leaderboard tabs (mastery_points, quests_*, market_*,
     * item_upgrades_done, skill_upgrades_done, best_dps5_*).
     *
     * `mode: 'add'` adds the delta to whatever's stored (incremental
     * counters like quests done / market sales). `mode: 'max'`
     * replaces the stored value only when the new value is larger
     * (high-water marks like best_dps5_*). `mode: 'set'` always
     * overwrites (used by mastery_points which is computed as a
     * total client-side and pushed verbatim).
     *
     * Fire-and-forget — failures (column missing / RLS denied) are
     * surfaced via console.warn so the player can diagnose without
     * crashing the game flow.
     */
    bumpStat = async (params: {
        characterId: string;
        column: keyof ICharacter;
        value: number;
        mode?: 'add' | 'max' | 'set';
    }): Promise<void> => {
        const mode = params.mode ?? 'add';
        const col = params.column;
        try {
            // 'set' skips the read-modify-write — just overwrite.
            let nextValue = params.value;
            if (mode !== 'set') {
                const rows = await this.get<Array<Record<string, number | null>>>({
                    url: `/rest/v1/characters?id=eq.${params.characterId}&select=${col}&limit=1`,
                });
                const current = rows[0]?.[col as string] ?? 0;
                if (mode === 'add') {
                    nextValue = (current ?? 0) + Math.max(0, params.value);
                } else if (mode === 'max') {
                    nextValue = Math.max(current ?? 0, params.value);
                    if (nextValue === (current ?? 0)) return; // no-op
                }
            }
            await this.patch({
                url: `/rest/v1/characters?id=eq.${params.characterId}`,
                data: {
                    [col]: nextValue,
                    updated_at: new Date().toISOString(),
                },
                config: SUPABASE_RETURN_HEADERS,
            });
        } catch (err) {
            // eslint-disable-next-line no-console
            console.warn(`[bumpStat] failed for ${String(col)}:`, err);
        }
    };

    /**
     * 2026-05-19 v18: cross-player counter bumpers backed by SECURITY
     * DEFINER RPCs in `leaderboard_migration.sql`. Each call hits a
     * specific Postgres function that updates the TARGET player's
     * row — needed because RLS only allows users to UPDATE their own
     * row, and the arena leaderboard needs the WINNER to bump the
     * LOSER's `arena_deaths`, the BUYER to bump the SELLER's
     * `market_items_sold` + `market_gold_earned`, etc.
     *
     * Fire-and-forget; failures get console.warn'd so the player can
     * diagnose missing migrations / EXECUTE grants in DevTools.
     */
    bumpArenaDeathRpc = async (targetCharacterId: string): Promise<void> => {
        try {
            const { error } = await supabase.rpc('bump_arena_death', {
                target_character_id: targetCharacterId,
            });
            if (error) {
                // eslint-disable-next-line no-console
                console.warn('[arena-sync] bump_arena_death RPC failed:', error);
            }
        } catch (err) {
            // eslint-disable-next-line no-console
            console.warn('[arena-sync] bump_arena_death RPC threw:', err);
        }
    };

    bumpArenaKillRpc = async (targetCharacterId: string): Promise<void> => {
        try {
            const { error } = await supabase.rpc('bump_arena_kill', {
                target_character_id: targetCharacterId,
            });
            if (error) {
                // eslint-disable-next-line no-console
                console.warn('[arena-sync] bump_arena_kill RPC failed:', error);
            }
        } catch (err) {
            // eslint-disable-next-line no-console
            console.warn('[arena-sync] bump_arena_kill RPC threw:', err);
        }
    };

    bumpMarketSaleRpc = async (params: {
        sellerCharacterId: string;
        quantity: number;
        goldAmount: number;
    }): Promise<void> => {
        try {
            const { error } = await supabase.rpc('bump_market_sale', {
                seller_character_id: params.sellerCharacterId,
                quantity: params.quantity,
                gold_amount: params.goldAmount,
            });
            if (error) {
                // eslint-disable-next-line no-console
                console.warn('[market-sync] bump_market_sale RPC failed:', error);
            }
        } catch (err) {
            // eslint-disable-next-line no-console
            console.warn('[market-sync] bump_market_sale RPC threw:', err);
        }
    };

    deleteCharacter = async (id: string): Promise<void> => {
        await this.delete({
            url: `/rest/v1/characters?id=eq.${id}`,
        });
    };
}

export const characterApi = new CharacterApi();
