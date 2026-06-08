/**
 * Guild-specific cleanup helpers.
 *
 * Why a dedicated helper:
 *   `cleanupCharacterById` already covers child tables that key off
 *   `character_id` (`guild_members`, `guild_join_requests`,
 *   `guild_boss_attempts`, `guild_boss_contributions`,
 *   `guild_treasury_logs`). It DOES NOT touch the `guilds` row itself
 *   because `guilds.leader_id` has no FK constraint to `characters` —
 *   deleting the leader's character leaves the guild row orphaned in
 *   the public feed (where `GuildList` lists it).
 *
 *   Guild tests need an extra explicit cleanup of `guilds WHERE
 *   leader_id IN (...)`. The CASCADE on `guild_id` then auto-deletes
 *   every child table (boss state, treasury items, join requests, …),
 *   so the single delete actually nukes the whole guild ecosystem.
 *
 * Architectural decisions (2026-05-25):
 *
 * 1. **Direct delete by leader_id**, not by guild name. Tests don't have
 *    the guild row id (it's generated server-side on `createGuild`), and
 *    queries by name are racy when parallel tests pick similar suffixes.
 *    `leader_id` is unique-ish to our test character, set at seed-time.
 *
 * 2. **Best-effort chat cleanup** is OPT-IN via the `channelToClean`
 *    arg. The `messages` table doesn't cascade on guild delete (no FK)
 *    — production messages are kept "forever" per the README rule about
 *    `messages.user_id`. For E2E test channels (`guild_<uuid>`) we
 *    explicitly delete by `channel=eq.guild_<id>` to keep the chat
 *    table small.
 *
 * 3. **Idempotent + safe-to-call-when-no-guild**. Tests that bail out
 *    before guild creation still safely run cleanup — `.delete().eq()`
 *    on an empty result is a no-op.
 *
 * 4. **`charIds` array, not single id**. Multi-context tests have BOTH
 *    primary and secondary characters that could be founders (e.g. the
 *    accept-request test seeds primary as leader; the secondary might
 *    also create a guild in some scenarios). One call handles both.
 */

import { getAdminClient } from './adminClient';

/**
 * Delete every guild row whose `leader_id` matches any of the supplied
 * character ids, plus optionally wipe a chat channel. Cascades clean
 * the rest of the guild tree (members, treasury, boss state, etc.).
 *
 * Safe to call when no characters had founded a guild — the delete is
 * a no-op in that case.
 *
 * @param charIds Character UUIDs that may own a guild. `null` entries are skipped.
 * @param channelsToClean Optional list of chat channels to nuke from `messages`
 *   table (e.g. `['guild_<guildId>']`). When undefined, chat is left alone
 *   (matches the production behaviour for non-test channels).
 */
export const cleanupGuildsByLeaderIds = async (
    charIds: Array<string | null>,
    channelsToClean?: string[],
): Promise<void> => {
    const ids = charIds.filter((id): id is string => id !== null);
    if (ids.length === 0) return;

    const admin = getAdminClient();

    // Step 1: nuke guild rows by leader_id. CASCADE handles guild_members,
    // guild_join_requests, guild_boss_*, guild_treasury_*.
    try {
        const idList = ids.map((id) => `"${id}"`).join(',');
        await admin.from('guilds').delete().or(`leader_id.in.(${idList})`);
    } catch {
        // Non-fatal — leftover guild rows can be GC'd manually by the
        // owner via /scripts/guild_reset_test_data.sql.
    }

    // Step 2 (optional): clean chat messages for the guild channels.
    if (channelsToClean && channelsToClean.length > 0) {
        for (const channel of channelsToClean) {
            try {
                await admin.from('messages').delete().eq('channel', channel);
            } catch {
                // Non-fatal — orphan messages sit in the table but the
                // guild they reference is gone.
            }
        }
    }
};
