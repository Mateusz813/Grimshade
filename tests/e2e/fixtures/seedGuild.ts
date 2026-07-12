
import { getAdminClient, withSupabaseRetry } from './adminClient';

export interface ISeedGuildArgs {
    name: string;
    tag: string;
    memberCharacterIds: string[];
    logo?: string;
    color?: string;
}

export interface ISeededGuild {
    id: string;
    name: string;
    tag: string;
    leaderId: string;
}

export const seedGuild = async (args: ISeedGuildArgs): Promise<ISeededGuild> => {
    if (args.memberCharacterIds.length === 0) {
        throw new Error('[seedGuild] memberCharacterIds must contain at least 1 id (the leader).');
    }
    const admin = getAdminClient();
    const leaderId = args.memberCharacterIds[0];

    const { data: guildRow, error: guildErr } = await withSupabaseRetry(
        () => admin
            .from('guilds')
            .insert({
                name: args.name,
                tag: args.tag.toUpperCase().slice(0, 3),
                logo: args.logo ?? 'shield',
                color: args.color ?? '#e94560',
                leader_id: leaderId,
            })
            .select('id, name, tag, leader_id')
            .single(),
    );
    if (guildErr || !guildRow) {
        throw new Error(`[seedGuild] guilds INSERT failed: ${guildErr?.message ?? (guildErr ? JSON.stringify(guildErr) : 'no row returned')}`);
    }

    const idList = args.memberCharacterIds.map((id) => `"${id}"`).join(',');
    const { data: chars, error: charsErr } = await withSupabaseRetry(
        () => admin
            .from('characters')
            .select('id, name, class, level')
            .or(`id.in.(${idList})`),
    );
    if (charsErr || !chars) {
        await withSupabaseRetry(() => admin.from('guilds').delete().eq('id', guildRow.id));
        throw new Error(`[seedGuild] characters lookup failed: ${charsErr?.message ?? (charsErr ? JSON.stringify(charsErr) : 'no rows')}`);
    }
    if (chars.length !== args.memberCharacterIds.length) {
        await withSupabaseRetry(() => admin.from('guilds').delete().eq('id', guildRow.id));
        const found = chars.map((c) => (c as { id: string }).id);
        const missing = args.memberCharacterIds.filter((id) => !found.includes(id));
        throw new Error(`[seedGuild] missing characters: ${missing.join(', ')}`);
    }

    const memberRows = args.memberCharacterIds.map((charId) => {
        const c = chars.find((row) => (row as { id: string }).id === charId) as
            { id: string; name: string; class: string; level: number };
        return {
            guild_id: guildRow.id,
            character_id: c.id,
            character_name: c.name,
            character_class: c.class,
            character_level: c.level,
            character_transform_tier: 0,
        };
    });

    const { error: memErr } = await withSupabaseRetry(
        () => admin.from('guild_members').insert(memberRows),
    );
    if (memErr) {
        await withSupabaseRetry(() => admin.from('guilds').delete().eq('id', guildRow.id));
        throw new Error(`[seedGuild] guild_members INSERT failed: ${memErr.message ?? JSON.stringify(memErr)}`);
    }

    return {
        id: guildRow.id as string,
        name: guildRow.name as string,
        tag: guildRow.tag as string,
        leaderId: guildRow.leader_id as string,
    };
};
