// АБИ-АССИСТЕНТ v13: не просто отвечает, а выполняет команды внутри приложения.
//
// Два режима (источник всегда сообщается клиенту — честно):
//  • 'ai'    — задан ANTHROPIC_API_KEY: настоящий ИИ (Claude) с инструментами приложения и поиском в интернете
//              (серверный инструмент web_search). Цикл: модель вызывает инструменты → мы выполняем → модель отвечает.
//  • 'local' — ключа нет или ИИ недоступен: встроенный разбор команд на русском/казахском + база знаний.
//              Те же инструменты, без интернета.
//
// Безопасность (не ослаблять):
//  • Инструменты работают только от имени текущего пользователя и только в его роли и режиме (демо/настоящий).
//  • Списание баллов Аби НЕ выполняет: prepare_redeem лишь показывает кнопку, обмен подтверждает сам человек
//    обычным запросом /api/rewards/:id/redeem с ключом идемпотентности.
//  • Кампанию Аби не публикует: draft_campaign заполняет форму, публикует компания сама.
//  • Цель (set_goal) — единственное действие, которое Аби выполняет сразу: оно безопасно и обратимо.
import { config } from '../config.js';
import { HttpError } from '../util.js';
import { one, all, modeName } from '../db.js';
import { listTasksForUser, companyOverview } from './campaigns.js';
import { listRewards, publicRewards, setGoal } from './rewards.js';
import { testerLevel, referralStats } from './growth.js';
import { userStats } from './stats.js';
import { faqAnswer } from './mascot.js';
import { CATEGORIES } from '../catalog.js';

// ---------------------------------------------------------------- страницы
const PAGES = {
  home: { user: '#/home', company: '#/company', guest: '#/', label: 'Главная' },
  tasks: { user: '#/tasks', label: 'Задания' },
  rewards: { user: '#/rewards', label: 'Награды' },
  stats: { user: '#/stats', label: 'Статистика' },
  activity: { user: '#/activity', company: '#/budget', label: 'Активность' },
  profile: { user: '#/profile', company: '#/profile', label: 'Профиль' },
  settings: { user: '#/settings', company: '#/settings', label: 'Настройки' },
  notifications: { user: '#/notifications', company: '#/notifications', label: 'Уведомления' },
  economy: { any: '#/economy', label: 'Экономика' },
  privacy: { any: '#/privacy', label: 'Конфиденциальность' },
  presentation: { any: '#/?present=1', label: 'Живая презентация' },
  about: { any: '#/about', label: 'О проекте' },
  company: { company: '#/company', label: 'Кабинет студии' },
  new_campaign: { company: '#/company/new', label: 'Новая кампания' },
  budget: { company: '#/budget', label: 'Бюджет' },
  revenue: { company: '#/company/revenue', label: 'Выручка' },
  company_rewards: { company: '#/company/rewards', label: 'Награды студии' },
  admin: { admin: '#/admin', label: 'Пульт' },
  login: { guest: '#/login', label: 'Вход' },
  register: { guest: '#/register', label: 'Регистрация' },
};
function pageHref(page, user) {
  const p = PAGES[page];
  if (!p) return null;
  if (p.any) return p.any;
  if (p.admin) return user?.is_admin ? p.admin : null;
  if (!user) return p.guest || null;
  return p[user.role] || null;
}
const open = (label, href) => ({ type: 'open', label, href });

// ---------------------------------------------------------------- инструменты
const words = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .split(/[^a-zа-яәіңғүұқөһ0-9]+/i)
    .filter((w) => w.length > 2);
const stem = (w) => w.slice(0, Math.max(4, w.length - 2));
function matchScore(text, query) {
  const t = String(text || '').toLowerCase().replace(/ё/g, 'е');
  return words(query).reduce((n, w) => n + (t.includes(stem(w)) ? 1 : 0), 0);
}

const needUser = (u, role) => {
  if (!u) return { error: 'Нужно войти в аккаунт', actions: [open('Войти', '#/login'), open('Создать аккаунт', '#/register')] };
  if (role && u.role !== role) return { error: role === 'company' ? 'Это доступно только студиям' : 'Это доступно только участникам' };
  return null;
};

