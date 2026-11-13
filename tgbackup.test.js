// v12: резервные копии базы в Telegram (без внешних хранилищ) и защита создания администратора.
// Telegram подменён «фальшивым сервером» в памяти: сообщения, закрепы, файлы и адрес webhook.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ab-tgb-'));
process.env.DB_PATH = path.join(dir, 'real.db');
process.env.DEMO_MODE = '0';
process.env.SEED_DEMO = '0';
process.env.DEMO_SANDBOX = '0';
process.env.TELEGRAM_BOT_TOKEN = '123456:TEST';
process.env.TELEGRAM_MODE = 'webhook';
process.env.TELEGRAM_BACKUP_CHAT_ID = '';
process.env.PUBLIC_URL = 'https://ab.example.com';
process.env.KEEP_AWAKE = '0';
process.env.ADMIN_EMAIL = 'owner@test.kz';
process.env.ADMIN_PASSWORD = 'OwnerPass2026';
process.env.BACKUP_S3_ENDPOINT = '';

const BOT = { id: 999, is_bot: true, username: 'TestBot', first_name: 'Test' };
const tg = { webhook: '', msgs: new Map(), pinned: new Map(), files: new Map(), calls: [], next: 100 };
const sec = () => Math.floor(Date.now() / 1000);

const api = await import('../server/telegram/api.js');
api.setTransport(async (method, p) => {
  tg.calls.push([method, p]);
  switch (method) {
    case 'getMe':
      return BOT;
    case 'setWebhook':
      tg.webhook = p.url;
      return true;
    case 'getWebhookInfo':
      return { url: tg.webhook };
    case 'getChat': {
      const id = tg.pinned.get(String(p.chat_id));
      return { id: Number(p.chat_id), type: 'private', pinned_message: id ? structuredClone(tg.msgs.get(id)) : undefined };
    }
    case 'pinChatMessage':
      tg.pinned.set(String(p.chat_id), p.message_id);
      return true;
    case 'deleteMessage':
      tg.msgs.delete(p.message_id);
      return true;
    case 'getFile':
      return { file_id: p.file_id, file_path: `documents/${p.file_id}` };
    case 'sendMessage':
      return { message_id: tg.next++, from: BOT, chat: { id: Number(p.chat_id) }, date: sec(), text: p.text };
    default:
      return true;
  }
});
api.setFileTransport({
  async upload(method, fields, file) {
    tg.calls.push([method, fields]);
    const fileId = `f${tg.next++}`;
    tg.files.set(`documents/${fileId}`, Buffer.from(file.data));
    const document = { file_id: fileId, file_name: file.name, file_size: file.data.length };
    if (method === 'sendDocument') {
      const m = { message_id: tg.next++, from: BOT, chat: { id: Number(fields.chat_id) }, date: sec(), document, caption: fields.caption };
      tg.msgs.set(m.message_id, m);
      return m;
    }
    if (method === 'editMessageMedia') {
      const media = typeof fields.media === 'string' ? JSON.parse(fields.media) : fields.media;
      const m = tg.msgs.get(Number(fields.message_id));
      if (!m) throw new Error('Telegram editMessageMedia: Bad Request: message to edit not found');
      Object.assign(m, { document, caption: media.caption, edit_date: sec() });
      return m;
    }
    throw new Error(`unexpected ${method}`);
  },
  async download(p) {
    const b = tg.files.get(p);
    if (!b) throw new Error('Telegram: файл не скачался (404)');
    return b;
  },
});

const { createServer } = await import('../server/app.js');
const { db, platformAccountId, run, one } = await import('../server/db.js');
const { ensureAdmin } = await import('../server/services/admin.js');
const { config } = await import('../server/config.js');
const backup = await import('../server/services/backup.js');
const tgb = await import('../server/services/tgbackup.js');
const { createLinkCode, linkAccount } = await import('../server/telegram/bot.js');

let server, base;
before(async () => {
  platformAccountId();
  ensureAdmin();
  server = createServer();
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
});
after(() => {
  server.close();
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const post = (url, body) =>
  fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, data: await r.json() }));
const waitFor = async (fn, ms = 3000) => {
  const t = Date.now();
  while (!fn()) {
    if (Date.now() - t > ms) throw new Error('не дождались');
    await new Promise((r) => setTimeout(r, 20));
  }
};

