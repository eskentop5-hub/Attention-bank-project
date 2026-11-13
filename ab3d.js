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
  scale3: (x, y, z) => new Float32Array([x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1]),
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
// Нормали: обратная транспонированная 3×3 (верно и для неравномерного масштаба), кэш на матрицу
const NM_CACHE = new WeakMap();
function cofactor(m) {
  let c = NM_CACHE.get(m);
  if (c) return c;
  const a00 = m[0], a01 = m[4], a02 = m[8], a10 = m[1], a11 = m[5], a12 = m[9], a20 = m[2], a21 = m[6], a22 = m[10];
  c = [a11 * a22 - a12 * a21, a12 * a20 - a10 * a22, a10 * a21 - a11 * a20, a02 * a21 - a01 * a22, a00 * a22 - a02 * a20, a01 * a20 - a00 * a21, a01 * a12 - a02 * a11, a02 * a10 - a00 * a12, a00 * a11 - a01 * a10];
  NM_CACHE.set(m, c);
  return c;
}
const tn = (m, n) => {
  const c = cofactor(m);
  const x = c[0] * n[0] + c[1] * n[1] + c[2] * n[2], y = c[3] * n[0] + c[4] * n[1] + c[5] * n[2], z = c[6] * n[0] + c[7] * n[1] + c[8] * n[2];
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
};
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm3 = (v) => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
// Поворот вокруг оси k на угол a и поворот, переводящий +Y в направление d (антенны, ножки)
function rotAxis(k, a) {
  const [x, y, z] = k, c = Math.cos(a), s = Math.sin(a), t = 1 - c;
  return new Float32Array([t * x * x + c, t * x * y + s * z, t * x * z - s * y, 0, t * x * y - s * z, t * y * y + c, t * y * z + s * x, 0, t * x * z + s * y, t * y * z - s * x, t * z * z + c, 0, 0, 0, 0, 1]);
}
function alignY(d) {
  const [x, y, z] = norm3(d);
  const ax = [z, 0, -x], l = Math.hypot(ax[0], ax[2]);
  if (l < 1e-6) return y > 0 ? M.ident() : M.rotX(Math.PI);
  return rotAxis([ax[0] / l, 0, ax[2] / l], Math.acos(Math.max(-1, Math.min(1, y))));
}
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
  // Эмаль и латунь — материалы советских значков и приборов
  brass: { c: hex('#D9A23A'), metal: 1, rough: 0.26 },
  enamelRed: { c: hex('#D63C22'), metal: 0.05, rough: 0.16 },
  enamelCream: { c: hex('#F4E6C8'), metal: 0.05, rough: 0.2 },
  enamelTeal: { c: hex('#2E8C8A'), metal: 0.05, rough: 0.18 },
  enamelNavy: { c: hex('#17242C'), metal: 0.05, rough: 0.22 },
  glass: { c: hex('#12302F'), metal: 0.4, rough: 0.09 },
  // Аби: тёплая жёлтая эмаль, как на значке
  abi: { c: hex('#FFC52A'), metal: 0.1, rough: 0.36 },
  abiShade: { c: hex('#E3A91C'), metal: 0.12, rough: 0.4 },
  eyeWhite: { c: hex('#FFFDF6'), metal: 0, rough: 0.12 },
  iris: { c: hex('#1D57B5'), metal: 0.1, rough: 0.1 },
  brow: { c: hex('#6B3E12'), metal: 0, rough: 0.5 },
  mouth: { c: hex('#7A1E12'), metal: 0, rough: 0.5 },
  cheek: { c: hex('#FF8A4D'), metal: 0, rough: 0.6 },
  hole: { c: hex('#060506'), metal: 0, rough: 0.9 },
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
  // Выдавленный контур (звёзды, пластины, стрелки): контур в плоскости XY, толщина по Z, фаска по краю.
  // Контур должен быть «звёздным» относительно центра (из центра видны все рёбра) — так треугольники веером корректны.
  extrude(m, mt, pts, depth, { bevel = 0, smooth = false, side = mt, back = null, center = null } = {}) {
    let area = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      area += a[0] * b[1] - b[0] * a[1];
    }
    const P = area < 0 ? [...pts].reverse() : pts;
    const n = P.length;
    const cx = center ? center[0] : P.reduce((s, p) => s + p[0], 0) / n, cy = center ? center[1] : P.reduce((s, p) => s + p[1], 0) / n;
    const en = P.map((a, i) => {
      const b = P[(i + 1) % n], dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
      return [dy / l, -dx / l];
    });
    const vn = P.map((_, i) => {
      const a = en[(i - 1 + n) % n], b = en[i], x = a[0] + b[0], y = a[1] + b[1], l = Math.hypot(x, y) || 1;
      return [x / l, y / l];
    });
    const z = depth / 2, b = Math.min(bevel, z * 0.9);
    const inner = P.map((p, i) => {
      const k = b / Math.max(0.45, vn[i][0] * en[i][0] + vn[i][1] * en[i][1]);
      return [p[0] - vn[i][0] * k, p[1] - vn[i][1] * k];
    });
    const F = (q, zz) => tp(m, [q[0], q[1], zz]);
    const NF = tn(m, [0, 0, 1]), NB = tn(m, [0, 0, -1]);
    const cap = b ? inner : P;
    const cF = F([cx, cy], z), cB = F([cx, cy], -z);
    const bk = back || mt;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      this.tri(cF, F(cap[i], z), F(cap[j], z), mt, NF, NF, NF);
      this.tri(cB, F(cap[j], -z), F(cap[i], -z), bk, NB, NB, NB);
      const ni = smooth ? vn[i] : en[i], nj = smooth ? vn[j] : en[i];
      const sN = (v, s = 0) => tn(m, [v[0], v[1], s]);
      const zf = z - b, zb = -z + b;
      this.tri(F(P[i], zf), F(P[i], zb), F(P[j], zb), side, sN(ni), sN(ni), sN(nj));
      this.tri(F(P[i], zf), F(P[j], zb), F(P[j], zf), side, sN(ni), sN(nj), sN(nj));
      if (b) {
        this.tri(F(inner[i], z), F(P[i], zf), F(P[j], zf), mt, sN(ni, 1), sN(ni, 1), sN(nj, 1));
        this.tri(F(inner[i], z), F(P[j], zf), F(inner[j], z), mt, sN(ni, 1), sN(nj, 1), sN(nj, 1));
        this.tri(F(P[i], zb), F(inner[i], -z), F(inner[j], -z), bk, sN(ni, -1), sN(ni, -1), sN(nj, -1));
        this.tri(F(P[i], zb), F(inner[j], -z), F(P[j], zb), bk, sN(ni, -1), sN(nj, -1), sN(nj, -1));
      }
    }
  }
  // Кольцо или его сектор (подкова, биметаллическая монета, этикетка диска): плоская полоса толщиной depth
  band(m, mt, rIn, rOut, depth, { a0 = 0, a1 = Math.PI * 2, seg = 64, side = mt } = {}) {
    const z = depth / 2;
    const P = (r, a, zz) => tp(m, [Math.cos(a) * r, Math.sin(a) * r, zz]);
    const RN = (a, s) => tn(m, [Math.cos(a) * s, Math.sin(a) * s, 0]);
    const NF = tn(m, [0, 0, 1]), NB = tn(m, [0, 0, -1]);
    for (let i = 0; i < seg; i++) {
      const u0 = a0 + ((a1 - a0) * i) / seg, u1 = a0 + ((a1 - a0) * (i + 1)) / seg;
      this.tri(P(rIn, u0, z), P(rOut, u0, z), P(rOut, u1, z), mt, NF, NF, NF);
      this.tri(P(rIn, u0, z), P(rOut, u1, z), P(rIn, u1, z), mt, NF, NF, NF);
      this.tri(P(rIn, u1, -z), P(rOut, u1, -z), P(rOut, u0, -z), mt, NB, NB, NB);
      this.tri(P(rIn, u1, -z), P(rOut, u0, -z), P(rIn, u0, -z), mt, NB, NB, NB);
      this.tri(P(rOut, u0, z), P(rOut, u0, -z), P(rOut, u1, -z), side, RN(u0, 1), RN(u0, 1), RN(u1, 1));
      this.tri(P(rOut, u0, z), P(rOut, u1, -z), P(rOut, u1, z), side, RN(u0, 1), RN(u1, 1), RN(u1, 1));
      if (rIn > 0) {
        this.tri(P(rIn, u0, z), P(rIn, u1, -z), P(rIn, u0, -z), side, RN(u0, -1), RN(u1, -1), RN(u0, -1));
        this.tri(P(rIn, u0, z), P(rIn, u1, z), P(rIn, u1, -z), side, RN(u0, -1), RN(u1, -1), RN(u1, -1));
      }
    }
    if (Math.abs(a1 - a0 - Math.PI * 2) > 1e-6)
      for (const a of [a0, a1]) this.quad(P(rIn, a, z), P(rOut, a, z), P(rOut, a, -z), P(rIn, a, -z), side);
  }
  // Трубка по пути (ручки кубка, антенны, перья): окружность переносится вдоль пути без закручивания
  tube(m, mt, path, r, { seg = 14, caps = true, r1 = r } = {}) {
    const n = path.length;
    const T = path.map((_, i) => {
      const a = path[Math.max(0, i - 1)], b = path[Math.min(n - 1, i + 1)];
      return norm3([b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
    });
    const Ns = [norm3(Math.abs(T[0][1]) < 0.9 ? cross3(T[0], [0, 1, 0]) : cross3(T[0], [1, 0, 0]))];
    for (let i = 1; i < n; i++) {
      const p = Ns[i - 1], t = T[i], d = dot3(p, t);
      Ns.push(norm3([p[0] - d * t[0], p[1] - d * t[1], p[2] - d * t[2]]));
    }
    const rings = path.map((p, i) => {
      const N = Ns[i], B = cross3(T[i], N), rr = r + ((r1 - r) * i) / Math.max(1, n - 1);
      return Array.from({ length: seg }, (_, k) => {
        const a = (k / seg) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
        const d = [N[0] * c + B[0] * s, N[1] * c + B[1] * s, N[2] * c + B[2] * s];
        return { p: tp(m, [p[0] + d[0] * rr, p[1] + d[1] * rr, p[2] + d[2] * rr]), n: tn(m, d) };
      });
    });
    for (let i = 0; i < n - 1; i++)
      for (let k = 0; k < seg; k++) {
        const k1 = (k + 1) % seg, a = rings[i][k], b = rings[i][k1], c = rings[i + 1][k1], d = rings[i + 1][k];
        this.tri(a.p, b.p, c.p, mt, a.n, b.n, c.n);
        this.tri(a.p, c.p, d.p, mt, a.n, c.n, d.n);
      }
    if (caps)
      for (const [i, s] of [[0, -1], [n - 1, 1]]) {
        const c = tp(m, path[i]), cn = tn(m, T[i].map((v) => v * s));
        for (let k = 0; k < seg; k++) this.tri(c, rings[i][k].p, rings[i][(k + 1) % seg].p, mt, cn, cn, cn);
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
// Ретрофутуризм советского космического плаката: латунь и золото, эмаль (красная, кремовая, бирюзовая),
// заклёпки, звёзды, лучи. У части моделей есть движущиеся детали (parts): кольца гироскопа, луна, хлопушка.
const GEMS = [MAT.gemSky, MAT.gemMint, MAT.gemGold, MAT.gemCoral];
const TAU = Math.PI * 2;
const smooth01 = (x) => x * x * (3 - 2 * x);
// Плоские контуры для extrude
const S2 = {
  circle: (r, n = 48) => Array.from({ length: n }, (_, i) => [Math.cos((i / n) * TAU) * r, Math.sin((i / n) * TAU) * r]),
  ellipse: (rx, ry, n = 32) => Array.from({ length: n }, (_, i) => [Math.cos((i / n) * TAU) * rx, Math.sin((i / n) * TAU) * ry]),
  star: (k, R, r, rot = Math.PI / 2) => Array.from({ length: k * 2 }, (_, i) => {
    const a = rot + (i * Math.PI) / k, rr = i % 2 ? r : R;
    return [Math.cos(a) * rr, Math.sin(a) * rr];
  }),
  roundRect(w, h, r, n = 6) {
    const pts = [], x = w / 2 - r, y = h / 2 - r;
    for (const [cx, cy, a0] of [[x, -y, -Math.PI / 2], [x, y, 0], [-x, y, Math.PI / 2], [-x, -y, Math.PI]])
      for (let i = 0; i <= n; i++) {
        const a = a0 + (i / n) * (Math.PI / 2);
        pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
      }
    return pts;
  },
};
// Сглаженный путь через опорные точки (Catmull–Rom)
function spline(pts, steps = 8) {
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    for (let s = 0; s < steps; s++) {
      const t = s / steps, t2 = t * t, t3 = t2 * t;
      out.push([0, 1, 2].map((k) => 0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3)));
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}
const part = (geo, anim) => ({ geo, anim });

// Настроение 3D-Аби: idle | think | talk | wave | walk | happy. Детали модели читают его в анимации.
export const ABI = { mood: 'idle', look: [0, 0] };
export const setAbiMood = (mood) => {
  ABI.mood = mood;
};

export const MODELS = {
  // Знак ATTENTION BANK как гироскоп: бирюзовое кольцо «внимания» и золотое кольцо «ценности»
  // вращаются вокруг огранённого ядра на золотой оси
  logo() {
    const g = new Geo();
    g.crystal(M.scale(0.46), MAT.diamond, { sides: 16 });
    g.lathe(M.ident(), MAT.gold, [[0, -0.66], [0.03, -0.64], [0.02, -0.56], [0.02, 0.56], [0.03, 0.64], [0, 0.66]], 18);
    for (const y of [-0.66, 0.66]) g.sphere(M.trans(0, y, 0), MAT.goldPale, { r: 0.05, su: 16, sv: 10 });
    const a = new Geo();
    a.torus(M.ident(), MAT.skyMetal, { R: 0.86, r: 0.07, su: 110, sv: 20 });
    for (let i = 0; i < 16; i++) {
      const u = (i / 16) * TAU;
      for (const z of [0.066, -0.066]) a.sphere(M.trans(Math.cos(u) * 0.86, Math.sin(u) * 0.86, z), MAT.goldPale, { r: 0.017, su: 8, sv: 5 });
    }
    a.star(M.trans(0.86, 0, 0.07), MAT.enamelRed, { r: 0.14, inner: 0.06, h: 0.05 });
    a.star(M.chain(M.trans(0.86, 0, -0.07), M.rotY(Math.PI)), MAT.enamelRed, { r: 0.14, inner: 0.06, h: 0.05 });
    const b = new Geo();
    b.torus(M.ident(), MAT.gold, { R: 0.64, r: 0.066, su: 100, sv: 20 });
    b.crystal(M.chain(M.trans(0, 0.66, 0), M.scale(0.17)), MAT.gemCoral, { sides: 10 });
    b.crystal(M.chain(M.trans(0, -0.66, 0), M.rotZ(Math.PI), M.scale(0.17)), MAT.gemSky, { sides: 10 });
    return {
      geo: g,
      size: 1.28,
      parts: [part(a, (t) => M.chain(M.rotY(t * 0.55), M.rotX(0.35))), part(b, (t) => M.chain(M.rotX(Math.PI / 2 + 0.28), M.rotZ(t * 0.9)))],
    };
  },
  // Ранний доступ: золотой ключ с ушком-звездой, красной эмалью, камнем и точёным стержнем
  game_access(v = 0) {
    const g = new Geo();
    const gold = v % 2 ? MAT.goldPale : MAT.gold;
    const B = M.trans(0.15, 0, 0);
    const bow = M.chain(B, M.trans(-0.6, 0, 0));
    g.extrude(bow, gold, S2.star(5, 0.4, 0.2), 0.11, { bevel: 0.028 });
    for (const s of [1, -1]) {
      g.extrude(M.chain(bow, M.trans(0, 0, s * 0.056)), MAT.enamelRed, S2.star(5, 0.29, 0.145), 0.012);
      g.crystal(M.chain(bow, M.trans(0, 0, s * 0.066), M.rotX((s * Math.PI) / 2), M.scale(0.17)), MAT.gemSky, { sides: 12 });
    }
    const X = M.chain(B, M.rotZ(-Math.PI / 2));
    g.lathe(X, gold, [[0, -0.27], [0.05, -0.27], [0.078, -0.24], [0.078, -0.19], [0.056, -0.17], [0.056, 0.64], [0.045, 0.69], [0, 0.7]], 40);
    g.lathe(X, MAT.enamelRed, [[0.06, -0.12], [0.062, -0.1], [0.062, -0.02], [0.06, 0.0]], 40);
    for (const y of [-0.13, 0.01, 0.22]) g.torus(M.chain(X, M.trans(0, y, 0), M.rotX(Math.PI / 2)), MAT.brass, { R: 0.064, r: 0.016, su: 32, sv: 8 });
    g.bevelBox(M.chain(B, M.trans(0.5, -0.075, 0)), gold, 0.34, 0.07, 0.07, 0.015);
    for (const [x, h] of [[0.38, 0.17], [0.47, 0.25], [0.56, 0.15], [0.63, 0.21]]) g.bevelBox(M.chain(B, M.trans(x, -0.05 - h / 2, 0)), gold, 0.065, h, 0.07, 0.014);
    return { geo: g, size: 1.1 };
  },
  // Внутриигровые предметы: большой камень в золотой оправе на постаменте, вокруг летают малые камни
  in_game(v = 0) {
    const g = new Geo();
    const a = GEMS[v % 4], b = GEMS[(v + 1) % 4], c = GEMS[(v + 2) % 4], d = GEMS[(v + 3) % 4];
    const flat = (y) => M.chain(M.trans(0, y, 0), M.rotX(-Math.PI / 2));
    g.extrude(flat(-0.88), MAT.enamelNavy, S2.circle(0.5, 6), 0.12, { bevel: 0.02 });
    g.extrude(flat(-0.79), MAT.gold, S2.circle(0.42, 6), 0.06, { bevel: 0.012 });
    g.extrude(flat(-0.74), MAT.enamelRed, S2.circle(0.3, 6), 0.05, { bevel: 0.01 });
    g.lathe(M.ident(), MAT.gold, [[0, -0.72], [0.09, -0.72], [0.06, -0.62], [0.05, -0.5], [0.1, -0.4], [0.2, -0.33], [0.26, -0.27], [0.24, -0.24], [0.12, -0.27], [0, -0.28]], 48);
    g.sphere(M.trans(0, -0.56, 0), MAT.enamelRed, { r: 0.075, su: 20, sv: 12 });
    for (let k = 0; k < 6; k++) {
      const u = (k / 6) * TAU + 0.26, C = Math.cos(u), S = Math.sin(u);
      const path = spline([[C * 0.22, -0.28, S * 0.22], [C * 0.36, -0.12, S * 0.36], [C * 0.45, 0.06, S * 0.45], [C * 0.42, 0.2, S * 0.42]], 5);
      g.tube(M.ident(), MAT.gold, path, 0.022, { seg: 8 });
      g.sphere(M.trans(C * 0.42, 0.21, S * 0.42), MAT.goldPale, { r: 0.032, su: 12, sv: 8 });
    }
    g.crystal(M.chain(M.trans(0, 0.14, 0), M.scale(0.9)), a, { sides: 16 });
    const orbit = new Geo();
    [b, c, d].forEach((mt, i) => {
      const u = (i / 3) * TAU;
      orbit.crystal(M.chain(M.trans(Math.cos(u) * 0.8, 0, Math.sin(u) * 0.8), M.rotZ(0.4), M.scale(0.2)), mt, { sides: 10 });
    });
    return { geo: g, size: 1.15, parts: [part(orbit, (t) => M.chain(M.trans(0, 0.08, 0), M.rotX(0.28), M.rotY(t * 0.8)))] };
  },
  // Подписка: две карты-пропуска — эмаль, золотой чип, бесконтактный значок, звезда с камнем
  subscription(v = 0) {
    const g = new Geo();
    const face = v % 2 ? MAT.enamelNavy : MAT.enamelTeal;
    const back = M.chain(M.trans(0.14, 0.13, -0.09), M.rotZ(0.13));
    g.extrude(back, MAT.enamelRed, S2.roundRect(1.5, 0.94, 0.09), 0.045, { bevel: 0.012 });
    g.extrude(M.chain(back, M.trans(0, 0.27, 0.025)), MAT.gold, S2.roundRect(1.3, 0.07, 0.03), 0.008);
    g.extrude(M.ident(), face, S2.roundRect(1.56, 0.98, 0.1), 0.05, { bevel: 0.014 });
    const z = 0.027;
    g.extrude(M.trans(0, 0.28, z), MAT.enamelCream, S2.roundRect(1.44, 0.12, 0.04), 0.008);
    g.extrude(M.trans(-0.5, -0.04, z + 0.004), MAT.gold, S2.roundRect(0.27, 0.21, 0.045), 0.016, { bevel: 0.005 });
    for (const y of [-0.075, -0.005]) g.bevelBox(M.trans(-0.5, y, z + 0.013), MAT.brass, 0.25, 0.008, 0.004, 0.001);
    g.bevelBox(M.trans(-0.5, -0.04, z + 0.013), MAT.brass, 0.008, 0.19, 0.004, 0.001);
    for (let i = 0; i < 3; i++) g.torus(M.chain(M.trans(-0.31, -0.04, z + 0.006), M.rotZ(-0.6)), MAT.goldPale, { R: 0.05 + i * 0.034, r: 0.008, su: 20, sv: 6, arc: 0.19 });
    g.extrude(M.trans(0.5, -0.02, z + 0.008), MAT.gold, S2.star(5, 0.17, 0.075), 0.022, { bevel: 0.006 });
    g.crystal(M.chain(M.trans(0.5, -0.02, z + 0.03), M.rotX(Math.PI / 2), M.scale(0.09)), MAT.gemCoral, { sides: 10 });
    for (let gi = 0; gi < 4; gi++) for (let k = 0; k < 4; k++) g.sphere(M.chain(M.trans(-0.62 + gi * 0.27 + k * 0.045, -0.3, z), M.scale3(1, 1, 0.5)), MAT.enamelCream, { r: 0.015, su: 8, sv: 5 });
    g.extrude(M.trans(-0.43, -0.39, z), MAT.enamelCream, S2.roundRect(0.48, 0.026, 0.012), 0.006);
    return { geo: g, size: 1.0 };
  },
  // Признание: орден — лучистая звезда, красная эмаль, камень в центре, колодка с лентой
  recognition(v = 0) {
    const g = new Geo();
    const rib = v % 2 ? MAT.ribbonCoral : MAT.ribbonSky;
    const pent = (s) => [[-0.34 * s, 0.98], [0.34 * s, 0.98], [0.34 * s, 0.66], [0, 0.48 - (s - 1) * 0.2], [-0.34 * s, 0.66]];
    g.extrude(M.trans(0, 0.01, -0.02), MAT.gold, pent(1.1).map(([x, y]) => [x, y + (y > 0.9 ? 0.02 : 0)]), 0.03, { bevel: 0.008 });
    g.extrude(M.ident(), rib, pent(1), 0.035);
    const yb = (x) => 0.48 + (0.18 * Math.abs(x)) / 0.34;
    for (const [xa, xb] of [[-0.16, -0.11], [0.11, 0.16], [-0.025, 0.025]])
      g.extrude(M.trans(0, 0, 0.019), MAT.enamelCream, [[xa, yb(xa) + 0.01], [xb, yb(xb) + 0.01], [xb, 0.97], [xa, 0.97]], 0.004);
    g.torus(M.chain(M.trans(0, 0.44, 0), M.rotY(Math.PI / 2)), MAT.goldPale, { R: 0.065, r: 0.018, su: 28, sv: 8 });
    const C = M.trans(0, -0.2, 0);
    g.extrude(C, MAT.gold, S2.star(16, 0.64, 0.5), 0.06, { bevel: 0.014 });
    g.extrude(M.chain(C, M.trans(0, 0, 0.02)), MAT.silver, S2.star(16, 0.52, 0.42, Math.PI / 2 + Math.PI / 16), 0.05, { bevel: 0.01 });
    g.extrude(M.chain(C, M.trans(0, 0, 0.05)), MAT.gold, S2.star(5, 0.47, 0.2), 0.03, { bevel: 0.008 });
    g.star(M.chain(C, M.trans(0, 0, 0.065)), MAT.enamelRed, { r: 0.42, inner: 0.17, h: 0.09 });
    g.cylinder(M.chain(C, M.trans(0, 0, 0.12)), MAT.gold, { r: 0.13, h: 0.045, seg: 40 });
    g.torus(M.chain(C, M.trans(0, 0, 0.142)), MAT.goldPale, { R: 0.12, r: 0.012, su: 40, sv: 6 });
    g.crystal(M.chain(C, M.trans(0, 0, 0.15), M.rotX(Math.PI / 2), M.scale(0.17)), MAT.gemGold, { sides: 12 });
    return { geo: g, size: 1.3 };
  },
  // Коробка игры: обложка-плакат (солнце, горы, звезда), золотой корешок; диск выезжает и вращается
  game_box(v = 0) {
    const g = new Geo();
    const epic = v % 2 === 1;
    g.bevelBox(M.ident(), epic ? MAT.black : MAT.enamelNavy, 1.0, 1.3, 0.16, 0.035);
    const z = 0.082;
    g.extrude(M.trans(0, -0.04, z), epic ? MAT.enamelCream : MAT.enamelTeal, S2.roundRect(0.86, 1.02, 0.03), 0.01);
    g.extrude(M.trans(0.14, 0.12, z + 0.004), MAT.goldPale, S2.star(12, 0.27, 0.2), 0.008);
    g.extrude(M.trans(0.14, 0.12, z + 0.009), MAT.gold, S2.circle(0.19, 40), 0.012, { bevel: 0.004 });
    g.extrude(M.trans(0, 0, z + 0.015), MAT.enamelRed, [[-0.43, -0.55], [-0.1, -0.1], [0.22, -0.55]], 0.012);
    g.extrude(M.trans(0, 0, z + 0.02), MAT.redMetal, [[-0.02, -0.55], [0.22, -0.24], [0.43, -0.44], [0.43, -0.55]], 0.012);
    g.extrude(M.trans(-0.26, 0.24, z + 0.012), MAT.enamelCream, S2.star(4, 0.07, 0.022), 0.01);
    g.extrude(M.trans(-0.12, 0.36, z + 0.012), MAT.enamelCream, S2.star(4, 0.045, 0.015), 0.01);
    g.extrude(M.trans(0, 0.55, z + 0.004), MAT.gold, S2.roundRect(0.8, 0.09, 0.02), 0.014, { bevel: 0.004 });
    g.bevelBox(M.trans(-0.502, 0, 0), MAT.gold, 0.012, 1.18, 0.12, 0.004);
    const disc = new Geo();
    disc.cylinder(M.ident(), MAT.silver, { r: 0.46, h: 0.018, seg: 72 });
    for (const s of [1, -1]) {
      disc.band(M.trans(0, 0, s * 0.0105), MAT.skyMetal, 0.17, 0.44, 0.003, { seg: 64 });
      [[MAT.enamelRed, 0], [MAT.gold, 2.1], [MAT.enamelCream, 4.2]].forEach(([mt, a]) => disc.band(M.trans(0, 0, s * 0.0125), mt, 0.2, 0.42, 0.003, { a0: a, a1: a + 1.15, seg: 18 }));
      disc.band(M.trans(0, 0, s * 0.013), MAT.goldPale, 0.06, 0.13, 0.004, { seg: 32 });
    }
    disc.cylinder(M.ident(), MAT.hole, { r: 0.06, h: 0.03, seg: 24 });
    return { geo: g, size: 1.2, parts: [part(disc, (t) => M.chain(M.trans(0.47, 0.06, -0.035), M.rotZ(t * 1.1)))] };
  },
  // Смартфон: скруглённый корпус, сетка иконок, док, камеры; над углом парит значок загрузки
  phone(v = 0) {
    const g = new Geo();
    const body = v % 2 ? MAT.enamelCream : MAT.black;
    g.extrude(M.ident(), body, S2.roundRect(0.8, 1.56, 0.13, 8), 0.1, { bevel: 0.032, smooth: true });
    g.extrude(M.trans(0, 0, 0.051), MAT.screen, S2.roundRect(0.72, 1.46, 0.09, 8), 0.004);
    g.extrude(M.trans(0, 0.67, 0.055), MAT.black, S2.roundRect(0.16, 0.045, 0.022, 4), 0.004);
    const cols = [MAT.gold, MAT.enamelRed, MAT.enamelTeal, MAT.enamelCream, MAT.mint, MAT.violet];
    for (let i = 0; i < 12; i++) {
      const x = -0.2 + (i % 3) * 0.2, y = 0.5 - Math.floor(i / 3) * 0.19;
      g.extrude(M.trans(x, y, 0.06), cols[(i + v) % 6], S2.roundRect(0.14, 0.14, 0.035, 4), 0.016, { bevel: 0.005 });
    }
    g.extrude(M.trans(0, -0.3, 0.056), MAT.enamelNavy, S2.roundRect(0.52, 0.045, 0.02), 0.006);
    g.extrude(M.trans(-0.08, -0.3, 0.06), MAT.gold, S2.roundRect(0.36, 0.045, 0.02), 0.008);
    g.extrude(M.trans(0, -0.58, 0.056), MAT.enamelNavy, S2.roundRect(0.62, 0.17, 0.07, 6), 0.008);
    for (let i = 0; i < 4; i++) g.extrude(M.trans(-0.21 + i * 0.14, -0.58, 0.062), cols[(i + 3 + v) % 6], S2.circle(0.045, 20), 0.014, { bevel: 0.004 });
    g.bevelBox(M.trans(0.405, 0.3, 0), MAT.steel, 0.02, 0.22, 0.04, 0.008);
    for (const y of [0.4, 0.22]) g.bevelBox(M.trans(-0.405, y, 0), MAT.steel, 0.02, 0.12, 0.04, 0.008);
    g.extrude(M.trans(-0.18, 0.55, -0.056), body, S2.roundRect(0.3, 0.3, 0.08, 6), 0.02, { bevel: 0.006 });
    for (const [x, y] of [[-0.24, 0.61], [-0.12, 0.49]]) {
      g.cylinder(M.trans(x, y, -0.07), MAT.glass, { r: 0.046, h: 0.02, seg: 28 });
      g.torus(M.trans(x, y, -0.08), MAT.goldPale, { R: 0.048, r: 0.008, su: 28, sv: 6 });
    }
    const badge = new Geo();
    badge.cylinder(M.ident(), MAT.enamelRed, { r: 0.17, h: 0.06, seg: 48 });
    badge.torus(M.ident(), MAT.gold, { R: 0.17, r: 0.022, su: 48, sv: 8 });
    const arrow = [[-0.032, 0.1], [0.032, 0.1], [0.032, 0.0], [0.085, 0.0], [0, -0.09], [-0.085, 0.0], [-0.032, 0.0]];
    for (const s of [1, -1]) badge.extrude(M.chain(M.trans(0, 0.005, s * 0.035), M.rotY(s > 0 ? 0 : Math.PI)), MAT.enamelCream, arrow, 0.016, { center: [0, -0.01] });
    return { geo: g, size: 1.2, parts: [part(badge, (t) => M.chain(M.trans(0.36, 0.7 + Math.sin(t * 2.1) * 0.035, 0.16), M.rotY(Math.sin(t * 1.2) * 0.6)))] };
  },
  // Тулпар: подкова на удачу с золотым желобком, крыльями из эмалевых перьев и камнем в центре
  horseshoe() {
    const g = new Geo();
    const O = M.trans(0, -0.1, 0);
    const a0 = Math.PI * 0.92, a1 = Math.PI * 2.08, bottom = Math.PI * 1.5;
    g.band(O, MAT.silver, 0.4, 0.64, 0.12, { a0, a1, seg: 72 });
    g.band(M.chain(O, M.trans(0, 0, 0.061)), MAT.gold, 0.5, 0.54, 0.008, { a0: a0 + 0.08, a1: a1 - 0.08, seg: 72 });
    for (const [s, e] of [[a0 + 0.25, bottom - 0.4], [bottom + 0.4, a1 - 0.25]])
      for (let i = 0; i < 3; i++) {
        const a = s + ((e - s) * i) / 2;
        g.cylinder(M.chain(O, M.trans(Math.cos(a) * 0.52, Math.sin(a) * 0.52, 0.064)), MAT.hole, { r: 0.024, h: 0.012, seg: 14 });
      }
    for (const a of [a0, a1]) g.bevelBox(M.chain(O, M.trans(Math.cos(a) * 0.52, Math.sin(a) * 0.52, 0), M.rotZ(a)), MAT.gold, 0.27, 0.09, 0.15, 0.02);
    g.star(M.chain(O, M.trans(0, -0.52, 0.064)), MAT.enamelRed, { r: 0.12, inner: 0.05, h: 0.045 });
    // Крылья Тулпара: пять перьев веером, кремовая эмаль с золотом, у основания — золотая «плечевая» пластина
    for (const s of [-1, 1]) {
      const bx = s * 0.6, by = 0.06;
      for (let k = 0; k < 5; k++) {
        const ang = s > 0 ? 0.12 + k * 0.3 : Math.PI - 0.12 - k * 0.3, len = 0.62 - k * 0.075;
        const feather = Array.from({ length: 28 }, (_, i) => {
          const u = (i / 28) * TAU;
          return [Math.cos(u) * len * 0.5, Math.sin(u) * 0.06 * (Math.cos(u) > 0 ? 1 - 0.55 * Math.cos(u) : 1)];
        });
        g.extrude(M.chain(M.trans(bx + Math.cos(ang) * len * 0.48, by + Math.sin(ang) * len * 0.48, -0.02 - k * 0.014), M.rotZ(ang)), k % 2 ? MAT.goldPale : MAT.enamelCream, feather, 0.028, { bevel: 0.008, smooth: true });
      }
      g.extrude(M.chain(M.trans(bx, by, 0.02), M.rotZ(s > 0 ? 0.5 : Math.PI - 0.5)), MAT.gold, S2.ellipse(0.13, 0.08, 24), 0.05, { bevel: 0.012, smooth: true });
    }
    const gem = new Geo();
    gem.crystal(M.scale(0.36), MAT.gemGold, { sides: 14 });
    return { geo: g, size: 1.3, parts: [part(gem, (t) => M.chain(M.trans(0, 0.0 + Math.sin(t * 1.6) * 0.04, 0), M.rotY(t * 1.1)))] };
  },
  // Закрытый чат: эмалевое облачко-радиоприёмник с антенной и «печатающими» точками
  chat() {
    const g = new Geo();
    g.extrude(M.ident(), MAT.enamelTeal, S2.roundRect(1.5, 0.96, 0.3, 10), 0.22, { bevel: 0.05, smooth: true });
    g.extrude(M.ident(), MAT.enamelTeal, [[-0.5, -0.36], [-0.16, -0.4], [-0.64, -0.8]], 0.16, { bevel: 0.03 });
    g.extrude(M.trans(0, 0.02, 0.112), MAT.enamelCream, S2.roundRect(1.22, 0.66, 0.2, 8), 0.012, { bevel: 0.004 });
    for (const x of [-0.6, 0.6]) g.sphere(M.trans(x, 0.0, 0.112), MAT.brass, { r: 0.022, su: 10, sv: 6 });
    g.tube(M.ident(), MAT.steel, spline([[0.44, 0.46, 0], [0.5, 0.64, 0], [0.57, 0.82, 0], [0.62, 0.96, 0]], 4), 0.018, { seg: 10 });
    g.sphere(M.trans(0.62, 0.98, 0), MAT.enamelRed, { r: 0.05, su: 18, sv: 10 });
    for (let i = 0; i < 2; i++) {
      g.torus(M.chain(M.trans(0.62, 0.98, 0), M.rotZ(-0.5)), MAT.goldPale, { R: 0.11 + i * 0.07, r: 0.012, su: 22, sv: 6, arc: 0.16 });
      g.torus(M.chain(M.trans(0.62, 0.98, 0), M.rotZ(Math.PI - 0.5)), MAT.goldPale, { R: 0.11 + i * 0.07, r: 0.012, su: 22, sv: 6, arc: 0.16 });
    }
    const dots = [0, 1, 2].map((i) => {
      const d = new Geo();
      d.sphere(M.ident(), [MAT.enamelRed, MAT.gold, MAT.enamelNavy][i], { r: 0.095, su: 22, sv: 14 });
      return part(d, (t) => M.trans(-0.36 + i * 0.36, 0.02 + Math.max(0, Math.sin(t * 4 - i * 0.9)) * 0.1, 0.17));
    });
    return { geo: g, size: 1.2, parts: dots };
  },
  // Имя в титрах: хлопушка с хлопающей планкой и киноплёночная бобина
  clapper() {
    const g = new Geo();
    const reel = M.trans(0.44, 0.48, -0.17);
    g.cylinder(reel, MAT.steel, { r: 0.42, h: 0.04, seg: 64 });
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * TAU + Math.PI / 2;
      g.cylinder(M.chain(reel, M.trans(Math.cos(a) * 0.23, Math.sin(a) * 0.23, 0)), MAT.hole, { r: 0.09, h: 0.05, seg: 24 });
    }
    g.cylinder(M.chain(reel, M.trans(0, 0, 0)), MAT.gold, { r: 0.07, h: 0.07, seg: 24 });
    g.torus(reel, MAT.goldPale, { R: 0.42, r: 0.015, su: 64, sv: 6 });
    g.extrude(M.ident(), MAT.black, S2.roundRect(1.4, 0.92, 0.04, 3), 0.08, { bevel: 0.015 });
    for (const y of [0.0, -0.2]) g.bevelBox(M.trans(0, y, 0.042), MAT.enamelCream, 1.2, 0.022, 0.006, 0.002);
    g.bevelBox(M.trans(0.1, -0.1, 0.042), MAT.enamelCream, 0.022, 0.2, 0.006, 0.002);
    g.extrude(M.trans(-0.32, 0.22, 0.042), MAT.enamelCream, S2.roundRect(0.5, 0.05, 0.02), 0.006);
    g.extrude(M.trans(0.34, 0.22, 0.042), MAT.gold, S2.roundRect(0.34, 0.05, 0.02), 0.006);
    g.star(M.trans(-0.45, -0.31, 0.045), MAT.enamelRed, { r: 0.09, inner: 0.038, h: 0.03 });
    const stripe = [[-0.08, -0.085], [0.0, -0.085], [0.09, 0.085], [0.01, 0.085]];
    g.bevelBox(M.trans(0, 0.55, 0), MAT.black, 1.4, 0.17, 0.09, 0.012);
    for (let i = 0; i < 5; i++) g.extrude(M.trans(-0.52 + i * 0.26, 0.55, 0.046), MAT.enamelCream, stripe, 0.006);
    g.cylinder(M.trans(-0.66, 0.68, 0), MAT.steel, { r: 0.045, h: 0.13, seg: 20 });
    const stick = new Geo();
    stick.bevelBox(M.trans(0.7, 0, 0), MAT.black, 1.4, 0.17, 0.09, 0.012);
    for (let i = 0; i < 5; i++) stick.extrude(M.trans(0.7 - 0.52 + i * 0.26, 0, 0.046), i % 2 ? MAT.gold : MAT.enamelCream, stripe.map(([x, y]) => [x, -y]), 0.006);
    const clap = (t) => {
      const ph = (t * 0.5) % 1;
      const open = ph < 0.07 ? 1 - ph / 0.07 : Math.min(1, (ph - 0.07) / 0.4);
      return M.chain(M.trans(-0.66, 0.72, 0), M.rotZ(0.015 + 0.33 * smooth01(open)));
    };
    return { geo: g, size: 1.3, parts: [part(stick, clap)] };
  },
  // Монета AB Points: биметалл (золотое кольцо, стальной центр), рифлёный гурт, знак из двух колец, звёзды
  coin() {
    const g = new Geo();
    g.band(M.ident(), MAT.gold, 0.4, 0.62, 0.14, { seg: 96 });
    g.cylinder(M.ident(), MAT.silver, { r: 0.405, h: 0.12, seg: 80 });
    for (const z of [0.07, -0.07]) {
      g.torus(M.trans(0, 0, z), MAT.goldPale, { R: 0.6, r: 0.022, su: 96, sv: 8 });
      g.torus(M.trans(0, 0, z * 0.86), MAT.goldPale, { R: 0.405, r: 0.012, su: 80, sv: 6 });
    }
    for (let i = 0; i < 96; i++) g.bevelBox(M.chain(M.rotZ((i / 96) * TAU), M.trans(0.622, 0, 0)), MAT.goldPale, 0.018, 0.016, 0.12, 0.004);
    g.torus(M.trans(-0.12, 0, 0.064), MAT.skyMetal, { R: 0.2, r: 0.042, su: 48, sv: 12 });
    g.torus(M.trans(0.12, 0, 0.064), MAT.goldPale, { R: 0.2, r: 0.042, su: 48, sv: 12 });
    for (let i = 0; i < 8; i++) g.star(M.chain(M.rotZ((i / 8) * TAU + Math.PI / 2), M.trans(0, 0.51, 0.07)), MAT.enamelRed, { r: 0.065, inner: 0.028, h: 0.03 });
    g.extrude(M.trans(0, 0, -0.064), MAT.steel, S2.star(16, 0.33, 0.2), 0.012);
    g.star(M.chain(M.trans(0, 0, -0.07), M.rotY(Math.PI)), MAT.gold, { r: 0.18, inner: 0.075, h: 0.05 });
    return { geo: g, size: 1.2 };
  },
  // Геймпад в стиле ретро: кремовый корпус с рукоятками, красная панель, крестовина, стики, курки
  gamepad() {
    const g = new Geo();
    const shell = MAT.enamelCream;
    g.extrude(M.ident(), shell, S2.roundRect(1.12, 0.6, 0.26, 10), 0.26, { bevel: 0.07, smooth: true });
    for (const s of [-1, 1]) g.sphere(M.chain(M.trans(s * 0.5, -0.2, -0.01), M.rotZ(s * 0.5), M.scale3(0.24, 0.36, 0.15)), shell, { r: 1, su: 32, sv: 18 });
    g.extrude(M.trans(0, 0.1, 0.131), MAT.enamelRed, S2.roundRect(0.36, 0.22, 0.08, 6), 0.012);
    g.star(M.trans(0, 0.1, 0.138), MAT.gold, { r: 0.075, inner: 0.032, h: 0.03 });
    const cross = [[-0.035, 0.11], [0.035, 0.11], [0.035, 0.035], [0.11, 0.035], [0.11, -0.035], [0.035, -0.035], [0.035, -0.11], [-0.035, -0.11], [-0.035, -0.035], [-0.11, -0.035], [-0.11, 0.035], [-0.035, 0.035]];
    g.extrude(M.trans(-0.42, 0.04, 0.115), MAT.enamelNavy, S2.circle(0.14, 32), 0.03);
    g.extrude(M.trans(-0.42, 0.04, 0.14), MAT.black, cross, 0.05, { bevel: 0.01, center: [0, 0] });
    g.extrude(M.trans(0.42, 0.04, 0.115), MAT.enamelNavy, S2.circle(0.16, 32), 0.03);
    for (const [x, y, mt] of [[0.42, 0.14, MAT.gold], [0.52, 0.04, MAT.enamelRed], [0.32, 0.04, MAT.enamelTeal], [0.42, -0.06, MAT.enamelCream]]) {
      g.sphere(M.chain(M.trans(x, y, 0.135), M.scale3(1, 1, 0.6)), mt, { r: 0.045, su: 20, sv: 12 });
      g.torus(M.trans(x, y, 0.132), MAT.goldPale, { R: 0.05, r: 0.007, su: 24, sv: 6 });
    }
    for (const x of [-0.17, 0.17]) {
      g.cylinder(M.trans(x, -0.13, 0.12), MAT.black, { r: 0.085, h: 0.04, seg: 28 });
      g.lathe(M.chain(M.trans(x, -0.13, 0.13), M.rotX(Math.PI / 2)), MAT.enamelNavy, [[0.03, 0], [0.03, 0.05], [0.07, 0.066], [0.075, 0.09], [0.06, 0.104], [0, 0.098]], 28);
    }
    for (const x of [-0.06, 0.06]) g.extrude(M.trans(x, -0.035, 0.132), MAT.enamelNavy, S2.roundRect(0.07, 0.024, 0.012), 0.01);
    for (const s of [-1, 1]) g.extrude(M.chain(M.trans(s * 0.36, 0.29, -0.03), M.rotX(Math.PI / 2)), MAT.enamelRed, S2.roundRect(0.28, 0.13, 0.05, 6), 0.06, { bevel: 0.015 });
    return { geo: g, size: 1.12 };
  },
  // Кубок: точёная чаша с кантом, изогнутые ручки, ножка с камнями, ступенчатый постамент и табличка
  trophy() {
    const g = new Geo();
    g.lathe(M.ident(), MAT.gold, [[0, -0.06], [0.1, -0.05], [0.24, 0.02], [0.36, 0.14], [0.43, 0.3], [0.46, 0.46], [0.47, 0.58], [0.5, 0.62], [0.47, 0.645], [0.44, 0.6], [0.42, 0.46], [0.38, 0.3], [0.3, 0.17], [0.15, 0.08], [0, 0.06]], 72);
    g.torus(M.chain(M.trans(0, 0.43, 0), M.rotX(Math.PI / 2)), MAT.enamelRed, { R: 0.458, r: 0.02, su: 72, sv: 8 });
    g.torus(M.chain(M.trans(0, 0.15, 0), M.rotX(Math.PI / 2)), MAT.goldPale, { R: 0.365, r: 0.014, su: 72, sv: 8 });
    g.lathe(M.ident(), MAT.goldPale, [[0, -0.06], [0.07, -0.08], [0.06, -0.2], [0.12, -0.26], [0.13, -0.3], [0.12, -0.34], [0.06, -0.4], [0.07, -0.5], [0.16, -0.56], [0.2, -0.6], [0, -0.6]], 48);
    for (let k = 0; k < 4; k++) {
      const u = (k / 4) * TAU + Math.PI / 4;
      g.crystal(M.chain(M.trans(Math.cos(u) * 0.13, -0.3, Math.sin(u) * 0.13), M.rotY(-u), M.rotZ(-Math.PI / 2), M.scale(0.08)), MAT.gemSky, { sides: 8 });
    }
    for (const s of [-1, 1]) g.tube(M.ident(), MAT.gold, spline([[s * 0.43, 0.5, 0], [s * 0.6, 0.56, 0], [s * 0.71, 0.45, 0], [s * 0.66, 0.29, 0], [s * 0.52, 0.18, 0], [s * 0.37, 0.12, 0]], 6), 0.034, { seg: 12 });
    g.extrude(M.chain(M.trans(0, 0.34, 0.425), M.rotX(-0.24)), MAT.gold, S2.star(5, 0.17, 0.075), 0.02, { bevel: 0.005 });
    g.star(M.chain(M.trans(0, 0.34, 0.437), M.rotX(-0.24)), MAT.enamelRed, { r: 0.14, inner: 0.06, h: 0.05 });
    const flat = (y) => M.chain(M.trans(0, y, 0), M.rotX(-Math.PI / 2));
    g.extrude(flat(-0.7), MAT.enamelRed, S2.roundRect(0.62, 0.5, 0.05, 4), 0.2, { bevel: 0.02 });
    g.extrude(flat(-0.86), MAT.enamelNavy, S2.roundRect(0.76, 0.62, 0.05, 4), 0.11, { bevel: 0.02 });
    g.bevelBox(M.trans(0, -0.7, 0.253), MAT.gold, 0.38, 0.09, 0.008, 0.003);
    return { geo: g, size: 1.25 };
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
  // Спутник-1: полированная сфера с фланцем, четыре стреловидные антенны в золотых гнёздах; вокруг летит звезда
  sputnik() {
    const g = new Geo();
    const B = M.trans(0.12, 0, 0);
    g.sphere(B, MAT.steel, { r: 0.42, su: 56, sv: 32 });
    g.torus(M.chain(B, M.rotY(Math.PI / 2)), MAT.gold, { R: 0.422, r: 0.018, su: 84, sv: 8 });
    for (let k = 0; k < 6; k++) {
      const u = (k / 6) * TAU;
      g.sphere(M.chain(B, M.trans(0, Math.cos(u) * 0.425, Math.sin(u) * 0.425)), MAT.goldPale, { r: 0.016, su: 8, sv: 5 });
    }
    for (let k = 0; k < 4; k++) {
      const az = (k / 4) * TAU + Math.PI / 4;
      const base = [0.25, Math.cos(az) * 0.33, Math.sin(az) * 0.33];
      const A = M.chain(B, M.trans(...base), alignY([-1, Math.cos(az) * 0.42, Math.sin(az) * 0.42]));
      g.lathe(A, MAT.gold, [[0.046, -0.03], [0.042, 0.03], [0.024, 0.07], [0.017, 0.095]], 16);
      g.lathe(A, MAT.silver, [[0.014, 0.07], [0.011, 0.6], [0.008, 1.04], [0, 1.06]], 10);
      g.sphere(M.chain(A, M.trans(0, 1.05, 0)), MAT.gold, { r: 0.02, su: 10, sv: 6 });
    }
    const sat = new Geo();
    sat.star(M.trans(0.0, 0, 0), MAT.enamelRed, { r: 0.1, inner: 0.042, h: 0.04 });
    sat.star(M.rotY(Math.PI), MAT.enamelRed, { r: 0.1, inner: 0.042, h: 0.04 });
    return { geo: g, size: 1.15, parts: [part(sat, (t) => M.chain(M.trans(0.12, 0, 0), M.rotX(0.5), M.rotY(t * 0.9), M.trans(0, 0, 0.62), M.rotY(t * 2)))] };
  },
  // Планета: эмалевые полосы атмосферы, три кольца с щелями, луна и маленький спутник на своих орбитах
  planet() {
    const g = new Geo();
    const tilt = M.rotZ(0.22);
    const bands = [MAT.enamelCream, MAT.gold, MAT.enamelRed, MAT.enamelCream, MAT.gold, MAT.enamelTeal, MAT.enamelCream, MAT.gold];
    const R = 0.55, n = bands.length;
    for (let b = 0; b < n; b++) {
      const v0 = (b / n) * Math.PI, v1 = ((b + 1) / n) * Math.PI;
      const prof = Array.from({ length: 6 }, (_, i) => {
        const v = v0 + ((v1 - v0) * i) / 5;
        return [Math.sin(v) * R, Math.cos(v) * R];
      });
      g.lathe(tilt, { ...bands[b], rough: 0.42, metal: 0.05 }, prof, 64);
    }
    const ringM = M.chain(tilt, M.rotX(0.36));
    for (const [r0, r1, mt] of [[0.72, 0.86, MAT.enamelCream], [0.9, 1.0, MAT.gold], [1.04, 1.1, MAT.enamelRed]])
      g.lathe(ringM, { ...mt, rough: 0.35 }, [[r0, 0.007], [r1, 0.007], [r1, -0.007], [r0, -0.007], [r0, 0.007]], 96);
    const moon = new Geo();
    moon.sphere(M.ident(), MAT.skyPlastic, { r: 0.1, su: 24, sv: 14 });
    for (const [x, y, z] of [[0.05, 0.05, 0.07], [-0.06, -0.02, 0.07], [0.02, -0.07, 0.06]]) moon.sphere(M.trans(x, y, z), MAT.tealPlastic, { r: 0.022, su: 10, sv: 6 });
    const sat = new Geo();
    sat.sphere(M.ident(), MAT.steel, { r: 0.035, su: 14, sv: 8 });
    for (const s of [-1, 1]) sat.bevelBox(M.trans(s * 0.075, 0, 0), MAT.enamelTeal, 0.08, 0.04, 0.006, 0.002);
    return {
      geo: g,
      size: 1.45,
      parts: [part(moon, (t) => M.chain(tilt, M.rotX(-0.45), M.rotY(t * 0.55), M.trans(1.26, 0, 0))), part(sat, (t) => M.chain(tilt, M.rotX(1.15), M.rotY(-t * 1.1), M.trans(0, 0, 0.66)))],
    };
  },
  // Аби — маскот и ИИ-ассистент: жёлтая «капсула» с глазами, моргает, машет, говорит, держит монету AB
  abi() {
    const g = new Geo();
    const prof = [[0, -0.62], [0.2, -0.6], [0.34, -0.53], [0.43, -0.39], [0.47, -0.2], [0.475, 0], [0.465, 0.2], [0.43, 0.4], [0.36, 0.56], [0.25, 0.69], [0.12, 0.765], [0, 0.78]];
    const R = (y) => {
      for (let i = 0; i < prof.length - 1; i++) {
        const [r0, y0] = prof[i], [r1, y1] = prof[i + 1];
        if (y >= y0 && y <= y1) return r0 + ((r1 - r0) * (y - y0)) / (y1 - y0 || 1);
      }
      return 0;
    };
    const zAt = (x, y, off = 0) => Math.sqrt(Math.max(0, R(y) ** 2 - x * x)) + off;
    g.lathe(M.ident(), MAT.abi, prof, 72);
    // Щёки, брови, улыбка
    for (const sx of [-1, 1]) {
      g.sphere(M.chain(M.trans(sx * 0.27, 0.2, zAt(0.27, 0.2, -0.012)), M.rotY(sx * 0.55), M.scale3(0.065, 0.04, 0.02)), MAT.cheek, { r: 1, su: 18, sv: 10 });
      g.tube(M.ident(), MAT.brow, spline([[sx * 0.25, 0.53, zAt(0.25, 0.53, 0.005)], [sx * 0.165, 0.575, zAt(0.165, 0.575, 0.012)], [sx * 0.08, 0.56, zAt(0.08, 0.56, 0.012)]], 6), 0.017);
    }
    g.tube(M.ident(), MAT.brow, spline([-0.12, -0.06, 0, 0.06, 0.12].map((x) => [x, 0.215 - 0.06 * Math.cos((x / 0.12) * (Math.PI / 2)), zAt(x, 0.19, 0.006)]), 5), 0.016);
    // Красная звезда-значок на груди
    g.star(M.chain(M.trans(0.3, -0.06, zAt(0.3, -0.06, 0.004)), M.rotY(0.6)), MAT.enamelRed, { r: 0.065, inner: 0.027, h: 0.022 });
    // Левая рука держит монету перед животом
    g.tube(M.ident(), MAT.abi, spline([[-0.43, 0.02, 0.05], [-0.54, -0.16, 0.22], [-0.33, -0.3, 0.46]], 8), 0.052);
    g.sphere(M.trans(-0.3, -0.31, 0.49), MAT.abi, { r: 0.075, su: 20, sv: 12 });
    // Плечо правой руки (сама рука — подвижная деталь)
    g.sphere(M.trans(0.43, 0.02, 0.05), MAT.abi, { r: 0.058, su: 16, sv: 10 });

    // Глаза: белки моргают, зрачки смотрят и моргают вместе с ними
    const EY = 0.38, EX = 0.155;
    const whites = new Geo(), pupils = new Geo();
    for (const sx of [-1, 1]) {
      const z = zAt(EX, EY, -0.035);
      whites.sphere(M.chain(M.trans(sx * EX, EY, z), M.rotY(sx * 0.32), M.scale3(0.105, 0.125, 0.075)), MAT.eyeWhite, { r: 1, su: 24, sv: 14 });
      const pz = z + 0.07;
      pupils.sphere(M.chain(M.trans(sx * EX + 0.008, EY - 0.01, pz), M.scale3(0.058, 0.065, 0.03)), MAT.iris, { r: 1, su: 18, sv: 10 });
      pupils.sphere(M.chain(M.trans(sx * EX + 0.008, EY - 0.01, pz + 0.02), M.scale3(0.034, 0.04, 0.02)), MAT.black, { r: 1, su: 14, sv: 8 });
      pupils.sphere(M.trans(sx * EX - 0.014, EY + 0.022, pz + 0.035), MAT.eyeWhite, { r: 0.016, su: 8, sv: 6 });
    }
    const blink = (t) => {
      const k = t % 4.3;
      return k < 0.13 ? Math.max(0.08, Math.abs(Math.cos((k / 0.13) * Math.PI))) : 1;
    };
    const aroundEyes = (sy) => M.chain(M.trans(0, EY, 0), M.scale3(1, sy, 1), M.trans(0, -EY, 0));
    const look = (t) => {
      if (ABI.mood === 'think') return [0.022, 0.03];
      if (ABI.mood === 'talk') return [0, -0.004];
      return [Math.sin(t * 0.7) * 0.012 + ABI.look[0] * 0.02, Math.sin(t * 0.5 + 1) * 0.006 + ABI.look[1] * 0.02];
    };

    // Рот: открывается, когда Аби говорит
    const mouth = new Geo();
    mouth.sphere(M.chain(M.trans(0, 0.165, zAt(0, 0.165, -0.008)), M.scale3(0.075, 0.05, 0.03)), MAT.mouth, { r: 1, su: 18, sv: 10 });
    mouth.sphere(M.chain(M.trans(0, 0.14, zAt(0, 0.14, 0.006)), M.scale3(0.04, 0.018, 0.012)), MAT.cheek, { r: 1, su: 12, sv: 6 });
    const MY = 0.165;

    // Правая рука машет
    const arm = new Geo();
    arm.tube(M.ident(), MAT.abi, spline([[0, 0, 0], [0.13, 0.13, 0.03], [0.17, 0.34, 0.07]], 8), 0.052);
    arm.sphere(M.trans(0.175, 0.39, 0.08), MAT.abi, { r: 0.077, su: 20, sv: 12 });
    for (let k = 0; k < 3; k++) arm.sphere(M.trans(0.13 + k * 0.04, 0.46, 0.09), MAT.abiShade, { r: 0.026, su: 10, sv: 6 });

    // Монета с буквами AB (как на значке)
    const coin = new Geo();
    coin.cylinder(M.ident(), MAT.gold, { r: 0.23, h: 0.06, seg: 64, capMat: MAT.enamelCream });
    coin.torus(M.trans(0, 0, 0.031), MAT.gold, { R: 0.19, r: 0.008, su: 64, sv: 6 });
    for (const z of [0.03, -0.03]) coin.torus(M.trans(0, 0, z), MAT.goldPale, { R: 0.225, r: 0.014, su: 64, sv: 8 });
    const L = (m) => M.chain(M.trans(0, 0, 0.034), m);
    // «A»
    coin.bevelBox(L(M.chain(M.trans(-0.098, -0.005, 0), M.rotZ(-0.33))), MAT.iris, 0.032, 0.17, 0.022, 0.006);
    coin.bevelBox(L(M.chain(M.trans(-0.042, -0.005, 0), M.rotZ(0.33))), MAT.iris, 0.032, 0.17, 0.022, 0.006);
    coin.bevelBox(L(M.trans(-0.07, -0.03, 0)), MAT.iris, 0.06, 0.026, 0.022, 0.006);
    // «B»
    coin.bevelBox(L(M.trans(0.035, 0, 0)), MAT.iris, 0.03, 0.17, 0.022, 0.006);
    coin.torus(L(M.chain(M.trans(0.05, 0.041, 0), M.rotZ(-Math.PI / 2))), MAT.iris, { R: 0.038, r: 0.014, su: 24, sv: 8, arc: 0.5 });
    coin.torus(L(M.chain(M.trans(0.05, -0.043, 0), M.rotZ(-Math.PI / 2))), MAT.iris, { R: 0.042, r: 0.014, su: 24, sv: 8, arc: 0.5 });
    const CO = [-0.06, -0.3, 0.53];

    // Ноги шагают при ходьбе
    const legs = [-1, 1].map((sx) => {
      const leg = new Geo();
      leg.tube(M.ident(), MAT.abiShade, [[0, 0, 0], [sx * 0.01, -0.14, 0.01], [sx * 0.02, -0.26, 0.02]], 0.055);
      leg.sphere(M.chain(M.trans(sx * 0.025, -0.3, 0.07), M.scale3(0.1, 0.055, 0.14)), MAT.enamelTeal, { r: 1, su: 20, sv: 10 });
      return [sx, leg];
    });

    return {
      geo: g,
      size: 0.98,
      parts: [
        part(whites, (t) => aroundEyes(blink(t))),
        part(pupils, (t) => {
          const [lx, ly] = look(t);
          return M.chain(aroundEyes(blink(t)), M.trans(lx, ly, 0));
        }),
        part(mouth, (t) => {
          const open = ABI.mood === 'talk' ? 0.55 + 0.45 * Math.abs(Math.sin(t * 11)) : ABI.mood === 'happy' ? 0.9 : 0.02;
          return M.chain(M.trans(0, MY, 0), M.scale3(1, open, 1), M.trans(0, -MY, 0));
        }),
        part(arm, (t) => {
          const m = ABI.mood;
          const waving = m === 'wave' || m === 'happy' || (m === 'idle' && t % 7 < 1.3);
          const a = waving ? 0.25 + 0.45 * Math.sin(t * 10) : m === 'think' ? 1.05 : m === 'walk' ? -0.9 + 0.3 * Math.sin(t * 9) : -0.25 + 0.06 * Math.sin(t * 1.6);
          return M.chain(M.trans(0.43, 0.02, 0.05), M.rotZ(-a + (waving ? 0 : -0.2)));
        }),
        part(coin, (t) => M.chain(M.trans(...CO), M.rotY(ABI.mood === 'happy' ? t * 7 : Math.sin(t * 1.1) * 0.25), M.rotX(-0.12))),
        ...legs.map(([sx, leg]) =>
          part(leg, (t) => M.chain(M.trans(sx * 0.17, -0.56, 0), M.rotX(ABI.mood === 'walk' ? sx * 0.5 * Math.sin(t * 9) : 0)))
        ),
      ],
    };
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
    const upload = (geo) => ({ pos: buf(geo.pos), nor: buf(geo.nor), col: buf(geo.col), mat: buf(geo.mat), count: geo.pos.length / 3 });
    // Подвижные детали (кольца гироскопа, луна, планка хлопушки) — отдельные буферы со своей анимацией
    const m = { ...upload(model.geo), size: model.size, parts: (model.parts || []).map((p) => ({ ...upload(p.geo), anim: p.anim })) };
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
      if (v.floor) {
        gl.depthMask(false);
        this.draw(this.floorMesh, M.trans(0, FLOOR_Y, 0), { floor: 1 });
        gl.depthMask(true);
      }
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
  constructor(stage, el, { model = 'logo', variant = 0, autoRotate = true, wheel = false, touch = 'pan-y', float = true, onTap = null, distance = 3.6, theta = 0.5, phi = 1.22, floor = true, target = [0, -0.08, 0] } = {}) {
    Object.assign(this, { stage, el, model, variant, autoRotate: autoRotate && !REDUCED, wheel, float: float && !REDUCED, onTap, floor, target });
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
    gl.uniformMatrix4fv(s.loc.uView, false, M.lookAt(eye, this.target, [0, 1, 0]));
    gl.uniform3fv(s.loc.uCam, eye);
  }
  // Объекты витрины: [меш, матрица, параметры]
  models() {
    const bob = this.float ? Math.sin(this.time * 1.3) * 0.07 : 0;
    const tilt = this.float ? Math.sin(this.time * 0.7) * 0.05 : 0;
    const base = M.chain(M.trans(0, bob, 0), M.rotZ(tilt), M.scale(1 / this.mesh.size));
    const list = [[this.mesh, base, { glow: this.glow }]];
    const t = REDUCED ? 1.3 : this.time;
    for (const p of this.mesh.parts) list.push([p, M.mul(base, p.anim(t)), { glow: this.glow }]);
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
