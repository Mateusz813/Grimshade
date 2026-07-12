
import { getAdminClient, withSupabaseRetry } from './adminClient';

export type TDeathSource = 'monster' | 'dungeon' | 'boss' | 'transform' | 'raid';
export type TDeathResult = 'killed' | 'fled';

export interface ISeedDeathArgs {
    characterId: string;
    characterName: string;
    characterClass: string;
    characterLevel: number;
    source?: TDeathSource;
    sourceName: string;
    sourceLevel: number;
    result?: TDeathResult;
    diedAt?: Date;
}

export interface ISeededDeath {
    id: string;
}


export const seedDeath = async (args: ISeedDeathArgs): Promise<ISeededDeath> => {
    const admin = getAdminClient();
    const payload: Record<string, unknown> = {
        character_id: args.characterId,
        character_name: args.characterName,
        character_class: args.characterClass,
        character_level: args.characterLevel,
        source: args.source ?? 'monster',
        source_name: args.sourceName,
        source_level: args.sourceLevel,
    };
    if (args.diedAt) {
        payload.died_at = args.diedAt.toISOString();
    }
    if (args.result) {
        payload.result = args.result;
    }

    const { data, error } = await withSupabaseRetry(
        () => admin
            .from('character_deaths')
            .insert(payload)
            .select('id')
            .single(),
    );

    if (error) {
        if (args.result && (error.message ?? '').includes("'result'")) {
            delete payload.result;
            const retry = await withSupabaseRetry(
                () => admin
                    .from('character_deaths')
                    .insert(payload)
                    .select('id')
                    .single(),
            );
            if (retry.error) {
                throw new Error(`[seedDeath] retry without result failed: ${retry.error.message ?? JSON.stringify(retry.error)}`);
            }
            if (!retry.data) {
                throw new Error('[seedDeath] retry returned no data');
            }
            return { id: retry.data.id as string };
        }
        throw new Error(`[seedDeath] insert failed: ${error.message ?? JSON.stringify(error)}`);
    }
    if (!data) {
        throw new Error('[seedDeath] insert returned no data');
    }

    return { id: data.id as string };
};
