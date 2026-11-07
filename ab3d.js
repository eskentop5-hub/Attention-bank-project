// AB3D — компактный 3D-движок ATTENTION BANK на чистом WebGL (без библиотек).
// Возможности: процедурные модели, трёхточечный свет (золотой key, синий fill, неоновый rim),
// орбитальное управление с затуханием (мышь, тач, щипок, колесо, клавиатура), авто-вращение
// с паузой при взаимодействии, парение, «взрыв» золотых кристаллов.
// Один WebGL-контекст на страницу: каждая витрина рисуется в свою область (scissor).

const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;

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
    // Для поворотов + равномерного масштаба нормаль = нормализованная верхняя 3×3
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

// ---------------- Геометрия ----------------
class Geo {
  constructor() {
    this.pos = [];
    this.nor = [];
    this.col = [];
  }
  tri(a, b, c, color, na, nb, nc) {
    if (!na) {
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const l = Math.hypot(...n) || 1;
      n = [n[0] / l, n[1] / l, n[2] / l];
      na = nb = nc = n;
    }
    this.pos.push(...a, ...b, ...c);
    this.nor.push(...na, ...nb, ...nc);
    this.col.push(...color, ...color, ...color);
  }
  quad(a, b, c, d, color) {
    this.tri(a, b, c, color);
    this.tri(a, c, d, color);
  }
  // Огранённый кристалл: площадка → корона → рундист → павильон
  crystal(m, color, { sides = 8, r = 0.5, crown = 0.22, table = 0.62, pavilion = 0.62 } = {}) {
    const ring = (rad, y, off = 0) => Array.from({ length: sides }, (_, i) => {
      const a = (i / sides) * Math.PI * 2 + off;
      return tp(m, [Math.cos(a) * rad, y, Math.sin(a) * rad]);
    });
    const top = ring(r * table, crown, Math.PI / sides), girdle = ring(r, 0), center = tp(m, [0, crown, 0]), tip = tp(m, [0, -pavilion, 0]);
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides;
      this.tri(center, top[j], top[i], color);
      this.tri(top[i], top[j], girdle[j], color);
      this.tri(top[i], girdle[j], girdle[i], color);
      this.tri(girdle[i], girdle[j], tip, color);
    }
  }
  torus(m, color, { R = 0.6, r = 0.12, su = 64, sv = 20 } = {}) {
    const P = (u, v) => [(R + r * Math.cos(v)) * Math.cos(u), (R + r * Math.cos(v)) * Math.sin(u), r * Math.sin(v)];
    const N = (u, v) => [Math.cos(v) * Math.cos(u), Math.cos(v) * Math.sin(u), Math.sin(v)];
    for (let i = 0; i < su; i++)
      for (let j = 0; j < sv; j++) {
        const u0 = (i / su) * 2 * Math.PI, u1 = ((i + 1) / su) * 2 * Math.PI, v0 = (j / sv) * 2 * Math.PI, v1 = ((j + 1) / sv) * 2 * Math.PI;
        const a = tp(m, P(u0, v0)), b = tp(m, P(u1, v0)), c = tp(m, P(u1, v1)), d = tp(m, P(u0, v1));
        const na = tn(m, N(u0, v0)), nb = tn(m, N(u1, v0)), nc = tn(m, N(u1, v1)), nd = tn(m, N(u0, v1));
        this.tri(a, b, c, color, na, nb, nc);
        this.tri(a, c, d, color, na, nc, nd);
      }
  }
  box(m, color, w, h, d) {
    const x = w / 2, y = h / 2, z = d / 2;
    const v = [[-x, -y, z], [x, -y, z], [x, y, z], [-x, y, z], [-x, -y, -z], [x, -y, -z], [x, y, -z], [-x, y, -z]].map((p) => tp(m, p));
    const f = [[0, 1, 2, 3], [5, 4, 7, 6], [4, 0, 3, 7], [1, 5, 6, 2], [3, 2, 6, 7], [4, 5, 1, 0]];
    for (const [a, b, c, dd] of f) this.quad(v[a], v[b], v[c], v[dd], color);
  }
  // Цилиндр вдоль оси Z (лицевая сторона к камере)
  cylinder(m, color, { r = 0.5, h = 0.1, seg = 48, capColor = color } = {}) {
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * 2 * Math.PI, a1 = ((i + 1) / seg) * 2 * Math.PI;
      const p = (a, z) => tp(m, [Math.cos(a) * r, Math.sin(a) * r, z]);
      const n = (a) => tn(m, [Math.cos(a), Math.sin(a), 0]);
      const A = p(a0, h / 2), B = p(a1, h / 2), C = p(a1, -h / 2), D = p(a0, -h / 2);
      this.tri(A, D, C, color, n(a0), n(a0), n(a1));
      this.tri(A, C, B, color, n(a0), n(a1), n(a1));
      this.tri(tp(m, [0, 0, h / 2]), A, B, capColor);
      this.tri(tp(m, [0, 0, -h / 2]), C, D, capColor);
    }
  }
  // Пятиконечная звезда-призма (в плоскости XY, толщина по Z)
  star(m, color, { r = 0.36, inner = 0.15, h = 0.08 } = {}) {
    const pts = Array.from({ length: 10 }, (_, i) => {
      const a = Math.PI / 2 + (i * Math.PI) / 5, rad = i % 2 ? inner : r;
      return [Math.cos(a) * rad, Math.sin(a) * rad];
    });
    const f = tp(m, [0, 0, h / 2]), b = tp(m, [0, 0, -h / 2]);
    for (let i = 0; i < 10; i++) {
      const j = (i + 1) % 10;
      const pf = tp(m, [pts[i][0], pts[i][1], h / 2]), qf = tp(m, [pts[j][0], pts[j][1], h / 2]);
      const pb = tp(m, [pts[i][0], pts[i][1], -h / 2]), qb = tp(m, [pts[j][0], pts[j][1], -h / 2]);
      this.tri(f, pf, qf, color);
      this.tri(b, qb, pb, color);
      this.quad(pf, pb, qb, qf, color);
    }
  }
}

