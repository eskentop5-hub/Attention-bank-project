-- ATTENTION BANK — схема базы данных (SQLite).
-- PostgreSQL-версия той же схемы: db/schema.postgres.sql

CREATE TABLE IF NOT EXISTS users (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  email                TEXT NOT NULL UNIQUE,
  password_hash        TEXT NOT NULL,
  name                 TEXT NOT NULL,
  role                 TEXT NOT NULL CHECK (role IN ('user', 'company', 'system')),
  company_name         TEXT,
  interests            TEXT NOT NULL DEFAULT '[]',
  -- Кэш баланса. Источник правды — таблица transactions (баланс = сумма транзакций).
  balance              INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
  telegram_chat_id     TEXT UNIQUE,
  telegram_username    TEXT,
  telegram_verified_at TEXT,
  notify_telegram      INTEGER NOT NULL DEFAULT 1,  -- участник сам решает, получать ли сообщения
  goal_reward_id       INTEGER,                     -- «Моя цель» в каталоге наград
  is_demo              INTEGER NOT NULL DEFAULT 0,  -- демонстрационные аккаунты помечаются в интерфейсе
  consent_at           TEXT,
  created_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY,            -- sha256 от токена (сам токен в базе не хранится)
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS campaigns (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id        INTEGER NOT NULL REFERENCES users(id),
  title             TEXT NOT NULL,
  description       TEXT NOT NULL,
  category          TEXT NOT NULL,
  product_url       TEXT,
  audience          TEXT NOT NULL DEFAULT '[]', -- JSON: интересы целевой аудитории
  instructions      TEXT,                       -- что именно нужно сделать (шаги)
  est_minutes       INTEGER,                    -- оценка времени от компании
  reward           INTEGER NOT NULL CHECK (reward > 0),
  fee_per_result    INTEGER NOT NULL CHECK (fee_per_result >= 0),
  max_participants  INTEGER NOT NULL CHECK (max_participants > 0),
  min_seconds       INTEGER NOT NULL DEFAULT 60,
  auto_approve      INTEGER NOT NULL DEFAULT 0,
  require_telegram  INTEGER NOT NULL DEFAULT 0,
  questions         TEXT NOT NULL,          -- JSON: [{id,type,label,required,options,minLength}]
  status            TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'closed')),
  reserved          INTEGER NOT NULL DEFAULT 0 CHECK (reserved >= 0), -- зарезервированный бюджет в AB
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  closed_at         TEXT
);

CREATE TABLE IF NOT EXISTS assignments (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id     INTEGER NOT NULL REFERENCES campaigns(id),
  user_id         INTEGER NOT NULL REFERENCES users(id),
  status          TEXT NOT NULL CHECK (status IN ('started', 'submitted', 'approved', 'rejected')),
  started_at      TEXT NOT NULL,
  submitted_at    TEXT,
  answers         TEXT,                     -- JSON
  auto_score      INTEGER,
  auto_flags      TEXT,                     -- JSON
  quality_rating  INTEGER,
  review_note     TEXT,
  reviewed_by     TEXT,                     -- 'company' | 'auto'
  reviewed_at     TEXT,
  UNIQUE (campaign_id, user_id)             -- одно участие на пользователя
);

CREATE TABLE IF NOT EXISTS transactions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id),
  amount        INTEGER NOT NULL CHECK (amount <> 0),
  type          TEXT NOT NULL,              -- task_reward | redemption | bonus | deposit | campaign_reserve | campaign_refund | platform_fee
  title         TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'completed',
  ref_type      TEXT,
  ref_id        INTEGER,
  balance_after INTEGER NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS notifications (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  kind        TEXT NOT NULL DEFAULT 'info',
  title       TEXT NOT NULL,
  body        TEXT NOT NULL,
  link        TEXT,
  read_at     TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS telegram_link_codes (
  code        TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  expires_at  TEXT NOT NULL,
  used_at     TEXT
);

CREATE TABLE IF NOT EXISTS rewards (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id  INTEGER REFERENCES users(id),
  title       TEXT NOT NULL,
  description TEXT NOT NULL,
  cost        INTEGER NOT NULL CHECK (cost > 0),
  stock       INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
  active      INTEGER NOT NULL DEFAULT 1,
  category    TEXT NOT NULL DEFAULT 'game_access',
  image_id    INTEGER,                 -- картинка, загруженная компанией
  cover       TEXT,                    -- встроенная обложка (для демо-наград)
  how_to_use  TEXT,                    -- как воспользоваться наградой
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS redemptions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  reward_id   INTEGER NOT NULL REFERENCES rewards(id),
  user_id     INTEGER NOT NULL REFERENCES users(id),
  code        TEXT NOT NULL,
  cost        INTEGER NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS images (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id    INTEGER NOT NULL REFERENCES users(id),
  mime        TEXT NOT NULL,
  size        INTEGER NOT NULL,
  data        BLOB NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Защита от повторных запросов: один и тот же Idempotency-Key не спишет и не начислит дважды
CREATE TABLE IF NOT EXISTS idempotency (
  user_id     INTEGER NOT NULL,
  key         TEXT NOT NULL,
  route       TEXT NOT NULL,
  status      INTEGER NOT NULL,
  response    TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (user_id, key)
);

CREATE TABLE IF NOT EXISTS kv (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE INDEX IF NOT EXISTS idx_tx_user ON transactions(user_id, id);
CREATE INDEX IF NOT EXISTS idx_asg_campaign ON assignments(campaign_id, status);
CREATE INDEX IF NOT EXISTS idx_asg_user ON assignments(user_id);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, id);
CREATE INDEX IF NOT EXISTS idx_campaign_status ON campaigns(status);
