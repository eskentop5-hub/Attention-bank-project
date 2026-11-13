// v13: Аби-ассистент выполняет команды. Офлайн-режим (без ключа ИИ) и цикл ИИ с инструментами (ответы ИИ подменены).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ab-abi-'));
process.env.DB_PATH = path.join(dir, 'abi.db');
process.env.TELEGRAM_BOT_TOKEN = '';
process.env.ANTHROPIC_API_KEY = '';

const { seedDemo } = await import('../server/seed.js');
await seedDemo({ log: () => {} });
const { one, run } = await import('../server/db.js');
const { config } = await import('../server/config.js');
const A = await import('../server/services/assistant.js');
const user = one("SELECT * FROM users WHERE email = 'demo@attention.bank'");
const studio = one("SELECT * FROM users WHERE email = 'studio@attention.bank'");
const say = (message, u = user) => A.assist({ message, user: u, ip: '1.1.1.1' });

test('офлайн: Аби понимает команды и выполняет их от имени пользователя', async () => {
  let r = await say('мой баланс');
  assert.equal(r.mode, 'local');
  assert.match(r.reply, new RegExp(`Баланс: ${user.balance} AB`));

  r = await say('найди задания до 10 минут');
  assert.ok(r.used.includes('find_tasks'));
  assert.match(r.reply, /Вот что есть/);
  assert.ok(r.actions.every((a) => a.type === 'open' && a.href.startsWith('#/tasks/')));

  r = await say('на что мне хватит баллов?');
  assert.ok(r.used.includes('find_rewards'));

  // Цель ставится сразу (безопасно и обратимо)
  const reward = one('SELECT id, title FROM rewards WHERE active = 1 AND stock > 0 ORDER BY cost DESC LIMIT 1');
  r = await say(`поставь цель ${reward.title}`);
  assert.ok(r.used.includes('set_goal'));
  assert.equal(one('SELECT goal_reward_id FROM users WHERE id = ?', user.id).goal_reward_id, reward.id);

  // Обмен НЕ выполняется — только кнопка подтверждения
  const cheap = one('SELECT id, title, cost FROM rewards WHERE active = 1 AND stock > 0 AND cost <= ? ORDER BY cost LIMIT 1', user.balance);
  const before = one('SELECT balance FROM users WHERE id = ?', user.id).balance;
  r = await say(`обменяй ${cheap.title}`);
  assert.ok(r.actions.some((a) => a.type === 'redeem' && a.rewardId === cheap.id));
  assert.equal(one('SELECT balance FROM users WHERE id = ?', user.id).balance, before, 'баллы не списаны без подтверждения человеком');
  assert.equal(one('SELECT COUNT(*) AS n FROM redemptions WHERE user_id = ? AND reward_id = ?', user.id, cheap.id).n, 0);

  r = await say('открой статистику');
  assert.deepEqual(r.actions[0], { type: 'open', label: 'Статистика', href: '#/stats', auto: true });

  r = await say('как проверяют ответы?');
  assert.match(r.reply, /проверя/i);
});

test('офлайн: студия получает сводку и черновик кампании, который НЕ публикуется сам', async () => {
  const before = one('SELECT COUNT(*) AS n FROM campaigns WHERE company_id = ?', studio.id).n;
  let r = await say('как дела у моих кампаний?', studio);
  assert.ok(r.used.includes('company_overview'));
  assert.match(r.reply, /Бюджет/);
  r = await say('создай плейтест «Гонки по степи», 30 AB, 15 участников, 12 мин', studio);
  const d = r.actions.find((a) => a.type === 'draft');
  assert.equal(d.draft.title, 'Гонки по степи');
  assert.equal(d.draft.reward, 30);
  assert.equal(d.draft.maxParticipants, 15);
  assert.equal(d.draft.estMinutes, 12);
  assert.equal(one('SELECT COUNT(*) AS n FROM campaigns WHERE company_id = ?', studio.id).n, before, 'кампания не создана без студии');
  // Студии недоступны инструменты участника, участнику — студии
  assert.match(A.runTool('find_tasks', {}, studio).result.error, /участник/);
  assert.match(A.runTool('draft_campaign', { title: 'x' }, user).result.error, /студи/);
});

test('гость: справка и навигация без доступа к чужим данным', async () => {
  let r = await say('мой баланс', null);
  assert.ok(!/Баланс:/.test(r.reply));
  r = await say('открой регистрацию', null);
  assert.equal(r.actions[0].href, '#/register');
  assert.equal(A.runTool('set_goal', { reward_id: 1 }, null).result.error, 'Нужно войти в аккаунт');
});

