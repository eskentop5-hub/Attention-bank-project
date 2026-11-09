// ЭКОНОМИКА v2 — замкнутый контур, где каждый AB обеспечен деньгами компаний.
//
//  ₸ компании ──пополнение──► AB компании ──резерв──► кампания ──результат одобрен──► AB участника (+ комиссия платформе)
//                                                                                           │
//                     ₸ продавцу ◄──выплата── AB продавца ◄──продажа награды (− комиссия)───┘
//
// Правила:
//  1. AB создаются ТОЛЬКО пополнением бюджета компанией (1 AB = AB_TO_KZT ₸). Других способов «напечатать» баллы нет.
//  2. При обмене баллы не сгорают: продавец награды получает выручку, платформа — комиссию с продажи.
//  3. Выводить AB в деньги могут только компании-продавцы (по договору), участники — нет: для них AB остаются баллами.
//  4. Инвариант казны: Σ балансов всех счетов + Σ резервов кампаний = Σ пополнений − Σ выплат. Проверяется автоматически.
import { one, all, run, tx, platformAccountId } from '../db.js';
import { config } from '../config.js';
import { bad, int } from '../util.js';
import { postTransaction } from './ledger.js';

export const sellerFee = (cost) => Math.ceil((cost * config.economy.sellerFeePercent) / 100);
export const toKzt = (ab) => ab * config.economy.abToKzt;

/** Расчёт продажи награды: вызывается внутри транзакции обмена */
export function settleSale({ reward, redemptionId }) {
  const fee = sellerFee(reward.cost);
  const net = reward.cost - fee;
  run('UPDATE redemptions SET seller_net = ?, seller_fee = ? WHERE id = ?', net, fee, redemptionId);
  if (net > 0)
    postTransaction({ userId: reward.company_id, amount: net, type: 'reward_sale', title: `Продажа награды: ${reward.title}`, refType: 'redemption', refId: redemptionId });
  if (fee > 0)
    postTransaction({ userId: platformAccountId(), amount: fee, type: 'platform_fee', title: `Комиссия с продажи: ${reward.title}`, refType: 'redemption', refId: redemptionId });
  return { net, fee };
}

/**
 * Бонус от платформы (например, за подтверждение Telegram). Платится из доходов платформы,
 * а не печатается: если на счёте платформы не хватает, бонус не начисляется.
 */
export function platformBonus({ userId, amount, title, refType, refId }) {
  const pid = platformAccountId();
  const { balance } = one('SELECT balance FROM users WHERE id = ?', pid);
  if (balance < amount) return 0;
  postTransaction({ userId: pid, amount: -amount, type: 'bonus_paid', title: `Бонус участнику: ${title}`, refType, refId });
  postTransaction({ userId, amount, type: 'bonus', title, refType, refId });
  return amount;
}

/** Заявка продавца на вывод AB в тенге */
export function requestPayout(company, body) {
  const amount = int(body.amount, { field: 'Сумма', min: config.economy.payoutMinAb, max: 10_000_000 });
  return tx(() => {
    const { balance } = one('SELECT balance FROM users WHERE id = ?', company.id);
    if (amount > balance) throw bad(`На балансе ${balance} AB — нельзя вывести ${amount} AB`);
    const r = run(
      'INSERT INTO payouts (company_id, amount, amount_kzt, status, note) VALUES (?, ?, ?, ?, ?)',
      company.id, amount, toKzt(amount), 'requested',
      config.demoMode ? 'Демо-режим: заявка создана, деньги не переводятся' : 'Ожидает перевода по договору'
    );
    const id = Number(r.lastInsertRowid);
    const { balanceAfter } = postTransaction({ userId: company.id, amount: -amount, type: 'payout', title: `Вывод ${amount} AB → ${toKzt(amount).toLocaleString('ru-RU')} ₸`, refType: 'payout', refId: id });
    return { payout: payoutView(one('SELECT * FROM payouts WHERE id = ?', id)), balance: balanceAfter };
  });
}

const payoutView = (p) => ({ id: p.id, amount: p.amount, amountKzt: p.amount_kzt, status: p.status, note: p.note, createdAt: p.created_at });

