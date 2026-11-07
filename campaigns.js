// ЯДРО ПРОДУКТА:
// Компания создаёт задачу → пользователь выполняет → Backend проверяет →
// начисляются AB Points → пользователь получает уведомление → компания получает результат.
import { one, all, run, tx, now, platformAccountId, onCommit } from '../db.js';
import { config } from '../config.js';
import { bad, forbidden, notFound, str, int, url, parseJson, HttpError } from '../util.js';
import { CATEGORIES, QUESTION_TYPES, categoryLabel, isCategory, cleanInterests } from '../catalog.js';
import { postTransaction } from './ledger.js';
import { notify } from './notifications.js';
import { validateAnswers, scoreSubmission, userTrust, FLAG_INFO, AUTO_APPROVE_SCORE, AUTO_REJECT_SCORE } from './verification.js';
import { postCampaignToGroup } from '../telegram/group.js';

export const feeFor = (reward) => Math.ceil((reward * config.economy.platformFeePercent) / 100);

// ---------- Создание кампании (компания) ----------

function cleanQuestions(raw) {
  if (!Array.isArray(raw) || raw.length === 0) throw bad('Добавьте хотя бы один вопрос');
  if (raw.length > 15) throw bad('Максимум 15 вопросов');
  return raw.map((q, i) => {
    const type = QUESTION_TYPES.includes(q?.type) ? q.type : null;
    if (!type) throw bad(`Вопрос ${i + 1}: неизвестный тип`);
    const out = {
      id: `q${i + 1}`,
      type,
      label: str(q.label, { field: `Вопрос ${i + 1}`, min: 3, max: 300 }),
      required: q.required !== false,
    };
    if (type === 'text') out.minLength = int(q.minLength ?? 30, { field: `Мин. длина ответа ${i + 1}`, min: 0, max: 1000 });
    if (type === 'choice') {
      const opts = (Array.isArray(q.options) ? q.options : String(q.options || '').split('\n'))
        .map((o) => String(o).trim())
        .filter(Boolean);
      if (opts.length < 2) throw bad(`Вопрос ${i + 1}: нужно минимум 2 варианта ответа`);
      out.options = [...new Set(opts)].slice(0, 10);
    }
    return out;
  });
}

