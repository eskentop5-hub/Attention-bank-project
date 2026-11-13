// АБИ v13: 3D-маскот и ассистент, который выполняет команды.
// Выбираешь готовый вопрос или команду — Аби ищет задания и награды, ставит цель, открывает разделы,
// готовит обмен (подтверждаешь ты) и черновик кампании (публикует студия). С ключом ИИ — ещё и ищет в интернете.
// Переписка хранится в браузере (переживает перезагрузку); ответы можно озвучивать.
import { Stage, setAbiMood, ABI, reducedMotion } from './ab3d.js';

let D = null;
export const hooks = { onOpen: null, onClose: null, svg: '' };
export function setupAbi(deps) {
  D = deps;
}
const esc = (s) => D.esc(s);
const MAX_HIST = 40;

// ------------------------------------------------------------------ 3D-Аби в любом блоке
const stages = new Map();
/** Нарисовать 3D-Аби в блоке el. Возвращает view или null, если WebGL недоступен. */
export function mountAbi3d(el, opts = {}) {
  try {
    const canvas = document.createElement('canvas');
    canvas.className = 'abi-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    el.append(canvas);
    const stage = new Stage(canvas);
    if (!stage.ok) {
      canvas.remove();
      return null;
    }
    const target = document.createElement('div');
    target.className = 'abi-view';
    el.append(target);
    const view = stage.add(target, { model: 'abi', autoRotate: false, float: !reducedMotion, floor: false, distance: 3.2, theta: 0, phi: 1.42, target: [0, -0.06, 0], ...opts });
    target.removeAttribute('tabindex');
    target.removeAttribute('role');
    target.setAttribute('aria-hidden', 'true');
    stages.set(el, stage);
    return view;
  } catch (e) {
    console.warn('[abi] 3D недоступно:', e.message);
    return null;
  }
}
export function unmountAbi3d(el) {
  stages.get(el)?.dispose();
  stages.delete(el);
}
export const mood = (m) => setAbiMood(m);
export const ABI_MOOD = () => ABI.mood;

// ------------------------------------------------------------------ хранение переписки
const histKey = () => `ab_abi_${D.state.me ? D.state.me.id : 'guest'}_${D.isDemo?.() ? 'demo' : 'real'}`;
function loadHist() {
  try {
    return JSON.parse(localStorage.getItem(histKey()) || '[]');
  } catch {
    return [];
  }
}
function saveHist(h) {
  try {
    localStorage.setItem(histKey(), JSON.stringify(h.slice(-MAX_HIST)));
  } catch {}
}

// Безопасная «лёгкая разметка»: **жирный**, ссылки https://, переносы строк
function rich(text) {
  return esc(text)
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)»])/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
}

// ------------------------------------------------------------------ чат
let panel = null;
let info = null;
let busyNow = false;

