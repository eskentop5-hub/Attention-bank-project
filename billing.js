// ДЕНЬГИ В НАСТОЯЩЕМ РЕЖИМЕ — без выдуманных платёжных интеграций:
//  • Пополнение: студия создаёт заявку и получает счёт → платит по реквизитам → администратор подтверждает
//    поступление → только тогда начисляются AB (1 AB = AB_TO_KZT ₸). До подтверждения баллов нет.
//  • Вывод: продавец создаёт заявку (AB списываются сразу) → администратор переводит деньги и отмечает
//    «выплачено» либо отклоняет — тогда AB возвращаются продавцу.
// В демо-песочнице пополнение происходит сразу и помечается как демо.
import { one, all, run, tx, now, isDemo } from '../db.js';
import { config } from '../config.js';
import { bad, notFound, int, str } from '../util.js';
import { postTransaction } from './ledger.js';
import { notify } from './notifications.js';
import { adminLog } from './ops.js';

const toKzt = (ab) => ab * config.economy.abToKzt;
const fmt = (n) => Number(n).toLocaleString('ru-RU');
const escHtml = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
const invoiceNo = (id) => `AB-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${String(id).padStart(5, '0')}`;

export const topupView = (t) => ({
  id: t.id,
  amount: t.amount,
  amountKzt: t.amount_kzt,
  invoiceNo: t.invoice_no,
  status: t.status,
  companyNote: t.company_note,
  adminNote: t.admin_note,
  createdAt: t.created_at,
  decidedAt: t.decided_at,
  ...(t.company_name !== undefined ? { company: t.company_name, companyId: t.company_id, email: t.email } : {}),
});

export const billingInfo = () => ({
  demo: isDemo(),
  abToKzt: config.economy.abToKzt,
  minAb: config.billing.minAb,
  details: config.billing.details || null,
  contact: config.billing.contact || null,
});

/** Студия создаёт заявку на пополнение (в демо — пополнение сразу) */
export function createTopup(company, body, { pilot = false, silent = false } = {}) {
  const amount = int(body.amount, { field: 'Сумма', min: config.billing.minAb, max: 1_000_000 });
  const note = str(body.note, { field: pilot ? 'О проекте' : 'Комментарий', max: 300, required: false }) || null;
  return tx(() => {
    if (pilot && one("SELECT id FROM topups WHERE company_id = ? AND status = 'requested' AND invoice_no LIKE 'PILOT-%'", company.id)) throw bad('Заявка на пилот уже отправлена — дождитесь решения');
    const r = run('INSERT INTO topups (company_id, amount, amount_kzt, invoice_no, company_note) VALUES (?, ?, ?, ?, ?)', company.id, amount, toKzt(amount), 'pending', note);
    const id = Number(r.lastInsertRowid);
    const no = pilot ? invoiceNo(id).replace(/^AB-/, 'PILOT-') : invoiceNo(id);
    run('UPDATE topups SET invoice_no = ? WHERE id = ?', no, id);
    if (silent) return topupView(one('SELECT * FROM topups WHERE id = ?', id));
    if (isDemo()) {
      postTransaction({ userId: company.id, amount, type: 'deposit', title: 'Пополнение бюджета (демо, без оплаты)', refType: 'topup', refId: id });
      run("UPDATE topups SET status = 'paid', decided_at = ?, admin_note = 'Демо: зачислено сразу, деньги не переводились' WHERE id = ?", now(), id);
    } else {
      notifyAdmins({
        title: pilot ? 'Заявка на пилотный бюджет' : 'Новая заявка на пополнение',
        body: `${company.company_name || company.name}: ${fmt(amount)} AB (${fmt(toKzt(amount))} ₸), ${no}${note ? ` — ${note}` : ''}`,
        link: '/#/admin/money',
      });
    }
    return topupView(one('SELECT * FROM topups WHERE id = ?', id));
  });
}

export function companyTopups(companyId) {
  return all('SELECT * FROM topups WHERE company_id = ? ORDER BY id DESC LIMIT 50', companyId).map(topupView);
}

export function cancelTopup(company, id) {
  const t = one('SELECT * FROM topups WHERE id = ? AND company_id = ?', id, company.id);
  if (!t) throw notFound('Заявка не найдена');
  if (t.status !== 'requested') throw bad('Эту заявку уже нельзя отменить');
  run("UPDATE topups SET status = 'cancelled', decided_at = ? WHERE id = ?", now(), id);
  return topupView(one('SELECT * FROM topups WHERE id = ?', id));
}

/** Администратор сам выдаёт студии пилотный бюджет (без оплаты, с пометкой в журнале) */
export function grantPilot(admin, companyId, body) {
  const c = one("SELECT * FROM users WHERE id = ? AND role = 'company' AND deleted_at IS NULL", companyId);
  if (!c) throw notFound('Студия не найдена');
  return tx(() => {
    const t = createTopup(c, body, { pilot: true, silent: true });
    return approveTopup(admin, t.id, str(body.note, { field: 'Комментарий', max: 300, required: false }) || 'Выдано администратором');
  });
}

// ---------- Администратор ----------

export function listTopups(status = null) {
  const where = status ? 'WHERE t.status = ?' : '';
  return all(
    `SELECT t.*, u.company_name, u.email FROM topups t JOIN users u ON u.id = t.company_id ${where} ORDER BY t.status = 'requested' DESC, t.id DESC LIMIT 200`,
    ...(status ? [status] : [])
  ).map(topupView);
}