export function createCampaign(company, body) {
  const title = str(body.title, { field: 'Название', min: 4, max: 120 });
  const description = str(body.description, { field: 'Описание', min: 20, max: 3000 });
  if (!isCategory(body.category)) throw bad('Выберите категорию');
  const reward = int(body.reward, { field: 'Награда', min: 5, max: 10000 });
  const maxParticipants = int(body.maxParticipants, { field: 'Количество участников', min: 1, max: 10000 });
  const minSeconds = int(body.minSeconds ?? 60, { field: 'Минимальное время', min: 0, max: 7200 });
  const questions = cleanQuestions(body.questions);
  const productUrl = url(body.productUrl, 'Ссылка на продукт');
  const audience = cleanInterests(body.audience);
  const instructions = str(body.instructions, { field: 'Что нужно сделать', max: 2000, required: false }) || null;
  const estMinutes = body.estMinutes == null || body.estMinutes === '' ? null : int(body.estMinutes, { field: 'Оценка времени', min: 1, max: 240 });
  const fee = feeFor(reward);
  const budget = (reward + fee) * maxParticipants;

  return tx(() => {
    const r = run(
      `INSERT INTO campaigns (company_id, title, description, category, product_url, audience, instructions, est_minutes,
        reward, fee_per_result, max_participants, min_seconds, auto_approve, require_telegram, questions, reserved)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      company.id, title, description, body.category, productUrl, JSON.stringify(audience), instructions, estMinutes,
      reward, fee, maxParticipants, minSeconds, body.autoApprove ? 1 : 0, body.requireTelegram ? 1 : 0, JSON.stringify(questions), budget
    );
    const id = Number(r.lastInsertRowid);
    // Бюджет резервируется сразу. Если денег не хватает — postTransaction бросит ошибку и всё откатится.
    postTransaction({
      userId: company.id,
      amount: -budget,
      type: 'campaign_reserve',
      title: `Резерв бюджета: ${title}`,
      refType: 'campaign',
      refId: id,
    });
    const campaign = one('SELECT * FROM campaigns WHERE id = ?', id);
    onCommit(() => postCampaignToGroup(campaign, company));
    return campaign;
  });
}

// ---------- Редактирование кампании (компания) ----------
// Можно менять тексты, аудиторию, условия проверки и количество мест.
// Награду менять нельзя: участники уже видели обещанную сумму, а бюджет зарезервирован под неё.
// Вопросы можно менять, только пока никто не отправил ответ.
export function updateCampaign(company, id, body) {
  return tx(() => {
    const c = one('SELECT * FROM campaigns WHERE id = ?', id);
    if (!c) throw notFound('Кампания не найдена');
    if (c.company_id !== company.id) throw forbidden();
    if (c.status === 'closed') throw bad('Закрытую кампанию изменить нельзя');
    if (body.reward !== undefined && Number(body.reward) !== c.reward)
      throw bad('Награду после публикации изменить нельзя — участники уже видели эту сумму');

    const title = str(body.title ?? c.title, { field: 'Название', min: 4, max: 120 });
    const description = str(body.description ?? c.description, { field: 'Описание', min: 20, max: 3000 });
    const instructions = body.instructions !== undefined ? str(body.instructions, { field: 'Что нужно сделать', max: 2000, required: false }) || null : c.instructions;
    const estMinutes =
      body.estMinutes !== undefined
        ? body.estMinutes === null || body.estMinutes === ''
          ? null
          : int(body.estMinutes, { field: 'Оценка времени', min: 1, max: 240 })
        : c.est_minutes;
    const productUrl = body.productUrl !== undefined ? url(body.productUrl, 'Ссылка на продукт') : c.product_url;
    const audience = body.audience !== undefined ? cleanInterests(body.audience) : parseJson(c.audience, []);
    const minSeconds = body.minSeconds !== undefined ? int(body.minSeconds, { field: 'Минимальное время', min: 0, max: 7200 }) : c.min_seconds;
    const autoApprove = body.autoApprove !== undefined ? (body.autoApprove ? 1 : 0) : c.auto_approve;
    const requireTelegram = body.requireTelegram !== undefined ? (body.requireTelegram ? 1 : 0) : c.require_telegram;

    let questions = c.questions;
    if (body.questions !== undefined) {
      const answered = one('SELECT COUNT(*) AS n FROM assignments WHERE campaign_id = ? AND submitted_at IS NOT NULL', id).n;
      const next = JSON.stringify(cleanQuestions(body.questions));
      if (answered > 0 && next !== c.questions) throw bad('Вопросы нельзя менять: участники уже отправили ответы');
      questions = next;
    }

    // Количество мест: увеличение резервирует бюджет, уменьшение возвращает неиспользованный
    let reserved = c.reserved;
    if (body.maxParticipants !== undefined) {
      const next = int(body.maxParticipants, { field: 'Количество участников', min: 1, max: 10000 });
      const taken = slotsTaken(id);
      if (next < taken) throw bad(`Нельзя меньше ${taken}: столько результатов уже отправлено или одобрено`);
      const delta = next - c.max_participants;
      const cost = c.reward + c.fee_per_result;
      if (delta > 0) {
        postTransaction({ userId: company.id, amount: -delta * cost, type: 'campaign_reserve', title: `Дополнительный резерв: ${title}`, refType: 'campaign', refId: id });
        reserved += delta * cost;
      } else if (delta < 0) {
        const refund = -delta * cost;
        if (refund > reserved) throw bad('Недостаточно резерва для уменьшения мест');
        postTransaction({ userId: company.id, amount: refund, type: 'campaign_refund', title: `Возврат за уменьшение мест: ${title}`, refType: 'campaign', refId: id });
        reserved -= refund;
      }
      run('UPDATE campaigns SET max_participants = ? WHERE id = ?', next, id);
    }

    run(
      `UPDATE campaigns SET title = ?, description = ?, instructions = ?, est_minutes = ?, product_url = ?, audience = ?,
         min_seconds = ?, auto_approve = ?, require_telegram = ?, questions = ?, reserved = ? WHERE id = ?`,
      title, description, instructions, estMinutes, productUrl, JSON.stringify(audience), minSeconds, autoApprove, requireTelegram, questions, reserved, id
    );
    return one('SELECT * FROM campaigns WHERE id = ?', id);
  });
}

// ---------- Представления ----------

const slotsTaken = (campaignId) =>
  one("SELECT COUNT(*) AS n FROM assignments WHERE campaign_id = ? AND status IN ('submitted','approved')", campaignId).n;

export function campaignPublic(c, userId = null) {
  const taken = slotsTaken(c.id);
  const company = one('SELECT company_name, name, is_demo FROM users WHERE id = ?', c.company_id);
  const mine = userId ? one('SELECT * FROM assignments WHERE campaign_id = ? AND user_id = ?', c.id, userId) : null;
  return {
    id: c.id,
    title: c.title,
    description: c.description,
    category: c.category,
    categoryLabel: categoryLabel(c.category),
    productUrl: c.product_url,
    instructions: c.instructions,
    estMinutes: c.est_minutes,
    audience: parseJson(c.audience, []),
    reward: c.reward,
    maxParticipants: c.max_participants,
    slotsLeft: Math.max(0, c.max_participants - taken),
    minSeconds: c.min_seconds,
    autoApprove: !!c.auto_approve,
    requireTelegram: !!c.require_telegram,
    status: c.status,
    company: company?.company_name || company?.name,
    companyDemo: !!company?.is_demo,
    questions: parseJson(c.questions, []),
    createdAt: c.created_at,
    my: mine ? assignmentView(mine) : null,
  };
}

function assignmentView(a) {
  return {
    id: a.id,
    status: a.status,
    startedAt: a.started_at,
    submittedAt: a.submitted_at,
    answers: parseJson(a.answers, null),
    autoScore: a.auto_score,
    flags: parseJson(a.auto_flags, []).map((f) => ({ id: f, label: FLAG_INFO[f]?.label || f })),
    qualityRating: a.quality_rating,
    reviewNote: a.review_note,
    reviewedBy: a.reviewed_by,
    reviewedAt: a.reviewed_at,
  };
}

// ---------- Пользователь ----------

export function listTasksForUser(user) {
  const interests = parseJson(user.interests, []);
  const rows = all("SELECT * FROM campaigns WHERE status = 'active' ORDER BY id DESC");
  return rows
    .map((c) => {
      const v = campaignPublic(c, user.id);
      const aud = v.audience;
      v.matches = aud.length === 0 || aud.some((i) => interests.includes(i));
      v.matchScore = aud.filter((i) => interests.includes(i)).length;
      delete v.questions;
      return v;
    })
    .filter((v) => v.my || v.slotsLeft > 0)
    .sort((a, b) => Number(!!a.my) - Number(!!b.my) || b.matchScore - a.matchScore || b.reward - a.reward);
}

export function getTaskForUser(user, id) {
  const c = one('SELECT * FROM campaigns WHERE id = ?', id);
  if (!c) throw notFound('Задание не найдено');
  const mine = one('SELECT id FROM assignments WHERE campaign_id = ? AND user_id = ?', id, user.id);
  if (c.status !== 'active' && !mine) throw notFound('Задание больше не доступно');
  return campaignPublic(c, user.id);
}

export function startTask(user, id) {
  return tx(() => {
    const c = one('SELECT * FROM campaigns WHERE id = ?', id);
    if (!c || c.status !== 'active') throw bad('Задание сейчас недоступно');
    if (c.require_telegram && !user.telegram_verified_at)
      throw bad('Для этого задания нужно подтвердить аккаунт через Telegram (Профиль → Telegram)');
    const existing = one('SELECT * FROM assignments WHERE campaign_id = ? AND user_id = ?', id, user.id);
    if (existing) return campaignPublic(c, user.id);
    if (slotsTaken(id) >= c.max_participants) throw bad('Все места в этом задании уже заняты');
    run("INSERT INTO assignments (campaign_id, user_id, status, started_at) VALUES (?, ?, 'started', ?)", id, user.id, now());
    return campaignPublic(c, user.id);
  });
}

export function submitTask(user, id, rawAnswers) {
  const result = tx(() => {
    const c = one('SELECT * FROM campaigns WHERE id = ?', id);
    if (!c || c.status !== 'active') throw bad('Задание сейчас недоступно');
    const a = one('SELECT * FROM assignments WHERE campaign_id = ? AND user_id = ?', id, user.id);
    if (!a) throw bad('Сначала нажмите «Начать задание»');
    if (a.status !== 'started') throw bad('Вы уже отправили ответ на это задание');
    if (slotsTaken(id) >= c.max_participants) throw bad('Все места в этом задании уже заняты');

    const today = one(
      "SELECT COUNT(*) AS n FROM assignments WHERE user_id = ? AND submitted_at >= ?",
      user.id,
      new Date(Date.now() - 864e5).toISOString()
    ).n;
    if (today >= config.economy.dailySubmissionLimit)
      throw new HttpError(429, `Лимит: не больше ${config.economy.dailySubmissionLimit} заданий за 24 часа`);

    const questions = parseJson(c.questions, []);
    const answers = validateAnswers(questions, rawAnswers);
    const { score, flags } = scoreSubmission({ campaign: c, questions, answers, startedAt: a.started_at, userId: user.id, assignmentId: a.id });

    run(
      "UPDATE assignments SET status = 'submitted', submitted_at = ?, answers = ?, auto_score = ?, auto_flags = ? WHERE id = ?",
      now(), JSON.stringify(answers), score, JSON.stringify(flags), a.id
    );

    let outcome = 'pending';
    if (score < AUTO_REJECT_SCORE) {
      decide(a.id, c, 'reject', { note: 'Автоматическая проверка: ' + flags.map((f) => FLAG_INFO[f].label.toLowerCase()).join(', '), by: 'auto' });
      outcome = 'rejected';
    } else if (c.auto_approve && score >= AUTO_APPROVE_SCORE) {
      decide(a.id, c, 'approve', { by: 'auto' });
      outcome = 'approved';
    } else {
      notify(c.company_id, {
        kind: 'review',
        title: 'Новый результат на проверку',
        body: `«${c.title}»: участник отправил ответ (качество ${score}/100).`,
        link: `/#/company/campaigns/${c.id}`,
        telegram: `📥 <b>Новый результат на проверку</b>\n«${c.title}» — качество ${score}/100`,
      });
    }
    return { outcome, score, flags };
  });
  return { ...result, task: getTaskForUser(one('SELECT * FROM users WHERE id = ?', user.id), id) };
}