export const TOOLS = {
  my_status: {
    description: 'Текущее состояние пользователя: баланс AB, уровень, серия заходов, цель и прогресс; для студии — бюджет, активные кампании и ответы на проверке.',
    schema: { type: 'object', properties: {} },
    run(_, u) {
      if (!u) return { result: { loggedIn: false }, actions: [open('Войти', '#/login')] };
      if (u.role === 'company') {
        const o = companyOverview(u);
        return {
          result: { role: 'company', company: u.company_name, budget: u.balance, activeCampaigns: o.totals.active, pendingReviews: o.totals.pending, approvedResults: o.totals.results, avgCostPerResult: o.totals.avgCostPerResult },
          actions: [open('Кабинет студии', '#/company'), ...(o.totals.pending ? [open(`Проверить ответы (${o.totals.pending})`, '#/company')] : [])],
        };
      }
      const lvl = testerLevel(u.id);
      const s = userStats(u.id, 7);
      const goal = u.goal_reward_id ? one('SELECT id, title, cost FROM rewards WHERE id = ?', u.goal_reward_id) : null;
      return {
        result: {
          role: 'user', name: u.name, balance: u.balance, level: lvl.name, nextLevel: lvl.next?.name || null, approvedLeftToNext: lvl.next?.approvedLeft ?? null,
          streakDays: s.streak?.current || 0, earnedToday: s.today.earned, earnedYesterday: s.yesterday.earned,
          goal: goal ? { id: goal.id, title: goal.title, cost: goal.cost, need: Math.max(0, goal.cost - u.balance) } : null,
        },
        actions: goal ? [open(`Цель: ${goal.title}`, `#/rewards/${goal.id}`)] : [open('Выбрать цель в наградах', '#/rewards')],
      };
    },
  },
  find_tasks: {
    description: 'Найти доступные задания для участника. Можно фильтровать по словам (игра, видео, приложение…) и максимальному времени.',
    schema: { type: 'object', properties: { query: { type: 'string', description: 'слова для поиска, необязательно' }, max_minutes: { type: 'integer' }, limit: { type: 'integer', minimum: 1, maximum: 8 } } },
    run({ query = '', max_minutes, limit = 4 }, u) {
      const no = needUser(u, 'user');
      if (no) return { result: no, actions: no.actions };
      let list = listTasksForUser(u).filter((t) => !t.my);
      if (max_minutes) list = list.filter((t) => (t.estMinutes || 5) <= max_minutes);
      if (query) {
        const scored = list.map((t) => [t, matchScore(`${t.title} ${t.description} ${t.categoryLabel}`, query)]).filter(([, s]) => s > 0);
        if (scored.length) list = scored.sort((a, b) => b[1] - a[1]).map(([t]) => t);
      }
      const top = list.slice(0, Math.min(8, Math.max(1, limit | 0)));
      return {
        result: { count: list.length, tasks: top.map((t) => ({ id: t.id, title: t.title, reward: t.reward, minutes: t.estMinutes, category: t.categoryLabel, company: t.company, locked: t.locked, lockedReason: t.locked ? `с уровня «${t.minLevelName}»` : null, demo: t.companyDemo })) },
        actions: top.filter((t) => !t.locked).slice(0, 3).map((t) => open(`▶ ${t.title} · +${t.reward} AB`, `#/tasks/${t.id}`)),
      };
    },
  },
  find_rewards: {
    description: 'Найти награды в каталоге: по словам, только доступные по балансу, или до максимальной цены.',
    schema: { type: 'object', properties: { query: { type: 'string' }, affordable_only: { type: 'boolean' }, max_cost: { type: 'integer' }, limit: { type: 'integer', minimum: 1, maximum: 8 } } },
    run({ query = '', affordable_only = false, max_cost, limit = 4 }, u) {
      if (u && u.role !== 'user') return { result: { error: 'Каталог наград — для участников' } };
      let list = u ? listRewards(u).filter((r) => r.stock > 0) : publicRewards(20);
      if (affordable_only && u) list = list.filter((r) => r.affordable);
      if (max_cost) list = list.filter((r) => r.cost <= max_cost);
      if (query) {
        const scored = list.map((r) => [r, matchScore(`${r.title} ${r.description} ${r.categoryLabel} ${r.platform || ''}`, query)]).filter(([, s]) => s > 0);
        if (scored.length) list = scored.sort((a, b) => b[1] - a[1]).map(([r]) => r);
      }
      const top = list.slice(0, Math.min(8, Math.max(1, limit | 0)));
      return {
        result: { count: list.length, balance: u?.balance ?? null, rewards: top.map((r) => ({ id: r.id, title: r.title, cost: r.cost, stock: r.stock, affordable: r.affordable ?? null, need: r.need ?? null, company: r.company, demo: r.demo })) },
        actions: u ? top.slice(0, 3).map((r) => open(`🎁 ${r.title} · ${r.cost} AB`, `#/rewards/${r.id}`)) : [open('Создать аккаунт', '#/register')],
      };
    },
  },
  set_goal: {
    description: 'Сделать награду целью участника (полоса прогресса на главной). Безопасное и обратимое действие — выполняется сразу.',
    schema: { type: 'object', properties: { reward_id: { type: 'integer' } }, required: ['reward_id'] },
    run({ reward_id }, u) {
      const no = needUser(u, 'user');
      if (no) return { result: no, actions: no.actions };
      const r = one('SELECT id, title, cost FROM rewards WHERE id = ? AND active = 1', Number(reward_id));
      if (!r) return { result: { error: 'Награда не найдена' } };
      setGoal(u, r.id);
      return { result: { ok: true, goal: r.title, cost: r.cost, need: Math.max(0, r.cost - u.balance) }, actions: [open('Смотреть прогресс', '#/home')], done: `Цель: ${r.title}` };
    },
  },
  prepare_redeem: {
    description: 'Подготовить обмен баллов на награду. НЕ списывает баллы: показывает человеку кнопку подтверждения. Используй, когда просят купить/получить/обменять награду.',
    schema: { type: 'object', properties: { reward_id: { type: 'integer' } }, required: ['reward_id'] },
    run({ reward_id }, u) {
      const no = needUser(u, 'user');
      if (no) return { result: no, actions: no.actions };
      const r = one('SELECT id, title, cost, stock FROM rewards WHERE id = ? AND active = 1', Number(reward_id));
      if (!r) return { result: { error: 'Награда не найдена' } };
      if (r.stock <= 0) return { result: { error: 'Награда закончилась' } };
      if (u.balance < r.cost) return { result: { error: 'Не хватает баллов', need: r.cost - u.balance }, actions: [open('Найти задания', '#/tasks')] };
      return {
        result: { ready: true, title: r.title, cost: r.cost, note: 'Человек должен сам нажать кнопку подтверждения — баллы ещё не списаны' },
        actions: [{ type: 'redeem', rewardId: r.id, label: `Подтвердить: ${r.title} за ${r.cost} AB`, cost: r.cost, title: r.title }, open('Открыть награду', `#/rewards/${r.id}`)],
      };
    },
  },
  open_page: {
    description: `Открыть раздел приложения у пользователя. Разделы: ${Object.keys(PAGES).join(', ')}.`,
    schema: { type: 'object', properties: { page: { type: 'string', enum: Object.keys(PAGES) } }, required: ['page'] },
    run({ page }, u) {
      const href = pageHref(page, u);
      if (!href) return { result: { error: 'Этот раздел недоступен для текущей роли' } };
      return { result: { ok: true, page: PAGES[page].label }, actions: [{ ...open(PAGES[page].label, href), auto: true }] };
    },
  },
  my_stats: {
    description: 'Статистика заработка участника: сегодня, вчера, за неделю, лучший день, процент одобрения.',
    schema: { type: 'object', properties: {} },
    run(_, u) {
      const no = needUser(u, 'user');
      if (no) return { result: no, actions: no.actions };
      const s = userStats(u.id, 14);
      return { result: { today: s.today.earned, yesterday: s.yesterday.earned, week: s.week, bestDay: s.bestDay, approvalRate: s.approvalRate, streak: s.streak?.current || 0 }, actions: [open('Статистика', '#/stats')] };
    },
  },
  referral_link: {
    description: 'Реферальная ссылка участника и сколько друзей приглашено.',
    schema: { type: 'object', properties: {} },
    run(_, u) {
      const no = needUser(u, 'user');
      if (no) return { result: no, actions: no.actions };
      if (modeName() === 'demo') return { result: { error: 'В демо-песочнице приглашения не работают' } };
      const r = referralStats(u.id);
      return { result: { link: r.link, invited: r.invited, active: r.active, bonusPerFriend: r.bonus, earned: r.earned }, actions: [{ type: 'copy', label: 'Скопировать ссылку', text: r.link }] };
    },
  },
  company_overview: {
    description: 'Сводка студии: кампании, ответы на проверке, одобренные результаты, средняя цена результата.',
    schema: { type: 'object', properties: {} },
    run(_, u) {
      const no = needUser(u, 'company');
      if (no) return { result: no, actions: no.actions };
      const o = companyOverview(u);
      return {
        result: { budget: u.balance, totals: o.totals, campaigns: o.campaigns.slice(0, 5).map((c) => ({ id: c.id, title: c.title, status: c.status, approved: c.stats.approved, pending: c.stats.pending })), pendingQueue: o.pendingQueue },
        actions: [...o.campaigns.slice(0, 2).map((c) => open(`📊 ${c.title}`, `#/company/campaigns/${c.id}`)), open('Новая кампания', '#/company/new')],
      };
    },
  },
  draft_campaign: {
    description: 'Подготовить черновик кампании (плейтеста) для студии и открыть форму. НЕ публикует — студия проверит и опубликует сама.',
    schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        description: { type: 'string' },
        category: { type: 'string', enum: CATEGORIES.map((c) => c.id) },
        reward: { type: 'integer', minimum: 5, maximum: 1000 },
        max_participants: { type: 'integer', minimum: 1, maximum: 1000 },
        est_minutes: { type: 'integer', minimum: 1, maximum: 240 },
        questions: { type: 'array', items: { type: 'object', properties: { type: { type: 'string', enum: ['rating', 'text', 'choice', 'url'] }, label: { type: 'string' }, options: { type: 'array', items: { type: 'string' } } }, required: ['type', 'label'] } },
      },
      required: ['title'],
    },
    run(a, u) {
      const no = needUser(u, 'company');
      if (no) return { result: no, actions: no.actions };
      const cut = (s, n) => String(s || '').trim().slice(0, n);
      const qs = (Array.isArray(a.questions) ? a.questions : [])
        .filter((q) => q && ['rating', 'text', 'choice', 'url'].includes(q.type) && cut(q.label, 200))
        .slice(0, 8)
        .map((q) => ({ type: q.type, label: cut(q.label, 200), ...(q.type === 'choice' ? { options: (q.options || []).map((o) => cut(o, 80)).filter(Boolean).slice(0, 6) } : {}), ...(q.type === 'text' ? { minLength: 40 } : {}) }));
      const draft = {
        title: cut(a.title, 120) || 'Плейтест',
        description: cut(a.description, 1000) || `Плейтест «${cut(a.title, 120) || 'новой игры'}»: откройте сборку, поиграйте 10–15 минут и расскажите, где было интересно, сложно или непонятно.`,
        category: CATEGORIES.some((c) => c.id === a.category) ? a.category : 'game_testing',
        reward: Math.min(1000, Math.max(5, Number(a.reward) || 40)),
        maxParticipants: Math.min(1000, Math.max(1, Number(a.max_participants) || 20)),
        estMinutes: Math.min(240, Math.max(1, Number(a.est_minutes) || 10)),
        questions: qs.length ? qs : DEFAULT_QUESTIONS,
      };
      return { result: { drafted: true, title: draft.title, questions: draft.questions.length, note: 'Черновик открыт в форме, студия публикует сама' }, actions: [{ type: 'draft', label: 'Открыть черновик кампании', href: '#/company/new', draft, auto: true }] };
    },
  },
  platform_info: {
    description: 'Справка о правилах платформы ATTENTION BANK (баллы, проверка ответов, награды, экономика, Telegram, приватность).',
    schema: { type: 'object', properties: { topic: { type: 'string' } }, required: ['topic'] },
    run({ topic }) {
      return { result: { answer: faqAnswer(String(topic || '')) } };
    },
  },
};

