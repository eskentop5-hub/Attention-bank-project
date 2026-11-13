// ATTENTION BANK v11: настоящее приложение и демо-песочница на отдельной базе, деньги по счёту с подтверждением
// администратора, админ-панель, восстановление пароля, уровни тестировщиков, рефералы и маркетинговые метки.
// Модуль получает общие помощники из app.js через setup(), чтобы не было циклических импортов.
let D = null;
export function setup(deps) {
  D = deps;
  bindGlobal();
  captureAttribution();
  reportErrors();
}
const esc = (s) => D.esc(s);
const fmt = (n) => D.fmt(n);
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const fmtDT = (iso) => (iso ? new Date(iso).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
const fmtDay = (iso) => new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
const kzt = (n) => `${fmt(n)} ₸`;

export const isDemo = () => !!D?.state.meta?.demoMode;
export const sandboxOn = () => !!D?.state.meta?.demo?.enabled;

function relTime(date) {
  const min = Math.round((date.getTime() - Date.now()) / 60e3);
  if (min <= 1) return 'в ближайшие минуты';
  if (min < 60) return `через ${min} мин`;
  const h = Math.floor(min / 60), m = min % 60;
  return `через ${h} ч${m ? ` ${m} мин` : ''}`;
}

// ===================================================================
//                  РЕЖИМ: НАСТОЯЩЕЕ ПРИЛОЖЕНИЕ ИЛИ ДЕМО
// ===================================================================

/** Кнопка в шапке: всегда видна, если на сервере включена песочница */
export function modeButton() {
  if (!sandboxOn()) return '';
  return isDemo()
    ? `<button class="mode-btn on" type="button" data-mode="real" title="Выйти из демо и вернуться в настоящее приложение" aria-label="Выйти из демо"><span class="mode-dot" aria-hidden="true"></span><span class="t">Демо</span><span class="mode-x" aria-hidden="true">✕</span></button>`
    : `<button class="mode-btn" type="button" data-mode="demo" title="Демо-песочница: готовые студии, задания и награды на отдельной базе"><span class="mode-play" aria-hidden="true">▶</span><span class="t">Демо</span></button>`;
}

/** Лента над шапкой в песочнице: быстрый вход, сброс, выход */
export function ribbon() {
  if (!isDemo()) return '';
  const d = D.state.meta.demo || {};
  const next = d.nextResetAt ? new Date(d.nextResetAt) : null;
  const me = D.state.me;
  const switchTo = me ? (me.role === 'company' ? 'user' : 'company') : null;
  return `<div class="demo-ribbon v11" role="region" aria-label="Демо-режим">
    <span class="dr-stamp" aria-hidden="true">ДЕМО</span>
    <span class="dr-text"><b>Песочница.</b> <span class="long">Отдельная база с тестовыми студиями и заданиями: настоящие аккаунты и баллы не затрагиваются. </span>${next && next > Date.now() ? `Сброс ${relTime(next)}.` : `Сброс каждые ${d.resetHours || 6} ч.`}</span>
    <span class="dr-acts">
      ${me ? `<button type="button" data-demo-as="${switchTo}">${switchTo === 'company' ? 'Стать студией' : 'Стать участником'}</button>` : '<button type="button" data-demo-as="user">Войти участником</button><button type="button" data-demo-as="company">Войти студией</button>'}
      <button type="button" data-demo-reset>Сбросить</button>
      <button type="button" data-mode="real" class="dr-exit">Выйти из демо</button>
    </span>
  </div>`;
}

/** Призыв посмотреть демо — в пустых состояниях настоящего приложения */
export function demoCta(text = 'Посмотрите, как всё работает, на готовых данных — в демо-песочнице. Ваш настоящий аккаунт она не затрагивает.', { as = null } = {}) {
  if (isDemo() || !sandboxOn()) return '';
  return `<div class="demo-cta"><span class="dc-star" aria-hidden="true">★</span><div><b>Демо-песочница</b><p>${esc(text)}</p></div>
    <div class="row">${as ? `<button class="btn btn-ghost btn-sm" type="button" data-mode="demo" data-as="${as}">Открыть демо</button>` : '<button class="btn btn-ghost btn-sm" type="button" data-mode="demo" data-as="user">Демо: участник</button><button class="btn btn-ghost btn-sm" type="button" data-mode="demo" data-as="company">Демо: студия</button>'}</div></div>`;
}

// Занавес: плакатные створки закрывают экран, пока подменяется база, и открываются на новой странице
function curtain(label) {
  const el = document.createElement('div');
  el.className = 'curtain';
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = `<i class="c-l"></i><i class="c-r"></i><div class="c-mid"><span class="c-star">★</span><b>${esc(label)}</b></div>`;
  document.body.append(el);
  void el.offsetWidth;
  el.classList.add('shut');
  const closed = new Promise((r) => setTimeout(r, REDUCED ? 30 : 520));
  return {
    closed,
    async open() {
      await closed;
      el.classList.add('open');
      setTimeout(() => el.remove(), REDUCED ? 30 : 900);
    },
  };
}

let switching = false;
async function reloadSession() {
  D.state.meta = await D.api('/api/meta');
  Object.assign(D.state, { me: null, unread: 0, streak: null, lastSeenNotif: 0 });
  await D.refreshMe();
  if (D.state.me) D.startPolling();
  else clearInterval(D.state.poll);
}
async function goTo(hash) {
  history.replaceState(null, '', hash);
  await D.router();
}

/** Переключить режим. as — сразу войти демо-участником или демо-студией. */
export async function switchMode(mode, { as = null, to = null } = {}) {
  if (switching) return;
  switching = true;
  const cover = curtain(mode === 'demo' ? 'Открываем демо' : 'Настоящее приложение');
  try {
    await cover.closed;
    await D.api('/api/mode', { method: 'POST', body: { mode } });
    if (mode === 'demo' && as) await D.api('/api/demo/login', { method: 'POST', body: { as } });
    await reloadSession();
    await goTo(to || (D.state.me ? D.home() : '#/'));
    if (mode === 'demo') D.toast(as ? `Вы в демо как ${as === 'company' ? 'студия' : 'участник'}. Данные тестовые.` : 'Демо-песочница: данные тестовые, настоящий аккаунт не затронут.');
  } catch (e) {
    D.toast(e.message, { kind: 'err' });
  } finally {
    switching = false;
    cover.open();
  }
}

async function demoLogin(as) {
  if (!isDemo()) return switchMode('demo', { as });
  if (switching) return;
  switching = true;
  const cover = curtain(as === 'company' ? 'Кабинет демо-студии' : 'Демо-участник');
  try {
    await cover.closed;
    await D.api('/api/demo/login', { method: 'POST', body: { as } });
    await reloadSession();
    await goTo(D.home());
  } catch (e) {
    D.toast(e.message, { kind: 'err' });
  } finally {
    switching = false;
    cover.open();
  }
}

async function demoReset() {
  const ok = await D.confirmDialog({
    title: 'Сбросить песочницу?',
    body: '<p class="small muted" style="margin:0">Песочница общая для всех гостей: ответы, кампании и обмены в ней удалятся, данные вернутся к исходным. Настоящее приложение не затрагивается.</p>',
    confirm: 'Сбросить',
  });
  if (!ok) return;
  const cover = curtain('Сбрасываем демо');
  try {
    await cover.closed;
    await D.api('/api/demo/reset', { method: 'POST', body: {} });
    await reloadSession();
    await goTo('#/login');
    D.toast('Демо вернулось к исходным данным');
  } catch (e) {
    D.toast(e.message, { kind: 'err' });
  } finally {
    cover.open();
  }
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    D.toast('Скопировано');
  } catch {
    D.toast('Не получилось скопировать — выделите текст вручную', { kind: 'err' });
  }
}

function bindGlobal() {
  document.addEventListener('click', (e) => {
    const m = e.target.closest('[data-mode]');
    if (m) {
      e.preventDefault();
      return void switchMode(m.dataset.mode, { as: m.dataset.as || null });
    }
    const a = e.target.closest('[data-demo-as]');
    if (a) {
      e.preventDefault();
      return void demoLogin(a.dataset.demoAs);
    }
    if (e.target.closest('[data-demo-reset]')) {
      e.preventDefault();
      return void demoReset();
    }
    const c = e.target.closest('[data-copy]');
    if (c) {
      e.preventDefault();
      const src = c.dataset.copy.startsWith('#') ? $(c.dataset.copy) : null;
      copyText(src ? src.value || src.textContent : c.dataset.copy);
    }
  });
}

