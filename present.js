// ЖИВАЯ ПРЕЗЕНТАЦИЯ v13: слайды — это настоящие страницы приложения в демо-песочнице.
// Внизу — плакатная «табличка ведущего»: номер слайда, заголовок, тезис, ◀ ▶, автопоказ, полный экран.
// Страница под ней полностью рабочая: можно нажимать, вращать 3D, проходить задание прямо во время показа.
// Клавиши: → / Пробел / PageDown — дальше, ← / PageUp — назад, F — полный экран, A — автопоказ, Esc — выйти.
let D = null;
export function setupPresent(deps) {
  D = deps;
  addEventListener('hashchange', checkStart);
  setTimeout(checkStart, 0);
}
const esc = (s) => D.esc(s);
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const KEY = 'ab_present_slide';
const AUTO_MS = 14000;

// Слайды: as — кем смотреть (user | company), go — куда перейти (строка или функция, которая найдёт id),
// spot — что подсветить, abi — что попросить у Аби (покажет выполнение команды вживую)
const SLIDES = [
  { cover: true, k: 'ATTENTION BANK', title: 'Честные плейтесты для инди-студий', text: 'Это не слайды, а работающий продукт. Каждая следующая страница — живое приложение на демо-данных: можно нажимать всё.' },
  { as: 'user', go: '#/home', k: 'Участник', title: 'Главная: цель и пульс', text: 'Человек сам выбирает цель — награду — и видит, какие задания быстрее к ней приведут. Заработок по дням, серия заходов, уровень.', spot: '.goal' },
  { as: 'user', go: '#/tasks', k: 'Участник', title: 'Задания: всё честно заранее', text: 'Время, награда и условия проверки видны до старта. Сложные тесты открываются только опытным тестировщикам — замок по уровню.', spot: '.tickets' },
  { as: 'user', go: async () => `#/tasks/${(await firstTask()) || ''}`, k: 'Участник', title: 'Задание: продукт прямо внутри', text: 'Игры, прототипы и видео работают в браузере. Автопроверка смотрит время, детали продукта, вставленный и шаблонный текст.', spot: '.task-layout' },
  { as: 'user', go: '#/rewards', k: 'Участник', title: 'Награды в 3D', text: 'Ключи игр, предметы, подписки от самих студий. Обмен — одна атомарная транзакция, код сразу на экране.', spot: '.reward-card' },
  { as: 'user', go: '#/stats', k: 'Участник', title: 'Статистика', text: 'Сколько заработал вчера и за неделю, лучший день, процент одобрения, ценность часа внимания.' },
  { as: 'user', go: '#/home', k: 'ИИ-ассистент', title: 'Аби выполняет команды', text: 'Говоришь или пишешь — Аби ищет задания, подбирает награды, ставит цель, открывает разделы. Обмен баллов подтверждает только человек.', abi: 'Найди задания до 10 минут' },
  { as: 'company', go: '#/company', k: 'Студия', title: 'Кабинет студии', text: 'Студия платит только за одобренные результаты. Бюджет резервируется, неиспользованное возвращается.', spot: '.kpis' },
  { as: 'company', go: async () => { const id = await firstCampaign(); return id ? `#/company/campaigns/${id}/report` : '#/company'; }, k: 'Студия', title: 'Отчёт для студии', text: 'Воронка, цена результата в тенге, оценки, цитаты и сигналы проверки. Без имён и email. Печать в PDF.' },
  { as: 'company', go: '#/company', k: 'ИИ-ассистент', title: 'Плейтест за одну фразу', text: 'Аби собирает черновик кампании из одной фразы. Публикует студия сама — после проверки.', abi: 'Создай плейтест «Гонки по степи», 30 AB, 15 участников, 12 мин' },
  { go: '#/economy', k: 'Экономика', title: 'Казна сходится всегда', text: 'Балансы + резервы = пополнения − выводы. AB Points не деньги: только обмен на награды. Комиссия 20% с результата и 10% с продажи награды.', spot: '.integrity' },
  { as: 'user', go: '#/profile', k: 'Telegram', title: 'Бот: задания и Аби в чате', text: 'Привязка 1 Telegram = 1 аккаунт, задания прямо в чате, уведомления, напоминание о серии, рейтинг, награды и Аби — пиши ему обычным текстом.', spot: '.tg-feats' },
  { cover: true, end: true, k: 'Пилот', title: 'Ищем три студии для бесплатного пилота', text: 'Команда SithOrder · National Founder Cup 2026, Шымкент. Спасибо! Остаться в демо и попробовать самому — или перейти в настоящее приложение.' },
];

