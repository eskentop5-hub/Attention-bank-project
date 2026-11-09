// ATTENTION BANK v5: презентация для гостей, туториал, маскот «Аби», статистика, аватары, серия 🔥.
// Модуль получает общие помощники из app.js через setup(), чтобы не было циклических импортов.
let D = null;
export function setup(deps) {
  D = deps;
}
const esc = (s) => D.esc(s);
const fmt = (n) => D.fmt(n);
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;

// ===================================================================
//                              АВАТАРЫ
// ===================================================================
export const AVATARS = {
  a1: ['#19B3D4', '#0B5F7A', '🦊'], a2: ['#F2B705', '#B5302A', '🐎'], a3: ['#7B6CF6', '#2B1F55', '🦉'], a4: ['#33D49B', '#0E5A43', '🐢'],
  a5: ['#FF6A4D', '#7A1E12', '🐉'], a6: ['#F7C843', '#6B4426', '🦁'], a7: ['#74D9EE', '#1B3B6F', '🐺'], a8: ['#E0457A', '#4A1030', '🦄'],
  a9: ['#9FD356', '#2D5016', '🐸'], a10: ['#B9C8D5', '#2A3B55', '🤖'], a11: ['#FFB25A', '#3B2A6B', '🚀'], a12: ['#3FD8F2', '#103040', '🎮'],
};
export function avatarHtml(user, cls = '') {
  const a = AVATARS[user?.avatar];
  const name = user?.role === 'company' ? user.companyName : user?.name;
  if (!a) return `<span class="ava ${cls}" aria-hidden="true">${esc(D.initials(name))}</span>`;
  return `<span class="ava has ${cls}" style="background:radial-gradient(circle at 30% 25%, ${a[0]}, ${a[1]})" aria-hidden="true"><span>${a[2]}</span></span>`;
}
export function avatarPicker(current) {
  return `<div class="ava-grid" role="radiogroup" aria-label="Аватар">${Object.entries(AVATARS)
    .map(([id, [c1, c2, g]]) => `<button type="button" class="ava-opt" role="radio" aria-checked="${current === id}" data-ava="${id}" style="background:radial-gradient(circle at 30% 25%, ${c1}, ${c2})"><span>${g}</span></button>`)
    .join('')}<button type="button" class="ava-opt none" role="radio" aria-checked="${!current}" data-ava="" title="Инициалы">Aa</button></div>`;
}

// Огонёк серии в шапке
export function streakChip(streak) {
  if (!streak) return '';
  const n = streak.current || 0;
  return `<a class="streak-chip ${n >= 3 ? 'hot' : ''} ${streak.today ? '' : 'cold'}" href="#/stats" title="Серия заходов: ${n} ${D.plural(n, 'день', 'дня', 'дней')} подряд. Лучшая: ${streak.best}">
    <span class="flame" aria-hidden="true">🔥</span><b>${n}</b><span class="sr-only">дней подряд</span></a>`;
}

// ===================================================================
//                     ПРЕЗЕНТАЦИЯ ДЛЯ ГОСТЕЙ (кнопками)
// ===================================================================
const PLATFORM = { steam: 'Steam', epic: 'Epic Games', google_play: 'Google Play', app_store: 'App Store', in_game: 'В игре', web: 'Онлайн' };
export const platformLabel = (p) => PLATFORM[p] || null;

