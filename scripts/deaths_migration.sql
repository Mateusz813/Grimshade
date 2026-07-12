
ALTER TABLE character_deaths
    DROP CONSTRAINT IF EXISTS character_deaths_source_check;

ALTER TABLE character_deaths
    ADD CONSTRAINT character_deaths_source_check
    CHECK (source IN ('monster', 'dungeon', 'boss', 'transform', 'raid'));

ALTER TABLE character_deaths
    ADD COLUMN IF NOT EXISTS result TEXT NOT NULL DEFAULT 'killed';

ALTER TABLE character_deaths
    DROP CONSTRAINT IF EXISTS character_deaths_result_check;

ALTER TABLE character_deaths
    ADD CONSTRAINT character_deaths_result_check
    CHECK (result IN ('killed', 'fled'));

CREATE OR REPLACE VIEW character_death_totals AS
SELECT
    character_id,
    character_name,
    character_class,
    MAX(character_level) AS character_level,
    COUNT(*)             AS deaths_count
FROM character_deaths
GROUP BY character_id, character_name, character_class;

SELECT 'character_deaths rows' AS status, COUNT(*) FROM character_deaths;
SELECT 'killed rows' AS status, COUNT(*) FROM character_deaths WHERE result = 'killed';
SELECT 'fled rows'   AS status, COUNT(*) FROM character_deaths WHERE result = 'fled';