const DEFAULT_QUESTIONS = [
  { type: 'rating', label: 'Насколько интересно было?' },
  { type: 'text', label: 'Где вы запутались или захотели выйти? Опишите подробно.', minLength: 40 },
  { type: 'choice', label: 'Продолжите играть после теста?', options: ['Да', 'Возможно', 'Нет'] },
];

/** Выполнить инструмент безопасно: ошибки превращаются в результат, а не в падение */
export function runTool(name, input, user) {
  const t = TOOLS[name];
  if (!t) return { result: { error: `Нет такого инструмента: ${name}` } };
  try {
    return t.run(input || {}, user) || { result: {} };
  } catch (e) {
    return { result: { error: e.message || 'Ошибка' } };
  }
}

// ---------------------------------------------------------------- офлайн-режим: разбор команд
const RE = {
  greet: /^(привет|здравствуй|салем|сәлем|хай|hello|hi)\b/i,
  balance: /(баланс|сколько (у меня )?(баллов|ab|аб)|мой счет|мой счёт|уровень|сери[яю]|статус)/i,
  stats: /(статистик|заработал|вчера|за неделю|доход)/i,
  goal: /(цел[ьию])/i,
  redeem: /(обменя|купи|получи(ть)? награ|возьми|хочу награ|оформи)/i,
  rewards: /(наград|ключ|приз|что (мне )?(можно )?(купить|получить|взять)|на что (мне )?(хватит|хватает)|хватит ли|каталог|магазин)/i,
  tasks: /(задани|тест|заработ|что (мне )?(сделать|пройти)|плейтест|опрос)/i,
  ref: /(реферал|пригласи|друз|друг|ссылк[уа] для)/i,
  company: /(кампани|отчет|отчёт|ответы|проверк[уи] ответ|мои тесты|результат)/i,
  draft: /(создай|сделай|подготовь|запусти|составь).{0,20}(кампани|тест|плейтест|опрос|задани)/i,
  open: /(открой|перейди|покажи|зайди|вкладк|раздел)\s+(.+)/i,
};
const OPEN_WORDS = [
  ['tasks', /задани/], ['rewards', /наград|каталог/], ['stats', /статист/], ['activity', /активн|истори|транзакц/], ['profile', /профил/], ['settings', /настрой/],
  ['notifications', /уведомл/], ['economy', /экономик|казн/], ['privacy', /приватн|конфиденц/], ['presentation', /презентац/], ['budget', /бюджет/], ['revenue', /выручк/],
  ['new_campaign', /нов.*кампани|создать кампани/], ['company', /кабинет|кампани/], ['admin', /пульт|админ/], ['home', /главн|дом/], ['register', /регистрац/], ['login', /вход|войти/],
];
const num = (s, re) => {
  const m = re.exec(s);
  return m ? Number(m[1]) : undefined;
};
function pickReward(text, u) {
  const list = u ? listRewards(u).filter((r) => r.stock > 0) : [];
  const scored = list.map((r) => [r, matchScore(r.title, text)]).filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]);
  return scored[0]?.[0] || null;
}
// Служебные слова команды не должны сужать поиск («найди», «до 10 минут»)
const STOP = /(найди|покажи|подбери|какие|есть|мне|все|до\s*\d+\s*мин[а-я]*|за\s*\d+\s*мин[а-я]*|\?)/gi;
const fmtList = (items, line) => items.map((x, i) => `${i + 1}. ${line(x)}`).join('\n');