test('администратор: без надёжного пароля не создаётся и не повышается; email админа зарезервирован', async () => {
  const saved = { ...config.admin };
  try {
    // Кто-то заранее завёл аккаунт с адресом, который потом укажут как ADMIN_EMAIL
    run("INSERT INTO users (email, password_hash, name, role) VALUES ('boss@test.kz', 'x', 'Чужой', 'user')");
    Object.assign(config.admin, { email: 'boss@test.kz', password: 'short1234' });
    assert.equal(ensureAdmin(), null, 'короткий пароль — администратора нет');
    assert.equal(one("SELECT is_admin FROM users WHERE email = 'boss@test.kz'").is_admin, 0, 'чужой аккаунт НЕ получил права');

    let r = await post('/api/auth/login', { email: 'boss@test.kz', password: 'anything' });
    assert.equal(r.status, 400);
    assert.match(r.data.error, /Неверный email или пароль/, 'аккаунт есть — обычная ошибка входа');

    Object.assign(config.admin, { email: 'nobody@test.kz', password: 'short' });
    ensureAdmin();
    r = await post('/api/auth/login', { email: 'nobody@test.kz', password: 'short' });
    assert.match(r.data.error, /ADMIN_PASSWORD короче 10 символов/, 'владелец видит, что исправить');
    r = await post('/api/auth/register', { email: 'nobody@test.kz', password: 'Str0ng-Pass-2026', name: 'Хакер', consent: true, ageConfirmed: true });
    assert.equal(r.status, 400);
    assert.match(r.data.error, /зарезервирован/);
    const h = await fetch(base + '/api/health').then((x) => x.json());
    assert.equal(h.admin, false);
    assert.equal(h.version, '13.0.0');

    // Надёжный пароль: аккаунт становится админским, а чужой пароль заменяется паролем из настроек
    Object.assign(config.admin, { email: 'boss@test.kz', password: 'BossPass-2026' });
    assert.ok(ensureAdmin());
    const u = one("SELECT is_admin, password_hash FROM users WHERE email = 'boss@test.kz'");
    assert.equal(u.is_admin, 1);
    assert.notEqual(u.password_hash, 'x');
    run("UPDATE users SET is_admin = 0, blocked_at = ? WHERE email = 'boss@test.kz'", new Date().toISOString());
  } finally {
    Object.assign(config.admin, saved);
    ensureAdmin();
  }
});

