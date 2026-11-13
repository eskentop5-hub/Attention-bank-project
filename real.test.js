// v11: настоящий режим + демо-песочница, деньги по счёту, администратор, восстановление пароля,
// рефералы, уровни, журнал ошибок, SEO-маршруты, подпись S3.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ab-real-'));
process.env.DB_PATH = path.join(dir, 'real.db');
process.env.DEMO_MODE = '0';
process.env.SEED_DEMO = '0';
process.env.DEMO_SANDBOX = '1';
process.env.TELEGRAM_BOT_TOKEN = '';
process.env.ADMIN_EMAIL = 'admin@test.kz';
process.env.ADMIN_PASSWORD = 'AdminPass2026';
process.env.REFERRAL_BONUS = '5';
process.env.PLATFORM_FEE_PERCENT = '20';
process.env.REGISTER_PER_HOUR = '1000';

const { createServer } = await import('../server/app.js');
const { db, platformAccountId } = await import('../server/db.js');
const { ensureAdmin } = await import('../server/services/admin.js');
const { treasury } = await import('../server/services/economy.js');
const { verifyAllLedgers } = await import('../server/services/ledger.js');

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

// Клиент с полноценной «банкой» cookie (несколько Set-Cookie за ответ)
function client() {
  const jar = new Map();
  return async (method, url, body, { redirect = 'follow' } = {}) => {
    const res = await fetch(base + url, {
      method,
      redirect,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(jar.size ? { Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    for (const c of res.headers.getSetCookie()) {
      const [kv, ...attrs] = c.split(';');
      const [k, ...v] = kv.split('=');
      if (attrs.some((a) => /max-age=0/i.test(a))) jar.delete(k.trim());
      else jar.set(k.trim(), v.join('='));
    }
    const ct = res.headers.get('content-type') || '';
    return { status: res.status, headers: res.headers, data: ct.includes('json') ? await res.json() : await res.text() };
  };
}
const reg = (c, email, extra = {}) =>
  c('POST', '/api/auth/register', { email, password: 'Testpass42', name: 'Тест Тестов', consent: true, ageConfirmed: true, ...extra });
const realUsers = () => db.prepare("SELECT COUNT(*) AS n FROM users WHERE email LIKE '%@attention.bank' AND role != 'system'").get().n;

test('настоящий режим чистый, а демо — отдельная песочница', async () => {
  const guest = client();
  let r = await guest('GET', '/api/meta');
  assert.equal(r.data.mode, 'real');
  assert.equal(r.data.demoMode, false);
  r = await guest('GET', '/api/public/rewards');
  assert.equal(r.data.rewards.length, 0, 'в настоящей базе нет демо-наград');

  r = await guest('POST', '/api/mode', { mode: 'demo' });
  assert.equal(r.data.mode, 'demo');
  r = await guest('GET', '/api/meta');
  assert.equal(r.data.mode, 'demo');
  assert.equal(r.data.demoMode, true);
  r = await guest('POST', '/api/demo/login', { as: 'user' });
  assert.equal(r.status, 200);
  assert.equal(r.data.user.email, 'demo@attention.bank');
  r = await guest('GET', '/api/rewards');
  assert.ok(r.data.rewards.length > 0, 'в демо есть каталог');
  r = await guest('GET', '/api/home');
  assert.equal(r.status, 200);

  // Действия в демо не попадают в настоящую базу
  assert.equal(realUsers(), 0);
  // Выход из демо: снова настоящая база, демо-сессия не мешает
  r = await guest('POST', '/api/mode', { mode: 'real' });
  r = await guest('GET', '/api/me');
  assert.equal(r.data.user, null);
  // В настоящем режиме демо-вход недоступен
  r = await guest('POST', '/api/demo/login', { as: 'user' });
  assert.equal(r.status, 403);
});

test('деньги в настоящем режиме: счёт → подтверждение админом → AB; вывод → отклонение с возвратом', async () => {
  const studio = client();
  const adm = client();
  const user = client();
  let r = await reg(studio, 'studio@real.kz', { role: 'company', companyName: 'Real Studio' });
  assert.equal(r.status, 200);

  r = await studio('POST', '/api/company/deposit', { amount: 500 });
  assert.equal(r.status, 403, 'бесплатного пополнения в настоящем режиме нет');

  r = await studio('POST', '/api/company/topups', { amount: 3000, note: 'Пилот' });
  assert.equal(r.status, 200);
  const topupId = r.data.topup.id;
  assert.equal(r.data.topup.status, 'requested');
  assert.match(r.data.topup.invoiceNo, /^AB-\d{8}-\d{5}$/);
  assert.equal(r.data.topup.amountKzt, 30000);
  assert.equal(r.data.balance, 0, 'до подтверждения оплаты баллов нет');

  r = await studio('POST', `/api/admin/topups/${topupId}/approve`, {});
  assert.equal(r.status, 403, 'подтверждать может только администратор');

  r = await adm('POST', '/api/auth/login', { email: 'admin@test.kz', password: 'AdminPass2026' });
  assert.equal(r.status, 200);
  assert.equal(r.data.user.isAdmin, true);
  r = await adm('GET', '/api/admin/overview');
  assert.equal(r.data.counts.pendingTopups, 1);
  r = await adm('POST', `/api/admin/topups/${topupId}/approve`, { note: 'Платёж получен' });
  assert.equal(r.status, 200);
  assert.equal(r.data.topup.status, 'paid');
  r = await adm('POST', `/api/admin/topups/${topupId}/approve`, {});
  assert.equal(r.status, 400, 'дважды начислить нельзя');
  r = await studio('GET', '/api/company/overview');
  assert.equal(r.data.balance, 3000);
  assert.equal(treasury().ok, true);

  // Кампания только для опытных: новичок не может начать
  r = await studio('POST', '/api/company/campaigns', {
    title: 'Тест для опытных', description: 'Проверка допуска по уровню тестировщика в настоящем режиме', category: 'game_testing',
    reward: 50, maxParticipants: 5, minSeconds: 0, minLevel: 2, questions: [{ type: 'rating', label: 'Оценка' }],
  });
  assert.equal(r.status, 200);
  const hardId = r.data.campaign.id;
  assert.equal(r.data.campaign.minLevel, 2);
  await reg(user, 'tester@real.kz');
  r = await user('GET', '/api/tasks');
  assert.equal(r.data.tasks.find((t) => t.id === hardId).locked, true);
  r = await user('GET', `/api/tasks/${hardId}`);
  assert.equal(r.data.task.locked, true, 'страница задания тоже показывает замок');
  assert.equal(r.data.task.minLevelName, 'Опытный');
  assert.equal(r.data.task.myLevelName, 'Новичок');
  r = await user('POST', `/api/tasks/${hardId}/start`, {});
  assert.equal(r.status, 400);
  r = await user('GET', '/api/me/level');
  assert.equal(r.data.level, 0);
  assert.equal(r.data.next.name, 'Тестировщик');

  // Вывод: AB списываются сразу, отклонение возвращает их
  r = await studio('POST', '/api/company/payouts', { amount: 600 });
  assert.equal(r.status, 200);
  const payoutId = r.data.payout.id;
  r = await adm('GET', '/api/admin/money');
  assert.ok(r.data.payouts.some((p) => p.id === payoutId && p.status === 'requested'));
  r = await adm('POST', `/api/admin/payouts/${payoutId}/reject`, { note: 'Нет договора' });
  assert.equal(r.data.payout.status, 'rejected');
  r = await studio('GET', '/api/company/overview');
  assert.equal(r.data.balance, 3000 - 300, 'вывод отклонён — AB вернулись (300 AB в резерве кампании)');
  assert.equal(treasury().ok, true, 'инвариант казны после возврата');
  assert.ok(verifyAllLedgers().ok);
});

test('реферальная программа: бонус после Telegram и первого одобренного задания друга', async () => {
  const a = client();
  const b = client();
  const studio = client();
  await reg(a, 'referrer@real.kz');
  let r = await a('GET', '/api/me/referrals');
  const code = r.data.code;
  assert.match(code, /^[A-Z0-9]{7}$/);
  assert.ok(r.data.link.endsWith(`/r/${code}`));

  // Короткая ссылка ведёт на регистрацию с кодом
  r = await a('GET', `/r/${code}`, undefined, { redirect: 'manual' });
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), `/?ref=${code}#/register`);

  r = await reg(b, 'friend@real.kz', { ref: code, source: 'Instagram_Ads!' });
  assert.equal(r.status, 200);
  const row = db.prepare("SELECT referred_by, signup_source FROM users WHERE email = 'friend@real.kz'").get();
  assert.ok(row.referred_by);
  assert.equal(row.signup_source, 'instagram_ads');

  // Студия с бюджетом (через админа), задание, одобрение
  await reg(studio, 'studio2@real.kz', { role: 'company', companyName: 'Studio Two' });
  r = await studio('POST', '/api/company/topups', { amount: 1000 });
  const adm = client();
  await adm('POST', '/api/auth/login', { email: 'admin@test.kz', password: 'AdminPass2026' });
  await adm('POST', `/api/admin/topups/${r.data.topup.id}/approve`, {});
  r = await studio('POST', '/api/company/campaigns', {
    title: 'Первое впечатление', description: 'Посмотрите страницу игры и расскажите о впечатлении', category: 'game_testing',
    reward: 50, maxParticipants: 3, minSeconds: 0, questions: [{ type: 'rating', label: 'Оценка' }],
  });
  const cid = r.data.campaign.id;
  db.prepare("UPDATE users SET telegram_verified_at = ? WHERE email = 'friend@real.kz'").run(new Date().toISOString());
  await b('POST', `/api/tasks/${cid}/start`, {});
  r = await b('POST', `/api/tasks/${cid}/submit`, { answers: { q1: 4 } });
  assert.equal(r.status, 200);
  r = await studio('GET', `/api/company/campaigns/${cid}`);
  const sub = r.data.submissions.find((s) => s.status === 'submitted');
  r = await studio('POST', `/api/company/submissions/${sub.id}/review`, { decision: 'approve', rating: 5 });
  assert.equal(r.status, 200);
  r = await a('GET', '/api/me/referrals');
  assert.equal(r.data.invited, 1);
  assert.equal(r.data.active, 1);
  assert.equal(r.data.earned, 5, 'бонус из комиссий платформы');
  assert.equal(treasury().ok, true);

  r = await adm('GET', '/api/admin/marketing');
  assert.ok(r.data.sources.some((s) => s.source === 'instagram_ads' && s.signups === 1));
  assert.equal(r.data.referrals, 1);
});

test('восстановление пароля: ссылка одноразовая, старые сессии закрываются; блокировка', async () => {
  const u = client();
  const adm = client();
  await reg(u, 'forgot@real.kz');
  let r = await u('POST', '/api/auth/forgot', { email: 'forgot@real.kz' });
  assert.equal(r.status, 200);
  assert.match(r.data.message, /Если аккаунт/);
  r = await u('POST', '/api/auth/forgot', { email: 'nobody@real.kz' });
  assert.match(r.data.message, /Если аккаунт/, 'ответ не выдаёт, есть ли аккаунт');

  await adm('POST', '/api/auth/login', { email: 'admin@test.kz', password: 'AdminPass2026' });
  r = await adm('GET', '/api/admin/users?q=forgot');
  const uid = r.data.users[0].id;
  r = await adm('POST', `/api/admin/users/${uid}/reset-link`, {});
  const token = r.data.link.split('/reset/')[1];
  r = await u('GET', `/api/auth/reset/${token}`);
  assert.equal(r.status, 200);
  assert.match(r.data.email, /^f•••@real\.kz$/);
  r = await u('POST', '/api/auth/reset', { token, password: 'Newpass2026x', confirm: 'Newpass2026x' });
  assert.equal(r.status, 200);
  r = await u('POST', '/api/auth/reset', { token, password: 'Other2026xx', confirm: 'Other2026xx' });
  assert.equal(r.status, 400, 'ссылка одноразовая');
  const fresh = client();
  r = await fresh('POST', '/api/auth/login', { email: 'forgot@real.kz', password: 'Newpass2026x' });
  assert.equal(r.status, 200);

  r = await adm('POST', `/api/admin/users/${uid}/block`, { blocked: true, reason: 'Спам' });
  assert.equal(r.status, 200);
  r = await fresh('GET', '/api/me');
  assert.equal(r.data.user, null, 'сессии заблокированного закрыты');
  r = await fresh('POST', '/api/auth/login', { email: 'forgot@real.kz', password: 'Newpass2026x' });
  assert.equal(r.status, 403);
});

test('журнал ошибок, SEO и подпись S3 (официальный пример AWS)', async () => {
  const g = client();
  let r = await g('POST', '/api/client-error', { message: 'TypeError: x is undefined', stack: 'at app.js:1 password=secret123', page: '#/tasks' });
  assert.equal(r.status, 200);
  const adm = client();
  await adm('POST', '/api/auth/login', { email: 'admin@test.kz', password: 'AdminPass2026' });
  r = await adm('GET', '/api/admin/errors');
  const e = r.data.errors.find((x) => x.source === 'client');
  assert.ok(e);
  assert.ok(!e.detail.includes('secret123'), 'секреты вырезаются из журнала');

  r = await g('GET', '/robots.txt');
  assert.match(r.data, /Sitemap: .*\/sitemap\.xml/);
  r = await g('GET', '/sitemap.xml');
  assert.match(r.data, /<urlset/);
  r = await g('GET', '/');
  assert.ok(!r.data.includes('%PUBLIC_URL%'), 'адрес сайта подставлен в превью ссылок');

  const { signV4, backupNow } = await import('../server/services/backup.js');
  const auth = signV4({
    method: 'GET', path: '/', query: [], headers: { Host: 'example.amazonaws.com', 'X-Amz-Date': '20150830T123600Z' },
    payloadHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', amzDate: '20150830T123600Z',
    region: 'us-east-1', service: 'service', keyId: 'AKIDEXAMPLE', secret: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
  });
  assert.ok(auth.endsWith('Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31'));
  r = await backupNow();
  assert.equal(r.ok, false, 'без настроек хранилища копия не делается');

  // Снимок базы для скачивания администратором — валидный SQLite
  r = await adm('GET', '/api/admin/backup/download');
  assert.equal(r.status, 200);
  assert.ok(r.data.startsWith('SQLite format 3'));
  r = await g('GET', '/api/admin/backup/download');
  assert.equal(r.status, 401);
});

test('пилотный бюджет: заявка студии → решение админа; прямая выдача админом; казна сходится', async () => {
  const studio = client();
  const adm = client();
  let r = await reg(studio, 'pilot@real.kz', { role: 'company', companyName: 'Pilot Games' });
  const sid = r.data.user.id;
  r = await studio('POST', '/api/company/pilot-request', { amount: 2000, note: 'Платформер, нужно 20 тестировщиков' });
  assert.equal(r.status, 200);
  assert.match(r.data.topup.invoiceNo, /^PILOT-\d{8}-\d{5}$/);
  assert.equal(r.data.topup.status, 'requested');
  r = await studio('POST', '/api/company/pilot-request', { amount: 1000, note: 'Ещё одна' });
  assert.equal(r.status, 400, 'одна открытая заявка за раз');
  const pid = (await studio('GET', '/api/company/topups')).data.topups.find((t) => t.invoiceNo.startsWith('PILOT-')).id;

  await adm('POST', '/api/auth/login', { email: 'admin@test.kz', password: 'AdminPass2026' });
  r = await adm('POST', `/api/admin/topups/${pid}/approve`, { note: 'Удачного теста' });
  assert.equal(r.data.topup.status, 'paid');
  r = await studio('GET', '/api/company/overview');
  assert.equal(r.data.balance, 2000);
  const t = db.prepare("SELECT title FROM transactions WHERE user_id = ? AND type = 'deposit'").get(sid);
  assert.match(t.title, /Пилотный бюджет.*без оплаты/);

  r = await adm('POST', `/api/admin/users/${sid}/grant`, { amount: 500 });
  assert.equal(r.status, 200);
  r = await studio('GET', '/api/company/overview');
  assert.equal(r.data.balance, 2500);
  r = await studio('POST', `/api/admin/users/${sid}/grant`, { amount: 500 });
  assert.equal(r.status, 403, 'выдавать бюджет может только админ');
  assert.equal(treasury().ok, true);
  assert.equal(verifyAllLedgers().ok ?? true, true);
});