function localTurn(message, u) {
  const m = message.trim();
  const used = [];
  const call = (name, input = {}) => {
    used.push(name);
    return runTool(name, input, u);
  };
  const answer = (reply, r = {}) => ({ reply, actions: r.actions || [], used });

  if (RE.greet.test(m) && m.length < 25) {
    const name = u ? (u.role === 'company' ? u.company_name : u.name) : null;
    return answer(`${name ? `Сәлем, ${name}!` : 'Сәлем!'} Я Аби. Могу найти задания, подобрать награду, поставить цель, показать статистику${u?.role === 'company' ? ', собрать черновик кампании' : ''} или открыть любой раздел. Просто напиши, что сделать.`);
  }
  if (RE.open.test(m)) {
    const what = RE.open.exec(m)[2].toLowerCase();
    const hit = OPEN_WORDS.find(([, re]) => re.test(what));
    if (hit) {
      const r = call('open_page', { page: hit[0] });
      if (!r.result.error) return answer(`Открываю «${r.result.page}».`, r);
    }
  }
  if (u?.role === 'company' && RE.draft.test(m)) {
    const title = (/[«"“']([^»"”']{3,100})[»"”']/.exec(m) || [])[1] || `Плейтест: ${m.replace(RE.draft, '').replace(/^(для|про|о|об)\s+/i, '').trim().slice(0, 60) || 'новая игра'}`;
    const r = call('draft_campaign', { title, reward: num(m, /(\d{1,4})\s*(ab|аб|балл)/i), max_participants: num(m, /(\d{1,4})\s*(участник|человек|тестировщик)/i), est_minutes: num(m, /(\d{1,3})\s*мин/i), category: /видео|трейлер/i.test(m) ? 'video_review' : /приложени/i.test(m) ? 'app_testing' : /ux|интерфейс|прототип/i.test(m) ? 'ux_research' : 'game_testing' });
    return answer(`Собрал черновик «${r.actions[0].draft.title}»: награда ${r.actions[0].draft.reward} AB, ${r.actions[0].draft.maxParticipants} участников, ${r.actions[0].draft.questions.length} вопроса. Проверь форму и нажми «Опубликовать» — без тебя ничего не запустится.`, r);
  }
  if (u?.role === 'company' && (RE.company.test(m) || RE.balance.test(m)) && (/дела|мои[хм]?\s+(кампан|тест)/i.test(m) || !/(^|\s)(как|почему|зачем)(\s|$)/i.test(m))) {
    const r = call('company_overview');
    const t = r.result.totals;
    return answer(`Бюджет: ${r.result.budget} AB. Активных кампаний: ${t.active}, ждут проверки: ${t.pending}, одобрено результатов: ${t.results}${t.avgCostPerResult ? `, средняя цена результата ${t.avgCostPerResult} AB` : ''}.`, r);
  }
  if (RE.goal.test(m) && u?.role === 'user') {
    const reward = pickReward(m.replace(RE.goal, ''), u);
    if (reward && /(постав|сделай|выбер|установ|хочу)/i.test(m)) {
      const r = call('set_goal', { reward_id: reward.id });
      return answer(`Готово: цель — «${reward.title}». ${r.result.need > 0 ? `Осталось ${r.result.need} AB — нажми «Найди задания» — подберу, где заработать.` : 'Баллов уже хватает!'}`, r);
    }
    const r = call('my_status');
    const g = r.result.goal;
    return answer(g ? `Твоя цель — «${g.title}» за ${g.cost} AB. ${g.need > 0 ? `Осталось ${g.need} AB.` : 'Баллов хватает — можно обменять!'}` : 'Цели пока нет. Открой награды и нажми «В цель» на той, что нравится.', r);
  }
  if (RE.redeem.test(m) && u?.role === 'user') {
    const reward = pickReward(m.replace(RE.redeem, ''), u);
    if (reward) {
      const r = call('prepare_redeem', { reward_id: reward.id });
      return answer(r.result.ready ? `«${reward.title}» за ${reward.cost} AB. Баллы спишутся только после твоего подтверждения — нажми кнопку ниже.` : `Не получится: ${r.result.error}${r.result.need ? ` (не хватает ${r.result.need} AB)` : ''}.`, r);
    }
  }
  if (RE.ref.test(m) && u?.role === 'user') {
    const r = call('referral_link');
    if (r.result.error) return answer(r.result.error);
    return answer(`Твоя ссылка: ${r.result.link}\nПриглашено: ${r.result.invited}, активных: ${r.result.active}. Бонус ${r.result.bonusPerFriend} AB — когда друг подтвердит Telegram и получит первое одобренное задание.`, r);
  }
  if (RE.stats.test(m) && u?.role === 'user') {
    const r = call('my_stats');
    return answer(`Сегодня +${r.result.today} AB, вчера +${r.result.yesterday} AB, за неделю +${r.result.week} AB. Серия: ${r.result.streak} 🔥`, r);
  }
  if (RE.rewards.test(m) && !/(^|\s)(как|почему|зачем)(\s|$)|что такое/i.test(m)) {
    const affordable = /(хватит|могу|доступн|сейчас)/i.test(m);
    const r = call('find_rewards', { query: m.replace(RE.rewards, '').replace(STOP, ' '), affordable_only: affordable, max_cost: num(m, /до\s*(\d{1,5})/i) });
    if (r.result.error) return answer(r.result.error, r);
    const list = r.result.rewards;
    if (!list.length) return answer(affordable ? 'Пока не хватает ни на одну награду. Нажми «Найди задания» — подберу, где заработать.' : 'Подходящих наград сейчас нет.', r);
    return answer(`${affordable ? 'Хватает на' : 'Нашёл'}:\n${fmtList(list, (x) => `${x.title} — ${x.cost} AB${x.need ? ` (не хватает ${x.need})` : ''}`)}${u ? '\nОткрой награду — там кнопки «Получить» и «В цель».' : ''}`, r);
  }
  if (RE.tasks.test(m) && !/(^|\s)(как|почему|зачем)(\s|$)|что такое/i.test(m)) {
    const r = call('find_tasks', { query: m.replace(RE.tasks, '').replace(STOP, ' '), max_minutes: num(m, /(?:до|за|меньше)\s*(\d{1,3})\s*мин/i) });
    if (r.result.error) return answer(r.result.error, r);
    const list = r.result.tasks;
    if (!list.length) return answer('Сейчас нет открытых заданий под запрос. Загляни позже — я напомню в Telegram, если он подключён.', r);
    return answer(`Вот что есть (${r.result.count}):\n${fmtList(list, (x) => `${x.title} — +${x.reward} AB, ~${x.minutes || 5} мин${x.locked ? ` 🔒 ${x.lockedReason}` : ''}`)}`, r);
  }
  if (RE.balance.test(m) && u) {
    const r = call('my_status');
    const s = r.result;
    return answer(`Баланс: ${s.balance} AB · уровень «${s.level}»${s.nextLevel ? ` (до «${s.nextLevel}» — ещё ${s.approvedLeftToNext} одобр.)` : ''} · серия ${s.streakDays} 🔥${s.goal ? `\nЦель «${s.goal.title}»: ${s.goal.need > 0 ? `осталось ${s.goal.need} AB` : 'хватает!'}` : ''}`, r);
  }
  used.push('platform_info');
  return answer(faqAnswer(m));
}

