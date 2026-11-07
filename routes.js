// REST API ATTENTION BANK
import { config } from './config.js';
import { one, all, run } from './db.js';
import { bad, forbidden, HttpError, str, email as cleanEmail, int } from './util.js';
import { CATEGORIES, INTERESTS, REWARD_CATEGORIES, QUESTION_TYPE_LABELS, cleanInterests } from './catalog.js';
import { home, activity, exportUserData } from './services/home.js';
import * as auth from './services/auth.js';
import { postTransaction, listTransactions, verifyLedger, verifyAllLedgers } from './services/ledger.js';
import * as campaigns from './services/campaigns.js';
import * as rewards from './services/rewards.js';
import { listNotifications, unreadCount, markAllRead } from './services/notifications.js';
import { createLinkCode, unlinkTelegram, handleUpdate, webhookSecretToken } from './telegram/bot.js';
import { telegramEnabled } from './telegram/api.js';
import { AUTO_APPROVE_SCORE, AUTO_REJECT_SCORE, FLAG_INFO } from './services/verification.js';

const routes = [];
const add = (method, path, opts, handler) => {
  if (typeof opts === 'function') [handler, opts] = [opts, {}];
  const keys = [];
  const re = new RegExp('^' + path.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '$');
  routes.push({ method, re, keys, handler, ...opts });
};
const GET = (...a) => add('GET', ...a);
const POST = (...a) => add('POST', ...a);
const PUT = (...a) => add('PUT', ...a);

export function match(method, pathname) {
  for (const r of routes) {
    if (r.method !== method) continue;
    const m = pathname.match(r.re);
    if (m) return { route: r, params: Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) };
  }
  return null;
}

const need = (ctx, role) => {
  if (!ctx.user) throw new HttpError(401, 'Войдите в аккаунт');
  if (role && ctx.user.role !== role) throw forbidden(role === 'company' ? 'Доступно только компаниям' : 'Доступно только участникам');
  return ctx.user;
};
const id = (v) => int(v, { field: 'id', min: 1 });

// ---------- Публичное ----------

GET('/api/meta', () => ({
  demoMode: config.demoMode,
  categories: CATEGORIES,
  rewardCategories: REWARD_CATEGORIES,
  questionTypes: QUESTION_TYPE_LABELS,
  interests: INTERESTS,
  economy: {
    platformFeePercent: config.economy.platformFeePercent,
    abToKzt: config.economy.abToKzt,
    dailySubmissionLimit: config.economy.dailySubmissionLimit,
  },
  verification: { autoApproveScore: AUTO_APPROVE_SCORE, autoRejectScore: AUTO_REJECT_SCORE, flags: FLAG_INFO },
  telegram: { enabled: telegramEnabled(), botUsername: config.telegram.username || null, verifyBonus: config.telegram.verifyBonus },
}));

GET('/api/stats', () => {
  const s = one(`SELECT
    (SELECT COUNT(*) FROM users WHERE role = 'user') AS users,
    (SELECT COUNT(*) FROM users WHERE role = 'company') AS companies,
    (SELECT COUNT(*) FROM campaigns WHERE status = 'active') AS activeCampaigns,
    (SELECT COUNT(*) FROM assignments WHERE status = 'approved') AS verifiedResults,
    (SELECT COALESCE(SUM(amount), 0) FROM transactions WHERE type = 'task_reward') AS paidOut`);
  return s;
});

// Реальные награды каталога для главной страницы (без входа)
GET('/api/public/rewards', () => ({ rewards: rewards.publicRewards(6), demoMode: config.demoMode }));

GET('/api/health', () => ({ ok: true, ledger: verifyAllLedgers().ok, telegram: telegramEnabled() }));

// ---------- Аутентификация ----------

POST('/api/auth/register', (ctx) => {
  const b = ctx.body;
  const role = b.role === 'company' ? 'company' : 'user';
  const email = cleanEmail(b.email);
  const password = str(b.password, { field: 'Пароль', min: 8, max: 200 });
  const name = str(b.name, { field: 'Имя', min: 2, max: 80 });
  const companyName = role === 'company' ? str(b.companyName, { field: 'Название компании', min: 2, max: 120 }) : null;
  if (!b.consent) throw bad('Нужно согласие на обработку данных');
  if (role === 'user' && !b.ageConfirmed) throw bad('Платформа доступна с 16 лет. Подтвердите возраст.');
  if (one('SELECT id FROM users WHERE email = ?', email)) throw bad('Аккаунт с таким email уже есть');
  const r = run(
    'INSERT INTO users (email, password_hash, name, role, company_name, consent_at) VALUES (?, ?, ?, ?, ?, ?)',
    email, auth.hashPassword(password), name, role, companyName, new Date().toISOString()
  );
  const user = one('SELECT * FROM users WHERE id = ?', Number(r.lastInsertRowid));
  const s = auth.createSession(user.id);
  ctx.setCookie(auth.sessionCookie(s.token, s.expires));
  return { user: auth.publicUser(user) };
});

