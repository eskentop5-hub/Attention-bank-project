import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config, ROOT } from './config.js';
import ASSETS from './assets.js';

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

export const db = new DatabaseSync(config.dbPath);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

// Миграции для баз, созданных версией 1: добавляем новые колонки, данные сохраняются.
// Выполняются ДО schema.sql, потому что индексы в схеме могут ссылаться на новые колонки.
const MIGRATIONS = [
  ['users', 'notify_telegram', 'INTEGER NOT NULL DEFAULT 1'],
  ['users', 'goal_reward_id', 'INTEGER'],
  ['users', 'is_demo', 'INTEGER NOT NULL DEFAULT 0'],
  ['campaigns', 'instructions', 'TEXT'],
  ['campaigns', 'est_minutes', 'INTEGER'],
  ['rewards', 'category', "TEXT NOT NULL DEFAULT 'game_access'"],
  ['rewards', 'image_id', 'INTEGER'],
  ['rewards', 'cover', 'TEXT'],
  ['rewards', 'how_to_use', 'TEXT'],
];
for (const [table, column, ddl] of MIGRATIONS) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (cols.length && !cols.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
}

db.exec(ASSETS ? Buffer.from(ASSETS['schema.sql'], 'base64').toString('utf8') : fs.readFileSync(path.join(ROOT, 'server', 'schema.sql'), 'utf8'));

// Короткие помощники
export const one = (sql, ...p) => db.prepare(sql).get(...p);
export const all = (sql, ...p) => db.prepare(sql).all(...p);
export const run = (sql, ...p) => db.prepare(sql).run(...p);

// Атомарные транзакции. Вложенные вызовы используют SAVEPOINT.
let depth = 0;
const afterCommit = [];
export function tx(fn) {
  const sp = `sp_${depth}`;
  db.exec(depth === 0 ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${sp}`);
  depth++;
  try {
    const result = fn();
    depth--;
    db.exec(depth === 0 ? 'COMMIT' : `RELEASE ${sp}`);
    if (depth === 0) flushAfterCommit();
    return result;
  } catch (err) {
    depth--;
    db.exec(depth === 0 ? 'ROLLBACK' : `ROLLBACK TO ${sp}; RELEASE ${sp}`);
    if (depth === 0) afterCommit.length = 0;
    throw err;
  }
}

// Побочные эффекты (Telegram и т.п.) выполняются только после успешного COMMIT
export function onCommit(fn) {
  if (depth === 0) setImmediate(fn);
  else afterCommit.push(fn);
}
function flushAfterCommit() {
  const jobs = afterCommit.splice(0);
  for (const job of jobs) setImmediate(() => Promise.resolve().then(job).catch((e) => console.error('[after-commit]', e)));
}

export const now = () => new Date().toISOString();

// Системный аккаунт платформы (получает комиссию)
export function platformAccountId() {
  let row = one("SELECT id FROM users WHERE role = 'system' LIMIT 1");
  if (!row) {
    run("INSERT INTO users (email, password_hash, name, role) VALUES ('platform@attention.bank', '!', 'ATTENTION BANK', 'system')");
    row = one("SELECT id FROM users WHERE role = 'system' LIMIT 1");
  }
  return row.id;
}
