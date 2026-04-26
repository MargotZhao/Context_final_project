-- Run this in the Supabase SQL editor.
-- Safe to re-run: all statements use IF NOT EXISTS / ADD COLUMN IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS chat_logs (
  id                 UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  request_id         UUID,                        -- correlates with tool_error_logs
  user_message       TEXT        NOT NULL,
  assistant_response TEXT,
  tool_calls         JSONB       DEFAULT CAST('[]' AS jsonb),
  model              TEXT        NOT NULL,
  input_tokens       INTEGER,
  output_tokens      INTEGER,
  duration_ms        INTEGER,
  error              TEXT
);

-- Add request_id if upgrading from the original schema
ALTER TABLE chat_logs ADD COLUMN IF NOT EXISTS request_id UUID;

CREATE INDEX IF NOT EXISTS chat_logs_created_at_idx  ON chat_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS chat_logs_request_id_idx  ON chat_logs (request_id);

ALTER TABLE chat_logs ENABLE ROW LEVEL SECURITY;

-- ── Tool error log ────────────────────────────────────────────────────────────
-- Each row is one failed client-side tool call, written immediately on failure
-- (not batched with the end-of-request summary).

CREATE TABLE IF NOT EXISTS tool_error_logs (
  id          UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  request_id  UUID        NOT NULL,   -- join to chat_logs.request_id
  tool_name   TEXT        NOT NULL,
  input       JSONB,
  error       TEXT        NOT NULL,
  duration_ms INTEGER
);

CREATE INDEX IF NOT EXISTS tool_error_logs_request_id_idx ON tool_error_logs (request_id);
CREATE INDEX IF NOT EXISTS tool_error_logs_created_at_idx ON tool_error_logs (created_at DESC);

ALTER TABLE tool_error_logs ENABLE ROW LEVEL SECURITY;

-- ── User feedback ─────────────────────────────────────────────────────────────
-- Thumbs-up / thumbs-down per completed assistant response.
-- rating: 1 = positive, -1 = negative.

CREATE TABLE IF NOT EXISTS feedback (
  id          UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  request_id  UUID,                    -- join to chat_logs.request_id
  rating      SMALLINT    NOT NULL CHECK (rating IN (1, -1))
);

CREATE INDEX IF NOT EXISTS feedback_request_id_idx ON feedback (request_id);
CREATE INDEX IF NOT EXISTS feedback_created_at_idx ON feedback (created_at DESC);

ALTER TABLE feedback ENABLE ROW LEVEL SECURITY;
