export type TSkillMode = 'AUTO' | 'MANUAL';

export interface ISkill {
    id: string;
    name_pl: string;
    name_en: string;
    class: string;
    minLevel: number;
    mpCost: number;
    cooldown: number;
    damage?: number;
    multiplier?: number;
    effect?: string;
    description_pl: string;
    description_en: string;
    icon: string;
}

export interface IWeaponSkill {
    id: string;
    level: number;
    xp: number;
}

export interface IActiveSkill {
    skillId: string;
    slotIndex: 0 | 1 | 2 | 3;
}

export interface ICharacterSkill {
    skillId: string;
    skillLevel: number;
    skillXp: number;
    isActive: boolean;
    slotIndex: number;
}

export interface ISkillState {
    /** weapon/magic skill id -> level (0-100) */
    skillLevels: Record<string, number>;
    /** weapon/magic skill id -> current XP towards next level */
    skillXp: Record<string, number>;
    /** active skill slot ids (max 4) - ordered array of active skill IDs */
    activeSkillSlots: [string | null, string | null, string | null, string | null];
    /** id of skill chosen for always-on training */
    offlineTrainingSkillId: string | null;
    /** ISO timestamp of when the current speed segment started */
    trainingSegmentStartedAt: string | null;
    /** Accumulated effective training seconds (segments × their speed multiplier) */
    trainingAccumulatedEffectiveSeconds: number;
    /** Current training speed: 2 = active play, 1 = inactive/background */
    trainingCurrentSpeedMultiplier: number;
}
