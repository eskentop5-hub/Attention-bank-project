// ATTENTION BANK — клиент v3 (Web + PWA + 3D). Без фреймворков и сборки.
// Клиент никогда не меняет баланс сам: все суммы приходят с сервера.
import { pageStageFor, Stage, modelForCategory, modelForReward, reducedMotion } from './ab3d.js';
import * as X from './extras.js';

const state = { streak: null, me: null, meta: null, unread: 0, lastSeenNotif: 0, poll: null, tgPoll: null, timer: null, onReward: null, justDone: false, installPrompt: null };
const app = document.getElementById('app');

// ---------- Утилиты ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const fmt = (n) => new Intl.NumberFormat('ru-RU').format(n);
const signed = (n) => (n > 0 ? `+${fmt(n)}` : `−${fmt(Math.abs(n))}`);
const fmtDate = (iso) => new Date(iso).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const fmtTime = (iso) => new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
const dayLabel = (iso) => {
  const d = new Date(iso);
  const today = new Date();
  const y = new Date(Date.now() - 864e5);
  if (d.toDateString() === today.toDateString()) return 'Сегодня';
  if (d.toDateString() === y.toDateString()) return 'Вчера';
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
};
const minutes = (sec) => (sec < 60 ? `${sec} сек` : `${Math.round(sec / 60)} мин`);
const plural = (n, one, few, many) => {
  const m10 = n % 10, m100 = n % 100;
  return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
};
const initials = (name) => String(name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
const uid = () => {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
};

class ApiError extends Error {
  constructor(message, status, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}
// idem: true — запрос с Idempotency-Key: повтор не спишет и не начислит дважды
async function api(path, { method = 'GET', body, idem = false } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (idem) headers['Idempotency-Key'] = uid();
  const res = await fetch(path, { method, credentials: 'same-origin', headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error || `Ошибка ${res.status}`, res.status, data.details);
  return data;
}


// Встроенные демо-продукты (/play/...) открываем на текущем домене — даже если PUBLIC_URL настроен иначе
function productHref(url) {
  try {
    const u = new URL(url, location.origin);
    return u.pathname.startsWith('/play/') ? location.origin + u.pathname : url;
  } catch {
    return url;
  }
}

function toast(message, { kind = 'ok', stamp = null } = {}) {
  const el = document.createElement('div');
  el.className = `toast${kind === 'err' ? ' err' : ''}`;
  el.innerHTML = `${stamp ? `<span class="stamp press">${esc(stamp)}</span>` : ''}<span>${esc(message)}</span>`;
  $('#toasts').append(el);
  setTimeout(() => el.remove(), kind === 'err' ? 6500 : 4500);
}

// Кнопка в состоянии загрузки, пока идёт запрос
async function busy(btn, fn) {
  if (!btn || btn.disabled) return;
  btn.disabled = true;
  btn.classList.add('is-busy');
  btn.setAttribute('aria-busy', 'true');
  try {
    return await fn();
  } finally {
    btn.disabled = false;
    btn.classList.remove('is-busy');
    btn.removeAttribute('aria-busy');
  }
}

// Доступный диалог подтверждения на нативном <dialog>
function confirmDialog({ title, body, confirm = 'Подтвердить', cancel = 'Отмена', tone = 'primary' }) {
  const d = $('#modal');
  d.classList.remove('wide');
  d.innerHTML = `<form method="dialog" class="in">
    <h2 id="modal-title">${esc(title)}</h2>
    <div>${body}</div>
    <div class="acts">
      <button class="btn btn-ghost" value="cancel">${esc(cancel)}</button>
      <button class="btn btn-${tone}" value="ok" autofocus>${esc(confirm)}</button>
    </div></form>`;
  d.showModal();
  return new Promise((resolve) => d.addEventListener('close', () => resolve(d.returnValue === 'ok'), { once: true }));
}
function infoDialog({ title, body, close = 'Готово' }) {
  const d = $('#modal');
  d.classList.remove('wide');
  d.innerHTML = `<form method="dialog" class="in"><h2 id="modal-title">${esc(title)}</h2><div>${body}</div>
    <div class="acts"><button class="btn btn-primary" value="ok" autofocus>${esc(close)}</button></div></form>`;
  d.showModal();
  return new Promise((resolve) => d.addEventListener('close', resolve, { once: true }));
}

// ---------- Локальные настройки (браузерное хранилище может быть недоступно) ----------
const store = {
  get(k) {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* без хранилища настройка живёт до перезагрузки */
    }
  },
};

// ---------- Системные уведомления ОС (Notification API) ----------
// Работают, пока сайт или установленное приложение открыты (сервер опрашивается каждые 10 с).
const osNote = {
  supported: typeof window !== 'undefined' && 'Notification' in window,
  get permission() {
    return this.supported ? Notification.permission : 'unsupported';
  },
  get enabled() {
    return this.permission === 'granted' && store.get('ab_os_notify') !== 'off';
  },
  async request() {
    if (!this.supported) return 'unsupported';
    const p = await Notification.requestPermission();
    if (p === 'granted') store.set('ab_os_notify', 'on');
    return p;
  },
  async show(title, body, link = '/#/home') {
    if (!this.enabled) return false;
    const opts = { body, icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', tag: `ab-${Date.now()}`, data: { link } };
    try {
      const reg = await navigator.serviceWorker?.getRegistration();
      if (reg) await reg.showNotification(title, opts);
      else new Notification(title, opts);
      return true;
    } catch {
      return false;
    }
  },
};

// ---------- 3D-витрины и наклон карточек ----------
const has3d = (r) => !String(r.imageUrl || '').startsWith('/api/images/');

function enhance(root = app) {
  const stage = pageStageFor($('#stage3d'));
  $$('[data-3d]:not(.gl):not(.no3d)', root).forEach((el) => {
    if (!stage) return el.classList.add('no3d');
    el._view = stage.add(el, {
      model: el.dataset.model,
      variant: Number(el.dataset.variant || 0),
      wheel: el.dataset.wheel || false,
      touch: el.dataset.touch || 'pan-y',
      distance: Number(el.dataset.distance || 3.4),
      onTap: el.dataset.href ? () => (location.hash = el.dataset.href) : null,
    });
  });
  if (!reducedMotion && matchMedia('(hover: hover)').matches) $$('.tilt:not([data-tilt])', root).forEach(bindTilt);
}
function bindTilt(el) {
  el.dataset.tilt = '1';
  el.addEventListener('pointermove', (e) => {
    if (e.buttons || e.pointerType !== 'mouse') return;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5;
    const y = (e.clientY - r.top) / r.height - 0.5;
    el.style.transform = `perspective(1100px) rotateX(${(-y * 5).toFixed(2)}deg) rotateY(${(x * 6).toFixed(2)}deg)`;
  });
  el.addEventListener('pointerleave', () => (el.style.transform = ''));
}

// ---------- Иконки (единый линейный стиль) ----------
const svg = (p, s = 22) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
const I = {
  home: (s) => svg('<path d="M4 11l8-7 8 7v9a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z"/>', s),
  gift: (s) => svg('<rect x="3.5" y="8" width="17" height="4" rx="1"/><path d="M5 12v8h14v-8M12 8v12M12 8c-2-4.5-6.5-4-6-1.5S10 8 12 8zm0 0c2-4.5 6.5-4 6-1.5S14 8 12 8z"/>', s),
  ticket: (s) => svg('<path d="M3 8a2 2 0 0 0 0 4v0a2 2 0 0 1 0 4v2h18v-2a2 2 0 0 1 0-4 2 2 0 0 0 0-4V6H3z"/><path d="M14 6v12" stroke-dasharray="2 2.5"/>', s),
  pulse: (s) => svg('<path d="M3 12h4l2.5-6 4 12 2.5-6H21"/>', s),
  user: (s) => svg('<circle cx="12" cy="8" r="4"/><path d="M4 21c1.6-4 4.6-6 8-6s6.4 2 8 6"/>', s),
  chart: (s) => svg('<path d="M4 20V11M10 20V5M16 20v-6M2 20h20"/>', s),
  plus: (s) => svg('<path d="M12 5v14M5 12h14"/>', s),
  wallet: (s) => svg('<rect x="3" y="6" width="18" height="14" rx="2"/><path d="M3 10h18M16 15h2"/>', s),
  bell: (s) => svg('<path d="M6 9a6 6 0 1 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9"/><path d="M10 20a2 2 0 0 0 4 0"/>', s),
  swap: (s) => svg('<path d="M7 7h12l-3-3M17 17H5l3 3"/>', s),
  clock: (s) => svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>', s),
  check: (s) => svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>', s),
  x: (s) => svg('<path d="M6 6l12 12M18 6L6 18"/>', s),
  target: (s) => svg('<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1" fill="currentColor"/>', s),
  shield: (s) => svg('<path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z"/><path d="M9 12l2 2 4-4"/>', s),
  download: (s) => svg('<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>', s),
  back: (s) => svg('<path d="M15 5l-7 7 7 7"/>', s),
  external: (s) => svg('<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>', s),
  hourglass: (s) => svg('<path d="M7 3h10M7 21h10M8 3c0 5 8 5 8 9s-8 4-8 9M16 3c0 5-8 5-8 9"/>', s),
  arrowIn: (s) => svg('<path d="M12 4v16M6 14l6 6 6-6"/>', s),
  arrowOut: (s) => svg('<path d="M12 20V4M6 10l6-6 6 6"/>', s),
  monitor: (s) => svg('<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>', s),
  copy: (s) => svg('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a1 1 0 0 1 1-1h10"/>', s),
  refresh: (s) => svg('<path d="M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6"/>', s),
  tg: (s = 20) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M21.4 4.2 2.9 11.3c-1.3.5-1.2 1.2-.2 1.5l4.7 1.5 1.8 5.6c.2.6.4.8.9.8.4 0 .6-.2.9-.4l2.3-2.2 4.7 3.5c.9.5 1.5.2 1.7-.8l3.1-14.5c.3-1.3-.5-1.9-1.4-1.5ZM8.6 14l9.2-5.8c.4-.3.8-.1.5.2l-7.6 6.9-.3 3.2L8.6 14Z"/></svg>`,
};

// ---------- Каркас ----------
function navItems() {
  const r = state.me?.role;
  if (r === 'user')
    return [
      ['#/home', 'Главная', I.home],
      ['#/rewards', 'Награды', I.gift],
      ['#/tasks', 'Задания', I.ticket],
      ['#/stats', 'Статистика', I.chart],
      ['#/profile', 'Профиль', I.user],
    ];
  if (r === 'company')
    return [
      ['#/company', 'Обзор', I.chart],
      ['#/company/new', 'Создать', I.plus],
      ['#/company/rewards', 'Награды', I.gift],
      ['#/company/revenue', 'Выручка', I.wallet],
      ['#/profile', 'Профиль', I.user],
    ];
  return [];
}

function renderChrome() {
  const path = location.hash || '#/';
  const current = (href) => {
    if (href === '#/company') return path === '#/company' || path.startsWith('#/company/campaigns');
    if (href === '#/profile') return path.startsWith('#/profile') || path.startsWith('#/settings');
    if (href === '#/stats') return path.startsWith('#/stats') || path.startsWith('#/activity');
    return path === href || path.startsWith(href + '/') || path.startsWith(href + '?');
  };
  const items = navItems();
  $('#nav').innerHTML = items.map(([h, l]) => `<a href="${h}" ${current(h) ? 'aria-current="page"' : ''}>${l}</a>`).join('');
  $('#tabbar').innerHTML = items.map(([h, l, i]) => `<a href="${h}" ${current(h) ? 'aria-current="page"' : ''}>${i(22)}<span>${l}</span></a>`).join('');
  $('#tabbar').hidden = items.length === 0;
  const me = state.me;
  const desk = `<button class="desk-btn" type="button" data-desktop aria-label="Приложение для компьютера">${I.monitor(17)}<span>ПК-версия</span></button>`;
  $('#top-actions').innerHTML = desk + (me
    ? `${me.role === 'user' ? X.streakChip(state.streak) : ''}<a class="balance-chip" href="${me.role === 'company' ? '#/budget' : '#/activity'}" title="Баланс AB Points"><span class="coin" aria-hidden="true"></span>${fmt(me.balance)} AB</a>
       <a class="icon-btn" href="#/notifications" aria-label="Уведомления${state.unread ? `, новых: ${state.unread}` : ''}">${I.bell(20)}${state.unread ? `<span class="dot">${state.unread > 9 ? '9+' : state.unread}</span>` : ''}</a>
       <a class="avatar-link" href="#/profile" aria-label="Профиль">${X.avatarHtml(me)}</a>`
    : `<a class="btn btn-ghost btn-sm" href="#/login">Войти</a><a class="btn btn-primary btn-sm" href="#/register">Создать аккаунт</a>`);
  $('#ribbon').innerHTML = state.meta?.demoMode
    ? `<div class="demo-ribbon"><b>Демо-версия.</b> <span class="long">Компании, задания и награды — демонстрационные. </span>AB Points — внутренние баллы платформы, не деньги.</div>`
    : '';
}

async function refreshMe() {
  const { user, unread, streak } = await api('/api/me');
  state.me = user;
  state.unread = unread || 0;
  state.streak = streak || null;
  return user;
}

function startPolling() {
  clearInterval(state.poll);
  state.poll = setInterval(async () => {
    if (!state.me) return;
    try {
      const prevBalance = state.me.balance;
      const prevUnread = state.unread;
      await refreshMe();
      if (!state.me) return renderChrome();
      if (state.unread > prevUnread) {
        const { notifications } = await api('/api/notifications');
        const away = document.hidden || !document.hasFocus();
        notifications
          .filter((n) => !n.read_at && n.id > state.lastSeenNotif)
          .slice(0, 3)
          .reverse()
          .forEach((n) => {
            if (away && osNote.enabled) osNote.show(n.title, n.body, n.link ? `/${n.link.replace(/^\//, '')}` : '/#/home');
            else toast(n.body, { stamp: n.kind === 'reward' ? n.title : null });
          });
        state.lastSeenNotif = Math.max(state.lastSeenNotif, ...notifications.map((n) => n.id));
      }
      renderChrome();
      if (state.me.balance !== prevBalance && state.onReward) state.onReward();
    } catch {
      /* сеть недоступна — попробуем позже */
    }
  }, 10000);
}

// ---------- Роутер ----------
const routes = [
  ['/', X.viewDeck, { guest: true }],
  ['/about', X.viewDeck, {}],
  ['/stats', X.viewStats, { role: 'user' }],
  ['/login', viewLogin, { guest: true }],
  ['/register', viewRegister, { guest: true }],
  ['/onboarding', viewOnboarding, { role: 'user' }],
  ['/home', viewHome, { role: 'user' }],
  ['/rewards', viewRewards, { role: 'user' }],
  ['/rewards/:id', viewReward, { role: 'user' }],
  ['/tasks', viewTasks, { role: 'user' }],
  ['/tasks/:id', viewTask, { role: 'user' }],
  ['/activity', viewActivity, { auth: true }],
  ['/wallet', () => (location.hash = state.me.role === 'company' ? '#/budget' : '#/activity'), { auth: true }],
  ['/profile', viewProfile, { auth: true }],
  ['/settings', viewSettings, { auth: true }],
  ['/notifications', viewNotifications, { auth: true }],
  ['/company', viewCompany, { role: 'company' }],
  ['/company/new', (ctx) => viewCampaignForm(ctx), { role: 'company' }],
  ['/company/campaigns/:id', viewCampaign, { role: 'company' }],
  ['/company/campaigns/:id/edit', (ctx) => viewCampaignForm(ctx), { role: 'company' }],
  ['/company/rewards', viewCompanyRewards, { role: 'company' }],
  ['/company/revenue', X.viewRevenue, { role: 'company' }],
  ['/company/campaigns/:id/report', X.viewReport, { role: 'company' }],
  ['/join/:code', X.viewJoin, {}],
  ['/privacy', X.viewPrivacy, {}],
  ['/economy', X.viewEconomy, {}],
  ['/budget', viewActivity, { role: 'company' }],
];
const home = () => (state.me?.role === 'company' ? '#/company' : '#/home');

async function router() {
  clearInterval(state.tgPoll);
  clearInterval(state.timer);
  state.onReward = null;
  const [path, qs] = (location.hash.slice(1) || '/').split('?');
  const query = Object.fromEntries(new URLSearchParams(qs || ''));
  let found = null;
  for (const [pattern, view, opts] of routes) {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '$');
    const m = path.match(re);
    if (m) {
      found = { view, opts, params: Object.fromEntries(keys.map((k, i) => [k, m[i + 1]])) };
      break;
    }
  }
  if (!found) return void (location.hash = state.me ? home() : '#/');
  const { view, opts, params } = found;
  if ((opts.auth || opts.role) && !state.me) return void (location.hash = `#/login?next=${encodeURIComponent(path)}`);
  if (opts.role && state.me.role !== opts.role) return void (location.hash = home());
  if (opts.guest && state.me) return void (location.hash = home());

  renderChrome();
  app.innerHTML = '<div class="skeleton" aria-label="Загрузка"><i></i><i></i><i></i><i></i></div>';
  try {
    await view({ params, query, path });
  } catch (e) {
    if (e.status === 401) {
      state.me = null;
      return void (location.hash = '#/login');
    }
    app.innerHTML = `<div class="empty"><h3>Не получилось загрузить страницу</h3><p>${esc(e.message)}</p><a class="btn btn-ghost" href="${state.me ? home() : '#/'}">Вернуться</a></div>`;
  }
  window.scrollTo(0, 0);
  app.focus({ preventScroll: true });
  // Плавный вход страницы
  app.classList.remove('page-in');
  void app.offsetWidth;
  app.classList.add('page-in');
}

// ---------- Формы ----------
function formData(form) {
  const data = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.type === 'checkbox') {
      if (el.dataset.multi) (data[el.name] ||= []), el.checked && data[el.name].push(el.value);
      else data[el.name] = el.checked;
    } else if (el.type === 'radio') {
      if (el.checked) data[el.name] = el.value;
    } else if (el.type !== 'file') data[el.name] = el.value;
  }
  return data;
}