// Готовые вопросы и команды: Аби работает только по кнопкам (без свободного ввода) — на сайте и в Telegram
export function suggestionsFor(u) {
  if (!u) return ['Что такое ATTENTION BANK?', 'Какие награды есть?', 'Как проверяют ответы?', 'AB Points — это деньги?', 'Открой презентацию', 'Открой регистрацию'];
  if (u.role === 'company')
    return ['Как дела у моих кампаний?', 'Создай плейтест «Гонки по степи», 30 AB, 15 участников', 'Открой выручку', 'Открой бюджет', 'Как проверяют ответы?', 'Открой новую кампанию'];
  return ['Мой баланс и уровень', 'Найди задания до 10 минут', 'На что мне хватит баллов?', 'Моя цель', 'Моя статистика', 'Пригласить друзей', 'Как проверяют ответы?', 'AB Points — это деньги?'];
}

// ---------------------------------------------------------------- ИИ-режим (Claude + инструменты + поиск в интернете)
const SYSTEM = `Ты — Аби, ИИ-ассистент и маскот платформы ATTENTION BANK (команда SithOrder, National Founder Cup 2026, Шымкент).
Ты не только отвечаешь, но и ВЫПОЛНЯЕШЬ просьбы через инструменты: ищешь задания и награды, ставишь цель, открываешь разделы, готовишь обмен и черновики кампаний. Для вопросов о внешнем мире (игры, новости, рынок, факты) используй поиск в интернете.
Факты: студии платят за проверенный результат (плейтест, отзыв, UX-исследование, видео-тест); ответы проходят автопроверку и проверку студией; AB Points — внутренние баллы, для участников НЕ деньги и НЕ криптовалюта, их нельзя вывести, только обменять на награды; 1 AB = 10 ₸ для бизнеса; комиссия платформы 20% с результата, 10% с продажи награды; казна сверяется: балансы + резервы = пополнения − выводы. Партнёрских наград Kaspi/YouTube Premium сейчас нет.
Правила:
- Отвечай на языке пользователя (русский или казахский), коротко: 1–5 предложений или короткий список.
- Никогда не говори, что обмен совершён: prepare_redeem только показывает кнопку, подтверждает человек.
- Никогда не говори, что кампания опубликована: draft_campaign только заполняет форму.
- Не выдумывай цифры, задания, награды и партнёров — бери их только из инструментов. Если не знаешь — так и скажи.
- Если нашёл что-то в интернете, кратко перескажи своими словами.
- Не проси и не принимай пароли, данные карт и коды.`;

