// A/B-прототип меню инвентаря. A — сетка иконок без подписей (имя во всплывающей подсказке),
// B — список с подписями, категориями и поиском. Замер: время до выбора «Зелья лечения» и промахи.

const $ = (id) => document.getElementById(id);
const TARGET = 'Зелье лечения';

// ---------- Иконки (SVG) ----------
const potion = (c) => `<svg viewBox="0 0 40 40"><path d="M16 5h8v7c5 2 9 7 9 13 0 7-6 12-13 12S7 32 7 25c0-6 4-11 9-13z" fill="${c}" opacity=".9"/><path d="M16 5h8v3h-8z" fill="#8B6A43"/><path d="M10 25c0-1 .5-3 1.5-4" stroke="#fff" stroke-width="2" fill="none" opacity=".6" stroke-linecap="round"/><path d="M8.5 27c3 2 20 2 23 0-.5 5-5 9-11.5 9S9 32 8.5 27z" fill="#000" opacity=".2"/></svg>`;
const ICON = {
  sword: (c) => `<svg viewBox="0 0 40 40"><path d="M30 4l6 0 0 6-17 17-6-6z" fill="${c}"/><path d="M11 21l8 8-3 3-8-8z" fill="#8B6A43"/><path d="M6 30l4 4-3 3-4-4z" fill="#D9A441"/></svg>`,
  axe: (c) => `<svg viewBox="0 0 40 40"><path d="M8 36L28 10" stroke="#8B6A43" stroke-width="4" stroke-linecap="round"/><path d="M22 6c8 0 13 5 13 12-5-1-9-3-11-7z" fill="${c}"/></svg>`,
  bow: (c) => `<svg viewBox="0 0 40 40"><path d="M10 4c18 6 18 26 0 32" stroke="${c}" stroke-width="4" fill="none"/><path d="M10 4v32" stroke="#EDE3D1" stroke-width="1.2"/></svg>`,
  shield: (c) => `<svg viewBox="0 0 40 40"><path d="M20 4l14 5v9c0 9-6 15-14 18C12 33 6 27 6 18V9z" fill="${c}"/><path d="M20 9v23" stroke="#D9A441" stroke-width="3"/></svg>`,
  helm: (c) => `<svg viewBox="0 0 40 40"><path d="M6 26c0-11 6-19 14-19s14 8 14 19v6H6z" fill="${c}"/><path d="M12 22h16v4H12z" fill="#15110D"/></svg>`,
  boots: (c) => `<svg viewBox="0 0 40 40"><path d="M10 6h10v18l12 4v8H10z" fill="${c}"/></svg>`,
  ring: (c) => `<svg viewBox="0 0 40 40"><circle cx="20" cy="24" r="10" stroke="#D9A441" stroke-width="4" fill="none"/><path d="M15 12l5-7 5 7-5 4z" fill="${c}"/></svg>`,
  gem: (c) => `<svg viewBox="0 0 40 40"><path d="M8 15l6-8h12l6 8-12 19z" fill="${c}"/><path d="M8 15h24M14 7l6 27M26 7l-6 27" stroke="#fff" stroke-width="1" opacity=".35"/></svg>`,
  ore: (c) => `<svg viewBox="0 0 40 40"><path d="M6 28l6-14 10-5 10 8 2 13-12 4z" fill="#5E554B"/><circle cx="16" cy="20" r="3" fill="${c}"/><circle cx="25" cy="25" r="2.5" fill="${c}"/><circle cx="21" cy="15" r="2" fill="${c}"/></svg>`,
  scroll: (c) => `<svg viewBox="0 0 40 40"><rect x="9" y="8" width="22" height="24" rx="3" fill="#E9D8B0"/><path d="M13 14h14M13 19h14M13 24h9" stroke="${c}" stroke-width="2"/></svg>`,
  key: (c) => `<svg viewBox="0 0 40 40"><circle cx="13" cy="14" r="7" stroke="${c}" stroke-width="4" fill="none"/><path d="M18 19l14 14M27 28l4-4M30 31l3-3" stroke="${c}" stroke-width="4" stroke-linecap="round"/></svg>`,
  bread: () => `<svg viewBox="0 0 40 40"><ellipse cx="20" cy="22" rx="15" ry="10" fill="#C98A43"/><path d="M12 18l3 6M19 16l3 7M26 17l3 6" stroke="#8B5A23" stroke-width="2"/></svg>`,
  herb: (c) => `<svg viewBox="0 0 40 40"><path d="M20 36V14" stroke="#4E7A34" stroke-width="3"/><path d="M20 20c-8-1-11-7-10-12 6 0 10 5 10 12zM20 16c6-2 10-8 9-12-6 1-9 6-9 12z" fill="${c}"/></svg>`,
  arrow: (c) => `<svg viewBox="0 0 40 40"><path d="M6 34L30 10" stroke="#8B6A43" stroke-width="3"/><path d="M26 6l8 0 0 8z" fill="${c}"/><path d="M6 34l2-7M6 34l7-2" stroke="#EDE3D1" stroke-width="2"/></svg>`,
};