test('копии в Telegram: включаются привязкой Telegram админа, обновляют одно закреплённое сообщение, восстанавливаются после «перезапуска»', async () => {
  // Пока Telegram админа не привязан — копии выключены, но подсказка говорит, как включить
  assert.equal(backup.backupProvider(), null);
  let r = await backup.backupNow({ force: true });
  assert.equal(r.ok, false);
  assert.match(r.reason, /привяжите Telegram/);
  assert.equal(backup.backupStatus().telegramPossible, true);

  // Админ привязывает Telegram → первая копия уходит сразу: документ + закреп + чат вписан в адрес webhook
  const admin = one('SELECT id FROM users WHERE email = ?', config.admin.email);
  const link = linkAccount(createLinkCode(admin.id).code, 555, 'owner');
  assert.equal(link.ok, true);
  await waitFor(() => tg.pinned.has('555'));
  assert.equal(backup.backupProvider(), 'telegram');
  const first = tg.pinned.get('555');
  const m = tg.msgs.get(first);
  assert.equal(m.from.id, BOT.id);
  assert.equal(m.document.file_name, tgb.FILE_NAME);
  assert.match(m.caption, /#ab_backup sha256:[0-9a-f]{64}/);
  assert.equal(tgb.chatFromWebhookUrl(tg.webhook), '555', 'ID чата сохранён в адресе webhook у Telegram');
  assert.ok(tg.webhook.startsWith('https://ab.example.com/api/telegram/webhook?bk=555'));
  await waitFor(() => tg.calls.some(([method, p]) => method === 'sendMessage' && /Резервные копии базы включены/.test(p.text)));

  // Новые данные → копия заменяет файл в ТОМ ЖЕ сообщении (чат не засоряется)
  run("INSERT INTO users (email, password_hash, name, role) VALUES ('tester@test.kz', 'x', 'Тестер Новый', 'user')");
  r = await backup.backupNow();
  assert.equal(r.ok, true);
  assert.equal(r.provider, 'telegram');
  assert.equal(r.edited, true);
  assert.equal(tg.pinned.get('555'), first, 'закреплённое сообщение то же самое');
  assert.equal([...tg.msgs.values()].filter((x) => x.document).length, 1, 'в чате одна копия');
  r = await backup.backupNow();
  assert.equal(r.skipped, true, 'без изменений копия не делается');

  // «Перезапуск Render»: диска нет, состояние сервера пустое — находим копию через адрес webhook
  tgb._resetTgBackupState();
  const fresh = path.join(dir, 'after-restart', 'app.db');
  const restored = await backup.restoreIfNeeded(fresh);
  assert.equal(restored.chatId, '555');
  const d = new DatabaseSync(fresh, { readOnly: true });
  assert.equal(d.prepare("SELECT name FROM users WHERE email = 'tester@test.kz'").get().name, 'Тестер Новый');
  assert.equal(d.prepare('SELECT telegram_chat_id FROM users WHERE id = ?').get(admin.id).telegram_chat_id, '555');
  d.close();
  assert.equal(await backup.restoreIfNeeded(fresh), false, 'если база на диске есть — ничего не трогаем');

  // Если закреплённое сообщение пропало — отправляем новое и закрепляем его
  tg.msgs.delete(first);
  run("UPDATE users SET name = 'Тестер Изменён' WHERE email = 'tester@test.kz'");
  r = await backup.backupNow();
  assert.equal(r.ok, true);
  assert.equal(r.edited, false);
  assert.notEqual(tg.pinned.get('555'), first);
});

test('восстановление принимает только целую копию, отправленную самим ботом', async () => {
  const fresh = () => path.join(dir, `r-${Math.random().toString(36).slice(2)}`, 'app.db');
  const pinnedId = tg.pinned.get('555');
  const orig = structuredClone(tg.msgs.get(pinnedId));

  // Подделка: тот же файл, но закрепил человек (отправитель — не бот)
  tg.msgs.get(pinnedId).from = { id: 777, is_bot: false };
  tgb._resetTgBackupState();
  assert.equal(await backup.restoreIfNeeded(fresh()), false);

  // Подмена файла: контрольная сумма не совпадает
  tg.msgs.set(pinnedId, structuredClone(orig));
  tg.files.set(`documents/${orig.document.file_id}`, Buffer.from('SQLite format 3\0 подмена'));
  tgb._resetTgBackupState();
  const p = fresh();
  assert.equal(await backup.restoreIfNeeded(p), false);
  assert.equal(fs.existsSync(p), false, 'испорченная копия не записана на место базы');
  assert.match(backup.backupStatus().lastError, /контрольная сумма/);

  // Чат с ботом без закрепа — чистый старт
  tg.pinned.delete('555');
  tgb._resetTgBackupState();
  assert.equal(await backup.restoreIfNeeded(fresh()), false);
});

test('сервер стартовал с пустой базой, а в чате есть прежняя копия — не затираем её, указатель в webhook сохраняем', async () => {
  // Прежняя целая копия снова закреплена
  tgb._resetTgBackupState();
  run("UPDATE users SET name = 'Перед конфликтом' WHERE email = 'tester@test.kz'");
  let r = await backup.backupNow({ force: true });
  assert.equal(r.ok, true);
  const kept = tg.pinned.get('555');
  const keptFile = tg.msgs.get(kept).document.file_id;

  // «Перезапуск», восстановление не удалось (Telegram не ответил) — сервер работает с пустой базой
  tgb._resetTgBackupState();
  tgb.setBootState('failed');
  tg.webhook = 'https://ab.example.com/api/telegram/webhook';
  r = await backup.backupNow({ force: true });
  assert.equal(r.ok, false);
  assert.match(r.reason, /копии приостановлены/);
  assert.equal(tg.msgs.get(kept).document.file_id, keptFile, 'прежняя копия не тронута');
  assert.equal(tgb.chatFromWebhookUrl(tg.webhook), '555', 'указатель на чат вернули в webhook — перезапуск найдёт копию');
  assert.equal(tgb.webhookBackupChat(), '555');

  // Админ сознательно открепил старую копию — копии продолжаются
  tg.pinned.delete('555');
  r = await backup.backupNow({ force: true });
  assert.equal(r.ok, true);
  assert.notEqual(tg.pinned.get('555'), kept);
});
