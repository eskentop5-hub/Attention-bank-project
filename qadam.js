// Qadam — прототип онбординга приложения подготовки к ЕНТ.
// Всё работает локально: регистрация, выбор предметов, цель, первый урок с проверкой ответов.

const $ = (id) => document.getElementById(id);
const screen = $('screen');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const PAIRS = [
  'Математика + Физика',
  'Математика + Информатика',
  'Математика + География',
  'Биология + Химия',
  'Биология + География',
  'Всемирная история + Основы права',
  'Иностранный язык + Всемирная история',
];
const GOALS = [[5, 'Лёгкий'], [10, 'Обычный'], [15, 'Серьёзный'], [20, 'Интенсив']];

// Первый урок: обязательные предметы ЕНТ
const LESSON = [
  { tag: 'Математическая грамотность', q: 'Рюкзак стоил 2 000 ₸, на него дали скидку 15%. Сколько он стоит теперь?', a: ['1 700 ₸', '1 850 ₸', '1 500 ₸', '1 985 ₸'], ok: 0, why: '15% от 2 000 — это 300 ₸. 2 000 − 300 = 1 700 ₸.' },
  { tag: 'История Казахстана', q: 'В каком году была провозглашена независимость Республики Казахстан?', a: ['1990', '1991', '1993', '1995'], ok: 1, why: 'Закон «О государственной независимости» принят 16 декабря 1991 года — этот день отмечается как День Независимости.' },
  { tag: 'Математическая грамотность', q: '3 тетради стоят 450 ₸. Сколько стоят 7 таких тетрадей?', a: ['900 ₸', '1 050 ₸', '1 150 ₸', '1 350 ₸'], ok: 1, why: 'Одна тетрадь стоит 450 : 3 = 150 ₸, значит 7 тетрадей — 150 × 7 = 1 050 ₸.' },
  { tag: 'Грамотность чтения', passage: 'Айдана решала по 10 заданий в день. Через месяц она заметила, что ошибается вдвое реже, хотя тратит на подготовку всего двадцать минут. «Важно не сколько, а как регулярно», — сказала она подруге.', q: 'Какой вывод делает Айдана?', a: ['Нужно решать больше заданий', 'Регулярность важнее объёма', 'Двадцати минут недостаточно', 'Подготовка не помогает'], ok: 1, why: 'Ключевая фраза: «Важно не сколько, а как регулярно» — регулярность важнее объёма.' },
  { tag: 'История Казахстана', q: 'В каком году столицу Казахстана перенесли из Алматы в Акмолу (ныне Астана)?', a: ['1991', '1994', '1997', '2001'], ok: 2, why: 'Столица официально перенесена в Акмолу 10 декабря 1997 года; в 1998 году город переименовали в Астану.' },
];

const S = { name: '', grade: '', city: '', pair: '', goal: 0, i: 0, picked: null, correct: 0, mistakes: [], screen: '', enter: 0, times: {}, backs: 0, errors: 0 };
const TITLES = { welcome: 'Приветствие', register: 'Регистрация', subjects: 'Выбор предметов', goal: 'Цель на день', lesson: 'Урок', result: 'Итог' };

function go(name, render) {
  const now = performance.now();
  if (S.screen) S.times[S.screen] = (S.times[S.screen] || 0) + (now - S.enter);
  S.screen = name;
  S.enter = now;
  screen.innerHTML = render();
  screen.scrollTop = 0;
  bind[name]?.();
  report();
}

const steps = (n) => `<div class="steps" aria-label="Шаг ${n} из 3">${[1, 2, 3].map((k) => `<i class="${k <= n ? 'on' : ''}"></i>`).join('')}</div>`;
const top = (n, back) => `<div class="top"><button class="back" data-back="${back}" aria-label="Назад">‹</button><div style="flex:1">${steps(n)}</div></div>`;