/** Кабинет продавца: выручка с наград, разбивка по наградам и дням, выплаты */
export function sellerRevenue(companyId, days = 14) {
  const byReward = all(
    `SELECT r.id, r.title, r.cost, r.stock, COUNT(x.id) AS sold,
            COALESCE(SUM(x.cost), 0) AS gross, COALESCE(SUM(x.seller_fee), 0) AS fee, COALESCE(SUM(x.seller_net), 0) AS net
     FROM rewards r LEFT JOIN redemptions x ON x.reward_id = r.id
     WHERE r.company_id = ? GROUP BY r.id ORDER BY net DESC, r.id`,
    companyId
  );
  const sum = (k) => byReward.reduce((s, r) => s + r[k], 0);
  const since = new Date(Date.now() - (days - 1) * 864e5);
  const sales = all(
    `SELECT x.seller_net AS net, x.created_at FROM redemptions x JOIN rewards r ON r.id = x.reward_id WHERE r.company_id = ? AND x.created_at >= ?`,
    companyId, new Date(since.toISOString().slice(0, 10)).toISOString()
  );
  const series = Array.from({ length: days }, (_, i) => ({ day: new Date(since.getTime() + i * 864e5).toISOString().slice(0, 10), earned: 0, spent: 0, tasks: 0 }));
  const map = Object.fromEntries(series.map((d) => [d.day, d]));
  for (const s of sales) {
    const d = map[s.created_at.slice(0, 10)];
    if (d) (d.earned += s.net || 0), d.tasks++;
  }
  // Сколько из бюджетов кампаний вернулось этой же компании через продажи её наград («круговая» модель)
  const spentOnResults = one(
    `SELECT COALESCE(SUM(c.reward + c.fee_per_result), 0) AS v FROM assignments a JOIN campaigns c ON c.id = a.campaign_id WHERE c.company_id = ? AND a.status = 'approved'`,
    companyId
  ).v;
  return {
    sold: sum('sold'),
    gross: sum('gross'),
    fee: sum('fee'),
    net: sum('net'),
    netKzt: toKzt(sum('net')),
    returnRate: spentOnResults ? Math.round((sum('net') / spentOnResults) * 100) : null,
    byReward: byReward.map((r) => ({ ...r, netKzt: toKzt(r.net) })),
    days: series,
    payouts: all('SELECT * FROM payouts WHERE company_id = ? ORDER BY id DESC LIMIT 20', companyId).map(payoutView),
    paidOut: one("SELECT COALESCE(SUM(amount), 0) AS v FROM payouts WHERE company_id = ? AND status != 'rejected'", companyId).v,
    rules: { sellerFeePercent: config.economy.sellerFeePercent, abToKzt: config.economy.abToKzt, payoutMinAb: config.economy.payoutMinAb, demo: config.demoMode },
  };
}

/** Публичная казна: сколько AB в обороте, чем обеспечены и сходится ли баланс системы */
export function treasury() {
  const t = (type) => one('SELECT COALESCE(SUM(amount), 0) AS v FROM transactions WHERE type = ?', type).v;
  const deposits = t('deposit');
  const payouts = -t('payout');
  const balances = one('SELECT COALESCE(SUM(balance), 0) AS v FROM users').v;
  const reserved = one("SELECT COALESCE(SUM(reserved), 0) AS v FROM campaigns").v;
  const byRole = Object.fromEntries(all('SELECT role, COALESCE(SUM(balance), 0) AS v FROM users GROUP BY role').map((r) => [r.role, r.v]));
  const supply = balances + reserved;
  return {
    ok: supply === deposits - payouts,
    supply,
    backedKzt: toKzt(supply),
    abToKzt: config.economy.abToKzt,
    deposits,
    payouts,
    reserved,
    holders: { users: byRole.user || 0, companies: byRole.company || 0, platform: byRole.system || 0 },
    flows: {
      paidToUsers: t('task_reward'),
      bonuses: t('bonus'),
      spentOnRewards: -t('redemption'),
      sellerRevenue: t('reward_sale'),
      platformFees: t('platform_fee'),
    },
    rules: {
      platformFeePercent: config.economy.platformFeePercent,
      sellerFeePercent: config.economy.sellerFeePercent,
      payoutMinAb: config.economy.payoutMinAb,
    },
  };
}
