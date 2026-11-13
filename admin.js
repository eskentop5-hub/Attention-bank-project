// АДМИНИСТРАТОР ПЛАТФОРМЫ: деньги (пополнения и выводы), пользователи, модерация кампаний, ошибки, копии базы.
// Все действия пишутся в admin_log. Работает только с настоящей базой.
import { one, all, run, tx, now } from '../db.js';
import { config } from '../config.js';
import { bad, notFound, forbidden } from '../util.js';
import { hashPassword, verifyPassword } from './auth.js';
import { treasury } from './economy.js';
import { verifyAllLedgers } from './ledger.js';
import { adminLog, listErrors } from './ops.js';
import { testerLevel } from './growth.js';
import { backupStatus } from './backup.js';
import { demoInfo } from '../demo.js';
import { emailEnabled } from './mail.js';
import { telegramEnabled } from '../telegram/api.js';
import { notify } from './notifications.js';

// Почему администратор не создан (показывается на /api/health и при попытке входа с адресом админа)
let adminProblem = null;
export const adminSetupProblem = () => adminProblem;

/** При запуске: создать/обновить администратора из ADMIN_EMAIL и ADMIN_PASSWORD */
export function ensureAdmin() {
  const { email, password } = config.admin;
  adminProblem = null;
  if (!email) {
    adminProblem = 'ADMIN_EMAIL не задан';
    return null;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    adminProblem = 'ADMIN_EMAIL некорректный';
    console.error('[admin] ADMIN_EMAIL некорректный');
    return null;
  }
  const u = one('SELECT * FROM users WHERE email = ?', email);
  const passwordOk = !!password && password.length >= 10;
  if (!passwordOk && !u?.is_admin) {
    // Без надёжного пароля администратора не создаём и НЕ повышаем существующий аккаунт с этим email
    // (иначе любой, кто зарегистрировался с адресом админа, получил бы права администратора).
    adminProblem = 'ADMIN_PASSWORD короче 10 символов';
    console.error('[admin] ADMIN_PASSWORD должен быть не короче 10 символов — администратор не создан');
    return null;
  }
  if (!u) {
    run(
      "INSERT INTO users (email, password_hash, name, role, is_admin, consent_at) VALUES (?, ?, 'Администратор', 'user', 1, ?)",
      email, hashPassword(password), now()
    );
    console.log('[admin] создан администратор', email);
  } else {
    if (u.role === 'system') return null;
    // Пароль из настроек — источник правды: если его поменяли в настройках хостинга, он обновится
    if (passwordOk && !verifyPassword(password, u.password_hash)) {
      run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(password), u.id);
      run('DELETE FROM sessions WHERE user_id = ?', u.id);
    }
    if (!u.is_admin) run('UPDATE users SET is_admin = 1 WHERE id = ?', u.id);
  }
  return one('SELECT id FROM users WHERE email = ?', email).id;
}

export function overview() {
  const c = one(`SELECT
    (SELECT COUNT(*) FROM users WHERE role = 'user' AND is_admin = 0 AND deleted_at IS NULL) AS users,
    (SELECT COUNT(*) FROM users WHERE role = 'company') AS companies,
    (SELECT COUNT(*) FROM users WHERE created_at >= ? AND role IN ('user','company') AND is_admin = 0) AS signups7d,
    (SELECT COUNT(*) FROM campaigns WHERE status = 'active') AS activeCampaigns,
    (SELECT COUNT(*) FROM assignments WHERE status = 'approved') AS approved,
    (SELECT COUNT(*) FROM assignments WHERE status = 'submitted') AS pendingReviews,
    (SELECT COUNT(*) FROM topups WHERE status = 'requested') AS pendingTopups,
    (SELECT COUNT(*) FROM payouts WHERE status = 'requested') AS pendingPayouts,
    (SELECT COUNT(*) FROM rewards WHERE active = 1) AS activeRewards,
    (SELECT COUNT(*) FROM redemptions) AS redemptions`,
    new Date(Date.now() - 7 * 864e5).toISOString()
  );
  const errors24h = one("SELECT COUNT(*) AS n FROM error_log WHERE created_at >= ?", new Date(Date.now() - 864e5).toISOString()).n;
  return {
    counts: c,
    errors24h,
    treasury: treasury(),
    ledger: verifyAllLedgers().ok,
    services: { telegram: telegramEnabled(), email: emailEnabled(), backup: backupStatus(), demo: demoInfo() },
    dbPath: config.dbPath,
  };
}