// ===================================================================
//              МАРКЕТИНГ: реферальный код и метки рекламы
// ===================================================================
// ?ref=CODE — ссылка друга (/r/CODE), ?utm_source=… — метка рекламы. Сохраняем при первом заходе
// и отправляем при регистрации, чтобы администратор видел, какой канал приводит людей.
function captureAttribution() {
  const p = new URLSearchParams(location.search);
  const ref = (p.get('ref') || '').trim().toUpperCase();
  const src = [p.get('utm_source'), p.get('utm_medium'), p.get('utm_campaign')].filter(Boolean).join(':').toLowerCase().replace(/[^a-z0-9_.:-]/g, '').slice(0, 40);
  if (/^[A-Z0-9]{4,16}$/.test(ref)) D.store.set('ab_ref', ref);
  if (src && !D.store.get('ab_src')) D.store.set('ab_src', src); // первый источник, как в обычной аналитике
  const keys = ['ref', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];
  if (keys.some((k) => p.has(k))) {
    keys.forEach((k) => p.delete(k));
    const qs = p.toString();
    history.replaceState(null, '', location.pathname + (qs ? `?${qs}` : '') + location.hash);
  }
}
export function attribution() {
  let invite = null;
  try {
    invite = sessionStorage.getItem('ab_join');
  } catch {}
  return { ref: D.store.get('ab_ref') || undefined, source: D.store.get('ab_src') || undefined, invite: invite ? '1' : undefined };
}
export const hasReferral = () => !!D.store.get('ab_ref');

// ===================================================================
//                ОШИБКИ В БРАУЗЕРЕ → журнал администратора
// ===================================================================
function reportErrors() {
  let sent = 0;
  const send = (message, stack) => {
    if (sent >= 5 || !message) return;
    sent += 1;
    try {
      fetch('/api/client-error', {
        method: 'POST',
        credentials: 'same-origin',
        keepalive: true,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: String(message).slice(0, 500), stack: String(stack || '').slice(0, 3000), page: location.hash.slice(0, 200) }),
      }).catch(() => {});
    } catch {}
  };
  addEventListener('error', (e) => {
    if (!e.message || e.message === 'Script error.' || (e.filename && !e.filename.startsWith(location.origin))) return;
    send(e.message, e.error?.stack || `${e.filename}:${e.lineno}:${e.colno}`);
  });
  addEventListener('unhandledrejection', (e) => {
    const r = e.reason;
    if (r && r.status && r.status < 500) return; // ошибки ввода и прав — не сбои
    if (r?.name === 'AbortError') return;
    send(r?.message || String(r), r?.stack);
  });
}

// ===================================================================
//                 ВОССТАНОВЛЕНИЕ ПАРОЛЯ И ПОДТВЕРЖДЕНИЕ EMAIL
// ===================================================================
const channelsText = (ch) =>
  ch.email && ch.telegram ? 'на email и в Telegram, если он привязан к аккаунту' : ch.telegram ? 'в Telegram, привязанный к аккаунту' : ch.email ? 'на email аккаунта' : '';

export async function viewForgot({ query }) {
  const ch = D.state.meta.recovery || {};
  const none = !ch.email && !ch.telegram;
  const support = D.state.meta.support;
  D.app.innerHTML = `
  <div class="auth auth-narrow">
    <div>
      <a class="crumb" href="#/login">${D.I.back(16)} Вход</a>
      <h1 style="font-size:1.8rem">Забыли пароль?</h1>
      ${
        isDemo()
          ? '<p class="notice">Это демо-песочница: у всех демо-аккаунтов пароль <code>demo1234</code>, а войти можно кнопками в красной ленте сверху.</p>'
          : none
            ? `<p class="notice warn">Автоматическая отправка ссылок на этом сервере пока не настроена. Напишите в поддержку${support ? `: <b>${esc(support)}</b>` : ''} с email аккаунта — администратор убедится, что аккаунт ваш, и выдаст одноразовую ссылку.</p>`
            : `<p class="muted">Пришлём одноразовую ссылку для нового пароля ${channelsText(ch)}. Ссылка действует 1 час.</p>`
      }
      <form class="panel stack" id="f" novalidate>
        <label class="field"><span class="label">Email аккаунта</span><input class="input" name="email" type="email" autocomplete="email" required value="${esc(query.email || '')}"></label>
        <button class="btn btn-primary btn-block btn-lg" type="submit" ${none && !isDemo() ? 'disabled' : ''}>Отправить ссылку</button>
      </form>
      <div id="done" aria-live="polite"></div>
    </div>
  </div>`;
  D.bindForm($('#f'), async (d) => {
    const r = await D.api('/api/auth/forgot', { method: 'POST', body: { email: d.email } });
    $('#done').innerHTML = `<div class="notice ok-n" style="margin-top:16px"><span class="stamp press">Отправлено</span><p style="margin:10px 0 0">${esc(r.message)}</p></div>`;
  });
}

export async function viewReset({ params }) {
  let info;
  try {
    info = await D.api(`/api/auth/reset/${encodeURIComponent(params.token)}`);
  } catch (e) {
    D.app.innerHTML = D.empty('Ссылка не работает', e.message, '<a class="btn btn-primary" href="#/forgot">Запросить новую</a>');
    return;
  }
  D.app.innerHTML = `
  <div class="auth auth-narrow">
    <div>
      <p class="kicker">Восстановление доступа</p>
      <h1 style="font-size:1.8rem">Новый пароль</h1>
      <p class="muted">Аккаунт: <b style="color:var(--ink)">${esc(info.name)}</b> · ${esc(info.email)}</p>
      <form class="panel stack" id="f" novalidate>
        ${D.pwField('password', 'Новый пароль', { autocomplete: 'new-password' })}
        <div class="pw-box" id="pw-meter" aria-live="polite"></div>
        ${D.pwField('confirm', 'Повторите пароль', { autocomplete: 'new-password' })}
        <button class="btn btn-primary btn-block btn-lg" type="submit">Сохранить и войти</button>
        <p class="tiny muted" style="margin:0">Ссылка одноразовая. Остальные устройства выйдут из аккаунта.</p>
      </form>
    </div>
  </div>`;
  const f = $('#f');
  D.bindPassword(f, { input: 'password', confirm: 'confirm', meterEl: $('#pw-meter'), who: () => ({ name: info.name }) });
  D.bindForm(f, async (d) => {
    const weak = D.pwChecks(d.password, { name: info.name }).find((c) => !c[1]);
    if (weak) throw new Error(`Пароль: ${weak[0].toLowerCase()}`);
    if (d.password !== d.confirm) throw new Error('Пароли не совпадают');
    const r = await D.api('/api/auth/reset', { method: 'POST', body: { token: params.token, password: d.password, confirm: d.confirm } });
    D.toast('Пароль изменён, вы вошли в аккаунт', { stamp: 'Готово' });
    await D.afterAuth(r.user);
  });
}

export async function viewVerify({ params }) {
  try {
    await D.api('/api/auth/verify-email', { method: 'POST', body: { token: params.token } });
    if (D.state.me) await D.refreshMe();
    D.app.innerHTML = `<div class="empty"><span class="stamp press">${D.I.check(18)} Подтверждено</span><h3 style="margin-top:16px">Email подтверждён</h3><p>Теперь по нему можно восстановить доступ к аккаунту.</p><a class="btn btn-primary" href="${D.state.me ? '#/settings' : '#/login'}">${D.state.me ? 'К настройкам' : 'Войти'}</a></div>`;
  } catch (e) {
    D.app.innerHTML = D.empty('Не получилось подтвердить email', e.message, `<a class="btn btn-ghost" href="${D.state.me ? '#/settings' : '#/login'}">${D.state.me ? 'Отправить письмо ещё раз' : 'Войти'}</a>`);
  }
}

/** Строка «Email» в настройках: подтверждён ли, отправить письмо */
export function emailRow(me) {
  const ch = D.state.meta.recovery || {};
  const can = ch.email && !isDemo();
  const text = me.emailVerified
    ? 'Подтверждён — по нему можно восстановить доступ, если забудете пароль.'
    : can
      ? 'Не подтверждён. Подтвердите, чтобы восстановить доступ, если забудете пароль.'
      : ch.telegram
        ? 'Восстановить пароль можно через привязанный Telegram.'
        : 'Если забудете пароль, напишите в поддержку — администратор выдаст ссылку.';
  return `<div class="row"><div style="flex:1;min-width:220px"><b>Email · ${esc(me.email)}</b><p class="small muted" style="margin:4px 0 0">${text}</p></div>
    ${me.emailVerified ? '<span class="badge ok">подтверждён</span>' : can ? '<button class="btn btn-ghost" type="button" id="verify-email">Подтвердить</button>' : ''}</div>`;
}
export function bindEmailRow(root) {
  $('#verify-email', root)?.addEventListener('click', (e) =>
    D.busy(e.currentTarget, async () => {
      try {
        const r = await D.api('/api/me/verify-email', { method: 'POST', body: {} });
        D.toast(r.already ? 'Email уже подтверждён' : r.message || 'Письмо отправлено', { kind: r.ok ? 'ok' : 'err' });
      } catch (err) {
        D.toast(err.message, { kind: 'err' });
      }
    })
  );
}

