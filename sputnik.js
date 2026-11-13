// «Спутник: стыковка» — аркада в стиле советского космического плаката.
// Корабль в невесомости: поворот и двигатель. Нужно подойти к стыковочному узлу станции медленно и носом вперёд.
// Уровни: 1 — станция неподвижна, 2 — станция дрейфует, 3 — поле обломков. Топливо ограничено.
const cv = document.getElementById('cv');
const g = cv.getContext('2d');
const W = 960, H = 540;
const $ = (id) => document.getElementById(id);
const C = { cream: '#F3E8D2', red: '#E0502C', gold: '#F5C21B', teal: '#3E9C9E', dark: '#120E0B', navy: '#17242C' };
const LEVELS = [
  { name: 'Учебная орбита', drift: 0, debris: 0, fuel: 100 },
  { name: 'Дрейф станции', drift: 0.35, debris: 0, fuel: 90 },
  { name: 'Поле обломков', drift: 0.25, debris: 7, fuel: 85 },
];
const MAX_DOCK_SPEED = 1.5, MAX_DOCK_ANGLE = 0.24;

const keys = { left: false, right: false, up: false };
const S = { state: 'intro', level: 0, docks: 0, crashes: 0, time: 0, fuelUsed: 0, thrusts: 0, log: [] };
let ship, station, debris, stars, msg, msgT, flame;

const rnd = (a, b) => a + Math.random() * (b - a);
stars = Array.from({ length: 140 }, () => ({ x: rnd(0, W), y: rnd(0, H), r: Math.random() < 0.1 ? 1.8 : rnd(0.4, 1.2), tw: rnd(0, 6) }));

function setup(level) {
  const L = LEVELS[level];
  ship = { x: 140, y: H * 0.62, vx: 0, vy: 0, a: -0.3, va: 0, fuel: L.fuel };
  station = { x: 720, y: 220, t: 0, rot: 0 };
  debris = Array.from({ length: L.debris }, (_, i) => ({ x: rnd(330, 640), y: rnd(60, H - 60), vx: rnd(-0.5, 0.5), vy: rnd(-0.5, 0.5), r: rnd(9, 18), a: rnd(0, 6), va: rnd(-0.02, 0.02), seed: i }));
  flame = 0;
}
setup(0);

// Стыковочный узел станции: точка и направление, куда должен смотреть нос корабля
const port = () => ({ x: station.x - 74, y: station.y + 4, dir: 0 });
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const say = (text, t = 2.4) => ((msg = text), (msgT = t));
const ev = (text) => S.log.push(`${fmt(S.time)} — ур. ${S.level + 1}: ${text}`);

function crash(reason) {
  S.crashes++;
  ev(`авария (${reason})`);
  say(`Авария: ${reason}. Попробуйте ещё раз`, 2.6);
  S.state = 'crash';
  setTimeout(() => {
    setup(S.level);
    S.state = 'run';
  }, 1400);
}
function docked() {
  S.docks++;
  const left = Math.round(ship.fuel);
  ev(`стыковка, осталось топлива ${left}%`);
  if (S.level < LEVELS.length - 1) {
    S.state = 'docked';
    say(`Стыковка! Топливо: ${left}%. Следующий уровень…`, 2.4);
    setTimeout(() => {
      S.level++;
      setup(S.level);
      S.state = 'run';
      say(`Уровень ${S.level + 1}: ${LEVELS[S.level].name}`);
    }, 2200);
  } else {
    S.state = 'done';
    ev('миссия выполнена');
    say('Миссия выполнена! Слава покорителям космоса ★', 99);
  }
}

