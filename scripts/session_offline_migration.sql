-- ============================================================================
-- Session / multi-device / offline-sync hardening (BUG #10, 2026-06-23)
-- ----------------------------------------------------------------------------
-- Player spec (czat 2026-06-23):
--   * Zamknięcie aplikacji/komputera → zapisz CAŁY progres przed wylogowaniem.
--   * Login z innego urządzenia → wyloguj poprzednie (single active device).
--   * Double-apply nagród bo login na PC+telefonie naraz → wyeliminować.
--   * Gra offline: lock/unlock telefonu NIE wylogowuje + wczytuje offline progres.
--   * Offline progres dodawany TYLKO jeśli następnym razem NIE zaloguje się online
--     na innym urządzeniu/koncie (last-write-wins z gwarancją: kto był offline
--     pierwszy + nie został nadpisany). Backend zapisuje moment wejścia w offline.
--
-- Ten plik dodaje SCHEMAT pod te mechaniki. Klient (App.tsx / characterScope /
-- connectivityTransitions / AvatarMenu) używa kolumn/tabel feature-detect:
-- dopóki migracja NIE jest zastosowana, kod degraduje się do obecnego
-- zachowania (force-save-before-logout już działa bez tej migracji).
--
-- IDEMPOTENT: bezpieczny do wielokrotnego uruchomienia (IF NOT EXISTS).
-- APPLY: Supabase Dashboard → SQL Editor → wklej → Run.
-- ROLLBACK (na dole pliku, zakomentowany).
-- ============================================================================

-- ── 1. game_saves: kolumny do offline last-write-wins + cross-user guard ────
-- offline_entered_at: ustawiane gdy klient wchodzi w tryb offline (entry_source
--   = 'offline'); pozwala backendowi/klientowi odrzucić nadpisanie świeższego
--   stanu przez starszą sesję offline z innego urządzenia.
-- entry_source: kontekst ostatniego zapisu ('online'|'offline'|'local'|'transition').
-- last_online_user_id: kto ostatnio dotknął wiersza — wykrywa cross-user rewrite.
ALTER TABLE game_saves
  ADD COLUMN IF NOT EXISTS offline_entered_at  TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS entry_source        TEXT        DEFAULT 'online',
  ADD COLUMN IF NOT EXISTS last_online_user_id UUID        DEFAULT NULL;

-- Constrain entry_source values (idempotent: drop+recreate the check).
ALTER TABLE game_saves DROP CONSTRAINT IF EXISTS game_saves_entry_source_chk;
ALTER TABLE game_saves
  ADD CONSTRAINT game_saves_entry_source_chk
  CHECK (entry_source IN ('online','offline','local','transition'));

UPDATE game_saves SET entry_source = 'online' WHERE entry_source IS NULL;

CREATE INDEX IF NOT EXISTS idx_game_saves_offline_entered
  ON game_saves (character_id, offline_entered_at)
  WHERE offline_entered_at IS NOT NULL;

-- ── 2. session_locks: single-active-device enforcement ──────────────────────
-- Login na urządzeniu B unieważnia urządzenie A. Klient A na boot/realtime
-- widzi invalidated_at != NULL dla swojego device_id → force-logout (po zapisie).
CREATE TABLE IF NOT EXISTS session_locks (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  device_id        TEXT NOT NULL,                 -- klient: stabilny per-urządzenie id
  character_id     UUID REFERENCES characters(id) ON DELETE SET NULL,
  locked_at        TIMESTAMPTZ DEFAULT now(),
  last_activity_at TIMESTAMPTZ DEFAULT now(),
  invalidated_at   TIMESTAMPTZ DEFAULT NULL,      -- ustawione gdy login z innego device
  UNIQUE (user_id, device_id)
);

CREATE INDEX IF NOT EXISTS idx_session_locks_user_invalidated
  ON session_locks (user_id, invalidated_at);

ALTER TABLE session_locks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own session locks" ON session_locks;
CREATE POLICY "own session locks" ON session_locks
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ── 3. offline_sessions: audit trail offline play (anti-duplication) ────────
-- Append-only log wejść w offline. Pozwala wykryć/odrzucić nadpisanie progresu
-- offline gdy ktoś zalogował się w międzyczasie z innego urządzenia/konta.
CREATE TABLE IF NOT EXISTS offline_sessions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  character_id       UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  session_started_at TIMESTAMPTZ NOT NULL,        -- snapshot.capturedAt (klient)
  session_ended_at   TIMESTAMPTZ DEFAULT NULL,    -- transitionToOnline
  progress_snapshot  JSONB NOT NULL,              -- { level, xp, gold, itemCount, ts }
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

-- ============================================================================
-- ROLLBACK (odkomentuj aby cofnąć):
-- DROP TABLE IF EXISTS offline_sessions;
-- DROP TABLE IF EXISTS session_locks;
-- ALTER TABLE game_saves DROP CONSTRAINT IF EXISTS game_saves_entry_source_chk;
-- ALTER TABLE game_saves
--   DROP COLUMN IF EXISTS offline_entered_at,
--   DROP COLUMN IF EXISTS entry_source,
--   DROP COLUMN IF EXISTS last_online_user_id;
-- ============================================================================
