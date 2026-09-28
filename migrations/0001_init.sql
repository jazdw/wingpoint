-- WingPoint initial schema.
-- Applied with: wrangler d1 migrations apply wingpoint --local (or --remote)

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  google_sub    TEXT NOT NULL UNIQUE,
  email         TEXT NOT NULL,
  name          TEXT NOT NULL,
  picture       TEXT,
  created_at    INTEGER NOT NULL,
  last_login_at INTEGER
);

CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,          -- SHA-256 hash of the session cookie value
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- Optional DB-backed allow list, in addition to the ALLOWED_EMAILS env var.
CREATE TABLE IF NOT EXISTS allowed_emails (
  email    TEXT PRIMARY KEY,
  added_at INTEGER NOT NULL,
  note     TEXT
);

CREATE TABLE IF NOT EXISTS games (
  id              TEXT PRIMARY KEY,
  owner_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  played_at       INTEGER NOT NULL,
  mode            TEXT NOT NULL DEFAULT 'competitive',  -- competitive | solo | coop
  status          TEXT NOT NULL DEFAULT 'in_progress',  -- in_progress | completed
  scoring_profile TEXT NOT NULL DEFAULT 'base',
  expansions      TEXT NOT NULL DEFAULT '[]',            -- JSON array
  notes           TEXT,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_games_played_at ON games(played_at DESC);
CREATE INDEX IF NOT EXISTS idx_games_status ON games(status);

CREATE TABLE IF NOT EXISTS game_players (
  id         TEXT PRIMARY KEY,
  game_id    TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  user_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
  name       TEXT NOT NULL,
  seat       INTEGER NOT NULL DEFAULT 0,
  scores     TEXT NOT NULL DEFAULT '{}',   -- raw user input keyed by score field
  points     TEXT NOT NULL DEFAULT '{}',   -- computed category points
  total      INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_game_players_game ON game_players(game_id);
CREATE INDEX IF NOT EXISTS idx_game_players_user ON game_players(user_id);