test('ИИ-режим: модель вызывает инструменты приложения и поиск, цитаты становятся источниками', async () => {
  config.mascot.anthropicKey = 'test-key';
  const sent = [];
  let step = 0;
  A.setAiTransport(async (body) => {
    sent.push(JSON.parse(JSON.stringify(body)));
    step++;
    if (step === 1) {
      assert.ok(body.tools.some((t) => t.type === 'web_search_20250305' && t.name === 'web_search'), 'интернет-поиск подключён');
      assert.ok(body.tools.some((t) => t.name === 'find_tasks'));
      assert.ok(!body.tools.some((t) => t.name === 'draft_campaign'), 'участнику не дают инструменты студии');
      assert.match(body.system, /участник Айгерим/);
      return {
        stop_reason: 'tool_use',
        content: [
          { type: 'server_tool_use', id: 'srv1', name: 'web_search', input: { query: 'инди игры 2026' } },
          { type: 'web_search_tool_result', tool_use_id: 'srv1', content: [] },
          { type: 'tool_use', id: 'tu1', name: 'find_tasks', input: { limit: 2 } },
          { type: 'tool_use', id: 'tu2', name: 'prepare_redeem', input: { reward_id: 999999 } },
        ],
      };
    }
    const last = body.messages.at(-1);
    assert.equal(last.role, 'user');
    assert.equal(last.content[0].tool_use_id, 'tu1');
    const tasks = JSON.parse(last.content[0].content);
    assert.ok(tasks.count >= 1, 'модель получила настоящие задания из базы');
    assert.match(last.content[1].content, /не найдена/);
    return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Нашёл задания и новости.', citations: [{ type: 'web_search_result_location', url: 'https://example.com/news', title: 'Новости инди' }] }] };
  });
  const r = await A.assist({ message: 'найди задания и что нового в инди-играх', history: [{ role: 'assistant', text: 'привет' }, { role: 'user', text: 'привет' }, { role: 'assistant', text: 'Сәлем!' }], user, ip: '2.2.2.2' });
  assert.equal(r.mode, 'ai');
  assert.equal(r.reply, 'Нашёл задания и новости.');
  assert.ok(r.used.includes('web_search') && r.used.includes('find_tasks'));
  assert.ok(r.actions.some((a) => a.href?.startsWith('#/tasks/')));
  assert.deepEqual(r.sources, [{ url: 'https://example.com/news', title: 'Новости инди' }]);
  assert.equal(sent[0].messages[0].role, 'user', 'история начинается с сообщения пользователя');

  // ИИ упал — Аби отвечает в офлайн-режиме, а не ошибкой
  A.setAiTransport(async () => {
    throw new Error('HTTP 529');
  });
  const r2 = await A.assist({ message: 'мой баланс', user, ip: '3.3.3.3' });
  assert.equal(r2.mode, 'local');
  assert.match(r2.reply, /Баланс/);
  config.mascot.anthropicKey = '';
});

test('Telegram: обычный текст — это просьба к Аби; /top, /goal, /level и /admin работают', async () => {
  const api = await import('../server/telegram/api.js');
  const sent = [];
  config.telegram.token = '1:TEST';
  config.publicUrl = 'https://ab.example.com';
  api.setTransport(async (method, p) => {
    sent.push([method, p]);
    return method === 'sendMessage' ? { message_id: sent.length } : true;
  });
  run('UPDATE users SET telegram_chat_id = ? WHERE id = ?', '777', user.id);
  const { handleUpdate } = await import('../server/telegram/bot.js');
  const msg = (text) => handleUpdate({ message: { text, chat: { id: 777, type: 'private' }, from: { id: 777 } } });
  const last = () => sent.filter(([m]) => m === 'sendMessage').at(-1)[1];

  await msg('найди задания до 10 минут');
  assert.ok(sent.some(([m]) => m === 'sendChatAction'), 'бот показывает «печатает…»');
  assert.match(last().text, /^✦ Вот что есть/);
  assert.ok(last().reply_markup.inline_keyboard.every(([b]) => b.web_app?.url.startsWith('https://ab.example.com/#/tasks/')), 'кнопки открывают задания как Mini App');

  await msg('/top');
  assert.match(last().text, /Рейтинг недели/);
  assert.match(last().text, /Айгерим.*← вы/);
  await msg('/goal');
  assert.match(last().text, /🎯/);
  await msg('/level');
  assert.match(last().text, /Уровень: /);
  await msg('/admin');
  assert.match(last().text, /только для администратора/);
  await msg('/help');
  assert.match(last().text, /Просто напишите — ответит Аби/);
  config.telegram.token = '';
});
