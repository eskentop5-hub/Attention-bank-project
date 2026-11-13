// REST API ATTENTION BANK
import { config, VERSION } from './config.js';
import { one, all, run, tx, now, isDemo, modeName } from './db.js';
import { bad, forbidden, HttpError, str, email as cleanEmail, int } from './util.js';
import { CATEGORIES, INTERESTS, REWARD_CATEGORIES, QUESTION_TYPE_LABELS, cleanInterests } from './catalog.js';
import { home, activity, exportUserData } from './services/home.js';
import * as auth from './services/auth.js';
import { postTransaction, listTransactions, verifyLedger, verifyAllLedgers } from './services/ledger.js';
import * as campaigns from './services/campaigns.js';
import * as rewards from './services/rewards.js';
import { listNotifications, unreadCount, markAllRead } from './services/notifications.js';
import { createLinkCode, linkAccount, unlinkTelegram, handleUpdate, webhookSecretToken } from './telegram/bot.js';
import { verifyInitData } from './telegram/features.js';
import { telegramEnabled } from './telegram/api.js';
import { recordVisit, streak, userStats, dailyChallenge } from './services/stats.js';
import * as mascot from './services/mascot.js';
import * as assistant from './services/assistant.js';
import * as economy from './services/economy.js';
import { AUTO_APPROVE_SCORE, AUTO_REJECT_SCORE, FLAG_INFO } from './services/verification.js';
import * as billing from './services/billing.js';
import * as admin from './services/admin.js';
import * as recovery from './services/recovery.js';
import * as growth from './services/growth.js';
import { logError, rateLimit, adminLog } from './services/ops.js';
import { backupNow, backupStatus, snapshotFile } from './services/backup.js';
import { demoInfo, resetDemo, canManualReset } from './demo.js';
import fs from 'node:fs';

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
const needAdmin = (ctx) => {
  const u = need(ctx);
  if (!u.is_admin) throw forbidden('Только для администратора платформы');
  return u;
};
// Админка и Telegram всегда работают с настоящей базой, даже если включена демо-песочница
const ADMIN = { realOnly: true };

// ---------- Публичное ----------