// ---------------- Модели ----------------
const GOLD = hex('#F2B705'), GOLD_L = hex('#FFD34D'), SKY = hex('#19B3D4'), SKY_D = hex('#0B6F87'), MINT = hex('#3CCF9A'), CREAM = hex('#FFF4CC'), NAVY = hex('#13243A'), CORAL = hex('#EF6B4F');
const PALETTES = [[SKY, GOLD, MINT], [GOLD, SKY, CORAL], [MINT, GOLD, SKY], [CORAL, SKY, GOLD]];

// Каждая модель: { geo, spec (сила бликов), size (радиус для камеры) }
export const MODELS = {
  // Знак ATTENTION BANK: бирюзовое кольцо «внимания» сцеплено с золотым кольцом «ценности»
  logo() {
    const g = new Geo();
    g.torus(M.chain(M.trans(-0.42, 0, 0), M.rotY(0.25)), SKY, { R: 0.72, r: 0.15 });
    g.torus(M.chain(M.trans(0.42, 0, 0), M.rotX(Math.PI / 2), M.rotY(-0.25)), GOLD, { R: 0.72, r: 0.15 });
    g.crystal(M.chain(M.trans(0, 0, 0), M.scale(0.42)), CREAM, { sides: 8 });
    return { geo: g, spec: 1, size: 1.35 };
  },
  // Ранний доступ: золотой ключ
  game_access(v = 0) {
    const g = new Geo();
    const c = v % 2 ? GOLD_L : GOLD;
    g.torus(M.trans(-0.62, 0, 0), c, { R: 0.3, r: 0.1, su: 48, sv: 16 });
    g.box(M.trans(0.12, 0, 0), c, 1.12, 0.14, 0.14);
    g.box(M.trans(0.5, -0.17, 0), c, 0.12, 0.26, 0.12);
    g.box(M.trans(0.66, -0.13, 0), c, 0.1, 0.18, 0.12);
    g.crystal(M.chain(M.trans(-0.62, 0, 0), M.rotX(Math.PI / 2), M.scale(0.22)), SKY, { sides: 6 });
    return { geo: g, spec: 1, size: 1.05 };
  },
  // Внутриигровые предметы: связка кристаллов
  in_game(v = 0) {
    const g = new Geo();
    const [a, b, c] = PALETTES[v % PALETTES.length];
    g.crystal(M.chain(M.trans(0, 0.1, 0), M.scale(0.95)), a, { sides: 8 });
    g.crystal(M.chain(M.trans(-0.62, -0.25, 0.15), M.rotZ(0.35), M.scale(0.5)), b, { sides: 6 });
    g.crystal(M.chain(M.trans(0.6, -0.28, -0.1), M.rotZ(-0.3), M.scale(0.45)), c, { sides: 6 });
    return { geo: g, spec: 0.8, size: 1.1 };
  },
  // Подписки и сервисы: цифровая карта-пропуск
  subscription(v = 0) {
    const g = new Geo();
    g.box(M.ident(), v % 2 ? SKY_D : NAVY, 1.6, 1.0, 0.07);
    g.box(M.trans(0, 0.24, 0.04), SKY, 1.6, 0.16, 0.02);
    g.box(M.trans(-0.5, -0.12, 0.045), GOLD, 0.3, 0.22, 0.03);
    g.box(M.trans(0.22, -0.3, 0.045), CREAM, 0.8, 0.06, 0.02);
    g.crystal(M.chain(M.trans(0.55, -0.05, 0.08), M.rotX(Math.PI / 2), M.scale(0.18)), GOLD, { sides: 6 });
    return { geo: g, spec: 0.6, size: 1.0 };
  },
  // Признание: медаль со звездой и лентами
  recognition(v = 0) {
    const g = new Geo();
    g.box(M.chain(M.trans(-0.2, 0.62, -0.05), M.rotZ(0.35)), v % 2 ? CORAL : SKY, 0.26, 0.7, 0.03);
    g.box(M.chain(M.trans(0.2, 0.62, -0.05), M.rotZ(-0.35)), v % 2 ? CORAL : SKY, 0.26, 0.7, 0.03);
    g.cylinder(M.ident(), GOLD, { r: 0.5, h: 0.12 });
    g.torus(M.ident(), GOLD_L, { R: 0.5, r: 0.05, su: 48, sv: 10 });
    g.star(M.trans(0, 0, 0.08), CREAM, { r: 0.32, inner: 0.14, h: 0.06 });
    return { geo: g, spec: 1, size: 1.3 };
  },
  // Частица салюта
  shard() {
    const g = new Geo();
    g.crystal(M.scale(0.09), GOLD, { sides: 4, crown: 0.3, table: 0.4, pavilion: 0.6 });
    return { geo: g, spec: 1, size: 0.1 };
  },
};