function showFormError(form, err) {
  $$('.field.invalid', form).forEach((f) => f.classList.remove('invalid'));
  $$('.err', form).forEach((e) => e.remove());
  let box = $('.form-error', form);
  if (!box) {
    box = document.createElement('div');
    box.className = 'form-error';
    box.setAttribute('role', 'alert');
    form.prepend(box);
  }
  box.textContent = err.message;
  if (err.details && typeof err.details === 'object') {
    for (const [k, msg] of Object.entries(err.details)) {
      const field = $(`[data-q="${k}"]`, form);
      if (field) {
        field.classList.add('invalid');
        field.insertAdjacentHTML('beforeend', `<span class="err">${esc(msg)}</span>`);
      }
    }
  }
  box.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function bindForm(form, handler) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.submitter || $('button[type=submit]', form);
    await busy(btn, async () => {
      try {
        await handler(formData(form), e.submitter);
        $('.form-error', form)?.remove();
      } catch (err) {
        showFormError(form, err);
      }
    });
  });
}

const interestChips = (selected = [], name = 'interests') =>
  `<div class="chips">${state.meta.interests
    .map((i) => `<label class="chip"><input type="checkbox" name="${name}" value="${i.id}" data-multi="1" ${selected.includes(i.id) ? 'checked' : ''}><span>${esc(i.label)}</span></label>`)
    .join('')}</div>`;
const interestLabel = (id) => state.meta.interests.find((i) => i.id === id)?.label || id;
const demoBadge = (on) => (on ? '<span class="badge demo" title="Демонстрационные данные">демо</span>' : '');

// ---------- Пароли: поле с кнопкой «показать» и индикатор надёжности ----------
const pwField = (name, label, { autocomplete = 'current-password', hint = '' } = {}) =>
  `<label class="field"><span class="label">${label}</span><span class="pw-wrap"><input class="input" name="${name}" type="password" autocomplete="${autocomplete}" required><button type="button" class="pw-eye" aria-label="Показать пароль" data-eye>👁</button></span>${hint}</label>`;
function pwChecks(p, { email = '', name = '' } = {}) {
  const local = String(email).split('@')[0].toLowerCase();
  const nm = String(name).trim().toLowerCase();
  const low = p.toLowerCase();
  return [
    ['Минимум 8 символов', p.length >= 8],
    ['Буквы и цифры', /\p{L}/u.test(p) && /\d/.test(p)],
    ['Без email и имени', !(local.length >= 4 && low.includes(local)) && !(nm.length >= 4 && low.includes(nm))],
    ['Не из списка простых', !/^(password1?|qwerty\d*|1q2w3e4r|12345678\d*|passw0rd|admin123|parol123)$/i.test(p) && !/^(.)\1+$/.test(p)],
  ];
}
function bindPassword(form, { input = 'password', confirm = null, meterEl = null, who = () => ({}) } = {}) {
  $$('[data-eye]', form).forEach((b) =>
    b.addEventListener('click', () => {
      const inp = b.previousElementSibling;
      const show = inp.type === 'password';
      inp.type = show ? 'text' : 'password';
      b.setAttribute('aria-label', show ? 'Скрыть пароль' : 'Показать пароль');
      b.classList.toggle('on', show);
    })
  );
  if (!meterEl) return;
  const draw = () => {
    const p = form[input].value;
    const checks = pwChecks(p, who());
    const okCount = checks.filter((c) => c[1]).length + (p.length >= 12 ? 1 : 0) + (/[^\p{L}\d]/u.test(p) ? 1 : 0);
    const level = !p ? 0 : checks.every((c) => c[1]) ? (okCount >= 6 ? 4 : okCount >= 5 ? 3 : 2) : 1;
    const labels = ['', 'Слабый', 'Нормальный', 'Хороший', 'Надёжный'];
    meterEl.innerHTML = `<div class="pw-meter l${level}"><i></i><i></i><i></i><i></i></div><span class="pw-level">${p ? labels[level] : 'Придумайте пароль'}</span>
      <ul class="pw-rules">${checks.map(([t, ok]) => `<li class="${ok ? 'ok' : ''}">${ok ? '✓' : '○'} ${t}</li>`).join('')}</ul>
      ${confirm && form[confirm].value ? `<div class="pw-match ${form[confirm].value === p ? 'ok' : ''}">${form[confirm].value === p ? '✓ Пароли совпадают' : '✗ Пароли не совпадают'}</div>` : ''}`;
  };
  form[input].addEventListener('input', draw);
  if (confirm) form[confirm].addEventListener('input', draw);
  form.addEventListener('input', (e) => (e.target.name === 'email' || e.target.name === 'name') && draw());
  draw();
}

// ---------- Общие компоненты ----------
function meter(p, { lg = false, animate = false } = {}) {
  return `<div class="meter${lg ? ' lg' : ''}${animate ? ' animate' : ''}" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${p}"><i style="--p:${p}%"></i></div>`;
}

function rewardStatus(r) {
  if (r.stock <= 0) return '<span class="status need">Закончилось</span>';
  if (r.affordable) return '<span class="status ready">Можно получить</span>';
  return `<span class="status need">ещё ${fmt(r.need)} AB</span>`;
}

function rewardCard(r, { featured = false, goalId = null, withGoal = true } = {}) {
  const isGoal = goalId === r.id;
  return `<article class="reward-card tilt${featured ? ' featured' : ''}">
    ${
      has3d(r)
        ? `<div class="img view3d" data-3d data-model="${modelForReward(r)[0]}" data-variant="${modelForReward(r)[1]}" data-href="#/rewards/${r.id}" data-wheel="focus" aria-label="3D-модель награды «${esc(r.title)}». Перетащите, чтобы повернуть; Enter — открыть"><img src="${esc(r.imageUrl)}" alt="" loading="lazy">${demoBadge(r.demo)}</div>`
        : `<a class="img" href="#/rewards/${r.id}" tabindex="-1" aria-hidden="true"><img src="${esc(r.imageUrl)}" alt="" loading="lazy">${demoBadge(r.demo)}</a>`
    }
    ${withGoal && state.me?.role === 'user' && r.stock > 0 ? `<button class="goal-toggle" data-goal="${r.id}" aria-pressed="${isGoal}" aria-label="${isGoal ? 'Убрать цель' : `Сделать целью: ${esc(r.title)}`}">${I.target(15)}${isGoal ? 'Моя цель' : 'В цель'}</button>` : ''}
    <div class="body">
      <div class="meta">${r.platform ? `<span class="plat-badge p-${r.platform}">${esc(X.platformLabel(r.platform))}</span>` : `<span>${esc(r.categoryLabel)}</span>`}<span class="sep"></span><span>${esc(r.company)}</span></div>
      <h3><a href="#/rewards/${r.id}">${esc(r.title)}</a></h3>
      <p class="desc">${esc(r.description)}</p>
      <div class="price"><span class="cost">${fmt(r.cost)}<small>AB</small></span>${r.progress !== undefined ? rewardStatus(r) : ''}</div>
      ${r.progress !== undefined && r.stock > 0 ? meter(r.progress) : ''}
      <div class="tiny muted">${r.stock > 0 ? `В наличии: ${fmt(r.stock)}` : 'Нет в наличии'}</div>
    </div>
  </article>`;
}

// Переключение цели прямо из карточки
function bindGoalToggles(root, after) {
  $$('[data-goal]', root).forEach((b) =>
    b.addEventListener('click', async () => {
      const id = Number(b.dataset.goal);
      const isGoal = b.getAttribute('aria-pressed') === 'true';
      await busy(b, async () => {
        try {
          await api('/api/me/goal', { method: 'PUT', body: { rewardId: isGoal ? null : id } });
          state.me.goalRewardId = isGoal ? null : id;
          toast(isGoal ? 'Цель убрана' : 'Цель выбрана — прогресс видно на главной');
          after();
        } catch (e) {
          toast(e.message, { kind: 'err' });
        }
      });
    })
  );
}

function exchange(estMinutes, reward) {
  return `<div class="exchange" role="img" aria-label="Обмен: ${estMinutes ? `около ${estMinutes} минут внимания` : 'время не указано'} на ${reward} AB Points после проверки" title="Время — оценка компании. Баллы начисляются после проверки.">
    <div class="give"><b>${estMinutes ? `≈ ${estMinutes} МИН` : '—'}</b>ВНИМАНИЯ</div>
    <span class="swap">${I.swap(16)}</span>
    <div class="get"><b>+${fmt(reward)} AB</b>POINTS</div>
  </div>`;
}

const statusBadge = (s) =>
  ({
    started: '<span class="badge sky">В процессе</span>',
    submitted: '<span class="badge wait">На проверке</span>',
    approved: '<span class="badge ok">Подтверждено</span>',
    rejected: '<span class="badge bad">Не принято</span>',
  })[s] || '';

function ticket(t) {
  return `<a class="ticket tilt ${t.my?.status === 'approved' || t.my?.status === 'rejected' ? 'done' : ''}" href="#/tasks/${t.id}">
    <div>
      <div class="meta"><span class="badge">${esc(t.categoryLabel)}</span><span>${esc(t.company)}</span>${demoBadge(t.companyDemo)}${t.my ? statusBadge(t.my.status) : ''}</div>
      <h3>${esc(t.title)}</h3>
      <p class="desc">${esc(t.description)}</p>
      <div class="reqs">
        <span class="badge">${I.clock(13)} не быстрее ${minutes(t.minSeconds)}</span>
        ${t.requireTelegram ? `<span class="badge sky">${I.tg(12)} нужен Telegram</span>` : ''}
        <span class="badge">${t.autoApprove ? 'автопроверка' : 'проверяет компания'}</span>
      </div>
    </div>
    <div class="right">${exchange(t.estMinutes, t.reward)}<span class="tiny muted" style="white-space:nowrap">Мест: ${t.slotsLeft} из ${t.maxParticipants}</span></div>
  </a>`;
}

const FEED = {
  reward: ['credit', I.arrowIn],
  bonus: ['credit', I.arrowIn],
  refund: ['credit', I.arrowIn],
  deposit: ['credit', I.arrowIn],
  fee: ['credit', I.arrowIn],
  redemption: ['debit', I.gift],
  reserve: ['debit', I.arrowOut],
  submitted: ['info', I.hourglass],
  rejected: ['fail', I.x],
};
const FEED_LABEL = { reward: 'Задание подтверждено', bonus: 'Бонус', refund: 'Возврат бюджета', deposit: 'Пополнение', fee: 'Комиссия', redemption: 'Обмен на награду', reserve: 'Резерв кампании' };

function feedItem(a) {
  const [cls, ico] = FEED[a.kind] || ['info', I.pulse];
  const link = a.link ? `#${a.link}` : null;
  return `<li class="feed-item">
    <span class="feed-ico ${cls}">${ico(18)}</span>
    <div><div class="t">${link ? `<a href="${link}">${esc(a.title)}</a>` : esc(a.title)}</div>
      <div class="d">${esc(a.detail || FEED_LABEL[a.kind] || '')}${a.detail || FEED_LABEL[a.kind] ? ' · ' : ''}${fmtTime(a.at)}</div></div>
    <div class="amt">${a.amount !== undefined ? `<span class="${a.amount > 0 ? 'plus' : 'minus'}">${signed(a.amount)} AB</span><small>остаток ${fmt(a.balanceAfter)}</small>` : ''}</div>
  </li>`;
}

function feedGrouped(items) {
  let html = '';
  let day = null;
  for (const a of items) {
    const d = dayLabel(a.at);
    if (d !== day) {
      if (day !== null) html += '</ul>';
      html += `<h3 class="feed-day">${esc(d)}</h3><ul class="feed">`;
      day = d;
    }
    html += feedItem(a);
  }
  return html + (day !== null ? '</ul>' : '');
}

const empty = (title, text, action = '') => `<div class="empty"><h3>${esc(title)}</h3><p>${esc(text)}</p>${action}</div>`;

// ===================================================================
//                               ЛЕНДИНГ
// ===================================================================
async function viewLanding() {
  const [{ rewards }, stats] = await Promise.all([api('/api/public/rewards').catch(() => ({ rewards: [] })), api('/api/stats').catch(() => null)]);
  const me = state.me;
  app.innerHTML = `
  <section class="landing-hero">
    <div>
      <h1 class="tagline">Ваше внимание.<span class="l2">Ваша ценность.</span></h1>
      <p class="lead">Тестируйте игры и приложения, которые вам интересны. Время и награда видны заранее, а AB Points начисляются только после проверки ответа. Баллы меняются на награды от самих студий.</p>
      <div class="row" style="margin-top:26px">
        ${
          me
            ? `<a class="btn btn-primary btn-lg" href="${home()}">${me.role === 'company' ? 'Открыть кабинет' : 'Открыть главную'}</a>`
            : `<a class="btn btn-primary btn-lg" href="#/register">Создать аккаунт</a><a class="btn btn-ghost btn-lg" href="#/register?role=company">Я представляю компанию</a>`
        }
      </div>
      ${
        stats
          ? `<div class="mini-stats" style="margin-top:30px"><div><b>${fmt(stats.verifiedResults)}</b>подтверждённых результатов</div><div><b>${fmt(stats.paidOut)} AB</b>начислено участникам</div><div><b>${fmt(stats.activeCampaigns)}</b>открытых заданий</div></div>`
          : ''
      }
    </div>
    <div class="hero-stage">
      <div class="view3d" data-3d data-model="logo" data-distance="3.3" aria-label="3D-знак ATTENTION BANK: кольцо внимания сцеплено с кольцом ценности. Перетащите, чтобы повернуть"><img src="/icons/logo.svg" alt=""></div>
      <span class="stage-hint">Перетащите, чтобы повернуть</span>
    </div>
  </section>

  <ol class="flow-strip" aria-label="Как это работает">
    <li><b>Найти</b><span>Задания по вашим интересам</span></li>
    <li><b>Выбрать</b><span>Время, награда и условия видны заранее</span></li>
    <li><b>Выполнить</b><span>Протестировать и ответить на вопросы</span></li>
    <li><b>Проверка</b><span>Автопроверка и решение компании</span></li>
    <li><b>Начисление</b><span>AB Points после подтверждения</span></li>
    <li><b>Обмен</b><span>Ключи, предметы, подписки</span></li>
  </ol>

  <section class="section">
    <div class="section-head"><h2>Что можно получить</h2>${state.meta.demoMode ? '<span class="badge demo">демо-каталог</span>' : ''}</div>
    ${rewards.length ? `<div class="reward-grid">${rewards.map((r, i) => rewardCard(r, { withGoal: false, featured: i === 0 && rewards.length > 3 })).join('')}</div>` : empty('Каталог пока пуст', 'Награды появятся, когда компании их добавят.')}
  </section>

  <section class="section">
    <div class="section-head"><h2>Честный обмен</h2></div>
    <div class="principles">
      <div><b>Конечный список</b><p>Никакой бесконечной ленты. Вы видите доступные задания и уходите, когда хотите.</p></div>
      <div><b>Условия заранее</b><p>Время, награда, способ проверки и данные, которые получит компания, указаны до начала.</p></div>
      <div><b>Только добровольно</b><p>Нет обязательной рекламы и навязчивых уведомлений. Telegram-уведомления выключаются одним переключателем.</p></div>
      <div><b>Без фальшивых таймеров</b><p>Остаток наград — реальный запас компании. Никаких «осталось 5 минут» и выдуманных скидок.</p></div>
      <div><b>Ваши данные — ваши</b><p>Подбор только по интересам, которые вы указали сами. Выгрузка всех своих данных — в настройках.</p></div>
      <div><b>AB Points — не деньги</b><p>Это внутренние баллы платформы. Их нельзя вывести; они обмениваются на награды из каталога.</p></div>
    </div>
  </section>

  <section class="section">
    <div class="section-head"><h2>Почему это работает</h2></div>
    <div class="facts">
      <div class="fact"><b>1 млрд+</b><p>людей блокируют рекламу — принудительное внимание перестаёт работать.</p><a href="https://eyeo.com/wp-content/uploads/2026/05/eyeo_2026-ad-blocking-report.pdf" target="_blank" rel="noopener">eyeo, Ad-Blocking Report 2026</a></div>
      <div class="fact"><b>76%</b><p>мобильных игроков предпочитают добровольный формат с наградой обязательной рекламе.</p><a href="https://www.emarketer.com/content/us-consumers-appreciate-in-game-ads" target="_blank" rel="noopener">eMarketer / Tapjoy</a></div>
      <div class="fact"><b>86%</b><p>людей хотят понимать, зачем у них просят информацию, прежде чем её дать.</p><a href="https://business.mammothtimes.com/mammothtimes/article/bizwire-2025-7-16-the-value-ultimatum-new-research-shows-consumers-demanding-more-than-ever-from-brand-relationships" target="_blank" rel="noopener">Kobie, 2025</a></div>
    </div>
  </section>

  <section class="section">
    <div class="biz">
      <div>
        <h2>Для студий и разработчиков</h2>
        <p>Вы публикуете задание, бюджет резервируется, а платите только за ответы, которые прошли проверку. Неиспользованный бюджет возвращается при закрытии кампании.</p>
        ${me ? '' : '<a class="btn btn-gold btn-lg" href="#/register?role=company" style="margin-top:8px">Создать кабинет компании</a>'}
      </div>
      <dl>
        <div><dt>Оценка качества 0–100</dt><dd>Время выполнения, формальные и скопированные ответы, однообразные оценки — проверяются автоматически.</dd></div>
        <div><dt>Репутация участника</dt><dd>Видно, сколько ответов участника было одобрено и отклонено.</dd></div>
        <div><dt>Воронка и отчёт</dt><dd>Открыли → отправили → подтверждено. Графики ответов и выгрузка в CSV.</dd></div>
      </dl>
    </div>
  </section>

  <footer class="footer"><span>ATTENTION BANK · команда SithOrder · National Founder Cup 2026, Шымкент</span><span>Your Attention. Your Value.</span></footer>`;
}

