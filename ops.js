// Эксплуатация: журнал ошибок, журнал действий администратора, простые лимиты частоты.
// Ошибки всегда пишутся в НАСТОЯЩУЮ базу (даже если случились в демо) — их видит администратор.
import { realContext } from '../db.js';
import { HttpError } from '../util.js';

const clip = (v, n) => (v == null ? null : String(v).slice(0, n));
// Не сохраняем ничего похожего на секреты
const scrub = (s) => (s == null ? s : String(s).replace(/(password|token|secret|initData)["'=:\s]+[^\s,"'&}]+/gi, '$1=[скрыто]'));

export function logError({ source = 'server', message, detail = null, path = null, userId = null }) {
  try {
    realContext().db
      .prepare('INSERT INTO error_log (source, message, detail, path, user_id) VALUES (?, ?, ?, ?, ?)')
      .run(source, clip(scrub(message), 500) || 'Ошибка', clip(scrub(detail), 4000), clip(path, 300), userId ?? null);
    // Журнал не растёт бесконечно: храним последние 2000 записей
    realContext().db.prepare('DELETE FROM error_log WHERE id < (SELECT MAX(id) - 2000 FROM error_log)').run();
  } catch (e) {
    console.error('[error-log]', e.message);
  }
}

export function listErrors(limit = 100) {
  return realContext().db.prepare('SELECT * FROM error_log ORDER BY id DESC LIMIT ?').all(limit);
}

export function adminLog(adminId, action, target = null, detail = null) {
  realContext().db
    .prepare('INSERT INTO admin_log (admin_id, action, target, detail) VALUES (?, ?, ?, ?)')
    .run(adminId, action, clip(target, 200), clip(detail, 1000));
}

// Лимит частоты: не больше max событий за windowMs на ключ
const buckets = new Map();
export function rateLimit(key, max, windowMs, message = 'Слишком часто. Попробуйте чуть позже.') {
  const t = Date.now();
  const list = (buckets.get(key) || []).filter((x) => t - x < windowMs);
  if (list.length >= max) throw new HttpError(429, message);
  list.push(t);
  buckets.set(key, list);
  if (buckets.size > 20000) buckets.clear();
}
