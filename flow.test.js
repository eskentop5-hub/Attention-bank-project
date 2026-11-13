// Сквозной тест главного Demo Flow + безопасность + Telegram (с подменой Bot API).
// Запуск: npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ab-test-'));
process.env.DB_PATH = path.join(dir, 'test.db');
process.env.TELEGRAM_BOT_TOKEN = 'test-token';
process.env.TELEGRAM_BOT_USERNAME = 'attention_test_bot';
process.env.TELEGRAM_GROUP_ID = '-100777';
process.env.PLATFORM_FEE_PERCENT = '20';
process.env.DEMO_MODE = '1'; // старый режим: бесплатное пополнение бюджета в тестовой базе
process.env.DEMO_SANDBOX = '1';
process.env.REGISTER_PER_HOUR = '1000';

const sent = [];
const { setTransport } = await import('../server/telegram/api.js');
setTransport(async (method, payload) => {
  sent.push({ method, ...payload });
  return { message_id: sent.length };
});
const { createServer } = await import('../server/app.js');
const { handleUpdate } = await import('../server/telegram/bot.js');
const { db, run } = await import('../server/db.js');
const { verifyAllLedgers } = await import('../server/services/ledger.js');

let server, base;
before(async () => {
  server = createServer();
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
});
after(() => {
  server.close();
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

function client() {
  let cookie = '';
  return async (method, url, body) => {
    const res = await fetch(base + url, {
      method,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const sc = res.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    const ct = res.headers.get('content-type') || '';
    return { status: res.status, data: ct.includes('json') ? await res.json() : await res.text() };
  };
}
const tick = () => new Promise((r) => setTimeout(r, 30));

const company = client();
const user = client();
const user2 = client();
let campaignId, rewardId;

test('регистрация компании и участника', async () => {
  let r = await company('POST', '/api/auth/register', { role: 'company', email: 'c@test.kz', password: 'Testpass42', name: 'Данияр', companyName: 'Test Studio', consent: true });
  assert.equal(r.status, 200);
  assert.equal(r.data.user.role, 'company');

  r = await user('POST', '/api/auth/register', { email: 'u@test.kz', password: 'Testpass42', name: 'Айгерим', consent: true });
  assert.equal(r.status, 400, 'без подтверждения возраста регистрация запрещена');

  r = await user('POST', '/api/auth/register', { email: 'u@test.kz', password: 'Testpass42', name: 'Айгерим', consent: true, ageConfirmed: true });
  assert.equal(r.status, 200);
  r = await user2('POST', '/api/auth/register', { email: 'u2@test.kz', password: 'Testpass42', name: 'Арман', consent: true, ageConfirmed: true });
  assert.equal(r.status, 200);

  r = await user('PUT', '/api/me', { interests: ['mobile_games', 'unknown_interest'], balance: 999999, role: 'company' });
  assert.deepEqual(r.data.user.interests, ['mobile_games']);
  assert.equal(r.data.user.balance, 0, 'клиент не может изменить баланс');
  assert.equal(r.data.user.role, 'user', 'клиент не может изменить роль');
});

test('кампания: без бюджета нельзя, после пополнения — резерв', async () => {
  const body = {
    title: 'Плейтест мобильной игры',
    description: 'Пройдите первые три уровня и расскажите, что было непонятно.',
    category: 'game_testing',
    audience: ['mobile_games'],
    reward: 50,
    maxParticipants: 2,
    minSeconds: 0,
    questions: [
      { type: 'rating', label: 'Насколько интересно?' },
      { type: 'text', label: 'Что было непонятно?', minLength: 20 },
      { type: 'choice', label: 'Продолжите играть?', options: ['Да', 'Нет'] },
    ],
  };
  let r = await company('POST', '/api/company/campaigns', body);
  assert.equal(r.status, 400);
  assert.match(r.data.error, /Недостаточно/);

  r = await company('POST', '/api/company/deposit', { amount: 1000 });
  assert.equal(r.data.balance, 1000);

  r = await company('POST', '/api/company/campaigns', body);
  assert.equal(r.status, 200);
  campaignId = r.data.campaign.id;
  // (50 + 20% = 60) × 2 = 120
  r = await company('GET', '/api/company/overview');
  assert.equal(r.data.balance, 880);
  assert.equal(r.data.campaigns[0].stats.reserved, 120);

  await tick();
  assert.ok(sent.some((m) => m.method === 'sendMessage' && m.chat_id === '-100777' && /Новое задание/.test(m.text)), 'пост в Telegram-группу');

  r = await user('POST', '/api/company/campaigns', body);
  assert.equal(r.status, 403, 'участник не может создавать кампании');
});

test('участник видит задание, выполняет, автопроверка валидирует', async () => {
  let r = await user('GET', '/api/tasks');
  const t = r.data.tasks.find((x) => x.id === campaignId);
  assert.ok(t && t.matches);

  r = await user('POST', `/api/tasks/${campaignId}/submit`, { answers: {} });
  assert.equal(r.status, 400, 'нельзя отправить без старта');

  r = await user('POST', `/api/tasks/${campaignId}/start`, {});
  assert.equal(r.data.task.my.status, 'started');

  r = await user('POST', `/api/tasks/${campaignId}/submit`, { answers: { q1: 7, q2: 'коротко', q3: 'Может быть' } });
  assert.equal(r.status, 400);
  assert.ok(r.data.details.q1 && r.data.details.q2 && r.data.details.q3, 'ошибки по каждому вопросу');

  r = await user('POST', `/api/tasks/${campaignId}/submit`, {
    answers: { q1: 4, q2: 'На втором уровне неясно, как прыгать через яму.', q3: 'Да' },
  });
  assert.equal(r.status, 200);
  assert.equal(r.data.outcome, 'pending');
  assert.ok(r.data.flags.includes('unverified_account'));

  r = await user('POST', `/api/tasks/${campaignId}/submit`, { answers: { q1: 4, q2: 'Повторная отправка ответа', q3: 'Да' } });
  assert.equal(r.status, 400, 'повторная отправка запрещена');
});

test('дубликат текста от второго участника получает флаг', async () => {
  await user2('PUT', '/api/me', { interests: ['mobile_games'] });
  await user2('POST', `/api/tasks/${campaignId}/start`, {});
  const r = await user2('POST', `/api/tasks/${campaignId}/submit`, {
    answers: { q1: 4, q2: 'На втором уровне неясно, как прыгать через яму.', q3: 'Да' },
  });
  assert.ok(r.data.flags.includes('duplicate_text'));
});

test('Telegram: привязка по коду, бонус, 1 Telegram = 1 аккаунт', async () => {
  // Бонусы платятся из бюджета платформы: без денег на её счёте бонуса нет
  const { postTransaction } = await import('../server/services/ledger.js');
  const { platformAccountId } = await import('../server/db.js');
  postTransaction({ userId: platformAccountId(), amount: 100, type: 'deposit', title: 'Маркетинговый бюджет платформы' });
  const { data: code } = await user('POST', '/api/telegram/link-code', {});
  assert.match(code.deepLink, /^https:\/\/t\.me\/attention_test_bot\?start=/);

  await handleUpdate({ message: { chat: { id: 555, type: 'private' }, from: { username: 'aigerim' }, text: `/start ${code.code}` } });
  let r = await user('GET', '/api/me');
  assert.equal(r.data.user.telegram.linked, true);
  assert.equal(r.data.user.balance, 10, 'бонус за подтверждение');
  assert.ok(sent.some((m) => m.chat_id === 555 && /Аккаунт подтверждён/.test(m.text)));

  // Повторное использование кода
  await handleUpdate({ message: { chat: { id: 556, type: 'private' }, text: `/start ${code.code}` } });
  assert.ok(sent.some((m) => m.chat_id === 556 && /уже использован/.test(m.text)));

  // Тот же Telegram на другой аккаунт
  const { data: code2 } = await user2('POST', '/api/telegram/link-code', {});
  await handleUpdate({ message: { chat: { id: 555, type: 'private' }, text: `/start ${code2.code}` } });
  r = await user2('GET', '/api/me');
  assert.equal(r.data.user.telegram.linked, false);
  assert.ok(sent.some((m) => m.chat_id === 555 && /другому аккаунту/.test(m.text)));

  await handleUpdate({ message: { chat: { id: 555, type: 'private' }, text: '/balance' } });
  assert.ok(sent.some((m) => m.chat_id === 555 && /10 AB Points/.test(m.text)));
});

test('компания одобряет → транзакция → уведомление в Telegram', async () => {
  let r = await company('GET', `/api/company/campaigns/${campaignId}`);
  const sub = r.data.submissions.find((s) => s.participant.name === 'Айгерим');
  const sub2 = r.data.submissions.find((s) => s.participant.name === 'Арман');

  r = await user('POST', `/api/company/submissions/${sub.id}/review`, { decision: 'approve' });
  assert.equal(r.status, 403, 'участник не может одобрять');

  sent.length = 0;
  r = await company('POST', `/api/company/submissions/${sub.id}/review`, { decision: 'approve', rating: 5 });
  assert.equal(r.status, 200);
  await tick();
  const msg = sent.find((m) => m.chat_id === '555');
  assert.ok(msg, 'уведомление ушло в Telegram');
  assert.match(msg.text, /\+50 AB Points/);
  assert.match(msg.text, /New balance: <b>60 AB<\/b>/);

  r = await company('POST', `/api/company/submissions/${sub.id}/review`, { decision: 'approve' });
  assert.equal(r.status, 400, 'двойное одобрение невозможно');

  r = await company('POST', `/api/company/submissions/${sub2.id}/review`, { decision: 'reject' });
  assert.equal(r.status, 400, 'отклонение без комментария запрещено');
  r = await company('POST', `/api/company/submissions/${sub2.id}/review`, { decision: 'reject', note: 'Скопированный ответ' });
  assert.equal(r.status, 200);

  r = await user('GET', '/api/wallet');
  assert.equal(r.data.balance, 60);
  assert.deepEqual(r.data.transactions.map((t) => t.amount), [50, 10]);
  assert.equal(r.data.integrity.ok, true);
});

test('магазин наград: списание транзакцией, нельзя уйти в минус', async () => {
  let r = await company('POST', '/api/company/rewards', { title: 'Ключ раннего доступа', description: 'Игра до релиза', cost: 40, stock: 1 });
  rewardId = r.data.reward.id;
  r = await user('POST', `/api/rewards/${rewardId}/redeem`, {});
  assert.equal(r.status, 200);
  assert.equal(r.data.balance, 20);
  assert.match(r.data.code, /^AB-/);
  r = await user('POST', `/api/rewards/${rewardId}/redeem`, {});
  assert.equal(r.status, 400, 'награда закончилась');

  r = await company('POST', '/api/company/rewards', { title: 'Дорогая награда', description: 'Тест минуса', cost: 1000, stock: 5 });
  r = await user('POST', `/api/rewards/${r.data.reward.id}/redeem`, {});
  assert.equal(r.status, 400);
  assert.match(r.data.error, /Недостаточно/);
  r = await user('GET', '/api/wallet');
  assert.equal(r.data.balance, 20);
});

test('закрытие кампании возвращает неиспользованный бюджет', async () => {
  let r = await company('POST', `/api/company/campaigns/${campaignId}/status`, { status: 'closed' });
  assert.equal(r.status, 200);
  r = await company('GET', '/api/company/overview');
  // 1000 − 120 резерв + 60 возврат (одно место не использовано) + 36 выручки с проданной награды (40 − 10% комиссии)
  assert.equal(r.data.balance, 976);
  r = await company('GET', `/api/company/campaigns/${campaignId}/export.csv`);
  assert.match(r.data, /submission_id/);
});

test('безопасность: CSRF, чужие данные, целостность журнала', async () => {
  let r = await fetch(base + '/api/auth/login', { method: 'POST', body: 'email=x', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  assert.equal(r.status, 415, 'формы с чужих сайтов не принимаются');
  r = await fetch(base + '/api/company/deposit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' },
    body: '{"amount":1000}',
  });
  assert.equal(r.status, 403);
  r = await fetch(base + '/api/telegram/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(r.status, 403, 'webhook без секрета отклоняется');

  // Даже прямое изменение кэша баланса в БД будет обнаружено сверкой с журналом
  assert.equal(verifyAllLedgers().ok, true);
  run("UPDATE users SET balance = balance + 1000 WHERE email = 'u@test.kz'");
  assert.equal(verifyAllLedgers().ok, false);
  run("UPDATE users SET balance = balance - 1000 WHERE email = 'u@test.kz'");
  assert.equal(verifyAllLedgers().ok, true);

  const bad = await user('POST', '/api/auth/login', { email: 'u@test.kz', password: 'wrong' });
  assert.equal(bad.status, 400);
});

// ===================== v2: новые функции =====================
const { config } = await import('../server/config.js');

function clientWithKey() {
  let cookie = '';
  return async (method, url, body, key) => {
    const headers = { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) };
    if (key) headers['Idempotency-Key'] = key;
    const res = await fetch(base + url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
    const sc = res.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    const ct = res.headers.get('content-type') || '';
    return { status: res.status, replay: res.headers.get('idempotent-replay'), data: ct.includes('json') ? await res.json() : await res.text() };
  };
}
const co2 = clientWithKey();
const us3 = clientWithKey();
let camp2, reward2;

test('v2: идемпотентность — повтор пополнения не начисляет дважды', async () => {
  await co2('POST', '/api/auth/register', { role: 'company', email: 'c2@test.kz', password: 'Testpass42', name: 'Мадина', companyName: 'Studio 2', consent: true });
  let r = await co2('POST', '/api/company/deposit', { amount: 2000 }, 'dep-key-0001');
  assert.equal(r.data.balance, 2000);
  r = await co2('POST', '/api/company/deposit', { amount: 2000 }, 'dep-key-0001');
  assert.equal(r.replay, 'true');
  assert.equal(r.data.balance, 2000, 'ответ повторён, а не выполнен заново');
  r = await co2('GET', '/api/wallet');
  assert.equal(r.data.balance, 2000);
  assert.equal(r.data.transactions.length, 1);
  r = await co2('POST', '/api/company/campaigns', {}, 'dep-key-0001');
  assert.equal(r.status, 422, 'тот же ключ для другого запроса запрещён');
  r = await co2('POST', '/api/company/deposit', { amount: 100 }, 'bad key!');
  assert.equal(r.status, 400);
});

test('v2: кампания с шагами, оценкой времени и вопросом-ссылкой', async () => {
  const r = await co2('POST', '/api/company/campaigns', {
    title: 'Тест онбординга приложения',
    description: 'Пройдите регистрацию и первый урок, расскажите, что мешало.',
    instructions: 'Установите приложение\nЗарегистрируйтесь',
    estMinutes: 12,
    category: 'app_testing',
    reward: 100,
    maxParticipants: 3,
    minSeconds: 0,
    questions: [
      { type: 'text', label: 'Что мешало пройти онбординг?', minLength: 20 },
      { type: 'url', label: 'Ссылка на скриншот', required: false },
    ],
  }, 'camp-key-0001');
  assert.equal(r.status, 200);
  camp2 = r.data.campaign;
  assert.equal(camp2.estMinutes, 12);
  assert.match(camp2.instructions, /Зарегистрируйтесь/);
  const w = await co2('GET', '/api/wallet');
  assert.equal(w.data.balance, 2000 - 3 * 120);
});

test('v2: редактирование кампании — места, бюджет, запреты', async () => {
  let r = await co2('PUT', `/api/company/campaigns/${camp2.id}`, { maxParticipants: 5, title: 'Тест онбординга приложения (v2)' });
  assert.equal(r.status, 200);
  assert.equal(r.data.campaign.maxParticipants, 5);
  let w = await co2('GET', '/api/wallet');
  assert.equal(w.data.balance, 2000 - 5 * 120, 'увеличение мест резервирует бюджет');
  r = await co2('PUT', `/api/company/campaigns/${camp2.id}`, { maxParticipants: 2 });
  w = await co2('GET', '/api/wallet');
  assert.equal(w.data.balance, 2000 - 2 * 120, 'уменьшение мест возвращает бюджет');
  r = await co2('PUT', `/api/company/campaigns/${camp2.id}`, { reward: 500 });
  assert.equal(r.status, 400, 'награду после публикации менять нельзя');
  r = await company('PUT', `/api/company/campaigns/${camp2.id}`, { title: 'Чужая кампания' });
  assert.equal(r.status, 403, 'чужую кампанию менять нельзя');
  r = await co2('PUT', `/api/company/campaigns/${camp2.id}`, { maxParticipants: 50000 });
  assert.equal(r.status, 400);
});

test('v2: доказательство-ссылка валидируется, вопросы блокируются после ответа', async () => {
  await us3('POST', '/api/auth/register', { email: 'u3@test.kz', password: 'Testpass42', name: 'Дана', consent: true, ageConfirmed: true });
  await us3('POST', `/api/tasks/${camp2.id}/start`, {});
  let r = await us3('POST', `/api/tasks/${camp2.id}/submit`, { answers: { q1: 'Экран выбора предметов непонятный', q2: 'javascript:alert(1)' } }, 'sub-key-0001');
  assert.equal(r.status, 400);
  assert.ok(r.data.details.q2);
  r = await us3('POST', `/api/tasks/${camp2.id}/submit`, { answers: { q1: 'Экран выбора предметов непонятный', q2: 'https://example.com/shot.png' } }, 'sub-key-0002');
  assert.equal(r.status, 200);
  const again = await us3('POST', `/api/tasks/${camp2.id}/submit`, { answers: { q1: 'Экран выбора предметов непонятный', q2: 'https://example.com/shot.png' } }, 'sub-key-0002');
  assert.equal(again.replay, 'true', 'повтор отправки возвращает тот же ответ');
  const e = await co2('PUT', `/api/company/campaigns/${camp2.id}`, { questions: [{ type: 'rating', label: 'Новый вопрос' }] });
  assert.equal(e.status, 400, 'после ответов вопросы не меняются');
});

test('v2: двойной клик «Одобрить» с одним ключом начисляет один раз', async () => {
  const { data } = await co2('GET', `/api/company/campaigns/${camp2.id}`);
  const sid = data.submissions[0].id;
  const [a, b] = await Promise.all([
    co2('POST', `/api/company/submissions/${sid}/review`, { decision: 'approve' }, 'rev-key-0001'),
    co2('POST', `/api/company/submissions/${sid}/review`, { decision: 'approve' }, 'rev-key-0001'),
  ]);
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  const w = await us3('GET', '/api/wallet');
  assert.equal(w.data.balance, 100);
  assert.equal(w.data.transactions.filter((t) => t.type === 'task_reward').length, 1);
  assert.equal(w.data.integrity.ok, true);
});

test('v2: картинки наград — только PNG/JPEG/WebP с правильной сигнатурой', async () => {
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da6364f8ffff3f0005fe02fea7d6a4c20000000049454e44ae426082', 'hex');
  let r = await co2('POST', '/api/images', { mime: 'image/png', data: png.toString('base64') });
  assert.equal(r.status, 200);
  const imageId = r.data.id;
  r = await co2('POST', '/api/images', { mime: 'image/png', data: Buffer.from('<svg onload=alert(1)>').toString('base64') });
  assert.equal(r.status, 400, 'подмена содержимого отклоняется');
  r = await co2('POST', '/api/images', { mime: 'image/svg+xml', data: Buffer.from('<svg/>').toString('base64') });
  assert.equal(r.status, 400, 'SVG запрещён');
  r = await us3('POST', '/api/images', { mime: 'image/png', data: png.toString('base64') });
  assert.equal(r.status, 403, 'участник не загружает картинки');
  const img = await fetch(`${base}/api/images/${imageId}`);
  assert.equal(img.headers.get('content-type'), 'image/png');
  assert.equal(img.headers.get('x-content-type-options'), 'nosniff');

  r = await co2('POST', '/api/company/rewards', { title: 'Скин для теста', description: 'Внутриигровой предмет', cost: 60, stock: 3, category: 'in_game', imageId });
  assert.equal(r.status, 200);
  reward2 = r.data.reward;
  r = await company('POST', '/api/company/rewards', { title: 'Чужая картинка', description: 'Попытка', cost: 10, stock: 1, imageId });
  assert.equal(r.status, 400, 'чужую картинку использовать нельзя');
});

test('v2: цель, главная, каталог, страница награды', async () => {
  let r = await us3('PUT', '/api/me/goal', { rewardId: reward2.id });
  assert.equal(r.data.goal, reward2.id);
  r = await us3('GET', '/api/home');
  assert.equal(r.data.goal.reward.id, reward2.id);
  assert.equal(r.data.goal.reward.affordable, true);
  assert.equal(r.data.integrity.ok, true);
  r = await us3('GET', '/api/rewards');
  const rw = r.data.rewards.find((x) => x.id === reward2.id);
  assert.equal(rw.imageUrl, `/api/images/${reward2.image_id}`);
  r = await us3('GET', `/api/rewards/${reward2.id}`);
  assert.equal(r.data.reward.isGoal, true);
  r = await us3('POST', `/api/rewards/${reward2.id}/redeem`, {}, 'red-key-0001');
  assert.equal(r.status, 200);
  const twice = await us3('POST', `/api/rewards/${reward2.id}/redeem`, {}, 'red-key-0001');
  assert.equal(twice.data.code, r.data.code, 'повтор обмена возвращает тот же код, а не списывает снова');
  r = await us3('GET', '/api/me');
  assert.equal(r.data.user.balance, 40);
  assert.equal(r.data.user.goalRewardId, null, 'после получения цель снимается');
  r = await us3('PUT', '/api/me/goal', { rewardId: 999999 });
  assert.equal(r.status, 404);
});

test('v2: активность, выгрузка данных, настройки уведомлений', async () => {
  let r = await us3('GET', '/api/activity');
  const kinds = r.data.items.map((i) => i.kind);
  assert.ok(kinds.includes('reward') && kinds.includes('redemption') && kinds.includes('submitted'));
  r = await us3('GET', '/api/me/export');
  const data = typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
  assert.equal(data.profile.email, 'u3@test.kz');
  assert.ok(!('password_hash' in data.profile), 'хэш пароля не выгружается');
  assert.equal(data.submissions.length, 1);
  r = await us3('PUT', '/api/me', { notifyTelegram: false });
  assert.equal(r.data.user.notifyTelegram, false);
});

test('v2: в продакшене пополнение без оплаты отключено', async () => {
  const { realContext } = await import('../server/db.js');
  realContext().demo = false;
  try {
    const r = await co2('POST', '/api/company/deposit', { amount: 500 });
    assert.equal(r.status, 403);
  } finally {
    realContext().demo = true;
  }
});

test('v2: публичный каталог для лендинга без входа', async () => {
  const r = await fetch(`${base}/api/public/rewards`).then((x) => x.json());
  assert.ok(Array.isArray(r.rewards) && r.rewards.length > 0);
  assert.ok(r.rewards.every((x) => x.stock > 0));
});

test('v5: контрольный вопрос — правильный ответ скрыт от участника, ошибка даёт флаг', async () => {
  const body = {
    title: 'Видео-тест: трейлер',
    description: 'Посмотрите трейлер целиком и ответьте на контрольный вопрос по видео.',
    category: 'video_review',
    reward: 10,
    maxParticipants: 5,
    minSeconds: 0,
    questions: [
      { type: 'choice', label: 'Какое слово было в ролике?', options: ['А', 'Б', 'В'], correct: 'Б' },
      { type: 'text', label: 'Что запомнилось?', minLength: 10 },
    ],
  };
  let r = await company('POST', '/api/company/campaigns', { ...body, questions: [{ ...body.questions[0], correct: 'Г' }, body.questions[1]] });
  assert.equal(r.status, 400, 'правильный ответ должен быть среди вариантов');
  r = await company('POST', '/api/company/campaigns', body);
  assert.equal(r.status, 200);
  const cid = r.data.campaign.id;
  assert.equal(r.data.campaign.questions[0].correct, 'Б', 'компания видит правильный ответ');

  const u3 = client();
  await u3('POST', '/api/auth/register', { email: 'u5@test.kz', password: 'Testpass42', name: 'Ерлан', consent: true, ageConfirmed: true });
  r = await u3('GET', `/api/tasks/${cid}`);
  assert.equal(r.data.task.questions[0].correct, undefined, 'участник не видит правильный ответ');
  assert.equal(r.data.task.questions[0].check, true);
  await u3('POST', `/api/tasks/${cid}/start`, {});
  r = await u3('POST', `/api/tasks/${cid}/submit`, { answers: { q1: 'А', q2: 'Запомнилась ночная сцена со звёздами' } });
  assert.equal(r.status, 200);
  assert.ok(r.data.flags.includes('failed_attention_check'));
});

test('v5: статистика по дням, серия заходов, аватар', async () => {
  let r = await user('GET', '/api/me');
  assert.equal(r.data.streak.current, 1, 'первый заход — серия 1');
  assert.equal(r.data.streak.today, true);
  r = await user('GET', '/api/me');
  assert.equal(r.data.streak.current, 1, 'повторный заход в тот же день не увеличивает серию');

  r = await user('GET', '/api/me/stats');
  assert.equal(r.status, 200);
  assert.equal(r.data.days.length, 14);
  const sum = r.data.days.reduce((s, d) => s + d.earned, 0);
  assert.equal(r.data.today.earned, sum, 'всё заработано сегодня');
  assert.ok(r.data.totalEarned >= r.data.today.earned);
  assert.ok(r.data.challenge.goal > 0);

  r = await user('PUT', '/api/me', { avatar: 'a7' });
  assert.equal(r.data.user.avatar, 'a7');
  r = await user('PUT', '/api/me', { avatar: '<script>' });
  assert.equal(r.status, 400);

  r = await user('GET', '/api/home');
  assert.ok(r.data.pulse && r.data.pulse.days.length === 7 && r.data.pulse.streak.current === 1);
});

test('v5: маскот отвечает из базы знаний без ключа ИИ и не обещает деньги', async () => {
  let r = await user('POST', '/api/mascot/ask', { question: 'Можно вывести AB Points в тенге?' });
  assert.equal(r.status, 200);
  assert.equal(r.data.source, 'faq');
  assert.match(r.data.answer, /не деньги/);
  r = await user('POST', '/api/mascot/ask', { question: 'а есть kaspi?' });
  assert.match(r.data.answer, /Скоро/);
  r = await user('POST', '/api/mascot/ask', { question: '' });
  assert.equal(r.status, 400);
});

test('v5: видео отдаётся частями (Range) для перемотки и iOS', async () => {
  const fs = await import('node:fs');
  const exists = fs.existsSync(new URL('../public/play/video/steppe-runner-trailer.mp4', import.meta.url));
  if (!exists) return;
  const res = await fetch(`${base}/play/video/steppe-runner-trailer.mp4`, { headers: { Range: 'bytes=0-99' } });
  assert.equal(res.status, 206);
  assert.equal((await res.arrayBuffer()).byteLength, 100);
  assert.match(res.headers.get('content-range'), /^bytes 0-99\//);
});

test('экономика v2: продажа награды платит продавцу, казна сходится, вывод только для компаний', async () => {
  let r = await fetch(`${base}/api/economy`);
  let t = await r.json();
  assert.equal(t.ok, true, 'Σ балансов + резервы = пополнения − выплаты');
  assert.ok(t.flows.sellerRevenue > 0, 'продавцы получили выручку');
  const { one: q } = await import('../server/db.js');
  const saleFees = q("SELECT COALESCE(SUM(seller_fee), 0) AS v FROM redemptions").v;
  assert.equal(t.flows.spentOnRewards, t.flows.sellerRevenue + saleFees, 'потраченное участниками = выручка продавцов + комиссия');

  r = await company('GET', '/api/company/revenue');
  assert.equal(r.status, 200);
  assert.ok(r.data.sold >= 1);
  assert.equal(r.data.gross, r.data.net + r.data.fee);
  assert.equal(r.data.netKzt, r.data.net * 10);

  r = await company('POST', '/api/company/payouts', { amount: 100 });
  assert.equal(r.status, 400, 'меньше минимальной суммы');
  r = await company('POST', '/api/company/payouts', { amount: 99999 });
  assert.equal(r.status, 400, 'больше баланса');
  const before = (await company('GET', '/api/company/overview')).data.balance;
  r = await company('POST', '/api/company/payouts', { amount: 500 });
  assert.equal(r.status, 200);
  assert.equal(r.data.balance, before - 500);
  assert.equal(r.data.payout.amountKzt, 5000);
  r = await user('POST', '/api/company/payouts', { amount: 500 });
  assert.equal(r.status, 403, 'участники не выводят AB в деньги');

  t = await (await fetch(`${base}/api/economy`)).json();
  assert.equal(t.ok, true, 'после вывода казна по-прежнему сходится');
  assert.equal(t.payouts, 500);
});

test('пароли: политика при регистрации, подтверждение, смена с проверкой текущего', async () => {
  const c = client();
  const reg = (password, extra = {}) => c('POST', '/api/auth/register', { email: 'pwuser@test.kz', password, name: 'Данияр', consent: true, ageConfirmed: true, ...extra });
  assert.match((await reg('short1')).data.error, /минимум 8/);
  assert.match((await reg('onlyletters')).data.error, /буквы, и цифры/);
  assert.match((await reg('password1')).data.error, /распространён/);
  assert.match((await reg('pwuser2024')).data.error, /email/i);
  assert.match((await reg('Goodpass77', { passwordConfirm: 'Goodpass78' })).data.error, /не совпадают/);
  let r = await reg('Goodpass77', { passwordConfirm: 'Goodpass77' });
  assert.equal(r.status, 200);

  r = await c('POST', '/api/me/password', { current: 'wrong', next: 'Newpass99' });
  assert.match(r.data.error, /Текущий пароль неверный/);
  r = await c('POST', '/api/me/password', { current: 'Goodpass77', next: '12345678' });
  assert.equal(r.status, 400);
  r = await c('POST', '/api/me/password', { current: 'Goodpass77', next: 'Newpass99', confirm: 'Newpass99' });
  assert.equal(r.status, 200);
  // Выход и повторный вход в тот же профиль с новым паролем
  await c('POST', '/api/auth/logout', {});
  assert.equal((await c('GET', '/api/me')).data.user, null);
  assert.equal((await c('POST', '/api/auth/login', { email: 'pwuser@test.kz', password: 'Goodpass77' })).status, 400, 'старый пароль больше не подходит');
  r = await c('POST', '/api/auth/login', { email: 'PWUSER@test.kz', password: 'Newpass99' });
  assert.equal(r.status, 200, 'повторный вход в тот же профиль');
  assert.equal((await c('GET', '/api/me')).data.user.email, 'pwuser@test.kz');
});

test('Telegram v2: Mini App вход по подписи, задание в чате, одобрение кнопкой, напоминание, /stats', async () => {
  const crypto = await import('node:crypto');
  const { verifyInitData, sendReminders } = await import('../server/telegram/features.js');
  const { one: q, run: exec } = await import('../server/db.js');
  const sign = (tgUser, ageSec = 0) => {
    const p = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000) - ageSec), query_id: 'AAE', user: JSON.stringify(tgUser) });
    const dcs = [...p.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join('\n');
    const secret = crypto.createHmac('sha256', 'WebAppData').update('test-token').digest();
    p.set('hash', crypto.createHmac('sha256', secret).update(dcs).digest('hex'));
    return p.toString();
  };
  // Подпись: верная принимается, подделанная и просроченная — нет
  assert.equal(verifyInitData(sign({ id: 555, first_name: 'A' })).id, 555);
  assert.equal(verifyInitData(sign({ id: 555 }).replace('555', '556')), null, 'подмена данных ломает подпись');
  assert.equal(verifyInitData(sign({ id: 555 }, 3 * 86400)), null, 'просроченные данные');

  // Mini App: привязанный Telegram входит без пароля, неизвестный — получает linked:false
  const tgc = client();
  let r = await tgc('POST', '/api/telegram/webapp-login', { initData: sign({ id: 555 }) });
  assert.equal(r.data.linked, true);
  assert.equal((await tgc('GET', '/api/me')).data.user.email, 'u@test.kz');
  r = await tgc('POST', '/api/telegram/webapp-login', { initData: 'hash=00&user=%7B%7D' });
  assert.equal(r.status, 403);
  const fresh = client();
  r = await fresh('POST', '/api/telegram/webapp-login', { initData: sign({ id: 9001, first_name: 'Нурлан' }) });
  assert.equal(r.data.linked, false);
  // Новый пользователь регистрируется в Mini App — Telegram привязывается по подписи, без кода
  await fresh('POST', '/api/auth/register', { email: 'tg@test.kz', password: 'Steppe2024x', name: 'Нурлан', consent: true, ageConfirmed: true });
  r = await fresh('POST', '/api/telegram/webapp-link', { initData: sign({ id: 9001, username: 'nurlan' }) });
  assert.equal(r.status, 200);
  assert.equal((await fresh('GET', '/api/me')).data.user.telegram.linked, true);
  r = await user2('POST', '/api/telegram/webapp-link', { initData: sign({ id: 9001 }) });
  assert.equal(r.status, 400, '1 Telegram = 1 аккаунт');

  // Компания подключает Telegram, чтобы проверять ответы кнопками
  const { data: cc } = await company('POST', '/api/telegram/link-code', {});
  await handleUpdate({ message: { chat: { id: 777, type: 'private' }, text: `/start ${cc.code}` } });
  r = await company('POST', '/api/company/campaigns', {
    title: 'Опрос в Telegram',
    description: 'Короткий опрос о мобильных играх прямо в чате бота.',
    category: 'game_feedback',
    reward: 20,
    maxParticipants: 5,
    minSeconds: 0,
    questions: [
      { type: 'rating', label: 'Как часто играете?' },
      { type: 'choice', label: 'Платформа?', options: ['Телефон', 'ПК'] },
      { type: 'text', label: 'Любимая игра и почему?', minLength: 15 },
    ],
  });
  const cid = r.data.campaign.id;

  // Участник проходит задание прямо в чате
  sent.length = 0;
  const cb = (data, chat = 555) => handleUpdate({ callback_query: { id: 'q', data, message: { chat: { id: chat }, message_id: 1 } } });
  await handleUpdate({ message: { chat: { id: 555, type: 'private' }, text: '/tasks' } });
  assert.ok(sent.some((m) => m.method === 'sendMessage' && JSON.stringify(m.reply_markup || {}).includes(`t:${cid}`)), 'кнопка задания');
  await cb(`t:${cid}`);
  await cb(`a:${cid}:0:4`);
  await cb(`a:${cid}:1:0`);
  await handleUpdate({ message: { chat: { id: 555, type: 'private' }, text: 'коротко' } });
  assert.ok(sent.some((m) => /Слишком коротко/.test(m.text || '')));
  sent.length = 0;
  await handleUpdate({ message: { chat: { id: 555, type: 'private' }, text: 'Steppe Runner — короткие заезды и красивая степь' } });
  await tick();
  const a = q('SELECT a.* FROM assignments a JOIN users u ON u.id = a.user_id WHERE a.campaign_id = ? AND u.email = ?', cid, 'u@test.kz');
  assert.equal(a.status, 'submitted');
  assert.deepEqual(Object.values(JSON.parse(a.answers)).slice(0, 2), [4, 'Телефон']);
  const toCompany = sent.find((m) => m.chat_id === '777' && /Новый результат/.test(m.text || ''));
  assert.ok(toCompany && JSON.stringify(toCompany.reply_markup).includes(`rv:${a.id}:approve`), 'компании пришли кнопки решения');

  // Компания одобряет кнопкой — участник получает баллы через леджер
  const before = q("SELECT balance FROM users WHERE email = 'u@test.kz'").balance;
  await cb(`rv:${a.id}:approve`, 777);
  assert.equal(q('SELECT status FROM assignments WHERE id = ?', a.id).status, 'approved');
  assert.equal(q("SELECT balance FROM users WHERE email = 'u@test.kz'").balance, before + 20);
  await cb(`rv:${a.id}:approve`, 555);
  assert.equal(q('SELECT status FROM assignments WHERE id = ?', a.id).status, 'approved', 'участник не может проверять');

  // /stats
  sent.length = 0;
  await handleUpdate({ message: { chat: { id: 555, type: 'private' }, text: '/stats' } });
  assert.ok(sent.some((m) => /Статистика/.test(m.text || '') && /Серия/.test(m.text || '')));

  // Напоминание: тем, кто сегодня не заходил; отключается кнопкой
  exec("DELETE FROM user_visits WHERE user_id = (SELECT id FROM users WHERE email = 'u@test.kz')");
  sent.length = 0;
  assert.ok((await sendReminders({ force: true })) >= 1);
  assert.ok(sent.some((m) => m.chat_id === '555' && /серию|Серия/.test(m.text || '')));
  await cb('rm:off');
  sent.length = 0;
  await sendReminders({ force: true });
  assert.ok(!sent.some((m) => m.chat_id === '555'), 'после отключения напоминание не приходит');
});

test('защита данных: детали продукта, вставка текста, скорость набора, шаблонный текст; приглашение и отчёт', async () => {
  let r = await company('POST', '/api/company/campaigns', {
    title: 'Плейтест с деталями',
    description: 'Пройдите первый уровень игры и расскажите, что запомнилось.',
    category: 'game_testing',
    reward: 10,
    maxParticipants: 10,
    minSeconds: 0,
    keywords: 'овраг, монет, всадник',
    questions: [
      { type: 'rating', label: 'Оценка' },
      { type: 'text', label: 'Что запомнилось?', minLength: 20 },
    ],
  });
  assert.equal(r.status, 200);
  const cid = r.data.campaign.id;
  assert.deepEqual(r.data.campaign.keywords, ['овраг', 'монет', 'всадник'], 'компания видит детали');
  const code = r.data.campaign.inviteCode;
  assert.match(code, /^[A-Z0-9]{8}$/);

  // Приглашение: публичная карточка без вопросов и деталей
  r = await fetch(`${base}/api/join/${code.toLowerCase()}`).then((x) => x.json());
  assert.equal(r.campaignId, cid);
  assert.equal(r.questions, undefined);
  assert.equal(r.keywords, undefined);
  assert.equal((await fetch(`${base}/api/join/NOPE1234`)).status, 404);

  const mk = async (email) => {
    const c = client();
    await c('POST', '/api/auth/register', { email, password: 'Steppe2024x', name: 'Тестер', consent: true, ageConfirmed: true });
    await c('POST', `/api/tasks/${cid}/start`, {});
    return c;
  };
  // Участник не видит детали продукта
  const t1 = await mk('d1@test.kz');
  r = await t1('GET', `/api/tasks/${cid}`);
  assert.equal(r.data.task.keywords, undefined);

  // 1) честный напечатанный ответ с деталями — без новых флагов
  r = await t1('POST', `/api/tasks/${cid}/submit`, { answers: { q1: 4, q2: 'Прыгал через овраг ночью, монеты собирал по дугам' }, meta: { pasted: [], typingMs: { q2: 20000 } } });
  for (const f of ['pasted_text', 'typing_too_fast', 'ai_style', 'no_specifics']) assert.ok(!r.data.flags.includes(f), f);

  // 2) ответ без деталей продукта, вставленный из буфера
  const t2 = await mk('d2@test.kz');
  r = await t2('POST', `/api/tasks/${cid}/submit`, { answers: { q1: 5, q2: 'Хорошая игра, понравилось управление и графика в целом' }, meta: { pasted: ['q2'] } });
  assert.ok(r.data.flags.includes('no_specifics'));
  assert.ok(r.data.flags.includes('pasted_text'));

  // 3) шаблонный «нейросетевой» текст, набранный нечеловечески быстро
  const t3 = await mk('d3@test.kz');
  const gpt = 'В целом, игра погружает в увлекательный игровой процесс с оврагами. Стоит отметить уникальный стиль. Кроме того, управление интуитивно понятное. Таким образом, общее впечатление положительное.';
  r = await t3('POST', `/api/tasks/${cid}/submit`, { answers: { q1: 5, q2: gpt }, meta: { typingMs: { q2: 2000 } } });
  assert.ok(r.data.flags.includes('ai_style'));
  assert.ok(r.data.flags.includes('typing_too_fast'));
  assert.ok(r.data.score < 50);

  // Отчёт для студии: воронка, распределения, флаги, без имён участников
  r = await company('GET', `/api/company/campaigns/${cid}/report`);
  assert.equal(r.status, 200);
  assert.equal(r.data.funnel.submitted, 3);
  assert.ok(r.data.questions[0].dist.reduce((s, n) => s + n, 0) >= 1);
  assert.ok(r.data.flags.some((f) => f.id === 'ai_style'));
  assert.ok(!JSON.stringify(r.data).includes('d1@test.kz'), 'в отчёте нет email участников');
  assert.equal((await user('GET', `/api/company/campaigns/${cid}/report`)).status, 403);
});

test('v10: удаление аккаунта участника обезличивает данные и не ломает бухгалтерию', async () => {
  const c = client();
  let r = await c('POST', '/api/auth/register', { email: 'bye@test.kz', password: 'Steppe2024x', name: 'Уходящий', consent: true, ageConfirmed: true });
  assert.equal(r.status, 200);
  assert.equal((await c('POST', '/api/me/delete', { password: 'wrong-pass1' })).status, 400);
  r = await c('POST', '/api/me/delete', { password: 'Steppe2024x' });
  assert.equal(r.status, 200);
  assert.equal((await c('GET', '/api/me')).data.user, null, 'сессия завершена');
  r = await client()('POST', '/api/auth/login', { email: 'bye@test.kz', password: 'Steppe2024x' });
  assert.ok(r.status >= 400 && !r.data.user, 'войти снова нельзя');
  const row = db.prepare("SELECT email, name, deleted_at FROM users WHERE name = 'Удалённый участник'").get();
  assert.ok(row && row.deleted_at && !row.email.includes('bye@'));
  assert.equal((await company('POST', '/api/me/delete', { password: 'x' })).status, 403, 'компании удаляются через команду');
  assert.ok(verifyAllLedgers().ok);
  // Модель unit-экономики в презентации считается из настроек
  r = await client()('GET', '/api/stats');
  assert.equal(r.data.economy.abToKzt, config.economy.abToKzt);
  assert.equal(r.data.economy.platformFeePercent, config.economy.platformFeePercent);
});

test('v10: приглашение через Telegram-бота: /start join_<код>', async () => {
  const co = db.prepare("SELECT invite_code FROM campaigns WHERE status = 'active' AND invite_code IS NOT NULL LIMIT 1").get();
  assert.ok(co, 'есть активная кампания с кодом');
  sent.length = 0;
  await handleUpdate({ update_id: 9101, message: { message_id: 1, chat: { id: 777001, type: 'private' }, from: { id: 777001, username: 'guest' }, text: `/start join_${co.invite_code}` } });
  await tick();
  const m = sent.find((x) => x.method === 'sendMessage');
  assert.ok(m && /AB Points/.test(m.text), 'бот показал задание');
  sent.length = 0;
  await handleUpdate({ update_id: 9102, message: { message_id: 2, chat: { id: 777001, type: 'private' }, from: { id: 777001 }, text: '/start join_NOPE' } });
  await tick();
  assert.ok(sent.some((x) => /не найдено/.test(x.text || '')));
});