GET('/api/meta', () => ({
  mode: modeName(),
  demoMode: isDemo(),
  demo: demoInfo(),
  recovery: recovery.recoveryChannels(),
  referralBonus: config.referralBonus,
  support: config.billing.contact || null,
  levels: growth.LEVELS.map((l) => ({ level: l.level, name: l.name, approved: l.approved, avgScore: l.avgScore })),
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
  // Правила экономики — для модели unit-экономики в презентации (считается из настроек, а не вписано руками)
  return { ...s, demo: isDemo(), economy: { abToKzt: config.economy.abToKzt, platformFeePercent: config.economy.platformFeePercent, sellerFeePercent: config.economy.sellerFeePercent } };
});

// Реальные награды каталога для главной страницы (без входа)
GET('/api/public/rewards', () => ({ rewards: rewards.publicRewards(6), demoMode: isDemo() }));

GET('/api/health', { realOnly: true }, () => {
  const b = backupStatus();
  return {
    ok: true,
    version: VERSION,
    ledger: verifyAllLedgers().ok,
    telegram: telegramEnabled(),
    admin: !admin.adminSetupProblem(),
    backup: { enabled: b.enabled, provider: b.provider, lastOkAt: b.lastOkAt, restoredAt: b.restoredAt, failing: !!b.lastError },
  };
});

// ---------- Режим: настоящее приложение или демо-песочница ----------

POST('/api/mode', { realOnly: true }, (ctx) => {
  const demo = ctx.body.mode === 'demo';
  if (demo && !config.demoSandbox) throw forbidden('Демо-режим отключён на этом сервере');
  const secure = config.publicUrl.startsWith('https://') ? 'SameSite=None; Secure; Partitioned' : 'SameSite=Lax';
  ctx.setCookie(demo ? `ab_mode=demo; Path=/; HttpOnly; ${secure}; Max-Age=${7 * 86400}` : `ab_mode=; Path=/; HttpOnly; ${secure}; Max-Age=0`);
  return { mode: demo ? 'demo' : 'real' };
});

// В песочнице: войти демо-участником или демо-студией одной кнопкой
POST('/api/demo/login', (ctx) => {
  if (modeName() !== 'demo') throw forbidden('Только в демо-режиме');
  const email = ctx.body.as === 'company' ? 'studio@attention.bank' : 'demo@attention.bank';
  const user = one('SELECT * FROM users WHERE email = ?', email);
  if (!user) throw bad('Демо ещё готовится, обновите страницу');
  const s = auth.createSession(user.id);
  ctx.setCookie(auth.sessionCookie(s.token, s.expires));
  return { user: auth.publicUser(user) };
});

POST('/api/demo/reset', async (ctx) => {
  if (modeName() !== 'demo') throw forbidden('Только в демо-режиме');
  if (!canManualReset()) throw new HttpError(429, 'Демо уже обновлялось недавно. Попробуйте через несколько минут.');
  await resetDemo();
  ctx.setCookie(auth.sessionCookie(null));
  return { ok: true, demo: demoInfo() };
});

// Ошибки из браузера → журнал ошибок администратора
POST('/api/client-error', { public: true, realOnly: true }, (ctx) => {
  rateLimit(`clienterr|${ctx.ip}`, 20, 10 * 60e3);
  const b = ctx.body || {};
  logError({ source: 'client', message: String(b.message || 'Ошибка в браузере'), detail: String(b.stack || '').slice(0, 3000), path: String(b.page || '').slice(0, 200), userId: ctx.user?.id });
  return { ok: true };
});

// ---------- Аутентификация ----------

POST('/api/auth/register', (ctx) => {
  const b = ctx.body;
  const role = b.role === 'company' ? 'company' : 'user';
  const email = cleanEmail(b.email);
  const password = String(b.password || '');
  const name = str(b.name, { field: 'Имя', min: 2, max: 80 });
  const pwErr = auth.passwordProblem(password, { email, name });
  if (pwErr) throw bad(pwErr);
  if (b.passwordConfirm !== undefined && b.passwordConfirm !== password) throw bad('Пароли не совпадают');
  const companyName = role === 'company' ? str(b.companyName, { field: 'Название компании', min: 2, max: 120 }) : null;
  if (!b.consent) throw bad('Нужно согласие на обработку данных');
  if (role === 'user' && !b.ageConfirmed) throw bad('Платформа доступна с 16 лет. Подтвердите возраст.');
  if (one('SELECT id FROM users WHERE email = ?', email)) throw bad('Аккаунт с таким email уже есть');
  // Адрес администратора из настроек сервера зарезервирован: его аккаунт создаёт только сервер
  if (config.admin.email && email === config.admin.email) throw bad('Этот email зарезервирован. Укажите другой адрес.');
  rateLimit(`register|${ctx.ip}`, config.registerPerHour, 60 * 60e3, 'Слишком много регистраций с одного адреса. Попробуйте позже.');
  // Откуда пришёл человек: реферальная ссылка друга, приглашение студии или метка рекламы (utm_source)
  const referrer = role === 'user' ? growth.findReferrer(b.ref) : null;
  const source = growth.cleanSource(b.source) || (referrer ? 'referral' : b.invite ? 'studio_invite' : null);
  const r = run(
    'INSERT INTO users (email, password_hash, name, role, company_name, consent_at, referred_by, signup_source) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    email, auth.hashPassword(password), name, role, companyName, new Date().toISOString(), referrer?.id ?? null, source
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
  // Владелец вводит адрес администратора, а аккаунт не создан из-за настроек сервера — говорим, что исправить
  if (!user && modeName() === 'real' && config.admin.email && email === config.admin.email && admin.adminSetupProblem())
    throw bad(`Администратор ещё не создан: ${admin.adminSetupProblem()}. Исправьте переменную в настройках Render — сервер перезапустится сам.`);
  if (!user || user.role === 'system' || !auth.verifyPassword(String(ctx.body.password || ''), user.password_hash))
    throw bad('Неверный email или пароль');
  if (user.blocked_at) throw forbidden('Аккаунт заблокирован администратором. Напишите в поддержку.');
  auth.resetLoginRate(key);
  const s = auth.createSession(user.id);
  ctx.setCookie(auth.sessionCookie(s.token, s.expires));
  return { user: auth.publicUser(user) };
});

// Смена пароля: нужен текущий пароль; остальные сессии завершаются
POST('/api/me/password', (ctx) => {
  const u = need(ctx);
  const key = `pw|${u.id}`;
  auth.checkLoginRate(key);
  if (!auth.verifyPassword(String(ctx.body.current || ''), u.password_hash)) throw bad('Текущий пароль неверный');
  const next = String(ctx.body.next || '');
  if (next === ctx.body.current) throw bad('Новый пароль должен отличаться от текущего');
  const pwErr = auth.passwordProblem(next, { email: u.email, name: u.name });
  if (pwErr) throw bad(pwErr);
  if (ctx.body.confirm !== undefined && ctx.body.confirm !== next) throw bad('Пароли не совпадают');
  auth.resetLoginRate(key);
  run('UPDATE users SET password_hash = ? WHERE id = ?', auth.hashPassword(next), u.id);
  run('DELETE FROM sessions WHERE user_id = ?', u.id);
  const s = auth.createSession(u.id);
  ctx.setCookie(auth.sessionCookie(s.token, s.expires));
  return { ok: true };
});

// Удаление аккаунта участника: личные данные обезличиваются, а записи о баллах остаются,
// чтобы бухгалтерия платформы сходилась (баланс = сумма транзакций). Ответы остаются у компаний без имени.
POST('/api/me/delete', (ctx) => {
  const u = need(ctx, 'user');
  const key = `del|${u.id}`;
  auth.checkLoginRate(key);
  if (!auth.verifyPassword(String(ctx.body.password || ''), u.password_hash)) throw bad('Пароль неверный');
  auth.resetLoginRate(key);
  tx(() => {
    run(
      `UPDATE users SET email = ?, name = 'Удалённый участник', password_hash = 'deleted', telegram_chat_id = NULL, telegram_username = NULL,
         telegram_verified_at = NULL, notify_telegram = 0, avatar = NULL, interests = '[]', goal_reward_id = NULL, deleted_at = ? WHERE id = ?`,
      `deleted-${u.id}@deleted.invalid`,
      now(),
      u.id
    );
    run('DELETE FROM sessions WHERE user_id = ?', u.id);
    run('DELETE FROM telegram_link_codes WHERE user_id = ?', u.id);
  });
  ctx.setCookie(auth.sessionCookie(null));
  return { ok: true };
});

// ---------- Восстановление пароля и подтверждение email ----------
POST('/api/auth/forgot', async (ctx) => recovery.requestReset({ email: ctx.body.email, ip: ctx.ip }));
GET('/api/auth/reset/:token', (ctx) => recovery.checkResetToken(ctx.params.token));
POST('/api/auth/reset', (ctx) => {
  const key = `reset|${ctx.ip}`;
  auth.checkLoginRate(key);
  const r = recovery.resetPassword({ token: ctx.body.token, password: ctx.body.password, confirm: ctx.body.confirm });
  auth.resetLoginRate(key);
  const user = one('SELECT * FROM users WHERE email = ?', r.email);
  const s = auth.createSession(user.id);
  ctx.setCookie(auth.sessionCookie(s.token, s.expires));
  return { ok: true, user: auth.publicUser(user) };
});
POST('/api/me/verify-email', async (ctx) => recovery.requestEmailVerify(need(ctx), ctx.ip));
POST('/api/auth/verify-email', (ctx) => recovery.confirmEmail(ctx.body.token));

POST('/api/auth/logout', (ctx) => {
  auth.destroySession(ctx.token);
  ctx.setCookie(auth.sessionCookie(null));
  return { ok: true };
});

GET('/api/me', (ctx) => {
  if (!ctx.user) return { user: null };
  // Отметка захода для серии 🔥 (один раз в день)
  recordVisit(ctx.user.id);
  return { user: auth.publicUser(ctx.user), unread: unreadCount(ctx.user.id), streak: streak(ctx.user.id) };
});

// Личная статистика: заработок по дням, вчера/позавчера, лучший день, одобрение, AB за час внимания
GET('/api/me/stats', (ctx) => userStats(need(ctx).id, 14));
// Уровень тестировщика и реферальная программа
GET('/api/me/level', (ctx) => growth.testerLevel(need(ctx, 'user').id));
GET('/api/me/referrals', (ctx) => growth.referralStats(need(ctx, 'user').id));

// Маскот «Аби»: ИИ (если задан ANTHROPIC_API_KEY) или встроенная база знаний. Доступен и гостям.
POST('/api/mascot/ask', async (ctx) => mascot.ask({ question: ctx.body.question, page: ctx.body.page, user: ctx.user, ip: ctx.ip }));
// v13: Аби-ассистент выполняет команды (инструменты приложения) и, если подключён ИИ, ищет в интернете
GET('/api/abi', (ctx) => assistant.assistantInfo(ctx.user));
POST('/api/abi', async (ctx) => assistant.assist({ message: ctx.body.message, history: ctx.body.history, page: ctx.body.page, user: ctx.user, ip: ctx.ip }));

// Обновление профиля. Баланс, роль, Telegram — НЕ меняются отсюда, даже если клиент их пришлёт.
PUT('/api/me', (ctx) => {
  const u = need(ctx);
  const name = ctx.body.name !== undefined ? str(ctx.body.name, { field: 'Имя', min: 2, max: 80 }) : u.name;
  const interests = ctx.body.interests !== undefined ? cleanInterests(ctx.body.interests) : JSON.parse(u.interests);
  const notifyTelegram = ctx.body.notifyTelegram !== undefined ? (ctx.body.notifyTelegram ? 1 : 0) : u.notify_telegram;
  let avatar = u.avatar;
  if (ctx.body.avatar !== undefined) {
    if (ctx.body.avatar !== null && !/^a([1-9]|1[0-2])$/.test(String(ctx.body.avatar))) throw bad('Неизвестный аватар');
    avatar = ctx.body.avatar;
  }
  run('UPDATE users SET name = ?, interests = ?, notify_telegram = ?, avatar = ? WHERE id = ?', name, JSON.stringify(interests), notifyTelegram, avatar, u.id);
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
POST('/api/tasks/:id/submit', { idempotent: true }, (ctx) => campaigns.submitTask(need(ctx, 'user'), id(ctx.params.id), ctx.body.answers, ctx.body.meta));
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

POST('/api/telegram/link-code', (ctx) => {
  if (modeName() === 'demo') throw bad('В демо-режиме Telegram не привязывается. Выйдите из демо.');
  return createLinkCode(need(ctx).id);
});

// Mini App: вход по подписанным данным Telegram. Подпись проверяется токеном бота — подделать нельзя.
POST('/api/telegram/webapp-login', { realOnly: true }, (ctx) => {
  const tg = verifyInitData(ctx.body.initData);
  if (!tg) throw forbidden('Данные Telegram не прошли проверку подписи');
  const user = one("SELECT * FROM users WHERE telegram_chat_id = ? AND role != 'system'", String(tg.id));
  if (!user) return { linked: false, telegramName: tg.first_name || tg.username || null };
  const s = auth.createSession(user.id);
  ctx.setCookie(auth.sessionCookie(s.token, s.expires));
  return { linked: true, user: auth.publicUser(user) };
});
// Mini App: привязать Telegram к аккаунту, в который только что вошли (без кода — по подписи Telegram)
POST('/api/telegram/webapp-link', { realOnly: true }, (ctx) => {
  const u = need(ctx);
  const tg = verifyInitData(ctx.body.initData);
  if (!tg) throw forbidden('Данные Telegram не прошли проверку подписи');
  if (u.telegram_chat_id === String(tg.id)) return { ok: true, already: true };
  const res = linkAccount(createLinkCode(u.id).code, tg.id, tg.username);
  if (!res.ok) throw bad(res.reason);
  return { ok: true, bonus: res.bonus, user: auth.publicUser(res.user) };
});
POST('/api/telegram/unlink', (ctx) => {
  unlinkTelegram(need(ctx).id);
  return { ok: true };
});
POST('/api/telegram/webhook', { public: true, realOnly: true }, async (ctx) => {
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
// Отчёт для студии (печатная версия / PDF) и ссылка-приглашение тестировщиков
GET('/api/company/campaigns/:id/report', (ctx) => campaigns.campaignReport(need(ctx, 'company'), id(ctx.params.id)));
GET('/api/company/campaigns/:id/invite', (ctx) => ({ code: campaigns.inviteFor(need(ctx, 'company'), id(ctx.params.id)) }));
GET('/api/join/:code', (ctx) => campaigns.joinInfo(ctx.params.code));

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
  if (!isDemo()) throw forbidden('Пополнение без оплаты есть только в демо. В настоящем режиме создайте счёт: «Бюджет» → «Пополнить по счёту».');
  const amount = int(ctx.body.amount, { field: 'Сумма', min: 100, max: 1_000_000 });
  const { balanceAfter } = postTransaction({ userId: c.id, amount, type: 'deposit', title: 'Пополнение бюджета (демо)' });
  return { balance: balanceAfter };
});

// Экономика v2: выручка продавца с наград и вывод в тенге
GET('/api/company/revenue', (ctx) => economy.sellerRevenue(need(ctx, 'company').id));
POST('/api/company/payouts', { idempotent: true }, (ctx) => economy.requestPayout(need(ctx, 'company'), ctx.body));
// Публичная казна: прозрачность всей экономики (без персональных данных)
GET('/api/economy', () => economy.treasury());

GET('/api/company/rewards', (ctx) => ({ rewards: rewards.companyRewards(need(ctx, 'company').id) }));
POST('/api/company/rewards', { idempotent: true }, (ctx) => ({ reward: rewards.createReward(need(ctx, 'company'), ctx.body) }));
PUT('/api/company/rewards/:id', (ctx) => ({ reward: rewards.updateReward(need(ctx, 'company'), id(ctx.params.id), ctx.body) }));

// ---------- Пополнение бюджета по счёту (студия) ----------
GET('/api/company/topups', (ctx) => ({ topups: billing.companyTopups(need(ctx, 'company').id), billing: billing.billingInfo() }));
POST('/api/company/topups', { idempotent: true }, (ctx) => {
  const c = need(ctx, 'company');
  const topup = billing.createTopup(c, ctx.body);
  return { topup, billing: billing.billingInfo(), balance: one('SELECT balance FROM users WHERE id = ?', c.id).balance };
});
POST('/api/company/pilot-request', { idempotent: true }, (ctx) => ({ topup: billing.createTopup(need(ctx, 'company'), ctx.body, { pilot: true }) }));
POST('/api/admin/users/:id/grant', ADMIN, (ctx) => ({ topup: billing.grantPilot(needAdmin(ctx), id(ctx.params.id), ctx.body) }));
POST('/api/company/topups/:id/cancel', (ctx) => ({ topup: billing.cancelTopup(need(ctx, 'company'), id(ctx.params.id)) }));

// ---------- Администратор платформы ----------
GET('/api/admin/overview', ADMIN, (ctx) => (needAdmin(ctx), admin.overview()));
GET('/api/admin/money', ADMIN, (ctx) => (needAdmin(ctx), { topups: billing.listTopups(), payouts: billing.listPayouts() }));
POST('/api/admin/topups/:id/approve', ADMIN, (ctx) => ({ topup: billing.approveTopup(needAdmin(ctx), id(ctx.params.id), ctx.body.note ? String(ctx.body.note).slice(0, 300) : null) }));
POST('/api/admin/topups/:id/reject', ADMIN, (ctx) => ({ topup: billing.rejectTopup(needAdmin(ctx), id(ctx.params.id), ctx.body.note) }));
POST('/api/admin/payouts/:id/paid', ADMIN, (ctx) => ({ payout: billing.markPayoutPaid(needAdmin(ctx), id(ctx.params.id), ctx.body.note ? String(ctx.body.note).slice(0, 300) : null) }));
POST('/api/admin/payouts/:id/reject', ADMIN, (ctx) => ({ payout: billing.rejectPayout(needAdmin(ctx), id(ctx.params.id), ctx.body.note) }));
GET('/api/admin/users', ADMIN, (ctx) => (needAdmin(ctx), { users: admin.listUsers({ q: ctx.query.q || '', role: ['user', 'company'].includes(ctx.query.role) ? ctx.query.role : '' }) }));
POST('/api/admin/users/:id/block', ADMIN, (ctx) => admin.setBlocked(needAdmin(ctx), id(ctx.params.id), !!ctx.body.blocked, ctx.body.reason));
POST('/api/admin/users/:id/reset-link', ADMIN, (ctx) => recovery.adminResetLink(needAdmin(ctx), id(ctx.params.id)));
GET('/api/admin/campaigns', ADMIN, (ctx) => (needAdmin(ctx), { campaigns: admin.listCampaigns() }));
POST('/api/admin/campaigns/:id/status', ADMIN, (ctx) => admin.moderateCampaign(needAdmin(ctx), id(ctx.params.id), ctx.body.status, ctx.body.reason));
GET('/api/admin/errors', ADMIN, (ctx) => (needAdmin(ctx), { errors: admin.errors() }));
GET('/api/admin/actions', ADMIN, (ctx) => (needAdmin(ctx), { actions: admin.actions() }));
GET('/api/admin/marketing', ADMIN, (ctx) => (needAdmin(ctx), growth.acquisition()));
POST('/api/admin/backup', ADMIN, async (ctx) => {
  const a = needAdmin(ctx);
  const r = await backupNow({ force: true });
  adminLog(a.id, 'backup', r.key || null, r.ok ? `${r.size || 0} байт` : r.reason || 'ошибка');
  return r;
});
GET('/api/admin/backup/download', { ...ADMIN, raw: true }, async (ctx) => {
  const a = needAdmin(ctx);
  const file = await snapshotFile();
  adminLog(a.id, 'db_download', null, ctx.ip);
  const buf = fs.readFileSync(file);
  fs.rmSync(file, { force: true });
  ctx.res.writeHead(200, {
    'Content-Type': 'application/octet-stream',
    'Content-Disposition': `attachment; filename="attention-bank-${new Date().toISOString().slice(0, 10)}.db"`,
    'Cache-Control': 'no-store',
  });
  ctx.res.end(buf);
});
POST('/api/admin/demo/reset', ADMIN, async (ctx) => {
  const a = needAdmin(ctx);
  await resetDemo();
  adminLog(a.id, 'demo_reset');
  return { ok: true, demo: demoInfo() };
});
