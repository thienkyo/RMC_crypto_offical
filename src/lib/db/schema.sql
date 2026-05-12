-- RMC Crypto — database schema
-- Run via: npm run migrate

-- TimescaleDB extension (requires timescale/timescaledb Docker image)
CREATE EXTENSION IF NOT EXISTS timescaledb;

-- ─── Symbol universe ─────────────────────────────────────────────────────────
-- Populated by /api/symbols on first run; updated periodically.
CREATE TABLE IF NOT EXISTS symbols (
  symbol        TEXT PRIMARY KEY,
  base_asset    TEXT        NOT NULL,
  quote_asset   TEXT        NOT NULL,
  source        TEXT        NOT NULL CHECK (source IN ('binance', 'equities')),
  display_name  TEXT        NOT NULL,
  rank          INTEGER,
  active        BOOLEAN     NOT NULL DEFAULT TRUE,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── OHLCV candles ───────────────────────────────────────────────────────────
-- Primary timeseries store. Partitioned by open_time via TimescaleDB.
CREATE TABLE IF NOT EXISTS candles (
  symbol      TEXT        NOT NULL,
  timeframe   TEXT        NOT NULL,
  open_time   TIMESTAMPTZ NOT NULL,
  open        NUMERIC     NOT NULL,
  high        NUMERIC     NOT NULL,
  low         NUMERIC     NOT NULL,
  close       NUMERIC     NOT NULL,
  -- Quote-asset volume (e.g. USDT amount traded, more useful than base volume)
  volume      NUMERIC     NOT NULL,
  close_time  TIMESTAMPTZ NOT NULL,

  PRIMARY KEY (symbol, timeframe, open_time)
);

-- Convert to TimescaleDB hypertable partitioned by open_time.
-- 7-day chunks balance query performance vs. number of chunks.
SELECT create_hypertable(
  'candles', 'open_time',
  chunk_time_interval => INTERVAL '7 days',
  if_not_exists       => TRUE
);

-- Fast lookups: symbol + timeframe + time range (most common query pattern)
CREATE INDEX IF NOT EXISTS candles_sym_tf_time
  ON candles (symbol, timeframe, open_time DESC);

-- ─── Strategies ──────────────────────────────────────────────────────────────
-- Full strategy JSON stored in a JSONB column for schema flexibility.
-- The individual scalar columns (symbol, timeframe, etc.) are extracted for
-- indexing / querying without having to parse the JSON.
CREATE TABLE IF NOT EXISTS strategies (
  id          TEXT        PRIMARY KEY,
  name        TEXT        NOT NULL,
  description TEXT        NOT NULL DEFAULT '',
  version     INTEGER     NOT NULL DEFAULT 1,
  symbol      TEXT        NOT NULL,
  timeframe   TEXT        NOT NULL,
  definition  JSONB       NOT NULL,
  -- Phase 5: extracted for efficient cron querying (mirrors definition->notifyOnSignal)
  notify_on_signal          BOOLEAN     NOT NULL DEFAULT FALSE,
  -- Unix ms of the last entry signal we already sent a Telegram message for.
  -- NULL = never notified; first cron run sets this without firing (avoids backlog spam).
  last_notified_trade_time  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ALTER statements for existing DBs that predate these columns (idempotent):
ALTER TABLE strategies ADD COLUMN IF NOT EXISTS notify_on_signal         BOOLEAN     NOT NULL DEFAULT FALSE;
ALTER TABLE strategies ADD COLUMN IF NOT EXISTS last_notified_trade_time TIMESTAMPTZ;

-- ─── Strategy versions ────────────────────────────────────────────────────────
-- Every save creates a version snapshot so we can diff / rollback.
CREATE TABLE IF NOT EXISTS strategy_versions (
  id          SERIAL      PRIMARY KEY,
  strategy_id TEXT        NOT NULL REFERENCES strategies(id) ON DELETE CASCADE,
  version     INTEGER     NOT NULL,
  definition  JSONB       NOT NULL,
  saved_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (strategy_id, version)
);

CREATE INDEX IF NOT EXISTS strategy_versions_by_strategy
  ON strategy_versions (strategy_id, version DESC);

-- ─── AI chart analysis cache ─────────────────────────────────────────────────
-- One row per (symbol, timeframe, candle_close_time).
-- On a cache hit the API route returns this row directly, saving Gemini credits.
CREATE TABLE IF NOT EXISTS ai_chart_analysis (
  id                SERIAL      PRIMARY KEY,
  symbol            TEXT        NOT NULL,
  timeframe         TEXT        NOT NULL,
  -- Unix ms of the last closed candle at analysis time (from the client).
  candle_close_time TIMESTAMPTZ NOT NULL,
  analysis          JSONB       NOT NULL,
  model             TEXT        NOT NULL DEFAULT 'gemini-2.0-flash',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- One analysis per (symbol, timeframe, bar).
  UNIQUE (symbol, timeframe, candle_close_time)
);

CREATE INDEX IF NOT EXISTS ai_chart_analysis_lookup
  ON ai_chart_analysis (symbol, timeframe, candle_close_time DESC);

-- ─── Phase 4: News & Social Ingestion ────────────────────────────────────────

-- Deduped article store for all news/social sources.
-- sentiment_score is NULL until the sentiment cron has processed the row.
CREATE TABLE IF NOT EXISTS news_articles (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  source           VARCHAR(50) NOT NULL,         -- 'coindesk' | 'reddit' | 'nitter' | 'polymarket' | 'cryptopanic' …
  external_id      VARCHAR(500) NOT NULL,        -- dedup key: URL hash or native source ID
  url              TEXT        NOT NULL,
  title            TEXT        NOT NULL,
  body             TEXT,                         -- first ~500 chars of content; never full HTML
  author           VARCHAR(200),
  published_at     TIMESTAMPTZ NOT NULL,
  fetched_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  symbols          TEXT[]      NOT NULL DEFAULT '{}',  -- matched symbols e.g. ['BTCUSDT','AAPL']
  sentiment_score  FLOAT,                        -- NULL = unclassified; -1.0 bearish → +1.0 bullish
  sentiment_label  VARCHAR(10),                  -- 'bearish' | 'neutral' | 'bullish'
  sentiment_summary TEXT,                        -- 1-sentence Claude summary (high-signal only)
  sentiment_model  VARCHAR(80),                  -- model that classified this row
  credibility      FLOAT       NOT NULL DEFAULT 1.0,  -- source-level weight (tunable)
  UNIQUE (source, external_id)
);

-- GIN index for per-symbol feed queries (WHERE 'BTCUSDT' = ANY(symbols))
CREATE INDEX IF NOT EXISTS news_symbols_gin   ON news_articles USING GIN (symbols);
CREATE INDEX IF NOT EXISTS news_published_idx ON news_articles (published_at DESC);
-- Unclassified backlog for the sentiment cron
CREATE INDEX IF NOT EXISTS news_unclassified  ON news_articles (fetched_at) WHERE sentiment_score IS NULL;

-- Tracked X/Twitter accounts crawled via Nitter RSS.
-- Configurable via DB rather than hardcoded.
CREATE TABLE IF NOT EXISTS nitter_accounts (
  handle       VARCHAR(100) PRIMARY KEY,
  display_name VARCHAR(200),
  symbols      TEXT[]  NOT NULL DEFAULT '{}',  -- coins this account usually covers (hint)
  active       BOOLEAN NOT NULL DEFAULT TRUE
);

-- Polymarket odds snapshots — stored as a time-series so we can chart prob over time.
CREATE TABLE IF NOT EXISTS polymarket_snapshots (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id  VARCHAR(200) NOT NULL,
  question   TEXT        NOT NULL,
  symbols    TEXT[]      NOT NULL DEFAULT '{}',
  yes_prob   FLOAT       NOT NULL,
  no_prob    FLOAT       NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS poly_sym_time ON polymarket_snapshots USING GIN (symbols);
CREATE INDEX IF NOT EXISTS poly_fetched  ON polymarket_snapshots (fetched_at DESC);

-- Seed starter Nitter accounts (idempotent)
INSERT INTO nitter_accounts (handle, display_name, symbols) VALUES
  ('100trillionUSD', 'PlanB',         ARRAY['BTCUSDT']),
  ('woonomic',       'Willy Woo',     ARRAY['BTCUSDT']),
  ('CryptoCred',     'CryptoCred',    ARRAY['BTCUSDT','ETHUSDT']),
  ('AltcoinPsycho',  'AltcoinPsycho', ARRAY['BTCUSDT','ETHUSDT']),
  ('inversebrah',    'inversebrah',   ARRAY['BTCUSDT'])
ON CONFLICT (handle) DO NOTHING;

-- ─── Phase 5: Alerts ─────────────────────────────────────────────────────────

-- Alert rules: each row defines one indicator-condition alert.
-- `condition` is a StrategyCondition JSONB (same shape as strategy conditions)
-- so we can reuse the existing evaluate.ts logic without duplication.
-- For price-threshold alerts set indicatorId = '__price__'.
CREATE TABLE IF NOT EXISTS alert_rules (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT        NOT NULL,
  symbol        TEXT        NOT NULL,
  timeframe     TEXT        NOT NULL,
  enabled       BOOLEAN     NOT NULL DEFAULT TRUE,
  -- StrategyCondition JSON: { indicatorId, params, seriesIndex, operator, value }
  condition     JSONB       NOT NULL,
  -- Minimum milliseconds between firings of this rule (default 1 hour).
  cooldown_ms   INTEGER     NOT NULL DEFAULT 3600000,
  last_fired_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS alert_rules_enabled ON alert_rules (enabled) WHERE enabled = TRUE;

-- History of every alert that fired (delivered = TRUE once Telegram confirmed).
CREATE TABLE IF NOT EXISTS alert_history (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id    UUID        NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
  fired_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  message    TEXT        NOT NULL,
  delivered  BOOLEAN     NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS alert_history_rule ON alert_history (rule_id, fired_at DESC);
CREATE INDEX IF NOT EXISTS alert_history_undelivered ON alert_history (fired_at) WHERE delivered = FALSE;

-- ─── App settings ────────────────────────────────────────────────────────────
-- Generic key/value store for user-configurable settings.
-- Prefer explicit named keys over a JSON blob so each field is queryable.
CREATE TABLE IF NOT EXISTS settings (
  key        TEXT        PRIMARY KEY,
  value      TEXT,                        -- NULL = field present but intentionally blank
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed default (empty) Telegram keys so the settings page can always SELECT them.
INSERT INTO settings (key, value) VALUES
  ('telegram_personal_chat_id', NULL),
  ('telegram_group_chat_id',    NULL)
ON CONFLICT (key) DO NOTHING;

-- ─── Backfill tracking ───────────────────────────────────────────────────────
-- Tracks the earliest candle we have per symbol+timeframe so we know
-- whether a historical range is already in DB without a COUNT(*).
CREATE TABLE IF NOT EXISTS backfill_status (
  symbol        TEXT    NOT NULL,
  timeframe     TEXT    NOT NULL,
  earliest_time TIMESTAMPTZ,
  latest_time   TIMESTAMPTZ,
  candle_count  INTEGER NOT NULL DEFAULT 0,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  PRIMARY KEY (symbol, timeframe)
);
