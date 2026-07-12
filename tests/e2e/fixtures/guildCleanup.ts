
import { getAdminClient } from './adminClient';

export const cleanupGuildsByLeaderIds = async (
    charIds: Array<string | null>,
    channelsToClean?: string[],
): Promise<void> => {
    const ids = charIds.filter((id): id is string => id !== null);
    if (ids.length === 0) return;

    const admin = getAdminClient();

    try {
        const idList = ids.map((id) => `"${id}"`).join(',');
        await admin.from('guilds').delete().or(`leader_id.in.(${idList})`);
    } catch {
    }

    if (channelsToClean && channelsToClean.length > 0) {
        for (const channel of channelsToClean) {
            try {
                await admin.from('messages').delete().eq('channel', channel);
            } catch {
            }
        }
    }
};