let aiTransport = async (body) => {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    signal: AbortSignal.timeout(45000),
    headers: { 'content-type': 'application/json', 'x-api-key': config.mascot.anthropicKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`ИИ: HTTP ${res.status} ${data?.error?.message || ''}`.trim());
  return data;
};
export const setAiTransport = (fn) => {
  aiTransport = fn;
};
export const aiEnabled = () => !!config.mascot.anthropicKey;

const toolDefs = (u) =>
  Object.entries(TOOLS)
    .filter(([name]) => (u?.role === 'company' ? !['find_tasks', 'find_rewards', 'set_goal', 'prepare_redeem', 'my_stats', 'referral_link'].includes(name) : !['company_overview', 'draft_campaign'].includes(name)))
    .map(([name, t]) => ({ name, description: t.description, input_schema: t.schema }));

function contextLine(u, page) {
  const mode = modeName() === 'demo' ? 'ДЕМО-песочница (данные демонстрационные)' : 'настоящее приложение';
  if (!u) return `Режим: ${mode}. Пользователь не вошёл. Открыт раздел: ${page}.`;
  return `Режим: ${mode}. Пользователь: ${u.role === 'company' ? `студия «${u.company_name}»` : `участник ${u.name}`}, баланс ${u.balance} AB${u.is_admin ? ', администратор' : ''}. Открыт раздел: ${page}. Дата: ${new Date().toISOString().slice(0, 10)}.`;
}