export function listUsers({ q = '', role = '' } = {}) {
  const like = `%${String(q).trim().toLowerCase()}%`;
  const rows = all(
    `SELECT id, email, name, role, company_name, balance, is_admin, blocked_at, deleted_at, telegram_chat_id IS NOT NULL AS tg,
            signup_source, referred_by, created_at
     FROM users WHERE role != 'system' AND (? = '' OR role = ?)
       AND (lower(email) LIKE ? OR lower(name) LIKE ? OR lower(COALESCE(company_name, '')) LIKE ?)
     ORDER BY id DESC LIMIT 200`,
    role, role, like, like, like
  );
  return rows.map((u) => ({
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    company: u.company_name,
    balance: u.balance,
    isAdmin: !!u.is_admin,
    blocked: !!u.blocked_at,
    deleted: !!u.deleted_at,
    telegram: !!u.tg,
    source: u.signup_source,
    referred: !!u.referred_by,
    level: u.role === 'user' ? testerLevel(u.id).name : null,
    createdAt: u.created_at,
  }));
}

export function setBlocked(admin, userId, blocked, reason = '') {
  const u = one('SELECT * FROM users WHERE id = ?', userId);
  if (!u || u.role === 'system') throw notFound('Пользователь не найден');
  if (u.is_admin) throw forbidden('Администратора заблокировать нельзя');
  return tx(() => {
    run('UPDATE users SET blocked_at = ? WHERE id = ?', blocked ? now() : null, userId);
    if (blocked) run('DELETE FROM sessions WHERE user_id = ?', userId);
    adminLog(admin.id, blocked ? 'block' : 'unblock', `user:${userId}`, String(reason || '').slice(0, 300));
    return { ok: true };
  });
}

export function listCampaigns() {
  return all(
    `SELECT c.id, c.title, c.status, c.reward, c.max_participants, c.reserved, c.created_at, u.company_name,
            (SELECT COUNT(*) FROM assignments a WHERE a.campaign_id = c.id AND a.status = 'approved') AS approved,
            (SELECT COUNT(*) FROM assignments a WHERE a.campaign_id = c.id AND a.status = 'submitted') AS pending
     FROM campaigns c JOIN users u ON u.id = c.company_id ORDER BY c.status = 'active' DESC, c.id DESC LIMIT 200`
  ).map((c) => ({ ...c, company: c.company_name }));
}

/** Модерация: приостановить или вернуть кампанию (деньги не двигаются) */
export function moderateCampaign(admin, id, status, reason = '') {
  if (!['active', 'paused'].includes(status)) throw bad('Можно только приостановить или возобновить');
  const c = one('SELECT * FROM campaigns WHERE id = ?', id);
  if (!c) throw notFound('Кампания не найдена');
  if (c.status === 'closed') throw bad('Кампания уже закрыта');
  run('UPDATE campaigns SET status = ? WHERE id = ?', status, id);
  adminLog(admin.id, `campaign_${status}`, `campaign:${id}`, String(reason || '').slice(0, 300));
  if (status === 'paused')
    notify(c.company_id, { kind: 'info', title: 'Кампания приостановлена модератором', body: `«${c.title}»${reason ? `: ${reason}` : ''}`, link: `/#/company/campaigns/${id}` });
  return { ok: true };
}

export const errors = () => listErrors(150);
export const actions = () =>
  all('SELECT l.*, u.email AS admin_email FROM admin_log l LEFT JOIN users u ON u.id = l.admin_id ORDER BY l.id DESC LIMIT 150');
