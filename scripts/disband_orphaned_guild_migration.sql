-- ============================================================================
-- Grimshade — Disband orphaned guild ("Czarne Orły")
-- ----------------------------------------------------------------------------
-- WHY: an earlier bug in `guildApi.listMembers` (a read-time "self-heal"
-- DELETE that, with a quoted-UUID existence check returning empty, treated
-- EVERY member as a ghost) wiped the `guild_members` rows of the production
-- guild "Czarne Orły". The code is now fixed — `listMembers` is read-only and
-- never deletes — but the guild row already lost its members and is stranded
-- (no live roster, leaderless in the UI). Owner chose: DISBAND it.
--
-- WHAT IT DOES: deletes the orphaned `guilds` row. Every child table
-- (guild_members, guild_boss_state, guild_boss_attempts,
-- guild_boss_contributions, guild_treasury_items, guild_treasury_logs,
-- guild_join_requests) is declared `ON DELETE CASCADE` against guilds(id)
-- in guild_migration.sql, so they are cleaned automatically — no manual
-- child deletes needed.
--
-- SAFETY: the DELETE is guarded by `NOT EXISTS (a LIVE member)` so even if the
-- guild's state differs from what we expect, a HEALTHY guild (one with at
-- least one member whose character still exists) is NEVER touched. A "live
-- member" = a guild_members row whose character_id still resolves to a row in
-- `characters`.
--
-- IDEMPOTENT: re-running after the guild is gone matches nothing -> no-op.
--
-- HOW TO RUN: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run.
-- Run the PREVIEW (step 1) first to confirm exactly what will be removed,
-- then run step 2.
--
-- ROLLBACK: a DELETE cannot be undone in place. If the guild must come back,
-- restore from a Supabase point-in-time backup (Dashboard -> Database ->
-- Backups), or re-create the guild fresh via the in-app "Stwórz gildię" flow.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- STEP 1 — PREVIEW (read-only). Run this alone first and eyeball the result.
-- Shows the target guild, its total member rows, and how many of those rows
-- point at a still-existing character. `live_members` should be 0 for the
-- orphaned guild — that is what makes the disband in step 2 safe.
-- ----------------------------------------------------------------------------
SELECT
    g.id,
    g.name,
    g.tag,
    g.leader_id,
    (SELECT COUNT(*) FROM guild_members gm WHERE gm.guild_id = g.id) AS total_member_rows,
    (
        SELECT COUNT(*)
        FROM guild_members gm
        JOIN characters c ON c.id = gm.character_id
        WHERE gm.guild_id = g.id
    ) AS live_members
FROM guilds g
WHERE LOWER(TRIM(g.name)) = LOWER('Czarne Orły');

-- ----------------------------------------------------------------------------
-- STEP 2 — DISBAND. Deletes the orphaned guild row (cascade cleans children).
-- The NOT EXISTS guard means: only delete "Czarne Orły" if it has NO live
-- member. If it unexpectedly still has a live member, this is a no-op and the
-- guild is left intact for manual review.
-- ----------------------------------------------------------------------------
DELETE FROM guilds g
WHERE LOWER(TRIM(g.name)) = LOWER('Czarne Orły')
  AND NOT EXISTS (
      SELECT 1
      FROM guild_members gm
      JOIN characters c ON c.id = gm.character_id
      WHERE gm.guild_id = g.id
  );

-- ----------------------------------------------------------------------------
-- STEP 3 (OPTIONAL) — general housekeeping: disband ANY guild that has no live
-- member at all (zero member rows, or only ghost rows for deleted characters).
-- Leave commented unless you also want to sweep every other stranded guild.
-- Run the matching preview first by swapping DELETE -> SELECT g.id, g.name.
-- ----------------------------------------------------------------------------
-- DELETE FROM guilds g
-- WHERE NOT EXISTS (
--     SELECT 1
--     FROM guild_members gm
--     JOIN characters c ON c.id = gm.character_id
--     WHERE gm.guild_id = g.id
-- );