async function firstTask() {
  const { tasks } = await D.api('/api/tasks');
  return (tasks.find((t) => !t.my && !t.locked && /видео|трейлер/i.test(t.title)) || tasks.find((t) => !t.locked) || {}).id;
}
async function firstCampaign() {
  const o = await D.api('/api/company/overview').catch(() => null);
  return o?.campaigns?.find((c) => c.stats?.approved > 0)?.id || o?.campaigns?.[0]?.id;
}

let bar = null;
let idx = 0;
let auto = null;
let moving = false;

function checkStart() {
  if (/[?&]present=1/.test(location.hash) && !bar) {
    history.replaceState(null, '', location.hash.replace(/[?&]present=1/, '').replace(/\?$/, '') || '#/');
    start(0);
  }
}

export function start(from = Number(sessionStorage.getItem(KEY) || 0)) {
  if (bar) return;
  bar = document.createElement('aside');
  bar.className = 'present-bar';
  bar.setAttribute('aria-label', 'Живая презентация');
  bar.innerHTML = `
    <div class="pb-prog" aria-hidden="true"><i></i></div>
    <div class="pb-num" aria-live="polite"></div>
    <div class="pb-body"><span class="pb-k"></span><b class="pb-title"></b><p class="pb-text"></p></div>
    <div class="pb-ctl">
      <button type="button" class="pb-btn" data-p="prev" aria-label="Назад">◀</button>
      <button type="button" class="pb-btn pb-next" data-p="next" aria-label="Дальше">▶</button>
      <button type="button" class="pb-btn" data-p="auto" aria-pressed="false" aria-label="Автопоказ" title="Автопоказ (A)">⏵⏵</button>
      <button type="button" class="pb-btn" data-p="full" aria-label="Полный экран" title="Полный экран (F)">⛶</button>
      <button type="button" class="pb-btn" data-p="min" aria-label="Свернуть табличку" title="Свернуть">▾</button>
      <button type="button" class="pb-btn" data-p="exit" aria-label="Выйти из презентации" title="Выйти (Esc)">✕</button>
    </div>`;
  document.body.append(bar);
  document.body.classList.add('presenting');
  dispatchEvent(new Event('ab:present'));
  bar.addEventListener('click', (e) => {
    const b = e.target.closest('[data-p]');
    if (!b) return;
    ({ prev: () => go(idx - 1), next: () => go(idx + 1), auto: toggleAuto, full: toggleFull, exit: stop, min: () => bar.classList.toggle('min') })[b.dataset.p]?.();
  });
  addEventListener('keydown', onKey, true);
  go(Math.min(Math.max(0, from), SLIDES.length - 1), true);
}

export function stop() {
  if (!bar) return;
  clearInterval(auto);
  auto = null;
  removeEventListener('keydown', onKey, true);
  bar.remove();
  bar = null;
  document.querySelector('.present-cover')?.remove();
  spot(null);
  document.body.classList.remove('presenting');
  sessionStorage.removeItem(KEY);
  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  if (D.isDemo()) D.toast('Вы в демо-песочнице. Вернуться в настоящее приложение — кнопка «✕ ДЕМО» в шапке.');
}

function onKey(e) {
  if (!bar || e.target.closest?.('input, textarea, select, [contenteditable]')) return;
  const k = e.key;
  if (k === 'ArrowRight' || k === 'PageDown' || (k === ' ' && !e.target.closest?.('button, a'))) (e.preventDefault(), go(idx + 1));
  else if (k === 'ArrowLeft' || k === 'PageUp') (e.preventDefault(), go(idx - 1));
  else if (k === 'Escape' && !document.querySelector('dialog[open], .abi-chat')) stop();
  else if (k.toLowerCase() === 'f' && !e.ctrlKey && !e.metaKey) toggleFull();
  else if (k.toLowerCase() === 'a' && !e.ctrlKey && !e.metaKey) toggleAuto();
}

function toggleFull() {
  if (document.fullscreenElement) document.exitFullscreen?.();
  else document.documentElement.requestFullscreen?.().catch(() => D.toast('Полный экран недоступен в этом браузере'));
}
function toggleAuto() {
  const b = bar?.querySelector('[data-p="auto"]');
  if (auto) {
    clearInterval(auto);
    auto = null;
  } else
    auto = setInterval(() => {
      if (idx >= SLIDES.length - 1) return toggleAuto();
      go(idx + 1);
    }, AUTO_MS);
  b?.setAttribute('aria-pressed', String(!!auto));
  b?.classList.toggle('on', !!auto);
}