function step(dt) {
  if (S.state !== 'run') return;
  S.time += dt;
  const L = LEVELS[S.level];
  if (keys.left) ship.va -= 3.2 * dt;
  if (keys.right) ship.va += 3.2 * dt;
  ship.va *= Math.exp(-dt * 2.4);
  ship.a += ship.va * dt;
  flame = keys.up && ship.fuel > 0 ? Math.min(1, flame + dt * 8) : Math.max(0, flame - dt * 6);
  if (keys.up && ship.fuel > 0) {
    ship.vx += Math.cos(ship.a) * 42 * dt;
    ship.vy += Math.sin(ship.a) * 42 * dt;
    const used = 9 * dt;
    ship.fuel = Math.max(0, ship.fuel - used);
    S.fuelUsed += used;
    if (ship.fuel === 0) (ev('топливо закончилось'), say('Топливо на нуле — дрейфуем…'));
  }
  ship.x += ship.vx * dt * 2.2;
  ship.y += ship.vy * dt * 2.2;
  // Станция медленно дрейфует по орбите
  station.t += dt;
  station.rot += dt * 0.25;
  if (L.drift) {
    station.x = 720 + Math.sin(station.t * 0.6) * 60 * L.drift * 2;
    station.y = 230 + Math.cos(station.t * 0.45) * 70 * L.drift * 2;
  }
  for (const d of debris) {
    d.x += d.vx;
    d.y += d.vy;
    d.a += d.va;
    if (d.x < 300 || d.x > 660) d.vx *= -1;
    if (d.y < 40 || d.y > H - 40) d.vy *= -1;
    if (Math.hypot(d.x - ship.x, d.y - ship.y) < d.r + 13) return crash('столкновение с обломком');
  }
  if (ship.x < -30 || ship.x > W + 30 || ship.y < -30 || ship.y > H + 30) return crash('улетели с орбиты');
  // Корпус станции
  if (Math.abs(ship.x - station.x) < 60 && Math.abs(ship.y - station.y) < 26) return crash('удар о корпус станции');
  for (const s of [-1, 1]) if (Math.abs(ship.x - station.x) < 26 && Math.abs(ship.y - (station.y + s * 62)) < 40) return crash('удар о солнечную панель');
  // Стыковка
  const p = port();
  const nose = { x: ship.x + Math.cos(ship.a) * 18, y: ship.y + Math.sin(ship.a) * 18 };
  if (Math.hypot(nose.x - p.x, nose.y - p.y) < 14) {
    const speed = Math.hypot(ship.vx, ship.vy) / 10;
    const ang = Math.abs(Math.atan2(Math.sin(ship.a - p.dir), Math.cos(ship.a - p.dir)));
    if (speed > MAX_DOCK_SPEED) return crash(`слишком быстро (${speed.toFixed(1)})`);
    if (ang > MAX_DOCK_ANGLE) return crash('не тем боком');
    docked();
  }
}

