import { createRunner } from './runner.js';

// Трейлер: настоящий игровой движок на автопилоте + титры по таймлайну (40 секунд, по кругу)
const LEN = 40;
const CAPS = [
  [0.5, 5, 'Степь. Конь. Ветер.'],
  [6, 11, 'Перепрыгивай овраги одним касанием'],
  [12, 17, 'Собирай монеты над препятствиями'],
  [18, 25, 'Встречай закат над Каратау'],
  [32.5, 36.5, 'А потом — ночь под звёздами'],
  [37, 39.8, 'Steppe Runner · бета уже доступна'],
];
const SHOTS = [9, 23, 35];

const cv = document.getElementById('cv');
const cap = document.getElementById('cap');
const prog = document.getElementById('prog');
const timeEl = document.getElementById('time');
const pp = document.getElementById('pp');
const shotsEl = document.getElementById('shots');
const runner = createRunner(cv, { autopilot: true });

let t = 0, playing = !matchMedia('(prefers-reduced-motion: reduce)').matches, last = performance.now(), shotsTaken = new Set(), capIdx = -1;
if (!playing) runner.pause(), (pp.textContent = '▶');

function tick(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (playing) {
    t += dt;
    if (t >= LEN) {
      t = 0;
      capIdx = -1;
    }
  }
  const idx = CAPS.findIndex(([a, b]) => t >= a && t < b);
  if (idx !== capIdx) {
    capIdx = idx;
    cap.classList.remove('on');
    if (idx >= 0) {
      cap.textContent = CAPS[idx][2];
      requestAnimationFrame(() => cap.classList.add('on'));
    }
  }
  prog.style.width = `${(t / LEN) * 100}%`;
  timeEl.textContent = `${fmt(t)} / ${fmt(LEN)}`;
  for (const [i, at] of SHOTS.entries()) {
    if (t >= at && !shotsTaken.has(i)) {
      shotsTaken.add(i);
      const img = new Image();
      img.alt = `Скриншот ${i + 1}: игровой процесс`;
      img.src = runner.snapshot();
      shotsEl.children[i].replaceChildren(img);
    }
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
pp.addEventListener('click', () => {
  playing = !playing;
  runner.pause();
  pp.textContent = playing ? '❚❚' : '▶';
  pp.setAttribute('aria-label', playing ? 'Пауза' : 'Смотреть');
});