async function aiTurn(message, history, u, page) {
  const messages = [...history.map((h) => ({ role: h.role, content: h.text })), { role: 'user', content: message }];
  const tools = [...toolDefs(u), { type: 'web_search_20250305', name: 'web_search', max_uses: 3 }];
  const actions = [];
  const used = [];
  const sources = new Map();
  let final = null;
  for (let round = 0; round < 6; round++) {
    const data = await aiTransport({ model: config.mascot.model, max_tokens: 900, system: `${SYSTEM}\n${contextLine(u, page)}`, tools, messages });
    const content = data.content || [];
    for (const b of content) {
      if (b.type === 'server_tool_use' && b.name === 'web_search') used.push('web_search');
      if (b.type === 'text') for (const c of b.citations || []) if (c.url && !sources.has(c.url)) sources.set(c.url, String(c.title || c.url).slice(0, 120));
    }
    if (data.stop_reason === 'pause_turn') {
      messages.push({ role: 'assistant', content });
      continue;
    }
    const calls = content.filter((b) => b.type === 'tool_use');
    if (data.stop_reason !== 'tool_use' || !calls.length) {
      final = content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
      break;
    }
    messages.push({ role: 'assistant', content });
    const results = calls.map((c) => {
      used.push(c.name);
      const r = runTool(c.name, c.input, u);
      for (const a of r.actions || []) actions.push(a);
      return { type: 'tool_result', tool_use_id: c.id, content: JSON.stringify(r.result).slice(0, 6000) };
    });
    messages.push({ role: 'user', content: results });
  }
  if (!final) throw new Error('ИИ не закончил ответ');
  return { reply: final.slice(0, 2500), actions, used, sources: [...sources].slice(0, 5).map(([url, title]) => ({ url, title })) };
}