// ===================================================================
//                         ВХОД / РЕГИСТРАЦИЯ
// ===================================================================
async function afterAuth(user, next) {
  state.me = user;
  state.lastSeenNotif = 0;
  // Открыто внутри Telegram: привязываем Telegram к аккаунту автоматически, без кода
  const tgInit = tgInitData();
  if (tgInit && !user.telegram?.linked) {
    try {
      const r = await api('/api/telegram/webapp-link', { method: 'POST', body: { initData: tgInit } });
      if (r.bonus) toast(`Telegram подключён · +${r.bonus} AB`);
      else toast('Telegram подключён');
    } catch (e) {
      toast(e.message, { kind: 'err' });
    }
  }
  await refreshMe();
  startPolling();
  // Пришёл по приглашению на конкретное задание — ведём прямо в него
  let join = null;
  try {
    join = sessionStorage.getItem('ab_join');
    sessionStorage.removeItem('ab_join');
  } catch {}
  if (!next && join && user.role === 'user') next = `/tasks/${join}`;
  if (next) location.hash = '#' + next;
  else if (user.role === 'user' && user.interests.length === 0) location.hash = '#/onboarding';
  else location.hash = home();
}

const authSide = (title) => `<div class="auth-side">
  <h1>${title}</h1>
  <ul>
    <li>${I.check(18)}<span>Время, награда и условия проверки видны до начала задания</span></li>
    <li>${I.check(18)}<span>AB Points начисляются только после подтверждения результата</span></li>
    <li>${I.check(18)}<span>Награды от студий: ранний доступ, предметы, подписки</span></li>
  </ul>
</div>`;

async function viewLogin({ query }) {
  app.innerHTML = `
  <div class="auth">
    ${authSide('Ваше внимание.<br>Ваша ценность.')}
    <div>
      <h1 style="font-size:1.8rem">Вход</h1>
      <form class="panel stack" id="f" novalidate>
        <label class="field"><span class="label">Email</span><input class="input" name="email" type="email" autocomplete="email" required></label>
        ${pwField('password', 'Пароль')}
        <button class="btn btn-primary btn-block btn-lg" type="submit">Войти</button>
        <p class="small muted" style="margin:0">Нет аккаунта? <a href="#/register">Создайте его</a></p>
      </form>
      ${
        state.meta.demoMode
          ? `<div class="demo-box"><b>Демо-доступ</b>, пароль <code>demo1234</code>
        <div class="row"><button class="btn btn-ghost btn-sm" type="button" data-demo="demo@attention.bank">Участник</button><button class="btn btn-ghost btn-sm" type="button" data-demo="studio@attention.bank">Компания</button></div></div>`
          : ''
      }
    </div>
  </div>`;
  const form = $('#f');
  bindPassword(form);
  bindForm(form, async (d) => {
    try {
      const { user } = await api('/api/auth/login', { method: 'POST', body: d });
      await afterAuth(user, query.next);
    } catch (e) {
      // На бесплатном хостинге база может обнулиться после перезапуска сервера — честно подсказываем
      if (state.meta.demoMode && /Неверный email или пароль/.test(e.message)) throw new Error(`${e.message}. Если аккаунт создан раньше: в демо-версии на бесплатном сервере база обнуляется при перезапуске — зарегистрируйтесь заново.`);
      throw e;
    }
  });
  $$('[data-demo]').forEach((b) =>
    b.addEventListener('click', () => {
      form.email.value = b.dataset.demo;
      form.password.value = 'demo1234';
      form.requestSubmit();
    })
  );
}

async function viewRegister({ query }) {
  const role = query.role === 'company' ? 'company' : 'user';
  app.innerHTML = `
  <div class="auth">
    ${authSide(role === 'company' ? 'Платите за проверенный результат, а не за показы.' : 'Выбирайте, на что тратить внимание.')}
    <div>
      <h1 style="font-size:1.8rem">${role === 'company' ? 'Кабинет компании' : 'Новый аккаунт'}</h1>
      <div class="seg" role="tablist" aria-label="Тип аккаунта">
        <a href="#/register" role="tab" aria-current="${role === 'user'}">Я участник</a>
        <a href="#/register?role=company" role="tab" aria-current="${role === 'company'}">Я компания</a>
      </div>
      <form class="panel stack" id="f" novalidate>
        <input type="hidden" name="role" value="${role}">
        ${role === 'company' ? '<label class="field"><span class="label">Название студии или компании</span><input class="input" name="companyName" required></label>' : ''}
        <label class="field"><span class="label">${role === 'company' ? 'Контактное лицо' : 'Имя'}</span><input class="input" name="name" autocomplete="name" required></label>
        <label class="field"><span class="label">Email</span><input class="input" name="email" type="email" autocomplete="email" required></label>
        ${pwField('password', 'Пароль', { autocomplete: 'new-password' })}
        <div class="pw-box" id="pw-meter" aria-live="polite"></div>
        ${pwField('passwordConfirm', 'Повторите пароль', { autocomplete: 'new-password' })}
        ${role === 'user' ? '<label class="check"><input type="checkbox" name="ageConfirmed"> Мне есть 16 лет</label>' : ''}
        <label class="check"><input type="checkbox" name="consent"> Согласен(на) на обработку данных по <a href="#/privacy" target="_blank">политике конфиденциальности</a>. Компании получают только ответы на задания — без email и контактов.</label>
        <button class="btn btn-primary btn-block btn-lg" type="submit">Создать аккаунт</button>
        <p class="small muted" style="margin:0">Уже есть аккаунт? <a href="#/login">Войти</a></p>
      </form>
    </div>
  </div>`;
  const rf = $('#f');
  bindPassword(rf, { confirm: 'passwordConfirm', meterEl: $('#pw-meter'), who: () => ({ email: rf.email.value, name: rf.name.value }) });
  bindForm(rf, async (d) => {
    const bad = pwChecks(d.password, { email: d.email, name: d.name }).find((c) => !c[1]);
    if (bad) throw new Error(`Пароль: ${bad[0].toLowerCase()}`);
    if (d.password !== d.passwordConfirm) throw new Error('Пароли не совпадают');
    const { user } = await api('/api/auth/register', { method: 'POST', body: d });
    toast('Аккаунт создан');
    await afterAuth(user);
  });
}

async function viewOnboarding() {
  app.innerHTML = `
  <div style="max-width:680px">
    <h1>Что вам интересно?</h1>
    <p class="muted">По интересам подбираются задания. Мы не отслеживаем ваше поведение — используем только то, что вы укажете сами. Изменить можно в любой момент в профиле.</p>
    <form class="panel stack" id="f">
      ${interestChips(state.me.interests)}
      <button class="btn btn-primary btn-lg" type="submit">Продолжить</button>
    </form>
  </div>`;
  bindForm($('#f'), async (d) => {
    if (!d.interests?.length) throw new Error('Выберите хотя бы один интерес');
    const { user } = await api('/api/me', { method: 'PUT', body: { interests: d.interests } });
    state.me = user;
    location.hash = '#/home';
  });
}

// ===================================================================
//                         УЧАСТНИК: ГЛАВНАЯ
// ===================================================================
async function viewHome() {
  const [h, cat] = await Promise.all([api('/api/home'), api('/api/rewards')]);
  state.me.balance = h.balance;
  if (h.pulse?.streak) state.streak = h.pulse.streak;
  renderChrome();
  const g = h.goal;
  const tgOff = !state.me.telegram.linked;
  const all = cat.rewards;
  const plats = [['all', 'Все'], ...['steam', 'epic', 'google_play', 'in_game', 'web'].filter((p) => all.some((r) => r.platform === p)).map((p) => [p, X.platformLabel(p)])];
  let plat = 'all';

  const goalBlock = g
    ? `<div class="goal">
        <div class="goal-head"><img src="${esc(g.reward.imageUrl)}" alt=""><div><div class="label">Моя цель</div><h3><a href="#/rewards/${g.reward.id}" style="color:inherit">${esc(g.reward.title)}</a></h3></div></div>
        <div>${meter(g.reward.progress, { lg: true, animate: true })}
          <div class="meter-legend"><span><b>${fmt(h.balance)}</b> из ${fmt(g.reward.cost)} AB</span><span>${g.reward.need > 0 ? `осталось <b>${fmt(g.reward.need)} AB</b>` : '<b>Хватает на награду</b>'}</span></div></div>
        ${
          g.reward.need > 0
            ? g.path.tasks.length
              ? `<div class="path" aria-label="Задания, которые приведут к цели">${g.path.tasks
                  .map((t) => `<a href="#/tasks/${t.id}"><span class="t">${esc(t.title)}</span><span class="r">${t.needsTelegram ? '<span class="badge sky">нужен Telegram</span>' : ''}<span class="cost">+${t.reward}<small>AB</small></span></span></a>`)
                  .join('')}</div>
                 <p class="tiny muted" style="margin:0">${g.path.covers ? 'Этих заданий хватит, чтобы дойти до цели.' : `Открытых заданий пока хватает на ${fmt(g.path.total)} AB из ${fmt(g.reward.need)}. Новые задания появятся, когда компании их опубликуют.`}</p>`
              : '<p class="small muted" style="margin:0">Сейчас нет открытых заданий. Загляните позже — мы пришлём уведомление о новых.</p>'
            : `<a class="btn btn-gold" href="#/rewards/${g.reward.id}">Получить награду</a>`
        }
      </div>`
    : `<div class="goal"><div class="goal-head"><span class="feed-ico debit">${I.target(20)}</span><div><h3>Выберите цель</h3><div class="small muted">Отметьте награду в каталоге — здесь появится прогресс и задания, которые к ней приведут.</div></div></div><a class="btn btn-ghost" href="#/rewards">Открыть каталог</a></div>`;

  const f = h.featured;
  app.innerHTML = `
  <section class="store-hero">
    <div class="store-copy">
      <p class="kicker">Здравствуйте, ${esc(state.me.name)} · магазин наград</p>
      <h1 class="store-h1">Что можно<span>получить.</span></h1>
      <p class="lead">Ключи игр для Steam, Epic Games и Google Play, предметы и подписки — от самих студий. Платите вниманием, а не деньгами.</p>
      <div class="store-balance tilt"><span class="coin" aria-hidden="true"></span><div><b class="num">${fmt(h.balance)}</b><small>AB Points на балансе</small></div><a class="btn btn-primary" href="#/tasks">Заработать</a></div>
    </div>
    ${
      f
        ? `<div class="showcase showcase-3d">
        <div class="view3d" ${has3d(f) ? `data-3d data-model="${modelForReward(f)[0]}" data-variant="${modelForReward(f)[1]}" data-wheel="focus" data-href="#/rewards/${f.id}" data-distance="3.1"` : ''} aria-label="3D-модель награды «${esc(f.title)}»"><img src="${esc(f.imageUrl)}" alt="">${demoBadge(f.demo)}</div>
        <div class="cap"><span class="k">${g && g.reward.id === f.id ? 'Ваша цель' : f.redeemed > 0 ? 'Чаще всего выбирают' : 'Из каталога'} · ${esc(f.company)}${f.platform ? ` · ${esc(X.platformLabel(f.platform))}` : ''}</span>
          <h2><a href="#/rewards/${f.id}">${esc(f.title)}</a></h2><span class="cost" style="font-size:1.6rem">${fmt(f.cost)}<small>AB</small></span></div></div>`
        : ''
    }
  </section>

  <section class="section" style="margin-top:28px">
    <div class="section-head"><h2>Каталог</h2><a href="#/rewards">Фильтры и сортировка</a></div>
    <div class="chips plat-rail" role="group" aria-label="Площадка">${plats.map(([id, l]) => `<button class="chip" data-plat="${id}" aria-pressed="${id === 'all'}">${esc(l)}</button>`).join('')}</div>
    <div class="reward-grid" id="store" style="margin-top:16px"></div>
  </section>

  <section class="section">
    <div class="section-head"><h2>Хотим подключить</h2><span class="small muted">Партнёрств пока нет — эти награды нельзя получить</span></div>
    <div class="soon-grid">
      ${[
        ['Kaspi', 'Бонусы и скидки в магазинах', 'Нужен договор с Kaspi'],
        ['YouTube Premium', 'Идея: месяц без рекламы за ежедневный челлендж', 'Нужен партнёр-реселлер'],
        ['Магазины игр', 'Пополнение кошельков и подарочные карты', 'Ищем партнёров'],
        ['Кинотеатры и стриминг', 'Билеты и подписки', 'Ищем партнёров'],
      ]
        .map(([t, d, n]) => `<div class="soon tilt" aria-disabled="true"><span class="badge">скоро</span><b>${t}</b><span>${d}</span><small>${n}</small></div>`)
        .join('')}
    </div>
  </section>

  <section class="home-split section">
    <div>
      <div class="section-head"><h2>Пульс</h2><a href="#/stats">Статистика</a></div>
      ${X.pulseBlock(h.pulse)}
    </div>
    <div class="wallet">
      <div class="section-head" style="margin:0"><h2>Моя цель</h2></div>
      ${goalBlock}
    </div>
  </section>

  ${
    tgOff
      ? `<div class="nudge" style="margin-top:28px"><span class="tg">${I.tg(18)}</span><div><b>Подключите Telegram</b><div class="small muted">Сообщим о начислении сразу после проверки. Подтверждённый аккаунт открывает задания с пометкой «нужен Telegram»${state.meta.telegram.verifyBonus ? ` и даёт +${state.meta.telegram.verifyBonus} AB` : ''}.</div></div><a class="btn btn-ghost btn-sm" href="#/profile">Подключить</a></div>`
      : ''
  }

  <section class="section">
    <div class="section-head"><h2>Задания для вас</h2><a href="#/tasks">Все задания (${h.totalOpenTasks})</a></div>
    ${h.tasks.length ? `<div class="tickets">${h.tasks.map(ticket).join('')}</div>` : empty('Нет новых заданий по вашим интересам', 'Добавьте интересы или посмотрите все задания.', '<a class="btn btn-ghost" href="#/tasks?all=1">Все задания</a>')}
  </section>

  <section class="section">
    <div class="section-head"><h2>Недавнее</h2><a href="#/activity">Вся активность</a></div>
    ${h.activity.length ? `<div class="panel panel-tight">${feedGrouped(h.activity)}</div>` : '<p class="muted">Здесь появятся начисления и проверки.</p>'}
  </section>`;
  const drawStore = () => {
    const list = all.filter((r) => plat === 'all' || r.platform === plat).sort((a, b) => Number(b.stock > 0) - Number(a.stock > 0) || a.need - b.need || a.cost - b.cost);
    $('#store').innerHTML = list.map((r) => rewardCard(r, { goalId: state.me.goalRewardId })).join('') || '<p class="muted">Здесь пока пусто.</p>';
    bindGoalToggles($('#store'), viewHome);
  };
  $$('[data-plat]').forEach((b) =>
    b.addEventListener('click', () => {
      plat = b.dataset.plat;
      $$('[data-plat]').forEach((x) => x.setAttribute('aria-pressed', x === b));
      drawStore();
    })
  );
  drawStore();
  X.bindPulse(app, h.pulse);
  state.onReward = viewHome;
  setTimeout(() => X.startTour(), 700);
}

