import { BaseApi } from '../BaseApi';

export type TDeathSource = 'monster' | 'dungeon' | 'boss' | 'transform';

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
}

export interface IDeathPayload {
    character_id: string;
    character_name: string;
    character_class: string;
    character_level: number;
    source: TDeathSource;
    source_name: string;
    source_level: number;
}

/**
 * Supabase table required (run once in SQL editor):
 *
 * CREATE TABLE character_deaths (
 *     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 *     character_id UUID REFERENCES characters(id) ON DELETE CASCADE,
 *     character_name TEXT NOT NULL,
 *     character_class TEXT NOT NULL,
 *     character_level INTEGER NOT NULL,
 *     source TEXT NOT NULL CHECK (source IN ('monster', 'dungeon', 'boss', 'transform')),
 *     -- Existing table? run:
 *     --   ALTER TABLE character_deaths DROP CONSTRAINT character_deaths_source_check;
 *     --   ALTER TABLE character_deaths ADD CONSTRAINT character_deaths_source_check
 *     --     CHECK (source IN ('monster', 'dungeon', 'boss', 'transform'));
 *     source_name TEXT NOT NULL,
 *     source_level INTEGER NOT NULL,
 *     died_at TIMESTAMPTZ DEFAULT NOW()
 * );
 *
 * ALTER TABLE character_deaths ENABLE ROW LEVEL SECURITY;
 *
 * -- Anyone can read the global death feed
 * CREATE POLICY "Anyone can view deaths"
 *     ON character_deaths FOR SELECT USING (TRUE);
 *
 * -- Only the owner of the character can insert death records
 * CREATE POLICY "Users can log own deaths"
 *     ON character_deaths FOR INSERT
 *     WITH CHECK (character_id IN (SELECT id FROM characters WHERE user_id = auth.uid()));
 *
 * CREATE INDEX idx_deaths_died_at ON character_deaths(died_at DESC);
 */

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
            // Death logging is non-critical: never break the death flow if Supabase fails
            // (offline play, missing table, RLS issue, etc.)
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
