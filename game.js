import { createRunner } from './runner.js';

const cv = document.getElementById('cv');
const $ = (id) => document.getElementById(id);
const log = [];
const runner = createRunner(cv, {
  onEvent(e) {
    const t = fmt(runner.stats().time);
    if (e.type === 'death') log.push(`${t} — уровень ${e.level}: ${e.reason === 'rock' ? 'камень' : 'овраг'}`);
    if (e.type === 'cleared') log.push(`${t} — уровень ${e.level} пройден`);
    if (e.type === 'done') log.push(`${t} — игра пройдена`);
  },
});

const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

// Управление: клавиатура, касание, свайп вверх
addEventListener('keydown', (e) => {
  if (['Space', 'ArrowUp', 'KeyW'].includes(e.code)) {
    e.preventDefault();
    if (!e.repeat) runner.jump();
  } else if (e.code === 'KeyP' || e.code === 'Escape') runner.pause();
});
cv.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  runner.jump();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && runner.state === 'run') runner.pause();
});

function render() {
  const s = runner.stats();
  $('s-level').textContent = s.level;
  $('s-coins').textContent = s.coins;
  $('s-deaths').textContent = s.deaths;
  $('s-time').textContent = fmt(s.time);
  const status = s.state === 'done' ? 'пройдена полностью' : `дошёл до уровня ${s.level} из 3`;
  const text = [
    `Steppe Runner 0.9 — ${status}`,
    `Время в игре: ${fmt(s.time)} · падений: ${s.deaths} · монет: ${s.coins} · прыжков: ${s.jumps}`,
    ...log.slice(-6),
  ].join('\n');
  if ($('summary').value !== text) $('summary').value = text;
}
setInterval(render, 500);
render();

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
