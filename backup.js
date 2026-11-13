// РЕЗЕРВНЫЕ КОПИИ настоящей базы. Два способа (выбирается сам):
//  1) S3-совместимое хранилище (Cloudflare R2, Backblaze B2, Yandex Object Storage, AWS S3) — если заданы BACKUP_S3_*.
//     Без npm-зависимостей: подпись запросов AWS Signature V4 считается встроенным node:crypto.
//  2) Telegram (v12) — если S3 не задан, а у администратора привязан Telegram: копия хранится закреплённым
//     документом в чате с ботом. Никаких новых переменных не нужно (подробности — services/tgbackup.js).
//  • При запуске: если файла базы нет (новый диск, перезапуск бесплатного сервера) — скачиваем последнюю копию.
//  • Каждые BACKUP_INTERVAL_MIN минут: снимок VACUUM INTO и загрузка, если в базе что-то поменялось.
//  • При остановке сервера (SIGTERM от хостинга): последний снимок перед выходом.
//  • Храним последние BACKUP_KEEP копий.
// ВАЖНО: этот модуль не открывает базу при импорте — восстановление идёт ДО её открытия.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from '../config.js';
import { telegramEnabled } from '../telegram/api.js';
import { tgRestore, tgUpload, backupTargetChat, rememberWebhookChat, webhookBackupChat, setBootState } from './tgbackup.js';

export { backupTargetChat, rememberWebhookChat, webhookBackupChat };

const B = config.backup;
export const s3Enabled = () => !!(B.endpoint && B.bucket && B.keyId && B.secret);
/** Куда сейчас идут копии: 's3' | 'telegram' | null. Вызывать, когда база уже открыта. */
export function backupProvider() {
  if (s3Enabled()) return 's3';
  try {
    return backupTargetChat() ? 'telegram' : null;
  } catch {
    return null;
  }
}
export const backupEnabled = () => !!backupProvider();

const state = { lastOkAt: null, lastError: null, lastKey: null, lastSize: 0, restoredFrom: null, restoredAt: null, changesAtLastBackup: -1, running: false };
export const backupStatus = () => {
  const provider = backupProvider();
  return {
    enabled: !!provider,
    provider,
    // Можно включить без новых переменных: бот есть, осталось привязать Telegram администратора
    telegramPossible: telegramEnabled(),
    intervalMin: B.intervalMin,
    keep: B.keep,
    lastOkAt: state.lastOkAt,
    lastError: state.lastError,
    lastSize: state.lastSize,
    restoredFrom: state.restoredFrom,
    restoredAt: state.restoredAt,
  };
};

const sha256hex = (d) => crypto.createHash('sha256').update(d).digest('hex');
const hmac = (k, d) => crypto.createHmac('sha256', k).update(d).digest();
const encodePath = (p) => p.split('/').map((s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())).join('/');

/** Подпись AWS Signature V4 (чистая функция — проверяется тестом на официальном примере AWS) */
export function signV4({ method, path: p, query = [], headers, payloadHash, amzDate, region, service, keyId, secret }) {
  const day = amzDate.slice(0, 8);
  const canonicalQuery = query.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
  const signed = Object.keys(headers).map((h) => h.toLowerCase()).sort();
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v).trim()]));
  const canonical = [method, p, canonicalQuery, signed.map((h) => `${h}:${lower[h]}\n`).join(''), signed.join(';'), payloadHash].join('\n');
  const scope = `${day}/${region}/${service}/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256hex(canonical)].join('\n');
  const kSigning = hmac(hmac(hmac(hmac('AWS4' + secret, day), region), service), 'aws4_request');
  const signature = crypto.createHmac('sha256', kSigning).update(toSign).digest('hex');
  return `AWS4-HMAC-SHA256 Credential=${keyId}/${scope}, SignedHeaders=${signed.join(';')}, Signature=${signature}`;
}

/** Подписанный запрос к S3 (path-style: https://endpoint/bucket/key) */
async function s3(method, key = '', { body = null, query = {} } = {}) {
  const url = new URL(`${B.endpoint}/${encodePath(B.bucket)}${key ? '/' + encodePath(key) : ''}`);
  const q = Object.entries(query).sort(([a], [b]) => (a < b ? -1 : 1));
  for (const [k, v] of q) url.searchParams.append(k, v);
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const payloadHash = sha256hex(body || '');
  const headers = { host: url.host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate };
  const auth = signV4({ method, path: url.pathname, query: q, headers, payloadHash, amzDate, region: B.region, service: 's3', keyId: B.keyId, secret: B.secret });
  const res = await fetch(url, { method, headers: { ...headers, Authorization: auth }, body: body || undefined, signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`S3 ${method} ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res;
}

async function listKeys() {
  const res = await s3('GET', '', { query: { 'list-type': '2', prefix: `${B.prefix}/` } });
  const xml = await res.text();
  return [...xml.matchAll(/<Key>([^<]+)<\/Key>/g)].map((m) => m[1]).filter((k) => k.endsWith('.db')).sort();
}

