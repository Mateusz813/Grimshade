-- ============================================================================
-- Grimshade Mobile — Guild system migration
-- ----------------------------------------------------------------------------
-- Run this ONCE in the Supabase SQL Editor (Dashboard → SQL Editor → New
-- query) so the guild list, create flow, members, weekly boss, treasury and
-- join-request popups have all the tables + RLS + Realtime publications
-- they need.
--
-- It is idempotent — safe to re-run.
-- ============================================================================

-- 1. Guilds — one row per guild. `leader_id` is the character UUID.
-- `tag` is the 3-letter banner prefix rendered everywhere as [XXX].
-- `logo` is the icon id (string from data/guildIcons.ts), `color` is a
-- hex (#RRGGBB) the client uses for the guild banner / list-row tint.
-- `level`/`xp` drive the member cap (20 + level) and unlock progression;
-- `boss_tier` is the difficulty rung of the current weekly boss.
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

-- 2. Guild members — each character can belong to at most one guild
-- (enforced via the UNIQUE constraint on `character_id`).
-- `character_transform_tier` mirrors the highest completed transform
-- on the member's character so every client can render the matching
-- avatar art in the guild roster without a separate per-member fetch.
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

-- 2b. Backwards-compat: older migrations created `guild_members`
-- without the transform-tier column. Add it idempotently so existing
-- deployments self-heal on re-run.
ALTER TABLE guild_members
    ADD COLUMN IF NOT EXISTS character_transform_tier INTEGER NOT NULL DEFAULT 0;

-- 3. Boss state — one row per (guild, week). `week_start` is the Monday
-- 00:00 UTC of the active boss week. `boss_current_hp` is decremented
-- as members deal damage; when it hits 0 the boss is killed and the
-- claim flow opens on Sunday. `current_attacker_id` locks the arena
-- to a single fighter at a time (released when their HP block ends,
-- the boss dies, or they flee). `boss_max_hp` is captured at week
-- start so the percentage gate (next attacker waits until 90 % HP)
-- can be evaluated without re-deriving the tier scaling.
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

-- 4. Per-character daily attempt log so each member only gets ONE
-- attack per boss-day. Cleared (via the client's start-of-week boss
-- reset) when a new week begins. `character_name` is denormalised so
-- the attack-log popup can render "Krasek -123 456 HP" without a
-- join against guild_members at read time.
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

-- 4b. Backwards-compat for installs that ran the migration before the
-- name column was added.
ALTER TABLE guild_boss_attempts
    ADD COLUMN IF NOT EXISTS character_name TEXT NOT NULL DEFAULT '';

-- 5. Per-character contribution log for the active week. Drives the
-- drop-chance scaling (higher total damage = better roll) and powers
-- the Sunday claim popup so each member can see what they contributed.
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

-- 6. Treasury — flat item bag, 1000 slot cap enforced client-side.
-- `item_data` is the serialized IInventoryItem (JSON text) — same shape
-- characters use for their inventories. `deposited_by` / `deposited_at`
-- power the log popup.
CREATE TABLE IF NOT EXISTS guild_treasury_items (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    guild_id        UUID NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    item_data       TEXT NOT NULL,
    deposited_by    UUID NOT NULL,
    deposited_by_name TEXT NOT NULL,
    deposited_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 7. Treasury action log — append-only audit of deposits + withdrawals
-- so the "who took what" popup can render the full history. Items kept
-- as plain text (JSON.stringify of the item snapshot) to avoid coupling
-- a typed JSONB column to the client's IInventoryItem schema.
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

-- 8. Join requests — players who applied to a guild but haven't been
-- accepted yet. Leader-only writes to update status. Once a request is
-- accepted (or the player joins another guild) every OTHER pending
-- request from the same character is purged client-side.
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

-- 9. Realtime publication — every guild table is added to
-- `supabase_realtime` so member lists, boss HP and request popups
-- update instantly across all clients.
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
            -- already in publication, ignore
        END;
    END LOOP;
END $$;

-- 10. REPLICA IDENTITY FULL so DELETE events ship the old row payload
-- to Realtime subscribers (otherwise a kicked member or claimed reward
-- vanishes from one screen without notifying the others).
ALTER TABLE guilds                    REPLICA IDENTITY FULL;
ALTER TABLE guild_members             REPLICA IDENTITY FULL;
ALTER TABLE guild_boss_state          REPLICA IDENTITY FULL;
ALTER TABLE guild_boss_attempts       REPLICA IDENTITY FULL;
ALTER TABLE guild_boss_contributions  REPLICA IDENTITY FULL;
ALTER TABLE guild_treasury_items      REPLICA IDENTITY FULL;
ALTER TABLE guild_treasury_logs       REPLICA IDENTITY FULL;
ALTER TABLE guild_join_requests       REPLICA IDENTITY FULL;

-- 11. Permissive RLS — same approach as the party migration. Free
-- browser RPG, no sensitive data; lock down later if abuse appears.
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
