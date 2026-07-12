
ALTER TABLE characters
    ADD COLUMN IF NOT EXISTS arena_kills           INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS arena_deaths          INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS arena_league          TEXT    NOT NULL DEFAULT 'bronze',
    ADD COLUMN IF NOT EXISTS arena_league_points   INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS mastery_points        INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS quests_oneshot_done   INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS quests_daily_done     INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS market_items_sold     INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS market_items_bought   INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS item_upgrades_done    INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS skill_upgrades_done   INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS best_dps5_solo        INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS best_dps5_party       INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS market_gold_earned    BIGINT  NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS market_gold_spent     BIGINT  NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS best_dps5_party_composition TEXT NULL;

CREATE INDEX IF NOT EXISTS idx_characters_arena_league_lp
    ON characters (arena_league, arena_league_points DESC);

CREATE INDEX IF NOT EXISTS idx_characters_arena_kills
    ON characters (arena_kills DESC);

CREATE INDEX IF NOT EXISTS idx_characters_arena_deaths
    ON characters (arena_deaths DESC);

CREATE OR REPLACE VIEW character_death_totals AS
SELECT
    character_id,
    character_name,
    character_class,
    MAX(character_level) AS character_level,
    COUNT(*)             AS deaths_count
FROM character_deaths
GROUP BY character_id, character_name, character_class;



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

GRANT EXECUTE ON FUNCTION bump_arena_death(UUID)    TO authenticated;
GRANT EXECUTE ON FUNCTION bump_arena_kill(UUID)     TO authenticated;
GRANT EXECUTE ON FUNCTION bump_market_sale(UUID, INTEGER, BIGINT) TO authenticated;

SELECT 'characters columns OK' AS status, COUNT(*) AS char_rows FROM characters;
SELECT 'death totals OK'       AS status, COUNT(*) AS rows FROM character_death_totals;
