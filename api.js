// Низкоуровневый клиент Telegram Bot API (через встроенный fetch, без библиотек)
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
