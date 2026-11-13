// РЕЗЕРВНЫЕ КОПИИ В TELEGRAM — без внешних хранилищ и без новых переменных окружения.
//
// Зачем: на бесплатном Render диск стирается при каждом деплое. R2/S3 требуют отдельного аккаунта,
// а бот у проекта уже есть. Поэтому копия базы хранится как ЗАКРЕПЛЁННЫЙ документ в чате бота
// с администратором (или в чате TELEGRAM_BACKUP_CHAT_ID, если он задан).
//
//  • Копия: снимок базы (VACUUM INTO) заменяет файл в одном и том же закреплённом сообщении
//    (editMessageMedia), поэтому чат не засоряется. Если сообщения нет — отправляем новое и закрепляем.
//  • Где искать после перезапуска: ID чата вписан в адрес webhook (…/api/telegram/webhook?bk=<ID>).
//    Адрес webhook хранит сам Telegram, его видит только владелец токена бота.
//  • Восстановление (до открытия базы): getWebhookInfo → чат → getChat.pinned_message → файл.
//    Принимаем только документ, отправленный САМИМ ботом (подделать отправителя в Telegram нельзя),
//    с меткой #ab_backup и совпадающей контрольной суммой SHA-256; файл должен быть настоящей базой SQLite.
//
// Важно: в копии есть email и хеши паролей (не сами пароли и не токены сессий — они тоже хранятся хешами).
// Чат с ботом — личный чат администратора, как и файл «Скачать базу» в Пульте.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { config } from '../config.js';
import { call, uploadFile, downloadFile, telegramEnabled, webhookUrl, webhookSecretToken } from '../telegram/api.js';
import { db } from '../db.js';

export const FILE_NAME = 'attention-bank-backup.db';
const TAG = '#ab_backup';
const SQLITE_HEADER = Buffer.from('SQLite format 3\0', 'latin1');
const CHAT_RE = /^-?\d{3,20}$/;

// boot: с чем стартовал сервер — 'existing' (база была на диске), 'restored', 'empty' (копии не нашлось), 'failed'
const fresh = () => ({ chatId: null, messageId: null, webhookChat: undefined, botId: null, bootChat: null, boot: 'existing', restoredMessageId: null, uploaded: false, conflict: false });
const st = fresh();
export const setBootState = (boot) => {
  st.boot = boot;
};

export const CONFLICT =
  'В чате с ботом уже есть копия базы, а сервер запустился с пустой базой. Чтобы не затереть данные, копии приостановлены. ' +
  'Перезапустите сервер (Render → Manual Deploy → Restart service) — база восстановится из копии. Если та копия не нужна — открепите её в Telegram.';

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const cleanChat = (v) => (v != null && CHAT_RE.test(String(v).trim()) ? String(v).trim() : null);

/** ID чата из адреса webhook (параметр bk) */
export function chatFromWebhookUrl(url) {
  try {
    return cleanChat(new URL(url).searchParams.get('bk'));
  } catch {
    return null;
  }
}

/** Куда сохранять копии (база уже открыта): TELEGRAM_BACKUP_CHAT_ID или Telegram первого администратора */
export function backupTargetChat() {
  if (!telegramEnabled()) return null;
  const env = cleanChat(config.telegram.backupChatId);
  if (env) return env;
  const a = db
    .prepare('SELECT telegram_chat_id FROM users WHERE is_admin = 1 AND telegram_chat_id IS NOT NULL AND blocked_at IS NULL ORDER BY id LIMIT 1')
    .get();
  return cleanChat(a?.telegram_chat_id);
}

/** Запомнить, какой чат сейчас вписан в webhook (чтобы не переустанавливать его без нужды) */
export const rememberWebhookChat = (chatId) => {
  st.webhookChat = chatId || null;
};
/** Что вписать в webhook при запуске бота: текущий чат копий или тот, что был там до перезапуска (не терять указатель) */
export const webhookBackupChat = () => backupTargetChat() || st.bootChat || null;

/** Если чат для копий поменялся (админ впервые привязал Telegram) — обновить адрес webhook */
async function syncWebhook(chatId) {
  if (config.telegram.mode !== 'webhook' || cleanChat(config.telegram.backupChatId)) return;
  if (st.webhookChat === chatId) return;
  await call('setWebhook', { url: webhookUrl(chatId), secret_token: webhookSecretToken(), allowed_updates: ['message', 'callback_query'] });
  st.webhookChat = chatId;
}

async function botId() {
  if (!st.botId) st.botId = (await call('getMe'))?.id ?? null;
  return st.botId;
}

/** Закреплённая копия в чате (или null). Проверяет, что сообщение отправил сам бот и это наша копия. */
export async function findPinnedBackup(chatId) {
  const me = await botId();
  const chat = await call('getChat', { chat_id: chatId });
  const m = chat?.pinned_message;
  if (!m || !me || m.from?.id !== me || !m.document) return null;
  const caption = String(m.caption || '');
  const sha = /sha256:([0-9a-f]{64})/.exec(caption)?.[1];
  if (!caption.includes(TAG) || !sha) return null;
  return { messageId: m.message_id, fileId: m.document.file_id, size: m.document.file_size || 0, sha, at: new Date((m.edit_date || m.date) * 1000).toISOString() };
}

