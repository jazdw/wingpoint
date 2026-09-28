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

-- Only the score master (owner) and linked players can see a game; guests
-- can't log in, so they are tracked by name only.
CREATE TABLE IF NOT EXISTS games (
  id              TEXT PRIMARY KEY,
  owner_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  played_at       INTEGER NOT NULL,
  status          TEXT NOT NULL DEFAULT 'in_progress',  -- in_progress | completed
  -- `core_sets` is reserved: only ['wingspan'] is used today, but it lets
  -- Wingspan Asia be re-added later without a migration.
  core_sets       TEXT NOT NULL DEFAULT '["wingspan"]',  -- JSON array of standalone sets
  expansions      TEXT NOT NULL DEFAULT '[]',            -- JSON array of expansion ids
  goal_board      TEXT NOT NULL DEFAULT 'green',          -- green | blue
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
  status     TEXT NOT NULL DEFAULT 'accepted',  -- pending (invited) | accepted
  scores     TEXT NOT NULL DEFAULT '{}',   -- raw user input keyed by score field
  points     TEXT NOT NULL DEFAULT '{}',   -- computed category points
  total      INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_game_players_game ON game_players(game_id);
CREATE INDEX IF NOT EXISTS idx_game_players_user ON game_players(user_id);