// ---------------- Шейдеры ----------------
const VS = `
attribute vec3 aPos; attribute vec3 aNor; attribute vec3 aCol;
uniform mat4 uModel, uView, uProj; uniform mat3 uNM;
varying vec3 vN; varying vec3 vP; varying vec3 vC;
void main(){ vec4 w = uModel * vec4(aPos,1.0); vP = w.xyz; vN = uNM * aNor; vC = aCol; gl_Position = uProj * uView * w; }`;
const FS = `
precision mediump float;
varying vec3 vN; varying vec3 vP; varying vec3 vC;
uniform vec3 uCam; uniform float uSpec; uniform float uAlpha; uniform float uGlow;
void main(){
  vec3 N = normalize(vN); vec3 V = normalize(uCam - vP);
  if (!gl_FrontFacing) N = -N;
  vec3 Lk = normalize(vec3(0.55, 0.8, 0.75));  vec3 Ck = vec3(1.0, 0.84, 0.5) * 1.15;   // золотой key
  vec3 Lf = normalize(vec3(-0.85, 0.05, 0.45)); vec3 Cf = vec3(0.3, 0.5, 1.0) * 0.55;    // синий fill
  vec3 Lr = normalize(vec3(-0.25, 0.35, -1.0)); vec3 Cr = vec3(0.12, 0.92, 1.0);          // неоновый rim
  float dk = max(dot(N, Lk), 0.0), df = max(dot(N, Lf), 0.0);
  float sk = pow(max(dot(N, normalize(Lk + V)), 0.0), 56.0);
  float sf = pow(max(dot(N, normalize(Lf + V)), 0.0), 24.0) * 0.35;
  float fres = pow(1.0 - max(dot(N, V), 0.0), 2.6);
  float rim = fres * (0.55 + 0.45 * max(dot(N, -Lr) * -1.0 + 0.6, 0.0));
  vec3 c = vC * (0.13 + dk * Ck + df * Cf) + (sk * Ck + sf * Cf) * uSpec + rim * Cr * 0.7 + vC * uGlow;
  c = c / (c + vec3(0.8)) * 1.55;
  gl_FragColor = vec4(c, uAlpha);
}`;

