// ATTENTION BANK v11: плавная анимация в стиле советского плаката.
// • Переход между страницами — диагональная красно-золотая полоса (конструктивистская композиция).
// • Числа — табло с перекидными цифрами (как на вокзалах и в аэропортах).
// • Баланс в шапке «перещёлкивается», когда приходят AB Points.
// Всё отключается, если в системе включено «уменьшение движения».
export const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Полоса-переход между разделами */
export function wipe() {
  if (REDUCED) return;
  document.querySelector('.wipe')?.remove();
  const el = document.createElement('div');
  el.className = 'wipe';
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = '<i class="w-red"></i><i class="w-gold"></i><b class="w-star">★</b>';
  document.body.append(el);
  setTimeout(() => el.remove(), 1000);
}

/** Табло: цифры перелистываются и встают на место; ширина не прыгает (табличные цифры) */
const DIGITS = '0123456789';
export function flap(el, { delay = 0, flips = 5 } = {}) {
  if (!el || REDUCED || el.dataset.flap) return;
  const node = [...el.childNodes].find((n) => n.nodeType === 3 && /\d/.test(n.textContent));
  if (!node) return;
  el.dataset.flap = '1';
  const frag = document.createDocumentFragment();
  const cells = [];
  for (const ch of node.textContent) {
    if (/\d/.test(ch)) {
      const s = document.createElement('span');
      s.className = 'fl';
      s.textContent = ch;
      frag.append(s);
      cells.push([s, ch]);
    } else frag.append(document.createTextNode(ch));
  }
  node.replaceWith(frag);
  cells.forEach(([s, ch], i) => {
    let left = flips + i;
    const tick = () => {
      if (!s.isConnected) return;
      s.textContent = left > 0 ? DIGITS[(Math.random() * 10) | 0] : ch;
      s.classList.remove('tick');
      void s.offsetWidth;
      s.classList.add('tick');
      if (left-- > 0) setTimeout(tick, 60);
    };
    setTimeout(tick, delay + i * 40);
  });
}

/** Вставить HTML, только если он изменился: не сбрасывает анимации и фокус при опросе сервера */
export function setHtml(el, html) {
  if (!el || el._html === html) return false;
  el._html = html;
  el.innerHTML = html;
  return true;
}
