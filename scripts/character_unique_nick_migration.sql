-- ============================================================================
-- Characters — case-insensitive UNIQUE constraint on `name`
-- ----------------------------------------------------------------------------
-- Spec (BACKLOG 2.7 + testyE2E.docx "Stwórz postać o takim samym nicku"):
-- enforce that no two characters can share a nickname across the entire
-- `characters` table. Today the app NEITHER:
--   • does a server-side pre-check in `CharacterCreate.tsx` (only checks
--     the per-user 7-character cap — see CharacterCreate.tsx line 145-156),
--   • NOR has a DB constraint to reject the conflicting INSERT.
-- => two players can register `Smaug`, `Smaug` and both keep their chars.
--    This collides with leaderboard tabs (rows aren't keyed by name), with
--    party/guild/friend lookups (`findByName` returns whichever DB happens
--    to return first), and with deaths feed (multiple Smaugs in the same
--    "killed by" log are indistinguishable).
--
-- Decision: case-insensitive UNIQUE — `Smaug` and `smaug` are the same
-- identity. Implemented via UNIQUE INDEX on `LOWER(name)` because PostgreSQL
-- doesn't support `UNIQUE (LOWER(col))` directly as a table constraint —
-- functional unique indexes are the canonical pattern.
--
-- ── Rollback path ────────────────────────────────────────────────────────────
--   DROP INDEX IF EXISTS characters_name_unique_ci;
--
-- Idempotent — safe to re-run; CREATE INDEX IF NOT EXISTS short-circuits
-- when the index already exists.
--
-- ── Behavior after applying ──────────────────────────────────────────────────
-- INSERT INTO characters (..., name) VALUES (..., 'SomeNick')
--   • If no other row has LOWER(name) = 'somenick' → success.
--   • If duplicate → PostgreSQL raises `23505` (unique_violation). PostgREST
--     surfaces this as HTTP 409 Conflict. The client-side `characterApi.
--     createCharacter` will throw, and `CharacterCreate.tsx` line 195-197
--     catches the throw → `setError('root', { message: 'Błąd tworzenia
--     postaci. Spróbuj ponownie.' })`.
--
-- The catch block currently shows a GENERIC error message. Once this
-- migration is in production, a follow-up commit can refine the error path
-- to detect HTTP 409 specifically and render a precise message like
-- "Postać o takim nicku już istnieje" — but the constraint itself works
-- without that UX polish (the test in `tests/e2e/character/create/
-- rejects-duplicate-nickname.spec.ts` matches the generic error path).
--
-- ── Pre-flight: check existing duplicates ───────────────────────────────────
-- Run this before applying the constraint. If any rows come back, you need
-- to manually rename them (DM the players) BEFORE the migration can run,
-- otherwise the CREATE UNIQUE INDEX will fail with a violation error.
--
--   SELECT LOWER(name) AS lower_name, COUNT(*), array_agg(name)
--   FROM characters
--   GROUP BY LOWER(name)
--   HAVING COUNT(*) > 1;
--
-- As of 2026-05-25 the production DB had 0 duplicates (verified via
-- service_role), so the constraint applies cleanly.
-- ============================================================================

-- Unique index on lowercase name (case-insensitive uniqueness).
-- `IF NOT EXISTS` makes this idempotent — re-runs are no-ops.
CREATE UNIQUE INDEX IF NOT EXISTS characters_name_unique_ci
    ON characters (LOWER(name));

-- ── Sanity checks ───────────────────────────────────────────────────────────
-- Should each return 0 rows once applied. If any duplicates remain
-- post-migration something went wrong (constraint shouldn't have been
-- creatable, but defensive verification helps audit).
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
