-- msTrader local database schema (SQLite)
-- Applied idempotently on every launch by electron/database.ts

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- Users: single local user for now, but modelled so multiple paper accounts
-- can coexist later.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  username        TEXT    NOT NULL UNIQUE,
  created_at      INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
);

-- ---------------------------------------------------------------------------
-- Accounts: virtual balances. Equity/margin are derived at runtime; only the
-- realised balance is persisted.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS accounts (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  currency          TEXT    NOT NULL DEFAULT 'USD',
  starting_balance  REAL    NOT NULL,
  balance           REAL    NOT NULL,
  updated_at        INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
);

-- ---------------------------------------------------------------------------
-- Trades: every CLOSED paper trade. Open positions live in memory (Zustand)
-- and are snapshotted into `open_positions` for crash recovery.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS trades (
  id            TEXT    PRIMARY KEY,
  account_id    INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  symbol        TEXT    NOT NULL,
  side          TEXT    NOT NULL CHECK (side IN ('BUY','SELL')),
  lots          REAL    NOT NULL,
  units         REAL    NOT NULL,
  entry_price   REAL    NOT NULL,
  exit_price    REAL    NOT NULL,
  stop_loss     REAL,
  take_profit   REAL,
  opened_at     INTEGER NOT NULL,
  closed_at     INTEGER NOT NULL,
  commission    REAL    NOT NULL DEFAULT 0,
  slippage      REAL    NOT NULL DEFAULT 0,
  spread_cost   REAL    NOT NULL DEFAULT 0,
  gross_pnl     REAL    NOT NULL,
  net_pnl       REAL    NOT NULL,
  close_reason  TEXT    NOT NULL CHECK (close_reason IN ('MANUAL','STOP_LOSS','TAKE_PROFIT','MARGIN_CALL'))
);

CREATE INDEX IF NOT EXISTS idx_trades_account_closed ON trades(account_id, closed_at DESC);
CREATE INDEX IF NOT EXISTS idx_trades_symbol ON trades(symbol);

-- ---------------------------------------------------------------------------
-- Open positions snapshot (so a restart does not lose live paper positions)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS open_positions (
  id            TEXT    PRIMARY KEY,
  account_id    INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  payload       TEXT    NOT NULL,   -- JSON serialised Position
  updated_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS pending_orders (
  id            TEXT    PRIMARY KEY,
  account_id    INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  payload       TEXT    NOT NULL,   -- JSON serialised PendingOrder
  updated_at    INTEGER NOT NULL
);

-- ---------------------------------------------------------------------------
-- Settings: simple key/value store (JSON values)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
);

-- Seed the default local user and account on first run.
INSERT OR IGNORE INTO users (id, username) VALUES (1, 'local');
INSERT OR IGNORE INTO accounts (id, user_id, currency, starting_balance, balance)
  VALUES (1, 1, 'USD', 10000, 10000);