export async function viewDeck({ query } = {}) {
  const [{ rewards }, stats] = await Promise.all([D.api('/api/public/rewards').catch(() => ({ rewards: [] })), D.api('/api/stats').catch(() => null)]);
  const reg = `<a class="btn btn-primary btn-lg" href="#/register">Создать аккаунт</a>`;
  const login = `<a class="btn btn-ghost btn-lg" href="#/login">Войти</a>`;
  const stage = (model, variant = 0, d = 3.3) => `<div class="deck-3d view3d" data-3d data-model="${model}" data-variant="${variant}" data-wheel="focus" data-distance="${d}" aria-label="3D-модель. Перетащите, чтобы повернуть"></div>`;
  const slides = [
    {
      k: 'National Founder Cup 2026 · Шымкент · команда SithOrder',
      html: `<h1 class="deck-h1">Ваше внимание.<span>Ваша ценность.</span></h1>
        <p class="deck-lead">ATTENTION BANK — место, где компании платят за ваше внимание честно: вы тестируете игры и приложения, а взамен получаете ключи игр, предметы и подписки.</p>
        <div class="row">${reg}${login}</div>`,
      model: ['rocket', 0, 3.5],
    },
    {
      k: 'Проблема',
      html: `<h2 class="deck-h2">Внимание стало валютой. Но платят за него не вам.</h2>
        <div class="deck-points">
          <div class="pt tilt"><b>Реклама</b><span>Забирает минуты каждый день — и ничего не даёт взамен.</span></div>
          <div class="pt tilt"><b>Студии</b><span>Не могут найти честных тестировщиков: опросы заполняют наугад.</span></div>
          <div class="pt tilt"><b>Люди</b><span>Хотят заранее знать, сколько времени отдают и что получат.</span></div>
        </div>`,
      model: ['planet', 0, 3.6],
    },
    {
      k: 'Как это работает',
      html: `<h2 class="deck-h2">Четыре шага. Всё видно заранее.</h2>
        <ol class="deck-steps">
          <li class="tilt"><i>1</i><b>Выберите задание</b><span>Время и награда указаны до старта</span></li>
          <li class="tilt"><i>2</i><b>Протестируйте продукт</b><span>Игра, прототип или видео — прямо в браузере</span></li>
          <li class="tilt"><i>3</i><b>Ответ проверяется</b><span>Время, смысл, дубликаты, контрольный вопрос</span></li>
          <li class="tilt"><i>4</i><b>AB Points на баланс</b><span>И сразу можно менять на награды</span></li>
        </ol>`,
      model: ['sputnik', 0, 3.6],
    },
    {
      k: 'Что можно получить',
      html: `<h2 class="deck-h2">Ключи игр. Предметы. Подписки.</h2>
        <p class="deck-lead">Награды дают сами студии: ключи своих игр для Steam, Epic Games и Google Play, внутриигровые предметы, премиум-доступ.</p>
        <div class="deck-rewards">${rewards
          .slice(0, 6)
          .map((r) => `<div class="dr tilt"><span class="plat">${esc(platformLabel(r.platform) || r.categoryLabel)}</span><b>${esc(r.title)}</b><span class="cost">${fmt(r.cost)}<small>AB</small></span>${r.demo ? '<span class="badge demo">демо</span>' : ''}</div>`)
          .join('')}</div>
        <p class="tiny muted">Хотим подключить Kaspi, YouTube Premium и другие сервисы — партнёрств пока нет, поэтому таких наград в каталоге нет.</p>`,
      model: ['game_box', 0, 3.2],
    },
    {
      k: 'Настоящие продукты внутри',
      html: `<h2 class="deck-h2">Не примеры. Работающие продукты.</h2>
        <p class="deck-lead">Каждое демо-задание ведёт на настоящий продукт. Попробуйте прямо сейчас — без регистрации.</p>
        <div class="deck-products">
          <a class="dp tilt" href="/play/steppe-runner/index.html" target="_blank" rel="noopener"><b>Steppe Runner</b><span>Играбельный раннер: 3 уровня, день и ночь</span><em>Играть →</em></a>
          <a class="dp tilt" href="/play/steppe-runner/store.html" target="_blank" rel="noopener"><b>Страница игры</b><span>Магазин и трейлер на движке игры</span><em>Открыть →</em></a>
          <a class="dp tilt" href="/play/qadam/index.html" target="_blank" rel="noopener"><b>Qadam</b><span>Прототип подготовки к ЕНТ с уроком</span><em>Попробовать →</em></a>
          <a class="dp tilt" href="/play/inventory/index.html" target="_blank" rel="noopener"><b>Инвентарь A/B</b><span>Замер времени поиска предмета</span><em>Пройти →</em></a>
          <a class="dp tilt" href="/play/video/index.html?v=steppe" target="_blank" rel="noopener"><b>Видео-тесты</b><span>Трейлер и реклама с контрольным вопросом</span><em>Смотреть →</em></a>
        </div>`,
      model: ['phone', 0, 3.2],
    },
    {
      k: 'Честность',
      html: `<h2 class="deck-h2">Проверка, которую нельзя обмануть. И которая не обманывает вас.</h2>
        <div class="deck-points">
          <div class="pt tilt"><b>Контрольные вопросы</b><span>В видео есть слово, которое видно только тому, кто смотрел.</span></div>
          <div class="pt tilt"><b>Баланс = сумма транзакций</b><span>Каждое начисление и списание записано и сверяется автоматически.</span></div>
          <div class="pt tilt"><b>AB Points — не деньги</b><span>Мы не обещаем вывод. Только обмен на реальные награды студий.</span></div>
        </div>`,
      model: ['in_game', 2, 3.3],
    },
    {
      k: 'Ваш прогресс',
      html: `<h2 class="deck-h2">Видно всё: сколько заработали вчера и что впереди.</h2>
        <div class="deck-points">
          <div class="pt tilt"><b>🔥 Серия заходов</b><span>Сколько дней подряд вы с нами.</span></div>
          <div class="pt tilt"><b>Статистика по дням</b><span>Вчера, позавчера, неделя, лучший день, AB за час внимания.</span></div>
          <div class="pt tilt"><b>Маскот Аби</b><span>Ходит по экрану, подсказывает и отвечает на вопросы.</span></div>
        </div>`,
      model: ['trophy', 0, 3.3],
    },
    {
      k: 'Для компаний',
      html: `<h2 class="deck-h2">Платите только за проверенный результат.</h2>
        <p class="deck-lead">Бюджет резервируется при запуске, а списывается только за одобренные ответы. Отчёты по вопросам, оценки качества и выгрузка в CSV.</p>
        ${stats ? `<div class="deck-stats"><div><b>${fmt(stats.verifiedResults ?? 0)}</b><span>подтверждённых результатов</span></div><div><b>${fmt(stats.paidOut ?? 0)} AB</b><span>начислено участникам</span></div><div><b>${fmt(stats.activeCampaigns ?? 0)}</b><span>открытых заданий</span></div></div>` : ''}
        <div class="row"><a class="btn btn-ghost btn-lg" href="#/register?role=company">Я представляю компанию</a></div>`,
      model: ['game_access', 0, 3.2],
    },
    {
      k: 'Экономика',
      html: `<h2 class="deck-h2">Замкнутый круг, где выигрывают все.</h2>
        <div class="eco-mini">
          <div class="tilt"><b>Компании</b><span>Пополняют бюджет: 1 AB = 10 ₸. Платят только за одобренный результат.</span></div>
          <div class="tilt"><b>Участники</b><span>Получают AB за внимание и меняют их на награды.</span></div>
          <div class="tilt"><b>Продавцы наград</b><span>Получают 90% стоимости каждого обмена и выводят выручку в тенге.</span></div>
          <div class="tilt"><b>Платформа</b><span>20% с результата и 10% с продажи. Баллы из воздуха не появляются.</span></div>
        </div>
        <div class="row"><a class="btn btn-ghost btn-lg" href="#/economy">Живые цифры экономики →</a></div>`,
      model: ['coin', 0, 3.2],
    },
    {
      k: 'Начнём',
      html: `<h2 class="deck-h1" style="font-size:clamp(2.2rem,6vw,4.6rem)">Ваше внимание<span>чего-то стоит.</span></h2>
        <p class="deck-lead">Создайте аккаунт за минуту — короткое обучение покажет, где что находится.</p>
        <div class="row">${reg}${login}</div>`,
      model: ['rocket', 0, 3.5],
    },
  ];
  let i = Math.min(slides.length - 1, Math.max(0, Number(query?.s || 0) || 0));
  D.app.innerHTML = `
  <section class="deck" aria-roledescription="презентация" aria-label="Презентация ATTENTION BANK">
    ${slides
      .map(
        (s, n) => `<article class="slide" data-n="${n}" ${n === i ? '' : 'hidden'} aria-roledescription="слайд" aria-label="${n + 1} из ${slides.length}">
      <div class="slide-copy"><p class="kicker">${esc(s.k)}</p>${s.html}</div>
      <div class="slide-art">${stage(...s.model)}</div>
    </article>`
      )
      .join('')}
    <div class="deck-bar">
      <button class="btn btn-ghost deck-prev" type="button" aria-label="Предыдущий слайд">←</button>
      <div class="deck-dots" role="tablist">${slides.map((_, n) => `<button type="button" role="tab" aria-label="Слайд ${n + 1}" aria-selected="${n === i}" data-go="${n}"></button>`).join('')}</div>
      <span class="deck-count num" aria-live="polite"></span>
      <button class="btn btn-primary deck-next" type="button">Далее →</button>
    </div>
  </section>`;
  const deck = D.app.querySelector('.deck');
  const show = (n) => {
    i = Math.max(0, Math.min(slides.length - 1, n));
    deck.querySelectorAll('.slide').forEach((el, k) => {
      el.hidden = k !== i;
      if (k === i) {
        el.classList.remove('in');
        void el.offsetWidth;
        el.classList.add('in');
      }
    });
    deck.querySelectorAll('[data-go]').forEach((b, k) => b.setAttribute('aria-selected', k === i));
    deck.querySelector('.deck-count').textContent = `${i + 1} / ${slides.length}`;
    deck.querySelector('.deck-prev').disabled = i === 0;
    const next = deck.querySelector('.deck-next');
    next.textContent = i === slides.length - 1 ? 'Создать аккаунт →' : 'Далее →';
    history.replaceState(null, '', `#/?s=${i}`);
  };
  deck.querySelector('.deck-prev').onclick = () => show(i - 1);
  deck.querySelector('.deck-next').onclick = () => (i === slides.length - 1 ? (location.hash = '#/register') : show(i + 1));
  deck.querySelectorAll('[data-go]').forEach((b) => (b.onclick = () => show(Number(b.dataset.go))));
  const key = (e) => {
    if (!document.body.contains(deck)) return removeEventListener('keydown', key);
    if (e.target.closest('input,textarea,select,[data-3d]')) return;
    if (e.key === 'ArrowRight' || e.key === 'PageDown') show(i + 1);
    if (e.key === 'ArrowLeft' || e.key === 'PageUp') show(i - 1);
  };
  addEventListener('keydown', key);
  show(i);
  D.enhance();
}

// ===================================================================
//                              СТАТИСТИКА
// ===================================================================
const dayShort = (key) => new Date(key + 'T12:00:00Z').toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
const weekday = (key) => new Date(key + 'T12:00:00Z').toLocaleDateString('ru-RU', { weekday: 'short' });

