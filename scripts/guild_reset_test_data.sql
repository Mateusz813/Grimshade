
DELETE FROM guild_boss_state;

DELETE FROM guild_boss_attempts;

DELETE FROM guild_boss_contributions;

UPDATE guilds SET
    level = 1,
    xp = 0,
    boss_tier = 1,
    member_cap = 20,
    updated_at = NOW();



SELECT
    (SELECT COUNT(*) FROM guild_boss_state)         AS boss_state_rows,
    (SELECT COUNT(*) FROM guild_boss_attempts)      AS attempt_rows,
    (SELECT COUNT(*) FROM guild_boss_contributions) AS contribution_rows,
    (SELECT COUNT(*) FROM guilds WHERE level <> 1 OR xp <> 0 OR boss_tier <> 1) AS guilds_still_dirty;