// ===================================================================
//            БЮДЖЕТ СТУДИИ: пополнение по счёту и история счетов
// ===================================================================
const TOPUP_STATUS = {
  requested: ['ждёт оплаты', 'wait'],
  paid: ['зачислено', 'ok'],
  rejected: ['отклонён', 'bad'],
  cancelled: ['отменён', ''],
};
const topupBadge = (s) => `<span class="badge ${TOPUP_STATUS[s]?.[1] || ''}">${TOPUP_STATUS[s]?.[0] || esc(s)}</span>`;

// Пополнение бюджета: ДЕМО-оплата картой. Настоящий платёжный шлюз не подключён.
// Данные карты проверяются только в браузере и никуда не отправляются: на сервер уходит лишь сумма,
// и только в песочнице (там баллы тестовые). В настоящем приложении баллы не начисляются.
export async function mountTopups(slot, rerender) {
  const { billing: b, topups } = await D.api('/api/company/topups');
  const def = Math.max(b.minAb, 5000);
  const pilots = topups.filter((t) => t.invoiceNo.startsWith('PILOT-'));
  const openPilot = pilots.find((t) => t.status === 'requested');
  slot.innerHTML = `
  <form class="panel stack card-pay" id="topup" novalidate autocomplete="off">
    <div class="row" style="justify-content:space-between;align-items:center"><h3 style="margin:0">Пополнить бюджет</h3><span class="cp-stamp">Демо-оплата</span></div>
    <p class="notice warn" style="margin:0">Оплата картой пока <b>не подключена</b>: это демонстрация формы. Не вводите данные настоящей карты — они никуда не отправляются${b.demo ? ', а в песочнице баллы зачислятся без списания денег' : ', и баллы не начислятся'}.</p>
    <label class="field"><span class="label">Сумма, AB</span><input class="input" id="cp-amount" type="number" min="${b.minAb}" step="100" value="${def}" required><span class="hint" id="tp-kzt"></span></label>
    <div class="cp-card" aria-hidden="true"><span class="cp-chip"></span><b id="cp-show">•••• •••• •••• ••••</b><span id="cp-show-exp">MM/YY</span></div>
    <label class="field"><span class="label">Номер карты</span><input class="input" id="cp-num" inputmode="numeric" autocomplete="off" maxlength="19" placeholder="4242 4242 4242 4242"></label>
    <div class="grid-2" style="gap:12px"><label class="field"><span class="label">Срок</span><input class="input" id="cp-exp" inputmode="numeric" autocomplete="off" maxlength="5" placeholder="12/30"></label>
    <label class="field"><span class="label">CVC</span><input class="input" id="cp-cvc" type="password" inputmode="numeric" autocomplete="off" maxlength="3" placeholder="123"></label></div>
    <button class="btn btn-ghost btn-sm" type="button" id="cp-test">Подставить тестовую карту</button>
    <button class="btn btn-primary" type="submit">Оплатить картой (демо)</button>
    <div id="cp-result" aria-live="polite"></div>
  </form>
  ${
    b.demo
      ? ''
      : `<form class="panel stack pilot" id="pilot" novalidate>
    <h3 style="margin:0">Пилотный бюджет</h3>
    <p class="small muted" style="margin:0">Пока оплата не подключена, платформа может выдать студии бюджет на первый тест бесплатно. Расскажите о проекте — администратор рассмотрит заявку, решение придёт в уведомления.</p>
    ${
      openPilot
        ? `<p class="notice" style="margin:0">Заявка ${esc(openPilot.invoiceNo)} на ${fmt(openPilot.amount)} AB отправлена ${fmtDT(openPilot.createdAt)} и ждёт решения. <button class="btn btn-quiet btn-sm" type="button" data-cancel="${openPilot.id}">Отменить</button></p>`
        : `<label class="field"><span class="label">Сколько нужно, AB</span><input class="input" name="amount" type="number" min="${b.minAb}" step="100" value="${def}" required></label>
    <label class="field"><span class="label">О проекте и тесте</span><textarea class="input" name="note" maxlength="300" required placeholder="Игра, жанр, что хотите проверить, сколько тестировщиков нужно"></textarea></label>
    <button class="btn btn-gold" type="submit">Отправить заявку</button>`
    }
    ${
      pilots.filter((t) => t.status !== 'requested').length
        ? `<ul class="invoices">${pilots
            .filter((t) => t.status !== 'requested')
            .slice(0, 5)
            .map((t) => `<li><div><b>${esc(t.invoiceNo)}</b><div class="tiny muted">${fmtDT(t.createdAt)}${t.adminNote ? ` · ${esc(t.adminNote)}` : ''}</div></div><div class="inv-r"><b>${fmt(t.amount)} AB</b></div><div class="inv-s">${t.status === 'paid' ? '<span class="badge ok">выдан</span>' : t.status === 'rejected' ? '<span class="badge bad">отклонён</span>' : '<span class="badge">отменён</span>'}</div></li>`)
            .join('')}</ul>`
        : ''
    }
  </form>`
  }`;
  const pf = $('#pilot', slot);
  if (pf && pf.amount)
    D.bindForm(pf, async (d) => {
      if (!d.note || d.note.trim().length < 10) throw new Error('Расскажите о проекте хотя бы парой предложений');
      await D.api('/api/company/pilot-request', { method: 'POST', body: { amount: Number(d.amount), note: d.note }, idem: true });
      D.toast('Заявка отправлена администратору', { stamp: 'Отправлено' });
      rerender();
    });
  $$('[data-cancel]', slot).forEach((btn) =>
    btn.addEventListener('click', () =>
      D.busy(btn, async () => {
        try {
          await D.api(`/api/company/topups/${btn.dataset.cancel}/cancel`, { method: 'POST', body: {} });
          D.toast('Заявка отменена');
          rerender();
        } catch (e) {
          D.toast(e.message, { kind: 'err' });
        }
      })
    )
  );
  const $f = (id) => $(id, slot);
  const amount = $f('#cp-amount'), num = $f('#cp-num'), exp = $f('#cp-exp'), cvc = $f('#cp-cvc');
  const upd = () => ($f('#tp-kzt').textContent = `К оплате: ${kzt((Number(amount.value) || 0) * b.abToKzt)} · 1 AB = ${b.abToKzt} ₸`);
  amount.addEventListener('input', upd);
  upd();
  num.addEventListener('input', () => {
    num.value = num.value.replace(/\D/g, '').slice(0, 16).replace(/(\d{4})(?=\d)/g, '$1 ');
    $f('#cp-show').textContent = (num.value.replace(/\s/g, '').padEnd(16, '•').match(/.{4}/g) || []).join(' ');
  });
  exp.addEventListener('input', () => {
    const d = exp.value.replace(/\D/g, '').slice(0, 4);
    exp.value = d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d;
    $f('#cp-show-exp').textContent = exp.value || 'MM/YY';
  });
  cvc.addEventListener('input', () => (cvc.value = cvc.value.replace(/\D/g, '').slice(0, 3)));
  $f('#cp-test').addEventListener('click', () => {
    num.value = '4242 4242 4242 4242';
    exp.value = '12/30';
    cvc.value = '123';
    num.dispatchEvent(new Event('input'));
    exp.dispatchEvent(new Event('input'));
  });
  const form = $f('#topup');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const res = $f('#cp-result');
    const a = Number(amount.value) || 0;
    const err = a < b.minAb ? `Минимум ${fmt(b.minAb)} AB` : num.value.replace(/\s/g, '').length !== 16 ? 'Введите 16 цифр номера карты' : !/^(0[1-9]|1[0-2])\/\d{2}$/.test(exp.value) ? 'Срок в формате ММ/ГГ' : cvc.value.length !== 3 ? 'CVC — 3 цифры' : '';
    if (err) {
      res.innerHTML = `<p class="form-error" style="margin:0">${esc(err)}</p>`;
      return;
    }
    // Данные карты сразу стираем из формы — они не сохраняются и не отправляются
    num.value = exp.value = cvc.value = '';
    $f('#cp-show').textContent = '•••• •••• •••• ••••';
    $f('#cp-show-exp').textContent = 'MM/YY';
    const btn = form.querySelector('button[type=submit]');
    await D.busy(btn, async () => {
      await new Promise((r) => setTimeout(r, 900));
      if (b.demo) {
        try {
          await D.api('/api/company/topups', { method: 'POST', body: { amount: a, note: 'Демо-оплата картой' }, idem: true });
          await D.refreshMe();
          D.renderChrome();
          D.toast(`Песочница: зачислено ${fmt(a)} AB без списания денег`, { stamp: 'Демо' });
          rerender();
        } catch (e2) {
          res.innerHTML = `<p class="form-error" style="margin:0">${esc(e2.message)}</p>`;
        }
      } else {
        res.innerHTML = `<div class="notice" style="margin:0"><span class="stamp press">Демо</span><p style="margin:10px 0 0"><b>Оплата не прошла: это демонстрация.</b> Платёжный шлюз ещё не подключён, деньги не списаны, баллы не начислены. Посмотреть, как работает бюджет, можно в демо-песочнице.</p></div>`;
      }
    });
  });
}

