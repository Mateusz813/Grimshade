import { BaseApi } from '../BaseApi';
import { supabase } from '../../lib/supabase';
import { isBackendMode } from '../../config/backendMode';
import { backendApi } from '../backend/backendApi';

export type TCharacterClass = 'Knight' | 'Mage' | 'Cleric' | 'Archer' | 'Rogue' | 'Necromancer' | 'Bard';

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

export type { ICharacter } from '../../types/character';
import type { ICharacter } from '../../types/character';

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
        if (isBackendMode()) {
            return await backendApi.createCharacter({ name: payload.name, class: payload.class }) as ICharacter;
        }
        const data = await this.post<ICharacterPayload & { user_id: string }, ICharacter[]>({
            url: '/rest/v1/characters',
            data: { ...payload, user_id: userId },
            config: SUPABASE_RETURN_HEADERS,
        });
        return data[0];
    };

    updateCharacter = async (id: string, payload: Partial<ICharacter>): Promise<ICharacter> => {
        if (isBackendMode()) {
            return { id, ...payload } as ICharacter;
        }
        const data = await this.patch<Partial<ICharacter>, ICharacter[]>({
            url: `/rest/v1/characters?id=eq.${id}`,
            data: { ...payload, updated_at: new Date().toISOString() },
            config: SUPABASE_RETURN_HEADERS,
        });
        return data[0];
    };

    bumpArenaStats = async (params: {
        characterId: string;
        winDelta: number;
        lossDelta: number;
        league: string;
        leaguePoints: number;
    }): Promise<void> => {
        if (isBackendMode()) return;
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
            console.warn('[arena-sync] bumpArenaStats failed:', err);
        }
    };

    bumpStat = async (params: {
        characterId: string;
        column: keyof ICharacter;
        value: number;
        mode?: 'add' | 'max' | 'set';
    }): Promise<void> => {
        if (isBackendMode()) return;
        const mode = params.mode ?? 'add';
        const col = params.column;
        try {
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
                    if (nextValue === (current ?? 0)) return;
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
            console.warn(`[bumpStat] failed for ${String(col)}:`, err);
        }
    };

    bumpArenaDeathRpc = async (targetCharacterId: string): Promise<void> => {
        if (isBackendMode()) return;
        try {
            const { error } = await supabase.rpc('bump_arena_death', {
                target_character_id: targetCharacterId,
            });
            if (error) {
                console.warn('[arena-sync] bump_arena_death RPC failed:', error);
            }
        } catch (err) {
            console.warn('[arena-sync] bump_arena_death RPC threw:', err);
        }
    };

    bumpArenaKillRpc = async (targetCharacterId: string): Promise<void> => {
        if (isBackendMode()) return;
        try {
            const { error } = await supabase.rpc('bump_arena_kill', {
                target_character_id: targetCharacterId,
            });
            if (error) {
                console.warn('[arena-sync] bump_arena_kill RPC failed:', error);
            }
        } catch (err) {
            console.warn('[arena-sync] bump_arena_kill RPC threw:', err);
        }
    };

    bumpMarketSaleRpc = async (params: {
        sellerCharacterId: string;
        quantity: number;
        goldAmount: number;
    }): Promise<void> => {
        if (isBackendMode()) return;
        try {
            const { error } = await supabase.rpc('bump_market_sale', {
                seller_character_id: params.sellerCharacterId,
                quantity: params.quantity,
                gold_amount: params.goldAmount,
            });
            if (error) {
                console.warn('[market-sync] bump_market_sale RPC failed:', error);
            }
        } catch (err) {
            console.warn('[market-sync] bump_market_sale RPC threw:', err);
        }
    };

    deleteCharacter = async (id: string): Promise<void> => {
        if (isBackendMode()) {
            await backendApi.deleteCharacter(id);
            return;
        }
        const memberships = ['guild_members', 'party_members', 'guild_join_requests'] as const;
        await Promise.all(
            memberships.map((table) =>
                this.delete({ url: `/rest/v1/${table}?character_id=eq.${id}` }).catch(() => undefined),
            ),
        );
        await this.delete({
            url: `/rest/v1/characters?id=eq.${id}`,
        });
    };
}

export const characterApi = new CharacterApi();
