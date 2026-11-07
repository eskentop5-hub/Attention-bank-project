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
      model: ['logo', 0, 3.4],
    },
    {
      k: 'Проблема',
      html: `<h2 class="deck-h2">Внимание стало валютой. Но платят за него не вам.</h2>
        <div class="deck-points">
          <div class="pt tilt"><b>Реклама</b><span>Забирает минуты каждый день — и ничего не даёт взамен.</span></div>
          <div class="pt tilt"><b>Студии</b><span>Не могут найти честных тестировщиков: опросы заполняют наугад.</span></div>
          <div class="pt tilt"><b>Люди</b><span>Хотят заранее знать, сколько времени отдают и что получат.</span></div>
        </div>`,
      model: ['coin', 0, 3.2],
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
      model: ['gamepad', 0, 3.4],
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
      k: 'Начнём',
      html: `<h2 class="deck-h1" style="font-size:clamp(2.2rem,6vw,4.6rem)">Ваше внимание<span>чего-то стоит.</span></h2>
        <p class="deck-lead">Создайте аккаунт за минуту — короткое обучение покажет, где что находится.</p>
        <div class="row">${reg}${login}</div>`,
      model: ['logo', 0, 3.4],
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
function bindChart(root, days, onPick) {
  const tip = root.querySelector('.tip');
  root.querySelectorAll('.bar').forEach((g) => {
    const d = days[Number(g.dataset.k)];
    const show = () => {
      root.querySelectorAll('.bar').forEach((x) => x.classList.toggle('dim', x !== g));
      tip.hidden = false;
      tip.innerHTML = `<b>${dayShort(d.day)}, ${weekday(d.day)}</b><span>+${d.earned} AB заработано</span>${d.spent ? `<span>−${d.spent} AB на награды</span>` : ''}<span>${d.tasks} ${D.plural(d.tasks, 'задание', 'задания', 'заданий')}</span>`;
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
const MASCOT_SVG = `<svg viewBox="0 0 80 96" aria-hidden="true">
  <ellipse cx="40" cy="92" rx="20" ry="3.5" fill="rgba(0,0,0,.35)"/>
  <g class="legs"><path class="leg l" d="M31 70 L28 88" stroke="#0B5F7A" stroke-width="5" stroke-linecap="round"/><path class="leg r" d="M49 70 L52 88" stroke="#0B5F7A" stroke-width="5" stroke-linecap="round"/></g>
  <g class="body">
    <line x1="40" y1="14" x2="40" y2="5" stroke="#74D9EE" stroke-width="3" stroke-linecap="round"/><circle class="bulb" cx="40" cy="5" r="4.5" fill="#19B3D4"/>
    <circle cx="40" cy="44" r="30" fill="url(#abg)"/><circle cx="40" cy="44" r="30" fill="none" stroke="#FFE08A" stroke-width="3"/>
    <circle cx="40" cy="44" r="24" fill="none" stroke="#B88600" stroke-width="1.5" opacity=".55"/>
    <g class="eyes"><ellipse cx="30" cy="40" rx="6" ry="7.5" fill="#fff"/><ellipse cx="50" cy="40" rx="6" ry="7.5" fill="#fff"/><circle class="pupil" cx="31" cy="41" r="3.3" fill="#0C1118"/><circle class="pupil" cx="51" cy="41" r="3.3" fill="#0C1118"/></g>
    <path d="M32 54 Q40 61 48 54" stroke="#6B4426" stroke-width="3" fill="none" stroke-linecap="round"/>
    <circle cx="22" cy="51" r="3.5" fill="#FF8A5C" opacity=".55"/><circle cx="58" cy="51" r="3.5" fill="#FF8A5C" opacity=".55"/>
    <path class="arm l" d="M11 46 Q4 40 6 32" stroke="#0B5F7A" stroke-width="4.5" fill="none" stroke-linecap="round"/><path class="arm r" d="M69 46 Q76 52 74 60" stroke="#0B5F7A" stroke-width="4.5" fill="none" stroke-linecap="round"/>
  </g>
  <defs><radialGradient id="abg" cx="35%" cy="30%" r="75%"><stop offset="0" stop-color="#FFE38A"/><stop offset=".55" stop-color="#F2B705"/><stop offset="1" stop-color="#B88600"/></radialGradient></defs>
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
