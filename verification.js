// АВТОПРОВЕРКА РЕЗУЛЬТАТА (Backend проверяет)
// 1) Жёсткая валидация — без неё ответ не принимается вообще.
// 2) Оценка качества 0–100 с флагами — помогает компании и автоодобрению.
import { all, one } from '../db.js';
import { bad } from '../util.js';

export const AUTO_APPROVE_SCORE = 70;
export const AUTO_REJECT_SCORE = 30;

export const FLAG_INFO = {
  too_fast: { label: 'Выполнено слишком быстро', penalty: 40 },
  low_effort_text: { label: 'Формальный или бессмысленный текст', penalty: 25 },
  duplicate_text: { label: 'Текст совпадает с ответом другого участника', penalty: 50 },
  straight_lining: { label: 'Все оценки одинаковые', penalty: 15 },
  unverified_account: { label: 'Аккаунт не подтверждён через Telegram', penalty: 10 },
  low_trust: { label: 'Много отклонённых ответов в истории', penalty: 15 },
  failed_attention_check: { label: 'Неверный ответ на контрольный вопрос', penalty: 45 },
  pasted_text: { label: 'Текст ответа вставлен, а не напечатан', penalty: 20 },
  typing_too_fast: { label: 'Текст набран быстрее, чем печатает человек', penalty: 20 },
  ai_style: { label: 'Похоже на сгенерированный текст (шаблонные обороты)', penalty: 25 },
  no_specifics: { label: 'В ответах нет деталей продукта — возможно, продукт не открывали', penalty: 25 },
};

const normalize = (s) => String(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

// Валидирует ответы по схеме вопросов. Возвращает очищенные ответы.
export function validateAnswers(questions, answers) {
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) throw bad('Нет ответов');
  const clean = {};
  const errors = {};
  for (const q of questions) {
    const v = answers[q.id];
    const empty = v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
    if (empty) {
      if (q.required) errors[q.id] = 'Обязательный вопрос';
      continue;
    }
    if (q.type === 'text') {
      const s = String(v).trim();
      const min = q.minLength ?? 30;
      if (s.length < min) errors[q.id] = `Минимум ${min} символов (сейчас ${s.length})`;
      else if (s.length > 3000) errors[q.id] = 'Максимум 3000 символов';
      else clean[q.id] = s;
    } else if (q.type === 'rating') {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 1 || n > 5) errors[q.id] = 'Оценка от 1 до 5';
      else clean[q.id] = n;
    } else if (q.type === 'choice') {
      if (!q.options.includes(v)) errors[q.id] = 'Выберите вариант из списка';
      else clean[q.id] = v;
    } else if (q.type === 'url') {
      // Доказательство выполнения: ссылка на скриншот, видео, профиль и т.п.
      const s = String(v).trim();
      let ok = false;
      try {
        ok = ['http:', 'https:'].includes(new URL(s).protocol) && s.length <= 500;
      } catch {}
      if (!ok) errors[q.id] = 'Нужна ссылка вида https://...';
      else clean[q.id] = s;
    }
  }
  if (Object.keys(errors).length) throw bad('Проверьте ответы', errors);
  return clean;
}

function lowEffort(text) {
  const n = normalize(text);
  const words = n.split(' ').filter(Boolean);
  if (words.length < 4) return true;
  const uniqueWords = new Set(words).size / words.length;
  const letters = n.replace(/\s/g, '');
  const uniqueChars = new Set(letters).size;
  if (uniqueWords < 0.4) return true; // «хорошо хорошо хорошо ...»
  if (uniqueChars < 8) return true; // «аааааа ббббб»
  if (/(.)\1{5,}/.test(letters)) return true; // «ооооооочень»
  return false;
}