// ---------------- Сцена (один WebGL-контекст на холст) ----------------
export class Stage {
  constructor(canvas) {
    this.canvas = canvas;
    this.views = new Set();
    this.meshes = new Map();
    const gl = canvas.getContext('webgl', { alpha: true, antialias: true, premultipliedAlpha: false });
    this.gl = gl;
    if (!gl) return;
    const sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    this.prog = p;
    this.loc = Object.fromEntries(
      ['aPos', 'aNor', 'aCol'].map((n) => [n, gl.getAttribLocation(p, n)]).concat(
        ['uModel', 'uView', 'uProj', 'uNM', 'uCam', 'uSpec', 'uAlpha', 'uGlow'].map((n) => [n, gl.getUniformLocation(p, n)])
      )
    );
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
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
    const m = { pos: buf(model.geo.pos), nor: buf(model.geo.nor), col: buf(model.geo.col), count: model.geo.pos.length / 3, spec: model.spec, size: model.size };
    this.meshes.set(key, m);
    return m;
  }
  draw(mesh, model, alpha = 1, glow = 0) {
    const { gl, loc } = this;
    gl.uniformMatrix4fv(loc.uModel, false, model);
    gl.uniformMatrix3fv(loc.uNM, false, M.normal3(model));
    gl.uniform1f(loc.uSpec, mesh.spec);
    gl.uniform1f(loc.uAlpha, alpha);
    gl.uniform1f(loc.uGlow, glow);
    for (const [attr, b] of [['aPos', mesh.pos], ['aNor', mesh.nor], ['aCol', mesh.col]]) {
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.enableVertexAttribArray(loc[attr]);
      gl.vertexAttribPointer(loc[attr], 3, gl.FLOAT, false, 0, 0);
    }
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
    gl.viewport(0, 0, cw, ch);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (!this.views.size) return;
    gl.enable(gl.SCISSOR_TEST);
    gl.useProgram(this.prog);
    const cr = canvas.getBoundingClientRect();
    for (const v of this.views) {
      const r = v.el.getBoundingClientRect();
      if (r.bottom < cr.top || r.top > cr.bottom || r.right < cr.left || r.left > cr.right || r.width < 2 || r.height < 2) {
        v.update(dt, false);
        continue;
      }
      const x = Math.round((r.left - cr.left) * dpr), y = Math.round((cr.bottom - r.bottom) * dpr), w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
      gl.viewport(x, y, w, h);
      gl.scissor(x, y, w, h);
      gl.clear(gl.DEPTH_BUFFER_BIT);
      v.update(dt, true);
      v.render(w / h);
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
  constructor(stage, el, { model = 'logo', variant = 0, autoRotate = true, wheel = false, touch = 'pan-y', float = true, onTap = null, distance = 3.4, theta = 0.5, phi = 1.25 } = {}) {
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
    this.mesh = stage.mesh(model, variant);
    this.shard = stage.mesh('shard');
    this.pointers = new Map();
    el.classList.add('gl');
    el.style.touchAction = touch === 'none' ? 'none' : 'pan-y';
    if (!el.hasAttribute('tabindex')) el.tabIndex = 0;
    el.setAttribute('role', 'img');
    this.h = {
      down: (e) => this.down(e),
      move: (e) => this.move(e),
      up: (e) => this.up(e),
      wheel: (e) => this.onWheel(e),
      key: (e) => this.onKey(e),
    };
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
      // Щипок: изменение расстояния между пальцами = зум
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
    this.phi = Math.min(Math.PI - 0.15, Math.max(0.15, this.phi - dy * k));
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
    const map = { ArrowLeft: () => (this.theta -= step), ArrowRight: () => (this.theta += step), ArrowUp: () => (this.phi = Math.max(0.15, this.phi - step)), ArrowDown: () => (this.phi = Math.min(Math.PI - 0.15, this.phi + step)), '+': () => this.zoom(0.9), '=': () => this.zoom(0.9), '-': () => this.zoom(1.1) };
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
      // Инерция с затуханием после отпускания
      const damp = Math.exp(-dt * 3.2);
      this.vt *= damp;
      this.vp *= damp;
      this.theta += this.vt * dt;
      this.phi = Math.min(Math.PI - 0.15, Math.max(0.15, this.phi + this.vp * dt));
      // Авто-вращение возвращается через 2.5 с после взаимодействия
      if (this.autoRotate && this.idle > 2.5) this.theta += dt * 0.45 * Math.min(1, (this.idle - 2.5) / 1.5);
    }
    if (!visible) return;
    for (const p of this.particles) {
      p.v[1] -= 3.2 * dt;
      for (let i = 0; i < 3; i++) p.p[i] += p.v[i] * dt;
      p.r += p.rv * dt;
      p.life -= dt;
    }
    this.particles = this.particles.filter((p) => p.life > 0);
  }
  render(aspect) {
    const s = this.stage;
    const gl = s.gl;
    const eye = [this.radius * Math.sin(this.phi) * Math.sin(this.theta), this.radius * Math.cos(this.phi), this.radius * Math.sin(this.phi) * Math.cos(this.theta)];
    const fit = aspect < 1 ? 1 / aspect : 1;
    const proj = M.persp(32 * Math.min(1.6, fit), aspect, 0.1, 50);
    const view = M.lookAt(eye, [0, 0, 0], [0, 1, 0]);
    gl.uniformMatrix4fv(s.loc.uProj, false, proj);
    gl.uniformMatrix4fv(s.loc.uView, false, view);
    gl.uniform3fv(s.loc.uCam, eye);
    const bob = this.float ? Math.sin(this.time * 1.3) * 0.08 : 0;
    const tilt = this.float ? Math.sin(this.time * 0.7) * 0.06 : 0;
    const scale = 1 / this.mesh.size;
    s.draw(this.mesh, M.chain(M.trans(0, bob, 0), M.rotZ(tilt), M.scale(scale)), 1, this.glow || 0);
    for (const p of this.particles) {
      const a = Math.min(1, p.life / 0.5);
      s.draw(this.shard, M.chain(M.trans(p.p[0], p.p[1], p.p[2]), M.rotY(p.r), M.rotX(p.r * 0.7), M.scale(p.s * (0.4 + 0.6 * a))), a, 0.35);
    }
    if (this.glow) this.glow = Math.max(0, this.glow - 0.02);
  }
  // Салют золотых кристаллов (обмен баллов на награду)
  burst(count = 90) {
    if (REDUCED) return Promise.resolve();
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2, el = Math.random() * Math.PI - Math.PI / 2, sp = 1.6 + Math.random() * 2.6;
      this.particles.push({ p: [0, 0, 0], v: [Math.cos(a) * Math.cos(el) * sp, Math.abs(Math.sin(el)) * sp + 1.2, Math.sin(a) * Math.cos(el) * sp], r: Math.random() * 6, rv: (Math.random() - 0.5) * 14, s: 0.6 + Math.random() * 1.1, life: 1.1 + Math.random() * 0.8 });
    }
    this.glow = 0.9;
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
    } catch {
      pageStage = false;
    }
  }
  return pageStage || null;
}

export const modelForCategory = (cat) => (['game_access', 'in_game', 'subscription', 'recognition'].includes(cat) ? cat : 'in_game');
export const reducedMotion = REDUCED;