// ===================================================================
//                     УЧАСТНИК: КАТАЛОГ НАГРАД
// ===================================================================
async function viewRewards({ query }) {
  const { rewards, mine, goalRewardId } = await api('/api/rewards');
  state.me.goalRewardId = goalRewardId;
  const cat = query.cat || 'all';
  const only = query.only === '1';
  const sort = query.sort || 'smart';
  let list = rewards.filter((r) => (cat === 'all' || r.category === cat) && (!only || r.affordable));
  const sorters = {
    smart: (a, b) => Number(b.stock > 0) - Number(a.stock > 0) || a.need - b.need || a.cost - b.cost,
    cheap: (a, b) => a.cost - b.cost,
    expensive: (a, b) => b.cost - a.cost,
    popular: (a, b) => b.redeemed - a.redeemed || a.cost - b.cost,
  };
  list = [...list].sort(sorters[sort] || sorters.smart);
  const goal = rewards.find((r) => r.id === goalRewardId);
  const setQ = (patch) => {
    const q = new URLSearchParams({ cat, only: only ? '1' : '0', sort, ...patch });
    location.hash = `#/rewards?${q}`;
  };

  app.innerHTML = `
  <div class="page-head">
    <div><h1>Награды</h1><p>На балансе <b class="num" style="color:var(--ink)">${fmt(state.me.balance)} AB</b>${goal ? ` · цель: <a href="#/rewards/${goal.id}">${esc(goal.title)}</a>` : ' · отметьте награду как цель, чтобы видеть прогресс'}</p></div>
  </div>
  <div class="filterbar">
    <div class="chips" role="group" aria-label="Категория">
      <button class="chip" data-cat="all" aria-pressed="${cat === 'all'}">Все</button>
      ${state.meta.rewardCategories.map((c) => `<button class="chip" data-cat="${c.id}" aria-pressed="${cat === c.id}">${esc(c.label)}</button>`).join('')}
    </div>
    <button class="chip" id="only" aria-pressed="${only}">Хватает баллов</button>
    <label class="sr-only" for="sort">Сортировка</label>
    <select class="input" id="sort" style="width:auto;min-height:40px">
      <option value="smart" ${sort === 'smart' ? 'selected' : ''}>Ближе к получению</option>
      <option value="popular" ${sort === 'popular' ? 'selected' : ''}>Популярные</option>
      <option value="cheap" ${sort === 'cheap' ? 'selected' : ''}>Сначала дешевле</option>
      <option value="expensive" ${sort === 'expensive' ? 'selected' : ''}>Сначала дороже</option>
    </select>
  </div>
  ${
    list.length
      ? `<div class="reward-grid">${list.map((r, i) => rewardCard(r, { goalId: goalRewardId, featured: i === 0 && list.length >= 4 })).join('')}</div>`
      : empty(only ? 'Пока не хватает баллов ни на одну награду' : 'В этой категории пока нет наград', only ? 'Выполните задание — баллы придут после проверки.' : 'Попробуйте другую категорию.', only ? '<a class="btn btn-primary" href="#/tasks">Найти задания</a>' : '')
  }
  ${
    mine.length
      ? `<section class="section"><div class="section-head"><h2>Мои награды</h2></div>
      <div class="panel panel-tight table-wrap"><table class="table"><thead><tr><th>Награда</th><th class="hide-sm">Получена</th><th class="r">Код</th></tr></thead><tbody>
      ${mine.map((m) => `<tr><td><a class="title" href="#/rewards/${m.reward_id}">${esc(m.title)}</a><div class="tiny muted">−${m.cost} AB</div></td><td class="hide-sm">${fmtDate(m.created_at)}</td><td class="r"><span class="code">${esc(m.code)}</span></td></tr>`).join('')}
      </tbody></table></div></section>`
      : ''
  }`;
  $$('[data-cat]').forEach((b) => b.addEventListener('click', () => setQ({ cat: b.dataset.cat })));
  $('#only').addEventListener('click', () => setQ({ only: only ? '0' : '1' }));
  $('#sort').addEventListener('change', (e) => setQ({ sort: e.target.value }));
  bindGoalToggles(app, () => viewRewards({ query }));
}

// Факты о награде вокруг 3D-модели: всё из реальных данных
function hotspots(r, tasks = []) {
  const withTime = tasks.filter((t) => t.estMinutes);
  const rate = withTime.length ? withTime.reduce((s, t) => s + t.reward, 0) / withTime.reduce((s, t) => s + t.estMinutes, 0) : null;
  const list = [];
  if (r.platform) list.push(['Где активировать', X.platformLabel(r.platform)]);
  list.push(['От кого', r.company + (r.demo ? ' · демо' : '')]);
  list.push(['В наличии', r.stock > 0 ? `${fmt(r.stock)} шт.` : 'нет']);
  list.push(['Уже получили', `${fmt(r.redeemed)} ${plural(r.redeemed, 'раз', 'раза', 'раз')}`]);
  if (rate) list.push(['Цена во времени', `≈ ${Math.max(1, Math.round(r.cost / rate))} мин внимания`]);
  return list.slice(0, 5);
}

async function viewReward({ params }) {
  const { reward: r, tasks } = await api(`/api/rewards/${params.id}`);
  const canRedeem = r.stock > 0 && r.affordable;
  app.innerHTML = `
  <a class="crumb" href="#/rewards">${I.back(16)} Все награды</a>
  <div class="product">
    <div class="product-col">
    ${
      has3d(r)
        ? `<div class="product-img view3d" data-3d data-model="${modelForReward(r)[0]}" data-variant="${modelForReward(r)[1]}" data-wheel="always" data-touch="none" data-distance="3.0" aria-label="3D-модель награды «${esc(r.title)}». Вращайте мышью, пальцем или стрелками; колесо или щипок — приближение"><img src="${esc(r.imageUrl)}" alt="">
            <span class="stage-hint">Вращайте мышью или пальцем · колесо — приближение</span></div>`
        : `<div class="product-img"><img src="${esc(r.imageUrl)}" alt="${esc(r.title)}"></div>`
    }
    <dl class="specs">${hotspots(r, tasks).map((h) => `<div class="tilt"><dt>${esc(h[0])}</dt><dd>${esc(h[1])}</dd></div>`).join('')}</dl>
    </div>
    <div>
      <div class="meta"><span>${esc(r.categoryLabel)}</span><span class="sep"></span><span>${esc(r.company)}</span>${demoBadge(r.demo)}</div>
      <h1>${esc(r.title)}</h1>
      <p class="lead">${esc(r.description)}</p>
      <div class="buybox">
        <div class="row" style="justify-content:space-between;align-items:flex-end"><span class="cost">${fmt(r.cost)}<small>AB</small></span>
          <span class="small ${r.stock > 0 ? 'muted' : ''}" style="${r.stock > 0 ? '' : 'color:var(--bad);font-weight:600'}">${r.stock > 0 ? `В наличии: ${fmt(r.stock)}` : 'Нет в наличии'}</span></div>
        ${r.stock > 0 ? `<div>${meter(r.progress, { lg: true })}<div class="meter-legend"><span>У вас <b>${fmt(state.me.balance)} AB</b></span><span>${r.need > 0 ? `не хватает <b>${fmt(r.need)} AB</b>` : '<b>Баллов достаточно</b>'}</span></div></div>` : ''}
        <div class="row">
          ${canRedeem ? `<button class="btn btn-gold btn-lg" id="redeem">Получить за ${fmt(r.cost)} AB</button>` : r.stock > 0 ? `<a class="btn btn-primary btn-lg" href="#/tasks">Найти задания</a>` : ''}
          ${r.stock > 0 ? `<button class="btn btn-ghost btn-lg" id="goal" aria-pressed="${r.isGoal}">${I.target(18)} ${r.isGoal ? 'Это ваша цель' : 'Сделать целью'}</button>` : ''}
        </div>
        <p class="tiny muted" style="margin:0">AB Points — внутренние баллы платформы. После обмена баллы не возвращаются.</p>
      </div>
      <h2 style="font-size:1.15rem">Как получить</h2>
      <ol class="steps">
        <li><span><b>Обменяйте ${fmt(r.cost)} AB</b><span class="small muted">Баллы спишутся одной транзакцией — она появится в активности.</span></span></li>
        <li><span><b>Получите код</b><span class="small muted">Код сразу покажется на экране и сохранится в разделе «Мои награды»${state.me.telegram.linked ? ' и придёт в Telegram' : ''}.</span></span></li>
        <li><span><b>Активируйте</b><span class="small muted">${esc(r.howToUse || 'Инструкцию по активации даёт компания, предоставившая награду.')}</span></span></li>
      </ol>
      ${r.mine.length ? `<h2 style="font-size:1.15rem;margin-top:28px">Ваши коды</h2><div class="codes">${r.mine.map((m) => `<div class="row"><span class="code">${esc(m.code)}</span><span class="tiny muted">${fmtDate(m.created_at)}</span></div>`).join('')}</div>` : ''}
    </div>
  </div>
  ${
    r.need > 0 && r.stock > 0
      ? `<section class="section"><div class="section-head"><h2>Где заработать ${fmt(r.need)} AB</h2><a href="#/tasks">Все задания</a></div>
         ${tasks.length ? `<div class="tickets">${tasks.map(ticket).join('')}</div>` : '<p class="muted">Сейчас нет открытых заданий. Новые появятся, когда компании их опубликуют.</p>'}</section>`
      : ''
  }`;

  $('#goal')?.addEventListener('click', async (e) =>
    busy(e.currentTarget, async () => {
      try {
        await api('/api/me/goal', { method: 'PUT', body: { rewardId: r.isGoal ? null : r.id } });
        toast(r.isGoal ? 'Цель убрана' : 'Цель выбрана — прогресс видно на главной');
        viewReward({ params });
      } catch (err) {
        toast(err.message, { kind: 'err' });
      }
    })
  );
  $('#redeem')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget; // после await ссылка в событии обнуляется
    const ok = await confirmDialog({
      title: 'Обменять баллы на награду?',
      body: `<p style="margin:0 0 8px"><b>${esc(r.title)}</b></p><p class="small muted" style="margin:0">Спишется <b>${fmt(r.cost)} AB</b>. Останется ${fmt(state.me.balance - r.cost)} AB. Обмен нельзя отменить.</p>`,
      confirm: `Получить за ${fmt(r.cost)} AB`,
      tone: 'gold',
    });
    if (!ok) return;
    await busy(btn, async () => {
      try {
        const res = await api(`/api/rewards/${r.id}/redeem`, { method: 'POST', body: {}, idem: true });
        state.me.balance = res.balance;
        renderChrome();
        // Салют золотых кристаллов над 3D-витриной, затем чек
        await $('.product-img')?._view?.burst();
        await receiptDialog(r, res);
        viewReward({ params });
      } catch (err) {
        toast(err.message, { kind: 'err' });
      }
    });
  });
}

// ===================================================================
//                         УЧАСТНИК: ЗАДАНИЯ
// ===================================================================
async function viewTasks({ query }) {
  const tab = query.tab === 'mine' ? 'mine' : 'open';
  const [{ tasks }, { submissions }] = await Promise.all([api('/api/tasks'), api('/api/my/submissions')]);
  const all = query.all === '1';
  const cat = query.cat || 'all';
  const minReward = Number(query.min || 0);
  const maxTime = Number(query.time || 0);
  const sort = query.sort || 'reward';
  const rate = (t) => (t.estMinutes ? t.reward / t.estMinutes : 0);
  const sorters = {
    reward: (a, b) => b.reward - a.reward,
    time: (a, b) => (a.estMinutes ?? 999) - (b.estMinutes ?? 999),
    rate: (a, b) => rate(b) - rate(a),
  };
  const open = tasks
    .filter((t) => !t.my && (all || t.matches) && (cat === 'all' || t.category === cat) && t.reward >= minReward && (!maxTime || (t.estMinutes && t.estMinutes <= maxTime)))
    .sort(sorters[sort] || sorters.reward);
  const hidden = tasks.filter((t) => !t.my && !t.matches).length;
  const setQ = (patch) => (location.hash = `#/tasks?${new URLSearchParams({ tab, all: all ? '1' : '0', cat, min: minReward, time: maxTime, sort, ...patch })}`);

  app.innerHTML = `
  <div class="page-head"><div><h1>Задания</h1><p>Выбирайте сами. Время, награда и условия проверки видны до начала.</p></div></div>
  <div class="tabs" role="tablist">
    <button role="tab" aria-selected="${tab === 'open'}" data-tab="open">Доступные (${tasks.filter((t) => !t.my).length})</button>
    <button role="tab" aria-selected="${tab === 'mine'}" data-tab="mine">Мои (${submissions.length})</button>
  </div>
  ${
    tab === 'open'
      ? `<div class="filterbar">
      <div class="chips" role="group" aria-label="Категория">
        <button class="chip" data-cat="all" aria-pressed="${cat === 'all'}">Все категории</button>
        ${state.meta.categories.map((c) => `<button class="chip" data-cat="${c.id}" aria-pressed="${cat === c.id}">${esc(c.label)}</button>`).join('')}
      </div>
      <button class="chip" id="all" aria-pressed="${!all}">Только по интересам</button>
    </div>
    <div class="filterbar" style="margin-top:-10px">
      <label class="sr-only" for="f-min">Награда</label>
      <select class="input" id="f-min" style="width:auto;min-height:40px">
        ${[[0, 'Любая награда'], [20, 'От 20 AB'], [50, 'От 50 AB'], [100, 'От 100 AB']].map(([v, l]) => `<option value="${v}" ${minReward === v ? 'selected' : ''}>${l}</option>`).join('')}
      </select>
      <label class="sr-only" for="f-time">Время</label>
      <select class="input" id="f-time" style="width:auto;min-height:40px">
        ${[[0, 'Любое время'], [5, 'До 5 мин'], [15, 'До 15 мин'], [30, 'До 30 мин']].map(([v, l]) => `<option value="${v}" ${maxTime === v ? 'selected' : ''}>${l}</option>`).join('')}
      </select>
      <label class="sr-only" for="f-sort">Сортировка</label>
      <select class="input" id="f-sort" style="width:auto;min-height:40px">
        <option value="reward" ${sort === 'reward' ? 'selected' : ''}>Сначала больше награда</option>
        <option value="time" ${sort === 'time' ? 'selected' : ''}>Сначала быстрее</option>
        <option value="rate" ${sort === 'rate' ? 'selected' : ''}>Лучший обмен AB за минуту</option>
      </select>
    </div>
    ${open.length ? `<div class="tickets">${open.map(ticket).join('')}</div>` : empty('Подходящих заданий нет', all ? 'Новые задания появятся, когда компании их опубликуют.' : 'Попробуйте показать задания вне ваших интересов.', all ? '' : '<button class="btn btn-ghost" id="show-all">Показать все</button>')}
    ${!all && hidden ? `<p class="small muted" style="margin-top:18px">Ещё ${hidden} ${plural(hidden, 'задание', 'задания', 'заданий')} вне ваших интересов — <a href="#/tasks?all=1">показать</a>.</p>` : ''}`
      : submissions.length
        ? `<div class="tickets">${submissions
            .map(
              (s) => `<a class="ticket" href="#/tasks/${s.campaignId}"><div><div class="meta"><span class="badge">${esc(s.categoryLabel)}</span>${statusBadge(s.status)}</div><h3>${esc(s.title)}</h3>
            <p class="desc">${s.submittedAt ? `Отправлено ${fmtDate(s.submittedAt)}` : `Начато ${fmtDate(s.startedAt)}`}${s.reviewNote ? ` · ${esc(s.reviewNote)}` : ''}</p></div>
            <div class="right"><span class="cost" style="font-size:1.3rem;color:${s.status === 'approved' ? 'var(--ok)' : 'var(--muted)'}">+${fmt(s.reward)}<small>AB</small></span><span class="tiny muted">${s.status === 'approved' ? 'начислено' : s.status === 'rejected' ? 'не начислено' : 'после проверки'}</span></div></a>`
            )
            .join('')}</div>`
        : empty('Вы ещё не выполняли заданий', 'Выберите задание — награда придёт после проверки.', '<a class="btn btn-primary" href="#/tasks">Выбрать задание</a>')
  }`;
  $$('[data-tab]').forEach((b) => b.addEventListener('click', () => setQ({ tab: b.dataset.tab })));
  $$('[data-cat]').forEach((b) => b.addEventListener('click', () => setQ({ cat: b.dataset.cat })));
  $('#all')?.addEventListener('click', () => setQ({ all: all ? '0' : '1' }));
  $('#f-min')?.addEventListener('change', (e) => setQ({ min: e.target.value }));
  $('#f-time')?.addEventListener('change', (e) => setQ({ time: e.target.value }));
  $('#f-sort')?.addEventListener('change', (e) => setQ({ sort: e.target.value }));
  $('#show-all')?.addEventListener('click', () => setQ({ all: '1' }));
}

function questionInput(q, value, disabled) {
  const dis = disabled ? 'disabled' : '';
  if (q.type === 'rating')
    return `<div class="scale" role="radiogroup" aria-label="${esc(q.label)}">${[1, 2, 3, 4, 5]
      .map((n) => `<label><input type="radio" name="${q.id}" value="${n}" ${value == n ? 'checked' : ''} ${dis}><span>${n}</span></label>`)
      .join('')}</div><div class="scale-legend"><span>Совсем нет</span><span>Отлично</span></div>`;
  if (q.type === 'choice')
    return `<div class="options">${q.options.map((o) => `<label class="option"><input type="radio" name="${q.id}" value="${esc(o)}" ${value === o ? 'checked' : ''} ${dis}>${esc(o)}</label>`).join('')}</div>`;
  if (q.type === 'url')
    return `<input class="input" type="url" name="${q.id}" value="${esc(value ?? '')}" placeholder="https://" ${dis}><span class="hint">Ссылка на скриншот, видео или другое подтверждение</span>`;
  return `<textarea class="input" name="${q.id}" data-min="${q.minLength ?? 30}" ${dis} placeholder="Конкретно: что делали, что увидели, что мешало">${esc(value ?? '')}</textarea>${disabled ? '' : `<div class="counter" data-counter="${q.id}"></div>`}`;
}

