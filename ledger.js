// ЛЕДЖЕР: единственный способ изменить баланс.
// Баланс никогда не приходит с клиента. Каждое изменение = запись в transactions.
import { one, all, run, tx } from '../db.js';
import { bad } from '../util.js';

/**
 * Создаёт транзакцию и обновляет кэш баланса в одной атомарной операции.
 * amount > 0 — начисление, amount < 0 — списание.
 */
export function postTransaction({ userId, amount, type, title, refType = null, refId = null }) {
  if (!Number.isInteger(amount) || amount === 0) throw new Error('Некорректная сумма транзакции');
  return tx(() => {
    const u = one('SELECT balance FROM users WHERE id = ?', userId);
    if (!u) throw new Error('Пользователь не найден');
    const balanceAfter = u.balance + amount;
    if (balanceAfter < 0) throw bad(`Недостаточно AB Points: нужно ${-amount}, на балансе ${u.balance}`);
    run('UPDATE users SET balance = ? WHERE id = ?', balanceAfter, userId);
    const r = run(
      `INSERT INTO transactions (user_id, amount, type, title, ref_type, ref_id, balance_after)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      userId, amount, type, title, refType, refId, balanceAfter
    );
    return { id: Number(r.lastInsertRowid), balanceAfter };
  });
}

export function listTransactions(userId, limit = 100) {
  return all(
    `SELECT id, amount, type, title, status, ref_type, ref_id, balance_after, created_at
     FROM transactions WHERE user_id = ? ORDER BY id DESC LIMIT ?`,
    userId,
    limit
  );
}

// Проверка целостности: кэш баланса должен совпадать с суммой всех транзакций
export function verifyLedger(userId) {
  const { cached } = one('SELECT balance AS cached FROM users WHERE id = ?', userId);
  const { total } = one('SELECT COALESCE(SUM(amount), 0) AS total FROM transactions WHERE user_id = ?', userId);
  return { ok: cached === total, cached, computed: total };
}

export function verifyAllLedgers() {
  const rows = all(
    `SELECT u.id, u.balance, COALESCE(SUM(t.amount), 0) AS total
     FROM users u LEFT JOIN transactions t ON t.user_id = u.id GROUP BY u.id`
  );
  const broken = rows.filter((r) => r.balance !== r.total);
  return { ok: broken.length === 0, accounts: rows.length, broken };
}
