// HTTP-сервер: API + статика (Web/PWA). Без фреймворков, только встроенные модули Node.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, config } from './config.js';
import { HttpError } from './util.js';
import { one, run, withContext } from './db.js';
import { match } from './routes.js';
import { COOKIE, DEMO_COOKIE, userFromToken } from './services/auth.js';
import { demoContext } from './demo.js';
import { logError } from './services/ops.js';

// Cookie режима: 'demo' — запросы идут в демо-песочницу, иначе — в настоящую базу
export const MODE_COOKIE = 'ab_mode';
import ASSETS from './assets.js';

const PUBLIC = path.join(ROOT, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.mp4': 'video/mp4',
  '.jpg': 'image/jpeg',
  '.vtt': 'text/vtt; charset=utf-8',
};

// Отдаёт буфер с поддержкой Range (нужно для перемотки видео и для Safari/iOS)
function sendBuffer(req, res, buf, headers) {
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (range && (range[1] || range[2])) {
    let start = range[1] ? Number(range[1]) : buf.length - Number(range[2]);
    let end = range[1] && range[2] ? Number(range[2]) : buf.length - 1;
    start = Math.max(0, start);
    end = Math.min(end, buf.length - 1);
    if (start > end) {
      res.writeHead(416, { 'Content-Range': `bytes */${buf.length}` });
      return res.end();
    }
    res.writeHead(206, { ...headers, 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${buf.length}`, 'Content-Length': end - start + 1 });
    return res.end(req.method === 'HEAD' ? undefined : buf.subarray(start, end + 1));
  }
  res.writeHead(200, { ...headers, 'Accept-Ranges': 'bytes', 'Content-Length': buf.length });
  res.end(req.method === 'HEAD' ? undefined : buf);
}
const embeddedCache = new Map();

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'self' https://web.telegram.org https://*.telegram.org; base-uri 'self'; form-action 'self'",
  'Permissions-Policy': 'camera=(), geolocation=(), payment=(), usb=()',
  // На HTTPS (Render): браузер больше никогда не откроет сайт по незащищённому http
  ...(config.publicUrl.startsWith('https://') ? { 'Strict-Transport-Security': 'max-age=15552000' } : {}),
};

function parseCookies(header = '') {
  return Object.fromEntries(
    header.split(';').map((p) => p.trim().split('=')).filter(([k]) => k).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))])
  );
}

function readBody(req, limit = 200_000) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new HttpError(413, 'Слишком большой запрос'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendJson(res, status, data, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(data));
}

// index.html: подставляем публичный адрес сайта (нужен для превью ссылок в Telegram/WhatsApp — og:image должен быть абсолютным)
const withPublicUrl = (buf) => Buffer.from(buf.toString('utf8').replaceAll('%PUBLIC_URL%', config.publicUrl));

// SEO: robots.txt и sitemap.xml с правильным адресом сайта
function serveSeo(res, pathname) {
  const u = config.publicUrl;
  if (pathname === '/robots.txt') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' });
    return res.end(`User-agent: *\nAllow: /\nDisallow: /api/\nSitemap: ${u}/sitemap.xml\n`), true;
  }
  if (pathname === '/sitemap.xml') {
    const pages = ['/', '/play/steppe-runner/index.html', '/play/steppe-runner/store.html', '/play/qadam/index.html', '/play/inventory/index.html', '/play/video/index.html'];
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${pages.map((p) => `  <url><loc>${u}${p}</loc></url>`).join('\n')}\n</urlset>\n`;
    res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' });
    return res.end(xml), true;
  }
  // Короткая реферальная ссылка: /r/КОД → регистрация с кодом друга
  const ref = /^\/r\/([A-Za-z0-9]{4,16})\/?$/.exec(pathname);
  if (ref) {
    res.writeHead(302, { Location: `/?ref=${ref[1].toUpperCase()}#/register`, 'Cache-Control': 'no-store' });
    return res.end(), true;
  }
  return false;
}

function serveStatic(req, res, pathname) {
  if (serveSeo(res, pathname)) return;
  if (ASSETS) return serveEmbedded(req, res, pathname);
  let file = path.normalize(path.join(PUBLIC, decodeURIComponent(pathname)));
  if (!file.startsWith(PUBLIC)) return sendJson(res, 403, { error: 'Forbidden' });
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    if (path.extname(pathname)) return sendJson(res, 404, { error: 'Not found' });
    file = path.join(PUBLIC, 'index.html'); // SPA fallback
  }
  const ext = path.extname(file);
  const headers = {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    // HTML, JS и CSS всегда сверяются с сервером — после обновления не смешиваются старые и новые файлы
    'Cache-Control': ['.html', '.js', '.css', '.webmanifest'].includes(ext) ? 'no-cache' : 'public, max-age=300',
    ...SECURITY_HEADERS,
  };
  if (ext === '.mp4') return sendBuffer(req, res, fs.readFileSync(file), headers);
  if (file.endsWith('index.html') && path.dirname(file) === PUBLIC) return sendBuffer(req, res, withPublicUrl(fs.readFileSync(file)), headers);
  res.writeHead(200, headers);
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
}

// Сайт, встроенный в attention-bank-v2.mjs
function serveEmbedded(req, res, pathname) {
  let key = 'public' + decodeURIComponent(pathname);
  if (!ASSETS[key]) {
    if (path.extname(pathname)) return sendJson(res, 404, { error: 'Not found' });
    key = 'public/index.html';
  }
  const ext = path.extname(key);
  if (!embeddedCache.has(key)) {
    const buf = Buffer.from(ASSETS[key], 'base64');
    embeddedCache.set(key, key === 'public/index.html' ? withPublicUrl(buf) : buf);
  }
  sendBuffer(req, res, embeddedCache.get(key), {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': ['.html', '.js', '.css', '.webmanifest'].includes(ext) ? 'no-cache' : 'public, max-age=300',
    ...SECURITY_HEADERS,
  });
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname;

  if (!pathname.startsWith('/api/')) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: 'Method not allowed' });
    return serveStatic(req, res, pathname);
  }

  const found = match(req.method, pathname);
  if (!found) return sendJson(res, 404, { error: 'Метод API не найден' });

  const cookies = parseCookies(req.headers.cookie);
  // Демо-песочница: отдельная база. Telegram, админка и переключатель режима всегда работают с настоящей.
  const demo = config.demoSandbox && cookies[MODE_COOKIE] === 'demo' && !found.route.realOnly;
  if (demo) {
    const dctx = await demoContext();
    return withContext(dctx, () => handleApi(req, res, pathname, url, found, cookies, true));
  }
  return handleApi(req, res, pathname, url, found, cookies, false);
}

