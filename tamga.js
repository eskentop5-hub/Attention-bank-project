// «Тамга» — мемори с орнаментами по мотивам казахских узоров. 3 уровня: 8, 10 и 12 пар.
// Орнаменты нарисованы здесь же простыми SVG-фигурами (оригинальные рисунки, без чужих картинок).
const $ = (id) => document.getElementById(id);
const P = { red: '#D63C22', teal: '#2E8C8A', navy: '#17242C', gold: '#C98A12', coral: '#E5573C' };
const sw = (c, w = 7) => `fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"`;
const SYMBOLS = [
  // қошқар мүйіз — рога барана
  `<path d="M50 88 V52 M50 52 C50 30 22 24 18 40 C15 52 30 56 34 46 M50 52 C50 30 78 24 82 40 C85 52 70 56 66 46" ${sw(P.red)}/>`,
  // солнце
  `<circle cx="50" cy="50" r="16" fill="${P.gold}"/>${Array.from({ length: 12 }, (_, i) => { const a = (i * Math.PI) / 6; return `<line x1="${50 + Math.cos(a) * 24}" y1="${50 + Math.sin(a) * 24}" x2="${50 + Math.cos(a) * 38}" y2="${50 + Math.sin(a) * 38}" ${sw(P.gold, 6)}/>`; }).join('')}`,
  // восьмиконечная звезда
  `<path d="M50 10 L59 36 L86 30 L68 50 L86 70 L59 64 L50 90 L41 64 L14 70 L32 50 L14 30 L41 36 Z" fill="${P.navy}"/><circle cx="50" cy="50" r="8" fill="${P.gold}"/>`,
  // ромб в ромбе
  `<path d="M50 12 L86 50 L50 88 L14 50 Z" ${sw(P.teal, 7)}/><path d="M50 32 L68 50 L50 68 L32 50 Z" fill="${P.teal}"/>`,
  // тұмар — треугольный оберег
  `<path d="M50 16 L84 78 H16 Z" ${sw(P.coral, 7)}/><circle cx="50" cy="58" r="9" fill="${P.coral}"/><path d="M30 88 V96 M50 88 V96 M70 88 V96" ${sw(P.coral, 5)}/>`,
  // волны — су
  `<path d="M10 36 Q22 22 34 36 T58 36 T82 36 T96 36 M10 62 Q22 48 34 62 T58 62 T82 62 T96 62" ${sw(P.teal, 7)}/>`,
  // полумесяц и звезда
  `<path d="M62 16 A36 36 0 1 0 62 84 A28 28 0 1 1 62 16 Z" fill="${P.gold}"/><path d="M72 40 L75 48 L83 48 L77 53 L79 61 L72 56 L65 61 L67 53 L61 48 L69 48 Z" fill="${P.red}"/>`,
  // древо жизни
  `<path d="M50 90 V20 M50 40 L30 26 M50 40 L70 26 M50 58 L26 46 M50 58 L74 46 M50 74 L32 66 M50 74 L68 66" ${sw('#3E7A3A', 7)}/><circle cx="50" cy="16" r="7" fill="${P.red}"/>`,
  // глаз-круг (оберег)
  `<circle cx="50" cy="50" r="34" ${sw(P.navy, 7)}/><circle cx="50" cy="50" r="18" ${sw(P.teal, 7)}/><circle cx="50" cy="50" r="6" fill="${P.red}"/>`,
  // горы-зигзаг
  `<path d="M8 76 L28 36 L44 62 L60 26 L92 76" ${sw(P.navy, 8)}/><circle cx="76" cy="26" r="8" fill="${P.gold}"/>`,
  // тюльпан
  `<path d="M50 90 V54" ${sw('#3E7A3A', 7)}/><path d="M30 30 Q34 58 50 58 Q66 58 70 30 Q60 40 50 24 Q40 40 30 30 Z" fill="${P.red}"/><path d="M50 74 Q36 70 32 60 M50 76 Q64 72 68 62" ${sw('#3E7A3A', 6)}/>`,
  // птица-стрела
  `<path d="M14 58 Q40 30 86 40 Q60 48 54 66 Q44 56 14 58 Z" fill="${P.navy}"/><path d="M58 44 L80 24" ${sw(P.gold, 6)}/>`,
];
const svg = (i) => `<svg viewBox="0 0 100 100" aria-hidden="true">${SYMBOLS[i]}</svg>`;
const NAMES = ['рога барана', 'солнце', 'звезда', 'ромб', 'тумар', 'волны', 'полумесяц', 'древо', 'оберег', 'горы', 'тюльпан', 'птица'];
const LEVELS = [{ pairs: 8, cols: 4 }, { pairs: 10, cols: 5 }, { pairs: 12, cols: 6 }];
const S = { level: 0, moves: 0, miss: 0, combo: 0, bestCombo: 0, pairsTotal: 0, time: 0, running: false, done: false, log: [], confused: {} };
let cards = [], open = [], lock = false;