async function viewTask({ params }) {
  const { task: t } = await api(`/api/tasks/${params.id}`);
  const my = t.my;
  const status = my?.status;
  const steps = (t.instructions || '').split('\n').map((s) => s.trim()).filter(Boolean);
  const stage = (s) => (status === s ? 'now' : '');

  const timeline = `<ol class="timeline" aria-label="Статус проверки">
    <li class="${my ? 'done' : ''}"><span>Начато${my ? `<span class="muted">${fmtDate(my.startedAt)}</span>` : '<span class="muted">после нажатия «Начать»</span>'}</span></li>
    <li class="${my?.submittedAt ? 'done' : stage('started')}"><span>Ответ отправлен${my?.submittedAt ? `<span class="muted">${fmtDate(my.submittedAt)}${my.autoScore != null ? ` · качество ${my.autoScore}/100` : ''}</span>` : ''}</span></li>
    <li class="${status === 'approved' ? 'done' : status === 'rejected' ? 'fail' : stage('submitted')}"><span>${status === 'rejected' ? 'Не принято' : 'Проверено'}${my?.reviewedAt ? `<span class="muted">${my.reviewedBy === 'auto' ? 'автопроверка' : 'компания'} · ${fmtDate(my.reviewedAt)}</span>` : status === 'submitted' ? '<span class="muted">ждёт решения</span>' : ''}</span></li>
    <li class="${status === 'approved' ? 'done' : ''}"><span>Начислено +${fmt(t.reward)} AB</span></li>
  </ol>`;

  let action = '';
  if (!my) {
    action =
      t.requireTelegram && !state.me.telegram.linked
        ? `<p class="small" style="margin:0">Задание доступно аккаунтам, подтверждённым через Telegram.</p><a class="btn btn-primary btn-block" href="#/profile">Подключить Telegram</a>`
        : `<button class="btn btn-primary btn-block btn-lg" id="start">Начать задание</button><p class="tiny muted" style="margin:0">Сервер зафиксирует время начала. Отказаться можно в любой момент — просто не отправляйте ответ.</p>`;
  } else if (status === 'approved') {
    action = `<div><span class="stamp ${state.justDone ? 'press' : ''}">${I.check(18)} Подтверждено</span></div>${my.qualityRating ? `<p class="small" style="margin:0">Оценка компании: <b>${my.qualityRating} из 5</b></p>` : ''}${my.reviewNote ? `<p class="small" style="margin:0">«${esc(my.reviewNote)}»</p>` : ''}<a class="btn btn-ghost btn-block" href="#/activity">Открыть активность</a>`;
  } else if (status === 'rejected') {
    action = `<div><span class="stamp bad ${state.justDone ? 'press' : ''}">${I.x(18)} Не принято</span></div>${my.reviewNote ? `<p class="small" style="margin:0"><b>Причина:</b> ${esc(my.reviewNote)}</p>` : ''}`;
  } else if (status === 'submitted') {
    action = `<div><span class="stamp wait ${state.justDone ? 'press' : ''}">${I.hourglass(18)} На проверке</span></div><p class="small muted" style="margin:0">Когда компания примет решение, баланс обновится сам${state.me.telegram.linked && state.me.notifyTelegram ? ', а в Telegram придёт сообщение' : ''}.</p>`;
  } else if (status === 'started') {
    action = `<p class="small" style="margin:0">Время выполнения: <b class="num" id="timer">0:00</b></p><p class="tiny muted" style="margin:0">Рекомендуемый минимум — ${minutes(t.minSeconds)}.</p>`;
  }
  state.justDone = false;

  app.innerHTML = `
  <a class="crumb" href="#/tasks">${I.back(16)} Все задания</a>
  <div class="task-layout">
    <article class="doc">
      <div class="meta"><span class="badge">${esc(t.categoryLabel)}</span><span>${esc(t.company)}</span>${demoBadge(t.companyDemo)}${status ? statusBadge(status) : ''}</div>
      <h1 style="margin-top:12px">${esc(t.title)}</h1>
      <p style="font-size:1.05rem;color:var(--ink-2)">${esc(t.description)}</p>
      ${t.productUrl ? `<a class="btn btn-ghost" href="${esc(productHref(t.productUrl))}" target="_blank" rel="noopener noreferrer">${I.external(16)} Открыть продукт</a>` : ''}

      ${steps.length ? `<h2>Что нужно сделать</h2><ol class="steps">${steps.map((s) => `<li><span>${esc(s)}</span></li>`).join('')}</ol>` : ''}

      <h2>Как проверяется</h2>
      <ul class="checks">
        <li>${I.clock(17)}<span>Сервер фиксирует время. Ответ быстрее ${minutes(t.minSeconds)} получает пониженную оценку качества.</span></li>
        <li>${I.shield(17)}<span>Автопроверка ищет формальные и скопированные ответы и однообразные оценки.</span></li>
        <li>${I.check(17)}<span>${t.autoApprove ? 'Ответ с оценкой качества от 70 из 100 подтверждается автоматически.' : 'Окончательное решение принимает компания.'} Баллы начисляются только после подтверждения.</span></li>
        ${t.requireTelegram ? `<li>${I.tg(17)}<span>Нужен аккаунт, подтверждённый через Telegram.</span></li>` : ''}
      </ul>

      <h2>Что получит компания</h2>
      <p class="muted">Ваши ответы на ${t.questions.length} ${plural(t.questions.length, 'вопрос', 'вопроса', 'вопросов')}, имя и оценку качества. Email и контакты не передаются.</p>

      ${
        my
          ? `<form id="answers" novalidate style="margin-top:8px">
        <h2>Ваши ответы</h2>
        ${t.questions.map((q) => `<div class="question field" data-q="${q.id}"><span class="q-label">${q.check ? '<span class="badge gold" title="По ответу проверяется, что вы действительно посмотрели или прошли продукт">контрольный вопрос</span> ' : ''}${esc(q.label)}${q.required ? '' : ' <span class="muted" style="font-weight:400">(необязательно)</span>'}</span>${questionInput(q, my.answers?.[q.id], status !== 'started')}</div>`).join('')}
        ${status === 'started' ? '<button class="btn btn-primary btn-lg" type="submit">Отправить результат</button>' : ''}
      </form>`
          : `<ol class="steps" style="margin-top:6px">${t.questions.map((q) => `<li><span>${esc(q.label)}${q.required ? '' : ' <span class="muted">(необязательно)</span>'}</span></li>`).join('')}</ol>`
      }
    </article>
    <aside class="task-aside">
      <div class="summary">
        <div class="summary-top">${exchange(t.estMinutes, t.reward)}</div>
        <div class="summary-body">
          <dl class="kv"><dt>Мест осталось</dt><dd>${t.slotsLeft} из ${t.maxParticipants}</dd><dt>Аудитория</dt><dd>${t.audience.length ? t.audience.map(interestLabel).map(esc).join(', ') : 'все'}</dd></dl>
          ${timeline}
          ${action}
        </div>
      </div>
    </aside>
  </div>`;

  $('#start')?.addEventListener('click', (e) =>
    busy(e.currentTarget, async () => {
      try {
        await api(`/api/tasks/${t.id}/start`, { method: 'POST', body: {} });
        await viewTask({ params });
        $('#answers')?.scrollIntoView({ behavior: 'smooth' });
      } catch (err) {
        toast(err.message, { kind: 'err' });
      }
    })
  );

  if (status === 'started') {
    const started = new Date(my.startedAt).getTime();
    const tick = () => {
      const s = Math.max(0, Math.floor((Date.now() - started) / 1000));
      const el = $('#timer');
      if (el) el.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    };
    tick();
    state.timer = setInterval(tick, 1000);
    $$('textarea[data-min]').forEach((ta) => {
      const c = $(`[data-counter="${ta.name}"]`);
      const upd = () => {
        const n = ta.value.trim().length;
        const min = Number(ta.dataset.min);
        c.textContent = n >= min ? `${n} символов` : `${n} из минимум ${min}`;
        c.classList.toggle('ok', n >= min);
      };
      ta.addEventListener('input', upd);
      upd();
    });
    // Сигналы для проверки качества: вставлен ли текст и сколько времени его набирали (сам текст никуда не уходит отдельно)
    const meta = { pasted: [], typingMs: {} };
    $$('#answers textarea').forEach((ta) => {
      let first = 0;
      ta.addEventListener('paste', (e) => {
        const txt = e.clipboardData?.getData('text') || '';
        if (txt.length >= 40 && !meta.pasted.includes(ta.name)) meta.pasted.push(ta.name);
      });
      ta.addEventListener('input', () => {
        if (!first) first = performance.now();
        meta.typingMs[ta.name] = Math.round(performance.now() - first);
      });
    });
    bindForm($('#answers'), async (d) => {
      const res = await api(`/api/tasks/${t.id}/submit`, { method: 'POST', body: { answers: d, meta }, idem: true });
      await refreshMe();
      renderChrome();
      state.justDone = true;
      if (res.outcome === 'approved') toast(`Подтверждено автоматически. Баланс: ${fmt(state.me.balance)} AB`, { stamp: `+${t.reward} AB` });
      else if (res.outcome === 'rejected') toast('Ответ не прошёл автопроверку', { kind: 'err' });
      else toast('Результат отправлен на проверку');
      await viewTask({ params });
    });
  }
  if (status === 'submitted') state.onReward = () => ((state.justDone = true), viewTask({ params }));
}

// ===================================================================
//                     АКТИВНОСТЬ / БЮДЖЕТ КОМПАНИИ
// ===================================================================
async function viewActivity({ query, path }) {
  const isCompany = state.me.role === 'company';
  const data = await api('/api/activity');
  state.me.balance = data.balance;
  renderChrome();
  const filter = query.f || 'all';
  const groups = {
    all: () => true,
    in: (a) => a.amount > 0,
    out: (a) => a.amount < 0,
    checks: (a) => a.kind === 'submitted' || a.kind === 'rejected' || a.kind === 'reward',
  };
  const items = data.items.filter(groups[filter] || groups.all);
  const kzt = state.meta.economy.abToKzt;

  app.innerHTML = `
  <div class="page-head">
    <div><h1>${isCompany ? 'Бюджет' : 'Активность'}</h1><p>${isCompany ? 'Пополнения, резервы кампаний, возвраты.' : 'Начисления, списания и проверки ваших ответов.'}</p></div>
  </div>
  <div class="grid-2" style="grid-template-columns:minmax(0,1.6fr) minmax(0,1fr);align-items:start">
    <div>
      <div class="chips" role="group" aria-label="Фильтр" style="margin-bottom:18px">
        ${[['all', 'Все'], ['in', 'Начисления'], ['out', 'Списания'], ...(isCompany ? [] : [['checks', 'Проверки']])]
          .map(([k, l]) => `<button class="chip" data-f="${k}" aria-pressed="${filter === k}">${l}</button>`)
          .join('')}
      </div>
      <div class="panel panel-tight">${items.length ? feedGrouped(items) : '<p class="muted" style="margin:0">Здесь пока пусто.</p>'}</div>
    </div>
    <aside class="stack">
      <div class="panel">
        <div class="small muted">Баланс</div>
        <div class="cost" style="font-size:2.6rem;line-height:1.1;margin:4px 0">${fmt(data.balance)}<small>AB</small></div>
        <div class="small muted">${isCompany ? `ориентировочно ${fmt(data.balance * kzt)} ₸ по курсу платформы` : 'Внутренние баллы платформы, не деньги'}</div>
      </div>
      <div class="integrity ${data.integrity.ok ? '' : 'bad'}">${data.integrity.ok ? I.shield(18) : I.x(18)}<span>${data.integrity.ok ? `Баланс сверен с журналом: ${fmt(data.integrity.cached)} = сумме всех транзакций` : `Расхождение: ${data.integrity.cached} ≠ ${data.integrity.computed}`}</span></div>
      ${
        isCompany && state.meta.demoMode
          ? `<form class="panel stack" id="dep"><h3 style="margin:0">Пополнить бюджет</h3><p class="small muted" style="margin:0">Демо-режим: без оплаты. В рабочей версии здесь будет платёжный шлюз.</p>
          <label class="field"><span class="label">Сумма, AB</span><input class="input" name="amount" type="number" min="100" step="100" value="5000"></label>
          <button class="btn btn-primary" type="submit">Пополнить</button></form>`
          : ''
      }
      ${!isCompany ? '<a class="btn btn-gold btn-block" href="#/rewards">Потратить на награды</a>' : ''}
    </aside>
  </div>`;
  $$('[data-f]').forEach((b) => b.addEventListener('click', () => (location.hash = `#${path}?f=${b.dataset.f}`)));
  $('#dep') &&
    bindForm($('#dep'), async (d) => {
      const r = await api('/api/company/deposit', { method: 'POST', body: { amount: Number(d.amount) }, idem: true });
      toast(`Бюджет пополнен. Баланс: ${fmt(r.balance)} AB`);
      await refreshMe();
      viewActivity({ query, path });
    });
  if (!isCompany) state.onReward = () => viewActivity({ query, path });
}

// ===================================================================
//                       ПРОФИЛЬ И НАСТРОЙКИ
// ===================================================================
const trustLabel = { new: ['Новый участник', ''], regular: ['Обычная репутация', 'sky'], trusted: ['Надёжный участник', 'ok'], risky: ['Репутация под вопросом', 'bad'] };

async function viewProfile() {
  await refreshMe();
  const me = state.me;
  const tg = me.telegram;
  const stats = me.role === 'user' ? (await api('/api/home')).stats : null;
  app.innerHTML = `
  <div class="profile-head">
    <button type="button" class="avatar-edit" id="ava-edit" aria-label="Сменить аватар">${X.avatarHtml(me, 'lg')}<span>изменить</span></button>
    <div><h1>${esc(me.role === 'company' ? me.companyName : me.name)}</h1>
      <div class="meta" style="margin-top:6px"><span>${esc(me.email)}</span><span class="sep"></span><span>${me.role === 'company' ? 'Компания' : 'Участник'}</span>
      ${tg.linked ? '<span class="badge ok">Telegram подтверждён</span>' : ''}${stats ? `<span class="badge ${trustLabel[stats.trust.level][1]}">${trustLabel[stats.trust.level][0]}</span>` : ''}${demoBadge(me.isDemo)}</div></div>
    <span class="spacer"></span><button class="desk-btn" type="button" data-desktop>${I.monitor(17)}<span>Приложение для ПК</span></button><a class="btn btn-ghost" href="#/settings">Настройки</a>
  </div>
  ${stats ? `<div class="kpis k4" style="margin-top:26px"><div><b>${fmt(me.balance)}</b><span>AB на балансе</span></div><div><b>${fmt(stats.earned)}</b><span>AB заработано</span></div><div><b>${stats.trust.approved}</b><span>ответов подтверждено</span></div><div><b>${stats.trust.avgQuality ?? '—'}</b><span>средняя оценка компаний</span></div></div>` : ''}
  <div class="grid-2" style="margin-top:24px;align-items:start">
    <form class="panel stack" id="f">
      <h2 style="margin:0">Данные</h2>
      <label class="field"><span class="label">${me.role === 'company' ? 'Контактное лицо' : 'Имя'}</span><input class="input" name="name" value="${esc(me.name)}"></label>
      ${me.role === 'user' ? `<div class="field"><span class="label">Интересы</span>${interestChips(me.interests)}<span class="hint">По ним подбираются задания</span></div>` : ''}
      <div><button class="btn btn-primary" type="submit">Сохранить</button></div>
    </form>
    <div class="panel stack" id="tg">
      <div class="row"><span class="nudge" style="padding:0;border:0;background:none"><span class="tg">${I.tg(18)}</span></span><h2 style="margin:0">Telegram</h2></div>
      ${
        tg.linked
          ? `<p class="small" style="margin:0">Подключён ${tg.username ? '@' + esc(tg.username) : ''}.</p>
             <ul class="tg-feats">
               <li><b>📱 Приложение в Telegram</b> — кнопка «Открыть» в чате с ботом, вход без пароля</li>
               <li><b>▶ Задания прямо в чате</b> — /tasks, ответы кнопками и сообщениями</li>
               <li><b>📊 /stats</b> — заработок, серия 🔥 и челлендж дня</li>
               <li><b>⏰ Напоминание о серии</b> — вечером, если вы ещё не заходили (/remind)</li>
               ${me.role === 'company' ? '<li><b>✅ Проверка ответов кнопками</b> — «Одобрить / Отклонить» прямо в Telegram</li>' : ''}
             </ul>
             <div><button class="btn btn-ghost btn-sm" id="tg-unlink">Отключить</button></div>`
          : `<p class="small muted" style="margin:0">Подключение подтверждает аккаунт: один Telegram — один аккаунт. Уведомления о проверках придут сразу; выключить их можно в настройках.</p>
             <div><button class="btn btn-primary" id="tg-link">Подключить Telegram</button></div><div id="tg-code"></div>`
      }
    </div>
  </div>`;
  $('#ava-edit').addEventListener('click', async () => {
    const m = $('#modal');
    m.innerHTML = `<div class="modal-body"><h2 id="modal-title" style="margin-top:0">Ваш аватар</h2>${X.avatarPicker(me.avatar)}<div class="row" style="justify-content:flex-end;margin-top:16px"><button class="btn btn-ghost" value="cancel" id="ava-x">Закрыть</button></div></div>`;
    m.showModal();
    $('#ava-x').onclick = () => m.close();
    $$('[data-ava]', m).forEach((b) =>
      b.addEventListener('click', async () => {
        try {
          const { user } = await api('/api/me', { method: 'PUT', body: { avatar: b.dataset.ava || null } });
          state.me = user;
          m.close();
          renderChrome();
          toast('Аватар обновлён');
          viewProfile();
        } catch (e) {
          toast(e.message, { kind: 'err' });
        }
      })
    );
  });
  bindForm($('#f'), async (d) => {
    const { user } = await api('/api/me', { method: 'PUT', body: { name: d.name, interests: d.interests } });
    state.me = user;
    renderChrome();
    toast('Профиль сохранён');
  });
  $('#tg-unlink')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const ok = await confirmDialog({ title: 'Отключить Telegram?', body: '<p class="small muted" style="margin:0">Уведомления перестанут приходить. Подтверждение аккаунта сохранится.</p>', confirm: 'Отключить', tone: 'danger' });
    if (!ok) return;
    await busy(btn, async () => {
      await api('/api/telegram/unlink', { method: 'POST', body: {} });
      toast('Telegram отключён');
      viewProfile();
    });
  });
  $('#tg-link')?.addEventListener('click', (e) =>
    busy(e.currentTarget, async () => {
      const c = await api('/api/telegram/link-code', { method: 'POST', body: {} });
      $('#tg-code').innerHTML = `
        ${!c.enabled ? '<p class="form-error">Бот не настроен на сервере: укажите TELEGRAM_BOT_TOKEN в .env и перезапустите сервер.</p>' : ''}
        <p class="small" style="margin:0 0 8px">${c.deepLink ? 'Откройте бота кнопкой ниже или отправьте ему команду:' : 'Отправьте боту команду:'}</p>
        <div class="tg-code">/start ${esc(c.code)}</div>
        <p class="tiny muted">Код действует 15 минут. Страница обновится сама после подтверждения.</p>
        ${c.deepLink ? `<a class="btn btn-accent" href="${esc(c.deepLink)}" target="_blank" rel="noopener">Открыть @${esc(c.botUsername)}</a>` : ''}`;
      state.tgPoll = setInterval(async () => {
        const u = await refreshMe().catch(() => null);
        if (u?.telegram.linked) {
          clearInterval(state.tgPoll);
          renderChrome();
          toast('Telegram подключён, аккаунт подтверждён', { stamp: 'Подтверждено' });
          viewProfile();
        }
      }, 3000);
    })
  );
}