POST('/api/auth/login', (ctx) => {
  const email = cleanEmail(ctx.body.email);
  const key = `${ctx.ip}|${email}`;
  auth.checkLoginRate(key);
  const user = one('SELECT * FROM users WHERE email = ?', email);
  if (!user || user.role === 'system' || !auth.verifyPassword(String(ctx.body.password || ''), user.password_hash))
    throw bad('Неверный email или пароль');
  auth.resetLoginRate(key);
  const s = auth.createSession(user.id);
  ctx.setCookie(auth.sessionCookie(s.token, s.expires));
  return { user: auth.publicUser(user) };
});

POST('/api/auth/logout', (ctx) => {
  auth.destroySession(ctx.token);
  ctx.setCookie(auth.sessionCookie(null));
  return { ok: true };
});

GET('/api/me', (ctx) => {
  if (!ctx.user) return { user: null };
  return { user: auth.publicUser(ctx.user), unread: unreadCount(ctx.user.id) };
});

// Обновление профиля. Баланс, роль, Telegram — НЕ меняются отсюда, даже если клиент их пришлёт.
PUT('/api/me', (ctx) => {
  const u = need(ctx);
  const name = ctx.body.name !== undefined ? str(ctx.body.name, { field: 'Имя', min: 2, max: 80 }) : u.name;
  const interests = ctx.body.interests !== undefined ? cleanInterests(ctx.body.interests) : JSON.parse(u.interests);
  const notifyTelegram = ctx.body.notifyTelegram !== undefined ? (ctx.body.notifyTelegram ? 1 : 0) : u.notify_telegram;
  run('UPDATE users SET name = ?, interests = ?, notify_telegram = ? WHERE id = ?', name, JSON.stringify(interests), notifyTelegram, u.id);
  return { user: auth.publicUser(one('SELECT * FROM users WHERE id = ?', u.id)) };
});

// Выгрузка всех своих данных одним JSON-файлом
GET('/api/me/export', { raw: true }, (ctx) => {
  const u = need(ctx);
  ctx.res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Disposition': `attachment; filename="attention-bank-my-data-${u.id}.json"`,
    'Cache-Control': 'no-store',
  });
  ctx.res.end(JSON.stringify(exportUserData(u.id), null, 2));
});

// Главная участника: баланс, цель, награды, задания, активность — одним запросом
GET('/api/home', (ctx) => home(need(ctx, 'user')));

// Цель — награда, к которой участник копит
PUT('/api/me/goal', (ctx) => rewards.setGoal(need(ctx, 'user'), ctx.body.rewardId ?? null));

// Лента активности
GET('/api/activity', (ctx) => {
  const u = need(ctx);
  const fresh = one('SELECT balance FROM users WHERE id = ?', u.id);
  return { balance: fresh.balance, items: activity(u.id, 200), integrity: verifyLedger(u.id) };
});

// ---------- Задания (участник) ----------

GET('/api/tasks', (ctx) => ({ tasks: campaigns.listTasksForUser(need(ctx, 'user')) }));
GET('/api/tasks/:id', (ctx) => ({ task: campaigns.getTaskForUser(need(ctx, 'user'), id(ctx.params.id)) }));
POST('/api/tasks/:id/start', (ctx) => ({ task: campaigns.startTask(need(ctx, 'user'), id(ctx.params.id)) }));
POST('/api/tasks/:id/submit', { idempotent: true }, (ctx) => campaigns.submitTask(need(ctx, 'user'), id(ctx.params.id), ctx.body.answers));
GET('/api/my/submissions', (ctx) => ({ submissions: campaigns.mySubmissions(need(ctx, 'user').id) }));

// ---------- Кошелёк и транзакции ----------

GET('/api/wallet', (ctx) => {
  const u = need(ctx);
  const fresh = one('SELECT balance FROM users WHERE id = ?', u.id);
  return { balance: fresh.balance, transactions: listTransactions(u.id), integrity: verifyLedger(u.id) };
});

// ---------- Награды ----------