export function mySubmissions(userId) {
  return all(
    `SELECT a.*, c.title, c.reward, c.category FROM assignments a JOIN campaigns c ON c.id = a.campaign_id
     WHERE a.user_id = ? ORDER BY COALESCE(a.submitted_at, a.started_at) DESC`,
    userId
  ).map((r) => ({ ...assignmentView(r), campaignId: r.campaign_id, title: r.title, reward: r.reward, categoryLabel: categoryLabel(r.category) }));
}

// ---------- Проверка компанией ----------

/** Одобрение/отклонение. Только здесь пользователю начисляются AB за задания. */
function decide(assignmentId, c, decision, { rating = null, note = null, by = 'company' } = {}) {
  const a = one('SELECT * FROM assignments WHERE id = ?', assignmentId);
  if (a.status !== 'submitted') throw bad('Этот результат уже проверен');

  if (decision === 'approve') {
    run(
      "UPDATE assignments SET status = 'approved', quality_rating = ?, review_note = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?",
      rating, note, by, now(), a.id
    );
    const cost = c.reward + c.fee_per_result;
    const upd = run('UPDATE campaigns SET reserved = reserved - ? WHERE id = ? AND reserved >= ?', cost, c.id, cost);
    if (upd.changes !== 1) throw bad('В резерве кампании недостаточно бюджета');
    const { balanceAfter } = postTransaction({
      userId: a.user_id,
      amount: c.reward,
      type: 'task_reward',
      title: `${categoryLabel(c.category)}: ${c.title}`,
      refType: 'assignment',
      refId: a.id,
    });
    if (c.fee_per_result > 0)
      postTransaction({ userId: platformAccountId(), amount: c.fee_per_result, type: 'platform_fee', title: `Комиссия: ${c.title}`, refType: 'assignment', refId: a.id });
    notify(a.user_id, {
      kind: 'reward',
      title: `+${c.reward} AB Points`,
      body: `Задание «${c.title}» одобрено. Новый баланс: ${balanceAfter} AB`,
      link: '/#/wallet',
      telegram: `🎉 <b>+${c.reward} AB Points</b>\nYour task was approved.\n«${c.title}»\nNew balance: <b>${balanceAfter} AB</b>`,
    });
  } else {
    run(
      "UPDATE assignments SET status = 'rejected', quality_rating = ?, review_note = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?",
      rating, note, by, now(), a.id
    );
    notify(a.user_id, {
      kind: 'rejected',
      title: 'Ответ не принят',
      body: `«${c.title}»${note ? ': ' + note : ''}`,
      link: `/#/tasks/${c.id}`,
      telegram: `❌ <b>Ответ не принят</b>\n«${c.title}»${note ? '\nПричина: ' + note : ''}`,
    });
  }
}