/** При запуске: если базы на диске нет — восстановить последнюю копию. Вызывать ДО первого обращения к базе. */
export async function restoreIfNeeded(dbPath = config.dbPath) {
  if (fs.existsSync(dbPath) && fs.statSync(dbPath).size > 0) return false;
  if (!s3Enabled()) {
    if (!telegramEnabled()) return false;
    try {
      const r = await tgRestore(dbPath);
      setBootState(r ? 'restored' : 'empty');
      if (!r) return false;
      Object.assign(state, { restoredFrom: 'telegram', restoredAt: r.at, changesAtLastBackup: 0 });
      console.log(`[backup] база восстановлена из Telegram: копия от ${r.at} (${Math.round(r.size / 1024)} КБ)`);
      return r;
    } catch (e) {
      setBootState('failed');
      const net = /fetch failed|timeout|aborted|ECONN|ENOTFOUND/i.test(e.message);
      state.lastError = `Восстановление: ${net ? 'нет связи с Telegram. Перезапустите сервер (Render → Restart service)' : e.message}`;
      console.error('[backup] не удалось восстановить базу из Telegram:', e.message);
      return false;
    }
  }
  try {
    const keys = await listKeys();
    if (!keys.length) {
      console.log('[backup] копий пока нет — начинаем с чистой базы');
      return false;
    }
    const key = keys[keys.length - 1];
    const res = await s3('GET', key);
    const buf = Buffer.from(await res.arrayBuffer());
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    for (const ext of ['-wal', '-shm']) fs.rmSync(dbPath + ext, { force: true });
    fs.writeFileSync(dbPath, buf);
    state.restoredFrom = key;
    state.changesAtLastBackup = 0;
    console.log(`[backup] база восстановлена из ${key} (${Math.round(buf.length / 1024)} КБ)`);
    return true;
  } catch (e) {
    state.lastError = `Восстановление: ${e.message}`;
    console.error('[backup] не удалось восстановить базу:', e.message);
    return false;
  }
}

/** Сделать снимок и загрузить. force — даже если изменений не было. */
export async function backupNow({ force = false } = {}) {
  const provider = backupProvider();
  if (!provider)
    return {
      ok: false,
      reason: telegramEnabled()
        ? 'Копии выключены: привяжите Telegram к аккаунту администратора (Профиль → Подключить Telegram) или задайте BACKUP_S3_*'
        : 'Резервное копирование не настроено: нужен Telegram-бот (TELEGRAM_BOT_TOKEN) или хранилище BACKUP_S3_*',
    };
  if (state.running) return { ok: false, reason: 'Копия уже создаётся' };
  const { snapshotTo, realChanges } = await import('../db.js');
  const changes = realChanges();
  if (!force && changes === state.changesAtLastBackup) return { ok: true, skipped: true };
  state.running = true;
  const tmp = path.join(os.tmpdir(), `ab-backup-${process.pid}-${Date.now()}.db`);
  try {
    snapshotTo(tmp);
    const buf = fs.readFileSync(tmp);
    if (provider === 'telegram') {
      const r = await tgUpload(buf, backupTargetChat());
      Object.assign(state, { lastOkAt: new Date().toISOString(), lastError: null, lastKey: 'telegram', lastSize: buf.length, changesAtLastBackup: changes });
      return { ok: true, key: 'Telegram (закреплённое сообщение в чате с ботом)', size: buf.length, provider, edited: r.edited };
    }
    const key = `${B.prefix}/${new Date().toISOString().replace(/[:.]/g, '-')}.db`;
    await s3('PUT', key, { body: buf });
    Object.assign(state, { lastOkAt: new Date().toISOString(), lastError: null, lastKey: key, lastSize: buf.length, changesAtLastBackup: changes });
    // Старые копии удаляем, оставляем последние B.keep
    const keys = await listKeys().catch(() => []);
    for (const old of keys.slice(0, Math.max(0, keys.length - B.keep))) await s3('DELETE', old).catch(() => {});
    return { ok: true, key, size: buf.length, provider };
  } catch (e) {
    state.lastError = e.message;
    console.error('[backup]', e.message);
    return { ok: false, reason: e.message };
  } finally {
    state.running = false;
    fs.rmSync(tmp, { force: true });
  }
}

/** Снимок для скачивания администратором (файл во временной папке) */
export async function snapshotFile() {
  const { snapshotTo } = await import('../db.js');
  return snapshotTo(path.join(os.tmpdir(), `ab-download-${process.pid}-${Date.now()}.db`));
}

export function scheduleBackups() {
  // Telegram-копии могут включиться и позже (когда админ привяжет Telegram), поэтому планировщик
  // запускаем, если возможен хотя бы один способ, а наличие цели проверяем на каждом шаге.
  if (!s3Enabled() && !telegramEnabled()) return;
  // Проверяем каждые 15 секунд: копия уходит, если база изменилась и с прошлой копии прошло BACKUP_INTERVAL_MIN минут
  let lastTry = 0;
  setInterval(() => {
    if (Date.now() - lastTry < Math.max(0.25, B.intervalMin) * 60e3 - 5e3) return;
    if (!backupEnabled()) return;
    lastTry = Date.now();
    backupNow().catch(() => {});
  }, 15e3).unref?.();
  // Хостинг останавливает сервер сигналом SIGTERM (деплой, засыпание): успеваем сохранить последнюю копию
  let stopping = false;
  const finalBackup = (sig) => {
    if (stopping) return;
    stopping = true;
    console.log(`[backup] ${sig}: сохраняю последнюю копию…`);
    Promise.race([backupNow(), new Promise((r) => setTimeout(r, 20000))]).finally(() => process.exit(0));
  };
  process.once('SIGTERM', () => finalBackup('SIGTERM'));
  process.once('SIGINT', () => finalBackup('SIGINT'));
  const p = backupProvider();
  console.log(
    p === 's3'
      ? `[backup] резервные копии в S3: каждые ${B.intervalMin} мин (если были изменения), храним ${B.keep}`
      : p === 'telegram'
        ? `[backup] резервные копии в Telegram: каждые ${B.intervalMin} мин (если были изменения)`
        : '[backup] копии включатся, когда администратор привяжет Telegram (или задайте BACKUP_S3_*)'
  );
}