function barChart(days, { h = 220, id = 'bars', W = 1100 } = {}) {
  const max = Math.max(10, ...days.map((d) => d.earned));
  const step = Math.ceil(max / 4 / 10) * 10 || 10;
  const top = step * 4;
  const padL = 34, padB = 28, padT = 12, bw = (W - padL) / days.length;
  const y = (v) => padT + (h - padT - padB) * (1 - v / top);
  const grid = [0, 1, 2, 3, 4].map((k) => `<line x1="${padL}" x2="${W}" y1="${y(k * step)}" y2="${y(k * step)}" class="gl"/><text x="${padL - 6}" y="${y(k * step) + 4}" class="ax" text-anchor="end">${k * step}</text>`).join('');
  const bars = days
    .map((d, k) => {
      const x = padL + k * bw + 3, w = bw - 6, yy = y(d.earned), hh = Math.max(0, y(0) - yy);
      return `<g class="bar" data-k="${k}" tabindex="0" role="img" aria-label="${dayShort(d.day)}: заработано ${d.earned} AB, потрачено ${d.spent} AB, заданий ${d.tasks}">
        <rect class="hit" x="${padL + k * bw}" y="${padT}" width="${bw}" height="${h - padT - padB}"/>
        ${hh > 0 ? `<path class="mk" d="M${x},${y(0)} V${yy + 4} Q${x},${yy} ${x + 4},${yy} H${x + w - 4} Q${x + w},${yy} ${x + w},${yy + 4} V${y(0)} Z"/>` : `<line class="zero" x1="${x}" x2="${x + w}" y1="${y(0) - 1}" y2="${y(0) - 1}"/>`}
        ${k % 2 === days.length % 2 || days.length <= 7 ? `<text x="${x + w / 2}" y="${h - 8}" class="ax" text-anchor="middle">${days.length <= 7 ? weekday(d.day) : dayShort(d.day)}</text>` : ''}
      </g>`;
    })
    .join('');
  return `<div class="chart" id="${id}"><svg viewBox="0 0 ${W} ${h}" role="group" aria-label="Заработок AB Points по дням">${grid}${bars}</svg><div class="tip" hidden></div></div>`;
}
function bindChart(root, days, onPick, { count = ['задание', 'задания', 'заданий'], verb = 'заработано' } = {}) {
  const tip = root.querySelector('.tip');
  root.querySelectorAll('.bar').forEach((g) => {
    const d = days[Number(g.dataset.k)];
    const show = () => {
      root.querySelectorAll('.bar').forEach((x) => x.classList.toggle('dim', x !== g));
      tip.hidden = false;
      tip.innerHTML = `<b>${dayShort(d.day)}, ${weekday(d.day)}</b><span>+${d.earned} AB ${verb}</span>${d.spent ? `<span>−${d.spent} AB на награды</span>` : ''}<span>${d.tasks} ${D.plural(d.tasks, ...count)}</span>`;
      const r = g.getBoundingClientRect(), rr = root.getBoundingClientRect();
      tip.style.left = `${Math.min(rr.width - 170, Math.max(0, r.left - rr.left + r.width / 2 - 80))}px`;
    };
    const hide = () => {
      tip.hidden = true;
      root.querySelectorAll('.bar').forEach((x) => x.classList.remove('dim'));
    };
    g.addEventListener('pointerenter', show);
    g.addEventListener('focus', show);
    g.addEventListener('pointerleave', hide);
    g.addEventListener('blur', hide);
    g.addEventListener('click', () => onPick?.(d));
  });
}
function ring(p, label, sub) {
  const r = 34, c = 2 * Math.PI * r, v = Math.max(0, Math.min(100, p ?? 0));
  return `<div class="ring"><svg viewBox="0 0 84 84" aria-hidden="true"><circle cx="42" cy="42" r="${r}" class="rt"/><circle cx="42" cy="42" r="${r}" class="rv" stroke-dasharray="${(c * v) / 100} ${c}" transform="rotate(-90 42 42)"/></svg><div><b>${p === null || p === undefined ? '—' : `${p}%`}</b><span>${label}</span>${sub ? `<small>${sub}</small>` : ''}</div></div>`;
}
const delta = (a, b) => (b ? Math.round(((a - b) / b) * 100) : null);

export async function viewStats() {
  const s = await D.api('/api/me/stats');
  const wd = delta(s.week, s.prevWeek);
  const cats = Object.entries(s.byCategory).sort((a, b) => b[1] - a[1]);
  const catMax = Math.max(1, ...cats.map((c) => c[1]));
  const catLabel = (id) => D.state.meta.categories.find((c) => c.id === id)?.label || id;
  D.app.innerHTML = `
  <div class="page-head"><div><h1>Статистика</h1><p>Считается из ваших реальных транзакций и ответов — без оценок «на глаз».</p></div><a class="btn btn-ghost" href="#/activity">Вся активность</a></div>
  <div class="kpi-row">
    <div class="kpi tilt"><span>Сегодня</span><b>+${fmt(s.today.earned)}<small>AB</small></b><em>${s.today.tasks} ${D.plural(s.today.tasks, 'задание', 'задания', 'заданий')}</em></div>
    <div class="kpi tilt"><span>Вчера</span><b>+${fmt(s.yesterday.earned)}<small>AB</small></b><em>${s.yesterday.tasks} ${D.plural(s.yesterday.tasks, 'задание', 'задания', 'заданий')}</em></div>
    <div class="kpi tilt"><span>Позавчера</span><b>+${fmt(s.dayBefore.earned)}<small>AB</small></b><em>${s.dayBefore.tasks} ${D.plural(s.dayBefore.tasks, 'задание', 'задания', 'заданий')}</em></div>
    <div class="kpi tilt"><span>За 7 дней</span><b>+${fmt(s.week)}<small>AB</small></b><em>${wd === null ? 'прошлая неделя: 0' : `${wd >= 0 ? '▲' : '▼'} ${Math.abs(wd)}% к прошлой неделе`}</em></div>
    <div class="kpi tilt gold"><span>Всего заработано</span><b>${fmt(s.totalEarned)}<small>AB</small></b><em>потрачено на награды: ${fmt(s.totalSpent)} AB</em></div>
  </div>
  <section class="panel" style="margin-top:20px">
    <div class="section-head" style="margin:0 0 6px"><h2 style="font-size:1.15rem">Заработок за 14 дней</h2><span class="small muted">${s.bestDay ? `Лучший день: <b style="color:var(--ink)">${dayShort(s.bestDay.day)} · +${s.bestDay.earned} AB</b>` : 'Пока без начислений'}</span></div>
    ${barChart(s.days)}
    <div class="small muted" id="pick" aria-live="polite">Наведите или нажмите на столбец, чтобы увидеть детали дня.</div>
    <details class="tiny muted" style="margin-top:8px"><summary>Таблица по дням</summary><table class="table" style="margin-top:8px"><thead><tr><th>День</th><th class="r">Заработано</th><th class="r">Потрачено</th><th class="r">Заданий</th></tr></thead><tbody>${[...s.days].reverse().map((d) => `<tr><td>${dayShort(d.day)}</td><td class="r">+${d.earned}</td><td class="r">${d.spent ? `−${d.spent}` : '0'}</td><td class="r">${d.tasks}</td></tr>`).join('')}</tbody></table></details>
  </section>
  <div class="stats-grid">
    <section class="panel tilt">
      <h2 style="font-size:1.1rem">🔥 Серия заходов</h2>
      <div class="streak-big"><b>${s.streak.current}</b><span>${D.plural(s.streak.current, 'день', 'дня', 'дней')} подряд<br><small class="muted">лучшая: ${s.streak.best}</small></span></div>
      <div class="week">${s.streak.week.map((w) => `<span class="${w.visited ? 'on' : ''}" title="${dayShort(w.day)}"><i>${w.visited ? '🔥' : ''}</i>${weekday(w.day)}</span>`).join('')}</div>
      <p class="tiny muted" style="margin:10px 0 0">Заходите каждый день, чтобы серия росла. Баллы за серию не начисляются — это ваша личная мотивация.</p>
    </section>
    <section class="panel tilt">
      <h2 style="font-size:1.1rem">Челлендж дня</h2>
      ${ring(Math.round((Math.min(s.challenge.done, s.challenge.goal) / s.challenge.goal) * 100), `${s.challenge.done} из ${s.challenge.goal} заданий`, s.challenge.complete ? 'выполнен ✓' : 'сегодня')}
      <p class="tiny muted" style="margin:10px 0 0">Выполните ${s.challenge.goal} ${D.plural(s.challenge.goal, 'задание', 'задания', 'заданий')} за день. Бонуса нет: баллы платят только компании за результат.</p>
      <a class="btn btn-ghost btn-sm" href="#/tasks" style="margin-top:10px">К заданиям</a>
    </section>
    <section class="panel tilt">
      <h2 style="font-size:1.1rem">Качество ответов</h2>
      ${ring(s.approvalRate, 'одобрено', `${s.approved} принято · ${s.rejected} отклонено${s.pending ? ` · ${s.pending} на проверке` : ''}`)}
      <div class="mini-kv"><span>Среднее время на задание</span><b>${s.avgMinutes ?? '—'}${s.avgMinutes ? ' мин' : ''}</b></div>
      <div class="mini-kv"><span>AB за час внимания</span><b>${s.abPerHour ?? '—'}</b></div>
    </section>
    <section class="panel tilt">
      <h2 style="font-size:1.1rem">Откуда баллы</h2>
      ${cats.length ? cats.map(([id, v]) => `<div class="hbar"><span>${esc(catLabel(id))}</span><div><i style="width:${(v / catMax) * 100}%"></i></div><b>${fmt(v)} AB</b></div>`).join('') : '<p class="small muted">Появится после первого одобренного задания.</p>'}
    </section>
  </div>`;
  bindChart(D.app.querySelector('#bars'), s.days, (d) => {
    D.app.querySelector('#pick').innerHTML = `<b style="color:var(--ink)">${dayShort(d.day)}:</b> +${d.earned} AB заработано${d.spent ? `, −${d.spent} AB потрачено` : ''}, ${d.tasks} ${D.plural(d.tasks, 'задание', 'задания', 'заданий')}.`;
  });
  D.enhance();
}

