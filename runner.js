// Steppe Runner — раннер про коня в степи (Canvas 2D, без библиотек).
// Используется и в самой игре (index.html), и в трейлере на странице магазина (store.html, autopilot).

const W = 960, H = 540, GROUND = 432, HORSE_X = 210;
const GRAV = 2700, JUMP_V = -980, COYOTE = 0.09, BUFFER = 0.14;

export const LEVELS = [
  { name: 'Утро в степи', length: 5200, speed: 330, phase: 0.0, gaps: [110, 150], rocks: 0.25, density: [620, 900] },
  { name: 'Закат над Каратау', length: 6400, speed: 410, phase: 0.5, gaps: [130, 180], rocks: 0.4, density: [520, 800] },
  { name: 'Ночь и звёзды', length: 7600, speed: 480, phase: 1.0, gaps: [140, 200], rocks: 0.5, density: [480, 720] },
];

// Детерминированный генератор: у всех тестировщиков одинаковые уровни — честное сравнение
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function buildLevel(i) {
  const L = LEVELS[i], r = rng(1337 + i * 97);
  const obstacles = [], coins = [];
  let x = 1100; // первые секунды — без препятствий
  while (x < L.length - 500) {
    if (r() < L.rocks && x > 1500) {
      obstacles.push({ type: 'rock', x, w: 46, h: 40 + r() * 16 });
      coins.push(...arc(x - 40, 3, 150));
    } else {
      const w = L.gaps[0] + r() * (L.gaps[1] - L.gaps[0]);
      obstacles.push({ type: 'gap', x, w });
      coins.push(...arc(x + w / 2 - 50, 3, 170));
    }
    if (r() < 0.45) coins.push(...line(x + 260, 4));
    x += L.density[0] + r() * (L.density[1] - L.density[0]);
  }
  return { obstacles, coins, length: L.length };
  function arc(cx, n, hgt) {
    return Array.from({ length: n }, (_, k) => ({ x: cx + k * 50, y: GROUND - 70 - Math.sin(((k + 0.5) / n) * Math.PI) * hgt, got: false }));
  }
  function line(sx, n) {
    return Array.from({ length: n }, (_, k) => ({ x: sx + k * 44, y: GROUND - 46, got: false }));
  }
}

// ---------- Фон: горы, холмы, юрты (параллакс) ----------
function ridge(seed, n, base, amp) {
  const r = rng(seed);
  return Array.from({ length: n }, () => base - r() * amp);
}
const FAR = ridge(7, 40, 300, 130), MID = ridge(11, 60, 360, 60);

const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const rgb = (c) => `rgb(${c[0]},${c[1]},${c[2]})`;
// Палитры: день → закат → ночь
const SKY = [
  { top: [94, 176, 224], bot: [246, 231, 178], far: [120, 150, 176], mid: [126, 150, 92], ground: [146, 122, 74], grass: [118, 160, 70] },
  { top: [52, 48, 104], bot: [242, 140, 64], far: [102, 74, 108], mid: [92, 82, 66], ground: [110, 80, 54], grass: [126, 120, 54] },
  { top: [5, 11, 28], bot: [30, 46, 82], far: [26, 38, 64], mid: [22, 36, 40], ground: [44, 40, 40], grass: [40, 70, 56] },
];
function palette(p) {
  const i = Math.min(1, Math.floor(p * 2)), t = Math.min(1, p * 2 - i);
  const a = SKY[i], b = SKY[Math.min(2, i + 1)];
  return Object.fromEntries(Object.keys(a).map((k) => [k, mix(a[k], b[k], t)]));
}

