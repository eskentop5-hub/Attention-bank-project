// Telegram-бот ATTENTION BANK
// • /start <код> — привязка и верификация аккаунта (1 Telegram = 1 аккаунт)
// • /balance, /history, /tasks, /unlink, /help
// • Уведомления об одобрении заданий приходят автоматически (services/notifications.js)
import crypto from 'node:crypto';
import { config } from '../config.js';
import { one, all, run, tx, now } from '../db.js';
import { call, sendMessage, escapeHtml, linkButton, telegramEnabled } from './api.js';
import { postTransaction } from '../services/ledger.js';
import { notify } from '../services/notifications.js';
import { randomCode } from '../util.js';
import { categoryLabel } from '../catalog.js';

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
      bonus = config.telegram.verifyBonus;
      postTransaction({ userId: user.id, amount: bonus, type: 'bonus', title: 'Подтверждение аккаунта через Telegram', refType: 'telegram_verify', refId: user.id });
    }
    notify(user.id, {
      kind: 'telegram',
      title: 'Telegram подключён',
      body: bonus ? `Аккаунт подтверждён. Бонус +${bonus} AB` : 'Уведомления будут приходить в Telegram',
      telegram: false,
    });
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
  const msg = update.message || update.edited_message;
  if (!msg?.text || !msg.chat) return;
  const chatId = msg.chat.id;
  const isPrivate = msg.chat.type === 'private';
  const [rawCmd, ...args] = msg.text.trim().split(/\s+/);
  const cmd = rawCmd.split('@')[0].toLowerCase();
  const user = one('SELECT * FROM users WHERE telegram_chat_id = ?', String(chatId));

  if (cmd === '/chatid') {
    // Помогает узнать ID группы для TELEGRAM_GROUP_ID
    return reply(chatId, `ID этого чата: <code>${chatId}</code>\nВставьте его в TELEGRAM_GROUP_ID.`);
  }

  if (!isPrivate) {
    // В группе отвечаем только на /tasks и /chatid
    if (cmd === '/tasks') return reply(chatId, tasksText(), linkButton('Все задания', '/#/tasks'));
    return;
  }

  switch (cmd) {
    case '/start': {
      const code = (args[0] || '').toUpperCase();
      if (code) {
        const res = linkAccount(code, chatId, msg.from?.username);
        if (!res.ok) return reply(chatId, `⚠️ ${escapeHtml(res.reason)}`);
        return reply(
          chatId,
          `✅ <b>Аккаунт подтверждён</b>\n${escapeHtml(res.user.name)}, теперь уведомления ATTENTION BANK приходят сюда.` +
            (res.bonus ? `\n\n🎉 <b>+${res.bonus} AB Points</b> за подтверждение\nNew balance: <b>${res.user.balance} AB</b>` : '') +
            `\n\nКоманды: /balance /history /tasks /help`
        );
      }
      if (user) return reply(chatId, `С возвращением, ${escapeHtml(user.name)}! Баланс: <b>${user.balance} AB</b>\nКоманды: /balance /history /tasks`);
      return reply(
        chatId,
        `👋 Это бот <b>ATTENTION BANK</b>.\n\nЧтобы подключить аккаунт: откройте сайт → Профиль → «Подключить Telegram» и нажмите на ссылку. Или отправьте сюда:\n<code>/start ВАШ_КОД</code>\n\n${config.publicUrl}`
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
      return reply(chatId, tasksText(), linkButton('Все задания', '/#/tasks'));
    case '/unlink':
      if (!user) return reply(chatId, 'Аккаунт и так не подключён.');
      unlinkTelegram(user.id);
      return reply(chatId, 'Telegram отключён от аккаунта. Уведомления больше не придут.');
    default:
      return reply(chatId, '<b>Команды</b>\n/balance — баланс\n/history — последние транзакции\n/tasks — новые задания\n/unlink — отключить Telegram');
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
      commands: [
        { command: 'balance', description: 'Баланс AB Points' },
        { command: 'history', description: 'Последние транзакции' },
        { command: 'tasks', description: 'Новые задания' },
        { command: 'unlink', description: 'Отключить Telegram' },
        { command: 'help', description: 'Помощь' },
      ],
    });
  } catch (e) {
    console.error('[telegram] не удалось подключиться:', e.message);
    return;
  }

  if (config.telegram.mode === 'webhook') {
    const url = `${config.publicUrl}/api/telegram/webhook`;
    await call('setWebhook', { url, secret_token: webhookSecretToken(), allowed_updates: ['message'] }).catch((e) =>
      console.error('[telegram] setWebhook:', e.message)
    );
    console.log('[telegram] webhook:', url);
    return;
  }

  await call('deleteWebhook', {}).catch(() => {});
  running = true;
  let offset = 0;
  (async function loop() {
    while (running) {
      try {
        const updates = await call('getUpdates', { offset, timeout: 30, allowed_updates: ['message'] });
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

// Telegram присылает этот токен в заголовке X-Telegram-Bot-Api-Secret-Token
export const webhookSecretToken = () => crypto.createHash('sha256').update(config.telegram.webhookSecret).digest('hex');
