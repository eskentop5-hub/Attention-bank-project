import fs from 'node:fs';
import path from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import { DatabaseSync } from 'node:sqlite';
import { config, ROOT } from './config.js';
import ASSETS from './assets.js';

// ДВЕ БАЗЫ ДАННЫХ
//  • «настоящая» (config.dbPath) — реальные пользователи, студии и деньги. Демо-данных в ней нет.
//  • «демо» — песочница в памяти с демо-аккаунтами. Включается кнопкой «Демо» (cookie ab_mode=demo),
//    сбрасывается автоматически. Демо-действия физически не могут попасть в настоящую базу.
// Какая база используется в запросе, решает AsyncLocalStorage: весь код ниже вызывает one/all/run/tx,
// а они сами берут базу текущего контекста. Код без контекста (бот, напоминания, тесты) работает с настоящей.

// Миграции для баз, созданных прошлыми версиями: добавляем новые колонки, данные сохраняются.
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
  ['rewards', 'platform', 'TEXT'],
  ['users', 'avatar', 'TEXT'],
  ['redemptions', 'seller_net', 'INTEGER'],
  ['campaigns', 'keywords', 'TEXT'],
  ['campaigns', 'invite_code', 'TEXT'],
  ['users', 'deleted_at', 'TEXT'],
  ['redemptions', 'seller_fee', 'INTEGER'],
  // v11: реальная работа
  ['users', 'is_admin', 'INTEGER NOT NULL DEFAULT 0'],
  ['users', 'blocked_at', 'TEXT'],
  ['users', 'ref_code', 'TEXT'],
  ['users', 'referred_by', 'INTEGER'],
  ['users', 'signup_source', 'TEXT'],
  ['users', 'email_verified_at', 'TEXT'],
  ['campaigns', 'min_level', 'INTEGER NOT NULL DEFAULT 0'],
  ['payouts', 'decided_at', 'TEXT'],
  ['payouts', 'admin_note', 'TEXT'],
];

const schemaSql = () =>
  ASSETS ? Buffer.from(ASSETS['schema.sql'], 'base64').toString('utf8') : fs.readFileSync(path.join(ROOT, 'server', 'schema.sql'), 'utf8');

function openDatabase(file) {
  const memory = file === ':memory:';
  if (!memory) fs.mkdirSync(path.dirname(file), { recursive: true });
  const d = new DatabaseSync(file);
  d.exec(memory ? 'PRAGMA foreign_keys = ON;' : 'PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  for (const [table, column, ddl] of MIGRATIONS) {
    const cols = d.prepare(`PRAGMA table_info(${table})`).all();
    if (cols.length && !cols.some((c) => c.name === column)) d.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  }
  d.exec(schemaSql());
  return d;
}

/** Контекст базы: сама база + состояние транзакций (у каждой базы своё) */
export function createContext(name, file, demo) {
  return { name, file, demo: !!demo, db: openDatabase(file), depth: 0, afterCommit: [], createdAt: Date.now() };
}

const als = new AsyncLocalStorage();
// Настоящая база открывается при первом обращении — чтобы при запуске можно было сначала
// восстановить её из резервной копии (server/services/backup.js), а уже потом открыть.
let real = null;
export function realContext() {
  if (!real) real = createContext('real', config.dbPath, config.demoMode);
  return real;
}
/** Настоящая база (для тестов и служебных задач) */
export const db = {
  prepare: (sql) => realContext().db.prepare(sql),
  exec: (sql) => realContext().db.exec(sql),
  close: () => realContext().db.close(),
};

const cur = () => als.getStore() || realContext();
/** Выполнить fn в контексте другой базы (используется для демо-песочницы) */
export const withContext = (ctx, fn) => als.run(ctx, fn);
export const currentDb = () => cur().db;
/** Текущая база — демонстрационная? (демо-песочница или старый режим DEMO_MODE=1) */
export const isDemo = () => cur().demo;
/** 'real' | 'demo' */
export const modeName = () => cur().name;

// Короткие помощники — работают с базой текущего контекста
export const one = (sql, ...p) => cur().db.prepare(sql).get(...p);
export const all = (sql, ...p) => cur().db.prepare(sql).all(...p);
export const run = (sql, ...p) => cur().db.prepare(sql).run(...p);

// Атомарные транзакции. Вложенные вызовы используют SAVEPOINT.
export function tx(fn) {
  const c = cur();
  const sp = `sp_${c.depth}`;
  c.db.exec(c.depth === 0 ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${sp}`);
  c.depth++;
  try {
    const result = fn();
    c.depth--;
    c.db.exec(c.depth === 0 ? 'COMMIT' : `RELEASE ${sp}`);
    if (c.depth === 0) flushAfterCommit(c);
    return result;
  } catch (err) {
    c.depth--;
    c.db.exec(c.depth === 0 ? 'ROLLBACK' : `ROLLBACK TO ${sp}; RELEASE ${sp}`);
    if (c.depth === 0) c.afterCommit.length = 0;
    throw err;
  }
}

// Побочные эффекты (Telegram и т.п.) выполняются только после успешного COMMIT
export function onCommit(fn) {
  const c = cur();
  if (c.depth === 0) setImmediate(fn);
  else c.afterCommit.push(fn);
}
function flushAfterCommit(c) {
  const jobs = c.afterCommit.splice(0);
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

/**
 * Согласованная копия настоящей базы в файл (для резервного копирования).
 * VACUUM INTO делает снимок без остановки записи.
 */
export function snapshotTo(file) {
  fs.rmSync(file, { force: true });
  realContext().db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  return file;
}

/** Сколько изменений было в настоящей базе с момента открытия (для «бэкапить, только если что-то поменялось») */
export function realChanges() {
  return real ? real.db.prepare('SELECT total_changes() AS n').get().n : 0;
}
