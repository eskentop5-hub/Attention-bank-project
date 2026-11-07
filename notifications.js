import { one, all, run, now, onCommit } from '../db.js';
import { sendMessage, linkButton } from '../telegram/api.js';

/**
 * Уведомление пользователю: в приложении + в Telegram (если аккаунт привязан).
 * Telegram-сообщение уходит только после успешного COMMIT транзакции.
 */
export function notify(userId, { kind = 'info', title, body, link = null, telegram = null }) {
  run('INSERT INTO notifications (user_id, kind, title, body, link) VALUES (?, ?, ?, ?, ?)', userId, kind, title, body, link);
  const u = one('SELECT telegram_chat_id, notify_telegram FROM users WHERE id = ?', userId);
  // Уведомления в Telegram — только если человек их не отключил в профиле
  if (u?.telegram_chat_id && u.notify_telegram && telegram !== false) {
    const text = telegram || `<b>${title}</b>\n${body}`;
    onCommit(() => sendMessage(u.telegram_chat_id, text, link ? linkButton('Открыть ATTENTION BANK', link) : {}));
  }
}

export const listNotifications = (userId, limit = 30) =>
  all('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT ?', userId, limit);

export const unreadCount = (userId) =>
  one('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL', userId).n;

export const markAllRead = (userId) =>
  run('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL', now(), userId);