const shuffle = (a) => {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

function deal() {
  const L = LEVELS[S.level];
  const ids = shuffle([...SYMBOLS.keys()]).slice(0, L.pairs);
  cards = shuffle([...ids, ...ids]).map((sym, i) => ({ i, sym, done: false }));
  open = [];
  lock = false;
  const board = $('board');
  const cols = innerWidth < 560 ? Math.min(4, L.cols) : L.cols;
  board.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
  board.style.maxWidth = `${cols * 132 + 32}px`;
  board.innerHTML = cards
    .map((c) => `<button type="button" class="cell" data-i="${c.i}" role="gridcell" aria-label="Закрытая карточка"><div class="in"><div class="face back"></div><div class="face front">${svg(c.sym)}</div></div></button>`)
    .join('');
}

function flip(i) {
  const c = cards[i];
  if (lock || c.done || open.includes(i) || S.done) return;
  if (!S.running) S.running = true;
  const el = document.querySelector(`.cell[data-i="${i}"]`);
  el.classList.add('open');
  el.setAttribute('aria-label', `Орнамент: ${NAMES[c.sym]}`);
  open.push(i);
  if (open.length < 2) return;
  S.moves++;
  const [a, b] = open.map((k) => cards[k]);
  if (a.sym === b.sym) {
    a.done = b.done = true;
    S.combo++;
    S.bestCombo = Math.max(S.bestCombo, S.combo);
    S.pairsTotal++;
    for (const k of open) document.querySelector(`.cell[data-i="${k}"]`).classList.add('done');
    open = [];
    if (cards.every((x) => x.done)) levelDone();
  } else {
    S.miss++;
    S.combo = 0;
    const key = [NAMES[a.sym], NAMES[b.sym]].sort().join(' ↔ ');
    S.confused[key] = (S.confused[key] || 0) + 1;
    lock = true;
    const els = open.map((k) => document.querySelector(`.cell[data-i="${k}"]`));
    els.forEach((e) => e.classList.add('miss'));
    setTimeout(() => {
      els.forEach((e) => (e.classList.remove('open', 'miss'), e.setAttribute('aria-label', 'Закрытая карточка')));
      open = [];
      lock = false;
    }, 850);
  }
  hud();
}

function levelDone() {
  S.log.push(`${fmt(S.time)} — уровень ${S.level + 1} пройден (ходов всего: ${S.moves}, ошибок: ${S.miss})`);
  if (S.level < LEVELS.length - 1) {
    setTimeout(() => {
      S.level++;
      deal();
      hud();
    }, 900);
  } else {
    S.done = true;
    S.running = false;
    S.log.push(`${fmt(S.time)} — все уровни пройдены`);
    setTimeout(() => {
      $('board').style.gridTemplateColumns = '1fr';
      $('board').style.maxWidth = '';
      $('board').innerHTML = `<div class="win"><h2>Керемет! ★</h2><p>Все уровни пройдены за ${fmt(S.time)} — ${S.moves} ходов, ${S.miss} ошибок, лучшая серия ${S.bestCombo}.</p><button type="button" id="again">Сыграть ещё</button></div>`;
      $('again').onclick = restart;
    }, 700);
  }
}

function restart() {
  Object.assign(S, { level: 0, moves: 0, miss: 0, combo: 0, bestCombo: 0, pairsTotal: 0, time: 0, running: false, done: false, log: [], confused: {} });
  deal();
  hud();
}

function hud() {
  $('h-level').textContent = S.level + 1;
  $('h-moves').textContent = S.moves;
  $('h-miss').textContent = S.miss;
  $('h-time').textContent = fmt(S.time);
  $('h-combo').textContent = S.combo;
  $('s-level').textContent = S.level + 1;
  $('s-pairs').textContent = S.pairsTotal;
  $('s-miss').textContent = S.miss;
  $('s-time').textContent = fmt(S.time);
  const worst = Object.entries(S.confused).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k, n]) => `${k} (${n})`);
  const text = [`Тамга 0.7 — ${S.done ? 'все уровни пройдены' : `уровень ${S.level + 1} из 3`}`, `Время: ${fmt(S.time)} · ходов: ${S.moves} · ошибок: ${S.miss} · лучшая серия: ${S.bestCombo}`, ...(worst.length ? [`Чаще путал: ${worst.join(', ')}`] : []), ...S.log.slice(-4)].join('\n');
  if ($('summary').value !== text) $('summary').value = text;
}

$('board').addEventListener('click', (e) => {
  const b = e.target.closest('.cell');
  if (b) flip(Number(b.dataset.i));
});
$('restart').addEventListener('click', restart);
setInterval(() => {
  if (S.running && !document.hidden) S.time += 0.25;
  hud();
}, 250);
$('copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('summary').value);
    $('copy').textContent = 'Скопировано ✓';
  } catch {
    $('summary').select();
    $('copy').textContent = 'Выделено — Ctrl+C';
  }
  setTimeout(() => ($('copy').textContent = 'Скопировать'), 2000);
});
deal();
hud();