// Предметы: [имя, категория, иконка, цвет, количество, описание]
const ITEMS = [
  ['Зелье лечения', 'Зелья', 'potion', '#D8322E', 3, 'Восстанавливает 50 здоровья'],
  ['Зелье ярости', 'Зелья', 'potion', '#A3222A', 1, '+20% урона на 30 с'],
  ['Зелье силы', 'Зелья', 'potion', '#E0582A', 2, '+5 к силе на 60 с'],
  ['Зелье маны', 'Зелья', 'potion', '#2F6BD8', 4, 'Восстанавливает 40 маны'],
  ['Зелье скорости', 'Зелья', 'potion', '#3FB4D8', 1, 'Быстрее на 15%'],
  ['Противоядие', 'Зелья', 'potion', '#4FAE4A', 2, 'Снимает отравление'],
  ['Зелье регенерации', 'Зелья', 'potion', '#E0457A', 1, 'Лечит 5 здоровья в секунду'],
  ['Эликсир невидимости', 'Зелья', 'potion', '#9C8FB8', 1, 'Невидимость на 10 с'],
  ['Стальной меч', 'Оружие', 'sword', '#C9D1D8', 1, 'Урон 12–16'],
  ['Меч степного батыра', 'Оружие', 'sword', '#E8C27A', 1, 'Урон 18–22'],
  ['Боевой топор', 'Оружие', 'axe', '#AEB6BE', 1, 'Урон 20–28, медленный'],
  ['Охотничий лук', 'Оружие', 'bow', '#A2703F', 1, 'Дальность 30 м'],
  ['Стрелы', 'Оружие', 'arrow', '#C9D1D8', 42, 'Обычные стрелы'],
  ['Огненные стрелы', 'Оружие', 'arrow', '#E0582A', 8, 'Поджигают цель'],
  ['Деревянный щит', 'Броня', 'shield', '#8B6A43', 1, 'Защита 6'],
  ['Щит стража', 'Броня', 'shield', '#5C6E86', 1, 'Защита 11'],
  ['Кожаный шлем', 'Броня', 'helm', '#8B6A43', 1, 'Защита 3'],
  ['Шлем батыра', 'Броня', 'helm', '#B8C0C8', 1, 'Защита 7'],
  ['Сапоги странника', 'Броня', 'boots', '#6E5236', 1, '+5% скорости'],
  ['Кольцо стойкости', 'Броня', 'ring', '#D8322E', 1, '+10 к здоровью'],
  ['Кольцо мудрости', 'Броня', 'ring', '#2F6BD8', 1, '+10 к мане'],
  ['Рубин', 'Ресурсы', 'gem', '#D8322E', 2, 'Драгоценный камень'],
  ['Сапфир', 'Ресурсы', 'gem', '#2F6BD8', 1, 'Драгоценный камень'],
  ['Изумруд', 'Ресурсы', 'gem', '#3CB070', 3, 'Драгоценный камень'],
  ['Железная руда', 'Ресурсы', 'ore', '#B8C0C8', 12, 'Для кузницы'],
  ['Медная руда', 'Ресурсы', 'ore', '#D0844A', 7, 'Для кузницы'],
  ['Золотая руда', 'Ресурсы', 'ore', '#E8C27A', 2, 'Для кузницы'],
  ['Целебная трава', 'Ресурсы', 'herb', '#6CBF4A', 9, 'Ингредиент для зелий'],
  ['Красный мак', 'Ресурсы', 'herb', '#D8322E', 5, 'Ингредиент для зелий'],
  ['Лепёшка', 'Еда', 'bread', '', 6, '+15 здоровья за 10 с'],
  ['Свиток портала', 'Квестовые', 'scroll', '#2F6BD8', 2, 'Возврат в лагерь'],
  ['Свиток огня', 'Квестовые', 'scroll', '#D8322E', 1, 'Заклинание огненного шара'],
  ['Ключ от кургана', 'Квестовые', 'key', '#E8C27A', 1, 'Открывает древний курган'],
  ['Ржавый ключ', 'Квестовые', 'key', '#8B6A43', 1, 'Неизвестно, что открывает'],
].map(([name, cat, icon, color, n, desc], id) => ({ id, name, cat, icon, color, n, desc }));
const iconOf = (it) => (it.icon === 'potion' ? potion(it.color) : ICON[it.icon](it.color));
const CATS = ['Все', 'Зелья', 'Оружие', 'Броня', 'Ресурсы', 'Еда', 'Квестовые'];

