// Видео-тест: честный подсчёт просмотра по video.played (уникальные проигранные отрезки),
// перемотки вперёд и паузы. Ничего не отправляется на сервер — итог копирует сам участник.
const VIDEOS = {
  steppe: {
    title: 'Steppe Runner — трейлер (45 сек)',
    sub: 'Nomad Pixel Studio · демо-студия. Трейлер записан из настоящего игрового движка.',
    src: 'steppe-runner-trailer.mp4',
    vertical: false,
  },
  qadam: {
    title: 'Qadam — рекламный ролик (31 сек)',
    sub: 'Qadam Apps · демо-компания. Вертикальный ролик для соцсетей, снят с живого прототипа.',
    src: 'qadam-promo.mp4',
    vertical: true,
  },
};
const $ = (id) => document.getElementById(id);
const key = new URLSearchParams(location.search).get('v') in VIDEOS ? new URLSearchParams(location.search).get('v') : 'steppe';
const meta = VIDEOS[key];
const v = $('v');

$('tabs').innerHTML = Object.entries(VIDEOS).map(([k, x]) => `<a href="?v=${k}" ${k === key ? 'aria-current="page"' : ''}>${x.title.split(' — ')[0]}</a>`).join('');
$('title').textContent = meta.title;
$('sub').textContent = meta.sub;
document.title = `${meta.title} — видео-тест`;
$('frame').classList.toggle('vertical', meta.vertical);
v.src = meta.src;

let seeks = 0, pauses = 0, lastT = 0, ended = false, maxRate = 1;
v.addEventListener('timeupdate', () => {
  if (!v.seeking) lastT = v.currentTime;
});
v.addEventListener('seeking', () => {
  if (v.currentTime > lastT + 1.5) seeks++;
});
v.addEventListener('pause', () => {
  if (!v.ended && v.currentTime > 0.2) pauses++;
});
v.addEventListener('ended', () => (ended = true));
v.addEventListener('ratechange', () => (maxRate = Math.max(maxRate, v.playbackRate)));

function watched() {
  if (!v.duration || !isFinite(v.duration)) return 0;
  let s = 0;
  for (let i = 0; i < v.played.length; i++) s += v.played.end(i) - v.played.start(i);
  return Math.min(100, Math.round((s / v.duration) * 100));
}
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
function render() {
  const p = watched();
  $('pct').textContent = `${p}%`;
  $('bar').style.width = `${p}%`;
  $('seeks').textContent = seeks;
  $('pauses').textContent = pauses;
  $('rate').textContent = `${v.playbackRate}×`;
  $('state').innerHTML = p >= 95 ? '<span class="ok">✓ Ролик просмотрен полностью</span>' : v.paused ? (v.currentTime ? 'Пауза' : 'Нажмите ▶, чтобы начать') : `Идёт просмотр · ${fmt(v.currentTime)}`;
  const text = [`${meta.title}: просмотрено ${p}%${ended ? ', досмотрено до конца' : ''}`, `Перемоток вперёд: ${seeks} · пауз: ${pauses}${maxRate > 1 ? ` · ускорение до ${maxRate}×` : ''}`].join('\n');
  if ($('report').value !== text) $('report').value = text;
}
setInterval(render, 400);
render();

$('copy').onclick = async () => {
  try {
    await navigator.clipboard.writeText($('report').value);
    $('copy').textContent = 'Скопировано ✓';
  } catch {
    $('report').select();
    $('copy').textContent = 'Выделено — Ctrl+C';
  }
  setTimeout(() => ($('copy').textContent = 'Скопировать'), 2000);
};