GET('/api/rewards', (ctx) => {
  need(ctx);
  return {
    rewards: rewards.listRewards(ctx.user.role === 'user' ? ctx.user : null),
    mine: ctx.user.role === 'user' ? rewards.myRedemptions(ctx.user.id) : [],
    goalRewardId: ctx.user.goal_reward_id ?? null,
  };
});
GET('/api/rewards/:id', (ctx) => {
  const u = need(ctx);
  const reward = rewards.getReward(u, id(ctx.params.id));
  // Задания, которые помогут накопить на эту награду
  const tasks = u.role === 'user' ? campaigns.listTasksForUser(u).filter((t) => !t.my && t.slotsLeft > 0).slice(0, 4) : [];
  return { reward, tasks };
});
POST('/api/rewards/:id/redeem', { idempotent: true }, (ctx) => rewards.redeem(need(ctx, 'user'), id(ctx.params.id)));

// Картинки наград (загружают компании)
POST('/api/images', { maxBody: 2_200_000 }, (ctx) => rewards.uploadImage(need(ctx, 'company'), ctx.body));
GET('/api/images/:id', { raw: true }, (ctx) => {
  const img = rewards.getImage(id(ctx.params.id));
  if (!img) throw new HttpError(404, 'Картинка не найдена');
  ctx.res.writeHead(200, {
    'Content-Type': img.mime,
    'Cache-Control': 'public, max-age=31536000, immutable',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
  });
  ctx.res.end(Buffer.from(img.data));
});

// ---------- Уведомления ----------

GET('/api/notifications', (ctx) => {
  const u = need(ctx);
  return { notifications: listNotifications(u.id), unread: unreadCount(u.id) };
});
POST('/api/notifications/read', (ctx) => {
  markAllRead(need(ctx).id);
  return { ok: true };
});

// ---------- Telegram ----------

POST('/api/telegram/link-code', (ctx) => createLinkCode(need(ctx).id));
POST('/api/telegram/unlink', (ctx) => {
  unlinkTelegram(need(ctx).id);
  return { ok: true };
});
POST('/api/telegram/webhook', { public: true }, async (ctx) => {
  if (ctx.req.headers['x-telegram-bot-api-secret-token'] !== webhookSecretToken()) throw forbidden();
  await handleUpdate(ctx.body);
  return { ok: true };
});

// ---------- Кабинет компании ----------

GET('/api/company/overview', (ctx) => {
  const c = need(ctx, 'company');
  const fresh = one('SELECT balance FROM users WHERE id = ?', c.id);
  return { balance: fresh.balance, ...campaigns.companyOverview(c) };
});
POST('/api/company/campaigns', { idempotent: true }, (ctx) => ({ campaign: campaigns.campaignPublic(campaigns.createCampaign(need(ctx, 'company'), ctx.body)) }));
GET('/api/company/campaigns/:id', (ctx) => campaigns.companyCampaign(need(ctx, 'company'), id(ctx.params.id)));
PUT('/api/company/campaigns/:id', { idempotent: true }, (ctx) => ({
  campaign: campaigns.campaignPublic(campaigns.updateCampaign(need(ctx, 'company'), id(ctx.params.id), ctx.body)),
}));
POST('/api/company/campaigns/:id/status', { idempotent: true }, (ctx) => {
  campaigns.setCampaignStatus(need(ctx, 'company'), id(ctx.params.id), ctx.body.status);
  return { ok: true };
});
GET('/api/company/campaigns/:id/export.csv', { raw: true }, (ctx) => {
  const csv = campaigns.exportCsv(need(ctx, 'company'), id(ctx.params.id));
  ctx.res.writeHead(200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="attention-bank-campaign-${ctx.params.id}.csv"`,
  });
  ctx.res.end(csv);
});
POST('/api/company/submissions/:id/review', { idempotent: true }, (ctx) => campaigns.reviewSubmission(need(ctx, 'company'), id(ctx.params.id), ctx.body));

// Пополнение бюджета компании. Только в демо-режиме: в продакшене здесь будет платёжный шлюз.
POST('/api/company/deposit', { idempotent: true }, (ctx) => {
  const c = need(ctx, 'company');
  if (!config.demoMode) throw forbidden('Пополнение без оплаты доступно только в демо-режиме. Подключите платёжный шлюз.');
  const amount = int(ctx.body.amount, { field: 'Сумма', min: 100, max: 1_000_000 });
  const { balanceAfter } = postTransaction({ userId: c.id, amount, type: 'deposit', title: 'Пополнение бюджета (демо)' });
  return { balance: balanceAfter };
});

GET('/api/company/rewards', (ctx) => ({ rewards: rewards.companyRewards(need(ctx, 'company').id) }));
POST('/api/company/rewards', { idempotent: true }, (ctx) => ({ reward: rewards.createReward(need(ctx, 'company'), ctx.body) }));
PUT('/api/company/rewards/:id', (ctx) => ({ reward: rewards.updateReward(need(ctx, 'company'), id(ctx.params.id), ctx.body) }));