/** Счёт на оплату: печатается в PDF из браузера */
export async function viewInvoice({ params }) {
  const { topups, billing: b } = await D.api('/api/company/topups');
  const t = topups.find((x) => String(x.id) === String(params.id));
  if (!t) {
    D.app.innerHTML = D.empty('Счёт не найден', 'Возможно, он относится к другой студии.', '<a class="btn btn-ghost" href="#/budget">К бюджету</a>');
    return;
  }
  const me = D.state.me;
  const st = TOPUP_STATUS[t.status]?.[0] || t.status;
  D.app.innerHTML = `
  <div class="report invoice">
    <div class="rep-actions no-print"><a class="btn btn-ghost" href="#/budget">← Бюджет</a><button class="btn btn-primary" type="button" id="inv-print">Печать / PDF</button></div>
    ${b.demo ? '<div class="inv-demo">Демо-счёт · оплата не нужна · баллы уже зачислены</div>' : ''}
    <div class="rep-head"><p class="kicker">Счёт на оплату</p><h1>№ ${esc(t.invoiceNo)}</h1><p class="muted">от ${fmtDay(t.createdAt)} · статус: <b>${esc(st)}</b>${t.decidedAt ? ` · ${fmtDT(t.decidedAt)}` : ''}</p></div>
    <table class="table inv-table">
      <tr><th>Плательщик</th><td><b>${esc(me.companyName || me.name)}</b><div class="tiny muted">${esc(me.name)} · ${esc(me.email)}</div>${t.companyNote ? `<div class="tiny muted">${esc(t.companyNote)}</div>` : ''}</td></tr>
      <tr><th>Получатель</th><td>${b.details ? `<div class="inv-details">${esc(b.details).replace(/\n/g, '<br>')}</div>` : '<span class="muted">Реквизиты ещё не указаны администратором платформы. Не оплачивайте счёт, пока они не появятся здесь.</span>'}</td></tr>
      <tr><th>Назначение платежа</th><td>Пополнение бюджета плейтестов ATTENTION BANK по счёту № ${esc(t.invoiceNo)}</td></tr>
      <tr><th>Сумма</th><td><b class="inv-sum">${kzt(t.amountKzt)}</b><div class="tiny muted">${fmt(t.amount)} AB по курсу платформы 1 AB = ${b.abToKzt} ₸</div></td></tr>
    </table>
    <h2>Что дальше</h2>
    <ol class="inv-steps">
      <li>Оплатите сумму по реквизитам, указав в назначении номер счёта.</li>
      <li>Администратор сверит поступление и подтвердит платёж.</li>
      <li>${fmt(t.amount)} AB появятся на балансе студии, придёт уведомление. До подтверждения баллы не начисляются.</li>
    </ol>
    ${b.contact ? `<p class="small">Вопросы по оплате: <b>${esc(b.contact)}</b></p>` : ''}
    <p class="tiny muted rep-foot">Счёт сформирован ATTENTION BANK автоматически. AB Points — внутренние баллы платформы для оплаты подтверждённых результатов тестов; они не являются деньгами или электронными деньгами. Неизрасходованный остаток бюджета можно вывести по заявке в разделе «Выручка».</p>
  </div>`;
  $('#inv-print').onclick = () => print();
}

/** Короткая сводка о заявках на вывод (для раздела «Выручка») */
export function payoutStatusNote(payouts) {
  const open = payouts.filter((p) => p.status === 'requested');
  if (!open.length) return '';
  const sum = open.reduce((s, p) => s + p.amount, 0);
  return `<p class="notice" style="margin:10px 0 0">${open.length} ${D.plural(open.length, 'заявка', 'заявки', 'заявок')} на ${fmt(sum)} AB ждут перевода. Администратор отметит выплату или отклонит заявку — тогда баллы вернутся на баланс.</p>`;
}

// ===================================================================
//                 УРОВНИ ТЕСТИРОВЩИКОВ И РЕФЕРАЛЫ
// ===================================================================
const ROMAN = ['0', 'I', 'II', 'III', 'IV'];
export function levelBadge(level, name) {
  return `<span class="lv-badge l${level}" title="Уровень «${esc(name)}»"><span>${ROMAN[level] ?? level}</span></span>`;
}

function levelCard(lv) {
  const levels = D.state.meta.levels || [];
  const n = lv.next;
  const needs = n
    ? [
        n.approvedLeft > 0 ? `ещё <b>${n.approvedLeft}</b> ${D.plural(n.approvedLeft, 'одобренный ответ', 'одобренных ответа', 'одобренных ответов')}` : null,
        n.avgScoreNeed && (lv.avgScore ?? 0) < n.avgScoreNeed ? `средняя оценка качества от <b>${n.avgScoreNeed}</b> (сейчас ${lv.avgScore ?? '—'})` : null,
        n.maxRejectRate !== null && lv.rejectRate > n.maxRejectRate ? `отклонённых не больше <b>${n.maxRejectRate}%</b> (сейчас ${lv.rejectRate}%)` : null,
      ].filter(Boolean)
    : [];
  return `<section class="panel level-card">
    <div class="lv-head">${levelBadge(lv.level, lv.name)}<div><div class="label">Уровень тестировщика</div><h2>${esc(lv.name)}</h2></div><span class="spacer"></span>
      <div class="lv-limit"><b>${lv.dailyLimit}</b><span>${D.plural(lv.dailyLimit, 'ответ', 'ответа', 'ответов')} в день</span></div></div>
    ${
      n
        ? `<div class="lv-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${n.progress}" aria-label="Прогресс до уровня ${esc(n.name)}"><i style="--p:${n.progress}%"></i></div>
           <p class="small muted" style="margin:8px 0 0">До уровня «${esc(n.name)}»: ${needs.length ? needs.join(', ') : 'условия выполнены — уровень обновится после следующей проверки'}.</p>`
        : '<p class="small" style="margin:10px 0 0">Максимальный уровень: открыты все задания и самый высокий дневной лимит.</p>'
    }
    <ol class="lv-ladder">${levels
      .map((l) => `<li class="${l.level <= lv.level ? 'on' : ''}${l.level === lv.level ? ' now' : ''}"><b>${esc(l.name)}</b><span>${l.approved ? `${l.approved}+ одобр.` : 'старт'}${l.avgScore ? ` · от ${l.avgScore}` : ''}</span></li>`)
      .join('')}</ol>
    <p class="tiny muted" style="margin:12px 0 0">Уровень зависит только от проверенной работы. Студии могут открывать сложные тесты только опытным участникам.</p>
  </section>`;
}

function referralCard(r) {
  const text = 'Тестирую игры и приложения в ATTENTION BANK и получаю за это ключи игр и подписки. Присоединяйся:';
  const share = `https://t.me/share/url?url=${encodeURIComponent(r.link)}&text=${encodeURIComponent(text)}`;
  return `<section class="panel ref-card">
    <div class="row" style="align-items:flex-start"><div style="flex:1;min-width:200px"><div class="label">Пригласите друга</div><h2 style="margin:2px 0 6px">+${fmt(r.bonus)} AB за каждого</h2></div><span class="ref-stamp" aria-hidden="true">★</span></div>
    <p class="small muted" style="margin:0 0 12px">Бонус придёт, когда друг подтвердит Telegram и получит первое одобренное задание. Платит платформа из своих комиссий — баллы не «печатаются».${isDemo() ? ' <b style="color:var(--gold)">В демо Telegram не подключается, поэтому бонус здесь не начислится.</b>' : ''}</p>
    <div class="invite-row"><input class="input" id="ref-link" readonly value="${esc(r.link)}" aria-label="Ваша ссылка-приглашение"><button class="btn btn-ghost" type="button" data-copy="#ref-link">${D.I.copy(16)} Копировать</button><a class="btn btn-accent" href="${esc(share)}" target="_blank" rel="noopener">${D.I.tg(16)} Отправить</a></div>
    <div class="ref-stats"><div><b>${fmt(r.invited)}</b><span>пришли по ссылке</span></div><div><b>${fmt(r.verified)}</b><span>подтвердили Telegram</span></div><div><b>${fmt(r.active)}</b><span>выполнили задание</span></div><div><b>${fmt(r.earned)}</b><span>AB получено</span></div></div>
  </section>`;
}