const views = {
  welcome: () => `
    <div class="brand"><i>Q</i> Qadam</div>
    <div class="hero" aria-hidden="true"><span style="left:18px;width:40px"></span><span style="left:66px;width:70px;bottom:44px"></span><span style="left:144px;width:60px;bottom:72px"></span><span style="left:212px;width:90px;bottom:104px"></span></div>
    <h1>К ЕНТ — по шагу в день</h1>
    <p class="lead">10–15 минут ежедневно: короткие уроки по обязательным и профильным предметам с объяснением каждой ошибки.</p>
    <div class="spacer"></div>
    <button class="btn" id="next">Начать</button>
    <button class="btn alt" id="have">У меня уже есть аккаунт</button>`,
  register: () => `
    ${top(1, 'welcome')}
    <h2>Давай знакомиться</h2>
    <p class="lead">Это нужно, чтобы подобрать задания под твой класс.</p>
    <label class="f">Имя<input class="in" id="name" autocomplete="given-name" value="${esc(S.name)}" maxlength="30"></label>
    <div class="err" id="e-name"></div>
    <div class="f" style="font-size:14px;font-weight:600;color:#3C4842">Класс</div>
    <div class="seg" role="group" aria-label="Класс">${['10 класс', '11 класс', 'Выпускник'].map((g) => `<button class="opt" data-grade="${g}" aria-pressed="${S.grade === g}">${g}</button>`).join('')}</div>
    <div class="err" id="e-grade" style="margin-top:6px"></div>
    <label class="f">Город<select class="in" id="city">${['', 'Шымкент', 'Алматы', 'Астана', 'Караганда', 'Актобе', 'Другой'].map((c) => `<option value="${c}" ${S.city === c ? 'selected' : ''}>${c || 'Выберите город'}</option>`).join('')}</select></label>
    <div class="spacer"></div>
    <button class="btn" id="next">Далее</button>`,
  subjects: () => `
    ${top(2, 'register')}
    <h2>Предметы ЕНТ</h2>
    <p class="lead">Обязательные предметы уже включены. Выбери пару профильных.</p>
    <div class="fixed"><span>✓ История Казахстана</span><span>✓ Мат. грамотность</span><span>✓ Грамотность чтения</span></div>
    <div class="list" role="radiogroup" aria-label="Профильные предметы">${PAIRS.map((p) => `<button class="opt ${S.pair === p ? 'sel' : ''}" role="radio" aria-checked="${S.pair === p}" data-pair="${p}">${p}</button>`).join('')}</div>
    <div class="spacer"></div>
    <button class="btn" id="next" ${S.pair ? '' : 'disabled'}>Далее</button>`,
  goal: () => `
    ${top(3, 'subjects')}
    <h2>Сколько времени в день?</h2>
    <p class="lead">Цель можно поменять в любой момент в профиле.</p>
    <div class="list">${GOALS.map(([m, n]) => `<button class="opt ${S.goal === m ? 'sel' : ''}" data-goal="${m}"><b>${m} мин</b> · ${n}</button>`).join('')}</div>
    <div class="spacer"></div>
    <button class="btn" id="next" ${S.goal ? '' : 'disabled'}>Начать первый урок</button>`,
  lesson: () => {
    const L = LESSON[S.i], answered = S.picked !== null;
    return `
    <div class="top"><button class="back" data-back="quit" aria-label="Выйти из урока">✕</button><div style="flex:1"><div class="steps">${LESSON.map((_, k) => `<i class="${k < S.i + (answered ? 1 : 0) ? 'on' : ''}"></i>`).join('')}</div></div><span class="muted">${S.i + 1}/${LESSON.length}</span></div>
    <span class="tag">${L.tag}</span>
    ${L.passage ? `<div class="passage" style="margin-top:10px">${L.passage}</div>` : ''}
    <div class="q">${L.q}</div>
    <div class="list">${L.a.map((a, k) => {
      const cls = answered ? (k === L.ok ? 'ok' : k === S.picked ? 'bad' : '') : '';
      return `<button class="opt ${cls}" data-a="${k}" ${answered ? 'disabled' : ''}>${a}</button>`;
    }).join('')}</div>
    ${answered ? `<div class="fb ${S.picked === L.ok ? 'ok' : 'bad'}"><b>${S.picked === L.ok ? 'Верно!' : 'Не совсем.'}</b> ${L.why}</div>` : ''}
    <div class="spacer"></div>
    ${answered ? `<button class="btn" id="next">${S.i < LESSON.length - 1 ? 'Дальше' : 'Завершить урок'}</button>` : ''}`;
  },
  result: () => `
    <div class="brand"><i>Q</i> Qadam</div>
    <div class="big">${S.correct}/${LESSON.length}</div>
    <h2 style="margin-top:8px">${S.correct >= 4 ? 'Отличный старт' : S.correct >= 2 ? 'Хорошее начало' : 'Первый шаг сделан'}, ${esc(S.name)}!</h2>
    <p class="lead">Первый шаг из 30 пройден. Ошибки попадут в повторение завтра.</p>
    <div class="streak"><b>🔥 1</b><div><b style="font-size:15px">день подряд</b><div class="muted">Цель: ${S.goal} мин в день · ${esc(S.pair)}</div></div></div>
    ${S.mistakes.length ? `<p class="muted">Повторим: ${S.mistakes.map((m) => esc(m)).join(', ')}.</p>` : ''}
    <div class="spacer"></div>
    <button class="btn" id="again">Пройти урок ещё раз</button>`,
};

