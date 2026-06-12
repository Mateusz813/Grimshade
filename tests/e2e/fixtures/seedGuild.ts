/**
 * Direct-API guild seeder via service_role.
 *
 * Why this exists: multi-context guild tests for kick/chat/treasury all
 * need 2+ members of the SAME guild as starting state. Setting that up
 * through the UI would take ~30s of taps per test (create guild -> log
 * out / switch context -> apply -> switch back -> accept). Direct INSERTs
 * land in <500ms and the on-mount Realtime hydrate picks them up.
 *
 * Layout: one INSERT into `guilds` (autogen UUID id, leader = first
 * character in `memberCharacterIds`) + N INSERTs into `guild_members`
 * (one per character, all in the same guild). Mirrors what
 * `guildApi.createGuild` + `guildApi.acceptRequest` would write end-to-
 * end.
 *
 * Architectural notes (2026-05-25):
 *
 * 1. **Leader is `memberCharacterIds[0]`** — caller decides ordering.
 *    Other members are non-leader (no leader badge in UI).
 *
 * 2. **Character snapshot fields are filled from `characters` table**
 *    (name, class, level). The guild_members row mirrors these for
 *    fast roster rendering. Caller must seed characters BEFORE seeding
 *    the guild — we look them up by id.
 *
 * 3. **Cleanup**: returned `guildId` lets the test wipe the guild row
 *    in `finally` via `cleanupGuildsByLeaderIds` (CASCADE handles all
 *    child tables — members, requests, boss, treasury). Test does NOT
 *    need to delete `guild_members` separately.
 *
 * 4. **Idempotent on tag collision** — `tag` is randomised by the
 *    caller; if a collision still occurs (extremely unlikely w/ 3-char
 *    random alphanumeric), the INSERT throws and the test fails fast.
 */

import { getAdminClient, withSupabaseRetry } from './adminClient';

export interface ISeedGuildArgs {
    /** Display name (3-24 chars per UI rules). */
    name: string;
    /** Tag (2-3 chars, A-Z/0-9). */
    tag: string;
    /** Character UUIDs of all initial members. First entry = leader. */
    memberCharacterIds: string[];
    /** Guild icon id, defaults to `'shield'` (matches GUILD_ICONS[0].id). */
    logo?: string;
    /** Background hex color, defaults to `'#e94560'` (matches GUILD_COLORS[0]). */
    color?: string;
}

export interface ISeededGuild {
    id: string;
    name: string;
    tag: string;
    leaderId: string;
}

/**
 * Insert a `guilds` row + N `guild_members` rows in one go.
 *
 * @example
 * const guild = await seedGuild({
 *   name: 'Test Guild',
 *   tag: 'TST',
 *   memberCharacterIds: [primaryCharId, secondaryCharId],
 * });
 * // primaryCharId is the leader; both characters are members.
 * // Cleanup: cleanupGuildsByLeaderIds([guild.leaderId]) — CASCADE handles members.
 */
export const seedGuild = async (args: ISeedGuildArgs): Promise<ISeededGuild> => {
    if (args.memberCharacterIds.length === 0) {
        throw new Error('[seedGuild] memberCharacterIds must contain at least 1 id (the leader).');
    }
    const admin = getAdminClient();
    const leaderId = args.memberCharacterIds[0];

    // Step 1: insert the guild row.
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

    // Step 2: fetch character snapshot data for every member so we can
    // write the denormalised name/class/level to `guild_members`.
    const idList = args.memberCharacterIds.map((id) => `"${id}"`).join(',');
    const { data: chars, error: charsErr } = await withSupabaseRetry(
        () => admin
            .from('characters')
            .select('id, name, class, level')
            .or(`id.in.(${idList})`),
    );
    if (charsErr || !chars) {
        // Best-effort rollback so we don't leave a dangling guild.
        await withSupabaseRetry(() => admin.from('guilds').delete().eq('id', guildRow.id));
        throw new Error(`[seedGuild] characters lookup failed: ${charsErr?.message ?? (charsErr ? JSON.stringify(charsErr) : 'no rows')}`);
    }
    if (chars.length !== args.memberCharacterIds.length) {
        await withSupabaseRetry(() => admin.from('guilds').delete().eq('id', guildRow.id));
        const found = chars.map((c) => (c as { id: string }).id);
        const missing = args.memberCharacterIds.filter((id) => !found.includes(id));
        throw new Error(`[seedGuild] missing characters: ${missing.join(', ')}`);
    }

    // Step 3: insert member rows in the order requested (leader first).
    // Order matters: `guild_members.joined_at` defaults to NOW() and the
    // member list sorts by it ascending, so the leader displays first in
    // the roster row.
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
        // Rollback the guild so the test environment stays clean.
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