/** Профиль участника: уровень и приглашения */
export async function mountGrowth(slot) {
  if (!slot) return;
  try {
    const [lv, ref] = await Promise.all([D.api('/api/me/level'), D.api('/api/me/referrals')]);
    slot.innerHTML = levelCard(lv) + referralCard(ref);
  } catch (e) {
    slot.innerHTML = `<p class="small muted">${esc(e.message)}</p>`;
  }
}

/** Компактная строка уровня для главной */
export async function mountLevelChip(slot) {
  if (!slot) return;
  try {
    const lv = await D.api('/api/me/level');
    slot.innerHTML = `<a class="lv-chip" href="#/profile">${levelBadge(lv.level, lv.name)}<span><b>${esc(lv.name)}</b>${lv.next ? `<small>до «${esc(lv.next.name)}»: ${lv.next.approvedLeft > 0 ? `ещё ${lv.next.approvedLeft} одобр.` : 'почти'}</small>` : '<small>максимальный уровень</small>'}</span>${lv.next ? `<i style="--p:${lv.next.progress}%"></i>` : ''}</a>`;
  } catch {
    slot.remove();
  }
}

/** Выбор уровня в форме кампании */
export function minLevelField(value = 0) {
  const levels = D.state.meta.levels || [];
  return `<label class="field" style="max-width:380px"><span class="label">Кому открыть задание</span>
    <select class="input" name="minLevel">${levels
      .map((l) => `<option value="${l.level}" ${Number(value) === l.level ? 'selected' : ''}>${l.level === 0 ? 'Всем участникам' : `С уровня «${esc(l.name)}» · ${l.approved}+ одобренных`}</option>`)
      .join('')}</select>
    <span class="hint">Сложные тесты лучше доверить опытным: уровень растёт за одобренные ответы хорошего качества. Чем выше порог, тем меньше людей увидят задание.</span></label>`;
}

// ===================================================================
//                         АДМИН-ПАНЕЛЬ
// ===================================================================
const TABS = [
  ['overview', 'Обзор'],
  ['money', 'Деньги'],
  ['users', 'Люди'],
  ['campaigns', 'Кампании'],
  ['marketing', 'Маркетинг'],
  ['errors', 'Ошибки'],
  ['log', 'Журнал'],
];

function promptDialog({ title, body = '', label = 'Комментарий', required = false, confirm = 'Готово', tone = 'primary', value = '' }) {
  const d = $('#modal');
  d.classList.remove('wide');
  d.innerHTML = `<form method="dialog" class="in" id="pd">
    <h2 id="modal-title">${esc(title)}</h2>${body}
    <label class="field" style="margin-top:12px"><span class="label">${esc(label)}${required ? '' : ' <span class="muted" style="font-weight:400">(необязательно)</span>'}</span><textarea class="input" name="note" maxlength="300" style="min-height:84px">${esc(value)}</textarea></label>
    <div class="acts"><button class="btn btn-ghost" value="cancel" formnovalidate>Отмена</button><button class="btn btn-${tone}" value="ok">${esc(confirm)}</button></div></form>`;
  const f = $('#pd', d);
  f.addEventListener('submit', (e) => {
    if (e.submitter?.value === 'ok' && required && !f.note.value.trim()) {
      e.preventDefault();
      f.note.focus();
      f.note.classList.add('shake');
      setTimeout(() => f.note.classList.remove('shake'), 500);
    }
  });
  d.showModal();
  f.note.focus();
  return new Promise((resolve) => d.addEventListener('close', () => resolve(d.returnValue === 'ok' ? f.note.value.trim() : null), { once: true }));
}

const onOff = (on, yes = 'работает', no = 'не настроено') => `<span class="badge ${on ? 'ok' : ''}">${on ? yes : no}</span>`;

export async function viewAdmin({ params, query }) {
  if (isDemo()) {
    D.app.innerHTML = D.empty('Админ-панель работает только с настоящей базой', 'Выйдите из демо, чтобы управлять приложением.', '<button class="btn btn-primary" type="button" data-mode="real">Выйти из демо</button>');
    return;
  }
  const tab = TABS.some(([k]) => k === params.tab) ? params.tab : 'overview';
  const o = await D.api('/api/admin/overview');
  const badge = { money: o.counts.pendingTopups + o.counts.pendingPayouts, errors: o.errors24h };
  D.app.innerHTML = `
  <div class="page-head"><div><p class="kicker">Администратор</p><h1>Пульт управления</h1><p>Деньги, люди, кампании, ошибки и резервные копии настоящего приложения.</p></div></div>
  <div class="tabs adm-tabs" role="tablist">${TABS.map(([k, l]) => `<a role="tab" href="#/admin/${k}" aria-selected="${k === tab}">${l}${badge[k] ? `<span class="adm-count">${badge[k]}</span>` : ''}</a>`).join('')}</div>
  <div id="adm"></div>`;
  const root = $('#adm');
  const views = { overview: admOverview, money: admMoney, users: admUsers, campaigns: admCampaigns, marketing: admMarketing, errors: admErrors, log: admLog };
  await views[tab](root, o, query);
}

