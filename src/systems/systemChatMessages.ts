/**
 * System-channel message payloads.
 *
 * 2026-05-19 v14 spec ("Chat system brak zdjecia przedmiotu oraz
 * dodawaj odpowiednie tlo z rarity"): plain text doesn't give us
 * enough hooks to render the item icon + rarity-coloured background
 * in the System tab, so every server-broadcast event encodes its
 * details as a JSON blob prefixed with a recognisable marker.
 *
 * Format on the wire:
 *   `[SYS]{"type":"upgrade","itemId":"luk","rarity":"common","upgradeLevel":5,"itemName":"Krótki Łuk"}`
 *   `[SYS]{"type":"skillUpgrade","skillId":"power_strike","skillName":"Potężny Cios","upgradeLevel":10}`
 *
 * The marker (`[SYS]`) plus a single JSON object keeps the payload
 * under the 300-char cap on `messages.content` and survives the
 * trim/slice the chat API applies on send.
 *
 * Older free-text system messages (pre-v14) fall through the
 * `parseSystemMessage` parser and render as plain text in the
 * System tab — backward-compatible with the legacy format.
 */

const SYS_MARKER = '[SYS]';

export type TSystemMessageType = 'upgrade' | 'skillUpgrade';

export interface ISystemUpgradePayload {
    type: 'upgrade';
    itemId: string;
    rarity: string;
    upgradeLevel: number;
    itemName: string;
}

/**
 * 2026-05-20 spec ("To zrobmy tak zeby pokazywalo jak ktos wbije +5,
 * +7, +10 i potem co jeden kazdy w nieskonczonosc i skille i
 * przedmioty"): active-skill upgrades use the same milestone rules
 * as item upgrades and broadcast through the System tab with their
 * own payload variant so the renderer can pick the right icon
 * (spell PNG via getSkillIcon) and label.
 */
export interface ISystemSkillUpgradePayload {
    type: 'skillUpgrade';
    skillId: string;
    skillName: string;
    upgradeLevel: number;
}

export type TSystemMessagePayload = ISystemUpgradePayload | ISystemSkillUpgradePayload;

/**
 * Returns true when an upgrade level deserves a System-tab broadcast.
 *
 * 2026-05-20 spec ("pokazywalo jak ktos wbije +5, +7, +10 i potem co
 * jeden kazdy w nieskonczonosc"):
 *   - +5 and +7 are the early-tier hype milestones
 *   - +10 is the first "real" milestone
 *   - every level from +10 onward is also a milestone (+11, +12, …)
 *
 * Applies to both item and active-skill upgrades — same rule, both
 * paths share this helper so they never drift.
 */
export const isUpgradeMilestone = (level: number): boolean => {
    return level === 5 || level === 7 || level >= 10;
};

/**
 * Encode a system payload into a chat-message content string.
 * Callers pass the resulting string straight into `chatApi.postSystemEvent`.
 */
export const formatSystemMessage = (payload: TSystemMessagePayload): string => {
    return `${SYS_MARKER}${JSON.stringify(payload)}`;
};

/**
 * Try to parse a chat content string as a system payload. Returns
 * `null` for anything that doesn't start with the marker or whose
 * JSON body is malformed — caller falls back to plain text rendering.
 */
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
