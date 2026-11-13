// Telegram-бот ATTENTION BANK
// • /start <код> — привязка и верификация аккаунта (1 Telegram = 1 аккаунт)
// • /balance, /history, /tasks, /unlink, /help
// • Уведомления об одобрении заданий приходят автоматически (services/notifications.js)
import { config } from '../config.js';
import { one, all, run, tx, now, onCommit, isDemo } from '../db.js';
import { call, sendMessage, escapeHtml, linkButton, telegramEnabled, webhookSecretToken, webhookUrl } from './api.js';
import { backupNow, webhookBackupChat, rememberWebhookChat } from '../services/backup.js';
import { platformBonus } from '../services/economy.js';
import { maybeReferralBonus } from '../services/growth.js';
import { notify } from '../services/notifications.js';
import { randomCode } from '../util.js';
import { categoryLabel } from '../catalog.js';
import { appButton, listTasks, flowText, cancelFlow, handleCallback, statsText, setRemind, remindOn, startReminders, setupMenuButton } from './features.js';
import { abiReply, topText, rewardsMsg, goalMsg, levelText, refMsg, adminText, HELP, COMMANDS } from './more.js';

// ---------- Коды привязки ----------

export function createLinkCode(userId) {
  run('DELETE FROM telegram_link_codes WHERE user_id = ? AND used_at IS NULL', userId);
  const code = randomCode(10);
  const expiresAt = new Date(Date.now() + 15 * 60e3).toISOString();
  run('INSERT INTO telegram_link_codes (code, user_id, expires_at) VALUES (?, ?, ?)', code, userId, expiresAt);
  const username = config.telegram.username;
  return {
    code,
    expiresAt,
    botUsername: username || null,
    deepLink: username ? `https://t.me/${username}?start=${code}` : null,
    enabled: telegramEnabled(),
  };
}

export function linkAccount(code, chatId, username) {
  return tx(() => {
    const row = one('SELECT * FROM telegram_link_codes WHERE code = ?', code);
    if (!row || row.used_at) return { ok: false, reason: 'Код не найден или уже использован. Получите новый код в профиле на сайте.' };
    if (row.expires_at < now()) return { ok: false, reason: 'Срок действия кода истёк. Получите новый код в профиле на сайте.' };
    const taken = one('SELECT id FROM users WHERE telegram_chat_id = ?', String(chatId));
    if (taken && taken.id !== row.user_id)
      return { ok: false, reason: 'Этот Telegram уже привязан к другому аккаунту ATTENTION BANK. Один Telegram — один аккаунт.' };

    run('UPDATE telegram_link_codes SET used_at = ? WHERE code = ?', now(), code);
    const user = one('SELECT * FROM users WHERE id = ?', row.user_id);
    const firstTime = !user.telegram_verified_at;
    run(
      'UPDATE users SET telegram_chat_id = ?, telegram_username = ?, telegram_verified_at = COALESCE(telegram_verified_at, ?) WHERE id = ?',
      String(chatId), username || null, now(), user.id
    );

    let bonus = 0;
    const already = one("SELECT id FROM transactions WHERE user_id = ? AND type = 'bonus' AND ref_type = 'telegram_verify'", user.id);
    if (firstTime && !already && config.telegram.verifyBonus > 0 && user.role === 'user') {
      // Бонус платится из доходов платформы, а не печатается — экономика остаётся обеспеченной
      bonus = platformBonus({ userId: user.id, amount: config.telegram.verifyBonus, title: 'Подтверждение аккаунта через Telegram', refType: 'telegram_verify', refId: user.id });
    }
    notify(user.id, {
      kind: 'telegram',
      title: 'Telegram подключён',
      body: bonus ? `Аккаунт подтверждён. Бонус +${bonus} AB` : 'Уведомления будут приходить в Telegram',
      telegram: false,
    });
    // Реферальная программа: бонус пригласившему, если друг уже выполнил задание
    if (user.role === 'user') maybeReferralBonus(user.id);
    // Администратор привязал Telegram — сразу сохраняем первую копию базы в его чат с ботом
    if (user.is_admin && !isDemo())
      onCommit(() =>
        backupNow({ force: true }).then((r) => {
          if (r.ok && r.provider === 'telegram')
            sendMessage(chatId, '🗄 Резервные копии базы включены. Копия лежит в закреплённом сообщении и обновляется сама. Не удаляйте его: после перезапуска сервер восстановит базу из него.', { disable_notification: true });
        })
      );
    return { ok: true, user: one('SELECT * FROM users WHERE id = ?', user.id), bonus };
  });
}