const bind = {
  welcome() {
    $('next').onclick = () => go('register', views.register);
    $('have').onclick = () => alertInline('Вход появится в следующей версии. Для теста пройдите регистрацию.');
  },
  register() {
    screen.querySelectorAll('[data-grade]').forEach((b) => (b.onclick = () => {
      S.grade = b.dataset.grade;
      screen.querySelectorAll('[data-grade]').forEach((x) => x.setAttribute('aria-pressed', x === b));
      $('e-grade').textContent = '';
    }));
    $('next').onclick = () => {
      S.name = $('name').value.trim();
      S.city = $('city').value;
      let bad = false;
      $('e-name').textContent = S.name.length < 2 ? (bad = true, 'Введите имя (минимум 2 буквы)') : '';
      $('e-grade').textContent = !S.grade ? (bad = true, 'Выберите класс') : '';
      if (bad) return S.errors++, report();
      go('subjects', views.subjects);
    };
  },
  subjects() {
    screen.querySelectorAll('[data-pair]').forEach((b) => (b.onclick = () => {
      S.pair = b.dataset.pair;
      screen.querySelectorAll('[data-pair]').forEach((x) => {
        x.classList.toggle('sel', x === b);
        x.setAttribute('aria-checked', x === b);
      });
      $('next').disabled = false;
    }));
    $('next').onclick = () => go('goal', views.goal);
  },
  goal() {
    screen.querySelectorAll('[data-goal]').forEach((b) => (b.onclick = () => {
      S.goal = Number(b.dataset.goal);
      screen.querySelectorAll('[data-goal]').forEach((x) => x.classList.toggle('sel', x === b));
      $('next').disabled = false;
    }));
    $('next').onclick = () => {
      Object.assign(S, { i: 0, picked: null, correct: 0, mistakes: [] });
      go('lesson', views.lesson);
    };
  },
  lesson() {
    screen.querySelectorAll('[data-a]').forEach((b) => (b.onclick = () => {
      S.picked = Number(b.dataset.a);
      const L = LESSON[S.i];
      if (S.picked === L.ok) S.correct++;
      else S.mistakes.push(L.tag);
      rerender();
    }));
    const n = $('next');
    if (n) n.onclick = () => {
      if (S.i < LESSON.length - 1) {
        S.i++;
        S.picked = null;
        rerender();
      } else go('result', views.result);
    };
  },
  result() {
    $('again').onclick = () => {
      Object.assign(S, { i: 0, picked: null, correct: 0, mistakes: [] });
      go('lesson', views.lesson);
    };
  },
};

function rerender() {
  screen.innerHTML = views[S.screen]();
  bind[S.screen]();
  report();
}

screen.addEventListener('click', (e) => {
  const b = e.target.closest('[data-back]');
  if (!b) return;
  S.backs++;
  const to = b.dataset.back;
  if (to === 'quit') {
    if (confirmInline()) go('goal', views.goal);
    return;
  }
  if (to === 'register' || to === 'subjects') {
    // сохраняем введённое перед возвратом
    if ($('name')) S.name = $('name').value.trim();
  }
  go(to, views[to]);
});

function alertInline(msg) {
  let n = screen.querySelector('.fb.inline');
  if (!n) {
    n = document.createElement('div');
    n.className = 'fb bad inline';
    screen.querySelector('.spacer').before(n);
  }
  n.textContent = msg;
}
function confirmInline() {
  const n = screen.querySelector('.fb.inline');
  if (n) return true;
  alertInline('Выйти из урока? Прогресс урока потеряется. Нажмите ✕ ещё раз, чтобы выйти.');
  return false;
}

const sec = (ms) => `${Math.round(ms / 1000)} с`;
function report() {
  const now = performance.now();
  const times = { ...S.times };
  if (S.screen) times[S.screen] = (times[S.screen] || 0) + (now - S.enter);
  const lines = [
    `Qadam 0.4 (прототип) — экран: ${TITLES[S.screen] || '—'}`,
    `Время по экранам: ${Object.entries(times).map(([k, v]) => `${TITLES[k]} ${sec(v)}`).join(', ') || '—'}`,
    `Ошибки ввода в регистрации: ${S.errors} · возвратов назад: ${S.backs}`,
  ];
  if (S.screen === 'result' || S.screen === 'lesson') lines.push(`Урок: ${S.correct} верных из ${LESSON.length}${S.mistakes.length ? ` (ошибки: ${S.mistakes.join(', ')})` : ''}`);
  const r = $('report');
  if (r.value !== lines.join('\n')) r.value = lines.join('\n');
}
setInterval(report, 1000);

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
$('restart').onclick = (e) => {
  e.preventDefault();
  Object.assign(S, { name: '', grade: '', city: '', pair: '', goal: 0, i: 0, picked: null, correct: 0, mistakes: [], screen: '', times: {}, backs: 0, errors: 0 });
  go('welcome', views.welcome);
};
const tickClock = () => ($('clock').textContent = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }));
tickClock();
setInterval(tickClock, 20000);

go('welcome', views.welcome);