function admOverview(root, o) {
  const c = o.counts;
  const t = o.treasury;
  const s = o.services;
  const b = s.backup;
  root.innerHTML = `
  <div class="kpi-row adm-kpis">
    <div class="kpi"><span>Участники</span><b>${fmt(c.users)}</b><em>+${fmt(c.signups7d)} за 7 дней (все роли)</em></div>
    <div class="kpi"><span>Студии</span><b>${fmt(c.companies)}</b><em>активных кампаний: ${fmt(c.activeCampaigns)}</em></div>
    <div class="kpi"><span>Одобрено ответов</span><b>${fmt(c.approved)}</b><em>ждут проверки студий: ${fmt(c.pendingReviews)}</em></div>
    <div class="kpi"><span>Награды</span><b>${fmt(c.activeRewards)}</b><em>обменов: ${fmt(c.redemptions)}</em></div>
  </div>
  ${
    c.pendingTopups || c.pendingPayouts || o.errors24h
      ? `<div class="adm-alerts">${c.pendingTopups ? `<a href="#/admin/money" class="adm-alert">${D.I.wallet(18)}<span><b>${c.pendingTopups}</b> ${D.plural(c.pendingTopups, 'счёт ждёт', 'счёта ждут', 'счетов ждут')} подтверждения оплаты</span></a>` : ''}${c.pendingPayouts ? `<a href="#/admin/money" class="adm-alert">${D.I.arrowOut(18)}<span><b>${c.pendingPayouts}</b> ${D.plural(c.pendingPayouts, 'заявка', 'заявки', 'заявок')} на вывод</span></a>` : ''}${o.errors24h ? `<a href="#/admin/errors" class="adm-alert bad">${D.I.x(18)}<span><b>${o.errors24h}</b> ${D.plural(o.errors24h, 'ошибка', 'ошибки', 'ошибок')} за сутки</span></a>` : ''}</div>`
      : '<p class="notice" style="margin:18px 0 0">Срочных дел нет: счета и заявки обработаны, ошибок за сутки нет.</p>'
  }
  <div class="grid-2" style="margin-top:22px;align-items:start">
    <section class="panel stack">
      <h2 style="margin:0;font-size:1.15rem">Казна</h2>
      <div class="integrity ${t.ok && o.ledger ? '' : 'bad'}">${t.ok && o.ledger ? D.I.shield(18) : D.I.x(18)}<span>${t.ok ? 'Сходится' : 'НЕ сходится'}: балансы + резервы (${fmt(t.supply)} AB) = пополнения (${fmt(t.deposits)}) − выводы (${fmt(t.payouts)}). Журналы транзакций ${o.ledger ? 'совпадают с балансами' : 'расходятся с балансами'}.</span></div>
      <dl class="adm-dl">
        <dt>В обороте</dt><dd>${fmt(t.supply)} AB · ${kzt(t.backedKzt)}</dd>
        <dt>У участников</dt><dd>${fmt(t.holders.users)} AB</dd>
        <dt>У студий</dt><dd>${fmt(t.holders.companies)} AB</dd>
        <dt>Резерв кампаний</dt><dd>${fmt(t.reserved)} AB</dd>
        <dt>Счёт платформы</dt><dd>${fmt(t.holders.platform)} AB</dd>
        <dt>Комиссии всего</dt><dd>${fmt(t.flows.platformFees)} AB</dd>
      </dl>
    </section>
    <section class="panel stack">
      <h2 style="margin:0;font-size:1.15rem">Сервисы</h2>
      <dl class="adm-dl">
        <dt>Telegram-бот</dt><dd>${onOff(s.telegram)}</dd>
        <dt>Письма (email)</dt><dd>${onOff(s.email)}</dd>
        <dt>Резервные копии</dt><dd>${onOff(b.enabled, b.provider === 'telegram' ? 'в Telegram' : b.provider === 's3' ? 'в S3 / R2' : 'включены', 'выключены')}${b.provider === 'telegram' ? '<div class="tiny muted">закреплённое сообщение в вашем чате с ботом</div>' : ''}${b.lastOkAt ? `<div class="tiny muted">последняя: ${fmtDT(b.lastOkAt)}${b.lastSize ? ` · ${Math.round(b.lastSize / 1024)} КБ` : ''}</div>` : ''}${b.lastError ? `<div class="tiny" style="color:var(--bad)">${esc(b.lastError)}</div>` : ''}${b.restoredFrom ? `<div class="tiny muted">после перезапуска база восстановлена ${b.restoredFrom === 'telegram' ? `из Telegram${b.restoredAt ? ` (копия от ${fmtDT(b.restoredAt)})` : ''}` : `из ${esc(b.restoredFrom)}`}</div>` : ''}</dd>
        <dt>Демо-песочница</dt><dd>${onOff(s.demo.enabled, 'включена', 'выключена')}${s.demo.lastResetAt ? `<div class="tiny muted">сброс: ${fmtDT(s.demo.lastResetAt)}, автосброс каждые ${s.demo.resetHours} ч</div>` : ''}</dd>
        <dt>Файл базы</dt><dd><code class="tiny">${esc(o.dbPath)}</code></dd>
      </dl>
      ${
        b.enabled
          ? ''
          : b.telegramPossible
            ? `<div class="notice warn stack" style="margin:0;gap:10px"><span><b>Включите копии базы в один шаг.</b> На бесплатном Render база стирается при каждом деплое. Привяжите Telegram к этому аккаунту — копия будет храниться в закреплённом сообщении вашего чата с ботом и сама восстановится после перезапуска.</span><a class="btn btn-primary btn-sm" href="#/profile" style="align-self:flex-start">Привязать Telegram</a></div>`
            : '<p class="notice warn" style="margin:0">Без резервных копий на бесплатном Render база стирается при каждом деплое. Подключите Telegram-бота (TELEGRAM_BOT_TOKEN) и привяжите его к этому аккаунту — или укажите BACKUP_S3_*.</p>'
      }
      <div class="row">
        <button class="btn btn-primary btn-sm" type="button" id="bk-now" ${b.enabled ? '' : 'disabled'}>Сделать копию сейчас</button>
        <a class="btn btn-ghost btn-sm" href="/api/admin/backup/download" download>${D.I.download(16)} Скачать базу</a>
        ${s.demo.enabled ? '<button class="btn btn-ghost btn-sm" type="button" id="demo-reset">Сбросить демо</button>' : ''}
      </div>
    </section>
  </div>`;
  $('#bk-now', root)?.addEventListener('click', (e) =>
    D.busy(e.currentTarget, async () => {
      try {
        const r = await D.api('/api/admin/backup', { method: 'POST', body: {} });
        D.toast(r.ok ? (r.provider === 'telegram' ? 'Копия сохранена в Telegram' : `Копия сохранена: ${r.key || 'готово'}`) : r.reason || 'Копия не сохранена', { kind: r.ok ? 'ok' : 'err' });
        D.router();
      } catch (err) {
        D.toast(err.message, { kind: 'err' });
      }
    })
  );
  $('#demo-reset', root)?.addEventListener('click', (e) =>
    D.busy(e.currentTarget, async () => {
      try {
        await D.api('/api/admin/demo/reset', { method: 'POST', body: {} });
        D.toast('Демо-песочница сброшена');
        D.router();
      } catch (err) {
        D.toast(err.message, { kind: 'err' });
      }
    })
  );
}

async function admMoney(root) {
  const { topups, payouts } = await D.api('/api/admin/money');
  const reload = () => D.router();
  const tRow = (t) => `<tr class="${t.status === 'requested' ? 'hot' : ''}">
    <td><b>№ ${esc(t.invoiceNo)}</b><div class="tiny muted">${fmtDT(t.createdAt)}</div></td>
    <td>${esc(t.company || '—')}<div class="tiny muted">${esc(t.email || '')}</div>${t.companyNote ? `<div class="tiny muted">«${esc(t.companyNote)}»</div>` : ''}</td>
    <td class="r"><b>${kzt(t.amountKzt)}</b><div class="tiny muted">${fmt(t.amount)} AB</div></td>
    <td>${topupBadge(t.status)}${t.adminNote ? `<div class="tiny muted">${esc(t.adminNote)}</div>` : ''}</td>
    <td class="r">${t.status === 'requested' ? `<div class="adm-acts"><button class="btn btn-primary btn-sm" data-tp-ok="${t.id}">${t.invoiceNo.startsWith('PILOT-') ? 'Выдать бюджет' : 'Оплата пришла'}</button><button class="btn btn-ghost btn-sm" data-tp-no="${t.id}">Отклонить</button></div>` : ''}</td></tr>`;
  const pRow = (p) => `<tr class="${p.status === 'requested' ? 'hot' : ''}">
    <td>${fmtDT(p.createdAt)}</td>
    <td>${esc(p.company || '—')}<div class="tiny muted">${esc(p.email || '')}</div></td>
    <td class="r"><b>${kzt(p.amountKzt)}</b><div class="tiny muted">${fmt(p.amount)} AB</div></td>
    <td><span class="badge ${p.status === 'paid' ? 'ok' : p.status === 'rejected' ? 'bad' : 'wait'}">${p.status === 'paid' ? 'выплачено' : p.status === 'rejected' ? 'отклонено' : 'ждёт перевода'}</span>${p.adminNote ? `<div class="tiny muted">${esc(p.adminNote)}</div>` : ''}</td>
    <td class="r">${p.status === 'requested' ? `<div class="adm-acts"><button class="btn btn-primary btn-sm" data-po-ok="${p.id}">Перевёл</button><button class="btn btn-ghost btn-sm" data-po-no="${p.id}">Отклонить</button></div>` : ''}</td></tr>`;
  root.innerHTML = `
  <section class="panel panel-tight">
    <div class="section-head sh-plain" style="margin:0 0 6px"><h2 style="font-size:1.15rem">Заявки на бюджет</h2><span class="small muted">PILOT — пилотный бюджет без оплаты; AB начисляются только после вашего решения</span></div>
    ${topups.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Счёт</th><th>Студия</th><th class="r">Сумма</th><th>Статус</th><th></th></tr></thead><tbody>${topups.map(tRow).join('')}</tbody></table></div>` : '<p class="muted" style="margin:6px 0">Счетов пока нет.</p>'}
  </section>
  <section class="panel panel-tight" style="margin-top:20px">
    <div class="section-head sh-plain" style="margin:0 0 6px"><h2 style="font-size:1.15rem">Выводы продавцам</h2><span class="small muted">AB уже списаны; при отклонении вернутся продавцу</span></div>
    ${payouts.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Дата</th><th>Студия</th><th class="r">Сумма</th><th>Статус</th><th></th></tr></thead><tbody>${payouts.map(pRow).join('')}</tbody></table></div>` : '<p class="muted" style="margin:6px 0">Заявок на вывод пока нет.</p>'}
  </section>`;
  const act = (sel, fn) =>
    $$(sel, root).forEach((btn) =>
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute(sel.slice(1, -1));
        await D.busy(btn, async () => {
          try {
            if ((await fn(id)) !== false) reload();
          } catch (e) {
            D.toast(e.message, { kind: 'err' });
          }
        });
      })
    );
  act('[data-tp-ok]', async (id) => {
    const t = topups.find((x) => String(x.id) === id);
    const pilot = t.invoiceNo.startsWith('PILOT-');
    const note = pilot
      ? await promptDialog({ title: `Выдать пилотный бюджет «${t.company}»?`, body: `<p class="small muted" style="margin:0">Студия получит <b>${fmt(t.amount)} AB</b> бесплатно, от платформы. В журнале будет пометка «без оплаты». Отменить нельзя.</p>${t.companyNote ? `<p class="small" style="margin:8px 0 0">«${esc(t.companyNote)}»</p>` : ''}`, label: 'Комментарий для студии', confirm: 'Выдать бюджет' })
      : await promptDialog({ title: `Подтвердить оплату счёта № ${t.invoiceNo}?`, body: `<p class="small muted" style="margin:0">Проверьте, что ${kzt(t.amountKzt)} от «${esc(t.company)}» действительно поступили на счёт. Студии начислится <b>${fmt(t.amount)} AB</b>. Отменить это действие нельзя.</p>`, label: 'Комментарий (номер платёжки)', confirm: 'Подтвердить и начислить' });
    if (note === null) return false;
    await D.api(`/api/admin/topups/${id}/approve`, { method: 'POST', body: { note } });
    D.toast(`Начислено ${fmt(t.amount)} AB`, { stamp: 'Оплачено' });
  });
  act('[data-tp-no]', async (id) => {
    const note = await promptDialog({ title: 'Отклонить счёт?', body: '<p class="small muted" style="margin:0">Студия увидит причину. Баллы не начисляются.</p>', label: 'Причина', required: true, confirm: 'Отклонить', tone: 'danger' });
    if (note === null) return false;
    await D.api(`/api/admin/topups/${id}/reject`, { method: 'POST', body: { note } });
    D.toast('Счёт отклонён');
  });
  act('[data-po-ok]', async (id) => {
    const p = payouts.find((x) => String(x.id) === id);
    const note = await promptDialog({ title: 'Отметить выплату?', body: `<p class="small muted" style="margin:0">Подтвердите, что ${kzt(p.amountKzt)} переведены «${esc(p.company)}» по реквизитам из договора.</p>`, label: 'Комментарий (номер платёжки)', confirm: 'Выплачено' });
    if (note === null) return false;
    await D.api(`/api/admin/payouts/${id}/paid`, { method: 'POST', body: { note } });
    D.toast('Выплата отмечена');
  });
  act('[data-po-no]', async (id) => {
    const note = await promptDialog({ title: 'Отклонить вывод?', body: '<p class="small muted" style="margin:0">Баллы вернутся на баланс продавца, он увидит причину.</p>', label: 'Причина', required: true, confirm: 'Отклонить и вернуть AB', tone: 'danger' });
    if (note === null) return false;
    await D.api(`/api/admin/payouts/${id}/reject`, { method: 'POST', body: { note } });
    D.toast('Заявка отклонена, баллы возвращены');
  });
}

