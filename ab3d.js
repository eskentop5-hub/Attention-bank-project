// AB3D v2 — 3D-движок ATTENTION BANK на чистом WebGL (без библиотек).
// Реализм: PBR-освещение (металличность/шероховатость, GGX, френель Шлика), отражения
// процедурного студийного окружения, тени от ключевого света (shadow map + PCF) на объект
// и на «подиум», тон-маппинг ACES, гамма-коррекция.
// Управление: орбита с затуханием (мышь, тач, щипок, колесо, клавиатура), авто-вращение
// с паузой при взаимодействии, парение, салют золотых кристаллов.
// Один WebGL-контекст на страницу: каждая витрина рисуется в свою область (scissor).

const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const SHADOW_SIZE = 1024;

// ---------------- Матрицы 4×4 (column-major) ----------------
const M = {
  ident: () => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
  mul(a, b) {
    const o = new Float32Array(16);
    for (let c = 0; c < 4; c++)
      for (let r = 0; r < 4; r++) {
        let s = 0;
        for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
        o[c * 4 + r] = s;
      }
    return o;
  },
  persp(fovDeg, aspect, near, far) {
    const f = 1 / Math.tan((fovDeg * Math.PI) / 360);
    const nf = 1 / (near - far);
    return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
  },
  ortho(l, r, b, t, n, f) {
    return new Float32Array([2 / (r - l), 0, 0, 0, 0, 2 / (t - b), 0, 0, 0, 0, -2 / (f - n), 0, -(r + l) / (r - l), -(t + b) / (t - b), -(f + n) / (f - n), 1]);
  },
  lookAt(e, t, u) {
    let zx = e[0] - t[0], zy = e[1] - t[1], zz = e[2] - t[2];
    let l = Math.hypot(zx, zy, zz);
    zx /= l; zy /= l; zz /= l;
    let xx = u[1] * zz - u[2] * zy, xy = u[2] * zx - u[0] * zz, xz = u[0] * zy - u[1] * zx;
    l = Math.hypot(xx, xy, xz);
    xx /= l; xy /= l; xz /= l;
    const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
    return new Float32Array([
      xx, yx, zx, 0, xy, yy, zy, 0, xz, yz, zz, 0,
      -(xx * e[0] + xy * e[1] + xz * e[2]), -(yx * e[0] + yy * e[1] + yz * e[2]), -(zx * e[0] + zy * e[1] + zz * e[2]), 1,
    ]);
  },
  trans: (x, y, z) => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]),
  scale: (s) => new Float32Array([s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, 0, 0, 0, 1]),
  rotX(a) { const c = Math.cos(a), s = Math.sin(a); return new Float32Array([1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]); },
  rotY(a) { const c = Math.cos(a), s = Math.sin(a); return new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]); },
  rotZ(a) { const c = Math.cos(a), s = Math.sin(a); return new Float32Array([c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]); },
  chain: (...ms) => ms.reduce((a, b) => M.mul(a, b)),
  normal3(m) {
    const s = Math.hypot(m[0], m[1], m[2]) || 1;
    return new Float32Array([m[0] / s, m[1] / s, m[2] / s, m[4] / s, m[5] / s, m[6] / s, m[8] / s, m[9] / s, m[10] / s]);
  },
};
const tp = (m, p) => [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]];
const tn = (m, n) => {
  const x = m[0] * n[0] + m[4] * n[1] + m[8] * n[2], y = m[1] * n[0] + m[5] * n[1] + m[9] * n[2], z = m[2] * n[0] + m[6] * n[1] + m[10] * n[2];
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
};
const hex = (h) => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];

// Материалы: цвет (sRGB), металличность, шероховатость
const MAT = {
  // Палитра советского космического плаката: солнечно-жёлтый, красно-оранжевый, кремовый, бирюза
  gold: { c: hex('#F5C21B'), metal: 1, rough: 0.22 },
  goldPale: { c: hex('#FFDD6E'), metal: 1, rough: 0.3 },
  skyMetal: { c: hex('#3E9C9E'), metal: 0.85, rough: 0.25 },
  gemSky: { c: hex('#7FD3CF'), metal: 0.35, rough: 0.05 },
  gemMint: { c: hex('#9AD88F'), metal: 0.35, rough: 0.05 },
  gemGold: { c: hex('#FFC21A'), metal: 0.45, rough: 0.05 },
  gemCoral: { c: hex('#F0643C'), metal: 0.35, rough: 0.05 },
  diamond: { c: hex('#F6EEDC'), metal: 0.25, rough: 0.03 },
  navyPlastic: { c: hex('#1C2A30'), metal: 0, rough: 0.4 },
  tealPlastic: { c: hex('#2F7E80'), metal: 0, rough: 0.35 },
  skyPlastic: { c: hex('#4FA9A6'), metal: 0, rough: 0.32 },
  red: { c: hex('#E0502C'), metal: 0.05, rough: 0.35 },
  redMetal: { c: hex('#D9452A'), metal: 0.7, rough: 0.28 },
  steel: { c: hex('#B9B4AA'), metal: 1, rough: 0.3 },
  cream: { c: hex('#FFF4D6'), metal: 0.1, rough: 0.3 },
  silver: { c: hex('#D9E1E8'), metal: 1, rough: 0.18 },
  ribbonSky: { c: hex('#2F7E80'), metal: 0, rough: 0.75 },
  ribbonCoral: { c: hex('#E5573C'), metal: 0, rough: 0.75 },
  black: { c: hex('#0C1118'), metal: 0.1, rough: 0.25 },
  white: { c: hex('#F3E8D2'), metal: 0, rough: 0.32 },
  screen: { c: hex('#10302F'), metal: 0.3, rough: 0.06 },
  coral: { c: hex('#E0502C'), metal: 0, rough: 0.3 },
  mint: { c: hex('#7FC77A'), metal: 0, rough: 0.3 },
  violet: { c: hex('#E8A07A'), metal: 0, rough: 0.3 },
  wood: { c: hex('#6B4426'), metal: 0, rough: 0.6 },
};

