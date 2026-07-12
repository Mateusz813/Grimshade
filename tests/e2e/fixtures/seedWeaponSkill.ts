
import { getAdminClient, withSupabaseRetry } from './adminClient';

export interface ISeedWeaponSkillArgs {
    characterId: string;
    skillName: string;
    skillLevel: number;
    skillXp?: number;
}

export const seedWeaponSkill = async (
    args: ISeedWeaponSkillArgs,
): Promise<void> => {
    const admin = getAdminClient();

    const { error: delErr } = await withSupabaseRetry(
        () => admin
            .from('character_weapon_skills')
            .delete()
            .eq('character_id', args.characterId)
            .eq('skill_name', args.skillName),
    );
    if (delErr) {
        throw new Error(`[seedWeaponSkill] delete failed: ${delErr.message ?? JSON.stringify(delErr)}`);
    }

    const { error: insErr } = await withSupabaseRetry(
        () => admin
            .from('character_weapon_skills')
            .insert({
                character_id: args.characterId,
                skill_name: args.skillName,
                skill_level: args.skillLevel,
                skill_xp: args.skillXp ?? 0,
                hits_count: 0,
                updated_at: new Date().toISOString(),
            }),
    );
    if (insErr) {
        throw new Error(`[seedWeaponSkill] insert failed: ${insErr.message ?? JSON.stringify(insErr)}`);
    }
};
