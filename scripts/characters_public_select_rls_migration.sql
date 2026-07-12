
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'characters'
          AND policyname = 'anyone reads characters'
    ) THEN
        EXECUTE 'CREATE POLICY "anyone reads characters" ON characters
                  FOR SELECT
                  USING (TRUE)';
    END IF;
END
$$;

SELECT 'policy installed (should be 1)' AS check, COUNT(*)
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'characters'
  AND policyname = 'anyone reads characters';