// Мини-график для главной (7 дней)
export function pulseBlock(p) {
  if (!p) return '';
  return `<div class="pulse-card tilt">
    <div class="pulse-top">
      <a class="pulse-streak" href="#/stats"><span class="flame">🔥</span><b>${p.streak.current}</b><span>${D.plural(p.streak.current, 'день', 'дня', 'дней')} подряд</span></a>
      <div class="pulse-nums"><div><b>+${fmt(p.today)}</b><span>сегодня</span></div><div><b>+${fmt(p.yesterday)}</b><span>вчера</span></div><div><b>+${fmt(p.dayBefore)}</b><span>позавчера</span></div></div>
    </div>
    ${barChart(p.days, { h: 150, id: 'pulse-bars', W: 640 })}
    <div class="challenge"><span>Челлендж дня: <b>${p.challenge.done}/${p.challenge.goal}</b> ${p.challenge.complete ? '✓' : 'заданий'}</span><div class="meter"><i style="--p:${Math.min(100, (p.challenge.done / p.challenge.goal) * 100)}%"></i></div><a href="#/stats">Статистика →</a></div>
  </div>`;
}
export function bindPulse(root, p) {
  const el = root.querySelector('#pulse-bars');
  if (el && p) bindChart(el, p.days);
}

// ===================================================================
//                         МАСКОТ «АБИ»
// ===================================================================
// Маскот: банан внутри золотой монеты с буквами «AT» (векторный, анимируется: ходьба, взмах рукой, моргание)
const MASCOT_SVG = `<svg viewBox="0 0 100 120" aria-hidden="true">
  <defs>
    <radialGradient id="mBan" cx="38%" cy="26%" r="78%"><stop offset="0" stop-color="#FFF6B0"/><stop offset=".35" stop-color="#FBDD3A"/><stop offset=".8" stop-color="#EDBE12"/><stop offset="1" stop-color="#C99406"/></radialGradient>
    <linearGradient id="mLimb" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FCE24C"/><stop offset="1" stop-color="#E2B10C"/></linearGradient>
    <radialGradient id="mCoin" cx="40%" cy="32%" r="75%"><stop offset="0" stop-color="#FFF0A0"/><stop offset=".45" stop-color="#F7C928"/><stop offset="1" stop-color="#C98E06"/></radialGradient>
    <linearGradient id="mRim" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFE67A"/><stop offset=".5" stop-color="#E0A50A"/><stop offset="1" stop-color="#A87204"/></linearGradient>
    <linearGradient id="mTxt" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFE05A"/><stop offset=".55" stop-color="#FFA62B"/><stop offset="1" stop-color="#F26B12"/></linearGradient>
    <radialGradient id="mIris" cx="40%" cy="35%" r="70%"><stop offset="0" stop-color="#B07432"/><stop offset="1" stop-color="#4A2A0E"/></radialGradient>
  </defs>
  <ellipse cx="50" cy="116" rx="24" ry="3.6" fill="rgba(0,0,0,.35)"/>
  <g class="leg l"><path d="M43 95 L41 109" stroke="url(#mLimb)" stroke-width="5" stroke-linecap="round"/><ellipse cx="38.5" cy="111.5" rx="6.5" ry="3.4" fill="#E9B80F"/><ellipse cx="37" cy="110.6" rx="3" ry="1.2" fill="#FFF0A0" opacity=".7"/></g>
  <g class="leg r"><path d="M57 95 L59 109" stroke="url(#mLimb)" stroke-width="5" stroke-linecap="round"/><ellipse cx="61.5" cy="111.5" rx="6.5" ry="3.4" fill="#E9B80F"/><ellipse cx="60" cy="110.6" rx="3" ry="1.2" fill="#FFF0A0" opacity=".7"/></g>
  <g class="body">
    <path d="M47.5 9.5 C47 5 48.5 2 51 0.8 L56 1.6 C53.8 3.4 52.8 6.4 52.8 9.6 Z" fill="#8A5A1C"/><ellipse cx="53.5" cy="1.3" rx="2.8" ry="1.3" fill="#4E3210"/>
    <path d="M50 8.5 C38 9 30.5 21 29.5 40 C29 50 28.5 62 28.5 82 C28.5 94 38 99 50 99 C62 99 71.5 94 71.5 82 C71.5 62 71 50 70.5 40 C69.5 21 62 9 50 8.5 Z" fill="url(#mBan)"/>
    <path d="M38 14 C33 22 32 32 32.5 44" stroke="#FFFBD6" stroke-width="2.4" fill="none" stroke-linecap="round" opacity=".75"/>
    <path d="M62 13 C67 22 68.5 32 68.5 46" stroke="#B88507" stroke-width="1.2" fill="none" opacity=".45"/>
    <circle cx="63" cy="22" r=".9" fill="#8A5A1C" opacity=".5"/><circle cx="35" cy="50" r=".8" fill="#8A5A1C" opacity=".45"/>
    <g class="eyes">
      <ellipse cx="41" cy="31" rx="7.6" ry="8.8" fill="#fff" stroke="#8A6A10" stroke-width=".6"/><ellipse cx="59" cy="31" rx="7.6" ry="8.8" fill="#fff" stroke="#8A6A10" stroke-width=".6"/>
      <g class="pupils"><circle cx="42.2" cy="32.2" r="4.7" fill="url(#mIris)"/><circle cx="60.2" cy="32.2" r="4.7" fill="url(#mIris)"/><circle cx="42.4" cy="32.5" r="2.5" fill="#120A04"/><circle cx="60.4" cy="32.5" r="2.5" fill="#120A04"/>
      <circle cx="40.6" cy="30.2" r="1.5" fill="#fff"/><circle cx="58.6" cy="30.2" r="1.5" fill="#fff"/><circle cx="43.8" cy="34" r=".7" fill="#fff"/><circle cx="61.8" cy="34" r=".7" fill="#fff"/></g>
    </g>
    <path d="M34.5 20 Q40 16 46 19" stroke="#6B3E12" stroke-width="2" fill="none" stroke-linecap="round"/><path d="M54 19 Q60 16 65.5 20" stroke="#6B3E12" stroke-width="2" fill="none" stroke-linecap="round"/>
    <path d="M41.5 41.5 Q50 49.5 58.5 41.5" stroke="#7A3E10" stroke-width="2.2" fill="none" stroke-linecap="round"/>
    <ellipse cx="34.5" cy="40" rx="3.6" ry="2.2" fill="#FF9A4D" opacity=".4"/><ellipse cx="65.5" cy="40" rx="3.6" ry="2.2" fill="#FF9A4D" opacity=".4"/>
    <circle cx="50" cy="78" r="27" fill="url(#mRim)"/>
    <circle cx="50" cy="78" r="25.6" fill="none" stroke="#9C6A04" stroke-width="2.2" stroke-dasharray="1.1 1.1" opacity=".75"/>
    <circle cx="50" cy="78" r="22.5" fill="url(#mCoin)" stroke="#FFF3B5" stroke-width="1" stroke-opacity=".8"/>
    <circle cx="50" cy="78" r="19.5" fill="none" stroke="#C99406" stroke-width=".7" opacity=".6"/>
    <path d="M37 67 A18 18 0 0 1 58 60.5" stroke="#FFFBE0" stroke-width="2" fill="none" stroke-linecap="round" opacity=".7"/>
    <text x="50" y="86" text-anchor="middle" font-family="'Arial Black','Geologica',system-ui,sans-serif" font-weight="900" font-size="21" letter-spacing="-.6" fill="none" stroke="#EAF7FF" stroke-width="5.2" stroke-linejoin="round">AT</text>
    <text x="50" y="86" text-anchor="middle" font-family="'Arial Black','Geologica',system-ui,sans-serif" font-weight="900" font-size="21" letter-spacing="-.6" fill="url(#mTxt)" stroke="#1D57B5" stroke-width="2.2" stroke-linejoin="round" paint-order="stroke">AT</text>
    <path d="M31.5 72 l1 2.6 2.6 1 -2.6 1 -1 2.6 -1 -2.6 -2.6 -1 2.6 -1 z" fill="#fff"/><path d="M68.5 65 l.8 2 2 .8 -2 .8 -.8 2 -.8 -2 -2 -.8 2 -.8 z" fill="#fff" opacity=".9"/>
    <g class="arm l"><path d="M24 70 Q15 64 12 54" stroke="url(#mLimb)" stroke-width="4.6" fill="none" stroke-linecap="round"/>
      <g fill="#F6CD22"><ellipse cx="11" cy="48.5" rx="5.6" ry="5"/><rect x="5.2" y="38" width="2.6" height="9" rx="1.3" transform="rotate(-18 6.5 42)"/><rect x="8.4" y="36" width="2.6" height="10" rx="1.3" transform="rotate(-6 9.7 41)"/><rect x="11.6" y="36" width="2.6" height="10" rx="1.3" transform="rotate(6 12.9 41)"/><rect x="14.6" y="38" width="2.6" height="9" rx="1.3" transform="rotate(18 15.9 42)"/><rect x="15.5" y="46" width="2.6" height="7" rx="1.3" transform="rotate(55 16.8 49.5)"/></g></g>
    <g class="arm r"><path d="M76 70 Q85 64 88 54" stroke="url(#mLimb)" stroke-width="4.6" fill="none" stroke-linecap="round"/>
      <g fill="#F6CD22"><ellipse cx="89" cy="48.5" rx="5.6" ry="5"/><rect x="82.8" y="38" width="2.6" height="9" rx="1.3" transform="rotate(-18 84.1 42)"/><rect x="85.8" y="36" width="2.6" height="10" rx="1.3" transform="rotate(-6 87.1 41)"/><rect x="89" y="36" width="2.6" height="10" rx="1.3" transform="rotate(6 90.3 41)"/><rect x="92.2" y="38" width="2.6" height="9" rx="1.3" transform="rotate(18 93.5 42)"/><rect x="81.9" y="46" width="2.6" height="7" rx="1.3" transform="rotate(-55 83.2 49.5)"/></g></g>
  </g>
</svg>`;

