
CREATE TABLE IF NOT EXISTS guilds (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL UNIQUE,
    tag         TEXT NOT NULL CHECK (char_length(tag) BETWEEN 2 AND 3),
    logo        TEXT NOT NULL,
    color       TEXT NOT NULL,
    leader_id   UUID NOT NULL,
    level       INTEGER NOT NULL DEFAULT 1,
    xp          INTEGER NOT NULL DEFAULT 0,
    boss_tier   INTEGER NOT NULL DEFAULT 1,
    member_cap  INTEGER NOT NULL DEFAULT 20,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS guild_members (
    id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    guild_id                  UUID NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    character_id              UUID NOT NULL UNIQUE,
    character_name            TEXT NOT NULL,
    character_class           TEXT NOT NULL,
    character_level           INTEGER NOT NULL DEFAULT 1,
    character_transform_tier  INTEGER NOT NULL DEFAULT 0,
    joined_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE guild_members
    ADD COLUMN IF NOT EXISTS character_transform_tier INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS guild_boss_state (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    guild_id            UUID NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    week_start          DATE NOT NULL,
    boss_tier           INTEGER NOT NULL DEFAULT 1,
    boss_max_hp         BIGINT NOT NULL,
    boss_current_hp     BIGINT NOT NULL,
    boss_killed         BOOLEAN NOT NULL DEFAULT FALSE,
    current_attacker_id UUID,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT guild_boss_state_week_unique UNIQUE (guild_id, week_start)
);

CREATE TABLE IF NOT EXISTS guild_boss_attempts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    guild_id        UUID NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    character_id    UUID NOT NULL,
    character_name  TEXT NOT NULL DEFAULT '',
    attempt_date    DATE NOT NULL,
    damage_dealt    BIGINT NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT guild_boss_attempt_unique UNIQUE (guild_id, character_id, attempt_date)
);

ALTER TABLE guild_boss_attempts
    ADD COLUMN IF NOT EXISTS character_name TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS guild_boss_contributions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    guild_id        UUID NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    character_id    UUID NOT NULL,
    week_start      DATE NOT NULL,
    total_damage    BIGINT NOT NULL DEFAULT 0,
    rewards_claimed BOOLEAN NOT NULL DEFAULT FALSE,
    rewards_json    TEXT,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT guild_boss_contrib_unique UNIQUE (guild_id, character_id, week_start)
);

CREATE TABLE IF NOT EXISTS guild_treasury_items (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    guild_id        UUID NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    item_data       TEXT NOT NULL,
    deposited_by    UUID NOT NULL,
    deposited_by_name TEXT NOT NULL,
    deposited_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS guild_treasury_logs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    guild_id        UUID NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    action          TEXT NOT NULL,
    character_id    UUID NOT NULL,
    character_name  TEXT NOT NULL,
    item_name       TEXT NOT NULL,
    item_data       TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS guild_join_requests (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    guild_id        UUID NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    character_id    UUID NOT NULL,
    character_name  TEXT NOT NULL,
    character_class TEXT NOT NULL,
    character_level INTEGER NOT NULL DEFAULT 1,
    requested_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT guild_request_unique UNIQUE (guild_id, character_id)
);

DO $$
DECLARE
    t_name TEXT;
BEGIN
    FOREACH t_name IN ARRAY ARRAY[
        'guilds',
        'guild_members',
        'guild_boss_state',
        'guild_boss_attempts',
        'guild_boss_contributions',
        'guild_treasury_items',
        'guild_treasury_logs',
        'guild_join_requests'
    ]
    LOOP
        BEGIN
            EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE %I', t_name);
        EXCEPTION WHEN duplicate_object THEN
        END;
    END LOOP;
END $$;

ALTER TABLE guilds                    REPLICA IDENTITY FULL;
ALTER TABLE guild_members             REPLICA IDENTITY FULL;
ALTER TABLE guild_boss_state          REPLICA IDENTITY FULL;
ALTER TABLE guild_boss_attempts       REPLICA IDENTITY FULL;
ALTER TABLE guild_boss_contributions  REPLICA IDENTITY FULL;
ALTER TABLE guild_treasury_items      REPLICA IDENTITY FULL;
ALTER TABLE guild_treasury_logs       REPLICA IDENTITY FULL;
ALTER TABLE guild_join_requests       REPLICA IDENTITY FULL;

ALTER TABLE guilds                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE guild_members             ENABLE ROW LEVEL SECURITY;
ALTER TABLE guild_boss_state          ENABLE ROW LEVEL SECURITY;
ALTER TABLE guild_boss_attempts       ENABLE ROW LEVEL SECURITY;
ALTER TABLE guild_boss_contributions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE guild_treasury_items      ENABLE ROW LEVEL SECURITY;
ALTER TABLE guild_treasury_logs       ENABLE ROW LEVEL SECURITY;
ALTER TABLE guild_join_requests       ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
    t_name TEXT;
BEGIN
    FOREACH t_name IN ARRAY ARRAY[
        'guilds',
        'guild_members',
        'guild_boss_state',
        'guild_boss_attempts',
        'guild_boss_contributions',
        'guild_treasury_items',
        'guild_treasury_logs',
        'guild_join_requests'
    ]
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS "anyone reads %I"  ON %I', t_name, t_name);
        EXECUTE format('DROP POLICY IF EXISTS "anyone writes %I" ON %I', t_name, t_name);
        EXECUTE format('CREATE POLICY "anyone reads %I"  ON %I FOR SELECT USING (TRUE)', t_name, t_name);
        EXECUTE format(
            'CREATE POLICY "anyone writes %I" ON %I FOR ALL USING (TRUE) WITH CHECK (TRUE)',
            t_name, t_name
        );
    END LOOP;
END $$;
