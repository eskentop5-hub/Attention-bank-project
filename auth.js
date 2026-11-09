import crypto from 'node:crypto';
import { one, run, now } from '../db.js';
import { config } from '../config.js';
import { HttpError, sha256 } from '../util.js';

// Пароли: scrypt + соль (встроено в Node, без зависимостей)
export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(password, stored) {
  const [alg, saltHex, hashHex] = String(stored).split('$');
  if (alg !== 'scrypt' || !saltHex || !hashHex) return false;
  const hash = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), 64, { N: 16384, r: 8, p: 1 });
  const expected = Buffer.from(hashHex, 'hex');
  return expected.length === hash.length && crypto.timingSafeEqual(expected, hash);
}

export const COOKIE = 'ab_session';

export function createSession(userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + config.sessionDays * 864e5).toISOString();
  run('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)', sha256(token), userId, expires);
  return { token, expires };
}

export function destroySession(token) {
  if (token) run('DELETE FROM sessions WHERE id = ?', sha256(token));
}

export function userFromToken(token) {
  if (!token) return null;
  const row = one(
    `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.id = ? AND s.expires_at > ?`,
    sha256(token),
    now()
  );
  return row || null;
}

export function sessionCookie(token, expires) {
  // По HTTPS cookie работает и внутри Telegram Web (сайт открыт во фрейме web.telegram.org).
  // Защита от CSRF при этом остаётся: сервер принимает только JSON и проверяет Origin.
  const attrs = config.publicUrl.startsWith('https://') ? 'SameSite=None; Secure; Partitioned' : 'SameSite=Lax';
  if (!token) return `${COOKIE}=; Path=/; HttpOnly; ${attrs}; Max-Age=0`;
  return `${COOKIE}=${token}; Path=/; HttpOnly; ${attrs}; Expires=${new Date(expires).toUTCString()}`;
}

// Простая защита от перебора паролей
const attempts = new Map();
export function checkLoginRate(key) {
  const t = Date.now();
  const list = (attempts.get(key) || []).filter((x) => t - x < 15 * 60e3);
  if (list.length >= 10) throw new HttpError(429, 'Слишком много попыток входа. Подождите 15 минут.');
  list.push(t);
  attempts.set(key, list);
}
export const resetLoginRate = (key) => attempts.delete(key);

// Безопасное представление пользователя для клиента
export function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    companyName: u.company_name,
    interests: JSON.parse(u.interests || '[]'),
    balance: u.balance,
    goalRewardId: u.goal_reward_id ?? null,
    notifyTelegram: !!u.notify_telegram,
    isDemo: !!u.is_demo,
    avatar: u.avatar || null,
    consentAt: u.consent_at,
    telegram: u.telegram_chat_id
      ? { linked: true, username: u.telegram_username, verifiedAt: u.telegram_verified_at }
      : { linked: false },
    createdAt: u.created_at,
  };
}

// ---------- Политика паролей (одинаковая для регистрации и смены пароля) ----------
const COMMON = new Set(['password', 'password1', 'qwerty123', 'qwertyui', '12345678', '123456789', '1234567890', '11111111', '00000000', 'abc12345', 'iloveyou', 'qwerty12', '1q2w3e4r', '1qaz2wsx', 'zaq12wsx', 'passw0rd', 'admin123', 'welcome1', 'letmein1', 'parol123', 'qazwsx123', 'asdfghjk', 'zxcvbnm1', 'kazakhstan', 'almaty123', 'astana123', 'shymkent1']);
/** Возвращает текст ошибки или null, если пароль подходит */
export function passwordProblem(password, { email = '', name = '' } = {}) {
  const p = String(password || '');
  if (p.length < 8) return 'Пароль: минимум 8 символов';
  if (p.length > 200) return 'Пароль слишком длинный';
  if (p !== p.trim()) return 'Пароль не должен начинаться или заканчиваться пробелом';
  if (!/\p{L}/u.test(p) || !/\d/.test(p)) return 'Пароль должен содержать и буквы, и цифры';
  if (/^(.)\1+$/.test(p)) return 'Пароль из одного повторяющегося символа слишком простой';
  if (COMMON.has(p.toLowerCase())) return 'Этот пароль слишком распространён — его легко угадать';
  const local = String(email).split('@')[0].toLowerCase();
  if (local.length >= 4 && p.toLowerCase().includes(local)) return 'Пароль не должен содержать ваш email';
  const nm = String(name).trim().toLowerCase();
  if (nm.length >= 4 && p.toLowerCase().includes(nm)) return 'Пароль не должен содержать ваше имя';
  return null;
}