const mascot = { el: null, x: 80, dir: 1, speed: 38, pause: 0, raf: 0, last: 0, bubbleT: 0, chat: [], open: false };

function phrases() {
  const s = D.state;
  const me = s.me;
  const path = location.hash || '#/';
  const list = [];
  if (!me) {
    list.push('Сәлем! Я Аби. Листай презентацию кнопкой «Далее» →', 'Игры в заданиях настоящие — их можно попробовать без регистрации!', 'Нажми на меня, если есть вопрос 🙂', 'AB Points — не деньги, зато честно меняются на награды.');
    return list;
  }
  if (me.role === 'company') return ['Платите только за одобренные ответы — остальное вернётся в бюджет.', 'Контрольный вопрос в задании отсеивает тех, кто не смотрел видео.', 'Нажмите на меня — расскажу, как создать кампанию.'];
  const st = s.streak?.current || 0;
  if (st >= 2) list.push(`🔥 ${st} ${D.plural(st, 'день', 'дня', 'дней')} подряд! Не сбавляй темп.`);
  else list.push('Заходи завтра — начнётся серия 🔥');
  list.push(`На балансе ${fmt(me.balance)} AB. Загляни в «Награды»!`);
  if (path.startsWith('#/tasks')) list.push('Подробные ответы одобряют быстрее.', 'В видео-тестах запоминай контрольное слово 👀');
  if (path.startsWith('#/rewards')) list.push('Поверни 3D-модель — у каждой награды своя!', 'Отметь награду целью — покажу, какие задания к ней ведут.');
  if (path.startsWith('#/stats')) list.push('Наведи на столбик — увидишь, сколько заработал в тот день.');
  if (path.startsWith('#/home')) list.push('Вчерашний заработок — в карточке «Пульс» 📈');
  list.push('Есть вопрос? Нажми на меня.');
  return list;
}

export function mountMascot() {
  if (mascot.el || D.store.get('ab_mascot') === 'off') return;
  const el = document.createElement('div');
  el.className = 'mascot';
  el.innerHTML = `<button type="button" class="mascot-btn" aria-label="Маскот Аби: задать вопрос">${MASCOT_SVG}</button><div class="mascot-say" hidden></div>`;
  document.body.append(el);
  mascot.el = el;
  mascot.x = Math.min(innerWidth - 120, 60 + Math.random() * 200);
  el.querySelector('.mascot-btn').onclick = () => openChat();
  if (!REDUCED) mascot.raf = requestAnimationFrame(walk);
  else el.style.transform = `translateX(${mascot.x}px)`;
  setTimeout(() => say(phrases()[0]), 2500);
  mascot.sayTimer = setInterval(() => {
    if (!mascot.open && !document.hidden) {
      const p = phrases();
      say(p[Math.floor(Math.random() * p.length)]);
    }
  }, 16000);
}
export function unmountMascot() {
  cancelAnimationFrame(mascot.raf);
  clearInterval(mascot.sayTimer);
  mascot.el?.remove();
  mascot.el = null;
  document.querySelector('.mascot-chat')?.remove();
  mascot.open = false;
}
function walk(t) {
  const dt = Math.min(0.05, (t - (mascot.last || t)) / 1000);
  mascot.last = t;
  const el = mascot.el;
  if (!el) return;
  const maxX = innerWidth - 100;
  if (mascot.pause > 0 || mascot.open) {
    mascot.pause -= dt;
    el.classList.remove('walking');
  } else {
    el.classList.add('walking');
    mascot.x += mascot.dir * mascot.speed * dt;
    if (mascot.x > maxX) (mascot.x = maxX), (mascot.dir = -1), (mascot.pause = 1.5);
    if (mascot.x < 12) (mascot.x = 12), (mascot.dir = 1), (mascot.pause = 1.5);
    if (Math.random() < dt * 0.12) mascot.pause = 2 + Math.random() * 3;
  }
  el.style.transform = `translateX(${mascot.x}px)`;
  el.querySelector('.mascot-btn').style.transform = `scaleX(${mascot.dir})`;
  mascot.raf = requestAnimationFrame(walk);
}
function say(text) {
  const b = mascot.el?.querySelector('.mascot-say');
  if (!b) return;
  b.textContent = text;
  b.hidden = false;
  b.classList.toggle('left', mascot.x > innerWidth * 0.4);
  mascot.pause = Math.max(mascot.pause, 4);
  clearTimeout(mascot.bubbleT);
  mascot.bubbleT = setTimeout(() => (b.hidden = true), 5200);
}