export async function openAbi(prefill = '') {
  if (panel) {
    if (prefill) send(prefill);
    return panel.querySelector('.abi-sugg button')?.focus();
  }
  hooks.onOpen?.();
  panel = document.createElement('section');
  panel.className = 'mascot-chat abi-chat';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Аби — ассистент ATTENTION BANK');
  panel.innerHTML = `
    <header>
      <span class="abi-head" aria-hidden="true"></span>
      <div class="abi-title"><b>Аби</b><small class="abi-status">подключаюсь…</small></div>
      <button type="button" class="x abi-voice" aria-pressed="false" title="Озвучивать ответы" aria-label="Озвучивать ответы">🔈</button>
      <button type="button" class="x abi-clear" title="Очистить переписку" aria-label="Очистить переписку">🗑</button>
      <button type="button" class="x abi-close" aria-label="Закрыть">✕</button>
    </header>
    <div class="msgs" aria-live="polite"></div>
    <div class="abi-sugg" role="group" aria-label="Выберите вопрос или команду"></div>`;
  document.body.append(panel);
  const head = panel.querySelector('.abi-head');
  if (!mountAbi3d(head, { distance: 2.55, target: [0, 0.12, 0], float: false })) head.innerHTML = hooks.svg || '';
  const msgs = panel.querySelector('.msgs');
  panel.querySelector('.abi-close').onclick = closeAbi;
  panel.addEventListener('keydown', (e) => e.key === 'Escape' && closeAbi());
  panel.querySelector('.abi-clear').onclick = () => {
    saveHist([]);
    msgs.innerHTML = '';
    greet();
  };
  const voiceBtn = panel.querySelector('.abi-voice');
  const voiceOn = () => D.store.get('ab_abi_voice') === 'on';
  const syncVoice = () => {
    voiceBtn.textContent = voiceOn() ? '🔊' : '🔈';
    voiceBtn.setAttribute('aria-pressed', String(voiceOn()));
  };
  syncVoice();
  voiceBtn.onclick = () => {
    D.store.set('ab_abi_voice', voiceOn() ? 'off' : 'on');
    if (!voiceOn()) speechSynthesis?.cancel();
    syncVoice();
  };

  // Прошлая переписка
  const hist = loadHist();
  for (const h of hist) renderMsg(h, false);
  if (!hist.length) greet();
  msgs.scrollTop = msgs.scrollHeight;

  info = await D.api('/api/abi').catch(() => null);
  if (!panel) return;
  panel.querySelector('.abi-status').textContent = info?.ai ? 'ИИ · поиск в интернете · команды' : 'команды и база знаний · офлайн';
  panel.querySelector('.abi-status').title = info?.ai ? 'Отвечает ИИ (Claude) с инструментами приложения и поиском в интернете' : 'ИИ не подключён на сервере (нет ANTHROPIC_API_KEY): Аби выполняет команды и отвечает из базы знаний';
  renderSuggestions(info?.suggestions || []);
  if (prefill) send(prefill);
  else panel.querySelector('.abi-sugg button')?.focus();
}

export function closeAbi() {
  if (!panel) return;
  unmountAbi3d(panel.querySelector('.abi-head'));
  panel.remove();
  panel = null;
  speechSynthesis?.cancel?.();
  setAbiMood('idle');
  hooks.onClose?.();
}
export const abiOpen = () => !!panel;

function greet() {
  const me = D.state.me;
  const name = me ? (me.role === 'company' ? me.companyName : me.name) : '';
  renderMsg(
    {
      role: 'assistant',
      text: `Сәлем${name ? `, ${name}` : ''}! Я Аби. Выбери вопрос или команду внизу — найду задания, подберу награду, покажу цель и статистику${me?.role === 'company' ? ', соберу черновик плейтеста' : ''} или открою нужный раздел 👇`,
    },
    false
  );
}

function renderSuggestions(list) {
  const box = panel?.querySelector('.abi-sugg');
  if (!box) return;
  box.innerHTML = list.map((s, i) => `<button type="button" style="--i:${i}">${esc(s)}</button>`).join('');
  box.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => send(b.textContent)));
}