// ---------------------------------------------------------------- вход
const buckets = new Map();
function rate(key, perHour) {
  const t = Date.now();
  const list = (buckets.get(key) || []).filter((x) => t - x < 3600e3);
  if (list.length >= perHour) throw new HttpError(429, 'Аби немного устал. Попробуй чуть позже.');
  list.push(t);
  buckets.set(key, list);
}

function cleanHistory(h) {
  return (Array.isArray(h) ? h : [])
    .filter((x) => x && (x.role === 'user' || x.role === 'assistant') && typeof x.text === 'string' && x.text.trim())
    .slice(-10)
    .map((x) => ({ role: x.role, text: x.text.slice(0, 1500) }))
    // История для ИИ должна начинаться с сообщения пользователя и чередоваться
    .filter((x, i, arr) => !(i === 0 && x.role !== 'user') && !(i > 0 && arr[i - 1].role === x.role));
}

/**
 * Один ход диалога с Аби. user — строка из базы (или null для гостя).
 * Возвращает { reply, actions, sources, mode: 'ai'|'local', used, suggestions }.
 */
export async function assist({ message, history = [], page = '', user = null, ip = '', channel = 'web' }) {
  const m = String(message || '').trim().slice(0, 800);
  if (m.length < 1) throw new HttpError(400, 'Напиши, что сделать');
  const u = user ? one('SELECT * FROM users WHERE id = ?', user.id) : null;
  const key = u ? `u${u.id}` : `ip${ip}`;
  const pg = String(page || '').slice(0, 60);
  if (aiEnabled()) {
    rate(`ai:${key}`, config.mascot.perHour);
    try {
      const r = await aiTurn(m, cleanHistory(history), u, pg);
      return { ...r, mode: 'ai', suggestions: suggestionsFor(u) };
    } catch (e) {
      console.error('[abi] ИИ недоступен, работаю в офлайн-режиме:', e.message);
    }
  } else rate(`local:${key}`, Math.max(120, config.mascot.perHour * 6));
  const r = localTurn(m, u);
  return { ...r, sources: [], mode: 'local', suggestions: suggestionsFor(u), channel };
}

export const assistantInfo = (user) => ({ ai: aiEnabled(), web: aiEnabled(), suggestions: suggestionsFor(user ? one('SELECT * FROM users WHERE id = ?', user.id) : null) });
