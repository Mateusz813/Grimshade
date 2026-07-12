
ALTER TABLE game_saves
  ADD COLUMN IF NOT EXISTS offline_entered_at  TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS entry_source        TEXT        DEFAULT 'online',
  ADD COLUMN IF NOT EXISTS last_online_user_id UUID        DEFAULT NULL;

ALTER TABLE game_saves DROP CONSTRAINT IF EXISTS game_saves_entry_source_chk;
ALTER TABLE game_saves
  ADD CONSTRAINT game_saves_entry_source_chk
  CHECK (entry_source IN ('online','offline','local','transition'));

UPDATE game_saves SET entry_source = 'online' WHERE entry_source IS NULL;

CREATE INDEX IF NOT EXISTS idx_game_saves_offline_entered
  ON game_saves (character_id, offline_entered_at)
  WHERE offline_entered_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS session_locks (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  device_id        TEXT NOT NULL,
  character_id     UUID REFERENCES characters(id) ON DELETE SET NULL,
  locked_at        TIMESTAMPTZ DEFAULT now(),
  last_activity_at TIMESTAMPTZ DEFAULT now(),
  invalidated_at   TIMESTAMPTZ DEFAULT NULL,
  UNIQUE (user_id, device_id)
);

CREATE INDEX IF NOT EXISTS idx_session_locks_user_invalidated
  ON session_locks (user_id, invalidated_at);

ALTER TABLE session_locks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own session locks" ON session_locks;
CREATE POLICY "own session locks" ON session_locks
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS offline_sessions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  character_id       UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  session_started_at TIMESTAMPTZ NOT NULL,
  session_ended_at   TIMESTAMPTZ DEFAULT NULL,
  progress_snapshot  JSONB NOT NULL,
  progress_final     JSONB DEFAULT NULL,
  device_fingerprint TEXT,
  created_at         TIMESTAMPTZ DEFAULT now(),
  UNIQUE (user_id, character_id, session_started_at)
);

CREATE INDEX IF NOT EXISTS idx_offline_sessions_user_char
  ON offline_sessions (user_id, character_id, session_started_at DESC);

ALTER TABLE offline_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own offline sessions" ON offline_sessions;
CREATE POLICY "own offline sessions" ON offline_sessions
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