export function reviewSubmission(company, assignmentId, body) {
  const decision = body.decision;
  if (!['approve', 'reject'].includes(decision)) throw bad('Решение: approve или reject');
  const rating = body.rating == null || body.rating === '' ? null : int(body.rating, { field: 'Оценка качества', min: 1, max: 5 });
  const note = str(body.note, { field: 'Комментарий', max: 500, required: decision === 'reject' });
  return tx(() => {
    const a = one('SELECT * FROM assignments WHERE id = ?', assignmentId);
    if (!a) throw notFound('Результат не найден');
    const c = one('SELECT * FROM campaigns WHERE id = ?', a.campaign_id);
    if (c.company_id !== company.id) throw forbidden();
    decide(a.id, c, decision, { rating, note: note || null, by: 'company' });
    return { ok: true };
  });
}

export function setCampaignStatus(company, id, status) {
  if (!['active', 'paused', 'closed'].includes(status)) throw bad('Неизвестный статус');
  return tx(() => {
    const c = one('SELECT * FROM campaigns WHERE id = ?', id);
    if (!c) throw notFound();
    if (c.company_id !== company.id) throw forbidden();
    if (c.status === 'closed') throw bad('Кампания уже закрыта');
    if (status === 'closed') {
      const pending = one("SELECT COUNT(*) AS n FROM assignments WHERE campaign_id = ? AND status = 'submitted'", id).n;
      if (pending > 0) throw bad(`Сначала проверьте ${pending} результат(а) в очереди`);
      if (c.reserved > 0)
        postTransaction({ userId: company.id, amount: c.reserved, type: 'campaign_refund', title: `Возврат неиспользованного бюджета: ${c.title}`, refType: 'campaign', refId: c.id });
      run("UPDATE campaigns SET status = 'closed', reserved = 0, closed_at = ? WHERE id = ?", now(), id);
    } else {
      run('UPDATE campaigns SET status = ? WHERE id = ?', status, id);
    }
    return one('SELECT * FROM campaigns WHERE id = ?', id);
  });
}

