import { BaseApi } from '../BaseApi';

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

    deleteCharacter = async (id: string): Promise<void> => {
        await this.delete({
            url: `/rest/v1/characters?id=eq.${id}`,
        });
    };
}

export const characterApi = new CharacterApi();