async function viewSettings() {
  await refreshMe();
  const me = state.me;
  app.innerHTML = `
  <a class="crumb" href="#/profile">${I.back(16)} Профиль</a>
  <h1>Настройки</h1>
  <div class="panel" style="max-width:760px">
    <div class="settings-list">
      <label class="switch"><span><b>Уведомления в Telegram</b><span class="small muted" style="display:block">Начисления, решения по ответам, полученные коды. ${me.telegram.linked ? '' : 'Сначала подключите Telegram в профиле.'}</span></span>
        <input type="checkbox" id="ntg" ${me.notifyTelegram ? 'checked' : ''} ${me.telegram.linked ? '' : 'disabled'}><span class="track" aria-hidden="true"></span></label>
      <div class="row"><div style="flex:1;min-width:220px"><b>Системные уведомления</b><p class="small muted" style="margin:4px 0 0" id="os-state"></p></div><span id="os-act"></span></div>
      <div><b>Уведомления на сайте</b><p class="small muted" style="margin:4px 0 0">Только о ваших заданиях и баллах. Рекламных рассылок нет.</p></div>
      <label class="switch"><span><b>Маскот Аби</b><span class="small muted" style="display:block">Ходит по экрану, подсказывает и отвечает на вопросы.</span></span>
        <input type="checkbox" id="mascot-on" ${store.get('ab_mascot') === 'off' ? '' : 'checked'}><span class="track" aria-hidden="true"></span></label>
      <div class="row"><div style="flex:1;min-width:220px"><b>Обучение</b><p class="small muted" style="margin:4px 0 0">Короткий тур по интерфейсу с подсветкой разделов.</p></div><button class="btn btn-ghost" id="tour-again">Пройти снова</button></div>
      <div class="row"><div style="flex:1;min-width:220px"><b>Мои данные</b><p class="small muted" style="margin:4px 0 0">Профиль, интересы, ответы, транзакции и коды наград — одним JSON-файлом.</p></div>
        <a class="btn btn-ghost" href="/api/me/export" download>${I.download(18)} Скачать</a></div>
      <div><b>Согласие на обработку данных</b><p class="small muted" style="margin:4px 0 0">${me.consentAt ? `Дано ${fmtDate(me.consentAt)}.` : 'Дано при регистрации.'} Компании видят ваше имя и ответы на их задания, но не email и контакты.</p></div>
      <form id="pwf" class="stack pw-change"><b>Сменить пароль</b>
        ${pwField('current', 'Текущий пароль')}
        ${pwField('next', 'Новый пароль', { autocomplete: 'new-password' })}
        <div class="pw-box" id="pw-meter2" aria-live="polite"></div>
        ${pwField('confirm', 'Повторите новый пароль', { autocomplete: 'new-password' })}
        <button class="btn btn-ghost" type="submit" style="justify-self:start">Сменить пароль</button>
        <p class="tiny muted" style="margin:0">После смены пароля другие устройства выйдут из аккаунта.</p></form>
      <div class="row"><div style="flex:1"><b>Выход</b><p class="small muted" style="margin:4px 0 0">Завершить сессию на этом устройстве.</p></div><button class="btn btn-danger" id="logout">Выйти</button></div>
      ${
        me.role === 'user'
          ? `<details class="danger-zone"><summary><b>Удалить аккаунт</b></summary>
        <p class="small muted">Имя, email, аватар и привязка Telegram будут стёрты, войти снова не получится. Ответы останутся у компаний без вашего имени, а записи о баллах — для сверки бухгалтерии. Неиспользованные AB Points (${fmt(me.balance)}) сгорят. <a href="#/privacy">Подробнее</a></p>
        <form id="delf" class="row" style="align-items:flex-end">${pwField('password', 'Пароль для подтверждения')}<button class="btn btn-danger" type="submit">Удалить навсегда</button></form>
      </details>`
          : ''
      }
    </div>
  </div>`;
  const drawOs = () => {
    const p = osNote.permission;
    $('#os-state').textContent =
      p === 'unsupported'
        ? 'Этот браузер не поддерживает системные уведомления.'
        : p === 'denied'
          ? 'Запрещены в настройках браузера. Разрешите их для этого сайта в настройках браузера.'
          : p === 'granted'
            ? 'Уведомления ОС о проверках и начислениях, пока сайт или приложение открыты (в том числе в фоне).'
            : 'Сообщения операционной системы о проверке ответов и начислениях.';
    $('#os-act').innerHTML =
      p === 'granted'
        ? `<label class="switch"><span class="sr-only">Системные уведомления</span><input type="checkbox" id="os-on" ${osNote.enabled ? 'checked' : ''}><span class="track" aria-hidden="true"></span></label>`
        : p === 'default'
          ? '<button class="btn btn-ghost" id="os-req">Включить</button>'
          : '';
    $('#os-req')?.addEventListener('click', async () => {
      const r = await osNote.request();
      if (r === 'granted') osNote.show('Уведомления включены', 'Сообщим о проверке ответов и начислениях AB Points.', '/#/settings');
      drawOs();
    });
    $('#os-on')?.addEventListener('change', (e) => {
      store.set('ab_os_notify', e.target.checked ? 'on' : 'off');
      toast(e.target.checked ? 'Системные уведомления включены' : 'Системные уведомления выключены');
    });
  };
  drawOs();
  const pwf = $('#pwf');
  bindPassword(pwf, { input: 'next', confirm: 'confirm', meterEl: $('#pw-meter2'), who: () => ({ email: state.me.email, name: state.me.name }) });
  bindForm(pwf, async (d) => {
    if (d.next !== d.confirm) throw new Error('Пароли не совпадают');
    await api('/api/me/password', { method: 'POST', body: d });
    pwf.reset();
    pwf.next.dispatchEvent(new Event('input'));
    toast('Пароль изменён');
  });
  const delf = $('#delf');
  if (delf)
    bindForm(delf, async (d) => {
      if (!(await confirmDialog({ title: 'Удалить аккаунт?', body: 'Восстановить его будет нельзя.', confirm: 'Удалить навсегда', tone: 'danger' }))) return;
      await api('/api/me/delete', { method: 'POST', body: d });
      state.me = null;
      clearInterval(state.poll);
      toast('Аккаунт удалён');
      location.hash = '#/';
    });
  $('#mascot-on').addEventListener('change', (e) => {
    store.set('ab_mascot', e.target.checked ? 'on' : 'off');
    if (e.target.checked) X.mountMascot();
    else X.unmountMascot();
  });
  $('#tour-again').addEventListener('click', () => {
    location.hash = home();
    setTimeout(() => X.startTour(true), 700);
  });
  $('#ntg').addEventListener('change', async (e) => {
    try {
      const { user } = await api('/api/me', { method: 'PUT', body: { notifyTelegram: e.target.checked } });
      state.me = user;
      toast(user.notifyTelegram ? 'Уведомления в Telegram включены' : 'Уведомления в Telegram выключены');
    } catch (err) {
      e.target.checked = !e.target.checked;
      toast(err.message, { kind: 'err' });
    }
  });
  $('#logout').addEventListener('click', async () => {
    await api('/api/auth/logout', { method: 'POST', body: {} });
    state.me = null;
    clearInterval(state.poll);
    location.hash = '#/';
  });
}

async function viewNotifications() {
  const { notifications } = await api('/api/notifications');
  await api('/api/notifications/read', { method: 'POST', body: {} });
  state.unread = 0;
  state.lastSeenNotif = Math.max(state.lastSeenNotif, ...notifications.map((n) => n.id), 0);
  renderChrome();
  app.innerHTML = `
  <div class="page-head"><div><h1>Уведомления</h1><p>Только о ваших заданиях, проверках и баллах.</p></div></div>
  ${
    notifications.length
      ? `<div class="panel panel-tight" style="max-width:820px"><ul class="notes">${notifications
          .map((n) => `<li class="${n.read_at ? '' : 'unread'}"><span class="mark"></span><div><b>${esc(n.title)}</b><div class="small">${esc(n.body)}</div>${n.link ? `<a class="small" href="${esc(n.link.replace(/^\//, ''))}">Открыть</a>` : ''}</div><span class="tiny muted">${fmtDate(n.created_at)}</span></li>`)
          .join('')}</ul></div>`
      : empty('Уведомлений нет', 'Здесь появятся решения по вашим ответам и начисления.')
  }`;
}

// ===================================================================
//                          КАБИНЕТ КОМПАНИИ
// ===================================================================
const campStatus = (s) => ({ active: '<span class="badge ok">Активна</span>', paused: '<span class="badge wait">Пауза</span>', closed: '<span class="badge">Закрыта</span>' })[s];
const pct = (v) => (v === null || v === undefined ? '—' : `${v}%`);

async function viewCompany() {
  setTimeout(() => X.startTour(), 900);
  const o = await api('/api/company/overview');
  state.me.balance = o.balance;
  renderChrome();
  const t = o.totals;
  app.innerHTML = `
  <div class="page-head">
    <div><h1>${esc(state.me.companyName)} ${demoBadge(state.me.isDemo)}</h1><p>Вы платите только за подтверждённые результаты.</p></div>
    <a class="btn btn-primary" href="#/company/new">${I.plus(18)} Создать кампанию</a>
  </div>
  <div class="kpis">
    <div><b>${fmt(o.balance)}</b><span>AB свободно</span></div>
    <div><b>${fmt(t.reserved)}</b><span>AB в резерве кампаний</span></div>
    <div><b>${fmt(t.results)}</b><span>подтверждено</span></div>
    <div><b>${fmt(t.pending)}</b><span>ждут проверки</span></div>
    <div><b>${pct(t.approvalRate)}</b><span>доля одобренных</span></div>
    <div><b>${t.avgCostPerResult ? fmt(t.avgCostPerResult) : '—'}</b><span>AB за результат</span></div>
  </div>

  ${
    o.pendingQueue.length
      ? `<section class="section"><div class="section-head"><h2>Ждут вашей проверки</h2></div>
    <div class="panel panel-tight table-wrap"><table class="table"><tbody>${o.pendingQueue
      .map((p) => `<tr><td><b>${esc(p.participant)}</b><div class="tiny muted">${esc(p.title)}</div></td><td class="hide-sm">${fmtDate(p.submittedAt)}</td><td>качество <span class="score ${p.score >= 70 ? 'hi' : p.score >= 30 ? 'mid' : 'lo'}">${p.score}</span></td><td class="r"><a class="btn btn-ghost btn-sm" href="#/company/campaigns/${p.campaignId}?tab=review">Проверить</a></td></tr>`)
      .join('')}</tbody></table></div></section>`
      : ''
  }

  <section class="section">
    <div class="section-head"><h2>Кампании</h2><span class="small muted">${t.active} ${plural(t.active, 'активная', 'активные', 'активных')}</span></div>
    ${
      o.campaigns.length
        ? `<div class="panel panel-tight table-wrap"><table class="table">
      <thead><tr><th>Кампания</th><th class="hide-sm">Статус</th><th>Результаты</th><th class="hide-sm r">Потрачено</th><th class="r"></th></tr></thead><tbody>
      ${o.campaigns
        .map((c) => {
          const s = c.stats;
          const w = (n) => (c.maxParticipants ? (n / c.maxParticipants) * 100 : 0);
          return `<tr>
          <td><a class="title" href="#/company/campaigns/${c.id}">${esc(c.title)}</a><div class="tiny muted">${esc(c.categoryLabel)} · +${c.reward} AB за результат</div></td>
          <td class="hide-sm">${campStatus(c.status)}</td>
          <td class="num"><span>${s.approved} из ${c.maxParticipants}</span>${s.pending ? ` <span class="badge wait">${s.pending} на проверке</span>` : ''}
            <div class="funnel-mini" aria-hidden="true"><i class="ok" style="width:${w(s.approved)}%"></i><i class="wait" style="width:${w(s.pending)}%"></i><i class="bad" style="width:${w(s.rejected)}%"></i></div></td>
          <td class="hide-sm r num">${fmt(s.spent)} AB</td>
          <td class="r">${c.status !== 'closed' ? `<a class="btn btn-quiet btn-sm" href="#/company/campaigns/${c.id}/edit">Изменить</a>` : ''}</td></tr>`;
        })
        .join('')}</tbody></table></div>`
        : empty('Кампаний пока нет', 'Создайте первую: плейтест, отзыв об игре или UX-исследование.', '<a class="btn btn-primary" href="#/company/new">Создать кампанию</a>')
    }
  </section>`;
}

