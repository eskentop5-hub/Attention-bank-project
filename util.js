import crypto from 'node:crypto';

export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}
export const bad = (msg, details) => new HttpError(400, msg, details);
export const forbidden = (msg = 'Нет доступа') => new HttpError(403, msg);
export const notFound = (msg = 'Не найдено') => new HttpError(404, msg);

export function str(v, { field, min = 0, max = 1000, required = true } = {}) {
  if (v === undefined || v === null) v = '';
  if (typeof v !== 'string') throw bad(`Поле «${field}» должно быть текстом`);
  v = v.trim();
  if (required && v.length === 0) throw bad(`Заполните поле «${field}»`);
  if (v.length && v.length < min) throw bad(`«${field}»: минимум ${min} символов`);
  if (v.length > max) throw bad(`«${field}»: максимум ${max} символов`);
  return v;
}

export function int(v, { field, min = -Infinity, max = Infinity } = {}) {
  const n = Number(v);
  if (!Number.isInteger(n)) throw bad(`Поле «${field}» должно быть целым числом`);
  if (n < min || n > max) throw bad(`«${field}»: допустимо от ${min} до ${max}`);
  return n;
}

export function email(v) {
  const e = str(v, { field: 'Email', max: 200 }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)) throw bad('Введите корректный email');
  return e;
}

export function url(v, field = 'Ссылка') {
  const s = str(v, { field, max: 500, required: false });
  if (!s) return null;
  try {
    const u = new URL(s);
    if (!['http:', 'https:'].includes(u.protocol)) throw new Error();
    return u.toString();
  } catch {
    throw bad(`«${field}»: нужна ссылка вида https://...`);
  }
}

export const parseJson = (s, d) => {
  try {
    return s ? JSON.parse(s) : d;
  } catch {
    return d;
  }
};

export const randomCode = (len = 8, alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789') => {
  const bytes = crypto.randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
};

export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