// Порядок для варианта A перемешивается один раз на сессию — предмет не всегда в одном месте
function shuffled(seed) {
  const a = [...ITEMS];
  let s = seed;
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 1664525 + 1013904223) >>> 0;
    const j = s % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const store = {
  get() {
    try {
      return JSON.parse(sessionStorage.getItem('ab-inv') || 'null');
    } catch {
      return null;
    }
  },
  set(v) {
    try {
      sessionStorage.setItem('ab-inv', JSON.stringify(v));
    } catch {}
  },
};
const S = store.get() || { seed: (Math.random() * 1e9) >>> 0, res: {}, order: [] };
let variant = S.res.A && !S.res.B ? 'B' : 'A', run = null, cat = 'Все', query = '';

const inv = $('inv'), tip = $('tip');

function render() {
  for (const v of ['A', 'B']) $('tab' + v).setAttribute('aria-selected', v === variant);
  $('doneA').textContent = S.res.A ? `готово · ${fmt(S.res.A.ms)}` : 'сетка иконок';
  $('doneB').textContent = S.res.B ? `готово · ${fmt(S.res.B.ms)}` : 'категории и поиск';
  const body = variant === 'A' ? renderA() : renderB();
  const cover = !run
    ? `<div class="cover"><div><h2>Вариант ${variant}</h2><p>${variant === 'A' ? 'Все предметы — иконками в одной сетке. Название видно при наведении (на телефоне — при касании).' : 'Предметы с подписями, разбиты по категориям, есть поиск.'}<br><br>Найдите и выберите <b>«${TARGET}»</b>.${S.res[variant] ? '<br><br>Этот вариант уже пройден — можно пройти ещё раз, результат обновится.' : ''}</p><button class="go" id="go">Начать замер</button></div></div>`
    : '';
  inv.innerHTML = `<div class="inv-head"><strong>Инвентарь</strong>${run ? `<span class="timer" id="timer">0.0 с</span>` : ''}<span class="weight">${ITEMS.length} предметов · вес 48/60</span></div>${body}<div class="detail" id="detail" aria-live="polite"></div>${cover}`;
  $('go')?.addEventListener('click', start);
  bindItems();
  report();
}

function renderA() {
  const order = shuffled(S.seed);
  return `<div class="gridA">${order.map((it) => `<button class="slot" data-id="${it.id}" aria-label="${it.name}">${iconOf(it)}${it.n > 1 ? `<span class="n">${it.n}</span>` : ''}</button>`).join('')}</div>`;
}
function renderB() {
  return `<div class="inv-head" style="margin-bottom:0"><div class="cats">${CATS.map((c) => `<button data-cat="${c}" aria-pressed="${c === cat}">${c}</button>`).join('')}</div></div>
    <div class="inv-head" style="margin:10px 0 0"><input class="search" id="q" placeholder="Поиск по названию…" value="${query.replace(/"/g, '&quot;')}" aria-label="Поиск"></div>
    <div class="gridB" id="listB">${listB()}</div>`;
}
function listB() {
  const q = query.trim().toLowerCase();
  const items = ITEMS.filter((it) => (cat === 'Все' || it.cat === cat) && (!q || it.name.toLowerCase().includes(q)));
  return items.length ? items.map((it) => `<button class="row" data-id="${it.id}">${iconOf(it)}<span><b>${it.name}${it.n > 1 ? ` ×${it.n}` : ''}</b><small>${it.cat}</small></span></button>`).join('') : '<div class="empty">Ничего не найдено</div>';
}