async function viewCampaignForm({ params }) {
  const editing = !!params.id;
  const { meta } = state;
  const fee = meta.economy.platformFeePercent;
  let c = null;
  if (editing) c = (await api(`/api/company/campaigns/${params.id}`)).campaign;
  await refreshMe();
  if (c?.status === 'closed') {
    app.innerHTML = empty('Кампания закрыта', 'Закрытую кампанию нельзя изменить.', `<a class="btn btn-ghost" href="#/company/campaigns/${c.id}">К кампании</a>`);
    return;
  }
  const lockQ = editing && c.hasAnswers;
  const v = (k, d = '') => esc(c?.[k] ?? d);

  app.innerHTML = `
  <a class="crumb" href="${editing ? `#/company/campaigns/${c.id}` : '#/company'}">${I.back(16)} ${editing ? 'К кампании' : 'Обзор'}</a>
  <h1>${editing ? 'Изменить кампанию' : 'Новая кампания'}</h1>
  <div class="task-layout">
    <form class="stack" id="f" novalidate>
      <div class="panel stack">
        <h2 style="margin:0">Задание</h2>
        <label class="field"><span class="label">Название</span><input class="input" name="title" value="${v('title')}" placeholder="Плейтест: первые 15 минут игры" required></label>
        <label class="field"><span class="label">Описание</span><textarea class="input" name="description" placeholder="О продукте и о том, что вы хотите узнать" required>${v('description')}</textarea></label>
        <label class="field"><span class="label">Что нужно сделать</span><textarea class="input" name="instructions" placeholder="Каждый шаг с новой строки">${v('instructions')}</textarea><span class="hint">Участник увидит шаги списком до начала задания</span></label>
        <div class="grid-2">
          <label class="field"><span class="label">Категория</span><select class="input" name="category" ${editing ? 'disabled' : ''}>${meta.categories.map((x) => `<option value="${x.id}" ${c?.category === x.id ? 'selected' : ''}>${esc(x.label)}</option>`).join('')}</select></label>
          <label class="field"><span class="label">Ссылка на продукт</span><input class="input" name="productUrl" type="url" value="${v('productUrl')}" placeholder="https://"></label>
        </div>
        <div class="field"><span class="label">Кому показывать</span>${interestChips(c?.audience || [], 'audience')}<span class="hint">Ничего не выбрано — задание видят все участники</span></div>
      </div>
      <div class="panel stack">
        <h2 style="margin:0">Награда и проверка</h2>
        <div class="grid-3">
          <label class="field"><span class="label">Награда, AB</span><input class="input" name="reward" type="number" min="5" value="${v('reward', 50)}" ${editing ? 'disabled' : ''}>${editing ? '<span class="hint">После публикации не меняется</span>' : ''}</label>
          <label class="field"><span class="label">Участников</span><input class="input" name="maxParticipants" type="number" min="1" value="${v('maxParticipants', 20)}"></label>
          <label class="field"><span class="label">Время, мин</span><input class="input" name="estMinutes" type="number" min="1" max="240" value="${v('estMinutes', 10)}"><span class="hint">Ваша оценка для участника</span></label>
        </div>
        <label class="field"><span class="label">Детали продукта для проверки (необязательно)</span><input class="input" name="keywords" value="${esc((c?.keywords || []).join(', '))}" placeholder="например: овраг, монеты, всадник"><span class="hint">Слова, которые упомянет тот, кто действительно прошёл продукт. Участник их не видит. Если в ответе нет ни одного — оценка качества снижается.</span></label>
        <label class="field" style="max-width:260px"><span class="label">Минимальное время, сек</span><input class="input" name="minSeconds" type="number" min="0" value="${v('minSeconds', 120)}"><span class="hint">Быстрее — ниже оценка качества</span></label>
        <label class="check"><input type="checkbox" name="autoApprove" ${c?.autoApprove ? 'checked' : ''}> Подтверждать автоматически, если оценка качества от ${meta.verification.autoApproveScore}/100</label>
        <label class="check"><input type="checkbox" name="requireTelegram" ${c?.requireTelegram ? 'checked' : ''}> Только участники, подтверждённые через Telegram</label>
      </div>
      <div class="panel">
        <div class="row" style="margin-bottom:12px"><h2 style="margin:0">Вопросы</h2><span class="spacer"></span>
          ${lockQ ? '<span class="badge wait">Участники уже ответили — вопросы не меняются</span>' : Object.entries(meta.questionTypes).map(([k, l]) => `<button type="button" class="btn btn-ghost btn-sm" data-add="${k}">${I.plus(15)} ${esc(l)}</button>`).join('')}
        </div>
        <div id="qs"></div>
      </div>
    </form>
    <aside class="budget" aria-live="polite">
      <h3>Бюджет</h3>
      <dl id="budget"></dl>
      <p>Бюджет резервируется при публикации. Награда и комиссия платформы (${fee}% от награды) списываются только за подтверждённые результаты. При закрытии кампании остаток возвращается. Проценты — иллюстративная модель MVP.</p>
      <button class="btn btn-gold btn-block btn-lg" style="margin-top:16px" type="submit" form="f">${editing ? 'Сохранить изменения' : 'Опубликовать'}</button>
    </aside>
  </div>`;

  const qs = $('#qs');
  const addQ = (type, q = {}) => {
    const el = document.createElement('div');
    el.className = 'qbuilder';
    el.dataset.type = type;
    el.innerHTML = `<div class="qrow"><span class="badge sky" style="justify-self:start;margin-top:11px">${esc(meta.questionTypes[type])}</span>
      <input class="input" data-k="label" aria-label="Текст вопроса" placeholder="Текст вопроса" value="${esc(q.label || '')}" ${lockQ ? 'disabled' : ''}>
      ${lockQ ? '<span></span>' : '<button type="button" class="btn btn-quiet btn-sm" data-del style="margin-top:4px">Удалить</button>'}</div>
      ${type === 'choice' ? `<label class="field" style="margin-top:10px"><span class="label">Варианты, по одному в строке</span><textarea class="input" data-k="options" style="min-height:84px" ${lockQ ? 'disabled' : ''}>${esc((q.options || []).join('\n'))}</textarea></label>
        <label class="field" style="margin-top:10px;max-width:360px"><span class="label">Правильный ответ (для контрольного вопроса)</span><input class="input" data-k="correct" placeholder="Оставьте пустым, если вопрос обычный" value="${esc(q.correct || '')}" ${lockQ ? 'disabled' : ''}><span class="hint">Участник его не видит. Неверный ответ снижает оценку автопроверки.</span></label>` : ''}
      ${type === 'text' ? `<label class="field" style="margin-top:10px;max-width:220px"><span class="label">Мин. длина ответа</span><input class="input" type="number" data-k="minLength" value="${q.minLength ?? 30}" ${lockQ ? 'disabled' : ''}></label>` : ''}
      ${!lockQ ? `<label class="check" style="margin-top:10px"><input type="checkbox" data-k="required" ${q.required === false ? '' : 'checked'}> Обязательный вопрос</label>` : ''}`;
    $('[data-del]', el)?.addEventListener('click', () => el.remove());
    qs.append(el);
  };
  if (c) c.questions.forEach((q) => addQ(q.type, q));
  else {
    addQ('rating', { label: 'Насколько интересно было?' });
    addQ('text', { label: 'Где вы запутались или захотели выйти? Опишите подробно.', minLength: 40 });
    addQ('choice', { label: 'Продолжите пользоваться после теста?', options: ['Да', 'Возможно', 'Нет'] });
  }
  $$('[data-add]').forEach((b) => b.addEventListener('click', () => addQ(b.dataset.add)));

  const form = $('#f');
  const calc = () => {
    const reward = editing ? c.reward : Math.max(0, Number(form.reward.value) || 0);
    const n = Math.max(0, Number(form.maxParticipants.value) || 0);
    const f = editing ? c.feePerResult : Math.ceil((reward * fee) / 100);
    const per = reward + f;
    let html = `<dt>Награда участнику</dt><dd>${fmt(reward)} AB</dd><dt>Комиссия платформы</dt><dd>${fmt(f)} AB</dd><dt>Цена одного результата</dt><dd>${fmt(per)} AB</dd><dt>Участников</dt><dd>${fmt(n)}</dd>`;
    if (editing) {
      const delta = (n - c.maxParticipants) * per;
      html += `<dt class="total">${delta > 0 ? 'Доп. резерв' : delta < 0 ? 'Вернётся' : 'Изменение'}</dt><dd class="total">${delta ? fmt(Math.abs(delta)) + ' AB' : '0'}</dd>`;
    } else {
      html += `<dt class="total">Резерв</dt><dd class="total">${fmt(per * n)} AB</dd><dt>Ориентировочно</dt><dd>${fmt(per * n * meta.economy.abToKzt)} ₸</dd>`;
    }
    const enough = editing ? (n - c.maxParticipants) * per <= state.me.balance : per * n <= state.me.balance;
    html += `<dt>Свободно</dt><dd style="color:${enough ? '#9ff0c3' : '#ffb4a8'}">${fmt(state.me.balance)} AB</dd>`;
    $('#budget').innerHTML = html;
  };
  form.addEventListener('input', calc);
  calc();

  bindForm(form, async (d) => {
    const body = {
      title: d.title,
      description: d.description,
      instructions: d.instructions,
      productUrl: d.productUrl,
      audience: d.audience || [],
      maxParticipants: Number(d.maxParticipants),
      minSeconds: Number(d.minSeconds),
      estMinutes: d.estMinutes === '' ? null : Number(d.estMinutes),
      autoApprove: d.autoApprove,
      requireTelegram: d.requireTelegram,
      keywords: d.keywords || '',
    };
    if (!lockQ)
      body.questions = $$('.qbuilder', qs).map((el) => {
        const q = { type: el.dataset.type, label: $('[data-k=label]', el).value, required: $('[data-k=required]', el)?.checked !== false };
        if (q.type === 'choice') {
          q.options = $('[data-k=options]', el).value.split('\n');
          q.correct = $('[data-k=correct]', el).value.trim() || null;
        }
        if (q.type === 'text') q.minLength = Number($('[data-k=minLength]', el).value);
        return q;
      });
    if (!editing) Object.assign(body, { category: d.category, reward: Number(d.reward) });
    const { campaign } = editing
      ? await api(`/api/company/campaigns/${c.id}`, { method: 'PUT', body, idem: true })
      : await api('/api/company/campaigns', { method: 'POST', body, idem: true });
    await refreshMe();
    toast(editing ? 'Изменения сохранены' : 'Кампания опубликована. Участники уже видят задание.');
    location.hash = `#/company/campaigns/${campaign.id}`;
  });
}

const scoreClass = (s) => (s >= 70 ? 'hi' : s >= 30 ? 'mid' : 'lo');
const trustTag = { new: ['новый', ''], regular: ['обычная', 'sky'], trusted: ['надёжный', 'ok'], risky: ['под вопросом', 'bad'] };

function answerList(questions, answers) {
  return `<dl class="answers">${questions
    .map((q) => {
      const a = answers?.[q.id];
      const val = a === undefined ? '<span class="muted">—</span>' : q.type === 'rating' ? `<b>${a}</b> из 5` : q.type === 'url' ? `<a href="${esc(a)}" target="_blank" rel="noopener noreferrer nofollow">${esc(a)}</a>` : esc(a);
      return `<div><dt>${esc(q.label)}</dt><dd>${val}</dd></div>`;
    })
    .join('')}</dl>`;
}

async function viewCampaign({ params, query }) {
  const data = await api(`/api/company/campaigns/${params.id}`);
  const c = data.campaign;
  // Кампании, созданные до появления приглашений, получают код при первом открытии
  if (c.status === 'active' && !c.inviteCode) c.inviteCode = (await api(`/api/company/campaigns/${c.id}/invite`).catch(() => ({}))).code || null;
  const s = c.stats;
  const pending = data.submissions.filter((x) => x.status === 'submitted');
  const tab = query.tab || (pending.length ? 'review' : 'report');
  const base = Math.max(1, s.opened);

  const sub = (x, actions) => `
    <article class="review">
      <div class="review-head">
        <b>${esc(x.participant.name)}</b>
        ${x.participant.verified ? '<span class="badge ok">Telegram</span>' : '<span class="badge">без Telegram</span>'}
        <span class="badge ${trustTag[x.participant.trust.level][1]}" title="Подтверждено ${x.participant.trust.approved}, отклонено ${x.participant.trust.rejected}">репутация: ${trustTag[x.participant.trust.level][0]}</span>
        <span class="spacer"></span>
        <span class="small muted">качество</span><span class="score ${scoreClass(x.autoScore)}">${x.autoScore}/100</span>
        ${actions ? '' : statusBadge(x.status)}
      </div>
      <div class="review-body">
        ${x.flags.length ? `<div class="chips">${x.flags.map((f) => `<span class="badge wait">${esc(f.label)}</span>`).join('')}</div>` : ''}
        ${answerList(c.questions, x.answers)}
        <div class="tiny muted">Отправлено ${fmtDate(x.submittedAt)}${x.reviewNote ? ` · ${esc(x.reviewNote)}` : ''}${x.reviewedBy === 'auto' ? ' · решение автопроверки' : ''}</div>
      </div>
      ${
        actions
          ? `<form class="review-actions" data-review="${x.id}">
        <label class="field"><span class="label small">Оценка</span><select class="input" name="rating"><option value="">—</option>${[5, 4, 3, 2, 1].map((n) => `<option>${n}</option>`).join('')}</select></label>
        <label class="field"><span class="label small">Комментарий участнику</span><input class="input" name="note" placeholder="Обязателен при отклонении"></label>
        <button class="btn btn-ok" type="submit" name="decision" value="approve">Одобрить, +${c.reward} AB</button>
        <button class="btn btn-danger" type="submit" name="decision" value="reject">Отклонить</button>
      </form>`
          : ''
      }
    </article>`;

  const report = data.results
    .map((q) => {
      if (q.type === 'rating') {
        const max = Math.max(1, ...q.dist);
        return `<div class="panel"><h3>${esc(q.label)}</h3><p class="small muted">Средняя: <b class="cost" style="font-size:1.3rem;color:var(--ink)">${q.avg ?? '—'}</b> из 5 · ответов ${q.count}</p>
        <div class="bars">${q.dist.map((n, i) => `<div class="bar-row"><span>${i + 1}</span><div class="track"><div class="fill" style="width:${(n / max) * 100}%"></div></div><span class="n">${n}</span></div>`).join('')}</div></div>`;
      }
      if (q.type === 'choice') {
        const max = Math.max(1, ...q.dist.map((d) => d.n));
        return `<div class="panel"><h3>${esc(q.label)}</h3><div class="bars">${q.dist.map((d) => `<div class="bar-row"><span>${esc(d.option)}</span><div class="track"><div class="fill" style="width:${(d.n / max) * 100}%"></div></div><span class="n">${d.n}</span></div>`).join('')}</div></div>`;
      }
      return `<div class="panel"><h3>${esc(q.label)}</h3>${q.samples.length ? q.samples.map((x) => `<blockquote class="quote">${q.type === 'url' ? `<a href="${esc(x)}" target="_blank" rel="noopener noreferrer nofollow">${esc(x)}</a>` : esc(x)}</blockquote>`).join('') : '<p class="small muted" style="margin:0">Пока нет подтверждённых ответов.</p>'}</div>`;
    })
    .join('');

  app.innerHTML = `
  <a class="crumb" href="#/company">${I.back(16)} Обзор</a>
  <div class="page-head">
    <div><div class="meta">${campStatus(c.status)}<span class="badge">${esc(c.categoryLabel)}</span><span>+${c.reward} AB за результат · комиссия ${c.feePerResult} AB</span></div>
      <h1 style="margin-top:10px">${esc(c.title)}</h1></div>
    <div class="row">
      ${c.status !== 'closed' ? `<a class="btn btn-ghost" href="#/company/campaigns/${c.id}/edit">Изменить</a>` : ''}
      ${c.status === 'active' ? '<button class="btn btn-ghost" data-status="paused">Пауза</button>' : ''}
      ${c.status === 'paused' ? '<button class="btn btn-ghost" data-status="active">Возобновить</button>' : ''}
      ${c.status !== 'closed' ? '<button class="btn btn-danger" data-status="closed">Закрыть</button>' : ''}
      <a class="btn btn-ghost" href="/api/company/campaigns/${c.id}/export.csv" download>${I.download(17)} CSV</a>
      <a class="btn btn-primary" href="#/company/campaigns/${c.id}/report">Отчёт для студии</a>
    </div>
  </div>
  ${
    c.status === 'active' && c.inviteCode
      ? (() => {
          const link = `${location.origin}/#/join/${c.inviteCode}`;
          return `<div class="invite panel">
        <div><b>Пригласить тестировщиков</b><p class="small muted" style="margin:4px 0 0">Отправьте ссылку в чат курса, клуба или своего сообщества — человек зарегистрируется и сразу попадёт в это задание.</p></div>
        <div class="invite-row"><input class="input" readonly value="${esc(link)}" id="inv-link" aria-label="Ссылка-приглашение"><button class="btn btn-ghost" type="button" id="inv-copy">Скопировать</button>
        <a class="btn btn-ghost" target="_blank" rel="noopener" href="https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(`Помогите протестировать «${c.title}» — +${c.reward} AB Points`)}">Поделиться в Telegram</a></div>
        ${state.meta?.telegram?.botUsername ? `<p class="tiny muted" style="grid-column:1/-1;margin:0">Ссылка через бота: <code>https://t.me/${esc(state.meta.telegram.botUsername)}?start=join_${esc(c.inviteCode)}</code></p>` : ''}
      </div>`;
        })()
      : ''
  }

  <div class="funnel" aria-label="Воронка">
    <div><b>${s.opened}</b><span>начали задание</span><div class="bar"><i style="width:100%"></i></div></div>
    <div><b>${s.submitted}</b><span>отправили результат</span><div class="bar"><i style="width:${(s.submitted / base) * 100}%"></i></div></div>
    <div class="ok"><b>${s.approved}</b><span>подтверждено · из ${c.maxParticipants} мест</span><div class="bar"><i style="width:${(s.approved / base) * 100}%"></i></div></div>
    <div class="bad"><b>${s.rejected}</b><span>отклонено</span><div class="bar"><i style="width:${(s.rejected / base) * 100}%"></i></div></div>
  </div>
  <div class="kpis" style="margin-top:14px">
    <div><b>${pct(s.approvalRate)}</b><span>доля одобренных</span></div>
    <div><b>${s.avgScore ?? '—'}</b><span>среднее качество</span></div>
    <div><b>${s.avgRating ?? '—'}</b><span>ваша средняя оценка</span></div>
    <div><b>${s.avgMinutes ?? '—'}</b><span>мин в среднем</span></div>
    <div><b>${fmt(s.costPerResult)}</b><span>AB за результат</span></div>
    <div><b>${fmt(s.spent)}</b><span>AB потрачено · ${fmt(s.reserved)} в резерве</span></div>
  </div>

  <div class="tabs" role="tablist" style="margin-top:32px">
    <button role="tab" data-tab="review" aria-selected="${tab === 'review'}">На проверке (${pending.length})</button>
    <button role="tab" data-tab="report" aria-selected="${tab === 'report'}">Отчёт</button>
    <button role="tab" data-tab="all" aria-selected="${tab === 'all'}">Все ответы (${data.submissions.length})</button>
  </div>
  <div>${
    tab === 'review'
      ? pending.length
        ? pending.map((x) => sub(x, true)).join('')
        : empty('Очередь пуста', 'Новые результаты появятся здесь, а уведомление придёт в Telegram.')
      : tab === 'report'
        ? `<p class="small muted">Отчёт строится по подтверждённым ответам (${s.approved}).</p><div class="grid-2" style="align-items:start">${report}</div>`
        : data.submissions.length
          ? data.submissions.map((x) => sub(x, false)).join('')
          : empty('Ответов пока нет', 'Участники видят задание в каталоге.')
  }</div>`;

  $('#inv-copy')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText($('#inv-link').value);
      toast('Ссылка скопирована');
    } catch {
      $('#inv-link').select();
    }
  });
  $$('[data-tab]').forEach((b) => b.addEventListener('click', () => (location.hash = `#/company/campaigns/${c.id}?tab=${b.dataset.tab}`)));
  $$('[data-status]').forEach((b) =>
    b.addEventListener('click', async () => {
      const st = b.dataset.status;
      if (st === 'closed') {
        const ok = await confirmDialog({
          title: 'Закрыть кампанию?',
          body: `<p class="small muted" style="margin:0">Задание исчезнет из каталога. Неиспользованный резерв (<b>${fmt(s.reserved)} AB</b>) вернётся на баланс. Закрытую кампанию нельзя открыть снова.</p>`,
          confirm: 'Закрыть и вернуть остаток',
          tone: 'danger',
        });
        if (!ok) return;
      }
      await busy(b, async () => {
        try {
          await api(`/api/company/campaigns/${c.id}/status`, { method: 'POST', body: { status: st }, idem: true });
          await refreshMe();
          toast(st === 'closed' ? 'Кампания закрыта, остаток возвращён' : st === 'paused' ? 'Кампания на паузе' : 'Кампания снова активна');
          viewCampaign({ params, query });
        } catch (e) {
          toast(e.message, { kind: 'err' });
        }
      });
    })
  );
  $$('[data-review]').forEach((form) =>
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const decision = e.submitter?.value;
      const d = formData(form);
      await busy(e.submitter, async () => {
        try {
          await api(`/api/company/submissions/${form.dataset.review}/review`, { method: 'POST', body: { decision, rating: d.rating || null, note: d.note }, idem: true });
          toast(decision === 'approve' ? `Одобрено. Участнику начислено +${c.reward} AB` : 'Ответ отклонён, место освобождено', decision === 'approve' ? { stamp: 'Одобрено' } : {});
          await refreshMe();
          renderChrome();
          viewCampaign({ params, query: { tab: 'review' } });
        } catch (err) {
          showFormError(form, err);
        }
      });
    })
  );
}

