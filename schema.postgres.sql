-- ATTENTION BANK — та же схема для PostgreSQL (для продакшена).
-- В MVP используется встроенный SQLite (server/schema.sql) — запуск без установки БД.
-- Логика леджера одинакова: баланс меняется только через INSERT в transactions в одной транзакции.

CREATE TABLE users (
  id                   BIGSERIAL PRIMARY KEY,
  email                TEXT NOT NULL UNIQUE,
  password_hash        TEXT NOT NULL,
  name                 TEXT NOT NULL,
  role                 TEXT NOT NULL CHECK (role IN ('user', 'company', 'system')),
  company_name         TEXT,
  interests            JSONB NOT NULL DEFAULT '[]',
  balance              INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
  telegram_chat_id     TEXT UNIQUE,
  telegram_username    TEXT,
  telegram_verified_at TIMESTAMPTZ,
  consent_at           TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  id          TEXT PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE campaigns (
  id                BIGSERIAL PRIMARY KEY,
  company_id        BIGINT NOT NULL REFERENCES users(id),
  title             TEXT NOT NULL,
  description       TEXT NOT NULL,
  category          TEXT NOT NULL,
  product_url       TEXT,
  audience          JSONB NOT NULL DEFAULT '[]',
  reward            INTEGER NOT NULL CHECK (reward > 0),
  fee_per_result    INTEGER NOT NULL CHECK (fee_per_result >= 0),
  max_participants  INTEGER NOT NULL CHECK (max_participants > 0),
  min_seconds       INTEGER NOT NULL DEFAULT 60,
  auto_approve      BOOLEAN NOT NULL DEFAULT false,
  require_telegram  BOOLEAN NOT NULL DEFAULT false,
  questions         JSONB NOT NULL,
  status            TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'closed')),
  reserved          INTEGER NOT NULL DEFAULT 0 CHECK (reserved >= 0),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at         TIMESTAMPTZ
);

CREATE TABLE assignments (
  id              BIGSERIAL PRIMARY KEY,
  campaign_id     BIGINT NOT NULL REFERENCES campaigns(id),
  user_id         BIGINT NOT NULL REFERENCES users(id),
  status          TEXT NOT NULL CHECK (status IN ('started', 'submitted', 'approved', 'rejected')),
  started_at      TIMESTAMPTZ NOT NULL,
  submitted_at    TIMESTAMPTZ,
  answers         JSONB,
  auto_score      INTEGER,
  auto_flags      JSONB,
  quality_rating  INTEGER,
  review_note     TEXT,
  reviewed_by     TEXT,
  reviewed_at     TIMESTAMPTZ,
  UNIQUE (campaign_id, user_id)
);

CREATE TABLE transactions (
  id            BIGSERIAL PRIMARY KEY,
  user_id       BIGINT NOT NULL REFERENCES users(id),
  amount        INTEGER NOT NULL CHECK (amount <> 0),
  type          TEXT NOT NULL,
  title         TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'completed',
  ref_type      TEXT,
  ref_id        BIGINT,
  balance_after INTEGER NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE notifications (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES users(id),
  kind        TEXT NOT NULL DEFAULT 'info',
  title       TEXT NOT NULL,
  body        TEXT NOT NULL,
  link        TEXT,
  read_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE telegram_link_codes (
  code        TEXT PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES users(id),
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ
);

CREATE TABLE rewards (
  id          BIGSERIAL PRIMARY KEY,
  company_id  BIGINT REFERENCES users(id),
  title       TEXT NOT NULL,
  description TEXT NOT NULL,
  cost        INTEGER NOT NULL CHECK (cost > 0),
  stock       INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
  active      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE redemptions (
  id          BIGSERIAL PRIMARY KEY,
  reward_id   BIGINT NOT NULL REFERENCES rewards(id),
  user_id     BIGINT NOT NULL REFERENCES users(id),
  code        TEXT NOT NULL,
  cost        INTEGER NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_tx_user ON transactions(user_id, id);
CREATE INDEX idx_asg_campaign ON assignments(campaign_id, status);
CREATE INDEX idx_asg_user ON assignments(user_id);
CREATE INDEX idx_notif_user ON notifications(user_id, id);
CREATE INDEX idx_campaign_status ON campaigns(status);
