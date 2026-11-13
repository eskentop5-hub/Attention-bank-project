// Письма через HTTP API провайдера (без npm-зависимостей): Resend или Brevo.
// Без настроек письма не отправляются — восстановление пароля работает через Telegram или администратора.
import { config } from '../config.js';
import { isDemo } from '../db.js';

export const emailEnabled = () => !!(config.email.provider && config.email.apiKey && config.email.from);

function parseFrom(from) {
  const m = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(from);
  return m ? { name: m[1] || 'ATTENTION BANK', email: m[2] } : { name: 'ATTENTION BANK', email: from.trim() };
}

/** Отправить письмо. Возвращает true, если провайдер принял письмо. В демо-песочнице письма не уходят. */
export async function sendEmail({ to, subject, text, html }) {
  if (!emailEnabled() || isDemo()) return false;
  const { provider, apiKey, from } = config.email;
  try {
    let res;
    if (provider === 'resend') {
      res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to: [to], subject, text, html }),
        signal: AbortSignal.timeout(15000),
      });
    } else if (provider === 'brevo') {
      res = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'api-key': apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ sender: parseFrom(from), to: [{ email: to }], subject, textContent: text, htmlContent: html }),
        signal: AbortSignal.timeout(15000),
      });
    } else {
      console.error('[mail] неизвестный EMAIL_PROVIDER:', provider);
      return false;
    }
    if (!res.ok) console.error('[mail] провайдер ответил', res.status, (await res.text()).slice(0, 300));
    return res.ok;
  } catch (e) {
    console.error('[mail]', e.message);
    return false;
  }
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/** Простое письмо в стиле сайта: заголовок, текст, кнопка */
export function letter({ title, text, button, link }) {
  const html = `<div style="font-family:Arial,sans-serif;background:#08080b;padding:24px;color:#f3e8d2">
  <div style="max-width:520px;margin:0 auto;background:#14100d;border:3px solid #f5c21b;padding:24px">
    <p style="margin:0 0 6px;color:#f5c21b;font-weight:bold;letter-spacing:.12em;font-size:12px">ATTENTION BANK</p>
    <h1 style="margin:0 0 12px;font-size:22px;color:#f3e8d2">${esc(title)}</h1>
    <p style="margin:0 0 18px;line-height:1.5">${esc(text)}</p>
    <a href="${esc(link)}" style="display:inline-block;background:#f5c21b;color:#08080b;padding:12px 18px;font-weight:bold;text-decoration:none">${esc(button)}</a>
    <p style="margin:18px 0 0;font-size:12px;color:#a3967f">Если это были не вы — просто проигнорируйте письмо.</p>
  </div></div>`;
  return { html, text: `${title}\n\n${text}\n\n${button}: ${link}\n\nЕсли это были не вы — проигнорируйте письмо.` };
}
