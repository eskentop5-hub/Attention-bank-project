import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// В собранной версии (attention-bank-v2.mjs) файл лежит в корне проекта, в исходниках — в server/
export const BUNDLED = process.env.AB_BUNDLED === '1';
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), BUNDLED ? '.' : '..');

// Мини-загрузчик .env (без зависимостей)
function loadEnv() {
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}
loadEnv();

const env = (k, d) => (process.env[k] !== undefined && process.env[k] !== '' ? process.env[k] : d);
const num = (k, d) => {
  const n = Number(env(k, d));
  return Number.isFinite(n) ? n : d;
};

export const config = {
  port: num('PORT', 3000),
  publicUrl: String(env('PUBLIC_URL', 'http://localhost:3000')).replace(/\/$/, ''),
  dbPath: path.resolve(ROOT, env('DB_PATH', './data/attention-bank.db')),
  // Демо-режим: демо-данные, пополнение бюджета без оплаты, пометки «демо» в интерфейсе.
  // В продакшене поставьте DEMO_MODE=0 — пополнение без платёжного шлюза будет отключено.
  demoMode: env('DEMO_MODE', '1') === '1',
  seedDemo: env('SEED_DEMO', '1') === '1',
  telegram: {
    token: env('TELEGRAM_BOT_TOKEN', ''),
    username: String(env('TELEGRAM_BOT_USERNAME', '')).replace(/^@/, ''),
    groupId: env('TELEGRAM_GROUP_ID', ''),
    mode: env('TELEGRAM_MODE', 'polling'),
    webhookSecret: env('TELEGRAM_WEBHOOK_SECRET', 'change-me'),
    // Час ежедневного напоминания о серии (по часовому поясу TZ_OFFSET_MIN)
    reminderHour: num('REMINDER_HOUR', 19),
    verifyBonus: num('TELEGRAM_VERIFY_BONUS', 10),
  },
  economy: {
    platformFeePercent: num('PLATFORM_FEE_PERCENT', 20),
    abToKzt: num('AB_TO_KZT', 10),
    // Комиссия платформы с продажи награды (продавец получает остальное)
    sellerFeePercent: num('SELLER_FEE_PERCENT', 10),
    // Минимальная сумма вывода для продавца
    payoutMinAb: num('PAYOUT_MIN_AB', 500),
    dailySubmissionLimit: num('DAILY_SUBMISSION_LIMIT', 10),
  },
  // Маскот: если задан ключ Anthropic, отвечает настоящий ИИ (Claude); иначе — встроенная база знаний
  mascot: {
    anthropicKey: env('ANTHROPIC_API_KEY', ''),
    model: env('MASCOT_MODEL', 'claude-haiku-5-5'),
    perHour: num('MASCOT_QUESTIONS_PER_HOUR', 20),
  },
  // Часовой пояс для «дней» в статистике и серии заходов (минуты от UTC). Казахстан: UTC+5 = 300
  tzOffsetMin: num('TZ_OFFSET_MIN', 300),
  // Ежедневный челлендж: сколько заданий в день (только прогресс и серия — баллы за него не начисляются)
  dailyChallenge: num('DAILY_CHALLENGE_TASKS', 3),
  sessionDays: 30,
};
