// РОСТ: уровни тестировщиков, реферальная программа, источники регистраций.
import { one, all, run } from '../db.js';
import { config } from '../config.js';
import { randomCode } from '../util.js';
import { platformBonus } from './economy.js';
import { notify } from './notifications.js';

// ---------- Уровни ----------
// Уровень зависит только от проверенной работы: сколько ответов одобрено, средняя оценка качества
// и доля отклонённых. Студия может открыть задание только для опытных тестировщиков (min_level).
export const LEVELS = [
  { level: 0, name: 'Новичок', approved: 0, avgScore: 0, maxRejectRate: 100 },
  { level: 1, name: 'Тестировщик', approved: 1, avgScore: 0, maxRejectRate: 100 },
  { level: 2, name: 'Опытный', approved: 5, avgScore: 60, maxRejectRate: 40 },
  { level: 3, name: 'Эксперт', approved: 15, avgScore: 70, maxRejectRate: 25 },
  { level: 4, name: 'Мастер', approved: 40, avgScore: 75, maxRejectRate: 20 },
];
export const levelName = (n) => LEVELS[Math.max(0, Math.min(LEVELS.length - 1, n | 0))].name;
// Сколько ответов в день можно отправить: базовый лимит + 5 за каждый уровень
export const dailyLimitFor = (level) => config.economy.dailySubmissionLimit + 5 * level;

export function testerLevel(userId) {
  const r = one(
    `SELECT SUM(status = 'approved') AS ok, SUM(status = 'rejected') AS rej,
            AVG(CASE WHEN status IN ('approved', 'rejected') THEN auto_score END) AS avg
     FROM assignments WHERE user_id = ?`,
    userId
  );
  const approved = r.ok || 0;
  const rejected = r.rej || 0;
  const avgScore = r.avg == null ? null : Math.round(r.avg);
  const rejectRate = approved + rejected ? Math.round((rejected / (approved + rejected)) * 100) : 0;
  const fits = (L) => approved >= L.approved && (L.avgScore === 0 || (avgScore ?? 0) >= L.avgScore) && rejectRate <= L.maxRejectRate;
  let level = 0;
  for (const L of LEVELS) if (fits(L)) level = L.level;
  const next = LEVELS[level + 1] || null;
  return {
    level,
    name: LEVELS[level].name,
    approved,
    rejected,
    avgScore,
    rejectRate,
    dailyLimit: dailyLimitFor(level),
    next: next && {
      level: next.level,
      name: next.name,
      approvedLeft: Math.max(0, next.approved - approved),
      avgScoreNeed: next.avgScore || null,
      maxRejectRate: next.maxRejectRate < 100 ? next.maxRejectRate : null,
      progress: Math.min(100, Math.round((approved / next.approved) * 100)),
    },
  };
}

// ---------- Реферальная программа ----------
// Пригласивший получает бонус, когда друг: 1) подтвердил Telegram (1 Telegram = 1 аккаунт) и
// 2) получил первое одобренное задание. Бонус платит платформа из своих комиссий (platformBonus):
// если на счёте платформы нет средств, бонус не начисляется — баллы не «печатаются».

export function ensureRefCode(userId) {
  const u = one('SELECT ref_code FROM users WHERE id = ?', userId);
  if (u?.ref_code) return u.ref_code;
  for (let i = 0; i < 5; i++) {
    const code = randomCode(7);
    if (!one('SELECT id FROM users WHERE ref_code = ?', code)) {
      run('UPDATE users SET ref_code = ? WHERE id = ?', code, userId);
      return code;
    }
  }
  throw new Error('Не удалось создать реферальный код');
}

export function findReferrer(code) {
  const c = String(code || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{4,16}$/.test(c)) return null;
  return one("SELECT id FROM users WHERE ref_code = ? AND role = 'user' AND blocked_at IS NULL AND deleted_at IS NULL", c) || null;
}

/** Источник регистрации: utm_source / ref / invite — только безопасные символы */
export function cleanSource(s) {
  const v = String(s || '').trim().toLowerCase().replace(/[^a-z0-9_.:-]/g, '').slice(0, 40);
  return v || null;
}

/** Проверить условия и выплатить бонус пригласившему (вызывается после одобрения и после привязки Telegram) */
export function maybeReferralBonus(userId) {
  const u = one('SELECT id, name, referred_by, telegram_verified_at FROM users WHERE id = ?', userId);
  if (!u?.referred_by || !u.telegram_verified_at) return 0;
  if (!one("SELECT id FROM assignments WHERE user_id = ? AND status = 'approved' LIMIT 1", userId)) return 0;
  if (one("SELECT id FROM transactions WHERE type = 'bonus' AND ref_type = 'referral' AND ref_id = ? LIMIT 1", userId)) return 0;
  const amount = config.referralBonus;
  if (!(amount > 0)) return 0;
  const paid = platformBonus({ userId: u.referred_by, amount, title: `Друг ${u.name} выполнил первое задание`, refType: 'referral', refId: userId });
  if (paid)
    notify(u.referred_by, {
      kind: 'reward',
      title: `+${paid} AB за приглашение`,
      body: `${u.name} выполнил(а) первое задание по вашей ссылке.`,
      link: '/#/profile',
    });
  return paid;
}

export function referralStats(userId) {
  const code = ensureRefCode(userId);
  const invited = all('SELECT id, telegram_verified_at FROM users WHERE referred_by = ?', userId);
  const active = invited.length
    ? one(`SELECT COUNT(DISTINCT user_id) AS n FROM assignments WHERE status = 'approved' AND user_id IN (${invited.map(() => '?').join(',')})`, ...invited.map((i) => i.id)).n
    : 0;
  const earned = one("SELECT COALESCE(SUM(amount), 0) AS v FROM transactions WHERE user_id = ? AND type = 'bonus' AND ref_type = 'referral'", userId).v;
  return {
    code,
    link: `${config.publicUrl}/r/${code}`,
    invited: invited.length,
    verified: invited.filter((i) => i.telegram_verified_at).length,
    active,
    earned,
    bonus: config.referralBonus,
  };
}

/** Маркетинговая сводка для администратора: откуда приходят и доходят ли до первого задания */
export function acquisition() {
  const rows = all(
    `SELECT COALESCE(signup_source, 'прямой заход') AS source, role, COUNT(*) AS signups,
            SUM(EXISTS (SELECT 1 FROM assignments a WHERE a.user_id = u.id AND a.status = 'approved')) AS activated
     FROM users u WHERE role IN ('user', 'company') AND is_admin = 0 GROUP BY source, role ORDER BY signups DESC LIMIT 50`
  );
  const days = all(
    `SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS n FROM users
     WHERE role IN ('user', 'company') AND is_admin = 0 AND created_at >= ? GROUP BY day ORDER BY day`,
    new Date(Date.now() - 13 * 864e5).toISOString().slice(0, 10)
  );
  return {
    sources: rows,
    signupsByDay: days,
    referrals: one('SELECT COUNT(*) AS n FROM users WHERE referred_by IS NOT NULL').n,
    referralBonusesPaid: one("SELECT COALESCE(SUM(amount), 0) AS v FROM transactions WHERE type = 'bonus' AND ref_type = 'referral'").v,
  };
}