async function handleApi(req, res, pathname, url, found, cookies, demo) {
  const token = cookies[demo ? DEMO_COOKIE : COOKIE];
  const headers = {};
  const ctx = {
    req,
    res,
    params: found.params,
    query: Object.fromEntries(url.searchParams),
    token,
    user: userFromToken(token),
    ip: (config.trustProxy && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress,
    body: {},
    cookies,
    demo,
    setCookie: (c) => (headers['Set-Cookie'] = [...(headers['Set-Cookie'] || []), c]),
  };

  try {
    if (req.method !== 'GET') {
      // Защита от CSRF: только JSON и только со своего сайта
      const ct = req.headers['content-type'] || '';
      if (!ct.includes('application/json')) throw new HttpError(415, 'Ожидается JSON');
      const origin = req.headers.origin;
      if (!found.route.public && origin && new URL(origin).host !== req.headers.host) throw new HttpError(403, 'Запрос с чужого сайта');
      const raw = await readBody(req, found.route.maxBody);
      ctx.body = raw ? JSON.parse(raw) : {};
      if (typeof ctx.body !== 'object' || ctx.body === null) ctx.body = {};
    }
    // Идемпотентность: повтор запроса с тем же Idempotency-Key вернёт сохранённый ответ,
    // а не выполнит списание/начисление второй раз (двойной клик, повтор сети, ретрай клиента).
    const idemKey = found.route.idempotent && ctx.user ? req.headers['idempotency-key'] : null;
    if (idemKey !== undefined && idemKey !== null) {
      if (!/^[A-Za-z0-9_-]{8,100}$/.test(idemKey)) throw new HttpError(400, 'Некорректный Idempotency-Key');
      const prev = one('SELECT route, status, response FROM idempotency WHERE user_id = ? AND key = ?', ctx.user.id, idemKey);
      const routeId = `${req.method} ${pathname}`;
      if (prev) {
        if (prev.route !== routeId) throw new HttpError(422, 'Этот Idempotency-Key уже использован для другого запроса');
        return sendJson(res, prev.status, JSON.parse(prev.response), { ...headers, 'Idempotent-Replay': 'true' });
      }
      // Обработчики финансовых операций синхронны: между проверкой ключа и записью результата
      // нет await, поэтому параллельный дубликат не может «проскочить» между ними.
      const out = found.route.handler(ctx);
      if (out instanceof Promise) throw new Error('Идемпотентный маршрут должен быть синхронным');
      const body = out ?? { ok: true };
      run('DELETE FROM idempotency WHERE created_at < ?', new Date(Date.now() - 864e5).toISOString());
      run('INSERT INTO idempotency (user_id, key, route, status, response) VALUES (?, ?, ?, 200, ?)', ctx.user.id, idemKey, routeId, JSON.stringify(body));
      return sendJson(res, 200, body, headers);
    }

    const result = await found.route.handler(ctx);
    if (found.route.raw) return;
    sendJson(res, 200, result ?? { ok: true }, headers);
  } catch (err) {
    if (err instanceof SyntaxError) return sendJson(res, 400, { error: 'Некорректный JSON' });
    if (err instanceof HttpError) return sendJson(res, err.status, { error: err.message, details: err.details }, headers);
    console.error('[api]', req.method, pathname, err);
    logError({ source: 'server', message: err?.message || String(err), detail: err?.stack, path: `${req.method} ${pathname}${demo ? ' [демо]' : ''}`, userId: ctx.user?.id });
    sendJson(res, 500, { error: 'Внутренняя ошибка сервера' });
  }
}

export function createServer() {
  return http.createServer((req, res) => {
    handle(req, res).catch((e) => {
      console.error(e);
      if (!res.headersSent) sendJson(res, 500, { error: 'Внутренняя ошибка сервера' });
    });
  });
}