function openChat() {
  if (document.querySelector('.mascot-chat')) return closeChat();
  mascot.open = true;
  mascot.el.querySelector('.mascot-say').hidden = true;
  const panel = document.createElement('section');
  panel.className = 'mascot-chat';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Чат с маскотом Аби');
  const quick = D.state.me ? ['Как получить ключ Steam?', 'Почему ответ отклонили?', 'Что такое серия 🔥?', 'Можно вывести AB в тенге?'] : ['Что такое ATTENTION BANK?', 'Это бесплатно?', 'Что можно получить?', 'Игры настоящие?'];
  panel.innerHTML = `<header><span class="mini">${MASCOT_SVG}</span><div><b>Аби</b><small id="m-src">маскот ATTENTION BANK</small></div><button type="button" class="x" aria-label="Закрыть">✕</button></header>
    <div class="msgs" aria-live="polite"></div>
    <div class="quick">${quick.map((q) => `<button type="button">${esc(q)}</button>`).join('')}</div>
    <form><input class="input" maxlength="500" placeholder="Спросите что-нибудь…" aria-label="Ваш вопрос" autocomplete="off"><button class="btn btn-primary" type="submit">→</button></form>`;
  document.body.append(panel);
  const msgs = panel.querySelector('.msgs');
  const add = (who, text, src) => {
    mascot.chat.push({ who, text, src });
    msgs.insertAdjacentHTML('beforeend', `<div class="m ${who}">${esc(text)}${src ? `<small>${src === 'ai' ? 'ответ ИИ (Claude)' : 'из базы знаний'}</small>` : ''}</div>`);
    msgs.scrollTop = msgs.scrollHeight;
  };
  if (!mascot.chat.length) add('bot', D.state.me ? `Привет, ${D.state.me.role === 'company' ? D.state.me.companyName : D.state.me.name}! Чем помочь?` : 'Сәлем! Я Аби. Спросите про платформу — отвечу.');
  else for (const m of mascot.chat) msgs.insertAdjacentHTML('beforeend', `<div class="m ${m.who}">${esc(m.text)}${m.src ? `<small>${m.src === 'ai' ? 'ответ ИИ (Claude)' : 'из базы знаний'}</small>` : ''}</div>`);
  msgs.scrollTop = msgs.scrollHeight;
  const ask = async (q) => {
    if (!q.trim()) return;
    add('me', q);
    const typing = document.createElement('div');
    typing.className = 'm bot typing';
    typing.innerHTML = '<i></i><i></i><i></i>';
    msgs.append(typing);
    msgs.scrollTop = msgs.scrollHeight;
    try {
      const r = await D.api('/api/mascot/ask', { method: 'POST', body: { question: q, page: location.hash } });
      typing.remove();
      add('bot', r.answer, r.source);
    } catch (e) {
      typing.remove();
      add('bot', e.message || 'Не получилось ответить. Попробуйте ещё раз.');
    }
  };
  panel.querySelector('form').onsubmit = (e) => {
    e.preventDefault();
    const inp = panel.querySelector('input');
    const q = inp.value;
    inp.value = '';
    ask(q);
  };
  panel.querySelectorAll('.quick button').forEach((b) => (b.onclick = () => ask(b.textContent)));
  panel.querySelector('.x').onclick = closeChat;
  panel.addEventListener('keydown', (e) => e.key === 'Escape' && closeChat());
  panel.querySelector('input').focus();
}
function closeChat() {
  document.querySelector('.mascot-chat')?.remove();
  mascot.open = false;
  mascot.el?.querySelector('.mascot-btn')?.focus();
}

// ===================================================================
//                              ТУТОРИАЛ
// ===================================================================
const vis = (sel) => [...document.querySelectorAll(sel)].find((el) => el.offsetParent !== null && el.getBoundingClientRect().width > 0);

export function startTour(force = false) {
  const me = D.state.me;
  if (!me) return;
  const key = `ab_tour_${me.id}`;
  if (!force && D.store.get(key)) return;
  const steps =
    me.role === 'company'
      ? [
          { t: 'Добро пожаловать!', d: 'Короткий тур по кабинету компании. Его можно пропустить и пройти позже в настройках.' },
          { s: '[href="#/company/new"]', t: 'Создайте кампанию', d: 'Описание, награда участникам и вопросы. Для видео добавьте контрольный вопрос с правильным ответом.' },
          { s: '.balance-chip', t: 'Бюджет', d: 'Бюджет резервируется при запуске, а списывается только за одобренные ответы.' },
          { s: '[href="#/company/rewards"]', t: 'Награды', d: 'Добавьте ключи своих игр и предметы — за них участники будут копить AB.' },
          { s: '[href="#/company/revenue"]', t: 'Выручка', d: 'Каждый обмен вашей награды приносит вам 90% её стоимости в AB. Выручку можно вывести в тенге или вложить в новые тесты.' },
          { s: '.mascot-btn', t: 'Аби поможет', d: 'Нажмите на маскота, чтобы задать вопрос.' },
        ]
      : [
          { t: `Добро пожаловать, ${me.name}!`, d: 'Я Аби. За минуту покажу, где что находится. Тур можно пропустить и пройти снова в настройках.' },
          { s: '.balance-chip', t: 'Ваш баланс', d: 'AB Points приходят после проверки ответа. Это внутренние баллы, не деньги: их меняют на награды.' },
          { s: '.streak-chip', t: '🔥 Серия заходов', d: 'Сколько дней подряд вы заходите. Нажмите — откроется статистика по дням.' },
          { s: '[href="#/rewards"]', t: 'Награды', d: 'Ключи игр для Steam, Epic, Google Play, предметы и подписки. У каждой — своя 3D-модель.' },
          { s: '[href="#/tasks"]', t: 'Задания', d: 'Игры, прототипы и видео. Время и награда видны до старта.' },
          { s: '[href="#/stats"]', t: 'Статистика', d: 'Сколько заработали сегодня, вчера и позавчера, лучший день и AB за час внимания.' },
          { s: '.mascot-btn', t: 'Вопросы — ко мне', d: 'Нажмите на меня в любой момент, и я отвечу.' },
        ];
  let i = 0;
  const ov = document.createElement('div');
  ov.className = 'tour';
  ov.innerHTML = `<div class="spot"></div><div class="tour-card" role="dialog" aria-modal="true" aria-labelledby="tour-t"><div class="tour-mini">${MASCOT_SVG}</div><div><p class="tiny muted tour-n"></p><h3 id="tour-t"></h3><p class="tour-d"></p><div class="tour-acts"><button class="btn btn-quiet btn-sm" data-t="skip">Пропустить</button><button class="btn btn-ghost btn-sm" data-t="prev">Назад</button><button class="btn btn-primary btn-sm" data-t="next">Далее</button></div></div></div>`;
  document.body.append(ov);
  const spot = ov.querySelector('.spot'), card = ov.querySelector('.tour-card');
  const finish = () => {
    D.store.set(key, '1');
    ov.remove();
    removeEventListener('resize', place);
  };
  function place() {
    const st = steps[i];
    const el = st.s ? vis(st.s) : null;
    ov.querySelector('.tour-n').textContent = `Шаг ${i + 1} из ${steps.length}`;
    ov.querySelector('#tour-t').textContent = st.t;
    ov.querySelector('.tour-d').textContent = st.d;
    ov.querySelector('[data-t=prev]').disabled = i === 0;
    ov.querySelector('[data-t=next]').textContent = i === steps.length - 1 ? 'Готово' : 'Далее';
    if (el) {
      el.scrollIntoView?.({ block: 'nearest' });
      const r = el.getBoundingClientRect();
      Object.assign(spot.style, { display: 'block', left: `${r.left - 8}px`, top: `${r.top - 8}px`, width: `${r.width + 16}px`, height: `${r.height + 16}px` });
      const below = r.bottom + 230 < innerHeight;
      const cw = Math.min(420, innerWidth - 24);
      Object.assign(card.style, { left: `${Math.max(12, Math.min(innerWidth - cw - 12, r.left + r.width / 2 - cw / 2))}px`, top: below ? `${r.bottom + 16}px` : 'auto', bottom: below ? 'auto' : `${innerHeight - r.top + 16}px`, transform: 'none' });
    } else {
      spot.style.display = 'none';
      Object.assign(card.style, { left: '50%', top: '50%', bottom: 'auto', transform: 'translate(-50%,-50%)' });
    }
    card.querySelector('[data-t=next]').focus();
  }
  ov.addEventListener('click', (e) => {
    const t = e.target.closest('[data-t]')?.dataset.t;
    if (t === 'skip') finish();
    if (t === 'prev') (i = Math.max(0, i - 1)), place();
    if (t === 'next') i === steps.length - 1 ? finish() : (i++, place());
  });
  ov.addEventListener('keydown', (e) => e.key === 'Escape' && finish());
  addEventListener('resize', place);
  place();
}

