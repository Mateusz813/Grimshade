
const SYS_MARKER = '[SYS]';

export type TSystemMessageType = 'upgrade' | 'skillUpgrade';

export interface ISystemUpgradePayload {
    type: 'upgrade';
    itemId: string;
    rarity: string;
    upgradeLevel: number;
    itemName: string;
}

export interface ISystemSkillUpgradePayload {
    type: 'skillUpgrade';
    skillId: string;
    skillName: string;
    upgradeLevel: number;
}

export type TSystemMessagePayload = ISystemUpgradePayload | ISystemSkillUpgradePayload;

export const isUpgradeMilestone = (level: number): boolean => {
    return level === 5 || level === 7 || level >= 10;
};

export const formatSystemMessage = (payload: TSystemMessagePayload): string => {
    return `${SYS_MARKER}${JSON.stringify(payload)}`;
};

export const parseSystemMessage = (content: string): TSystemMessagePayload | null => {
    if (!content.startsWith(SYS_MARKER)) return null;
    const json = content.slice(SYS_MARKER.length).trim();
    if (!json) return null;
    try {
        const parsed = JSON.parse(json) as Partial<TSystemMessagePayload>;
        if (parsed.type === 'upgrade'
            && typeof (parsed as Partial<ISystemUpgradePayload>).itemId === 'string'
            && typeof (parsed as Partial<ISystemUpgradePayload>).rarity === 'string'
            && typeof (parsed as Partial<ISystemUpgradePayload>).upgradeLevel === 'number'
            && typeof (parsed as Partial<ISystemUpgradePayload>).itemName === 'string') {
            const p = parsed as ISystemUpgradePayload;
            return {
                type: 'upgrade',
                itemId: p.itemId,
                rarity: p.rarity,
                upgradeLevel: p.upgradeLevel,
                itemName: p.itemName,
            };
        }
        if (parsed.type === 'skillUpgrade'
            && typeof (parsed as Partial<ISystemSkillUpgradePayload>).skillId === 'string'
            && typeof (parsed as Partial<ISystemSkillUpgradePayload>).skillName === 'string'
            && typeof (parsed as Partial<ISystemSkillUpgradePayload>).upgradeLevel === 'number') {
            const p = parsed as ISystemSkillUpgradePayload;
            return {
                type: 'skillUpgrade',
                skillId: p.skillId,
                skillName: p.skillName,
                upgradeLevel: p.upgradeLevel,
            };
        }
        return null;
    } catch {
        return null;
    }
};