async function viewCompanyRewards() {
  const { rewards } = await api('/api/company/rewards');
  const { meta } = state;
  app.innerHTML = `
  <div class="page-head"><div><h1>Награды для участников</h1><p>Ключи раннего доступа, внутриигровые предметы, подписки, признание. Так AB Points получают реальную ценность.</p></div></div>
  <div class="task-layout">
    <div>${
      rewards.length
        ? `<div class="reward-grid">${rewards
            .map(
              (r) => `<article class="reward-card" style="grid-column:span 6">
          <div class="img"><img src="${esc(r.imageUrl)}" alt="" loading="lazy">${r.active ? '' : '<span class="badge">скрыта</span>'}</div>
          <div class="body">
            <div class="meta"><span>${esc(r.categoryLabel)}</span>${demoBadge(r.demo)}</div>
            <h3>${esc(r.title)}</h3>
            <div class="price"><span class="cost">${fmt(r.cost)}<small>AB</small></span><span class="small muted">выдано ${r.redeemed} · в наличии ${r.stock}</span></div>
            <div class="row"><button class="btn btn-ghost btn-sm" data-toggle="${r.id}" data-active="${r.active}">${r.active ? 'Скрыть из каталога' : 'Показать в каталоге'}</button>
              <button class="btn btn-quiet btn-sm" data-stock="${r.id}">Пополнить запас</button></div>
          </div></article>`
            )
            .join('')}</div>`
        : empty('Наград пока нет', 'Добавьте первую награду, на которую участники смогут обменять AB Points.')
    }</div>
    <form class="panel stack" id="f" style="position:sticky;top:88px">
      <h2 style="margin:0">Новая награда</h2>
      <label class="field"><span class="label">Название</span><input class="input" name="title" placeholder="Ключ раннего доступа"></label>
      <label class="field"><span class="label">Описание</span><textarea class="input" name="description" style="min-height:84px"></textarea></label>
      <label class="field"><span class="label">Как воспользоваться</span><input class="input" name="howToUse" placeholder="Где и как активировать код"></label>
      <label class="field"><span class="label">Категория</span><select class="input" name="category">${meta.rewardCategories.map((x) => `<option value="${x.id}">${esc(x.label)}</option>`).join('')}</select></label>
      <div class="grid-2">
        <label class="field"><span class="label">Цена, AB</span><input class="input" type="number" name="cost" value="100" min="1"></label>
        <label class="field"><span class="label">Количество</span><input class="input" type="number" name="stock" value="50" min="1"></label>
      </div>
      <div class="field"><span class="label">Изображение</span>
        <div class="upload"><div class="preview" id="preview" role="img" aria-label="Предпросмотр"></div>
          <div><input type="file" id="img" accept="image/png,image/jpeg,image/webp" class="small"><span class="hint">PNG, JPEG или WebP до 1,5 МБ. Без картинки будет обложка категории.</span></div></div></div>
      <button class="btn btn-primary" type="submit">Добавить награду</button>
    </form>
  </div>`;

  let imageId = null;
  $('#img').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    imageId = null;
    if (!file) return;
    if (file.size > 1_500_000) {
      toast('Картинка больше 1,5 МБ — уменьшите её', { kind: 'err' });
      e.target.value = '';
      return;
    }
    $('#preview').style.backgroundImage = `url(${URL.createObjectURL(file)})`;
    const data = await new Promise((res) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result).split(',')[1]);
      r.readAsDataURL(file);
    });
    try {
      const up = await api('/api/images', { method: 'POST', body: { mime: file.type, data } });
      imageId = up.id;
      toast('Картинка загружена');
    } catch (err) {
      toast(err.message, { kind: 'err' });
      $('#preview').style.backgroundImage = '';
      e.target.value = '';
    }
  });
  bindForm($('#f'), async (d) => {
    await api('/api/company/rewards', { method: 'POST', body: { ...d, cost: Number(d.cost), stock: Number(d.stock), imageId }, idem: true });
    toast('Награда добавлена в каталог');
    viewCompanyRewards();
  });
  $$('[data-toggle]').forEach((b) =>
    b.addEventListener('click', () =>
      busy(b, async () => {
        await api(`/api/company/rewards/${b.dataset.toggle}`, { method: 'PUT', body: { active: b.dataset.active !== 'true' } });
        toast(b.dataset.active === 'true' ? 'Награда скрыта из каталога' : 'Награда снова в каталоге');
        viewCompanyRewards();
      })
    )
  );
  $$('[data-stock]').forEach((b) =>
    b.addEventListener('click', async () => {
      const d = $('#modal');
      d.classList.remove('wide');
      d.innerHTML = `<form method="dialog" class="in" id="stockf"><h2 id="modal-title">Пополнить запас</h2>
        <label class="field"><span class="label">Сколько добавить</span><input class="input" name="add" type="number" min="1" value="10" required></label>
        <div class="acts"><button class="btn btn-ghost" value="cancel" formnovalidate>Отмена</button><button class="btn btn-primary" value="ok">Добавить</button></div></form>`;
      d.showModal();
      d.addEventListener(
        'close',
        async () => {
          if (d.returnValue !== 'ok') return;
          try {
            await api(`/api/company/rewards/${b.dataset.stock}`, { method: 'PUT', body: { addStock: Number($('[name=add]', d).value) } });
            toast('Запас пополнен');
            viewCompanyRewards();
          } catch (err) {
            toast(err.message, { kind: 'err' });
          }
        },
        { once: true }
      );
    })
  );
}

// ===================================================================
//                  ЧЕК ОБМЕНА И ПК-ВЕРСИЯ (PWA)
// ===================================================================
function receiptDialog(r, res) {
  const d = $('#modal');
  d.classList.remove('wide');
  d.innerHTML = `<form method="dialog" class="in">
    <h2 id="modal-title">Награда получена</h2>
    <div class="receipt">
      <div class="receipt-head"><img src="/icons/logo.svg" alt=""><b>ATTENTION BANK</b><span>Чек обмена</span></div>
      <dl class="kv">
        <dt>Награда</dt><dd>${esc(r.title)}</dd>
        <dt>Компания</dt><dd>${esc(r.company)}</dd>
        <dt>Списано</dt><dd class="minus">−${fmt(r.cost)} AB</dd>
        <dt>Баланс после</dt><dd>${fmt(res.balance)} AB</dd>
        <dt>Дата</dt><dd>${fmtDate(new Date().toISOString())}</dd>
      </dl>
      <div class="receipt-code"><span class="small muted">Код</span><span class="code" id="rc-code">${esc(res.code)}</span><span class="spacer"></span><button type="button" class="btn btn-ghost btn-sm" id="rc-copy">${I.copy(16)} Копировать</button></div>
      ${res.howToUse ? `<p class="small" style="margin:0"><b>Как активировать:</b> ${esc(res.howToUse)}</p>` : ''}
      <p class="tiny muted" style="margin:0">Код одноразовый и сохранён в разделе «Мои награды». Списание видно в активности.</p>
    </div>
    <div class="acts"><button class="btn btn-primary" value="ok" autofocus>Готово</button></div>
  </form>`;
  d.showModal();
  $('#rc-copy', d).addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(res.code);
      toast('Код скопирован');
    } catch {
      getSelection().selectAllChildren($('#rc-code', d));
      toast('Выделите код и скопируйте вручную', { kind: 'err' });
    }
  });
  return new Promise((resolve) => d.addEventListener('close', resolve, { once: true }));
}

function desktopModal() {
  const d = $('#modal');
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const ua = navigator.userAgent;
  const isFirefox = /firefox|fxios/i.test(ua);
  const isSafari = /^((?!chrome|chromium|crios|edg|android).)*safari/i.test(ua);
  d.classList.add('wide');
  d.innerHTML = `<div class="in">
    <div class="desk">
      <div class="desk-stage"><canvas aria-hidden="true"></canvas><div class="desk-view" tabindex="0" aria-label="3D-знак ATTENTION BANK. Перетащите, чтобы повернуть"></div><span class="stage-hint">Перетащите · колесо — приближение</span></div>
      <div class="stack">
        <h2 id="modal-title">ATTENTION BANK на компьютере</h2>
        <p class="small muted" style="margin:0">Устанавливается прямо из браузера как приложение (PWA): без отдельного установщика и без доступа к вашим файлам. Работает на Windows, macOS и Linux.</p>
        <ul class="checks">
          <li>${I.monitor(17)}<span>Отдельное окно и значок на панели задач или в Dock</span></li>
          <li>${I.bell(17)}<span>Системные уведомления о проверке ответов и начислениях AB Points</span></li>
          <li>${I.shield(17)}<span>Та же защита, что на сайте: баланс меняет только сервер, ответы проходят автопроверку</span></li>
          <li>${I.refresh(17)}<span>Обновляется само при следующем запуске</span></li>
        </ul>
        <div id="desk-actions" class="stack"></div>
        <div class="acts"><button class="btn btn-ghost" type="button" data-close>Закрыть</button></div>
      </div>
    </div>
  </div>`;
  const actions = $('#desk-actions', d);
  const draw = () => {
    let html = '';
    if (standalone) html += '<p class="notice">Приложение уже установлено — вы сейчас в нём.</p>';
    else if (state.installPrompt) html += `<button class="btn btn-gold btn-lg" id="desk-install">${I.download(18)} Установить на этот компьютер</button>`;
    else if (isFirefox) html += '<p class="notice warn">Firefox не устанавливает веб-приложения. Откройте сайт в Chrome или Microsoft Edge.</p>';
    else if (isSafari) html += '<ol class="desk-steps"><li>В Safari на Mac откройте меню «Файл».</li><li>Выберите «Добавить в Dock».</li></ol>';
    else html += '<ol class="desk-steps"><li>В адресной строке Chrome или Edge нажмите значок установки (монитор со стрелкой).</li><li>Или меню ⋮ → «Установить ATTENTION BANK».</li><li>Установка доступна на сайте по https (на Render — да).</li></ol>';
    if (osNote.supported && osNote.permission === 'default') html += `<button class="btn btn-ghost" id="desk-notify">${I.bell(17)} Включить системные уведомления</button>`;
    else if (osNote.permission === 'granted') html += `<p class="small" style="margin:0;color:var(--ok)">${I.check(16)} Системные уведомления разрешены</p>`;
    actions.innerHTML = html;
    $('#desk-install', d)?.addEventListener('click', async () => {
      const ev = state.installPrompt;
      if (!ev) return draw();
      ev.prompt();
      const { outcome } = await ev.userChoice;
      state.installPrompt = null;
      toast(outcome === 'accepted' ? 'Приложение устанавливается — ярлык появится на компьютере' : 'Установка отменена');
      draw();
    });
    $('#desk-notify', d)?.addEventListener('click', async () => {
      const r = await osNote.request();
      if (r === 'granted') osNote.show('Уведомления включены', 'Сообщим о проверке ответов и начислениях AB Points.', '/#/settings');
      else toast('Уведомления не разрешены', { kind: 'err' });
      draw();
    });
  };
  draw();
  let stage = null;
  try {
    stage = new Stage($('.desk-stage canvas', d));
    if (stage.ok) stage.add($('.desk-view', d), { model: 'logo', touch: 'none', wheel: 'always', distance: 3.3 });
    else $('.stage-hint', d).remove();
  } catch {
    stage = null;
  }
  $('[data-close]', d).addEventListener('click', () => d.close());
  d.addEventListener('close', () => stage?.dispose(), { once: true });
  d.showModal();
}

// ---------- Запуск ----------
// ---------- Telegram Mini App ----------
// Telegram передаёт подписанные данные запуска в адресе (#tgWebAppData=...). Скрипт Telegram не нужен.
function tgInitData() {
  try {
    return sessionStorage.getItem('tg_init') || '';
  } catch {
    return '';
  }
}
async function telegramMiniApp() {
  const h = location.hash.slice(1);
  if (h.includes('tgWebAppData=')) {
    const p = new URLSearchParams(h);
    try {
      sessionStorage.setItem('tg_init', p.get('tgWebAppData') || '');
    } catch {}
    history.replaceState(null, '', location.pathname + '#/');
  }
  const init = tgInitData();
  if (!init) return;
  document.body.classList.add('in-telegram');
  // Сообщаем Telegram, что приложение готово, и разворачиваем на весь экран
  const post = (ev) => {
    try {
      if (window.TelegramWebviewProxy) window.TelegramWebviewProxy.postEvent(ev, '');
      else window.parent?.postMessage(JSON.stringify({ eventType: ev, eventData: '' }), '*');
    } catch {}
  };
  post('web_app_ready');
  post('web_app_expand');
  if (state.me) return;
  try {
    const r = await api('/api/telegram/webapp-login', { method: 'POST', body: { initData: init } });
    if (r.linked) {
      state.me = r.user;
      await refreshMe();
      if (!location.hash || location.hash === '#/' || location.hash.startsWith('#/?')) location.hash = home();
    } else state.tgGuest = r.telegramName || true;
  } catch {}
}

async function boot() {
  X.setup({ api, esc, fmt, plural, initials, toast, state, store, fmtTime, renderChrome, enhance: () => enhance(app), get app() { return app; }, I });
  try {
    state.meta = await api('/api/meta');
    await refreshMe();
    await telegramMiniApp();
  } catch {
    app.innerHTML = '<div class="empty"><h3>Сервер недоступен</h3><p>Проверьте подключение и обновите страницу.</p></div>';
    return;
  }
  if (state.me) startPolling();
  // Новые 3D-витрины и карточки подключаются автоматически при любой перерисовке
  let pending = false;
  new MutationObserver(() => {
    if (pending) return;
    pending = true;
    queueMicrotask(() => {
      pending = false;
      enhance(app);
      X.reveal(app);
    });
  }).observe(app, { childList: true, subtree: true });
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    state.installPrompt = e;
  });
  window.addEventListener('appinstalled', () => toast('ATTENTION BANK установлен на компьютер'));
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-desktop]')) desktopModal();
  });
  window.addEventListener('hashchange', router);
  await router();
  X.mountMascot();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
}
boot();
