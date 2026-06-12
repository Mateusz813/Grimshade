-- ============================================================================
-- Deaths feed — schema bump for raid + flee semantics
-- ----------------------------------------------------------------------------
-- Adds:
--   - 'raid' to the `source` check constraint
--   - `result` column ('killed' | 'fled') so the feed renders the right
--     verb ("zabił" vs "przegnał") regardless of whether the player actually
--     died or just fled the encounter (with or without protection elixir).
--
-- Spec 2026-05-19 v25: "Dodać jeszcze raidy. Oraz zapisywać jeżeli ktoś nie
-- umarł ale uciekł np z transformu i stracił XP jeśli nie mial eliksiru
-- ochronnego, a nawet jeśli mial to tez ma być to tutaj pisane tylko z
-- dopiskiem nie ze potwór zabił nick postaci. Tylko potwór przegnał i nick
-- postaci."
--
-- Idempotent — safe to re-run.
-- ============================================================================

-- 1. Expand the `source` check constraint to include 'raid'.
ALTER TABLE character_deaths
    DROP CONSTRAINT IF EXISTS character_deaths_source_check;

ALTER TABLE character_deaths
    ADD CONSTRAINT character_deaths_source_check
    CHECK (source IN ('monster', 'dungeon', 'boss', 'transform', 'raid'));

-- 2. Add the `result` column. Default 'killed' so every legacy row reads
--    as a real death. New code passes 'fled' for soft / URL-leave flees.
ALTER TABLE character_deaths
    ADD COLUMN IF NOT EXISTS result TEXT NOT NULL DEFAULT 'killed';

ALTER TABLE character_deaths
    DROP CONSTRAINT IF EXISTS character_deaths_result_check;

ALTER TABLE character_deaths
    ADD CONSTRAINT character_deaths_result_check
    CHECK (result IN ('killed', 'fled'));

-- 3. Refresh the death-totals view so it surfaces the new column when the
--    leaderboard queries it (count is still total — killed + fled — but
--    callers can JOIN back to the table for a verb-aware breakdown).
CREATE OR REPLACE VIEW character_death_totals AS
SELECT
    character_id,
    character_name,
    character_class,
    MAX(character_level) AS character_level,
    COUNT(*)             AS deaths_count
FROM character_deaths
GROUP BY character_id, character_name, character_class;

-- -- Sanity -----------------------------------------------------------------
SELECT 'character_deaths rows' AS status, COUNT(*) FROM character_deaths;
SELECT 'killed rows' AS status, COUNT(*) FROM character_deaths WHERE result = 'killed';
SELECT 'fled rows'   AS status, COUNT(*) FROM character_deaths WHERE result = 'fled';