// ---------------- Геометрия ----------------
class Geo {
  constructor() {
    this.pos = [];
    this.nor = [];
    this.col = [];
    this.mat = [];
  }
  tri(a, b, c, mt, na, nb, nc) {
    if (!na) {
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const l = Math.hypot(...n) || 1;
      n = [n[0] / l, n[1] / l, n[2] / l];
      na = nb = nc = n;
    }
    this.pos.push(...a, ...b, ...c);
    this.nor.push(...na, ...nb, ...nc);
    for (let i = 0; i < 3; i++) {
      this.col.push(...mt.c);
      this.mat.push(mt.metal, mt.rough);
    }
  }
  quad(a, b, c, d, mt) {
    this.tri(a, b, c, mt);
    this.tri(a, c, d, mt);
  }
  // Огранённый камень: площадка → корона → рундист → павильон (бриллиантовая огранка)
  crystal(m, mt, { sides = 12, r = 0.5, crown = 0.2, table = 0.56, pavilion = 0.6 } = {}) {
    const ring = (rad, y, off = 0) => Array.from({ length: sides }, (_, i) => {
      const a = (i / sides) * Math.PI * 2 + off;
      return tp(m, [Math.cos(a) * rad, y, Math.sin(a) * rad]);
    });
    const top = ring(r * table, crown, Math.PI / sides);
    const mid = ring(r * 0.86, crown * 0.45, 0);
    const girdle = ring(r, 0, Math.PI / sides);
    const pav = ring(r * 0.45, -pavilion * 0.55, 0);
    const center = tp(m, [0, crown, 0]), tip = tp(m, [0, -pavilion, 0]);
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides;
      this.tri(center, top[j], top[i], mt);
      this.tri(top[i], top[j], mid[j], mt);
      this.tri(top[i], mid[j], mid[i], mt);
      this.tri(mid[i], mid[j], girdle[j], mt);
      this.tri(mid[i], girdle[j], girdle[i], mt);
      this.tri(girdle[i], girdle[j], pav[j], mt);
      this.tri(girdle[i], pav[j], pav[i], mt);
      this.tri(pav[i], pav[j], tip, mt);
    }
  }
  // Тело вращения по профилю [[радиус, высота], ...] вокруг оси Y — для ракеты, сопел, антенн
  lathe(m, mt, prof, seg = 64) {
    const nrm = prof.map((p, i) => {
      const a = prof[Math.max(0, i - 1)], b = prof[Math.min(prof.length - 1, i + 1)];
      const dy = b[1] - a[1], dr = b[0] - a[0];
      const l = Math.hypot(dy, dr) || 1;
      const n = [dy / l, -dr / l];
      return n[0] < -0.01 ? [-n[0], -n[1]] : n;
    });
    for (let i = 0; i < seg; i++) {
      const u0 = (i / seg) * 2 * Math.PI, u1 = ((i + 1) / seg) * 2 * Math.PI;
      for (let j = 0; j < prof.length - 1; j++) {
        const P = (u, k) => tp(m, [Math.cos(u) * prof[k][0], prof[k][1], Math.sin(u) * prof[k][0]]);
        const N = (u, k) => tn(m, [Math.cos(u) * nrm[k][0], nrm[k][1], Math.sin(u) * nrm[k][0]]);
        this.tri(P(u0, j), P(u1, j + 1), P(u1, j), mt, N(u0, j), N(u1, j + 1), N(u1, j));
        this.tri(P(u0, j), P(u0, j + 1), P(u1, j + 1), mt, N(u0, j), N(u0, j + 1), N(u1, j + 1));
      }
    }
  }
  sphere(m, mt, { r = 0.5, su = 32, sv = 18 } = {}) {
    const P = (u, v) => [r * Math.sin(v) * Math.cos(u), r * Math.cos(v), r * Math.sin(v) * Math.sin(u)];
    const N = (u, v) => [Math.sin(v) * Math.cos(u), Math.cos(v), Math.sin(v) * Math.sin(u)];
    for (let i = 0; i < su; i++)
      for (let j = 0; j < sv; j++) {
        const u0 = (i / su) * 2 * Math.PI, u1 = ((i + 1) / su) * 2 * Math.PI, v0 = (j / sv) * Math.PI, v1 = ((j + 1) / sv) * Math.PI;
        const a = tp(m, P(u0, v0)), b = tp(m, P(u1, v0)), c = tp(m, P(u1, v1)), d = tp(m, P(u0, v1));
        const na = tn(m, N(u0, v0)), nb = tn(m, N(u1, v0)), nc = tn(m, N(u1, v1)), nd = tn(m, N(u0, v1));
        this.tri(a, c, b, mt, na, nc, nb);
        this.tri(a, d, c, mt, na, nd, nc);
      }
  }
  torus(m, mt, { R = 0.6, r = 0.12, su = 96, sv = 28, arc = 1 } = {}) {
    const P = (u, v) => [(R + r * Math.cos(v)) * Math.cos(u), (R + r * Math.cos(v)) * Math.sin(u), r * Math.sin(v)];
    const N = (u, v) => [Math.cos(v) * Math.cos(u), Math.cos(v) * Math.sin(u), Math.sin(v)];
    for (let i = 0; i < su; i++)
      for (let j = 0; j < sv; j++) {
        const u0 = (i / su) * 2 * Math.PI * arc, u1 = ((i + 1) / su) * 2 * Math.PI * arc, v0 = (j / sv) * 2 * Math.PI, v1 = ((j + 1) / sv) * 2 * Math.PI;
        const a = tp(m, P(u0, v0)), b = tp(m, P(u1, v0)), c = tp(m, P(u1, v1)), d = tp(m, P(u0, v1));
        const na = tn(m, N(u0, v0)), nb = tn(m, N(u1, v0)), nc = tn(m, N(u1, v1)), nd = tn(m, N(u0, v1));
        this.tri(a, b, c, mt, na, nb, nc);
        this.tri(a, c, d, mt, na, nc, nd);
      }
  }
  // Брусок со скруглёнными рёбрами (фаска) — выглядит как обработанный металл, а не «коробка»
  bevelBox(m, mt, w, h, d, bev = 0.025) {
    const x = w / 2, y = h / 2, z = d / 2, b = Math.min(bev, x * 0.4, y * 0.4, z * 0.4);
    const X = x - b, Y = y - b, Z = z - b;
    const faces = [
      [[-X, -Y, z], [X, -Y, z], [X, Y, z], [-X, Y, z]], [[X, -Y, -z], [-X, -Y, -z], [-X, Y, -z], [X, Y, -z]],
      [[-x, -Y, -Z], [-x, -Y, Z], [-x, Y, Z], [-x, Y, -Z]], [[x, -Y, Z], [x, -Y, -Z], [x, Y, -Z], [x, Y, Z]],
      [[-X, y, Z], [X, y, Z], [X, y, -Z], [-X, y, -Z]], [[-X, -y, -Z], [X, -y, -Z], [X, -y, Z], [-X, -y, Z]],
    ];
    for (const f of faces) this.quad(...f.map((p) => tp(m, p)), mt);
    // Фаски вдоль рёбер
    const edges = [
      [[-X, y, Z], [X, y, Z], [X, Y, z], [-X, Y, z]], [[X, y, -Z], [-X, y, -Z], [-X, Y, -z], [X, Y, -z]],
      [[X, -y, Z], [-X, -y, Z], [-X, -Y, z], [X, -Y, z]], [[-X, -y, -Z], [X, -y, -Z], [X, -Y, -z], [-X, -Y, -z]],
      [[x, Y, Z], [x, -Y, Z], [X, -Y, z], [X, Y, z]], [[-x, -Y, Z], [-x, Y, Z], [-X, Y, z], [-X, -Y, z]],
      [[x, -Y, -Z], [x, Y, -Z], [X, Y, -z], [X, -Y, -z]], [[-x, Y, -Z], [-x, -Y, -Z], [-X, -Y, -z], [-X, Y, -z]],
      [[X, y, Z], [X, y, -Z], [x, Y, -Z], [x, Y, Z]], [[-X, y, -Z], [-X, y, Z], [-x, Y, Z], [-x, Y, -Z]],
      [[X, -y, -Z], [X, -y, Z], [x, -Y, Z], [x, -Y, -Z]], [[-X, -y, Z], [-X, -y, -Z], [-x, -Y, -Z], [-x, -Y, Z]],
    ];
    for (const e of edges) this.quad(...e.map((p) => tp(m, p)), mt);
  }
  // Цилиндр вдоль оси Z (лицевая сторона к камере) с фаской по краю
  cylinder(m, mt, { r = 0.5, h = 0.1, seg = 72, capMat = mt } = {}) {
    const bev = h * 0.3;
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * 2 * Math.PI, a1 = ((i + 1) / seg) * 2 * Math.PI;
      const p = (a, rr, z) => tp(m, [Math.cos(a) * rr, Math.sin(a) * rr, z]);
      const n = (a, nz = 0) => tn(m, [Math.cos(a), Math.sin(a), nz]);
      const z1 = h / 2 - bev, z2 = -h / 2 + bev, ri = r - bev;
      this.tri(p(a0, r, z1), p(a0, r, z2), p(a1, r, z2), mt, n(a0), n(a0), n(a1));
      this.tri(p(a0, r, z1), p(a1, r, z2), p(a1, r, z1), mt, n(a0), n(a1), n(a1));
      this.tri(p(a0, ri, h / 2), p(a0, r, z1), p(a1, r, z1), mt, n(a0, 1), n(a0, 0.3), n(a1, 0.3));
      this.tri(p(a0, ri, h / 2), p(a1, r, z1), p(a1, ri, h / 2), mt, n(a0, 1), n(a1, 0.3), n(a1, 1));
      this.tri(p(a0, r, z2), p(a0, ri, -h / 2), p(a1, ri, -h / 2), mt, n(a0, -0.3), n(a0, -1), n(a1, -1));
      this.tri(p(a0, r, z2), p(a1, ri, -h / 2), p(a1, r, z2), mt, n(a0, -0.3), n(a1, -1), n(a1, -0.3));
      this.tri(tp(m, [0, 0, h / 2]), p(a0, ri, h / 2), p(a1, ri, h / 2), capMat);
      this.tri(tp(m, [0, 0, -h / 2]), p(a1, ri, -h / 2), p(a0, ri, -h / 2), capMat);
    }
  }
  // Пятиконечная звезда с объёмными гранями (как чеканка)
  star(m, mt, { r = 0.36, inner = 0.15, h = 0.08 } = {}) {
    const pts = Array.from({ length: 10 }, (_, i) => {
      const a = Math.PI / 2 + (i * Math.PI) / 5, rad = i % 2 ? inner : r;
      return [Math.cos(a) * rad, Math.sin(a) * rad];
    });
    const apex = tp(m, [0, 0, h]), base = tp(m, [0, 0, 0]);
    for (let i = 0; i < 10; i++) {
      const j = (i + 1) % 10;
      const p = tp(m, [pts[i][0], pts[i][1], 0]), q = tp(m, [pts[j][0], pts[j][1], 0]);
      this.tri(apex, p, q, mt);
      this.tri(base, q, p, mt);
    }
  }
  // Диск «подиума» для теней (в плоскости XZ)
  disc(r = 2.4, seg = 64) {
    const mt = { c: [0, 0, 0], metal: 0, rough: 1 };
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * 2 * Math.PI, a1 = ((i + 1) / seg) * 2 * Math.PI;
      const up = [0, 1, 0];
      this.tri([0, 0, 0], [Math.cos(a1) * r, 0, Math.sin(a1) * r], [Math.cos(a0) * r, 0, Math.sin(a0) * r], mt, up, up, up);
    }
  }
}