// Шаблонные обороты, типичные для текстов нейросетей. Один-два — нормально для человека, много — сигнал.
const AI_MARKERS = [
  'в целом', 'таким образом', 'стоит отметить', 'следует отметить', 'важно отметить', 'кроме того', 'в заключение', 'подводя итог',
  'погружает', 'погружение в', 'увлекательн', 'захватывающ', 'незабываем', 'уникальн', 'игровой процесс', 'пользовательский опыт',
  'интуитивно понятн', 'общее впечатление', 'не только', 'а также', 'является', 'данн', 'overall', 'in conclusion', 'it is worth noting',
];
const AI_DISCLAIMERS = /(как (языковая|ии|искусственный)|я не могу (играть|пройти)|as an ai|i (cannot|can't) play|chatgpt|нейросет)/i;
export function aiStyleScore(text) {
  const t = String(text).toLowerCase();
  if (AI_DISCLAIMERS.test(t)) return 99;
  let n = AI_MARKERS.reduce((s, m) => s + (t.includes(m) ? 1 : 0), 0);
  if ((t.match(/—/g) || []).length >= 3) n++;
  if (/^\s*(\d\.|[-•*])\s/m.test(t) && /\n\s*(\d\.|[-•*])\s/.test(t)) n++; // оформленный список в коротком ответе
  return n;
}

/** Вычисляет оценку качества и флаги для отправленного ответа */
export function scoreSubmission({ campaign, questions, answers, startedAt, userId, assignmentId, meta = {} }) {
  const flags = [];
  const seconds = (Date.now() - new Date(startedAt).getTime()) / 1000;
  if (seconds < campaign.min_seconds) flags.push('too_fast');

  const textQs = questions.filter((q) => q.type === 'text' && answers[q.id]);
  if (textQs.some((q) => lowEffort(answers[q.id]))) flags.push('low_effort_text');

  // Сигналы набора текста (присылает интерфейс сайта; в Telegram их нет — там флаги не ставятся)
  const pasted = Array.isArray(meta?.pasted) ? meta.pasted.map(String) : [];
  const typing = meta?.typingMs && typeof meta.typingMs === 'object' ? meta.typingMs : {};
  if (textQs.some((q) => pasted.includes(q.id) && String(answers[q.id]).length >= 40)) flags.push('pasted_text');
  if (
    textQs.some((q) => {
      const len = String(answers[q.id]).length;
      const ms = Number(typing[q.id]);
      return len >= 60 && ms > 0 && len / (ms / 1000) > 15 && !pasted.includes(q.id);
    })
  )
    flags.push('typing_too_fast');

  // Признаки сгенерированного текста
  const allText = textQs.map((q) => answers[q.id]).join('\n');
  if (allText && aiStyleScore(allText) >= 4) flags.push('ai_style');

  // Детали продукта: компания задаёт слова, которые упоминает тот, кто реально прошёл продукт
  const keywords = (() => {
    try {
      return JSON.parse(campaign.keywords || '[]');
    } catch {
      return [];
    }
  })();
  if (keywords.length && allText) {
    const low = allText.toLowerCase();
    if (!keywords.some((k) => low.includes(String(k).toLowerCase()))) flags.push('no_specifics');
  }

  // Дубликаты среди ответов других участников этой кампании
  if (textQs.length) {
    const others = all(
      "SELECT answers FROM assignments WHERE campaign_id = ? AND id <> ? AND answers IS NOT NULL",
      campaign.id,
      assignmentId
    );
    const mine = new Set(textQs.map((q) => normalize(answers[q.id])));
    const dup = others.some((o) => {
      const a = JSON.parse(o.answers);
      return Object.values(a).some((v) => typeof v === 'string' && mine.has(normalize(v)));
    });
    if (dup) flags.push('duplicate_text');
  }

  // Контрольные вопросы (например, «какого цвета чапан у всадника в видео?»)
  if (questions.some((q) => q.type === 'choice' && q.correct && answers[q.id] !== undefined && answers[q.id] !== q.correct)) flags.push('failed_attention_check');

  const ratings = questions.filter((q) => q.type === 'rating').map((q) => answers[q.id]).filter(Boolean);
  if (ratings.length >= 3 && new Set(ratings).size === 1) flags.push('straight_lining');

  const user = one('SELECT telegram_verified_at FROM users WHERE id = ?', userId);
  if (!user.telegram_verified_at) flags.push('unverified_account');

  const hist = one(
    "SELECT SUM(status = 'approved') AS ok, SUM(status = 'rejected') AS rej FROM assignments WHERE user_id = ?",
    userId
  );
  if ((hist.rej || 0) >= 3 && (hist.rej || 0) > (hist.ok || 0)) flags.push('low_trust');

  const score = Math.max(0, 100 - flags.reduce((s, f) => s + FLAG_INFO[f].penalty, 0));
  return { score, flags, seconds: Math.round(seconds) };
}

// Репутация участника — видна компании
export function userTrust(userId) {
  const r = one(
    `SELECT SUM(status = 'approved') AS approved, SUM(status = 'rejected') AS rejected,
            AVG(CASE WHEN quality_rating IS NOT NULL THEN quality_rating END) AS avg_quality
     FROM assignments WHERE user_id = ?`,
    userId
  );
  const approved = r.approved || 0;
  const rejected = r.rejected || 0;
  const total = approved + rejected;
  const level = total === 0 ? 'new' : approved / total >= 0.8 && approved >= 3 ? 'trusted' : approved / total >= 0.5 ? 'regular' : 'risky';
  return { approved, rejected, avgQuality: r.avg_quality ? Math.round(r.avg_quality * 10) / 10 : null, level };
}