/** Деньги пришли на счёт → начисляем AB. Повторное подтверждение невозможно. */
export function approveTopup(admin, id, note = null) {
  return tx(() => {
    const t = one('SELECT * FROM topups WHERE id = ?', id);
    if (!t) throw notFound('Заявка не найдена');
    if (t.status !== 'requested') throw bad('Заявка уже обработана');
    const upd = run("UPDATE topups SET status = 'paid', decided_at = ?, admin_note = ? WHERE id = ? AND status = 'requested'", now(), note, id);
    if (upd.changes !== 1) throw bad('Заявка уже обработана');
    const pilot = t.invoice_no.startsWith('PILOT-');
    const { balanceAfter } = postTransaction({ userId: t.company_id, amount: t.amount, type: 'deposit', title: pilot ? `Пилотный бюджет от платформы, без оплаты (${t.invoice_no})` : `Пополнение по счёту ${t.invoice_no}`, refType: 'topup', refId: id });
    adminLog(admin.id, 'topup_paid', `topup:${id}`, `${t.amount} AB / ${t.amount_kzt} ₸`);
    notify(t.company_id, {
      kind: 'reward',
      title: `Бюджет пополнен: +${fmt(t.amount)} AB`,
      body: pilot ? `Платформа выдала пилотный бюджет (${t.invoice_no}). Баланс: ${fmt(balanceAfter)} AB` : `Оплата по счёту ${t.invoice_no} получена. Баланс: ${fmt(balanceAfter)} AB`,
      link: '/#/budget',
      telegram: `💳 <b>Бюджет пополнен: +${fmt(t.amount)} AB</b>\nСчёт ${t.invoice_no}\nБаланс: <b>${fmt(balanceAfter)} AB</b>`,
    });
    return topupView(one('SELECT * FROM topups WHERE id = ?', id));
  });
}

export function rejectTopup(admin, id, note) {
  const reason = str(note, { field: 'Причина', min: 3, max: 300 });
  return tx(() => {
    const t = one('SELECT * FROM topups WHERE id = ?', id);
    if (!t) throw notFound('Заявка не найдена');
    if (t.status !== 'requested') throw bad('Заявка уже обработана');
    run("UPDATE topups SET status = 'rejected', decided_at = ?, admin_note = ? WHERE id = ?", now(), reason, id);
    adminLog(admin.id, 'topup_rejected', `topup:${id}`, reason);
    notify(t.company_id, { kind: 'info', title: 'Заявка на пополнение отклонена', body: `Счёт ${t.invoice_no}: ${reason}`, link: '/#/budget' });
    return topupView(one('SELECT * FROM topups WHERE id = ?', id));
  });
}

const payoutView = (p) => ({
  id: p.id,
  amount: p.amount,
  amountKzt: p.amount_kzt,
  status: p.status,
  note: p.note,
  adminNote: p.admin_note,
  createdAt: p.created_at,
  decidedAt: p.decided_at,
  company: p.company_name,
  email: p.email,
});

export function listPayouts(status = null) {
  const where = status ? 'WHERE p.status = ?' : '';
  return all(
    `SELECT p.*, u.company_name, u.email FROM payouts p JOIN users u ON u.id = p.company_id ${where} ORDER BY p.status = 'requested' DESC, p.id DESC LIMIT 200`,
    ...(status ? [status] : [])
  ).map(payoutView);
}

export function markPayoutPaid(admin, id, note = null) {
  return tx(() => {
    const p = one('SELECT * FROM payouts WHERE id = ?', id);
    if (!p) throw notFound('Заявка не найдена');
    if (p.status !== 'requested') throw bad('Заявка уже обработана');
    run("UPDATE payouts SET status = 'paid', decided_at = ?, admin_note = ? WHERE id = ?", now(), note, id);
    adminLog(admin.id, 'payout_paid', `payout:${id}`, `${p.amount} AB / ${p.amount_kzt} ₸`);
    notify(p.company_id, { kind: 'reward', title: `Выплата отправлена: ${fmt(p.amount_kzt)} ₸`, body: note || 'Деньги переведены по реквизитам из договора.', link: '/#/company/revenue' });
    return payoutView(one('SELECT * FROM payouts WHERE id = ?', id));
  });
}

/** Отклонение: AB возвращаются продавцу той же категорией транзакции, поэтому инвариант казны сохраняется */
export function rejectPayout(admin, id, note) {
  const reason = str(note, { field: 'Причина', min: 3, max: 300 });
  return tx(() => {
    const p = one('SELECT * FROM payouts WHERE id = ?', id);
    if (!p) throw notFound('Заявка не найдена');
    if (p.status !== 'requested') throw bad('Заявка уже обработана');
    run("UPDATE payouts SET status = 'rejected', decided_at = ?, admin_note = ? WHERE id = ?", now(), reason, id);
    postTransaction({ userId: p.company_id, amount: p.amount, type: 'payout', title: `Возврат: заявка на вывод №${id} отклонена`, refType: 'payout', refId: id });
    adminLog(admin.id, 'payout_rejected', `payout:${id}`, reason);
    notify(p.company_id, { kind: 'info', title: 'Заявка на вывод отклонена', body: `${reason}. ${fmt(p.amount)} AB вернулись на баланс.`, link: '/#/company/revenue' });
    return payoutView(one('SELECT * FROM payouts WHERE id = ?', id));
  });
}

/** Уведомить всех администраторов (в интерфейсе и в Telegram, если привязан) */
export function notifyAdmins({ title, body, link }) {
  for (const a of all('SELECT id FROM users WHERE is_admin = 1 AND blocked_at IS NULL'))
    notify(a.id, { kind: 'info', title, body, link, telegram: `🛎 <b>${escHtml(title)}</b>\n${escHtml(body)}` });
}