// ---------------- Модели ----------------
const GEMS = [MAT.gemSky, MAT.gemMint, MAT.gemGold, MAT.gemCoral];

export const MODELS = {
  // Знак ATTENTION BANK: металлическое бирюзовое кольцо «внимания» сцеплено с золотым кольцом «ценности»
  logo() {
    const g = new Geo();
    g.torus(M.chain(M.trans(-0.42, 0, 0), M.rotY(0.25)), MAT.skyMetal, { R: 0.72, r: 0.15 });
    g.torus(M.chain(M.trans(0.42, 0, 0), M.rotX(Math.PI / 2), M.rotY(-0.25)), MAT.gold, { R: 0.72, r: 0.15 });
    g.crystal(M.scale(0.42), MAT.diamond, { sides: 16 });
    return { geo: g, size: 1.3 };
  },
  // Ранний доступ: ключ из полированного золота с камнем в ушке
  game_access(v = 0) {
    const g = new Geo();
    const mt = v % 2 ? MAT.goldPale : MAT.gold;
    g.torus(M.trans(-0.62, 0, 0), mt, { R: 0.3, r: 0.09, su: 72, sv: 22 });
    g.bevelBox(M.trans(0.12, 0, 0), mt, 1.12, 0.13, 0.13, 0.03);
    g.bevelBox(M.trans(0.5, -0.16, 0), mt, 0.12, 0.24, 0.12, 0.025);
    g.bevelBox(M.trans(0.66, -0.12, 0), mt, 0.1, 0.16, 0.12, 0.025);
    g.bevelBox(M.trans(-0.27, 0, 0), mt, 0.07, 0.22, 0.2, 0.02);
    g.crystal(M.chain(M.trans(-0.62, 0, 0), M.rotX(Math.PI / 2), M.scale(0.24)), MAT.gemSky, { sides: 12 });
    return { geo: g, size: 1.05 };
  },
  // Внутриигровые предметы: связка огранённых камней
  in_game(v = 0) {
    const g = new Geo();
    const a = GEMS[v % 4], b = GEMS[(v + 1) % 4], c = GEMS[(v + 2) % 4];
    g.crystal(M.chain(M.trans(0, 0.12, 0), M.scale(0.95)), a, { sides: 16 });
    g.crystal(M.chain(M.trans(-0.64, -0.24, 0.18), M.rotZ(0.35), M.scale(0.5)), b, { sides: 12 });
    g.crystal(M.chain(M.trans(0.62, -0.28, -0.12), M.rotZ(-0.3), M.scale(0.45)), c, { sides: 12 });
    return { geo: g, size: 1.12 };
  },
  // Подписки и сервисы: карта-пропуск с металлическим чипом
  subscription(v = 0) {
    const g = new Geo();
    g.bevelBox(M.ident(), v % 2 ? MAT.tealPlastic : MAT.navyPlastic, 1.6, 1.0, 0.06, 0.03);
    g.bevelBox(M.trans(0, 0.25, 0.035), MAT.skyPlastic, 1.56, 0.15, 0.012, 0.004);
    g.bevelBox(M.trans(-0.5, -0.1, 0.04), MAT.gold, 0.28, 0.21, 0.02, 0.01);
    g.bevelBox(M.trans(-0.5, -0.1, 0.052), MAT.goldPale, 0.12, 0.21, 0.004, 0.002);
    g.bevelBox(M.trans(0.22, -0.3, 0.036), MAT.silver, 0.8, 0.05, 0.01, 0.004);
    g.crystal(M.chain(M.trans(0.55, -0.04, 0.07), M.rotX(Math.PI / 2), M.scale(0.18)), MAT.gemGold, { sides: 12 });
    return { geo: g, size: 1.0 };
  },
  // Признание: медаль с чеканной звездой и лентами
  recognition(v = 0) {
    const g = new Geo();
    const rib = v % 2 ? MAT.ribbonCoral : MAT.ribbonSky;
    g.bevelBox(M.chain(M.trans(-0.2, 0.62, -0.05), M.rotZ(0.35)), rib, 0.26, 0.72, 0.025, 0.008);
    g.bevelBox(M.chain(M.trans(0.2, 0.62, -0.05), M.rotZ(-0.35)), rib, 0.26, 0.72, 0.025, 0.008);
    g.cylinder(M.ident(), MAT.gold, { r: 0.5, h: 0.12 });
    g.torus(M.trans(0, 0, 0.0), MAT.goldPale, { R: 0.47, r: 0.045, su: 72, sv: 14 });
    g.star(M.trans(0, 0, 0.06), MAT.cream, { r: 0.32, inner: 0.14, h: 0.07 });
    return { geo: g, size: 1.3 };
  },
  // Коробка ПК-игры с диском (ключи Steam / Epic): цвет обложки зависит от платформы
  game_box(v = 0) {
    const g = new Geo();
    const epic = v % 2 === 1;
    g.bevelBox(M.ident(), epic ? MAT.black : MAT.navyPlastic, 1.0, 1.3, 0.16, 0.03);
    g.bevelBox(M.trans(0, -0.06, 0.082), epic ? MAT.white : MAT.skyPlastic, 0.86, 0.98, 0.012, 0.006);
    g.bevelBox(M.trans(0, 0.53, 0.082), MAT.gold, 0.86, 0.1, 0.014, 0.006);
    g.crystal(M.chain(M.trans(0, -0.05, 0.12), M.rotX(Math.PI / 2), M.scale(0.32)), MAT.gemGold, { sides: 12 });
    g.cylinder(M.chain(M.trans(0.42, 0.05, -0.02), M.rotY(0.0)), MAT.silver, { r: 0.46, h: 0.02, seg: 64, capMat: MAT.silver });
    g.torus(M.trans(0.42, 0.05, -0.0), MAT.goldPale, { R: 0.13, r: 0.025, su: 40, sv: 10 });
    return { geo: g, size: 1.15 };
  },
  // Смартфон с сеткой иконок (ранний доступ в Google Play / App Store)
  phone(v = 0) {
    const g = new Geo();
    g.bevelBox(M.ident(), v % 2 ? MAT.white : MAT.black, 0.78, 1.52, 0.09, 0.04);
    g.bevelBox(M.trans(0, 0, 0.047), MAT.screen, 0.7, 1.42, 0.006, 0.003);
    const cols = [MAT.gemGold, MAT.coral, MAT.mint, MAT.skyPlastic, MAT.violet, MAT.gemSky];
    for (let i = 0; i < 6; i++) g.bevelBox(M.trans(-0.2 + (i % 3) * 0.2, 0.42 - Math.floor(i / 3) * 0.22, 0.056), cols[(i + v) % 6], 0.14, 0.14, 0.02, 0.02);
    g.crystal(M.chain(M.trans(0, -0.2, 0.1), M.rotX(Math.PI / 2), M.scale(0.34)), MAT.gemGold, { sides: 14 });
    g.cylinder(M.trans(0, 0.66, 0.05), MAT.black, { r: 0.025, h: 0.01, seg: 20 });
    return { geo: g, size: 1.15 };
  },
  // Подкова на удачу — скин коня «Тулпар»
  horseshoe() {
    const g = new Geo();
    g.torus(M.chain(M.rotZ(-Math.PI * 0.12 + Math.PI)), MAT.silver, { R: 0.55, r: 0.13, su: 72, sv: 22, arc: 0.62 });
    for (let i = 0; i < 6; i++) {
      const a = Math.PI + (-Math.PI * 0.12) + (i + 0.5) * ((Math.PI * 2 * 0.62) / 6);
      g.crystal(M.chain(M.trans(Math.cos(a) * 0.55, Math.sin(a) * 0.55, 0.12), M.rotX(Math.PI / 2), M.scale(0.1)), MAT.gemSky, { sides: 8 });
    }
    g.crystal(M.chain(M.trans(0, 0.15, 0), M.rotX(0.3), M.scale(0.42)), MAT.gemGold, { sides: 14 });
    return { geo: g, size: 1.05 };
  },
  // Облачко чата с тремя точками — закрытый чат с разработчиками
  chat() {
    const g = new Geo();
    g.bevelBox(M.ident(), MAT.skyPlastic, 1.5, 0.95, 0.3, 0.14);
    g.bevelBox(M.chain(M.trans(-0.42, -0.55, 0), M.rotZ(0.7)), MAT.skyPlastic, 0.3, 0.3, 0.3, 0.08);
    for (let i = 0; i < 3; i++) g.sphere(M.trans(-0.36 + i * 0.36, 0, 0.17), MAT.white, { r: 0.1, su: 20, sv: 12 });
    return { geo: g, size: 1.15 };
  },
  // Кинохлопушка — имя в титрах
  clapper() {
    const g = new Geo();
    g.bevelBox(M.ident(), MAT.black, 1.4, 0.95, 0.1, 0.02);
    for (let i = 0; i < 5; i++) g.bevelBox(M.trans(-0.56 + i * 0.28, 0.56, 0), i % 2 ? MAT.white : MAT.black, 0.28, 0.17, 0.1, 0.01);
    g.bevelBox(M.chain(M.trans(-0.08, 0.84, 0), M.rotZ(0.22)), MAT.black, 1.45, 0.17, 0.1, 0.02);
    for (let i = 0; i < 5; i++) g.bevelBox(M.chain(M.trans(-0.08, 0.84, 0.055), M.rotZ(0.22), M.trans(-0.56 + i * 0.28, 0, 0)), i % 2 ? MAT.gold : MAT.white, 0.16, 0.13, 0.01, 0.004);
    g.bevelBox(M.trans(0, -0.05, 0.055), MAT.white, 1.1, 0.03, 0.01, 0.003);
    g.bevelBox(M.trans(0, -0.25, 0.055), MAT.white, 1.1, 0.03, 0.01, 0.003);
    g.star(M.trans(0.45, 0.2, 0.055), MAT.gold, { r: 0.13, inner: 0.055, h: 0.04 });
    return { geo: g, size: 1.2 };
  },
  // Монета AB Points с выпуклым знаком (два кольца)
  coin() {
    const g = new Geo();
    g.cylinder(M.ident(), MAT.gold, { r: 0.62, h: 0.14, seg: 80 });
    g.torus(M.trans(0, 0, 0), MAT.goldPale, { R: 0.6, r: 0.05, su: 80, sv: 12 });
    g.torus(M.trans(-0.13, 0, 0.075), MAT.skyMetal, { R: 0.22, r: 0.045, su: 48, sv: 12 });
    g.torus(M.trans(0.13, 0, 0.075), MAT.goldPale, { R: 0.22, r: 0.045, su: 48, sv: 12 });
    for (let i = 0; i < 90; i++) {
      const a = (i / 90) * Math.PI * 2;
      g.bevelBox(M.chain(M.rotZ(a), M.trans(0.625, 0, 0)), MAT.goldPale, 0.02, 0.018, 0.12, 0.004);
    }
    for (let i = 0; i < 5; i++) g.star(M.chain(M.rotZ((i / 5) * Math.PI * 2 + Math.PI / 2), M.trans(0, 0.46, 0.07), M.scale(0.25)), MAT.skyMetal, { r: 0.3, inner: 0.13, h: 0.12 });
    return { geo: g, size: 1.2 };
  },
  // Геймпад
  gamepad() {
    const g = new Geo();
    g.bevelBox(M.ident(), MAT.navyPlastic, 1.1, 0.62, 0.3, 0.13);
    g.sphere(M.chain(M.trans(-0.55, -0.15, 0), M.scale(1)), MAT.navyPlastic, { r: 0.33 });
    g.sphere(M.chain(M.trans(0.55, -0.15, 0), M.scale(1)), MAT.navyPlastic, { r: 0.33 });
    g.bevelBox(M.trans(-0.5, 0.02, 0.16), MAT.black, 0.3, 0.09, 0.06, 0.02);
    g.bevelBox(M.trans(-0.5, 0.02, 0.16), MAT.black, 0.09, 0.3, 0.06, 0.02);
    const btn = [[0.5, 0.13, MAT.mint], [0.62, 0.02, MAT.coral], [0.38, 0.02, MAT.skyPlastic], [0.5, -0.09, MAT.gemGold]];
    for (const [x, y, mt] of btn) g.sphere(M.trans(x, y, 0.16), mt, { r: 0.055, su: 18, sv: 10 });
    g.cylinder(M.trans(-0.2, -0.17, 0.15), MAT.black, { r: 0.1, h: 0.08, seg: 28 });
    g.cylinder(M.trans(0.2, -0.17, 0.15), MAT.black, { r: 0.1, h: 0.08, seg: 28 });
    g.bevelBox(M.trans(0, 0.12, 0.16), MAT.gold, 0.16, 0.05, 0.02, 0.01);
    return { geo: g, size: 1.3 };
  },
  // Кубок
  trophy() {
    const g = new Geo();
    g.cylinder(M.chain(M.trans(0, 0.3, 0), M.rotX(Math.PI / 2)), MAT.gold, { r: 0.42, h: 0.6, seg: 64 });
    g.torus(M.chain(M.trans(-0.48, 0.32, 0), M.rotY(Math.PI / 2)), MAT.gold, { R: 0.16, r: 0.04, su: 40, sv: 10 });
    g.torus(M.chain(M.trans(0.48, 0.32, 0), M.rotY(Math.PI / 2)), MAT.gold, { R: 0.16, r: 0.04, su: 40, sv: 10 });
    g.cylinder(M.chain(M.trans(0, -0.18, 0), M.rotX(Math.PI / 2)), MAT.goldPale, { r: 0.08, h: 0.38, seg: 24 });
    g.bevelBox(M.trans(0, -0.45, 0), MAT.wood, 0.7, 0.18, 0.45, 0.03);
    g.bevelBox(M.trans(0, -0.45, 0.228), MAT.goldPale, 0.4, 0.08, 0.008, 0.003);
    g.star(M.trans(0, 0.32, 0.42), MAT.cream, { r: 0.17, inner: 0.07, h: 0.05 });
    return { geo: g, size: 1.2 };
  },
  // Ретро-ракета: обтекатель, полосы, иллюминаторы, стабилизаторы, сопло
  rocket() {
    const g = new Geo();
    const S = M.scale(0.62);
    const body = [[0.0, 1.6], [0.12, 1.5], [0.24, 1.3], [0.33, 1.05], [0.38, 0.8], [0.4, 0.5], [0.4, 0.1], [0.38, -0.3], [0.33, -0.6], [0.26, -0.78]];
    g.lathe(S, MAT.red, body.slice(0, 4), 72);
    g.lathe(S, MAT.white, body.slice(3, 8), 72);
    g.lathe(S, MAT.red, body.slice(7), 72);
    g.lathe(M.chain(S, M.trans(0, 0.3, 0)), MAT.gold, [[0.405, 0.04], [0.405, -0.04]], 72);
    g.lathe(M.chain(S, M.trans(0, -0.1, 0)), MAT.gold, [[0.405, 0.03], [0.405, -0.03]], 72);
    g.lathe(S, MAT.steel, [[0.26, -0.78], [0.22, -0.84], [0.25, -0.98], [0.3, -1.06], [0.18, -1.06]], 48);
    for (let k = 0; k < 3; k++) {
      const y = 0.95 - k * 0.32, ry = (k - 1) * 0.0;
      g.torus(M.chain(S, M.rotY(ry), M.trans(0, y, 0.385 - k * 0.006)), MAT.gold, { R: 0.085, r: 0.022, su: 40, sv: 10 });
      g.sphere(M.chain(S, M.trans(0, y, 0.37 - k * 0.006), M.scale(1)), MAT.screen, { r: 0.075, su: 24, sv: 12 });
    }
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
      g.bevelBox(M.chain(S, M.rotY(a), M.trans(0, -0.55, 0.52), M.rotX(-0.25)), MAT.red, 0.05, 0.62, 0.34, 0.015);
      g.bevelBox(M.chain(S, M.rotY(a), M.trans(0, -0.84, 0.62)), MAT.gold, 0.06, 0.06, 0.16, 0.012);
    }
    g.crystal(M.chain(S, M.trans(0, -1.25, 0), M.rotZ(Math.PI), M.scale(0.3)), MAT.gemGold, { sides: 10, crown: 0.1, table: 0.4, pavilion: 1.0 });
    return { geo: g, size: 1.2 };
  },
  // Спутник: полированная сфера, шов, четыре антенны
  sputnik() {
    const g = new Geo();
    g.sphere(M.ident(), MAT.steel, { r: 0.42, su: 48, sv: 28 });
    g.torus(M.rotX(Math.PI / 2), MAT.gold, { R: 0.42, r: 0.018, su: 72, sv: 10 });
    for (let k = 0; k < 4; k++) {
      const yaw = (k / 4) * Math.PI * 2 + 0.4, tilt = 1.0 + (k % 2) * 0.2;
      const base = M.chain(M.rotY(yaw), M.rotZ(-tilt));
      g.lathe(M.chain(base, M.trans(0, 0.38, 0)), MAT.steel, [[0.03, 0], [0.018, 0.05], [0.012, 0.8], [0.006, 0.84]], 16);
      g.sphere(M.chain(base, M.trans(0, 0.4, 0)), MAT.gold, { r: 0.045, su: 16, sv: 10 });
    }
    g.torus(M.trans(0, 0.05, 0.41), MAT.gold, { R: 0.08, r: 0.02, su: 40, sv: 10 });
    return { geo: g, size: 1.15 };
  },
  // Планета с кольцом: полосы атмосферы и наклонное кольцо
  planet() {
    const g = new Geo();
    const bands = [MAT.white, MAT.gold, MAT.red, MAT.gold, MAT.white, MAT.skyPlastic];
    const R = 0.55, n = bands.length;
    for (let b = 0; b < n; b++) {
      const v0 = (b / n) * Math.PI, v1 = ((b + 1) / n) * Math.PI;
      const prof = Array.from({ length: 7 }, (_, i) => {
        const v = v0 + ((v1 - v0) * i) / 6;
        return [Math.sin(v) * R, Math.cos(v) * R];
      });
      g.lathe(M.rotZ(0.18), { ...bands[b], rough: 0.5, metal: 0 }, prof, 64);
    }
    g.lathe(M.chain(M.rotZ(0.18), M.rotX(0.32)), { c: hex('#F3E8D2'), metal: 0.2, rough: 0.4 }, [[0.75, 0.01], [1.05, 0.0], [1.06, -0.01], [0.74, -0.005], [0.75, 0.01]], 96);
    g.lathe(M.chain(M.rotZ(0.18), M.rotX(0.32)), MAT.red, [[1.08, 0.006], [1.18, 0], [1.08, -0.006], [1.08, 0.006]], 96);
    g.sphere(M.trans(1.1, 0.55, 0.1), MAT.skyPlastic, { r: 0.09, su: 20, sv: 12 });
    return { geo: g, size: 1.35 };
  },
  shard() {
    const g = new Geo();
    g.crystal(M.scale(0.09), MAT.gemGold, { sides: 6, crown: 0.3, table: 0.4, pavilion: 0.6 });
    return { geo: g, size: 0.1 };
  },
  floor() {
    const g = new Geo();
    g.disc();
    return { geo: g, size: 1 };
  },
};

