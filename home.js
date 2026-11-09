// Главная участника (Rewards-first) и лента активности.
import { one, all } from '../db.js';
import { parseJson } from '../util.js';
import { listTasksForUser, mySubmissions } from './campaigns.js';
import { listRewards, rewardView } from './rewards.js';
import { verifyLedger } from './ledger.js';
import { FLAG_INFO, userTrust } from './verification.js';
import { userStats } from './stats.js';

const TX_KIND = {
  task_reward: 'reward',
  bonus: 'bonus',
  redemption: 'redemption',
  deposit: 'deposit',
  campaign_reserve: 'reserve',
  campaign_refund: 'refund',
  platform_fee: 'fee',
  reward_sale: 'sale',
  payout: 'payout',
  bonus_paid: 'fee',
};

/**
 * Лента активности: начисления, списания, отправленные и отклонённые ответы.
 * Одобрение показывается одной строкой — транзакцией начисления (без дублей).
 */
export function activity(userId, limit = 100) {
  const txs = all('SELECT * FROM transactions WHERE user_id = ? ORDER BY id DESC LIMIT ?', userId, limit).map((t) => ({
    id: `t${t.id}`,
    kind: TX_KIND[t.type] || t.type,
    title: t.title,
    amount: t.amount,
    balanceAfter: t.balance_after,
    at: t.created_at,
    link: t.ref_type === 'assignment' ? null : t.ref_type === 'redemption' ? '/rewards' : null,
  }));
  const subs = all(
    `SELECT a.*, c.title, c.reward FROM assignments a JOIN campaigns c ON c.id = a.campaign_id
     WHERE a.user_id = ? AND a.submitted_at IS NOT NULL ORDER BY a.submitted_at DESC LIMIT ?`,
    userId,
    limit
  );
  const events = [];
  for (const s of subs) {
    events.push({
      id: `s${s.id}`,
      kind: 'submitted',
      title: `Ответ отправлен: ${s.title}`,
      detail: `Оценка автопроверки ${s.auto_score}/100`,
      at: s.submitted_at,
      link: `/tasks/${s.campaign_id}`,
    });
    if (s.status === 'rejected')
      events.push({
        id: `r${s.id}`,
        kind: 'rejected',
        title: `Ответ не принят: ${s.title}`,
        detail: s.review_note || parseJson(s.auto_flags, []).map((f) => FLAG_INFO[f]?.label).filter(Boolean).join(', '),
        at: s.reviewed_at,
        link: `/tasks/${s.campaign_id}`,
      });
  }
  return [...txs, ...events].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)).slice(0, limit);
}

/** Задания, которые быстрее всего приведут к цели (жадно по награде, только реально доступные) */
function pathToGoal(tasks, need, user) {
  const open = tasks.filter((t) => !t.my && t.slotsLeft > 0).sort((a, b) => b.reward - a.reward);
  const path = [];
  let sum = 0;
  for (const t of open) {
    if (sum >= need) break;
    // Задания, требующие Telegram, тоже показываем — с честной пометкой, что нужно сделать
    path.push({ id: t.id, title: t.title, reward: t.reward, estMinutes: t.estMinutes, company: t.company, needsTelegram: t.requireTelegram && !user.telegram_verified_at });
    sum += t.reward;
  }
  return { tasks: path, covers: sum >= need, total: sum };
}

export function home(user) {
  const fresh = one('SELECT * FROM users WHERE id = ?', user.id);
  const tasks = listTasksForUser(fresh);
  const rewards = listRewards(fresh);

  let goal = null;
  if (fresh.goal_reward_id) {
    const g = one(
      `SELECT r.*, u.company_name, u.is_demo AS company_demo, (SELECT COUNT(*) FROM redemptions x WHERE x.reward_id = r.id) AS redeemed
       FROM rewards r LEFT JOIN users u ON u.id = r.company_id WHERE r.id = ? AND r.active = 1`,
      fresh.goal_reward_id
    );
    if (g) {
      const v = rewardView(g, fresh.balance);
      goal = { reward: v, path: v.need > 0 ? pathToGoal(tasks, v.need, fresh) : { tasks: [], covers: true, total: 0 } };
    }
  }

  // Рекомендуемая награда: цель → самая популярная → самая доступная. Без выдуманных метрик.
  const inStock = rewards.filter((r) => r.stock > 0);
  const featured =
    goal?.reward || [...inStock].sort((a, b) => b.redeemed - a.redeemed || a.cost - b.cost)[0] || null;

  // Сначала награды, к которым человек ближе всего, но ещё не набрал
  const shelf = [...inStock]
    .filter((r) => !featured || r.id !== featured.id)
    .sort((a, b) => a.need - b.need || a.cost - b.cost)
    .slice(0, 4);

  const subs = mySubmissions(fresh.id);
  return {
    balance: fresh.balance,
    goal,
    featured,
    rewards: shelf,
    tasks: tasks.filter((t) => !t.my && t.matches).slice(0, 3),
    totalOpenTasks: tasks.filter((t) => !t.my).length,
    activity: activity(fresh.id, 5),
    stats: {
      trust: userTrust(fresh.id),
      approved: subs.filter((s) => s.status === 'approved').length,
      pending: subs.filter((s) => s.status === 'submitted').length,
      earned: one("SELECT COALESCE(SUM(amount),0) AS n FROM transactions WHERE user_id = ? AND amount > 0", fresh.id).n,
    },
    integrity: verifyLedger(fresh.id),
    // Кратко для главной: вчера/позавчера, серия, челлендж (подробно — /api/me/stats)
    pulse: (() => {
      const s = userStats(fresh.id, 7);
      return { today: s.today.earned, yesterday: s.yesterday.earned, dayBefore: s.dayBefore.earned, week: s.week, days: s.days, streak: s.streak, challenge: s.challenge };
    })(),
  };
}

/** Выгрузка всех своих данных (право человека знать, что о нём хранится) */
export function exportUserData(userId) {
  const u = one('SELECT * FROM users WHERE id = ?', userId);
  return {
    exportedAt: new Date().toISOString(),
    profile: {
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      companyName: u.company_name,
      interests: parseJson(u.interests, []),
      telegramLinked: !!u.telegram_chat_id,
      telegramUsername: u.telegram_username,
      notifyTelegram: !!u.notify_telegram,
      consentAt: u.consent_at,
      createdAt: u.created_at,
    },
    balance: u.balance,
    transactions: all('SELECT amount, type, title, balance_after, created_at FROM transactions WHERE user_id = ? ORDER BY id', userId),
    submissions: all(
      `SELECT c.title AS campaign, a.status, a.started_at, a.submitted_at, a.answers, a.auto_score, a.quality_rating, a.review_note
       FROM assignments a JOIN campaigns c ON c.id = a.campaign_id WHERE a.user_id = ? ORDER BY a.id`,
      userId
    ).map((r) => ({ ...r, answers: parseJson(r.answers, null) })),
    redemptions: all(
      'SELECT r.title AS reward, x.code, x.cost, x.created_at FROM redemptions x JOIN rewards r ON r.id = x.reward_id WHERE x.user_id = ? ORDER BY x.id',
      userId
    ),
    notifications: all('SELECT title, body, created_at, read_at FROM notifications WHERE user_id = ? ORDER BY id', userId),
  };
}