async function go(n, first = false) {
  if (!bar || moving) return;
  if (n < 0 || n >= SLIDES.length) return n >= SLIDES.length ? stop() : undefined;
  moving = true;
  const s = SLIDES[n];
  idx = n;
  sessionStorage.setItem(KEY, String(n));
  bar.classList.remove('min');
  bar.classList.toggle('on-cover', !!s.cover);
  bar.querySelector('.pb-num').textContent = `${String(n + 1).padStart(2, '0')} / ${SLIDES.length}`;
  bar.querySelector('.pb-k').textContent = s.k;
  bar.querySelector('.pb-title').textContent = s.title;
  bar.querySelector('.pb-text').textContent = s.text;
  bar.querySelector('.pb-prog i').style.width = `${((n + 1) / SLIDES.length) * 100}%`;
  bar.querySelector('.pb-next').textContent = n === SLIDES.length - 1 ? '✓' : '▶';
  bar.classList.remove('flip');
  void bar.offsetWidth;
  bar.classList.add('flip');
  spot(null);
  document.querySelector('.present-cover')?.remove();
  try {
    if (s.cover) cover(s);
    else {
      // Нужная роль в песочнице: занавес служит переходом между «участником» и «студией»
      const role = D.state.me?.role;
      const target = typeof s.go === 'function' ? null : s.go;
      if (!D.isDemo() || (s.as && role !== s.as)) {
        await D.switchMode('demo', { as: s.as || 'user', to: target || undefined });
        if (!target) location.hash = await s.go();
      } else {
        const href = target || (await s.go());
        if (location.hash !== href) location.hash = href;
        else await D.router();
      }
      await waitPaint();
      window.scrollTo({ top: 0, behavior: REDUCED ? 'auto' : 'smooth' });
      if (s.spot) spot(document.querySelector(s.spot));
      if (s.abi) setTimeout(() => D.openAbi(s.abi), first ? 900 : 500);
    }
  } catch (e) {
    D.toast(e.message || 'Слайд не открылся', { kind: 'err' });
  } finally {
    moving = false;
  }
}

const waitPaint = () => new Promise((r) => setTimeout(r, 450));

function cover(s) {
  const el = document.createElement('div');
  el.className = `present-cover${s.end ? ' end' : ''}`;
  el.innerHTML = `<div class="pc-rays" aria-hidden="true"></div>
    <div class="pc-card">
      <span class="pc-star" aria-hidden="true">★</span>
      <span class="pc-k">${esc(s.k)}</span>
      <h1>${esc(s.title)}</h1>
      <p>${esc(s.text)}</p>
      <div class="row" style="justify-content:center">
        ${s.end ? '<button class="btn btn-gold btn-lg" type="button" data-pc="stay">Остаться в демо</button><button class="btn btn-ghost btn-lg" type="button" data-pc="real">В настоящее приложение</button>' : '<button class="btn btn-gold btn-lg" type="button" data-pc="next">Начать показ ▶</button>'}
      </div>
      <small>← → листать · F — полный экран · A — автопоказ · Esc — выйти</small>
    </div>`;
  document.body.append(el);
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-pc]');
    if (!b) return;
    if (b.dataset.pc === 'next') go(idx + 1);
    if (b.dataset.pc === 'stay') stop();
    if (b.dataset.pc === 'real') {
      stop();
      D.switchMode('real');
    }
  });
  el.querySelector('[data-pc]')?.focus();
}

// Подсветка: золотая рамка «прожектора» вокруг важного блока
let spotEl = null;
let spotRaf = 0;
function spot(target) {
  cancelAnimationFrame(spotRaf);
  spotEl?.remove();
  spotEl = null;
  if (!target) return;
  // Только вертикальная прокрутка: scrollIntoView на телефоне может сдвинуть страницу вбок
  const top = window.scrollY + target.getBoundingClientRect().top - Math.max(70, innerHeight * 0.18);
  window.scrollTo({ top: Math.max(0, top), left: 0, behavior: REDUCED ? 'auto' : 'smooth' });
  spotEl = document.createElement('div');
  spotEl.className = 'present-spot';
  spotEl.setAttribute('aria-hidden', 'true');
  document.body.append(spotEl);
  const follow = () => {
    if (!spotEl || !target.isConnected) return spot(null);
    const r = target.getBoundingClientRect();
    Object.assign(spotEl.style, { left: `${r.left - 8}px`, top: `${r.top - 8}px`, width: `${r.width + 16}px`, height: `${r.height + 16}px` });
    spotRaf = requestAnimationFrame(follow);
  };
  follow();
  setTimeout(() => spotEl?.classList.add('fade'), 4200);
}

export const presenting = () => !!bar;