async function admUsers(root, o, query) {
  const q = query.q || '';
  const role = query.role || '';
  const { users } = await D.api(`/api/admin/users?${new URLSearchParams({ q, role })}`);
  root.innerHTML = `
  <form class="filterbar" id="uf" role="search">
    <input class="input" name="q" aria-label="Поиск: имя, email или студия" value="${esc(q)}" placeholder="Имя, email или студия" style="flex:1;min-width:200px">
    <select class="input" name="role" aria-label="Роль" style="width:auto"><option value="">Все</option><option value="user" ${role === 'user' ? 'selected' : ''}>Участники</option><option value="company" ${role === 'company' ? 'selected' : ''}>Студии</option></select>
    <button class="btn btn-ghost" type="submit">Найти</button>
  </form>
  <div class="panel panel-tight table-wrap"><table class="table adm-users"><thead><tr><th>Кто</th><th>Роль</th><th class="r">Баланс</th><th class="hide-sm">Источник</th><th>Статус</th><th></th></tr></thead><tbody>
  ${
    users
      .map(
        (u) => `<tr><td><b>${esc(u.role === 'company' ? u.company || u.name : u.name)}</b><div class="tiny muted">${esc(u.email)} · с ${new Date(u.createdAt).toLocaleDateString('ru-RU')}</div></td>
      <td>${u.isAdmin ? '<span class="badge gold">админ</span>' : u.role === 'company' ? 'студия' : `участник<div class="tiny muted">${esc(u.level || '')}</div>`}</td>
      <td class="r">${fmt(u.balance)} AB</td>
      <td class="hide-sm"><span class="tiny">${esc(u.source || 'прямой заход')}</span>${u.telegram ? '<div class="tiny muted">Telegram ✓</div>' : ''}</td>
      <td>${u.deleted ? '<span class="badge">удалён</span>' : u.blocked ? '<span class="badge bad">заблокирован</span>' : '<span class="badge ok">активен</span>'}</td>
      <td class="r">${u.deleted || u.isAdmin ? '' : `<div class="adm-acts"><button class="btn btn-ghost btn-sm" data-block="${u.id}" data-on="${u.blocked ? '0' : '1'}">${u.blocked ? 'Разблокировать' : 'Заблокировать'}</button>${u.role === 'company' && !u.blocked ? `<button class="btn btn-ghost btn-sm" data-grant="${u.id}" data-name="${esc(u.company || u.name)}">Выдать бюджет</button>` : ''}<button class="btn btn-quiet btn-sm" data-reset="${u.id}">Ссылка для пароля</button></div>`}</td></tr>`
      )
      .join('') || '<tr><td colspan="6" class="muted">Никого не нашлось</td></tr>'
  }
  </tbody></table></div>
  <p class="tiny muted">Показано до 200 последних. Блокировка завершает все сессии; баланс и история остаются.</p>`;
  $('#uf', root).addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.currentTarget;
    location.hash = `#/admin/users?${new URLSearchParams({ q: f.q.value.trim(), role: f.role.value })}`;
  });
  $$('[data-block]', root).forEach((btn) =>
    btn.addEventListener('click', async () => {
      const blocked = btn.dataset.on === '1';
      const reason = await promptDialog({ title: blocked ? 'Заблокировать аккаунт?' : 'Разблокировать аккаунт?', body: blocked ? '<p class="small muted" style="margin:0">Человек выйдет из аккаунта и не сможет войти, пока вы не разблокируете.</p>' : '', label: 'Причина', required: blocked, confirm: blocked ? 'Заблокировать' : 'Разблокировать', tone: blocked ? 'danger' : 'primary' });
      if (reason === null) return;
      await D.busy(btn, async () => {
        try {
          await D.api(`/api/admin/users/${btn.dataset.block}/block`, { method: 'POST', body: { blocked, reason } });
          D.toast(blocked ? 'Аккаунт заблокирован' : 'Аккаунт разблокирован');
          D.router();
        } catch (e) {
          D.toast(e.message, { kind: 'err' });
        }
      });
    })
  );
  $$('[data-grant]', root).forEach((btn) =>
    btn.addEventListener('click', async () => {
      const amount = await promptDialog({ title: `Пилотный бюджет для «${btn.dataset.name}»`, body: '<p class="small muted" style="margin:0">Сколько AB выдать бесплатно, от платформы. В журнале будет пометка «без оплаты».</p>', label: 'Сумма, AB', required: true, confirm: 'Выдать', value: '5000' });
      if (amount === null) return;
      await D.busy(btn, async () => {
        try {
          await D.api(`/api/admin/users/${btn.dataset.grant}/grant`, { method: 'POST', body: { amount: Number(amount.replace(/\D/g, '')), note: 'Выдано администратором' } });
          D.toast(`Выдано ${fmt(Number(amount.replace(/\D/g, '')))} AB`, { stamp: 'Пилот' });
          D.router();
        } catch (e) {
          D.toast(e.message, { kind: 'err' });
        }
      });
    })
  );
  $$('[data-reset]', root).forEach((btn) =>
    btn.addEventListener('click', () =>
      D.busy(btn, async () => {
        try {
          const r = await D.api(`/api/admin/users/${btn.dataset.reset}/reset-link`, { method: 'POST', body: {} });
          D.infoDialog({
            title: 'Одноразовая ссылка для пароля',
            body: `<p class="small muted" style="margin:0 0 10px">Передайте её лично, убедившись, что аккаунт принадлежит этому человеку. Действует ${r.expiresInMinutes} мин, сработает один раз.</p><div class="invite-row"><input class="input" id="rl" readonly value="${esc(r.link)}"><button class="btn btn-ghost" type="button" data-copy="#rl">Копировать</button></div>`,
          });
        } catch (e) {
          D.toast(e.message, { kind: 'err' });
        }
      })
    )
  );
}