// ---------------- Шейдеры ----------------
const VS = `
attribute vec3 aPos; attribute vec3 aNor; attribute vec3 aCol; attribute vec2 aMat;
uniform mat4 uModel, uView, uProj, uLightVP; uniform mat3 uNM;
varying vec3 vN; varying vec3 vP; varying vec3 vC; varying vec2 vM; varying vec4 vLP;
void main(){
  vec4 w = uModel * vec4(aPos, 1.0);
  vP = w.xyz; vN = uNM * aNor; vC = aCol; vM = aMat; vLP = uLightVP * w;
  gl_Position = uProj * uView * w;
}`;

const FS = `
precision highp float;
varying vec3 vN; varying vec3 vP; varying vec3 vC; varying vec2 vM; varying vec4 vLP;
uniform vec3 uCam; uniform vec3 uKeyDir; uniform sampler2D uShadow;
uniform float uAlpha; uniform float uGlow; uniform float uFloor; uniform float uShadowOn;
const float PI = 3.14159265;

// Процедурная фотостудия: тёмный фон, верхний софтбокс, ключевой тёплый свет, бирюзовая контровая полоса
vec3 env(vec3 d) {
  float y = d.y;
  vec3 c = mix(vec3(0.010, 0.016, 0.026), vec3(0.045, 0.065, 0.095), smoothstep(-0.3, 0.9, y));
  c += vec3(1.9, 1.75, 1.5) * smoothstep(0.86, 0.97, y);
  vec3 k = normalize(vec3(0.55, 0.45, 0.7));
  c += vec3(3.2, 2.5, 1.6) * pow(max(dot(d, k), 0.0), 60.0);
  vec3 r = normalize(vec3(-0.85, 0.25, -0.5));
  c += vec3(2.6, 0.9, 0.45) * pow(max(dot(d, r), 0.0), 26.0);
  vec3 f = normalize(vec3(-0.9, 0.05, 0.45));
  c += vec3(0.25, 0.7, 0.68) * pow(max(dot(d, f), 0.0), 5.0) * 0.55;
  c += vec3(0.05, 0.035, 0.02) * smoothstep(0.0, -0.6, y);
  return c;
}
vec3 envBlur(vec3 d, float rough) {
  // Грубая «размытая» версия окружения для шероховатых поверхностей
  vec3 sharp = env(d);
  vec3 soft = mix(vec3(0.03, 0.025, 0.03), vec3(0.36, 0.31, 0.25), smoothstep(-0.4, 1.0, d.y)) + vec3(0.36, 0.14, 0.06) * max(dot(d, normalize(vec3(-0.85, 0.25, -0.5))), 0.0) * 0.6;
  return mix(sharp, soft, clamp(rough * 1.6, 0.0, 1.0));
}
float unpack(vec4 c) { return dot(c, vec4(1.0, 1.0 / 255.0, 1.0 / 65025.0, 1.0 / 16581375.0)); }
float shadowAt(vec4 lp, float bias) {
  vec3 p = lp.xyz / lp.w * 0.5 + 0.5;
  if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0 || p.z > 1.0) return 1.0;
  float s = 0.0;
  for (int x = -2; x <= 2; x++)
    for (int y = -2; y <= 2; y++) {
      float d = unpack(texture2D(uShadow, p.xy + vec2(float(x), float(y)) * (1.6 / ${SHADOW_SIZE}.0)));
      s += (p.z - bias > d) ? 0.0 : 1.0;
    }
  return s / 25.0;
}
vec3 aces(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }

void main() {
  if (uFloor > 0.5) {
    // Подиум: прозрачный, видна только мягкая тень и лёгкая тёплая подсветка в центре
    float r = length(vP.xz);
    float fade = smoothstep(2.3, 0.2, r);
    float sh = uShadowOn > 0.5 ? shadowAt(vLP, 0.002) : 1.0;
    float a = fade * (0.22 + 0.62 * (1.0 - sh));
    vec3 col = mix(vec3(0.0), vec3(0.09, 0.075, 0.05), sh * fade * 0.5);
    gl_FragColor = vec4(col, a * uAlpha);
    return;
  }
  vec3 N = normalize(vN);
  vec3 V = normalize(uCam - vP);
  if (dot(N, V) < 0.0) N = -N;
  float metal = vM.x, rough = max(vM.y, 0.035);
  vec3 albedo = pow(vC, vec3(2.2));
  vec3 F0 = mix(vec3(0.05), albedo, metal);
  float NdV = max(dot(N, V), 0.001);
  vec3 Fv = F0 + (1.0 - F0) * pow(1.0 - NdV, 5.0);

  vec3 Lo = vec3(0.0);
  float sh = uShadowOn > 0.5 ? shadowAt(vLP, 0.0035) : 1.0;
  // Три источника: тёплый ключевой (с тенью), синий заполняющий, неоновый контровой
  vec3 Ls[3]; vec3 Cs[3];
  Ls[0] = normalize(uKeyDir);                Cs[0] = vec3(3.6, 3.05, 2.3) * sh;
  Ls[1] = normalize(vec3(-0.9, 0.15, 0.45)); Cs[1] = vec3(0.35, 0.95, 0.95);
  Ls[2] = normalize(vec3(-0.3, 0.45, -1.0)); Cs[2] = vec3(3.0, 1.1, 0.5);
  for (int i = 0; i < 3; i++) {
    vec3 L = Ls[i];
    vec3 H = normalize(L + V);
    float NdL = max(dot(N, L), 0.0);
    float NdH = max(dot(N, H), 0.0);
    float a = rough * rough, a2 = a * a;
    float d = NdH * NdH * (a2 - 1.0) + 1.0;
    float D = a2 / (PI * d * d);
    float k = (rough + 1.0) * (rough + 1.0) / 8.0;
    float G = (NdL / (NdL * (1.0 - k) + k)) * (NdV / (NdV * (1.0 - k) + k));
    vec3 F = F0 + (1.0 - F0) * pow(1.0 - max(dot(H, V), 0.0), 5.0);
    vec3 spec = D * G * F / (4.0 * NdL * NdV + 0.001);
    vec3 diff = (1.0 - F) * (1.0 - metal) * albedo / PI;
    Lo += (diff + spec) * Cs[i] * NdL;
  }
  // Освещение окружением: отражения студии + рассеянный свет
  vec3 R = reflect(-V, N);
  vec3 spec = envBlur(R, rough) * Fv * mix(0.55, 1.0, sh);
  vec3 irr = envBlur(N, 1.0) * 0.55;
  vec3 diffuse = irr * albedo * (1.0 - metal) * (1.0 - Fv);
  // Мягкое затенение снизу (контакт с подиумом) — имитация ambient occlusion
  float ao = mix(0.55, 1.0, smoothstep(-1.2, 0.3, vP.y));
  vec3 col = Lo + (spec + diffuse) * ao + albedo * uGlow * 2.0;
  // Камни (очень гладкие диэлектрики): свет проходит сквозь грани — преломление + внутренний блеск
  if (rough < 0.07) {
    vec3 T = refract(-V, N, 0.6);
    vec3 inner = envBlur(T, 0.25) + envBlur(reflect(T, N), 0.4) * 0.5;
    col += albedo * inner * (1.0 - Fv) * 1.1 + albedo * 0.08;
  }
  col = aces(col * 0.9);
  col = pow(col, vec3(1.0 / 2.2));
  // Плакатная стилизация: цветовые полосы, растровые точки в тенях, контур как у печатной иллюстрации
  vec3 poster = floor(col * 5.0 + 0.5) / 5.0;
  col = mix(col, poster, 0.45);
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  vec2 cell = fract(gl_FragCoord.xy / 5.0) - 0.5;
  float dotR = clamp((0.42 - lum) * 1.3, 0.0, 0.5);
  if (length(cell) < dotR) col *= 0.55;
  float edge = 1.0 - smoothstep(0.08, 0.3, NdV);
  col = mix(col, vec3(0.05, 0.035, 0.03), edge * 0.8);
  gl_FragColor = vec4(col, uAlpha);
}`;