// ===================================================================
//                 ЭКОНОМИКА v2: публичная казна и калькулятор
// ===================================================================
const kzt = (n) => `${Math.round(n).toLocaleString('ru-RU')} ₸`;

function flowDiagram(t) {
  const f = t.flows;
  return `<div class="flow" role="img" aria-label="Схема движения баллов: компании пополняют бюджет, платят участникам за результат, участники обменивают баллы на награды продавцов, продавцы выводят выручку в тенге">
    <div class="node n-company tilt"><small>Компании</small><b>${fmt(t.deposits)} AB</b><span>пополнили бюджет · ${kzt(t.deposits * t.abToKzt)}</span></div>
    <div class="arrow"><span>за проверенный результат</span><b>${fmt(f.paidToUsers)} AB</b></div>
    <div class="node n-user tilt"><small>Участники</small><b>${fmt(t.holders.users)} AB</b><span>на балансах сейчас</span></div>
    <div class="arrow"><span>обмен на награды</span><b>${fmt(f.spentOnRewards)} AB</b></div>
    <div class="node n-seller tilt"><small>Продавцы наград</small><b>${fmt(f.sellerRevenue)} AB</b><span>выручка · ${kzt(f.sellerRevenue * t.abToKzt)}</span></div>
    <div class="arrow"><span>вывод в тенге</span><b>${fmt(t.payouts)} AB</b></div>
    <div class="node n-out tilt"><small>Выведено</small><b>${kzt(t.payouts * t.abToKzt)}</b><span>по заявкам продавцов</span></div>
    <div class="node n-platform tilt"><small>Платформа</small><b>${fmt(f.platformFees)} AB</b><span>комиссии ${t.rules.platformFeePercent}% с результата и ${t.rules.sellerFeePercent}% с продажи</span></div>
  </div>`;
}

export async function viewEconomy() {
  const t = await D.api('/api/economy');
  D.app.innerHTML = `
  <div class="page-head"><div><p class="kicker">Прозрачность</p><h1>Экономика ATTENTION BANK</h1><p>Живые цифры всей платформы. Каждый AB обеспечен деньгами, которые внесли компании.</p></div>
    <span class="treasury-check ${t.ok ? 'ok' : 'bad'}">${t.ok ? '✓ Казна сходится' : '⚠ Расхождение'}</span></div>
  <div class="kpi-row">
    <div class="kpi tilt gold"><span>AB в обороте</span><b>${fmt(t.supply)}<small>AB</small></b><em>обеспечено ${kzt(t.backedKzt)}</em></div>
    <div class="kpi tilt"><span>Курс обеспечения</span><b>1 AB<small>= ${t.abToKzt} ₸</small></b><em>для компаний и продавцов</em></div>
    <div class="kpi tilt"><span>В резерве кампаний</span><b>${fmt(t.reserved)}<small>AB</small></b><em>ждут результатов</em></div>
    <div class="kpi tilt"><span>Выплачено участникам</span><b>${fmt(t.flows.paidToUsers)}<small>AB</small></b><em>за одобренные ответы</em></div>
    <div class="kpi tilt"><span>Выручка продавцов</span><b>${fmt(t.flows.sellerRevenue)}<small>AB</small></b><em>${kzt(t.flows.sellerRevenue * t.abToKzt)}</em></div>
  </div>
  <section class="panel" style="margin-top:20px">
    <h2 style="font-size:1.15rem;margin-top:0">Как движутся баллы</h2>
    ${flowDiagram(t)}
    <p class="tiny muted" style="margin:14px 0 0">Проверка казны: Σ балансов всех счетов (${fmt(t.supply - t.reserved)}) + резервы кампаний (${fmt(t.reserved)}) = пополнения (${fmt(t.deposits)}) − выводы (${fmt(t.payouts)}) → ${fmt(t.supply)} = ${fmt(t.deposits - t.payouts)} ${t.ok ? '✓' : '✗'}</p>
  </section>
  <div class="eco-grid">
    <section class="panel">
      <h2 style="font-size:1.1rem;margin-top:0">Правила</h2>
      <ol class="rules">
        <li><b>Баллы создаются только пополнением.</b> Компания вносит деньги — получает AB по курсу 1 AB = ${t.abToKzt} ₸. Других способов «напечатать» баллы нет: даже бонусы платформа платит из своих доходов.</li>
        <li><b>Компания платит за результат.</b> Награда участнику + ${t.rules.platformFeePercent}% комиссии, только за одобренный ответ. Неиспользованный резерв возвращается.</li>
        <li><b>Баллы не сгорают при обмене.</b> Продавец награды получает ${100 - t.rules.sellerFeePercent}% стоимости, платформа — ${t.rules.sellerFeePercent}%.</li>
        <li><b>Вывод в тенге — только для продавцов</b> по договору, от ${fmt(t.rules.payoutMinAb)} AB. Для участников AB остаются баллами: их нельзя вывести, только обменять.</li>
        <li><b>Всё сверяется автоматически.</b> Баланс каждого счёта = сумма его транзакций, а вся казна = пополнения − выводы.</li>
      </ol>
    </section>
    <section class="panel calc" id="calc">
      <h2 style="font-size:1.1rem;margin-top:0">Калькулятор</h2>
      <label class="field"><span class="label">Награда участнику за задание: <b id="c-r"></b></span><input type="range" min="5" max="100" step="5" value="20" id="c-reward"></label>
      <label class="field"><span class="label">Сколько ответов нужно компании: <b id="c-n"></b></span><input type="range" min="10" max="500" step="10" value="100" id="c-count"></label>
      <label class="field"><span class="label">Цена награды в каталоге: <b id="c-p"></b></span><input type="range" min="20" max="500" step="10" value="200" id="c-price"></label>
      <div class="calc-out" id="c-out" aria-live="polite"></div>
    </section>
  </div>`;
  const $c = (id) => D.app.querySelector(id);
  const calc = () => {
    const r = Number($c('#c-reward').value), n = Number($c('#c-count').value), p = Number($c('#c-price').value);
    const fee = Math.ceil((r * t.rules.platformFeePercent) / 100);
    const budget = (r + fee) * n;
    const sFee = Math.ceil((p * t.rules.sellerFeePercent) / 100);
    const tasksForReward = Math.ceil(p / r);
    $c('#c-r').textContent = `${r} AB`;
    $c('#c-n').textContent = n;
    $c('#c-p').textContent = `${p} AB`;
    $c('#c-out').innerHTML = `
      <div><small>Компания платит</small><b>${kzt(budget * t.abToKzt)}</b><span>${fmt(budget)} AB: ${n} × (${r} + ${fee} комиссия)</span></div>
      <div><small>Участники получают</small><b>${fmt(r * n)} AB</b><span>${r} AB за ответ · на награду нужно ≈ ${tasksForReward} ${D.plural(tasksForReward, 'задание', 'задания', 'заданий')}</span></div>
      <div><small>Продавец с одной награды</small><b>${kzt((p - sFee) * t.abToKzt)}</b><span>${p - sFee} AB после комиссии ${sFee} AB</span></div>
      <div><small>Платформа</small><b>${kzt((fee * n + sFee) * t.abToKzt)}</b><span>${fee * n} AB с кампании + ${sFee} AB с продажи</span></div>`;
  };
  D.app.querySelectorAll('#calc input').forEach((i) => i.addEventListener('input', calc));
  calc();
}