async function admCampaigns(root) {
  const { campaigns } = await D.api('/api/admin/campaigns');
  const st = { active: '<span class="badge ok">активна</span>', paused: '<span class="badge wait">пауза</span>', closed: '<span class="badge">закрыта</span>' };
  root.innerHTML = `<div class="panel panel-tight table-wrap"><table class="table"><thead><tr><th>Кампания</th><th>Студия</th><th class="r">Результаты</th><th class="r hide-sm">Резерв</th><th>Статус</th><th></th></tr></thead><tbody>
  ${
    campaigns
      .map(
        (c) => `<tr><td><b>${esc(c.title)}</b><div class="tiny muted">#${c.id} · ${c.reward} AB · ${new Date(c.created_at).toLocaleDateString('ru-RU')}</div></td><td>${esc(c.company)}</td>
      <td class="r">${c.approved} / ${c.max_participants}${c.pending ? `<div class="tiny muted">на проверке: ${c.pending}</div>` : ''}</td><td class="r hide-sm">${fmt(c.reserved)} AB</td><td>${st[c.status] || esc(c.status)}</td>
      <td class="r">${c.status === 'active' ? `<button class="btn btn-ghost btn-sm" data-cs="${c.id}" data-to="paused">Приостановить</button>` : c.status === 'paused' ? `<button class="btn btn-ghost btn-sm" data-cs="${c.id}" data-to="active">Возобновить</button>` : ''}</td></tr>`
      )
      .join('') || '<tr><td colspan="6" class="muted">Кампаний пока нет</td></tr>'
  }</tbody></table></div>
  <p class="tiny muted">Модерация не двигает деньги: резерв остаётся у кампании, студия получает уведомление с причиной.</p>`;
  $$('[data-cs]', root).forEach((btn) =>
    btn.addEventListener('click', async () => {
      const pause = btn.dataset.to === 'paused';
      const reason = await promptDialog({ title: pause ? 'Приостановить кампанию?' : 'Возобновить кампанию?', body: pause ? '<p class="small muted" style="margin:0">Участники перестанут видеть задание. Студия получит уведомление с причиной.</p>' : '', label: 'Причина', required: pause, confirm: pause ? 'Приостановить' : 'Возобновить', tone: pause ? 'danger' : 'primary' });
      if (reason === null) return;
      await D.busy(btn, async () => {
        try {
          await D.api(`/api/admin/campaigns/${btn.dataset.cs}/status`, { method: 'POST', body: { status: btn.dataset.to, reason } });
          D.toast(pause ? 'Кампания приостановлена' : 'Кампания возобновлена');
          D.router();
        } catch (e) {
          D.toast(e.message, { kind: 'err' });
        }
      });
    })
  );
}

async function admMarketing(root) {
  const m = await D.api('/api/admin/marketing');
  const days = [];
  for (let i = 13; i >= 0; i--) {
    const key = new Date(Date.now() - i * 864e5).toISOString().slice(0, 10);
    days.push({ key, n: m.signupsByDay.find((d) => d.day === key)?.n || 0 });
  }
  const max = Math.max(1, ...days.map((d) => d.n));
  const total = days.reduce((s, d) => s + d.n, 0);
  const base = location.origin;
  root.innerHTML = `
  <div class="grid-2" style="align-items:start">
    <section class="panel">
      <div class="section-head sh-plain" style="margin:0 0 12px"><h2 style="font-size:1.15rem">Регистрации за 14 дней</h2><span class="small muted">всего ${fmt(total)}</span></div>
      <div class="adm-bars" role="img" aria-label="Регистрации по дням">${days.map((d, i) => `<div title="${new Date(d.key + 'T12:00:00Z').toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}: ${d.n}" style="--h:${Math.round((d.n / max) * 100)}%;--k:${i}"><i></i><span>${new Date(d.key + 'T12:00:00Z').getUTCDate()}</span></div>`).join('')}</div>
      <dl class="adm-dl" style="margin-top:16px"><dt>Пришли по приглашению друга</dt><dd>${fmt(m.referrals)}</dd><dt>Выплачено реферальных бонусов</dt><dd>${fmt(m.referralBonusesPaid)} AB</dd></dl>
    </section>
    <section class="panel stack">
      <h2 style="margin:0;font-size:1.15rem">Ссылка с меткой для рекламы</h2>
      <p class="small muted" style="margin:0">Разные ссылки для разных каналов покажут, откуда приходят люди и доходят ли до первого задания.</p>
      <div class="grid-3" style="gap:10px"><label class="field"><span class="label">Источник</span><input class="input" id="u-src" placeholder="instagram"></label><label class="field"><span class="label">Тип</span><input class="input" id="u-med" placeholder="stories"></label><label class="field"><span class="label">Кампания</span><input class="input" id="u-cmp" placeholder="pilot"></label></div>
      <div class="invite-row"><input class="input" id="u-out" aria-label="Готовая ссылка с метками" readonly value="${esc(base)}/"><button class="btn btn-ghost" type="button" data-copy="#u-out">Копировать</button></div>
    </section>
  </div>
  <section class="panel panel-tight" style="margin-top:20px">
    <h2 style="font-size:1.15rem;margin:4px 0 8px">Каналы</h2>
    ${
      m.sources.length
        ? `<div class="table-wrap"><table class="table"><thead><tr><th>Источник</th><th>Роль</th><th class="r">Регистраций</th><th class="r">Дошли до одобренного задания</th></tr></thead><tbody>${m.sources
            .map((s) => `<tr><td><b>${esc(s.source)}</b></td><td>${s.role === 'company' ? 'студии' : 'участники'}</td><td class="r">${fmt(s.signups)}</td><td class="r">${s.role === 'company' ? '—' : `${fmt(s.activated)} · ${s.signups ? Math.round((s.activated / s.signups) * 100) : 0}%`}</td></tr>`)
            .join('')}</tbody></table></div>`
        : '<p class="muted">Регистраций пока нет.</p>'
    }
  </section>`;
  const upd = () => {
    const clean = (v) => v.trim().toLowerCase().replace(/[^a-z0-9_.-]/g, '');
    const p = new URLSearchParams();
    const [s, md, c] = ['#u-src', '#u-med', '#u-cmp'].map((id) => clean($(id, root).value));
    if (s) p.set('utm_source', s);
    if (md) p.set('utm_medium', md);
    if (c) p.set('utm_campaign', c);
    $('#u-out', root).value = `${base}/${p.toString() ? `?${p}` : ''}`;
  };
  ['#u-src', '#u-med', '#u-cmp'].forEach((id) => $(id, root).addEventListener('input', upd));
}

async function admErrors(root) {
  const { errors } = await D.api('/api/admin/errors');
  root.innerHTML = errors.length
    ? `<div class="panel panel-tight"><ul class="adm-errors">${errors
        .map(
          (e) => `<li><div class="ae-top"><span class="badge ${e.source === 'client' ? 'sky' : 'bad'}">${e.source === 'client' ? 'браузер' : esc(e.source || 'сервер')}</span><b>${esc(e.message)}</b><span class="spacer"></span><span class="tiny muted">${fmtDT(e.created_at)}</span></div>
          <div class="tiny muted">${esc(e.path || '')}${e.user_id ? ` · пользователь #${e.user_id}` : ''}</div>${e.detail ? `<details><summary class="tiny">Подробности</summary><pre>${esc(e.detail)}</pre></details>` : ''}</li>`
        )
        .join('')}</ul></div><p class="tiny muted">Хранятся последние 2000 записей. Пароли, токены и данные Telegram вырезаются до записи.</p>`
    : D.empty('Ошибок нет', 'Сюда попадают сбои сервера и ошибки в браузерах пользователей.');
}

async function admLog(root) {
  const { actions } = await D.api('/api/admin/actions');
  const label = {
    topup_paid: 'подтвердил оплату', topup_rejected: 'отклонил счёт', payout_paid: 'отметил выплату', payout_rejected: 'отклонил вывод',
    block: 'заблокировал', unblock: 'разблокировал', reset_link: 'выдал ссылку для пароля', campaign_paused: 'приостановил кампанию', campaign_active: 'возобновил кампанию',
    backup: 'сделал резервную копию', db_download: 'скачал базу', demo_reset: 'сбросил демо',
  };
  root.innerHTML = actions.length
    ? `<div class="panel panel-tight table-wrap"><table class="table"><thead><tr><th>Когда</th><th>Кто</th><th>Действие</th><th>Детали</th></tr></thead><tbody>${actions
        .map((a) => `<tr><td class="tiny">${fmtDT(a.created_at)}</td><td class="tiny">${esc(a.admin_email || `#${a.admin_id}`)}</td><td>${esc(label[a.action] || a.action)}<div class="tiny muted">${esc(a.target || '')}</div></td><td class="tiny">${esc(a.detail || '')}</td></tr>`)
        .join('')}</tbody></table></div>`
    : D.empty('Журнал пуст', 'Здесь появятся решения администраторов: подтверждения оплат, выплаты, блокировки.');
}