// Проход теней: глубина из позиции ключевого света, упакованная в RGBA (WebGL1)
const VS_SH = `
attribute vec3 aPos; uniform mat4 uModel; uniform mat4 uLightVP;
void main(){ gl_Position = uLightVP * uModel * vec4(aPos, 1.0); }`;
const FS_SH = `
precision highp float;
vec4 pack(float d){ vec4 e = fract(vec4(1.0, 255.0, 65025.0, 16581375.0) * d); e -= e.yzww * vec4(1.0/255.0, 1.0/255.0, 1.0/255.0, 0.0); return e; }
void main(){ gl_FragColor = pack(gl_FragCoord.z); }`;

// Ключевой свет и его матрица (ортографическая проекция охватывает объект и подиум)
const KEY_DIR = (() => {
  const v = [0.5, 1.0, 0.55];
  const l = Math.hypot(...v);
  return v.map((x) => x / l);
})();
const LIGHT_VP = M.mul(M.ortho(-2.4, 2.4, -2.4, 2.4, 0.5, 9), M.lookAt(KEY_DIR.map((x) => x * 4.5), [0, -0.3, 0], [0, 1, 0]));
const FLOOR_Y = -1.12;

// ---------------- Сцена (один WebGL-контекст на холст) ----------------
export class Stage {
  constructor(canvas) {
    this.canvas = canvas;
    this.views = new Set();
    this.meshes = new Map();
    const gl = canvas.getContext('webgl', { alpha: true, antialias: true, premultipliedAlpha: false });
    this.gl = gl;
    if (!gl) return;
    const compile = (vs, fs) => {
      const sh = (type, src) => {
        const s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
        return s;
      };
      const p = gl.createProgram();
      gl.attachShader(p, sh(gl.VERTEX_SHADER, vs));
      gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
      return p;
    };
    this.prog = compile(VS, FS);
    this.shProg = compile(VS_SH, FS_SH);
    const L = (p, names, attrs) => Object.fromEntries([...attrs.map((n) => [n, gl.getAttribLocation(p, n)]), ...names.map((n) => [n, gl.getUniformLocation(p, n)])]);
    this.loc = L(this.prog, ['uModel', 'uView', 'uProj', 'uLightVP', 'uNM', 'uCam', 'uKeyDir', 'uShadow', 'uAlpha', 'uGlow', 'uFloor', 'uShadowOn'], ['aPos', 'aNor', 'aCol', 'aMat']);
    this.shLoc = L(this.shProg, ['uModel', 'uLightVP'], ['aPos']);

    // Карта теней
    this.shadowTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.shadowTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, SHADOW_SIZE, SHADOW_SIZE, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const rb = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, SHADOW_SIZE, SHADOW_SIZE);
    this.fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.shadowTex, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, rb);
    this.shadowsOk = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    this.floorMesh = this.mesh('floor');
    this.last = performance.now();
    const loop = (t) => {
      this.frame(t);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }
  get ok() {
    return !!this.gl;
  }
  dispose() {
    cancelAnimationFrame(this.raf);
    for (const v of [...this.views]) v.destroy();
    this.gl?.getExtension('WEBGL_lose_context')?.loseContext();
    this.gl = null;
  }
  mesh(name, variant = 0) {
    const key = `${name}:${variant}`;
    if (this.meshes.has(key)) return this.meshes.get(key);
    const gl = this.gl;
    const model = (MODELS[name] || MODELS.in_game)(variant);
    const buf = (arr) => {
      const b = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(arr), gl.STATIC_DRAW);
      return b;
    };
    const m = { pos: buf(model.geo.pos), nor: buf(model.geo.nor), col: buf(model.geo.col), mat: buf(model.geo.mat), count: model.geo.pos.length / 3, size: model.size };
    this.meshes.set(key, m);
    return m;
  }
  bindAttrs(loc, mesh, full) {
    const gl = this.gl;
    const list = full ? [['aPos', mesh.pos, 3], ['aNor', mesh.nor, 3], ['aCol', mesh.col, 3], ['aMat', mesh.mat, 2]] : [['aPos', mesh.pos, 3]];
    for (const [attr, b, size] of list) {
      if (loc[attr] < 0) continue;
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.enableVertexAttribArray(loc[attr]);
      gl.vertexAttribPointer(loc[attr], size, gl.FLOAT, false, 0, 0);
    }
  }
  drawShadow(mesh, model) {
    const gl = this.gl;
    gl.uniformMatrix4fv(this.shLoc.uModel, false, model);
    this.bindAttrs(this.shLoc, mesh, false);
    gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
  }
  draw(mesh, model, { alpha = 1, glow = 0, floor = 0 } = {}) {
    const { gl, loc } = this;
    gl.uniformMatrix4fv(loc.uModel, false, model);
    gl.uniformMatrix3fv(loc.uNM, false, M.normal3(model));
    gl.uniform1f(loc.uAlpha, alpha);
    gl.uniform1f(loc.uGlow, glow);
    gl.uniform1f(loc.uFloor, floor);
    this.bindAttrs(loc, mesh, true);
    gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
  }
  frame(t) {
    if (!this.gl) return;
    const dt = Math.min(0.05, (t - this.last) / 1000);
    this.last = t;
    const { gl, canvas } = this;
    for (const v of this.views) if (!v.el.isConnected) v.destroy();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cw = Math.round(canvas.clientWidth * dpr), ch = Math.round(canvas.clientHeight * dpr);
    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw;
      canvas.height = ch;
    }
    gl.disable(gl.SCISSOR_TEST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, cw, ch);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (!this.views.size) return;
    const cr = canvas.getBoundingClientRect();
    for (const v of this.views) {
      const r = v.el.getBoundingClientRect();
      if (r.bottom < cr.top || r.top > cr.bottom || r.right < cr.left || r.left > cr.right || r.width < 2 || r.height < 2) {
        v.update(dt, false);
        continue;
      }
      v.update(dt, true);
      const models = v.models();
      // 1) Тени: глубина от ключевого света
      if (this.shadowsOk) {
        gl.disable(gl.SCISSOR_TEST);
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
        gl.viewport(0, 0, SHADOW_SIZE, SHADOW_SIZE);
        gl.clearColor(1, 1, 1, 1);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.disable(gl.BLEND);
        gl.useProgram(this.shProg);
        gl.uniformMatrix4fv(this.shLoc.uLightVP, false, LIGHT_VP);
        for (const [mesh, model] of models) this.drawShadow(mesh, model);
        gl.enable(gl.BLEND);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.clearColor(0, 0, 0, 0);
      }
      // 2) Основной проход в область витрины
      const x = Math.round((r.left - cr.left) * dpr), y = Math.round((cr.bottom - r.bottom) * dpr), w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
      gl.enable(gl.SCISSOR_TEST);
      gl.viewport(x, y, w, h);
      gl.scissor(x, y, w, h);
      gl.clear(gl.DEPTH_BUFFER_BIT);
      gl.useProgram(this.prog);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.shadowTex);
      gl.uniform1i(this.loc.uShadow, 0);
      gl.uniform1f(this.loc.uShadowOn, this.shadowsOk ? 1 : 0);
      gl.uniformMatrix4fv(this.loc.uLightVP, false, LIGHT_VP);
      gl.uniform3fv(this.loc.uKeyDir, KEY_DIR);
      v.camera(w / h);
      // Подиум рисуется первым и не пишет глубину, чтобы не перекрывать объект
      gl.depthMask(false);
      this.draw(this.floorMesh, M.trans(0, FLOOR_Y, 0), { floor: 1 });
      gl.depthMask(true);
      for (const [mesh, model, opts] of models) this.draw(mesh, model, opts);
    }
  }
  add(el, opts) {
    const v = new View(this, el, opts);
    this.views.add(v);
    return v;
  }
}

