-- ============================================================================
-- Characters table — public SELECT RLS policy (cross-user nick lookup)
-- ----------------------------------------------------------------------------
-- Spec (BACKLOG 4.10 + testyE2E.docx "Dodaj znajomego"): the friend-add
-- flow (`/friends` -> type nick -> ":magnifying-glass-tilted-left: Szukaj" -> ":plus: Dodaj") fails today
-- when the typed nick belongs to a DIFFERENT user. Root cause: the
-- `characters` table has an RLS policy restricting SELECT to rows where
-- `user_id = auth.uid()`. So `friendsApi.findByName` (and `findManyByName`)
-- can never see another user's characters — returns empty result.
--
-- This file ADDS a public read policy `'anyone reads characters'` that
-- mirrors how `parties` and `messages` are set up (both allow any
-- authenticated user to SELECT any row). Without this, the canonical
-- friend-add UX is broken in production cross-user.
--
-- :warning: DECISION REQUIRED FROM OWNER BEFORE APPLYING :warning:
--
-- Privacy implications:
--   - Currently: each player's character list is private — no one can
--     see who else exists on the same Supabase project unless they
--     happen to encounter them in chat / party / guild flows.
--   - After this migration: ANY authenticated user can SELECT * FROM
--     characters and enumerate every character on the server — names,
--     levels, classes, equipment slots, gold balance, every counter.
--   - This is FINE if the game design assumes public leaderboards (which
--     Grimshade does — `/leaderboard` already exposes top-N per category,
--     same data) but worth confirming the owner is OK with TOTAL public
--     visibility of every character, not just the leaderboard top-N.
--
-- Mitigation options if owner objects to full public:
--   a) Tighter: SELECT only `id, name, class, level` columns (project
--      via SECURITY DEFINER function returning a restricted shape). Hides
--      gold / equipment from cross-user reads. Requires changing
--      `friendsApi.findByName` to call the RPC instead of plain REST
--      GET on /rest/v1/characters.
--   b) Limited: SELECT only when caller is in a party with the target,
--      OR a guild member, OR an existing friend. Forces the social
--      relationship to predate the lookup. Doesn't fix the friend-ADD
--      flow because friend-add is the FIRST contact by definition.
--   c) Restricted to a per-user "friend code": each character gets a
--      6-char alphanumeric code, friend-add requires typing the code
--      not the nick. Stronger privacy but breaks "type a nick you saw
--      in city chat" UX.
--
-- Default proposal (least surprise, matches sibling tables): apply the
-- broad public-read policy below. Tighten later if privacy concerns
-- arise.
--
-- -- Rollback path ------------------------------------------------------------
--   DROP POLICY IF EXISTS "anyone reads characters" ON characters;
--
-- Idempotent: `CREATE POLICY IF NOT EXISTS` (Postgres 15+) — re-runs are
-- safe no-ops.
--
-- -- Verification after applying ----------------------------------------------
-- 1. Log in as `test@grimshade.pl`, run
--    `await admin.from('characters').select('*').limit(5)` and confirm
--    rows from `test2@grimshade.pl` appear.
-- 2. Run `tests/e2e/social/friends/add-friend-via-ui.spec.ts` (will be
--    enabled by a sibling commit once this migration is applied) — it
--    drives the canonical UI add-flow rather than seeding the friends
--    slice directly.
-- ============================================================================

-- Public SELECT — every authenticated user can read every characters row.
-- `IF NOT EXISTS` requires Postgres 15+; Supabase projects all ship with
-- modern PG so this is safe.
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

-- -- Sanity -----------------------------------------------------------------
-- Should be exactly 1 row after applying.
SELECT 'policy installed (should be 1)' AS check, COUNT(*)
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'characters'
  AND policyname = 'anyone reads characters';