export function unlinkTelegram(userId) {
  run('UPDATE users SET telegram_chat_id = NULL, telegram_username = NULL WHERE id = ?', userId);
}

// ---------- Обработка входящих сообщений ----------

const fmt = (n) => (n > 0 ? `+${n}` : `${n}`);

async function reply(chatId, text, extra) {
  return sendMessage(chatId, text, extra);
}

export async function handleUpdate(update) {
  if (update.callback_query) return handleCallback(update.callback_query);
  const msg = update.message || update.edited_message;
  if (!msg?.text || !msg.chat) return;
  const chatId = msg.chat.id;
  const isPrivate = msg.chat.type === 'private';
  const [rawCmd, ...args] = msg.text.trim().split(/\s+/);
  const cmd = rawCmd.split('@')[0].toLowerCase();
  const user = one('SELECT * FROM users WHERE telegram_chat_id = ?', String(chatId));

  if (cmd === '/backup' && isPrivate && user?.is_admin) {
    // Только администратор: сохранить копию базы прямо сейчас
    const r = await backupNow({ force: true });
    return reply(chatId, r.ok ? '🗄 Копия базы обновлена — она в закреплённом сообщении этого чата.' : `⚠️ Копия не сохранена: ${escapeHtml(r.reason || 'ошибка')}`);
  }

  if (cmd === '/chatid') {
    // Помогает узнать ID группы для TELEGRAM_GROUP_ID
    return reply(chatId, `ID этого чата: <code>${chatId}</code>\nВставьте его в TELEGRAM_GROUP_ID.`);
  }

  if (!isPrivate) {
    // В группе отвечаем только на /tasks и /chatid
    if (cmd === '/tasks') return reply(chatId, tasksText(), linkButton('Все задания', '/#/tasks'));
    return;
  }

  // Ответ на вопрос задания, которое проходят прямо в чате
  if (!cmd.startsWith('/') && user && (await flowText(chatId, msg.text))) return;
  // v13: обычный текст (не команда и не ответ на задание) — это просьба к Аби
  if (!cmd.startsWith('/')) return abiReply(chatId, user, msg.text.slice(0, 800));
  const needAcc = () => reply(chatId, 'Аккаунт не подключён. Отправьте /start, чтобы узнать как.');
  const app = appButton();
  const appKb = app ? { reply_markup: { inline_keyboard: [[app]] } } : {};

  switch (cmd) {
    case '/abi':
    case '/ai':
      if (!args.length) return reply(chatId, '✦ Я Аби. Напишите просьбу обычным текстом, например: «найди задания до 10 минут», «на что мне хватит баллов?», «поставь цель Steam-ключ».');
      return abiReply(chatId, user, args.join(' ').slice(0, 800));
    case '/top':
      return reply(chatId, topText(user), appKb);
    case '/rewards':
      if (!user || user.role !== 'user') return user ? reply(chatId, 'Награды — для участников. Кабинет студии: /app') : needAcc();
      return reply(chatId, ...rewardsMsg(user));
    case '/goal':
      if (!user || user.role !== 'user') return needAcc();
      return reply(chatId, ...goalMsg(user));
    case '/level':
      if (!user || user.role !== 'user') return needAcc();
      return reply(chatId, levelText(user), appKb);
    case '/ref':
      if (!user || user.role !== 'user') return needAcc();
      return reply(chatId, ...refMsg(user));
    case '/admin':
      if (!user?.is_admin) return reply(chatId, 'Команда только для администратора.');
      return reply(chatId, adminText());
    case '/app':
      return reply(chatId, app ? 'Откройте ATTENTION BANK прямо в Telegram:' : `Сайт: ${config.publicUrl}`, appKb);
    case '/stats':
      if (!user) return reply(chatId, 'Аккаунт не подключён. Отправьте /start, чтобы узнать как.');
      return reply(chatId, statsText(user), appKb);
    case '/cancel':
      return reply(chatId, cancelFlow(chatId) ? 'Задание прервано. Его можно продолжить позже: /tasks' : 'Нечего отменять.');
    case '/remind': {
      if (!user) return reply(chatId, 'Аккаунт не подключён. Отправьте /start, чтобы узнать как.');
      const want = (args[0] || '').toLowerCase();
      if (want === 'on' || want === 'off') setRemind(user.id, want === 'on');
      const on = remindOn(user.id);
      return reply(chatId, `⏰ Напоминание о серии: <b>${on ? 'включено' : 'выключено'}</b>
Приходит в ${config.telegram.reminderHour}:00, если вы ещё не заходили сегодня.`, {
        reply_markup: { inline_keyboard: [[{ text: on ? '🔕 Выключить' : '🔔 Включить', callback_data: on ? 'rm:off' : 'rm:on' }]] },
      });
    }
    case '/start': {
      const code = (args[0] || '').toUpperCase();
      // Приглашение студии: t.me/<бот>?start=join_<КОД> — показываем задание и ведём в него
      if (code.startsWith('JOIN_')) {
        const inv = code.slice(5);
        const c = one('SELECT id, title, description, reward, est_minutes, status FROM campaigns WHERE invite_code = ?', inv);
        if (!c || c.status !== 'active') return reply(chatId, '⚠️ Приглашение не найдено или набор закрыт. Другие задания: /tasks');
        const open = appButton('📱 Открыть задание', `/#/join/${inv}`) || { text: 'Открыть задание', url: `${config.publicUrl}/#/join/${inv}` };
        return reply(chatId, `🎮 <b>${escapeHtml(c.title)}</b>
${escapeHtml(c.description)}

⏱ ~${c.est_minutes || 5} мин · 🪙 +${c.reward} AB Points`, {
          reply_markup: { inline_keyboard: [[open], ...(user ? [[{ text: '▶ Пройти в чате', callback_data: `t:${c.id}` }]] : [])] },
        });
      }
      if (code) {
        const res = linkAccount(code, chatId, msg.from?.username);
        if (!res.ok) return reply(chatId, `⚠️ ${escapeHtml(res.reason)}`);
        return reply(
          chatId,
          `✅ <b>Аккаунт подтверждён</b>\n${escapeHtml(res.user.name)}, теперь уведомления ATTENTION BANK приходят сюда.` +
            (res.bonus ? `\n\n🎉 <b>+${res.bonus} AB Points</b> за подтверждение\nNew balance: <b>${res.user.balance} AB</b>` : '') +
            `\n\nКоманды: /tasks /stats /balance /help`,
          appKb
        );
      }
      if (user) return reply(chatId, `С возвращением, ${escapeHtml(user.name)}! Баланс: <b>${user.balance} AB</b>\nЗадания можно проходить прямо здесь: /tasks`, appKb);
      return reply(
        chatId,
        `👋 Это бот <b>ATTENTION BANK</b>.\n\nОткройте приложение кнопкой ниже — войдите или зарегистрируйтесь, и Telegram подключится автоматически.\n\nИли: сайт → Профиль → «Подключить Telegram», либо отправьте сюда <code>/start ВАШ_КОД</code>.\n\n${config.publicUrl}`,
        appKb
      );
    }
    case '/balance':
      if (!user) return reply(chatId, 'Аккаунт не подключён. Отправьте /start, чтобы узнать как.');
      return reply(chatId, `💳 Баланс: <b>${user.balance} AB Points</b>`, linkButton('Открыть кошелёк', '/#/wallet'));
    case '/history': {
      if (!user) return reply(chatId, 'Аккаунт не подключён. Отправьте /start, чтобы узнать как.');
      const rows = all('SELECT amount, title, created_at FROM transactions WHERE user_id = ? ORDER BY id DESC LIMIT 7', user.id);
      if (!rows.length) return reply(chatId, 'Транзакций пока нет. Выполните первое задание: /tasks');
      return reply(chatId, `<b>Последние транзакции</b>\n` + rows.map((r) => `${fmt(r.amount)} AB · ${escapeHtml(r.title)}`).join('\n'));
    }
    case '/tasks':
      return listTasks(chatId, user);
    case '/unlink':
      if (!user) return reply(chatId, 'Аккаунт и так не подключён.');
      unlinkTelegram(user.id);
      return reply(chatId, 'Telegram отключён от аккаунта. Уведомления больше не придут.');
    default:
      return reply(chatId, HELP + (user?.is_admin ? '\n\n🛠 /admin — сводка · /backup — копия базы' : ''), appKb);
  }
}