// ---------- рисование ----------
function drawShip() {
  g.save();
  g.translate(ship.x, ship.y);
  g.rotate(ship.a);
  if (flame > 0) {
    g.fillStyle = `rgba(245,194,27,${0.5 + flame * 0.5})`;
    g.beginPath();
    g.moveTo(-14, -6);
    g.lineTo(-14 - 18 * flame - Math.random() * 8, 0);
    g.lineTo(-14, 6);
    g.fill();
  }
  g.fillStyle = C.cream;
  g.beginPath();
  g.moveTo(20, 0);
  g.quadraticCurveTo(8, -12, -12, -10);
  g.lineTo(-14, 10);
  g.quadraticCurveTo(8, 12, 20, 0);
  g.fill();
  g.fillStyle = C.red;
  g.fillRect(-14, -10, 6, 20);
  g.fillStyle = C.teal;
  g.beginPath();
  g.arc(6, 0, 4, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = C.gold;
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(-6, -11);
  g.lineTo(-10, -24);
  g.moveTo(-6, 11);
  g.lineTo(-10, 24);
  g.stroke();
  g.restore();
}
function drawStation() {
  const { x, y } = station;
  // солнечные панели
  for (const s of [-1, 1]) {
    g.fillStyle = C.teal;
    g.fillRect(x - 18, y + s * 32 - (s < 0 ? 52 : 0), 36, 52);
    g.strokeStyle = 'rgba(243,232,210,.45)';
    g.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      g.beginPath();
      g.moveTo(x - 18, y + s * 32 - (s < 0 ? 52 : 0) + i * 13);
      g.lineTo(x + 18, y + s * 32 - (s < 0 ? 52 : 0) + i * 13);
      g.stroke();
    }
  }
  g.fillStyle = C.cream;
  g.fillRect(x - 60, y - 20, 120, 40);
  g.fillStyle = C.red;
  g.fillRect(x - 60, y - 20, 18, 40);
  g.fillRect(x + 42, y - 20, 18, 40);
  g.fillStyle = C.gold;
  star(x, y, 13, 5.5);
  // стыковочный узел с мигающими огнями
  const p = port();
  g.fillStyle = '#B9B4AA';
  g.fillRect(p.x, p.y - 9, 14, 18);
  const on = Math.sin(performance.now() / 180) > 0;
  g.fillStyle = on ? C.gold : '#5a4a20';
  g.beginPath();
  g.arc(p.x - 2, p.y - 12, 3, 0, Math.PI * 2);
  g.arc(p.x - 2, p.y + 12, 3, 0, Math.PI * 2);
  g.fill();
  // направляющий «коридор»
  g.strokeStyle = 'rgba(245,194,27,.25)';
  g.setLineDash([6, 8]);
  g.beginPath();
  g.moveTo(p.x - 4, p.y);
  g.lineTo(p.x - 170, p.y);
  g.stroke();
  g.setLineDash([]);
}
function star(x, y, R, r) {
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? r : R;
    g[i ? 'lineTo' : 'moveTo'](x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  g.closePath();
  g.fill();
}
function drawDebris() {
  for (const d of debris) {
    g.save();
    g.translate(d.x, d.y);
    g.rotate(d.a);
    g.fillStyle = '#6B5A4A';
    g.beginPath();
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2, rr = d.r * (0.7 + ((d.seed * 7 + i * 13) % 5) / 12);
      g[i ? 'lineTo' : 'moveTo'](Math.cos(a) * rr, Math.sin(a) * rr);
    }
    g.closePath();
    g.fill();
    g.restore();
  }
}
function hud() {
  const speed = Math.hypot(ship.vx, ship.vy) / 10;
  g.fillStyle = 'rgba(18,14,11,.75)';
  g.fillRect(12, 12, 250, 74);
  g.strokeStyle = C.gold;
  g.lineWidth = 2;
  g.strokeRect(12, 12, 250, 74);
  g.fillStyle = C.cream;
  g.font = '700 14px system-ui, sans-serif';
  g.fillText(`УРОВЕНЬ ${S.level + 1} · ${LEVELS[S.level].name.toUpperCase()}`, 24, 34);
  g.fillStyle = speed > MAX_DOCK_SPEED ? C.red : C.gold;
  g.fillText(`СКОРОСТЬ ${speed.toFixed(1)}`, 24, 56);
  g.fillStyle = C.cream;
  g.fillText('ТОПЛИВО', 140, 56);
  g.fillStyle = '#3B2E24';
  g.fillRect(24, 66, 226, 9);
  g.fillStyle = ship.fuel < 20 ? C.red : C.teal;
  g.fillRect(24, 66, (226 * ship.fuel) / 100, 9);
}
function frame() {
  // фон: звёзды и край Земли
  g.fillStyle = '#0B0807';
  g.fillRect(0, 0, W, H);
  const t = performance.now() / 1000;
  for (const s of stars) {
    g.fillStyle = `rgba(243,232,210,${0.45 + 0.4 * Math.sin(t * 1.3 + s.tw)})`;
    g.fillRect(s.x, s.y, s.r, s.r);
  }
  const grad = g.createRadialGradient(W / 2, H + 520, 520, W / 2, H + 520, 640);
  grad.addColorStop(0, '#3E9C9E');
  grad.addColorStop(0.75, '#2F7E80');
  grad.addColorStop(1, 'rgba(62,156,158,0)');
  g.fillStyle = grad;
  g.beginPath();
  g.arc(W / 2, H + 520, 640, 0, Math.PI * 2);
  g.fill();
  drawStation();
  drawDebris();
  drawShip();
  hud();
  if (S.state === 'intro' || S.state === 'pause') {
    g.fillStyle = 'rgba(11,8,7,.72)';
    g.fillRect(0, 0, W, H);
    g.fillStyle = C.red;
    star(W / 2, 160, 34, 14);
    g.fillStyle = C.cream;
    g.textAlign = 'center';
    g.font = '900 38px system-ui, sans-serif';
    g.fillText(S.state === 'pause' ? 'ПАУЗА' : 'СПУТНИК: СТЫКОВКА', W / 2, 250);
    g.font = '500 18px system-ui, sans-serif';
    g.fillText('Подойдите к узлу станции медленно и носом вперёд', W / 2, 290);
    g.fillStyle = C.gold;
    g.font = '700 18px system-ui, sans-serif';
    g.fillText('Пробел или тап — старт', W / 2, 340);
    g.textAlign = 'left';
  }
  if (msgT > 0) {
    g.textAlign = 'center';
    g.font = '800 22px system-ui, sans-serif';
    g.fillStyle = 'rgba(18,14,11,.8)';
    const w = g.measureText(msg).width + 40;
    g.fillRect(W / 2 - w / 2, H - 82, w, 42);
    g.fillStyle = S.state === 'crash' ? C.red : C.gold;
    g.fillText(msg, W / 2, H - 54);
    g.textAlign = 'left';
  }
}

