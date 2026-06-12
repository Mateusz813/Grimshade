-- ============================================================================
-- Leaderboard rankings — schema for arena / deaths aggregations
-- ----------------------------------------------------------------------------
-- Adds the columns + views the new ranking tabs need:
--   - characters.arena_kills           — lifetime arena wins (attacker)
--   - characters.arena_deaths          — lifetime arena losses (attacker)
--   - characters.arena_league          — current league name
--   - characters.arena_league_points   — current LP within the league
--   - character_death_totals VIEW      — death count grouped by character
--
-- Safe to re-run. Apply in Supabase SQL editor.
-- ============================================================================

-- 1. Arena + activity-stat tracking columns on characters table.
--    Each ranking tab in /leaderboard reads one of these columns.
--    Counters are append-only (incremented by the relevant subsystem
--    on every successful action); arena_dps* hold the high-water mark.
ALTER TABLE characters
    -- Arena (v15)
    ADD COLUMN IF NOT EXISTS arena_kills           INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS arena_deaths          INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS arena_league          TEXT    NOT NULL DEFAULT 'bronze',
    ADD COLUMN IF NOT EXISTS arena_league_points   INTEGER NOT NULL DEFAULT 0,
    -- Activity counters (v16): each ranking tab maps 1:1 to a column.
    ADD COLUMN IF NOT EXISTS mastery_points        INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS quests_oneshot_done   INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS quests_daily_done     INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS market_items_sold     INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS market_items_bought   INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS item_upgrades_done    INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS skill_upgrades_done   INTEGER NOT NULL DEFAULT 0,
    -- 5-second DPS high-water marks (one for solo combat, one for party).
    ADD COLUMN IF NOT EXISTS best_dps5_solo        INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS best_dps5_party       INTEGER NOT NULL DEFAULT 0,
    -- Market money flows (v18) — lifetime gold earned from sales + gold
    -- spent on purchases. Shown alongside the sold / bought counts on
    -- the leaderboard rows.
    ADD COLUMN IF NOT EXISTS market_gold_earned    BIGINT  NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS market_gold_spent     BIGINT  NOT NULL DEFAULT 0,
    -- Party composition snapshot (v20) — JSON array of
    -- `{ name, class }` entries captured when the player hit their
    -- current best_dps5_party. Lets the leaderboard render the FULL
    -- 4-character party stack instead of just the credited player.
    ADD COLUMN IF NOT EXISTS best_dps5_party_composition TEXT NULL;

-- Sanity index — the arena_league ranking sorts by league + LP so a
-- composite index keeps "Top 100 arena" reasonably cheap.
CREATE INDEX IF NOT EXISTS idx_characters_arena_league_lp
    ON characters (arena_league, arena_league_points DESC);

CREATE INDEX IF NOT EXISTS idx_characters_arena_kills
    ON characters (arena_kills DESC);

CREATE INDEX IF NOT EXISTS idx_characters_arena_deaths
    ON characters (arena_deaths DESC);

-- 2. Aggregate view for the "Total Deaths" ranking. Counts every
--    `character_deaths` row per character, keeping the highest known
--    level so the leaderboard can render Lvl X next to the count.
CREATE OR REPLACE VIEW character_death_totals AS
SELECT
    character_id,
    character_name,
    character_class,
    MAX(character_level) AS character_level,
    COUNT(*)             AS deaths_count
FROM character_deaths
GROUP BY character_id, character_name, character_class;

-- View inherits RLS from its base table; the public deaths SELECT
-- policy already permits anyone to read aggregated death stats.

-- 3. Cross-player counter bumpers (v18). Characters' RLS allows each
--    user to update only their OWN row, but the leaderboard needs
--    the WINNER to increment the LOSER's arena_deaths, and the
--    BUYER to increment the SELLER's market_items_sold + gold
--    earned. These SECURITY DEFINER functions run with the table
--    owner's privileges so any authenticated user can call them,
--    BUT they only touch the specific activity-counter columns
--    (never name / level / equipment etc.). Safe by construction.

CREATE OR REPLACE FUNCTION bump_arena_death(target_character_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    UPDATE characters
    SET arena_deaths = arena_deaths + 1,
        updated_at = NOW()
    WHERE id = target_character_id;
END;
$$;

CREATE OR REPLACE FUNCTION bump_arena_kill(target_character_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    UPDATE characters
    SET arena_kills = arena_kills + 1,
        updated_at = NOW()
    WHERE id = target_character_id;
END;
$$;

CREATE OR REPLACE FUNCTION bump_market_sale(
    seller_character_id UUID,
    quantity INTEGER,
    gold_amount BIGINT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    UPDATE characters
    SET market_items_sold = market_items_sold + GREATEST(quantity, 0),
        market_gold_earned = market_gold_earned + GREATEST(gold_amount, 0),
        updated_at = NOW()
    WHERE id = seller_character_id;
END;
$$;

-- Grant EXECUTE on the bumpers to anyone authenticated (anon stays
-- locked out so a logged-out caller can't poison the counters).
GRANT EXECUTE ON FUNCTION bump_arena_death(UUID)    TO authenticated;
GRANT EXECUTE ON FUNCTION bump_arena_kill(UUID)     TO authenticated;
GRANT EXECUTE ON FUNCTION bump_market_sale(UUID, INTEGER, BIGINT) TO authenticated;

-- -- Sanity checks -----------------------------------------------------------
SELECT 'characters columns OK' AS status, COUNT(*) AS char_rows FROM characters;
SELECT 'death totals OK'       AS status, COUNT(*) AS rows FROM character_death_totals;
