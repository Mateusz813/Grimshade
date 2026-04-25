-- ============================================================================
-- Grimshade Mobile — Party multiplayer migration
-- ----------------------------------------------------------------------------
-- Run this ONCE in the Supabase SQL Editor (Dashboard → SQL Editor → New query)
-- so the party browser, create/join/password flow, and Realtime subscriptions
-- all have the columns + RLS policies they need.
--
-- It is idempotent — safe to re-run.
-- ============================================================================

-- 1. Extra columns on `parties` that the client expects.
ALTER TABLE parties
    ADD COLUMN IF NOT EXISTS description TEXT    DEFAULT '',
    ADD COLUMN IF NOT EXISTS password    TEXT,
    ADD COLUMN IF NOT EXISTS is_public   BOOLEAN DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS updated_at  TIMESTAMPTZ DEFAULT NOW();

-- 2. Realtime publication for live party browser / membership updates.
--    Wrapped in DO blocks because `ADD TABLE` errors if it's already in the
--    publication — idempotent this way.
DO $$
BEGIN
    BEGIN
        ALTER PUBLICATION supabase_realtime ADD TABLE parties;
    EXCEPTION WHEN duplicate_object THEN
        -- already in publication, ignore
    END;
    BEGIN
        ALTER PUBLICATION supabase_realtime ADD TABLE party_members;
    EXCEPTION WHEN duplicate_object THEN
        -- already in publication, ignore
    END;
END $$;

-- 3. Permissive RLS. This is a free browser RPG, no sensitive data — anyone
--    can read/write parties. Lock this down later if you add account-bound
--    moderation.
ALTER TABLE parties        ENABLE ROW LEVEL SECURITY;
ALTER TABLE party_members  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anyone reads parties"         ON parties;
DROP POLICY IF EXISTS "anyone inserts parties"       ON parties;
DROP POLICY IF EXISTS "anyone updates parties"       ON parties;
DROP POLICY IF EXISTS "anyone deletes parties"       ON parties;
DROP POLICY IF EXISTS "anyone reads party members"   ON party_members;
DROP POLICY IF EXISTS "anyone inserts party members" ON party_members;
DROP POLICY IF EXISTS "anyone updates party members" ON party_members;
DROP POLICY IF EXISTS "anyone deletes party members" ON party_members;

CREATE POLICY "anyone reads parties"         ON parties       FOR SELECT USING (TRUE);
CREATE POLICY "anyone inserts parties"       ON parties       FOR INSERT WITH CHECK (TRUE);
CREATE POLICY "anyone updates parties"       ON parties       FOR UPDATE USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "anyone deletes parties"       ON parties       FOR DELETE USING (TRUE);

CREATE POLICY "anyone reads party members"   ON party_members FOR SELECT USING (TRUE);
CREATE POLICY "anyone inserts party members" ON party_members FOR INSERT WITH CHECK (TRUE);
CREATE POLICY "anyone updates party members" ON party_members FOR UPDATE USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "anyone deletes party members" ON party_members FOR DELETE USING (TRUE);

-- 4. Realtime needs REPLICA IDENTITY FULL on both tables so DELETE events ship
--    the old row payload to subscribers (otherwise joined clients don't see
--    members disappearing in real time).
ALTER TABLE parties       REPLICA IDENTITY FULL;
ALTER TABLE party_members REPLICA IDENTITY FULL;

-- 5. `party_members` occasionally has a UNIQUE(character_id) constraint from
--    an earlier schema draft. That prevents a second character on the same
--    browser from joining an existing party. Drop it if present — uniqueness
--    is only meaningful per (party_id, character_id).
DO $$
BEGIN
    BEGIN
        ALTER TABLE party_members DROP CONSTRAINT party_members_character_id_key;
    EXCEPTION WHEN undefined_object THEN
        -- already removed or never existed, ignore
    END;
END $$;

-- 6. Ensure (party_id, character_id) uniqueness so a character can't double-join
--    the same party while still being free to exist in a different party row.
DO $$
BEGIN
    BEGIN
        ALTER TABLE party_members
            ADD CONSTRAINT party_members_party_char_unique UNIQUE (party_id, character_id);
    EXCEPTION WHEN duplicate_object THEN
        -- constraint already present, ignore
    EXCEPTION WHEN duplicate_table THEN
        -- some postgres versions report a different code, ignore
    END;
END $$;