function renderMsg(h, store = true) {
  const msgs = panel?.querySelector('.msgs');
  if (!msgs) return null;
  const el = document.createElement('div');
  el.className = `m ${h.role === 'user' ? 'me' : 'bot'}`;
  el.innerHTML = `<div class="t">${rich(h.text)}</div>`;
  if (h.actions?.length) {
    const row = document.createElement('div');
    row.className = 'abi-actions';
    h.actions.forEach((a, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `btn btn-sm ${a.type === 'redeem' ? 'btn-gold' : i === 0 ? 'btn-primary' : 'btn-ghost'}`;
      b.textContent = a.label;
      b.onclick = () => doAction(a, b);
      row.append(b);
    });
    el.append(row);
  }
  if (h.sources?.length)
    el.insertAdjacentHTML('beforeend', `<div class="abi-src"><span>Источники:</span>${h.sources.map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.title || new URL(s.url).hostname)}</a>`).join('')}</div>`);
  if (h.mode) el.insertAdjacentHTML('beforeend', `<small class="abi-mode">${h.mode === 'ai' ? `ИИ${h.used?.includes('web_search') ? ' · искал в интернете' : ''}` : 'команды · офлайн'}</small>`);
  msgs.append(el);
  msgs.scrollTo({ top: msgs.scrollHeight, behavior: reducedMotion ? 'auto' : 'smooth' });
  if (store) {
    const hist = loadHist();
    hist.push(h);
    saveHist(hist);
  }
  return el;
}

async function send(text) {
  if (!panel || busyNow) return;
  busyNow = true;
  panel.querySelector('.abi-sugg')?.classList.add('busy');
  const hist = loadHist();
  renderMsg({ role: 'user', text });
  const msgs = panel.querySelector('.msgs');
  const typing = document.createElement('div');
  typing.className = 'm bot typing';
  typing.innerHTML = '<i></i><i></i><i></i>';
  msgs.append(typing);
  msgs.scrollTop = msgs.scrollHeight;
  setAbiMood('think');
  try {
    const r = await D.api('/api/abi', {
      method: 'POST',
      body: { message: text, page: location.hash.slice(0, 60), history: hist.slice(-10).map((h) => ({ role: h.role, text: h.text })) },
    });
    typing.remove();
    if (!panel) return;
    setAbiMood('talk');
    const h = { role: 'assistant', text: r.reply, actions: (r.actions || []).filter((a) => !a.auto || a.type !== 'open'), sources: r.sources, mode: r.mode, used: r.used };
    const autos = (r.actions || []).filter((a) => a.auto);
    renderMsg(h);
    speak(r.reply);
    setTimeout(() => setAbiMood(r.actions?.some((a) => a.type === 'redeem') ? 'happy' : 'idle'), Math.min(2600, 400 + r.reply.length * 18));
    setTimeout(() => ABI.mood === 'happy' && setAbiMood('idle'), 4200);
    // «Приказы» выполняются сразу: открыть раздел, черновик кампании
    for (const a of autos) doAction(a, null, true);
  } catch (err) {
    typing.remove();
    setAbiMood('idle');
    renderMsg({ role: 'assistant', text: `⚠️ ${err.message || 'Не получилось. Попробуй ещё раз.'}` }, false);
  } finally {
    busyNow = false;
    panel?.querySelector('.abi-sugg')?.classList.remove('busy');
  }
}

async function doAction(a, btn, auto = false) {
  if (a.type === 'open' || a.type === 'draft') {
    if (a.type === 'draft') sessionStorage.setItem('ab_campaign_draft', JSON.stringify(a.draft));
    const go = () => {
      if (location.hash === a.href) D.router();
      else location.hash = a.href;
    };
    // На телефоне чат закрывает экран — сворачиваем, чтобы было видно открытый раздел
    if (innerWidth < 720) closeAbi();
    if (auto) setTimeout(go, 500);
    else go();
    return;
  }
  if (a.type === 'copy') {
    await navigator.clipboard?.writeText(a.text).catch(() => {});
    D.toast('Ссылка скопирована');
    return;
  }
  if (a.type === 'redeem') {
    const ok = await D.confirmDialog({
      title: 'Обменять баллы на награду?',
      body: `<p style="margin:0 0 8px"><b>${esc(a.title)}</b></p><p class="small muted" style="margin:0">Спишется <b>${D.fmt(a.cost)} AB</b>. Обмен нельзя отменить. Аби только подготовил обмен — решение за тобой.</p>`,
      confirm: `Получить за ${D.fmt(a.cost)} AB`,
      tone: 'gold',
    });
    if (!ok) return;
    try {
      if (btn) btn.disabled = true;
      const res = await D.api(`/api/rewards/${a.rewardId}/redeem`, { method: 'POST', body: {}, idem: true });
      D.state.me.balance = res.balance;
      D.renderChrome();
      setAbiMood('happy');
      setTimeout(() => setAbiMood('idle'), 3500);
      renderMsg({ role: 'assistant', text: `Готово! «${a.title}» твоя. Код: **${res.code || 'в разделе «Мои награды»'}**. Он сохранён в профиле.` });
      D.toast('Награда получена 🎉');
    } catch (err) {
      if (btn) btn.disabled = false;
      D.toast(err.message, { kind: 'err' });
    }
  }
}

function speak(text) {
  if (D.store.get('ab_abi_voice') !== 'on' || !window.speechSynthesis) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text.replace(/\*\*/g, '').replace(/https?:\/\/\S+/g, '').slice(0, 600));
  u.lang = 'ru-RU';
  const v = speechSynthesis.getVoices().find((x) => /^ru/i.test(x.lang));
  if (v) u.voice = v;
  u.onstart = () => setAbiMood('talk');
  u.onend = () => setAbiMood('idle');
  speechSynthesis.speak(u);
}