// ---------------- Витрина (орбитальное управление) ----------------
class View {
  constructor(stage, el, { model = 'logo', variant = 0, autoRotate = true, wheel = false, touch = 'pan-y', float = true, onTap = null, distance = 3.6, theta = 0.5, phi = 1.22 } = {}) {
    Object.assign(this, { stage, el, model, variant, autoRotate: autoRotate && !REDUCED, wheel, float: float && !REDUCED, onTap });
    this.theta = theta;
    this.phi = phi;
    this.radius = distance;
    this.baseRadius = distance;
    this.vt = 0;
    this.vp = 0;
    this.idle = 10;
    this.time = Math.random() * 10;
    this.particles = [];
    this.glow = 0;
    this.mesh = stage.mesh(model, variant);
    this.shard = stage.mesh('shard');
    this.pointers = new Map();
    el.classList.add('gl');
    el.style.touchAction = touch === 'none' ? 'none' : 'pan-y';
    if (!el.hasAttribute('tabindex')) el.tabIndex = 0;
    el.setAttribute('role', 'img');
    this.h = { down: (e) => this.down(e), move: (e) => this.move(e), up: (e) => this.up(e), wheel: (e) => this.onWheel(e), key: (e) => this.onKey(e) };
    el.addEventListener('pointerdown', this.h.down);
    el.addEventListener('pointermove', this.h.move);
    el.addEventListener('pointerup', this.h.up);
    el.addEventListener('pointercancel', this.h.up);
    el.addEventListener('wheel', this.h.wheel, { passive: false });
    el.addEventListener('keydown', this.h.key);
  }
  destroy() {
    const { el, h } = this;
    el.removeEventListener('pointerdown', h.down);
    el.removeEventListener('pointermove', h.move);
    el.removeEventListener('pointerup', h.up);
    el.removeEventListener('pointercancel', h.up);
    el.removeEventListener('wheel', h.wheel);
    el.removeEventListener('keydown', h.key);
    this.stage.views.delete(this);
  }
  down(e) {
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now() });
    this.el.setPointerCapture?.(e.pointerId);
    this.idle = 0;
    this.vt = this.vp = 0;
  }
  move(e) {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    this.idle = 0;
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (this.pinch) this.zoom(this.pinch / d);
      this.pinch = d;
      return;
    }
    const k = 5 / Math.max(240, this.el.clientWidth);
    this.vt = -dx * k * 60;
    this.vp = -dy * k * 60;
    this.theta += -dx * k;
    this.phi = Math.min(1.62, Math.max(0.2, this.phi - dy * k));
  }
  up(e) {
    const p = this.pointers.get(e.pointerId);
    this.pointers.delete(e.pointerId);
    this.pinch = null;
    if (p && this.onTap && e.type === 'pointerup' && Math.hypot(e.clientX - p.sx, e.clientY - p.sy) < 6 && performance.now() - p.t < 400) this.onTap();
  }
  zoom(f) {
    this.radius = Math.min(this.baseRadius * 1.8, Math.max(this.baseRadius * 0.55, this.radius * f));
    this.idle = 0;
  }
  onWheel(e) {
    const active = this.wheel === 'always' || (this.wheel === 'focus' && document.activeElement === this.el);
    if (!active) return;
    e.preventDefault();
    this.zoom(Math.exp(e.deltaY * 0.0012));
  }
  onKey(e) {
    const step = 0.18;
    const map = {
      ArrowLeft: () => (this.theta -= step),
      ArrowRight: () => (this.theta += step),
      ArrowUp: () => (this.phi = Math.max(0.2, this.phi - step)),
      ArrowDown: () => (this.phi = Math.min(1.62, this.phi + step)),
      '+': () => this.zoom(0.9),
      '=': () => this.zoom(0.9),
      '-': () => this.zoom(1.1),
    };
    if (map[e.key]) {
      e.preventDefault();
      map[e.key]();
      this.idle = 0;
    } else if (e.key === 'Enter' && this.onTap) this.onTap();
  }
  update(dt, visible) {
    this.time += dt;
    this.idle += dt;
    if (!this.pointers.size) {
      const damp = Math.exp(-dt * 3.2);
      this.vt *= damp;
      this.vp *= damp;
      this.theta += this.vt * dt;
      this.phi = Math.min(1.62, Math.max(0.2, this.phi + this.vp * dt));
      if (this.autoRotate && this.idle > 2.5) this.theta += dt * 0.42 * Math.min(1, (this.idle - 2.5) / 1.5);
    }
    if (!visible) return;
    for (const p of this.particles) {
      p.v[1] -= 3.2 * dt;
      for (let i = 0; i < 3; i++) p.p[i] += p.v[i] * dt;
      if (p.p[1] < FLOOR_Y + 0.05 && p.v[1] < 0) {
        p.p[1] = FLOOR_Y + 0.05;
        p.v[1] *= -0.35;
        p.v[0] *= 0.7;
        p.v[2] *= 0.7;
      }
      p.r += p.rv * dt;
      p.life -= dt;
    }
    this.particles = this.particles.filter((p) => p.life > 0);
    if (this.glow) this.glow = Math.max(0, this.glow - dt * 1.2);
  }
  camera(aspect) {
    const s = this.stage;
    const gl = s.gl;
    const eye = [this.radius * Math.sin(this.phi) * Math.sin(this.theta), this.radius * Math.cos(this.phi), this.radius * Math.sin(this.phi) * Math.cos(this.theta)];
    const fit = aspect < 1 ? 1 / aspect : 1;
    gl.uniformMatrix4fv(s.loc.uProj, false, M.persp(32 * Math.min(1.6, fit), aspect, 0.1, 50));
    gl.uniformMatrix4fv(s.loc.uView, false, M.lookAt(eye, [0, -0.08, 0], [0, 1, 0]));
    gl.uniform3fv(s.loc.uCam, eye);
  }
  // Объекты витрины: [меш, матрица, параметры]
  models() {
    const bob = this.float ? Math.sin(this.time * 1.3) * 0.07 : 0;
    const tilt = this.float ? Math.sin(this.time * 0.7) * 0.05 : 0;
    const list = [[this.mesh, M.chain(M.trans(0, bob, 0), M.rotZ(tilt), M.scale(1 / this.mesh.size)), { glow: this.glow }]];
    for (const p of this.particles) {
      const a = Math.min(1, p.life / 0.5);
      list.push([this.shard, M.chain(M.trans(p.p[0], p.p[1], p.p[2]), M.rotY(p.r), M.rotX(p.r * 0.7), M.scale(p.s * (0.4 + 0.6 * a))), { alpha: a, glow: 0.25 }]);
    }
    return list;
  }
  // Салют золотых кристаллов (обмен баллов на награду)
  burst(count = 90) {
    if (REDUCED) return Promise.resolve();
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2, el = Math.random() * Math.PI - Math.PI / 2, sp = 1.6 + Math.random() * 2.6;
      this.particles.push({ p: [0, 0, 0], v: [Math.cos(a) * Math.cos(el) * sp, Math.abs(Math.sin(el)) * sp + 1.2, Math.sin(a) * Math.cos(el) * sp], r: Math.random() * 6, rv: (Math.random() - 0.5) * 14, s: 0.6 + Math.random() * 1.1, life: 1.3 + Math.random() * 0.9 });
    }
    this.glow = 0.6;
    this.idle = 0;
    this.vt = 6;
    return new Promise((r) => setTimeout(r, 1300));
  }
}

// ---------------- Подключение к странице ----------------
let pageStage = null;
export function pageStageFor(canvas) {
  if (pageStage === null) {
    try {
      pageStage = new Stage(canvas);
      if (!pageStage.ok) pageStage = false;
    } catch (e) {
      console.warn('[3D] WebGL недоступен, показываем изображения:', e.message);
      pageStage = false;
    }
  }
  return pageStage || null;
}

export const modelForCategory = (cat) => (['game_access', 'in_game', 'subscription', 'recognition'].includes(cat) ? cat : 'in_game');
// Уникальная модель для каждой награды: по платформе, категории и смыслу
export function modelForReward(r) {
  const t = String(r.title || '').toLowerCase();
  if (r.platform === 'steam') return ['game_box', 0];
  if (r.platform === 'epic') return ['game_box', 1];
  if (r.platform === 'google_play') return ['phone', 0];
  if (r.platform === 'app_store') return ['phone', 1];
  if (/тулпар|скин|кон[ья]/.test(t)) return ['horseshoe', 0];
  if (/чат/.test(t)) return ['chat', 0];
  if (/титр/.test(t)) return ['clapper', 0];
  return [modelForCategory(r.category), r.id || 0];
}
export const reducedMotion = REDUCED;
