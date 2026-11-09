// Telegram v2: Mini App (вход по подписи Telegram), задания прямо в чате, напоминание о серии,
// проверка ответов компанией кнопками, /stats. Всё через те же сервисы, что и сайт: правила одни.
import crypto from 'node:crypto';
import { config } from '../config.js';
import { one, all, run } from '../db.js';
import { call, sendMessage, escapeHtml, telegramEnabled } from './api.js';
import { categoryLabel } from '../catalog.js';
import { startTask, submitTask, reviewSubmission } from '../services/campaigns.js';
import { userStats, streak, dailyChallenge, dayKey } from '../services/stats.js';
import { FLAG_INFO } from '../services/verification.js';

const https = () => config.publicUrl.startsWith('https://');
/** Кнопка, открывающая сайт как Mini App внутри Telegram (только HTTPS и только в личном чате) */
export const appButton = (text = '📱 Открыть ATTENTION BANK', path = '/') => (https() ? { text, web_app: { url: `${config.publicUrl}${path}` } } : null);
const kb = (rows) => ({ reply_markup: { inline_keyboard: rows.filter((r) => r && r.length && r.every(Boolean)) } });

// ===================================================================
//                     MINI APP: проверка initData
// ===================================================================
/**
 * Проверяет подпись данных запуска Mini App (алгоритм из документации Telegram):
 * secret = HMAC_SHA256("WebAppData", bot_token); hash = HMAC_SHA256(secret, data_check_string).
 * Возвращает пользователя Telegram или null.
 */
export function verifyInitData(initData, maxAgeSec = 24 * 3600) {
  if (!config.telegram.token || typeof initData !== 'string' || initData.length > 4096) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash || !/^[a-f0-9]{64}$/.test(hash)) return null;
  params.delete('hash');
  const dcs = [...params.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(config.telegram.token).digest();
  const calc = crypto.createHmac('sha256', secret).update(dcs).digest();
  if (!crypto.timingSafeEqual(calc, Buffer.from(hash, 'hex'))) return null;
  const authDate = Number(params.get('auth_date'));
  if (!authDate || Date.now() / 1000 - authDate > maxAgeSec) return null;
  try {
    const user = JSON.parse(params.get('user') || 'null');
    return user && Number.isInteger(user.id) ? user : null;
  } catch {
    return null;
  }
}

