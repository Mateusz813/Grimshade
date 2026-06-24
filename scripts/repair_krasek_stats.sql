-- ==============================================================================
-- REPAIR corrupted base stats — character "Krasek" (lvl 109, max_hp=1, max_mp=0)
-- ==============================================================================
-- The buggy transform-unbake migration collapsed base max_hp/max_mp (and reduced
-- attack/defense). This SQL recomputes the CORRECT base stats deterministically
-- from the row's own class + highest_level, matching exactly how the game gains
-- stats (levelSystem.ts + characterStore.ts).
--
-- IMPORTANT — this character allocated ALL stat points into ATTACK. The attack
-- formula below adds every spent point to attack. If a DIFFERENT character spread
-- points across stats, this exact SQL would mis-assign them (it assumes all-attack).
--
-- Game stat formulas (verified in code):
--   base*          = classes.json baseStats
--   per-level HP/MP = BASE_HP_PER_LEVEL / BASE_MP_PER_LEVEL (levelSystem.ts)
--   per-level ATK/DEF = NONE (attack/defense only grow via milestones + points)
--   milestones      = floor(highest_level / 10); per-milestone ATK/DEF = +1
--   stat points     = 2 per level => total 2*(highest_level-1); per point: HP+5, MP+5, ATK+1, DEF+1
--
-- Idempotent: recomputes from scratch, safe to re-run. Single row by name.
-- ==============================================================================

-- BEFORE (inspect current corrupted values):
SELECT id, name, class, level, highest_level, stat_points, max_hp, max_mp, attack, defense, hp, mp
FROM characters WHERE name = 'Krasek';

WITH c AS (
  SELECT
    id, class,
    GREATEST(highest_level, level) AS hl,
    GREATEST(0, 2 * (GREATEST(highest_level, level) - 1) - COALESCE(stat_points, 0)) AS spent_points,
    floor(GREATEST(highest_level, level) / 10) AS milestones,
    (CASE class WHEN 'Knight' THEN 200 WHEN 'Mage' THEN 100 WHEN 'Cleric' THEN 130
       WHEN 'Archer' THEN 120 WHEN 'Rogue' THEN 110 WHEN 'Necromancer' THEN 90 WHEN 'Bard' THEN 115 ELSE 100 END) AS base_hp,
    (CASE class WHEN 'Knight' THEN 50 WHEN 'Mage' THEN 200 WHEN 'Cleric' THEN 160
       WHEN 'Archer' THEN 80 WHEN 'Rogue' THEN 90 WHEN 'Necromancer' THEN 220 WHEN 'Bard' THEN 130 ELSE 100 END) AS base_mp,
    (CASE class WHEN 'Knight' THEN 25 WHEN 'Mage' THEN 40 WHEN 'Cleric' THEN 20
       WHEN 'Archer' THEN 35 WHEN 'Rogue' THEN 22 WHEN 'Necromancer' THEN 35 WHEN 'Bard' THEN 22 ELSE 20 END) AS base_atk,
    (CASE class WHEN 'Knight' THEN 20 WHEN 'Mage' THEN 8 WHEN 'Cleric' THEN 12
       WHEN 'Archer' THEN 10 WHEN 'Rogue' THEN 9 WHEN 'Necromancer' THEN 7 WHEN 'Bard' THEN 11 ELSE 10 END) AS base_def,
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
  attack  = (c.base_atk + c.milestones * 1 + c.spent_points * 1)::int,   -- ALL points in attack
  defense = (c.base_def + c.milestones * 1)::int,                         -- 0 points in defense
  hp      = (c.base_hp + c.per_hp * (c.hl - 1) + c.milestones * c.ms_hp)::int,  -- refill
  mp      = (c.base_mp + c.per_mp * (c.hl - 1) + c.milestones * c.ms_mp)::int,  -- refill
  updated_at = now()
FROM c
WHERE ch.id = c.id;

-- AFTER (verify the repaired values):
SELECT id, name, class, level, highest_level, stat_points, max_hp, max_mp, attack, defense, hp, mp
FROM characters WHERE name = 'Krasek';
