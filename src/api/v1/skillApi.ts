import { BaseApi } from '../BaseApi';

export interface ICharacterSkill {
    id: string;
    character_id: string;
    skill_id: string;
    level: number;
    xp: number;
    xp_to_next: number;
    is_active: boolean;
    slot_index: number | null;
    updated_at: string;
}

interface ISkillInit {
    character_id: string;
    skill_id: string;
    level: number;
    xp: number;
    xp_to_next: number;
    is_active: boolean;
    slot_index: number | null;
    updated_at: string;
}

const SUPABASE_RETURN_HEADERS = { headers: { 'Prefer': 'return=representation' } };

class SkillApi extends BaseApi {
    getSkills = async (characterId: string): Promise<ICharacterSkill[]> => {
        return this.get<ICharacterSkill[]>({
            url: `/rest/v1/character_skills?character_id=eq.${characterId}&select=*`,
        });
    };

    updateSkill = async (skillId: string, payload: Partial<ICharacterSkill>): Promise<ICharacterSkill> => {
        const data = await this.patch<Partial<ICharacterSkill>, ICharacterSkill[]>({
            url: `/rest/v1/character_skills?id=eq.${skillId}`,
            data: { ...payload, updated_at: new Date().toISOString() },
            config: SUPABASE_RETURN_HEADERS,
        });
        return data[0];
    };

    initSkills = async (characterId: string, skillIds: string[]): Promise<ICharacterSkill[]> => {
        const skills: ISkillInit[] = skillIds.map((skillId, idx) => ({
            character_id: characterId,
            skill_id: skillId,
            level: 1,
            xp: 0,
            xp_to_next: 100,
            is_active: idx < 4,
            slot_index: idx < 4 ? idx : null,
            updated_at: new Date().toISOString(),
        }));
        return this.post<ISkillInit[], ICharacterSkill[]>({
            url: '/rest/v1/character_skills',
            data: skills,
            config: SUPABASE_RETURN_HEADERS,
        });
    };
}

export const skillApi = new SkillApi();
