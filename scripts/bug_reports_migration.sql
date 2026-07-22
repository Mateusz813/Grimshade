
CREATE TABLE IF NOT EXISTS bug_reports (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  character_id   UUID REFERENCES characters(id) ON DELETE SET NULL,
  character_name TEXT,
  view_key       TEXT NOT NULL,
  content        TEXT NOT NULL,
  app_version    TEXT,
  user_agent     TEXT,
  status         TEXT NOT NULL DEFAULT 'new',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE bug_reports ADD COLUMN IF NOT EXISTS character_id   UUID REFERENCES characters(id) ON DELETE SET NULL;
ALTER TABLE bug_reports ADD COLUMN IF NOT EXISTS character_name TEXT;
ALTER TABLE bug_reports ADD COLUMN IF NOT EXISTS app_version    TEXT;
ALTER TABLE bug_reports ADD COLUMN IF NOT EXISTS user_agent     TEXT;
ALTER TABLE bug_reports ADD COLUMN IF NOT EXISTS status         TEXT NOT NULL DEFAULT 'new';

ALTER TABLE bug_reports DROP CONSTRAINT IF EXISTS bug_reports_status_chk;
ALTER TABLE bug_reports
  ADD CONSTRAINT bug_reports_status_chk
  CHECK (status IN ('new','in_progress','resolved','rejected'));

ALTER TABLE bug_reports DROP CONSTRAINT IF EXISTS bug_reports_content_chk;
ALTER TABLE bug_reports
  ADD CONSTRAINT bug_reports_content_chk
  CHECK (char_length(content) BETWEEN 1 AND 4000);

ALTER TABLE bug_reports DROP CONSTRAINT IF EXISTS bug_reports_view_key_chk;
ALTER TABLE bug_reports
  ADD CONSTRAINT bug_reports_view_key_chk
  CHECK (char_length(view_key) BETWEEN 1 AND 64);

CREATE INDEX IF NOT EXISTS idx_bug_reports_created
  ON bug_reports (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_bug_reports_user
  ON bug_reports (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_bug_reports_status
  ON bug_reports (status, created_at DESC);

ALTER TABLE bug_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own bug reports insert" ON bug_reports;
CREATE POLICY "own bug reports insert" ON bug_reports
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "own bug reports select" ON bug_reports;
CREATE POLICY "own bug reports select" ON bug_reports
  FOR SELECT USING (auth.uid() = user_id);
