// Telegram v13: Аби в чате (пишешь обычным текстом — он выполняет), рейтинг недели, награды, цель,
// уровень, реферальная ссылка и сводка для администратора. Всё через те же сервисы, что и сайт.
import { config } from '../config.js';
import { one, all } from '../db.js';
import { call, sendMessage, escapeHtml } from './api.js';
import { appButton } from './features.js';
import { assist } from '../services/assistant.js';
import { listRewards } from '../services/rewards.js';
import { testerLevel, referralStats } from '../services/growth.js';
import { overview } from '../services/admin.js';
import { backupStatus } from '../services/backup.js';
import { home } from '../services/home.js';

const kb = (rows) => ({ reply_markup: { inline_keyboard: rows.filter((r) => r && r.length && r.every(Boolean)) } });
const https = () => config.publicUrl.startsWith('https://');
const bar = (pct, n = 10) => '█'.repeat(Math.round((Math.max(0, Math.min(100, pct)) / 100) * n)).padEnd(n, '░');
// Ссылка на раздел сайта: внутри Telegram — как Mini App, иначе обычной ссылкой
const siteBtn = (text, hash) => appButton(text, `/${hash}`) || (https() ? { text, url: `${config.publicUrl}/${hash}` } : null);

// ---------------------------------------------------------------- Аби в чате
const toHtml = (s) => escapeHtml(s).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
const history = new Map(); // chatId → последние реплики (в памяти: короткий контекст разговора)

