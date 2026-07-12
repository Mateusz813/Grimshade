
CREATE UNIQUE INDEX IF NOT EXISTS characters_name_unique_ci
    ON characters (LOWER(name));

SELECT 'duplicates (should be 0)' AS check, COUNT(*)
FROM (
    SELECT LOWER(name) AS ln
    FROM characters
    GROUP BY LOWER(name)
    HAVING COUNT(*) > 1
) dup;

SELECT 'index exists (should be 1)' AS check, COUNT(*)
FROM pg_indexes
WHERE indexname = 'characters_name_unique_ci';
