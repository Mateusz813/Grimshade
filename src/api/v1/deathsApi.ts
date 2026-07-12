import { BaseApi } from '../BaseApi';

export type TDeathSource = 'monster' | 'dungeon' | 'boss' | 'transform' | 'raid';

export type TDeathResult = 'killed' | 'fled';

export interface IDeathRecord {
    id: string;
    character_id: string;
    character_name: string;
    character_class: string;
    character_level: number;
    source: TDeathSource;
    source_name: string;
    source_level: number;
    died_at: string;
    result?: TDeathResult;
}

export interface IDeathPayload {
    character_id: string;
    character_name: string;
    character_class: string;
    character_level: number;
    source: TDeathSource;
    source_name: string;
    source_level: number;
    result?: TDeathResult;
}


const SUPABASE_RETURN_HEADERS = { headers: { 'Prefer': 'return=representation' } };

class DeathsApi extends BaseApi {
    logDeath = async (payload: IDeathPayload): Promise<IDeathRecord | null> => {
        try {
            const data = await this.post<IDeathPayload, IDeathRecord[]>({
                url: '/rest/v1/character_deaths',
                data: payload,
                config: SUPABASE_RETURN_HEADERS,
            });
            return data[0] ?? null;
        } catch (err) {
            console.warn('[deathsApi] Failed to log death:', err);
            return null;
        }
    };

    listRecentDeaths = async (limit = 100): Promise<IDeathRecord[]> => {
        try {
            return await this.get<IDeathRecord[]>({
                url: `/rest/v1/character_deaths?select=*&order=died_at.desc&limit=${limit}`,
            });
        } catch (err) {
            console.warn('[deathsApi] Failed to fetch deaths:', err);
            return [];
        }
    };
}

export const deathsApi = new DeathsApi();
