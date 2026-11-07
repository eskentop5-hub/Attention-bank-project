// Личная статистика участника, серия заходов 🔥 и ежедневный челлендж.
// Все цифры считаются из реальных таблиц (transactions, assignments, user_visits) — ничего не выдумывается.
import { one, all, run } from '../db.js';
import { config } from '../config.js';

const DAY = 864e5;
const shift = () => config.tzOffsetMin * 60e3;
/** Ключ дня YYYY-MM-DD в часовом поясе платформы */
export const dayKey = (t = Date.now()) => new Date(new Date(t).getTime() + shift()).toISOString().slice(0, 10);
/** Начало дня (UTC ISO) по ключу дня */
const dayStartIso = (key) => new Date(Date.parse(key + 'T00:00:00Z') - shift()).toISOString();
const addDays = (key, n) => new Date(Date.parse(key + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10);

/** Отметить заход (один раз в день, повторы игнорируются) */
export function recordVisit(userId) {
  run('INSERT OR IGNORE INTO user_visits (user_id, day) VALUES (?, ?)', userId, dayKey());
}

/** Серия: сколько дней подряд человек заходит (сегодня или со вчерашнего дня включительно) */
export function streak(userId) {
  const days = new Set(all('SELECT day FROM user_visits WHERE user_id = ? ORDER BY day DESC LIMIT 400', userId).map((r) => r.day));
  const today = dayKey();
  let cur = 0;
  let d = days.has(today) ? today : addDays(today, -1);
  while (days.has(d)) {
    cur++;
    d = addDays(d, -1);
  }
  // Лучшая серия за всё время
  const sorted = [...days].sort();
  let best = 0, run_ = 0, prev = null;
  for (const k of sorted) {
    run_ = prev && addDays(prev, 1) === k ? run_ + 1 : 1;
    best = Math.max(best, run_);
    prev = k;
  }
  const week = Array.from({ length: 7 }, (_, i) => {
    const k = addDays(today, i - 6);
    return { day: k, visited: days.has(k) };
  });
  return { current: cur, best, today: days.has(today), week };
}

/** Ежедневный челлендж: сколько заданий отправлено сегодня */
export function dailyChallenge(userId) {
  const done = one('SELECT COUNT(*) AS n FROM assignments WHERE user_id = ? AND submitted_at >= ?', userId, dayStartIso(dayKey())).n;
  return { goal: config.dailyChallenge, done, complete: done >= config.dailyChallenge };
}

/** Полная статистика для страницы «Статистика» */
export function userStats(userId, days = 14) {
  const today = dayKey();
  const from = addDays(today, -(days - 1));
  const txs = all('SELECT amount, type, created_at FROM transactions WHERE user_id = ? AND created_at >= ?', userId, dayStartIso(from));
  const subs = all(
    `SELECT a.status, a.started_at, a.submitted_at, a.reviewed_at, c.category, c.reward
     FROM assignments a JOIN campaigns c ON c.id = a.campaign_id WHERE a.user_id = ? AND a.submitted_at IS NOT NULL`,
    userId
  );
  const series = Array.from({ length: days }, (_, i) => ({ day: addDays(from, i), earned: 0, spent: 0, tasks: 0 }));
  const byDay = Object.fromEntries(series.map((s) => [s.day, s]));
  for (const t of txs) {
    const s = byDay[dayKey(Date.parse(t.created_at))];
    if (!s) continue;
    if (t.amount > 0 && (t.type === 'task_reward' || t.type === 'bonus')) s.earned += t.amount;
    if (t.type === 'redemption') s.spent += -t.amount;
  }
  for (const a of subs) {
    const s = byDay[dayKey(Date.parse(a.submitted_at))];
    if (s) s.tasks++;
  }
  const totals = one(
    `SELECT COALESCE(SUM(CASE WHEN amount > 0 AND type IN ('task_reward','bonus') THEN amount END), 0) AS earned,
            COALESCE(SUM(CASE WHEN type = 'redemption' THEN -amount END), 0) AS spent
     FROM transactions WHERE user_id = ?`,
    userId
  );
  const approved = subs.filter((a) => a.status === 'approved');
  const rejected = subs.filter((a) => a.status === 'rejected').length;
  const pending = subs.filter((a) => a.status === 'submitted').length;
  const minutes = subs.map((a) => (Date.parse(a.submitted_at) - Date.parse(a.started_at)) / 60e3).filter((m) => m > 0 && m < 600);
  const totalMin = minutes.reduce((s, m) => s + m, 0);
  const byCategory = {};
  for (const a of approved) byCategory[a.category] = (byCategory[a.category] || 0) + a.reward;
  const best = series.reduce((b, s) => (s.earned > (b?.earned || 0) ? s : b), null);
  const at = (k) => byDay[k] || { earned: 0, spent: 0, tasks: 0 };
  return {
    days: series,
    today: at(today),
    yesterday: at(addDays(today, -1)),
    dayBefore: at(addDays(today, -2)),
    week: series.slice(-7).reduce((s, d) => s + d.earned, 0),
    prevWeek: series.slice(-14, -7).reduce((s, d) => s + d.earned, 0),
    totalEarned: totals.earned,
    totalSpent: totals.spent,
    bestDay: best && best.earned > 0 ? best : null,
    approved: approved.length,
    rejected,
    pending,
    approvalRate: approved.length + rejected ? Math.round((approved.length / (approved.length + rejected)) * 100) : null,
    avgMinutes: minutes.length ? Math.round((totalMin / minutes.length) * 10) / 10 : null,
    // Сколько AB приносит час внимания — главная метрика «обмена»
    abPerHour: totalMin > 0 ? Math.round((approved.reduce((s, a) => s + a.reward, 0) / totalMin) * 60) : null,
    byCategory,
    streak: streak(userId),
    challenge: dailyChallenge(userId),
  };
}
