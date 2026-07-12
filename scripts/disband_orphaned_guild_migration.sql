
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

DELETE FROM guilds g
WHERE LOWER(TRIM(g.name)) = LOWER('Czarne Orły')
  AND NOT EXISTS (
      SELECT 1
      FROM guild_members gm
      JOIN characters c ON c.id = gm.character_id
      WHERE gm.guild_id = g.id
  );