function tasksText() {
  const rows = all("SELECT * FROM campaigns WHERE status = 'active' ORDER BY id DESC LIMIT 5");
  if (!rows.length) return 'Сейчас нет активных заданий. Мы напишем, когда появятся.';
  return (
    '<b>Новые задания</b>\n\n' +
    rows.map((c) => `• <b>${escapeHtml(c.title)}</b>\n  ${categoryLabel(c.category)} · +${c.reward} AB\n  ${config.publicUrl}/#/tasks/${c.id}`).join('\n\n')
  );
}

// ---------- Запуск: polling или webhook ----------

let running = false;
export async function startBot() {
  if (!telegramEnabled()) {
    console.log('[telegram] TELEGRAM_BOT_TOKEN не задан — бот выключен (сайт работает, уведомления пишутся в консоль)');
    return;
  }
  try {
    const me = await call('getMe');
    if (!config.telegram.username) config.telegram.username = me.username;
    console.log(`[telegram] бот @${me.username} запущен (${config.telegram.mode})`);
    await call('setMyCommands', {
      commands: COMMANDS,
    });
  } catch (e) {
    console.error('[telegram] не удалось подключиться:', e.message);
    return;
  }
  await setupMenuButton();
  startReminders();

  if (config.telegram.mode === 'webhook') {
    // В адрес webhook вписываем чат с резервными копиями — так база найдётся после перезапуска (см. services/tgbackup.js)
    const bk = config.telegram.backupChatId ? null : webhookBackupChat();
    const url = webhookUrl(bk);
    await call('setWebhook', { url, secret_token: webhookSecretToken(), allowed_updates: ['message', 'callback_query'] })
      .then(() => rememberWebhookChat(bk))
      .catch((e) => console.error('[telegram] setWebhook:', e.message));
    console.log('[telegram] webhook:', url.replace(/\?.*$/, ''), bk ? '(резервные копии: чат администратора)' : '');
    return;
  }

  await call('deleteWebhook', {}).catch(() => {});
  running = true;
  let offset = 0;
  (async function loop() {
    while (running) {
      try {
        const updates = await call('getUpdates', { offset, timeout: 30, allowed_updates: ['message', 'callback_query'] });
        for (const u of updates || []) {
          offset = u.update_id + 1;
          await handleUpdate(u).catch((e) => console.error('[telegram] update error:', e));
        }
      } catch (e) {
        console.error('[telegram] polling:', e.message);
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  })();
}

export const stopBot = () => {
  running = false;
};

export { webhookSecretToken };