function bindItems() {
  inv.querySelectorAll('[data-cat]').forEach((b) => (b.onclick = () => {
    cat = b.dataset.cat;
    inv.querySelectorAll('[data-cat]').forEach((x) => x.setAttribute('aria-pressed', x === b));
    $('listB').innerHTML = listB();
    bindRows();
  }));
  const q = $('q');
  if (q) q.oninput = () => {
    query = q.value;
    $('listB').innerHTML = listB();
    bindRows();
  };
  bindRows();
}
function bindRows() {
  inv.querySelectorAll('[data-id]').forEach((b) => {
    b.onclick = () => pick(Number(b.dataset.id), b);
    if (variant === 'A') {
      b.onmouseenter = (e) => showTip(b, e);
      b.onmousemove = (e) => showTip(b, e);
      b.onmouseleave = () => (tip.style.display = 'none');
      b.onfocus = () => {
        const r = b.getBoundingClientRect();
        showTip(b, { clientX: r.left + r.width / 2, clientY: r.top });
      };
      b.onblur = () => (tip.style.display = 'none');
    }
  });
}
function showTip(b, e) {
  const it = ITEMS[Number(b.dataset.id)];
  tip.textContent = it.name;
  tip.style.display = 'block';
  tip.style.left = `${Math.min(innerWidth - tip.offsetWidth - 8, e.clientX + 12)}px`;
  tip.style.top = `${e.clientY - 34}px`;
}

function start() {
  run = { t0: performance.now(), miss: 0, misses: [] };
  render();
  const tick = () => {
    if (!run) return;
    const el = $('timer');
    if (el) el.textContent = fmt(performance.now() - run.t0);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function pick(id, el) {
  const it = ITEMS[id];
  $('detail').innerHTML = `<b>${it.name}</b> — ${it.desc}`;
  if (variant === 'A' && matchMedia('(hover: none)').matches) showTip(el, { clientX: el.getBoundingClientRect().left, clientY: el.getBoundingClientRect().top });
  if (!run) return;
  if (it.name !== TARGET) {
    run.miss++;
    run.misses.push(it.name);
    el.classList.remove('wrong');
    void el.offsetWidth;
    el.classList.add('wrong');
    return;
  }
  el.classList.add('right');
  S.res[variant] = { ms: Math.round(performance.now() - run.t0), miss: run.miss, misses: run.misses.slice(0, 5) };
  store.set(S);
  run = null;
  $('detail').innerHTML = `<b>Найдено за ${fmt(S.res[variant].ms)}</b>${S.res[variant].miss ? ` · промахов: ${S.res[variant].miss}` : ' без промахов'}. ${!S.res.A || !S.res.B ? 'Переходим к другому варианту…' : 'Оба варианта пройдены — сравните результаты справа.'}`;
  report();
  if (!S.res.A || !S.res.B) setTimeout(() => {
    variant = S.res.A ? 'B' : 'A';
    render();
  }, 1600);
  else setTimeout(render, 2200);
}

const fmt = (ms) => `${(ms / 1000).toFixed(1)} с`;
function report() {
  for (const v of ['A', 'B']) {
    $(`r${v}-t`).textContent = S.res[v] ? fmt(S.res[v].ms) : '—';
    $(`r${v}-m`).textContent = S.res[v] ? S.res[v].miss : '—';
  }
  const line = (v) => (S.res[v] ? `Вариант ${v}: ${fmt(S.res[v].ms)}, промахов ${S.res[v].miss}${S.res[v].misses.length ? ` (${S.res[v].misses.join(', ')})` : ''}` : `Вариант ${v}: не пройден`);
  let verdict = '';
  if (S.res.A && S.res.B) {
    const d = S.res.A.ms - S.res.B.ms;
    verdict = Math.abs(d) < 500 ? 'По времени варианты почти одинаковы.' : `Быстрее вариант ${d > 0 ? 'B' : 'A'} на ${fmt(Math.abs(d))}.`;
  }
  $('report').value = [`Прототип инвентаря — поиск «${TARGET}»`, line('A'), line('B'), verdict].filter(Boolean).join('\n');
}

document.querySelectorAll('[data-v]').forEach((b) => (b.onclick = () => {
  variant = b.dataset.v;
  run = null;
  render();
}));
$('copy').onclick = async () => {
  try {
    await navigator.clipboard.writeText($('report').value);
    $('copy').textContent = 'Скопировано ✓';
  } catch {
    $('report').select();
    $('copy').textContent = 'Выделено — Ctrl+C';
  }
  setTimeout(() => ($('copy').textContent = 'Скопировать'), 2000);
};
$('reset').onclick = (e) => {
  e.preventDefault();
  S.res = {};
  S.seed = (Math.random() * 1e9) >>> 0;
  store.set(S);
  variant = 'A';
  run = null;
  cat = 'Все';
  query = '';
  render();
};
render();
