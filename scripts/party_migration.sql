
CREATE TABLE IF NOT EXISTS parties (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    leader_id   UUID NOT NULL,
    name        TEXT NOT NULL,
    max_members INTEGER NOT NULL DEFAULT 4,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS party_members (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    party_id        UUID NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
    character_id    UUID NOT NULL,
    character_name  TEXT,
    character_class TEXT,
    character_level INTEGER NOT NULL DEFAULT 1,
    joined_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE parties
    ADD COLUMN IF NOT EXISTS description    TEXT    DEFAULT '',
    ADD COLUMN IF NOT EXISTS password       TEXT,
    ADD COLUMN IF NOT EXISTS is_public      BOOLEAN DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS updated_at     TIMESTAMPTZ DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS min_join_level INTEGER DEFAULT 1;

ALTER TABLE party_members
    ADD COLUMN IF NOT EXISTS character_name  TEXT,
    ADD COLUMN IF NOT EXISTS character_class TEXT,
    ADD COLUMN IF NOT EXISTS character_level INTEGER DEFAULT 1,
    ADD COLUMN IF NOT EXISTS joined_at       TIMESTAMPTZ DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS role            TEXT;

DO $$
BEGIN
    BEGIN
        ALTER PUBLICATION supabase_realtime ADD TABLE parties;
    EXCEPTION WHEN duplicate_object THEN
    END;
    BEGIN
        ALTER PUBLICATION supabase_realtime ADD TABLE party_members;
    EXCEPTION WHEN duplicate_object THEN
    END;
END $$;

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

ALTER TABLE parties       REPLICA IDENTITY FULL;
ALTER TABLE party_members REPLICA IDENTITY FULL;

DO $$
BEGIN
    BEGIN
        ALTER TABLE party_members DROP CONSTRAINT party_members_character_id_key;
    EXCEPTION WHEN undefined_object THEN
    END;
END $$;

DO $$
BEGIN
    BEGIN
        ALTER TABLE party_members
            ADD CONSTRAINT party_members_party_char_unique UNIQUE (party_id, character_id);
    EXCEPTION WHEN duplicate_object THEN
    EXCEPTION WHEN duplicate_table THEN
    END;
END $$;
