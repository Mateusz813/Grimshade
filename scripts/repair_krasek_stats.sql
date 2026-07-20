
SELECT id, name, class, level, highest_level, stat_points, max_hp, max_mp, attack, defense, hp, mp
FROM characters WHERE name = 'Krasek';

WITH c AS (
  SELECT
    id, class,
    GREATEST(highest_level, level) AS hl,
    GREATEST(0, 2 * (GREATEST(highest_level, level) - 1) - COALESCE(stat_points, 0)) AS spent_points,
    floor(GREATEST(highest_level, level) / 10) AS milestones,
    (CASE class WHEN 'Knight' THEN 150 WHEN 'Mage' THEN 90 WHEN 'Cleric' THEN 115
       WHEN 'Archer' THEN 110 WHEN 'Rogue' THEN 100 WHEN 'Necromancer' THEN 88 WHEN 'Bard' THEN 105 ELSE 100 END) AS base_hp,
    (CASE class WHEN 'Knight' THEN 40 WHEN 'Mage' THEN 200 WHEN 'Cleric' THEN 155
       WHEN 'Archer' THEN 80 WHEN 'Rogue' THEN 75 WHEN 'Necromancer' THEN 200 WHEN 'Bard' THEN 125 ELSE 100 END) AS base_mp,
    (CASE class WHEN 'Knight' THEN 12 WHEN 'Mage' THEN 9 WHEN 'Cleric' THEN 8
       WHEN 'Archer' THEN 11 WHEN 'Rogue' THEN 10 WHEN 'Necromancer' THEN 9 WHEN 'Bard' THEN 9 ELSE 12 END) AS base_atk,
    (CASE class WHEN 'Knight' THEN 8 WHEN 'Mage' THEN 3 WHEN 'Cleric' THEN 6
       WHEN 'Archer' THEN 4 WHEN 'Rogue' THEN 4 WHEN 'Necromancer' THEN 3 WHEN 'Bard' THEN 4 ELSE 8 END) AS base_def,
    (CASE class WHEN 'Knight' THEN 8 WHEN 'Mage' THEN 3 WHEN 'Cleric' THEN 5
       WHEN 'Archer' THEN 4 WHEN 'Rogue' THEN 4 WHEN 'Necromancer' THEN 3 WHEN 'Bard' THEN 4 ELSE 5 END) AS per_hp,
    (CASE class WHEN 'Knight' THEN 2 WHEN 'Mage' THEN 8 WHEN 'Cleric' THEN 6
       WHEN 'Archer' THEN 3 WHEN 'Rogue' THEN 3 WHEN 'Necromancer' THEN 9 WHEN 'Bard' THEN 5 ELSE 5 END) AS per_mp,
    (CASE class WHEN 'Knight' THEN 30 WHEN 'Mage' THEN 10 WHEN 'Cleric' THEN 15
       WHEN 'Archer' THEN 15 WHEN 'Rogue' THEN 15 WHEN 'Necromancer' THEN 12 WHEN 'Bard' THEN 15 ELSE 15 END) AS ms_hp,
    (CASE class WHEN 'Knight' THEN 5 WHEN 'Mage' THEN 25 WHEN 'Cleric' THEN 20
       WHEN 'Archer' THEN 10 WHEN 'Rogue' THEN 8 WHEN 'Necromancer' THEN 22 WHEN 'Bard' THEN 15 ELSE 15 END) AS ms_mp
  FROM characters WHERE name = 'Krasek'
)
UPDATE characters AS ch
SET
  max_hp  = (c.base_hp + c.per_hp * (c.hl - 1) + c.milestones * c.ms_hp)::int,
  max_mp  = (c.base_mp + c.per_mp * (c.hl - 1) + c.milestones * c.ms_mp)::int,
  attack  = (c.base_atk + c.milestones * 1 + c.spent_points * 1)::int,
  defense = (c.base_def + c.milestones * 1)::int,
  hp      = (c.base_hp + c.per_hp * (c.hl - 1) + c.milestones * c.ms_hp)::int,
  mp      = (c.base_mp + c.per_mp * (c.hl - 1) + c.milestones * c.ms_mp)::int,
  updated_at = now()
FROM c
WHERE ch.id = c.id;

SELECT id, name, class, level, highest_level, stat_points, max_hp, max_mp, attack, defense, hp, mp
FROM characters WHERE name = 'Krasek';
