-- ============================================================================
-- Grimshade Mobile — Guild test data reset
-- ----------------------------------------------------------------------------
-- Wipes every per-week boss + contribution + attempt + log row so the next
-- visit to the guild boss starts from a clean tier-1 fight. Also rewinds
-- every guild's level/xp/boss_tier to the starting values. Guild rows
-- themselves + member rosters + treasury items survive (only the BOSS / XP
-- progression resets).
--
-- USE IN SUPABASE SQL EDITOR — copy + paste + run. Safe to re-run.
-- ============================================================================

-- 1. Drop every weekly boss state row (forces a fresh boss on next mount).
DELETE FROM guild_boss_state;

-- 2. Drop every per-character attack attempt — daily limit resets.
DELETE FROM guild_boss_attempts;

-- 3. Drop every per-character contribution tally — fresh weekly counter.
DELETE FROM guild_boss_contributions;

-- 4. Rewind every guild back to level 1, 0 xp, boss tier 1, member cap 20.
UPDATE guilds SET
    level = 1,
    xp = 0,
    boss_tier = 1,
    member_cap = 20,
    updated_at = NOW();

-- 5. Optional: wipe the guild chat history too (uncomment to use).
-- DELETE FROM messages WHERE channel LIKE 'guild_%';

-- 6. Optional: wipe the treasury logs (uncomment to use).
-- DELETE FROM guild_treasury_logs;

-- -- Sanity check counts after wipe ----------------------------------------
SELECT
    (SELECT COUNT(*) FROM guild_boss_state)         AS boss_state_rows,
    (SELECT COUNT(*) FROM guild_boss_attempts)      AS attempt_rows,
    (SELECT COUNT(*) FROM guild_boss_contributions) AS contribution_rows,
    (SELECT COUNT(*) FROM guilds WHERE level <> 1 OR xp <> 0 OR boss_tier <> 1) AS guilds_still_dirty;