/** Файл похож на целую базу SQLite с нашими таблицами */
function validDatabase(file) {
  let d;
  try {
    d = new DatabaseSync(file, { readOnly: true });
    if (d.prepare('PRAGMA quick_check').get()?.quick_check !== 'ok') return false;
    const tables = new Set(d.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name));
    return ['users', 'transactions', 'campaigns'].every((t) => tables.has(t));
  } catch {
    return false;
  } finally {
    try {
      d?.close();
    } catch {}
  }
}

/**
 * При запуске, ДО открытия базы: найти закреплённую копию и записать её в dbPath.
 * Возвращает { chatId, at, size } или null (копии нет / Telegram не настроен / проверка не прошла).
 */
export async function tgRestore(dbPath) {
  if (!telegramEnabled()) return null;
  let chatId = cleanChat(config.telegram.backupChatId);
  if (!chatId && config.telegram.mode === 'webhook') {
    const info = await call('getWebhookInfo');
    chatId = chatFromWebhookUrl(info?.url);
    st.webhookChat = chatId;
  }
  if (!chatId) return null;
  st.bootChat = chatId;
  const found = await findPinnedBackup(chatId);
  if (!found) {
    console.log('[backup] в Telegram нет закреплённой копии — начинаем с чистой базы');
    return null;
  }
  const f = await call('getFile', { file_id: found.fileId });
  const buf = await downloadFile(f.file_path);
  if (sha256(buf) !== found.sha) throw new Error('копия в Telegram повреждена (контрольная сумма не совпала)');
  if (!buf.subarray(0, 16).equals(SQLITE_HEADER)) throw new Error('файл в Telegram — не база SQLite');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const tmp = `${dbPath}.restore-${process.pid}`;
  fs.writeFileSync(tmp, buf);
  if (!validDatabase(tmp)) {
    fs.rmSync(tmp, { force: true });
    throw new Error('копия в Telegram не прошла проверку целостности');
  }
  for (const ext of ['-wal', '-shm']) fs.rmSync(dbPath + ext, { force: true });
  fs.renameSync(tmp, dbPath);
  Object.assign(st, { chatId, messageId: found.messageId, restoredMessageId: found.messageId });
  return { chatId, at: found.at, size: buf.length };
}

const caption = (buf, sha) => {
  const when = new Date(Date.now() + config.tzOffsetMin * 60e3).toISOString().replace('T', ' ').slice(0, 16);
  return [
    '🗄 Резервная копия базы ATTENTION BANK',
    `${when} · ${Math.max(1, Math.round(buf.length / 1024))} КБ`,
    'Не удаляйте и не открепляйте это сообщение: из него сервер сам восстанавливает базу после перезапуска.',
    `${TAG} sha256:${sha}`,
  ].join('\n');
};

/** Загрузить снимок в Telegram: заменить файл в закреплённом сообщении или отправить и закрепить новое */
export async function tgUpload(buf, chatId) {
  const sha = sha256(buf);
  const text = caption(buf, sha);
  if (st.chatId !== chatId || st.conflict) {
    const prev = await findPinnedBackup(chatId).catch(() => null);
    // Сервер стартовал с пустой базой, а в чате лежит чужая для этого запуска копия — не затираем её
    if (prev && (st.boot === 'empty' || st.boot === 'failed') && !st.uploaded && prev.messageId !== st.restoredMessageId) {
      Object.assign(st, { chatId, messageId: null, conflict: true, bootChat: chatId });
      await syncWebhook(chatId).catch(() => {});
      throw new Error(CONFLICT);
    }
    Object.assign(st, { chatId, messageId: prev?.messageId ?? null, conflict: false });
  }
  await syncWebhook(chatId).catch((e) => console.error('[backup] не удалось обновить webhook:', e.message));
  if (st.messageId) {
    try {
      await uploadFile(
        'editMessageMedia',
        { chat_id: chatId, message_id: st.messageId, media: { type: 'document', media: 'attach://file', caption: text } },
        { field: 'file', data: buf, name: FILE_NAME }
      );
      st.uploaded = true;
      return { messageId: st.messageId, sha, edited: true };
    } catch (e) {
      if (/not modified/i.test(e.message)) return { messageId: st.messageId, sha, edited: true };
      console.warn('[backup] не удалось заменить файл в закреплённом сообщении, отправляю новое:', e.message);
    }
  }
  const msg = await uploadFile('sendDocument', { chat_id: chatId, caption: text, disable_notification: true }, { field: 'document', data: buf, name: FILE_NAME });
  const old = st.messageId;
  st.messageId = msg.message_id;
  st.uploaded = true;
  await call('pinChatMessage', { chat_id: chatId, message_id: msg.message_id, disable_notification: true });
  if (old && old !== msg.message_id) {
    await call('unpinChatMessage', { chat_id: chatId, message_id: old }).catch(() => {});
    await call('deleteMessage', { chat_id: chatId, message_id: old }).catch(() => {});
  }
  return { messageId: msg.message_id, sha, edited: false };
}

/** Для тестов */
export const _resetTgBackupState = () => Object.assign(st, fresh());