// ===================================================================
//                 ЗАДАНИЯ В ЧАТЕ: состояние диалога в kv
// ===================================================================
const key = (chatId) => `tgflow:${chatId}`;
const getFlow = (chatId) => {
  const r = one('SELECT value FROM kv WHERE key = ?', key(chatId));
  try {
    return r ? JSON.parse(r.value) : null;
  } catch {
    return null;
  }
};
const setFlow = (chatId, v) => run('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key(chatId), JSON.stringify(v));
const clearFlow = (chatId) => run('DELETE FROM kv WHERE key = ?', key(chatId));
export const hasFlow = (chatId) => !!getFlow(chatId);

/** Задания, которые можно пройти в чате (не начатые или начатые, но не отправленные) */
export function chatTasks(user) {
  return all(
    `SELECT c.* FROM campaigns c LEFT JOIN assignments a ON a.campaign_id = c.id AND a.user_id = ?
     WHERE c.status = 'active' AND (a.id IS NULL OR a.status = 'started') ORDER BY c.reward DESC LIMIT 6`,
    user.id
  );
}

export async function listTasks(chatId, user) {
  const rows = user ? chatTasks(user) : all("SELECT * FROM campaigns WHERE status = 'active' ORDER BY id DESC LIMIT 5");
  if (!rows.length) return sendMessage(chatId, 'Сейчас нет доступных заданий. Мы напишем, когда появятся.');
  const text =
    '<b>Задания</b>\n\n' +
    rows.map((c) => `• <b>${escapeHtml(c.title)}</b>\n  ${categoryLabel(c.category)} · ≈${c.est_minutes || 5} мин · <b>+${c.reward} AB</b>`).join('\n\n') +
    (user ? '\n\nНажмите на задание, чтобы пройти его прямо здесь.' : '\n\nПодключите аккаунт (/start), чтобы проходить задания в чате.');
  return sendMessage(chatId, text, user ? kb(rows.map((c) => [{ text: `▶ ${c.title.slice(0, 40)} · +${c.reward} AB`, callback_data: `t:${c.id}` }])) : {});
}

async function startFlow(chatId, user, campaignId) {
  try {
    startTask(user, campaignId);
  } catch (e) {
    return sendMessage(chatId, `⚠️ ${escapeHtml(e.message)}`);
  }
  const c = one('SELECT * FROM campaigns WHERE id = ?', campaignId);
  const questions = JSON.parse(c.questions || '[]');
  setFlow(chatId, { cid: c.id, i: 0, answers: {} });
  const steps = (c.instructions || '').split('\n').filter(Boolean).map((s, k) => `${k + 1}. ${escapeHtml(s)}`).join('\n');
  const productRow = c.product_url ? [{ text: '🔗 Открыть продукт', url: c.product_url.startsWith('http') && !/localhost/.test(c.product_url) ? c.product_url : `${config.publicUrl}` }] : null;
  await sendMessage(
    chatId,
    `▶ <b>${escapeHtml(c.title)}</b>\n+${c.reward} AB · ${questions.length} ${questions.length === 1 ? 'вопрос' : 'вопроса'}${c.min_seconds ? ` · не быстрее ${Math.ceil(c.min_seconds / 60)} мин` : ''}\n\n${steps || escapeHtml(c.description)}\n\nКогда пройдёте продукт — отвечайте на вопросы ниже. /cancel — выйти.`,
    productRow && !/localhost|127\.0\.0\.1/.test(productRow[0].url) ? kb([productRow]) : {}
  );
  return askNext(chatId);
}

async function askNext(chatId) {
  const f = getFlow(chatId);
  if (!f) return;
  const c = one('SELECT * FROM campaigns WHERE id = ?', f.cid);
  const qs = JSON.parse(c.questions || '[]');
  if (f.i >= qs.length) return finish(chatId);
  const q = qs[f.i];
  const head = `<b>Вопрос ${f.i + 1}/${qs.length}</b>${q.correct ? ' · контрольный' : ''}\n${escapeHtml(q.label)}`;
  const skip = q.required ? [] : [[{ text: 'Пропустить', callback_data: `s:${f.cid}:${f.i}` }]];
  if (q.type === 'rating')
    return sendMessage(chatId, head, kb([[1, 2, 3, 4, 5].map((n) => ({ text: `${n}★`, callback_data: `a:${f.cid}:${f.i}:${n}` })), ...skip]));
  if (q.type === 'choice')
    return sendMessage(chatId, head, kb([...q.options.map((o, k) => [{ text: o, callback_data: `a:${f.cid}:${f.i}:${k}` }]), ...skip]));
  const hint = q.type === 'url' ? 'Отправьте ссылку (http/https).' : `Напишите ответ сообщением${q.minLength ? `, минимум ${q.minLength} символов` : ''}.`;
  return sendMessage(chatId, `${head}\n\n<i>${hint}</i>`, skip.length ? kb(skip) : {});
}

async function finish(chatId) {
  const f = getFlow(chatId);
  clearFlow(chatId);
  const user = one('SELECT * FROM users WHERE telegram_chat_id = ?', String(chatId));
  try {
    const r = submitTask(user, f.cid, f.answers);
    const text =
      r.outcome === 'approved'
        ? `✅ <b>Ответ одобрен автоматически</b>\nКачество ${r.score}/100. Баллы уже на балансе.`
        : r.outcome === 'rejected'
          ? `❌ <b>Ответ не прошёл автопроверку</b>\n${r.flags.map((x) => FLAG_INFO[x]?.label).filter(Boolean).join(', ')}`
          : `📨 <b>Ответ отправлен</b>\nКачество ${r.score}/100. Компания проверит его, и я сразу напишу.`;
    return sendMessage(chatId, text, kb([[{ text: '▶ Ещё задания', callback_data: 'list' }]]));
  } catch (e) {
    if (e.message?.includes('не быстрее') || e.status === 400) {
      return sendMessage(chatId, `⚠️ ${escapeHtml(e.message)}`);
    }
    return sendMessage(chatId, `⚠️ ${escapeHtml(e.message || 'Не удалось отправить ответ')}`);
  }
}

/** Текстовое сообщение во время прохождения задания */
export async function flowText(chatId, text) {
  const f = getFlow(chatId);
  if (!f) return false;
  const c = one('SELECT * FROM campaigns WHERE id = ?', f.cid);
  const q = JSON.parse(c.questions || '[]')[f.i];
  if (!q || !['text', 'url'].includes(q.type)) {
    await sendMessage(chatId, 'Выберите вариант кнопкой выше или отправьте /cancel.');
    return true;
  }
  const s = text.trim();
  if (q.type === 'text' && s.length < (q.minLength ?? 30)) {
    await sendMessage(chatId, `Слишком коротко: ${s.length} из ${q.minLength ?? 30} символов. Добавьте подробностей.`);
    return true;
  }
  if (q.type === 'url' && !/^https?:\/\/\S+$/i.test(s)) {
    await sendMessage(chatId, 'Нужна ссылка, начинающаяся с http:// или https://');
    return true;
  }
  f.answers[q.id] = s;
  f.i++;
  setFlow(chatId, f);
  await askNext(chatId);
  return true;
}

export function cancelFlow(chatId) {
  const had = hasFlow(chatId);
  clearFlow(chatId);
  return had;
}

// ===================================================================
//                        НАЖАТИЯ НА КНОПКИ
// ===================================================================
export async function handleCallback(cq) {
  const chatId = cq.message?.chat?.id;
  const data = String(cq.data || '');
  const answer = (text = '') => call('answerCallbackQuery', { callback_query_id: cq.id, text }).catch(() => {});
  if (!chatId) return answer();
  const user = one('SELECT * FROM users WHERE telegram_chat_id = ?', String(chatId));
  if (!user) {
    await answer('Сначала подключите аккаунт: /start');
    return;
  }
  const [kind, a1, a2, a3] = data.split(':');

  if (kind === 'list') return answer(), listTasks(chatId, user);
  if (kind === 't') return answer(), startFlow(chatId, user, Number(a1));

  if (kind === 'a' || kind === 's') {
    const f = getFlow(chatId);
    if (!f || f.cid !== Number(a1) || f.i !== Number(a2)) return answer('Этот вопрос уже не актуален');
    const c = one('SELECT * FROM campaigns WHERE id = ?', f.cid);
    const q = JSON.parse(c.questions || '[]')[f.i];
    if (kind === 'a') {
      if (q.type === 'rating') f.answers[q.id] = Number(a3);
      else if (q.type === 'choice') f.answers[q.id] = q.options[Number(a3)];
    }
    f.i++;
    setFlow(chatId, f);
    await answer(kind === 's' ? 'Пропущено' : 'Принято');
    // Убираем кнопки у отвеченного вопроса, чтобы не нажать дважды
    call('editMessageReplyMarkup', { chat_id: chatId, message_id: cq.message.message_id, reply_markup: { inline_keyboard: [] } }).catch(() => {});
    return askNext(chatId);
  }

  // Проверка ответа компанией прямо из Telegram
  if (kind === 'rv' || kind === 'rj') {
    if (user.role !== 'company') return answer('Только для компаний');
    const reasons = ['Ответ слишком общий', 'Не по теме задания', 'Продукт не пройден'];
    if (kind === 'rv' && a2 === 'reject') {
      await answer();
      return sendMessage(chatId, 'Причина отклонения?', kb(reasons.map((r, k) => [{ text: r, callback_data: `rj:${a1}:${k}` }])));
    }
    try {
      reviewSubmission(user, Number(a1), kind === 'rj' ? { decision: 'reject', note: reasons[Number(a2)] || reasons[0] } : { decision: 'approve' });
      await answer(kind === 'rj' ? 'Отклонено' : 'Одобрено, баллы начислены');
      call('editMessageReplyMarkup', { chat_id: chatId, message_id: cq.message.message_id, reply_markup: { inline_keyboard: [] } }).catch(() => {});
      return sendMessage(chatId, kind === 'rj' ? `❌ Ответ #${a1} отклонён: ${reasons[Number(a2)] || reasons[0]}` : `✅ Ответ #${a1} одобрен. Участник получил баллы.`);
    } catch (e) {
      return answer(e.message.slice(0, 180));
    }
  }

  if (kind === 'rm') {
    setRemind(user.id, a1 === 'on');
    await answer(a1 === 'on' ? 'Напоминания включены' : 'Напоминания выключены');
    return;
  }
  return answer();
}

/** Сообщение компании о новом ответе с кнопками решения */
export function reviewKeyboard(assignmentId, campaignId) {
  return kb([
    [
      { text: '✅ Одобрить', callback_data: `rv:${assignmentId}:approve` },
      { text: '❌ Отклонить', callback_data: `rv:${assignmentId}:reject` },
    ],
    https() ? [{ text: 'Открыть на сайте', url: `${config.publicUrl}/#/company/campaigns/${campaignId}` }] : null,
  ]);
}

// ===================================================================
//                          /stats
// ===================================================================
export function statsText(user) {
  const s = userStats(user.id, 7);
  const max = Math.max(1, ...s.days.map((d) => d.earned));
  const bars = '▁▂▃▄▅▆▇█';
  const spark = s.days.map((d) => (d.earned ? bars[Math.min(7, Math.round((d.earned / max) * 7))] : '·')).join('');
  return (
    `📊 <b>Статистика</b>\n\n` +
    `Сегодня: <b>+${s.today.earned} AB</b>\nВчера: <b>+${s.yesterday.earned} AB</b>\nПозавчера: <b>+${s.dayBefore.earned} AB</b>\nЗа 7 дней: <b>+${s.week} AB</b>  <code>${spark}</code>\n\n` +
    `🔥 Серия: <b>${s.streak.current}</b> (лучшая ${s.streak.best})\n` +
    `🎯 Челлендж дня: <b>${s.challenge.done}/${s.challenge.goal}</b>\n` +
    `✅ Одобрено: ${s.approved}${s.approvalRate !== null ? ` (${s.approvalRate}%)` : ''}\n` +
    `💳 Баланс: <b>${user.balance} AB</b>`
  );
}

// ===================================================================
//                НАПОМИНАНИЕ О СЕРИИ (раз в день)
// ===================================================================
const remindKey = (userId) => `remind_off:${userId}`;
export const remindOn = (userId) => !one('SELECT 1 AS x FROM kv WHERE key = ?', remindKey(userId));
export function setRemind(userId, on) {
  if (on) run('DELETE FROM kv WHERE key = ?', remindKey(userId));
  else run('INSERT OR IGNORE INTO kv (key, value) VALUES (?, ?)', remindKey(userId), '1');
}

/** Отправляет напоминания тем, кто сегодня ещё не заходил. Возвращает число отправленных. */
export async function sendReminders({ force = false } = {}) {
  const today = dayKey();
  const localHour = new Date(Date.now() + config.tzOffsetMin * 60e3).getUTCHours();
  if (!force) {
    if (localHour !== config.telegram.reminderHour) return 0;
    if (one("SELECT value FROM kv WHERE key = 'reminder:last'")?.value === today) return 0;
  }
  run("INSERT INTO kv (key, value) VALUES ('reminder:last', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", today);
  const users = all(
    `SELECT u.* FROM users u WHERE u.role = 'user' AND u.telegram_chat_id IS NOT NULL AND u.notify_telegram = 1
     AND NOT EXISTS (SELECT 1 FROM user_visits v WHERE v.user_id = u.id AND v.day = ?)`,
    today
  ).filter((u) => remindOn(u.id));
  let sent = 0;
  for (const u of users) {
    const st = streak(u.id);
    const ch = dailyChallenge(u.id);
    const open = chatTasks(u).length;
    const goal = u.goal_reward_id ? one('SELECT title, cost FROM rewards WHERE id = ?', u.goal_reward_id) : null;
    const text =
      (st.current > 0 ? `🔥 <b>Серия ${st.current} ${st.current === 1 ? 'день' : st.current < 5 ? 'дня' : 'дней'}</b> — зайдите сегодня, чтобы она не прервалась.` : '👋 <b>Начните серию заходов сегодня!</b>') +
      `\n\n${open ? `Доступно заданий: <b>${open}</b>` : 'Новых заданий пока нет'} · челлендж ${ch.done}/${ch.goal}` +
      (goal ? `\nДо цели «${escapeHtml(goal.title)}»: <b>${Math.max(0, goal.cost - u.balance)} AB</b>` : '');
    await sendMessage(
      u.telegram_chat_id,
      text,
      kb([[appButton('📱 Открыть') || { text: 'Открыть сайт', url: config.publicUrl }], open ? [{ text: '▶ Задания в чате', callback_data: 'list' }] : null, [{ text: '🔕 Не напоминать', callback_data: 'rm:off' }]])
    );
    sent++;
  }
  return sent;
}

let timer = null;
export function startReminders() {
  if (!telegramEnabled() || timer) return;
  timer = setInterval(() => sendReminders().catch((e) => console.error('[telegram] reminders:', e.message)), 10 * 60e3);
  timer.unref?.();
}

/** Кнопка меню чата открывает Mini App (только для HTTPS-адреса) */
export async function setupMenuButton() {
  if (!https()) return;
  await call('setChatMenuButton', { menu_button: { type: 'web_app', text: 'Открыть', web_app: { url: config.publicUrl } } }).catch((e) =>
    console.error('[telegram] menu button:', e.message)
  );
}
