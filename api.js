// Низкоуровневый клиент Telegram Bot API (через встроенный fetch, без библиотек)
import crypto from 'node:crypto';
import { config } from '../config.js';

export const telegramEnabled = () => Boolean(config.telegram.token);

// В тестах можно подменить транспорт
let transport = async (method, payload) => {
  const res = await fetch(`https://api.telegram.org/bot${config.telegram.token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(method === 'getUpdates' ? 40000 : 15000),
  });
  const data = await res.json().catch(() => ({}));
  if (!data.ok) throw new Error(`Telegram ${method}: ${data.description || res.status}`);
  return data.result;
};
export const setTransport = (fn) => {
  transport = fn;
};

export async function call(method, payload = {}) {
  if (!telegramEnabled()) return null;
  return transport(method, payload);
}

// Файлы: загрузка (multipart/form-data) и скачивание. Используются резервными копиями базы.
let fileTransport = {
  async upload(method, fields, file) {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.append(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
    form.append(file.field, new Blob([file.data]), file.name);
    const res = await fetch(`https://api.telegram.org/bot${config.telegram.token}/${method}`, { method: 'POST', body: form, signal: AbortSignal.timeout(60000) });
    const data = await res.json().catch(() => ({}));
    if (!data.ok) throw new Error(`Telegram ${method}: ${data.description || res.status}`);
    return data.result;
  },
  async download(filePath) {
    const res = await fetch(`https://api.telegram.org/file/bot${config.telegram.token}/${filePath}`, { signal: AbortSignal.timeout(60000) });
    if (!res.ok) throw new Error(`Telegram: файл не скачался (${res.status})`);
    return Buffer.from(await res.arrayBuffer());
  },
};
export const setFileTransport = (t) => {
  fileTransport = { ...fileTransport, ...t };
};
export async function uploadFile(method, fields, file) {
  if (!telegramEnabled()) return null;
  return fileTransport.upload(method, fields, file);
}
export const downloadFile = (filePath) => fileTransport.download(filePath);

// Webhook: Telegram присылает этот токен в заголовке X-Telegram-Bot-Api-Secret-Token
export const webhookSecretToken = () => crypto.createHash('sha256').update(config.telegram.webhookSecret).digest('hex');
// Адрес webhook. Параметр bk — ID чата с резервными копиями базы: Telegram хранит адрес webhook у себя,
// поэтому после перезапуска сервера (когда база стёрта) мы узнаём из него, откуда восстановиться.
export const webhookUrl = (backupChatId) =>
  `${config.publicUrl}/api/telegram/webhook${backupChatId ? `?bk=${encodeURIComponent(backupChatId)}` : ''}`;

const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export { escapeHtml };

export async function sendMessage(chatId, text, extra = {}) {
  if (!telegramEnabled()) {
    console.log(`[telegram:off] → ${chatId}: ${text.replace(/<[^>]+>/g, '').replace(/\n/g, ' | ')}`);
    return null;
  }
  try {
    return await call('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true, ...extra });
  } catch (e) {
    console.error('[telegram] sendMessage failed:', e.message);
    return null;
  }
}

// Кнопка-ссылка на сайт (Telegram принимает только публичные http(s) адреса, не localhost)
export function linkButton(text, path) {
  const href = `${config.publicUrl}${path}`;
  if (/localhost|127\.0\.0\.1/.test(href)) return {};
  return { reply_markup: { inline_keyboard: [[{ text, url: href }]] } };
}