export function createRunner(canvas, { autopilot = false, onEvent = () => {} } = {}) {
  const ctx = canvas.getContext('2d');
  const st = {
    level: 0, world: buildLevel(0), dist: 0, y: GROUND, vy: 0, onGround: true, airT: 0, buffer: 0,
    gallop: 0, coins: 0, levelCoins: 0, deaths: 0, state: autopilot ? 'run' : 'title', time: 0, playTime: 0,
    dust: [], flash: 0, phaseNow: LEVELS[0].phase, shake: 0, levelStart: 0, jumps: 0, stars: [], over: null,
  };
  const sr = rng(5);
  st.stars = Array.from({ length: 90 }, () => ({ x: sr() * W, y: sr() * 300, s: sr() * 1.6 + 0.3, t: sr() * 6 }));

  function resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = canvas.clientWidth || W;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round((w * H) / W * dpr);
    ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
  }
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);

  function startLevel(i) {
    st.level = i;
    st.world = buildLevel(i);
    st.dist = 0;
    st.y = GROUND;
    st.vy = 0;
    st.onGround = true;
    st.levelCoins = 0;
    st.levelStart = st.playTime;
    st.state = 'run';
    onEvent({ type: 'level', level: i + 1 });
  }

  function jump() {
    if (st.state === 'title') return startLevel(0);
    if (st.state === 'dead') return startLevel(st.level);
    if (st.state === 'cleared') return st.level < 2 ? startLevel(st.level + 1) : finish();
    if (st.state === 'run') st.buffer = BUFFER;
  }

  function finish() {
    st.state = 'done';
    st.over = { time: st.playTime, deaths: st.deaths, coins: st.coins, jumps: st.jumps };
    onEvent({ type: 'done', ...st.over });
  }

  function die(reason) {
    st.state = 'dead';
    st.deaths++;
    st.coins -= st.levelCoins; // монеты уровня сгорают — честный счёт
    st.shake = 0.35;
    st.deathReason = reason;
    onEvent({ type: 'death', reason, level: st.level + 1 });
  }

  // Над оврагом ли сейчас конь
  const overGap = (wx) => st.world.obstacles.some((o) => o.type === 'gap' && wx > o.x + 14 && wx < o.x + o.w - 14);

  function ai() {
    // Автопилот трейлера: прыгает с упреждением, иногда «впритык» — выглядит живо
    const ahead = st.world.obstacles.find((o) => o.x + (o.w || 0) > st.dist + HORSE_X - 20);
    if (!ahead || !st.onGround) return;
    const d = ahead.x - (st.dist + HORSE_X);
    const lead = LEVELS[st.level].speed * (ahead.type === 'gap' ? 0.2 : 0.28);
    if (d < lead && d > -10) st.buffer = BUFFER;
  }

  function update(dt) {
    st.time += dt;
    const L = LEVELS[st.level];
    st.phaseNow += (L.phase - st.phaseNow) * Math.min(1, dt * 0.8);
    st.shake = Math.max(0, st.shake - dt);
    for (const p of st.dust) {
      p.x -= (L.speed * 0.6 + p.vx) * dt;
      p.y += p.vy * dt;
      p.life -= dt;
    }
    st.dust = st.dust.filter((p) => p.life > 0);
    if (st.state !== 'run') {
      if (autopilot && st.state === 'cleared') startLevel((st.level + 1) % 3);
      if (autopilot && st.state === 'dead') startLevel(st.level);
      return;
    }
    st.playTime += dt;
    if (autopilot) ai();
    st.dist += L.speed * dt;
    st.gallop += dt * (L.speed / 38);
    const wx = st.dist + HORSE_X;
    const ground = !overGap(wx);

    st.buffer = Math.max(0, st.buffer - dt);
    if (st.onGround) st.airT = 0;
    else st.airT += dt;
    if (st.buffer > 0 && (st.onGround || st.airT < COYOTE) && st.vy >= 0) {
      st.vy = JUMP_V;
      st.onGround = false;
      st.buffer = 0;
      st.airT = COYOTE;
      st.jumps++;
      puff(10);
    }
    st.vy += GRAV * dt;
    st.y += st.vy * dt;
    if (ground && st.y >= GROUND && st.vy >= 0 && st.y - st.vy * dt <= GROUND + 4) {
      if (!st.onGround) puff(8);
      st.y = GROUND;
      st.vy = 0;
      st.onGround = true;
    } else if (st.y < GROUND || !ground) st.onGround = false;
    if (st.y > H + 80) return die('gap');
    if (st.onGround && Math.random() < dt * 14) puff(1);

    for (const o of st.world.obstacles) {
      if (o.type !== 'rock') continue;
      const ox = o.x - st.dist;
      if (ox < HORSE_X + 46 && ox + o.w > HORSE_X - 30 && st.y > GROUND - o.h + 6) return die('rock');
    }
    for (const c of st.world.coins) {
      if (c.got) continue;
      const cx = c.x - st.dist;
      if (Math.abs(cx - HORSE_X) < 46 && Math.abs(c.y - (st.y - 50)) < 56) {
        c.got = true;
        st.coins++;
        st.levelCoins++;
      }
    }
    if (st.dist >= st.world.length) {
      st.state = 'cleared';
      onEvent({ type: 'cleared', level: st.level + 1 });
    }
  }

  function puff(n) {
    for (let i = 0; i < n; i++) st.dust.push({ x: HORSE_X - 30 + Math.random() * 40, y: GROUND - 4, vx: Math.random() * 80, vy: -20 - Math.random() * 40, life: 0.5 + Math.random() * 0.4, r: 3 + Math.random() * 5 });
  }

  // ---------- Отрисовка ----------
  function draw() {
    const P = palette(st.phaseNow);
    ctx.save();
    if (st.shake) ctx.translate((Math.random() - 0.5) * 14 * st.shake, (Math.random() - 0.5) * 14 * st.shake);
    const sky = ctx.createLinearGradient(0, 0, 0, GROUND);
    sky.addColorStop(0, rgb(P.top));
    sky.addColorStop(1, rgb(P.bot));
    ctx.fillStyle = sky;
    ctx.fillRect(-20, -20, W + 40, H + 40);

    // Звёзды и светила
    const night = Math.max(0, st.phaseNow * 2 - 1);
    if (night > 0) for (const s of st.stars) {
      ctx.globalAlpha = night * (0.5 + 0.5 * Math.sin(st.time * 2 + s.t));
      ctx.fillStyle = '#fff';
      ctx.fillRect(s.x, s.y, s.s, s.s);
    }
    ctx.globalAlpha = 1;
    const sunY = 90 + st.phaseNow * 300;
    if (st.phaseNow < 0.85) {
      const g = ctx.createRadialGradient(720, sunY, 10, 720, sunY, 120);
      g.addColorStop(0, 'rgba(255,240,200,0.9)');
      g.addColorStop(0.25, 'rgba(255,214,120,0.35)');
      g.addColorStop(1, 'rgba(255,200,120,0)');
      ctx.fillStyle = g;
      ctx.fillRect(560, sunY - 140, 320, 280);
      ctx.fillStyle = st.phaseNow > 0.3 ? '#FFB25A' : '#FFF4D2';
      ctx.beginPath();
      ctx.arc(720, sunY, 34, 0, Math.PI * 2);
      ctx.fill();
    }
    if (night > 0) {
      ctx.globalAlpha = night;
      ctx.fillStyle = '#EDEFF7';
      ctx.beginPath();
      ctx.arc(250, 110, 26, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = rgb(P.top);
      ctx.beginPath();
      ctx.arc(262, 102, 24, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    layer(FAR, 0.12, P.far, 48, true);
    yurts(0.3, P);
    layer(MID, 0.3, P.mid, 34, false);

    // Земля с оврагами
    const segs = [];
    let from = -st.dist;
    for (const o of st.world.obstacles) {
      if (o.type !== 'gap') continue;
      segs.push([from, o.x - st.dist]);
      from = o.x + o.w - st.dist;
    }
    segs.push([from, st.world.length + 2000 - st.dist]);
    // Глубина оврагов: тёмный градиент под всей полосой земли
    const pit = ctx.createLinearGradient(0, GROUND, 0, H);
    pit.addColorStop(0, rgb(mix(P.ground, [0, 0, 0], 0.55)));
    pit.addColorStop(1, '#050302');
    ctx.fillStyle = pit;
    ctx.fillRect(-20, GROUND - 2, W + 40, H - GROUND + 22);
    for (const [a, b] of segs) {
      if (b < -20 || a > W + 20) continue;
      ctx.fillStyle = rgb(P.ground);
      ctx.fillRect(a, GROUND, b - a, H - GROUND);
      const shade = ctx.createLinearGradient(0, GROUND, 0, H);
      shade.addColorStop(0, 'rgba(0,0,0,0)');
      shade.addColorStop(1, 'rgba(0,0,0,0.35)');
      ctx.fillStyle = shade;
      ctx.fillRect(a, GROUND, b - a, H - GROUND);
      ctx.fillStyle = rgb(P.grass);
      ctx.fillRect(a, GROUND - 6, b - a, 12);
      // Края обрыва
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fillRect(b - 6, GROUND, 6, H - GROUND);
      ctx.fillRect(a, GROUND, 6, H - GROUND);
      // Трава
      ctx.strokeStyle = rgb(mix(P.grass, [255, 255, 200], 0.15));
      ctx.lineWidth = 2;
      ctx.beginPath();
      const step = 26, start = Math.ceil((a + st.dist) / step) * step;
      for (let gx = start; gx < b + st.dist; gx += step) {
        const sx = gx - st.dist, hh = 6 + ((gx * 7) % 9);
        ctx.moveTo(sx, GROUND - 4);
        ctx.lineTo(sx - 3 + Math.sin(st.time * 3 + gx) * 2, GROUND - 4 - hh);
      }
      ctx.stroke();
    }
    // Камни
    for (const o of st.world.obstacles) {
      if (o.type !== 'rock') continue;
      const x = o.x - st.dist;
      if (x < -80 || x > W + 80) continue;
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.beginPath();
      ctx.ellipse(x + o.w / 2, GROUND + 4, o.w * 0.7, 6, 0, 0, Math.PI * 2);
      ctx.fill();
      const g = ctx.createLinearGradient(x, GROUND - o.h, x + o.w, GROUND);
      g.addColorStop(0, '#A6A39A');
      g.addColorStop(1, '#55524C');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(x - 4, GROUND);
      ctx.lineTo(x + 6, GROUND - o.h * 0.7);
      ctx.lineTo(x + o.w * 0.45, GROUND - o.h);
      ctx.lineTo(x + o.w, GROUND - o.h * 0.55);
      ctx.lineTo(x + o.w + 6, GROUND);
      ctx.closePath();
      ctx.fill();
    }
    // Подсказка обучения перед первым оврагом
    if (!autopilot && st.level === 0 && st.state === 'run') {
      const first = st.world.obstacles[0];
      const fx = first.x - st.dist;
      if (fx > HORSE_X - 40 && fx < W) {
        ctx.fillStyle = 'rgba(6,12,20,0.75)';
        roundRect(fx - 120, GROUND - 210, 250, 64, 14);
        ctx.fill();
        ctx.fillStyle = '#FFD25A';
        ctx.font = '700 20px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Овраг! Прыгай', fx + 5, GROUND - 182);
        ctx.fillStyle = '#E8EEF5';
        ctx.font = '15px system-ui, sans-serif';
        ctx.fillText('Пробел / тап / свайп вверх', fx + 5, GROUND - 159);
        ctx.strokeStyle = '#FFD25A';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(fx + 5, GROUND - 140);
        ctx.lineTo(fx + 5, GROUND - 40);
        ctx.lineTo(fx - 4, GROUND - 52);
        ctx.moveTo(fx + 5, GROUND - 40);
        ctx.lineTo(fx + 14, GROUND - 52);
        ctx.stroke();
      }
    }
    // Монеты
    for (const c of st.world.coins) {
      if (c.got) continue;
      const x = c.x - st.dist;
      if (x < -30 || x > W + 30) continue;
      const sx = Math.abs(Math.cos(st.time * 4 + c.x * 0.01));
      ctx.fillStyle = '#B07800';
      ctx.beginPath();
      ctx.ellipse(x, c.y, 13 * sx + 2, 13, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#FFC21A';
      ctx.beginPath();
      ctx.ellipse(x, c.y, 11 * sx + 1, 11, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.beginPath();
      ctx.ellipse(x - 3 * sx, c.y - 4, 3 * sx, 4, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // Пыль
    for (const p of st.dust) {
      ctx.fillStyle = `rgba(210,190,150,${p.life * 0.6})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * (1.6 - p.life), 0, Math.PI * 2);
      ctx.fill();
    }
    horse(HORSE_X, st.y, P);
    // Ночная виньетка
    if (night > 0) {
      const v = ctx.createRadialGradient(W / 2, H / 2, 200, W / 2, H / 2, 620);
      v.addColorStop(0, 'rgba(0,0,0,0)');
      v.addColorStop(1, `rgba(0,0,10,${0.45 * night})`);
      ctx.fillStyle = v;
      ctx.fillRect(0, 0, W, H);
    }
    ctx.restore();
    if (!autopilot) hud();
  }

  function layer(pts, k, col, spacing, snow) {
    const off = (st.dist * k) % (pts.length * spacing);
    ctx.fillStyle = rgb(col);
    ctx.beginPath();
    ctx.moveTo(-10, GROUND);
    for (let i = 0; i <= pts.length * 2; i++) {
      const x = i * spacing - off;
      if (x > W + spacing) break;
      ctx.lineTo(x, pts[i % pts.length]);
    }
    ctx.lineTo(W + 10, GROUND);
    ctx.fill();
    if (snow) {
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      for (let i = 0; i <= pts.length * 2; i++) {
        const x = i * spacing - off, y = pts[i % pts.length];
        if (x > W + spacing) break;
        if (y < 200) {
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x - 14, y + 18);
          ctx.lineTo(x + 14, y + 18);
          ctx.fill();
        }
      }
    }
  }

  function yurts(k, P) {
    const span = 1400, off = (st.dist * k) % span;
    for (const base of [300, 980]) {
      const x = base - off + (base - off < -100 ? span : 0), y = 372;
      ctx.fillStyle = rgb(mix([240, 232, 214], P.far, st.phaseNow * 0.7));
      ctx.beginPath();
      ctx.moveTo(x - 30, y);
      ctx.lineTo(x - 30, y - 18);
      ctx.quadraticCurveTo(x, y - 46, x + 30, y - 18);
      ctx.lineTo(x + 30, y);
      ctx.fill();
      ctx.fillStyle = rgb(mix([178, 54, 40], P.far, st.phaseNow * 0.6));
      ctx.fillRect(x - 30, y - 16, 60, 4);
      ctx.fillStyle = 'rgba(40,25,15,0.7)';
      ctx.fillRect(x - 6, y - 14, 12, 14);
      if (st.phaseNow > 0.7) {
        ctx.fillStyle = 'rgba(255,190,90,0.8)';
        ctx.fillRect(x - 5, y - 13, 10, 12);
      }
    }
  }

  // Конь с всадником: ноги анимируются по фазе галопа
  function horse(x, y, P) {
    const g = st.gallop, air = !st.onGround;
    const bob = air ? 0 : Math.sin(g * 2) * 3;
    ctx.save();
    ctx.translate(x, y - 4 + bob);
    const tilt = air ? Math.max(-0.25, Math.min(0.25, st.vy / 3200)) : 0;
    ctx.rotate(tilt);
    // Тень
    if (!air || st.y > GROUND - 160) {
      ctx.save();
      ctx.rotate(-tilt);
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      const s = air ? Math.max(0.3, 1 - (GROUND - st.y) / 200) : 1;
      if (!overGap(st.dist + HORSE_X)) {
        ctx.beginPath();
        ctx.ellipse(0, GROUND - y + 4 - bob, 52 * s, 7 * s, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
    const coat = '#7A4A26', coatD = '#4E2E16', mane = '#1E1410';
    const leg = (px, py, ph, back) => {
      const a = air ? (back ? 0.9 : -0.9) : Math.sin(g + ph) * 0.75;
      const b = air ? (back ? -1.2 : 1.1) : Math.max(0, Math.sin(g + ph + 1.4)) * 1.1;
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(a);
      ctx.fillStyle = back ? coatD : coat;
      ctx.fillRect(-5, 0, 10, 26);
      ctx.translate(0, 24);
      ctx.rotate(back ? -b : b);
      ctx.fillRect(-4, 0, 8, 22);
      ctx.fillStyle = '#1A1210';
      ctx.fillRect(-5, 20, 10, 6);
      ctx.restore();
    };
    leg(-30, -44, 0.6, true);
    leg(26, -44, 2.4, true);
    // Хвост
    ctx.strokeStyle = mane;
    ctx.lineWidth = 7;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-46, -62);
    ctx.quadraticCurveTo(-72, -58 + Math.sin(g * 2) * 6, -78, -30 + Math.sin(g * 2 + 1) * 8);
    ctx.stroke();
    // Туловище
    const body = ctx.createLinearGradient(0, -82, 0, -36);
    body.addColorStop(0, '#9A6234');
    body.addColorStop(1, coatD);
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.ellipse(-4, -60, 48, 22, 0, 0, Math.PI * 2);
    ctx.fill();
    // Шея и голова
    ctx.beginPath();
    ctx.moveTo(26, -74);
    ctx.lineTo(48, -108);
    ctx.lineTo(64, -100);
    ctx.lineTo(44, -56);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = coat;
    ctx.beginPath();
    ctx.ellipse(66, -100, 20, 10, 0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = mane;
    ctx.beginPath();
    ctx.moveTo(52, -118);
    ctx.lineTo(56, -128);
    ctx.lineTo(60, -116);
    ctx.fill();
    ctx.fillStyle = '#0D0907';
    ctx.beginPath();
    ctx.arc(64, -104, 2.4, 0, Math.PI * 2);
    ctx.fill();
    // Грива
    ctx.strokeStyle = mane;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(50, -114);
    ctx.quadraticCurveTo(34, -96 + Math.sin(g * 2) * 3, 22, -80);
    ctx.stroke();
    leg(-24, -46, 3.1, false);
    leg(32, -46, 5.0, false);
    // Всадник в красном чапане
    ctx.fillStyle = '#2C3E66';
    ctx.fillRect(-4, -96, 10, 22);
    ctx.fillStyle = '#B5302A';
    ctx.beginPath();
    ctx.moveTo(-12, -78);
    ctx.lineTo(-6, -116);
    ctx.lineTo(14, -116);
    ctx.lineTo(18, -78);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#E2B98A';
    ctx.beginPath();
    ctx.arc(4, -126, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#F2EAD8';
    ctx.beginPath();
    ctx.moveTo(-8, -128);
    ctx.quadraticCurveTo(4, -146, 16, -128);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#B5302A';
    ctx.fillRect(-8, -130, 24, 3);
    ctx.strokeStyle = '#B5302A';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(12, -108);
    ctx.lineTo(34, -96);
    ctx.stroke();
    ctx.restore();
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function panel(title, lines, cta) {
    ctx.fillStyle = 'rgba(4,9,16,0.62)';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(10,20,34,0.92)';
    roundRect(W / 2 - 250, H / 2 - 130, 500, 260, 22);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,210,90,0.5)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.fillStyle = '#FFD25A';
    ctx.font = '800 34px system-ui, sans-serif';
    ctx.fillText(title, W / 2, H / 2 - 66);
    ctx.fillStyle = '#E8EEF5';
    ctx.font = '18px system-ui, sans-serif';
    lines.forEach((l, i) => ctx.fillText(l, W / 2, H / 2 - 22 + i * 28));
    ctx.fillStyle = '#19B3D4';
    ctx.font = '700 18px system-ui, sans-serif';
    ctx.fillText(cta, W / 2, H / 2 + 102);
  }

  function hud() {
    const L = LEVELS[st.level];
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(4,9,16,0.55)';
    roundRect(16, 14, 330, 50, 14);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = '700 17px system-ui, sans-serif';
    ctx.fillText(`Уровень ${st.level + 1}/3 · ${L.name}`, 30, 37);
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.fillRect(30, 46, 300, 6);
    ctx.fillStyle = '#FFC21A';
    ctx.fillRect(30, 46, 300 * Math.min(1, st.dist / st.world.length), 6);
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(4,9,16,0.55)';
    roundRect(W - 190, 14, 174, 50, 14);
    ctx.fill();
    ctx.fillStyle = '#FFC21A';
    ctx.font = '800 20px system-ui, sans-serif';
    ctx.fillText(`● ${st.coins}`, W - 108, 46);
    ctx.fillStyle = '#E8EEF5';
    ctx.font = '600 15px system-ui, sans-serif';
    ctx.fillText(`✕ ${st.deaths}`, W - 32, 45);
    const m = Math.floor(st.playTime / 60), s = Math.floor(st.playTime % 60);
    if (st.state === 'title') panel('Steppe Runner', ['Скачи через степь Казахстана.', 'Перепрыгивай овраги и камни, собирай монеты.', 'Три уровня: утро, закат и ночь.'], 'Нажмите пробел или коснитесь экрана');
    if (st.state === 'dead') panel(st.deathReason === 'rock' ? 'Споткнулись о камень' : 'Упали в овраг', [`Уровень ${st.level + 1} начнётся заново.`, `Монеты этого уровня сгорели. Попыток: ${st.deaths}`], 'Пробел / тап — ещё раз');
    if (st.state === 'cleared') panel(`Уровень ${st.level + 1} пройден!`, [`Монет собрано: ${st.coins}`, `Время в игре: ${m}:${String(s).padStart(2, '0')}`], st.level < 2 ? 'Пробел / тап — следующий уровень' : 'Пробел / тап — итоги');
    if (st.state === 'done') panel('Степь пройдена!', [`Монеты: ${st.coins} · Падений: ${st.deaths}`, `Время: ${m}:${String(s).padStart(2, '0')}`, 'Итоги теста — под игрой'], 'Спасибо за тест!');
    if (st.state === 'paused') panel('Пауза', ['Игра остановлена.'], 'P или Esc — продолжить');
  }

  let raf = 0, last = performance.now(), running = true;
  function loop(t) {
    const dt = Math.min(0.033, (t - last) / 1000);
    last = t;
    if (st.state !== 'paused') update(dt);
    draw();
    if (running) raf = requestAnimationFrame(loop);
  }
  raf = requestAnimationFrame(loop);

  return {
    jump,
    pause() {
      if (st.state === 'run') st.state = 'paused';
      else if (st.state === 'paused') st.state = 'run';
    },
    get state() {
      return st.state;
    },
    stats: () => ({ level: st.level + 1, coins: st.coins, deaths: st.deaths, time: st.playTime, jumps: st.jumps, state: st.state }),
    snapshot: () => canvas.toDataURL('image/jpeg', 0.82),
    destroy() {
      running = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
    },
  };
}
