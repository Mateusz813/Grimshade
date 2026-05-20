import { BaseApi } from '../BaseApi';

// 2026-05-19 v25 spec ("Dodać jeszcze raidy"): added 'raid' as a
// fifth death source. Existing rows default to whatever they
// already had — the column constraint is widened by
// `scripts/deaths_migration.sql` to accept all five values.
export type TDeathSource = 'monster' | 'dungeon' | 'boss' | 'transform' | 'raid';

// 2026-05-19 v25 spec ("Oraz zapisywać jeżeli ktoś nie umarł ale
// uciekł np z transformu i stracił XP jeśli nie mial eliksiru
// ochronnego, a nawet jeśli mial to tez ma być to tutaj pisane
// tylko z dopiskiem nie ze potwór zabił nick postaci. Tylko potwór
// przegnał i nick postaci."): `killed` = actual HP-zero death,
// `fled` = soft flee (Ucieknij button, URL leave). The deaths feed
// renders the verb based on this column.
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