// ---------- Кабинет компании ----------

function campaignStats(c) {
  const s = one(
    `SELECT COUNT(*) AS opened, SUM(status='started') AS started, SUM(status='submitted') AS pending,
            SUM(status='approved') AS approved, SUM(status='rejected') AS rejected,
            AVG(CASE WHEN status IN ('submitted','approved','rejected') THEN auto_score END) AS avg_score,
            AVG(CASE WHEN status = 'approved' THEN quality_rating END) AS avg_rating,
            AVG(CASE WHEN submitted_at IS NOT NULL THEN (julianday(submitted_at) - julianday(started_at)) * 1440 END) AS avg_minutes
     FROM assignments WHERE campaign_id = ?`,
    c.id
  );
  const approved = s.approved || 0;
  const rejected = s.rejected || 0;
  const submitted = approved + rejected + (s.pending || 0);
  const opened = s.opened || 0;
  return {
    // Воронка: открыли задание → отправили результат → результат подтверждён
    opened,
    started: s.started || 0,
    submitted,
    pending: s.pending || 0,
    approved,
    rejected,
    completionRate: opened ? Math.round((submitted / opened) * 100) : null,
    approvalRate: approved + rejected ? Math.round((approved / (approved + rejected)) * 100) : null,
    avgScore: s.avg_score ? Math.round(s.avg_score) : null,
    avgRating: s.avg_rating ? Math.round(s.avg_rating * 10) / 10 : null,
    avgMinutes: s.avg_minutes ? Math.round(s.avg_minutes * 10) / 10 : null,
    costPerResult: c.reward + c.fee_per_result,
    spent: approved * (c.reward + c.fee_per_result),
    budget: c.max_participants * (c.reward + c.fee_per_result),
    reserved: c.reserved,
  };
}