// ===================================================================
//                    КАБИНЕТ ПРОДАВЦА: выручка и вывод
// ===================================================================
export async function viewRevenue() {
  const v = await D.api('/api/company/revenue');
  const me = D.state.me;
  const statusLabel = { requested: 'заявка создана', paid: 'выплачено', rejected: 'отклонено' };
  D.app.innerHTML = `
  <div class="page-head"><div><h1>Выручка с наград</h1><p>Когда участник обменивает AB на вашу награду, баллы не сгорают: вы получаете ${100 - v.rules.sellerFeePercent}% стоимости, платформа — ${v.rules.sellerFeePercent}%.</p></div>
    <div class="row"><a class="btn btn-ghost" href="#/budget">Бюджет</a><a class="btn btn-ghost" href="#/economy">Как устроена экономика</a></div></div>
  <div class="kpi-row">
    <div class="kpi tilt gold"><span>Чистая выручка</span><b>${fmt(v.net)}<small>AB</small></b><em>${kzt(v.netKzt)}</em></div>
    <div class="kpi tilt"><span>Продано наград</span><b>${fmt(v.sold)}</b><em>на ${fmt(v.gross)} AB</em></div>
    <div class="kpi tilt"><span>Комиссия платформы</span><b>${fmt(v.fee)}<small>AB</small></b><em>${v.rules.sellerFeePercent}% с продажи</em></div>
    <div class="kpi tilt"><span>Вернулось из бюджета тестов</span><b>${v.returnRate === null ? '—' : `${v.returnRate}%`}</b><em>участники купили ваши же награды</em></div>
    <div class="kpi tilt"><span>Доступно к выводу</span><b>${fmt(me.balance)}<small>AB</small></b><em>${kzt(me.balance * v.rules.abToKzt)} · выручка + свободный бюджет</em></div>
  </div>
  <section class="panel" style="margin-top:20px">
    <div class="section-head" style="margin:0 0 6px"><h2 style="font-size:1.15rem">Выручка за 14 дней</h2><span class="small muted">AB после комиссии</span></div>
    ${barChart(v.days, { id: 'rev-bars' })}
  </section>
  <div class="eco-grid">
    <section class="panel">
      <h2 style="font-size:1.1rem;margin-top:0">По наградам</h2>
      ${v.byReward.length ? `<table class="table"><thead><tr><th>Награда</th><th class="r">Продано</th><th class="r">Выручка</th><th class="r">Остаток</th></tr></thead><tbody>${v.byReward.map((r) => `<tr><td>${esc(r.title)}<div class="tiny muted">${r.cost} AB за штуку</div></td><td class="r">${r.sold}</td><td class="r"><b>${fmt(r.net)} AB</b><div class="tiny muted">${kzt(r.netKzt)}</div></td><td class="r">${r.stock}</td></tr>`).join('')}</tbody></table>` : `<p class="muted">Добавьте награды — <a href="#/company/rewards">ключи своей игры, предметы, доступ</a>.</p>`}
    </section>
    <section class="panel">
      <h2 style="font-size:1.1rem;margin-top:0">Вывод в тенге</h2>
      <p class="small muted" style="margin-top:0">Курс: 1 AB = ${v.rules.abToKzt} ₸. Минимум ${fmt(v.rules.payoutMinAb)} AB. Баллы списываются сразу, перевод — по договору.${v.rules.demo ? ' <b style="color:var(--gold-ink)">Демо-режим: заявка создаётся, но деньги не переводятся.</b>' : ''}</p>
      <form id="payout" class="row" style="align-items:flex-end">
        <label class="field" style="flex:1;min-width:160px;margin:0"><span class="label">Сумма, AB</span><input class="input" name="amount" type="number" min="${v.rules.payoutMinAb}" step="10" value="${Math.max(v.rules.payoutMinAb, Math.min(me.balance, v.net) || v.rules.payoutMinAb)}" required></label>
        <button class="btn btn-primary" type="submit" ${me.balance < v.rules.payoutMinAb ? 'disabled' : ''}>Вывести</button>
      </form>
      <p class="tiny muted" id="payout-kzt"></p>
      ${v.payouts.length ? `<table class="table" style="margin-top:10px"><thead><tr><th>Дата</th><th class="r">Сумма</th><th>Статус</th></tr></thead><tbody>${v.payouts.map((p) => `<tr><td>${new Date(p.createdAt).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</td><td class="r">${fmt(p.amount)} AB<div class="tiny muted">${kzt(p.amountKzt)}</div></td><td>${statusLabel[p.status] || p.status}<div class="tiny muted">${esc(p.note || '')}</div></td></tr>`).join('')}</tbody></table>` : '<p class="tiny muted">Заявок на вывод пока нет.</p>'}
    </section>
  </div>`;
  bindChart(D.app.querySelector('#rev-bars'), v.days, null, { count: ['продажа', 'продажи', 'продаж'], verb: 'выручки' });
  const form = D.app.querySelector('#payout');
  const upd = () => (D.app.querySelector('#payout-kzt').textContent = `≈ ${kzt((Number(form.amount.value) || 0) * v.rules.abToKzt)}`);
  form.amount.addEventListener('input', upd);
  upd();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button');
    btn.disabled = true;
    try {
      const r = await D.api('/api/company/payouts', { method: 'POST', body: { amount: Number(form.amount.value) }, idem: true });
      D.state.me.balance = r.balance;
      D.toast(`Заявка на вывод ${fmt(r.payout.amount)} AB (${kzt(r.payout.amountKzt)}) создана`);
      viewRevenue();
      D.renderChrome?.();
    } catch (err) {
      D.toast(err.message, { kind: 'err' });
      btn.disabled = false;
    }
  });
  D.enhance();
}