export async function abiReply(chatId, user, text) {
  await call('sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => {});
  const h = history.get(chatId) || [];
  let r;
  try {
    r = await assist({ message: text, history: h, user, ip: `tg${chatId}`, channel: 'telegram' });
  } catch (e) {
    return sendMessage(chatId, `⚠️ ${escapeHtml(e.message || 'Аби не смог ответить')}`);
  }
  history.set(chatId, [...h, { role: 'user', text }, { role: 'assistant', text: r.reply }].slice(-10));
  const rows = [];
  for (const a of r.actions || []) {
    if (a.type === 'open') rows.push([siteBtn(a.label.slice(0, 60), a.href)]);
    // Обмен подтверждается только на сайте — там видно, сколько спишется
    if (a.type === 'redeem') rows.push([siteBtn(`🎁 Подтвердить на сайте: ${a.title}`.slice(0, 60), `#/rewards/${a.rewardId}`)]);
    if (a.type === 'draft') rows.push([siteBtn('📝 Открыть черновик кампании', `#/company/new?draft=${Buffer.from(JSON.stringify(a.draft)).toString('base64url')}`)]);
    if (a.type === 'copy') rows.push([{ text: '📋 Поделиться ссылкой', url: `https://t.me/share/url?url=${encodeURIComponent(a.text)}&text=${encodeURIComponent('Тестирую игры и получаю награды в ATTENTION BANK')}` }]);
  }
  const src = (r.sources || []).length ? `\n\n<i>Источники:</i>\n${r.sources.map((s) => `• <a href="${escapeHtml(s.url)}">${escapeHtml(s.title)}</a>`).join('\n')}` : '';
  const mode = r.mode === 'ai' ? (r.used?.includes('web_search') ? '\n\n<i>✦ ИИ · искал в интернете</i>' : '') : '';
  return sendMessage(chatId, `✦ ${toHtml(r.reply)}${src}${mode}`, rows.length ? kb(rows.slice(0, 5)) : {});
}

// ---------------------------------------------------------------- рейтинг недели
export function weeklyTop(limit = 10) {
  const since = new Date(Date.now() - 7 * 864e5).toISOString();
  return all(
    `SELECT u.id, u.name, SUM(t.amount) AS earned, COUNT(*) AS n FROM transactions t JOIN users u ON u.id = t.user_id
     WHERE t.type = 'task_reward' AND t.amount > 0 AND t.created_at >= ? AND u.role = 'user' AND u.is_admin = 0 AND u.deleted_at IS NULL AND u.blocked_at IS NULL
     GROUP BY u.id ORDER BY earned DESC, n DESC LIMIT ?`,
    since, limit
  );
}
// Приватность: только имя и первая буква фамилии
const shortName = (name) => {
  const [a, b] = String(name || 'Участник').trim().split(/\s+/);
  return b ? `${a} ${b[0]}.` : a;
};
export function topText(user) {
  const rows = weeklyTop(10);
  if (!rows.length) return '🏆 <b>Рейтинг недели</b>\n\nПока пусто: станьте первым — /tasks';
  const medal = ['🥇', '🥈', '🥉'];
  const lines = rows.map((r, i) => `${medal[i] || `${i + 1}.`} ${escapeHtml(shortName(r.name))}${user && r.id === user.id ? ' ← вы' : ''} — <b>+${r.earned} AB</b> · ${r.n} ${r.n === 1 ? 'ответ' : 'ответа'}`);
  const mine = user && !rows.some((r) => r.id === user.id) ? '\n\nВас пока нет в десятке — одобренные ответы за 7 дней поднимают в рейтинге.' : '';
  return `🏆 <b>Рейтинг недели</b> (AB за одобренные ответы, 7 дней)\n\n${lines.join('\n')}${mine}`;
}

// ---------------------------------------------------------------- награды, цель, уровень, друзья
export function rewardsMsg(user) {
  const list = listRewards(user).filter((r) => r.stock > 0).slice(0, 6);
  if (!list.length) return ['🎁 Каталог пока пуст: награды добавляют студии вместе с пилотными тестами.', {}];
  const text = `🎁 <b>Награды</b> · баланс ${user.balance} AB\n\n${list.map((r) => `${r.affordable ? '✅' : '▫️'} <b>${escapeHtml(r.title)}</b> — ${r.cost} AB${r.affordable ? '' : ` (не хватает ${r.need})`}${r.demo ? ' · демо' : ''}`).join('\n')}\n\nОбмен подтверждается на сайте. Спросите Аби: «на что мне хватит?»`;
  return [text, kb(list.slice(0, 4).map((r) => [siteBtn(`${r.affordable ? '🎁' : '🎯'} ${r.title}`.slice(0, 60), `#/rewards/${r.id}`)]))];
}
export function goalMsg(user) {
  const h = home(user);
  if (!h.goal) return ['🎯 Цели пока нет. Выберите награду — /rewards — или напишите Аби: «поставь цель …»', {}];
  const g = h.goal.reward;
  const tasks = h.goal.path.tasks || [];
  const text = `🎯 <b>${escapeHtml(g.title)}</b>\n<code>${bar(g.progress)}</code> ${g.progress}%\n${user.balance} из ${g.cost} AB${g.need > 0 ? ` · осталось <b>${g.need} AB</b>` : ' · <b>хватает! 🎉</b>'}` +
    (tasks.length && g.need > 0 ? `\n\nБыстрее всего дойти:\n${tasks.map((t) => `• ${escapeHtml(t.title)} — +${t.reward} AB`).join('\n')}` : '');
  return [text, kb([[siteBtn(g.need > 0 ? 'Открыть цель' : '🎁 Обменять на сайте', `#/rewards/${g.id}`)], ...tasks.slice(0, 2).map((t) => [{ text: `▶ ${t.title.slice(0, 40)} · +${t.reward} AB`, callback_data: `t:${t.id}` }])])];
}
export function levelText(user) {
  const l = testerLevel(user.id);
  return `🎖 <b>Уровень: ${l.name}</b>\nОдобрено ответов: ${l.approved}${l.avgScore != null ? ` · средняя оценка ${l.avgScore}` : ''}\nДневной лимит: ${l.dailyLimit} ответов` +
    (l.next ? `\n\nДо «${l.next.name}»: <code>${bar(l.next.progress)}</code>\nещё ${l.next.approvedLeft} одобр.${l.next.avgScoreNeed ? `, оценка от ${l.next.avgScoreNeed}` : ''}` : '\n\nМаксимальный уровень! 👑');
}
export function refMsg(user) {
  const r = referralStats(user.id);
  return [
    `🤝 <b>Пригласите друзей</b>\n\nВаша ссылка: ${r.link}\nПриглашено: ${r.invited} · подтвердили Telegram: ${r.verified} · выполнили задание: ${r.active}\n\nБонус <b>${r.bonus} AB</b> за друга, когда он подтвердит Telegram и получит первое одобренное задание. Платит платформа из своих комиссий.`,
    kb([[{ text: '📤 Отправить другу', url: `https://t.me/share/url?url=${encodeURIComponent(r.link)}&text=${encodeURIComponent('Тестирую игры и получаю награды в ATTENTION BANK')}` }]]),
  ];
}
export function adminText() {
  const o = overview();
  const c = o.counts;
  const b = backupStatus();
  return `🛠 <b>Пульт</b>\n\n👥 Участники: ${c.users} (+${c.signups7d} за 7 дней)\n🏢 Студии: ${c.companies} · активных кампаний: ${c.activeCampaigns}\n✅ Одобрено ответов: ${c.approved} · ждут проверки: ${c.pendingReviews}\n💰 Заявки на бюджет: ${c.pendingTopups} · на вывод: ${c.pendingPayouts}\n⚠️ Ошибок за сутки: ${o.errors24h}\n\n🏦 Казна: ${o.treasury.ok && o.ledger ? 'сходится ✅' : 'НЕ сходится ❗'}\n🗄 Копии базы: ${b.enabled ? `${b.provider === 'telegram' ? 'в Telegram' : 'в S3'}${b.lastOkAt ? `, последняя ${b.lastOkAt.slice(11, 16)} UTC` : ''}` : 'выключены'}`;
}

export const HELP = `<b>Команды</b>
✦ Просто напишите — ответит Аби и выполнит: «найди задания до 10 минут», «на что мне хватит?», «поставь цель …»
/tasks — задания прямо в чате
/goal — моя цель и прогресс
/rewards — награды
/top — рейтинг недели 🏆
/level — мой уровень
/ref — пригласить друзей
/stats — статистика и серия 🔥
/balance — баланс · /history — транзакции
/remind — напоминание о серии
/app — открыть приложение
/cancel — прервать задание · /unlink — отключить Telegram`;

export const COMMANDS = [
  { command: 'abi', description: 'Аби: спросить или попросить сделать' },
  { command: 'tasks', description: 'Задания прямо в чате' },
  { command: 'goal', description: 'Моя цель и прогресс' },
  { command: 'rewards', description: 'Награды' },
  { command: 'top', description: 'Рейтинг недели' },
  { command: 'level', description: 'Мой уровень' },
  { command: 'ref', description: 'Пригласить друзей' },
  { command: 'stats', description: 'Статистика и серия' },
  { command: 'balance', description: 'Баланс AB Points' },
  { command: 'app', description: 'Открыть приложение' },
  { command: 'help', description: 'Все команды' },
];