export function companyOverview(company) {
  const campaigns = all('SELECT * FROM campaigns WHERE company_id = ? ORDER BY id DESC', company.id).map((c) => ({
    ...campaignPublic(c),
    feePerResult: c.fee_per_result,
    stats: campaignStats(c),
  }));
  const totals = campaigns.reduce(
    (t, c) => ({
      results: t.results + c.stats.approved,
      rejected: t.rejected + c.stats.rejected,
      submitted: t.submitted + c.stats.submitted,
      opened: t.opened + c.stats.opened,
      pending: t.pending + c.stats.pending,
      spent: t.spent + c.stats.spent,
      reserved: t.reserved + c.stats.reserved,
      active: t.active + (c.status === 'active' ? 1 : 0),
    }),
    { results: 0, rejected: 0, submitted: 0, opened: 0, pending: 0, spent: 0, reserved: 0, active: 0 }
  );
  totals.approvalRate = totals.results + totals.rejected ? Math.round((totals.results / (totals.results + totals.rejected)) * 100) : null;
  totals.avgCostPerResult = totals.results ? Math.round(totals.spent / totals.results) : null;
  const pendingQueue = all(
    `SELECT a.id, a.campaign_id, a.auto_score, a.submitted_at, c.title, u.name FROM assignments a
     JOIN campaigns c ON c.id = a.campaign_id JOIN users u ON u.id = a.user_id
     WHERE c.company_id = ? AND a.status = 'submitted' ORDER BY a.submitted_at ASC LIMIT 5`,
    company.id
  ).map((r) => ({ id: r.id, campaignId: r.campaign_id, title: r.title, participant: r.name, score: r.auto_score, submittedAt: r.submitted_at }));
  return { campaigns, totals, pendingQueue };
}

function aggregate(questions, rows) {
  return questions.map((q) => {
    const vals = rows.map((r) => r.answers?.[q.id]).filter((v) => v !== undefined && v !== null);
    if (q.type === 'rating') {
      const dist = [1, 2, 3, 4, 5].map((n) => vals.filter((v) => v === n).length);
      const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
      return { ...q, count: vals.length, avg: avg ? Math.round(avg * 10) / 10 : null, dist };
    }
    if (q.type === 'choice') {
      return { ...q, count: vals.length, dist: q.options.map((o) => ({ option: o, n: vals.filter((v) => v === o).length })) };
    }
    return { ...q, count: vals.length, samples: vals.slice(0, 50) };
  });
}

export function companyCampaign(company, id) {
  const c = one('SELECT * FROM campaigns WHERE id = ?', id);
  if (!c) throw notFound();
  if (c.company_id !== company.id) throw forbidden();
  const questions = parseJson(c.questions, []);
  const subs = all(
    `SELECT a.*, u.name AS user_name, u.telegram_verified_at FROM assignments a JOIN users u ON u.id = a.user_id
     WHERE a.campaign_id = ? AND a.status <> 'started'
     ORDER BY CASE a.status WHEN 'submitted' THEN 0 ELSE 1 END, a.submitted_at DESC`,
    id
  ).map((r) => ({
    ...assignmentView(r),
    participant: { name: r.user_name, verified: !!r.telegram_verified_at, trust: userTrust(r.user_id) },
  }));
  const approvedRows = subs.filter((s) => s.status === 'approved');
  const hasAnswers = one('SELECT COUNT(*) AS n FROM assignments WHERE campaign_id = ? AND submitted_at IS NOT NULL', id).n > 0;
  return {
    campaign: { ...campaignPublic(c), feePerResult: c.fee_per_result, stats: campaignStats(c), hasAnswers },
    submissions: subs,
    results: aggregate(questions, approvedRows),
  };
}

export function exportCsv(company, id) {
  const { campaign, submissions } = companyCampaign(company, id);
  const qs = campaign.questions;
  const esc = (v) => {
    let s = v === null || v === undefined ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // защита от CSV-инъекций в Excel
    return `"${s.replace(/"/g, '""')}"`;
  };
  const head = ['submission_id', 'status', 'submitted_at', 'auto_score', 'quality_rating', 'telegram_verified', ...qs.map((q) => q.label)];
  const lines = [head.map(esc).join(',')];
  for (const s of submissions) {
    lines.push(
      [s.id, s.status, s.submittedAt, s.autoScore, s.qualityRating, s.participant.verified ? 'yes' : 'no', ...qs.map((q) => s.answers?.[q.id])]
        .map(esc)
        .join(',')
    );
  }
  return '﻿' + lines.join('\r\n');
}

export const meta = () => ({ categories: CATEGORIES });
