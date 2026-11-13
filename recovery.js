// Восстановление пароля и подтверждение email.
// Ссылка одноразовая, живёт 1 час (подтверждение email — 24 часа); в базе хранится только хеш токена.
// Ссылка уходит туда, где человек точно владеет каналом: на email (если настроен провайдер) и/или в привязанный Telegram.
// Ответ одинаковый для существующих и несуществующих адресов — по нему нельзя узнать, есть ли аккаунт.
import crypto from 'node:crypto';
import { one, run, tx, now, isDemo } from '../db.js';
import { config } from '../config.js';
import { bad, sha256, email as cleanEmail } from '../util.js';
import { passwordProblem, hashPassword } from './auth.js';
import { emailEnabled, sendEmail, letter } from './mail.js';
import { sendMessage, telegramEnabled } from '../telegram/api.js';
import { rateLimit, adminLog } from './ops.js';

const TTL = { reset: 60 * 60e3, verify_email: 24 * 60 * 60e3 };

function createToken(userId, purpose) {
  const token = crypto.randomBytes(32).toString('base64url');
  run('INSERT INTO password_resets (token_hash, user_id, purpose, expires_at) VALUES (?, ?, ?, ?)', sha256(token), userId, purpose, new Date(Date.now() + TTL[purpose]).toISOString());
  run('DELETE FROM password_resets WHERE expires_at < ?', new Date(Date.now() - 864e5).toISOString());
  return token;
}

export const recoveryChannels = () => ({ email: emailEnabled(), telegram: telegramEnabled() });

export async function requestReset({ email, ip }) {
  if (isDemo()) return { ok: true, demo: true, message: 'Это демо: у всех демо-аккаунтов пароль demo1234.' };
  const addr = cleanEmail(email);
  rateLimit(`reset-ip|${ip}`, 5, 15 * 60e3, 'Слишком много запросов. Попробуйте через 15 минут.');
  rateLimit(`reset-mail|${addr}`, 3, 60 * 60e3, 'Ссылка уже отправлена. Новую можно запросить через час.');
  const message = 'Если аккаунт с таким email существует, мы отправили ссылку для смены пароля на email и/или в привязанный Telegram. Ссылка действует 1 час.';
  const u = one("SELECT * FROM users WHERE email = ? AND role != 'system' AND deleted_at IS NULL AND blocked_at IS NULL", addr);
  if (!u) return { ok: true, message, channels: recoveryChannels() };
  const token = createToken(u.id, 'reset');
  const link = `${config.publicUrl}/#/reset/${token}`;
  if (emailEnabled()) {
    const l = letter({ title: 'Смена пароля', text: `${u.name}, кто-то (надеемся, вы) запросил смену пароля в ATTENTION BANK. Ссылка действует 1 час.`, button: 'Задать новый пароль', link });
    await sendEmail({ to: u.email, subject: 'ATTENTION BANK: смена пароля', text: l.text, html: l.html });
  }
  if (u.telegram_chat_id && telegramEnabled())
    await sendMessage(u.telegram_chat_id, `🔐 <b>Смена пароля</b>\nКто-то запросил смену пароля для вашего аккаунта. Если это вы — откройте ссылку (действует 1 час):\n${link}\n\nЕсли нет — ничего не делайте, пароль останется прежним.`).catch(() => {});
  return { ok: true, message, channels: recoveryChannels() };
}

function useToken(token, purpose) {
  const row = one('SELECT * FROM password_resets WHERE token_hash = ? AND purpose = ?', sha256(String(token || '')), purpose);
  if (!row || row.used_at || row.expires_at < now()) throw bad('Ссылка недействительна или устарела. Запросите новую.');
  return row;
}

export function checkResetToken(token) {
  const row = useToken(token, 'reset');
  const u = one('SELECT name, email FROM users WHERE id = ?', row.user_id);
  return { ok: true, name: u.name, email: u.email.replace(/^(.).*(@.*)$/, '$1•••$2') };
}

export function resetPassword({ token, password, confirm }) {
  return tx(() => {
    const row = useToken(token, 'reset');
    const u = one('SELECT * FROM users WHERE id = ?', row.user_id);
    const p = String(password || '');
    const err = passwordProblem(p, { email: u.email, name: u.name });
    if (err) throw bad(err);
    if (confirm !== undefined && confirm !== p) throw bad('Пароли не совпадают');
    run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(p), u.id);
    run('UPDATE password_resets SET used_at = ? WHERE token_hash = ?', now(), row.token_hash);
    // Все старые сессии завершаются: если пароль украли, злоумышленника выкинет
    run('DELETE FROM sessions WHERE user_id = ?', u.id);
    return { ok: true, email: u.email };
  });
}

/** Администратор выдаёт ссылку вручную (когда нет ни почты, ни Telegram) */
export function adminResetLink(admin, userId) {
  const u = one("SELECT id, email FROM users WHERE id = ? AND role != 'system'", userId);
  if (!u) throw bad('Пользователь не найден');
  const token = createToken(u.id, 'reset');
  adminLog(admin.id, 'reset_link', `user:${u.id}`, u.email);
  return { link: `${config.publicUrl}/#/reset/${token}`, expiresInMinutes: 60 };
}

export async function requestEmailVerify(user, ip) {
  if (isDemo()) return { ok: false, message: 'В демо письма не отправляются.' };
  if (!emailEnabled()) return { ok: false, message: 'Отправка писем пока не настроена на сервере.' };
  if (user.email_verified_at) return { ok: true, already: true };
  rateLimit(`verify|${user.id}`, 3, 60 * 60e3, 'Письмо уже отправлено. Новое можно запросить через час.');
  rateLimit(`verify-ip|${ip}`, 10, 60 * 60e3);
  const token = createToken(user.id, 'verify_email');
  const l = letter({ title: 'Подтвердите email', text: `${user.name}, подтвердите, что это ваш адрес — так вы сможете восстановить доступ к аккаунту.`, button: 'Подтвердить email', link: `${config.publicUrl}/#/verify/${token}` });
  const sent = await sendEmail({ to: user.email, subject: 'ATTENTION BANK: подтверждение email', text: l.text, html: l.html });
  return { ok: sent, message: sent ? 'Письмо отправлено. Проверьте почту (и папку «Спам»).' : 'Не удалось отправить письмо. Попробуйте позже.' };
}

export function confirmEmail(token) {
  return tx(() => {
    const row = useToken(token, 'verify_email');
    run('UPDATE users SET email_verified_at = COALESCE(email_verified_at, ?) WHERE id = ?', now(), row.user_id);
    run('UPDATE password_resets SET used_at = ? WHERE token_hash = ?', now(), row.token_hash);
    return { ok: true };
  });
}