let last = performance.now();
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (msgT > 0) msgT -= dt;
  step(dt);
  frame();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

function toggle() {
  if (S.state === 'intro') (S.state = 'run'), say(`Уровень 1: ${LEVELS[0].name}`);
  else if (S.state === 'run') S.state = 'pause';
  else if (S.state === 'pause') S.state = 'run';
  else if (S.state === 'done') {
    Object.assign(S, { state: 'run', level: 0 });
    setup(0);
  }
}
const map = { ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', ArrowUp: 'up', KeyW: 'up' };
addEventListener('keydown', (e) => {
  if (map[e.code]) {
    e.preventDefault();
    if (keys[map[e.code]] === false && map[e.code] === 'up') S.thrusts++;
    keys[map[e.code]] = true;
    if (S.state === 'intro') toggle();
  } else if (e.code === 'Space' || e.code === 'KeyP') {
    e.preventDefault();
    toggle();
  }
});
addEventListener('keyup', (e) => map[e.code] && (keys[map[e.code]] = false));
cv.addEventListener('pointerdown', (e) => (e.preventDefault(), S.state !== 'run' && toggle()));
for (const b of document.querySelectorAll('.pad button')) {
  const k = b.dataset.k;
  const on = (v) => (e) => {
    e.preventDefault();
    if (v && S.state !== 'run' && S.state !== 'crash' && S.state !== 'docked') toggle();
    if (v && k === 'up') S.thrusts++;
    keys[k] = v;
    b.classList.toggle('on', v);
  };
  b.addEventListener('pointerdown', on(true));
  for (const ev2 of ['pointerup', 'pointercancel', 'pointerleave']) b.addEventListener(ev2, on(false));
}
document.addEventListener('visibilitychange', () => document.hidden && S.state === 'run' && (S.state = 'pause'));

function render() {
  $('s-level').textContent = S.level + 1;
  $('s-dock').textContent = S.docks;
  $('s-crash').textContent = S.crashes;
  $('s-time').textContent = fmt(S.time);
  const status = S.state === 'done' ? 'миссия выполнена' : `дошёл до уровня ${S.level + 1} из 3`;
  const text = [`Спутник: стыковка 0.4 — ${status}`, `Время в полёте: ${fmt(S.time)} · стыковок: ${S.docks} · аварий: ${S.crashes} · включений двигателя: ${S.thrusts} · топлива сожжено: ${Math.round(S.fuelUsed)}%`, ...S.log.slice(-6)].join('\n');
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
