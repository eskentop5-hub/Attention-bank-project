import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const VERSION = '13.0.0';

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
  // Настоящая база. С v11 по умолчанию новый файл: старая база прошлых версий (с демо-данными) не трогается.
  // На хостинге с постоянным диском укажите путь на этом диске, например DB_PATH=/var/data/app.db
  dbPath: path.resolve(ROOT, env('DB_PATH', './data/app.db')),
  // Старый режим «всё приложение — демо» (бесплатное пополнение бюджета в настоящей базе). Только для тестов и разработки.
  demoMode: env('DEMO_MODE', '0') === '1',
  // Залить демо-данные в НАСТОЯЩУЮ базу (старое поведение). По умолчанию выключено: демо живёт в песочнице.
  seedDemo: env('SEED_DEMO', '0') === '1',
  // Демо-песочница по кнопке «Демо»: отдельная база в памяти с демо-аккаунтами, сбрасывается сама
  demoSandbox: env('DEMO_SANDBOX', '1') === '1',
  demoResetHours: num('DEMO_RESET_HOURS', 6),
  // Администратор платформы: создаётся/обновляется при запуске (пароль хранится только в виде хеша)
  admin: {
    email: String(env('ADMIN_EMAIL', '')).trim().toLowerCase(),
    password: env('ADMIN_PASSWORD', ''),
  },
  // Пополнение бюджета студией по счёту: реквизиты, которые увидит студия (если пусто — команда пришлёт счёт сама)
  billing: {
    details: String(env('BILLING_DETAILS', '')).replace(/\\n/g, '\n'),
    contact: env('BILLING_CONTACT', ''),
    minAb: num('TOPUP_MIN_AB', 100),
  },
  // Письма (восстановление пароля, подтверждение email). Провайдер с HTTP API: resend | brevo
  email: {
    provider: env('EMAIL_PROVIDER', ''),
    apiKey: env('EMAIL_API_KEY', ''),
    from: env('EMAIL_FROM', ''),
  },
  // Резервные копии настоящей базы в S3-совместимое хранилище (Cloudflare R2, Backblaze B2, Yandex Object Storage…)
  backup: {
    endpoint: String(env('BACKUP_S3_ENDPOINT', '')).replace(/\/$/, ''),
    bucket: env('BACKUP_S3_BUCKET', ''),
    region: env('BACKUP_S3_REGION', 'auto'),
    keyId: env('BACKUP_S3_KEY_ID', ''),
    secret: env('BACKUP_S3_SECRET', ''),
    prefix: String(env('BACKUP_PREFIX', 'attention-bank')).replace(/^\/|\/$/g, ''),
    // Как часто проверять изменения и сохранять копию (минуты). Копия делается, только если база менялась.
    intervalMin: num('BACKUP_INTERVAL_MIN', 1),
    keep: num('BACKUP_KEEP', 48),
  },
  // Реферальная программа: бонус пригласившему за первое одобренное задание друга (платит платформа из своих комиссий)
  referralBonus: num('REFERRAL_BONUS', 20),
  telegram: {
    token: env('TELEGRAM_BOT_TOKEN', ''),
    username: String(env('TELEGRAM_BOT_USERNAME', '')).replace(/^@/, ''),
    groupId: env('TELEGRAM_GROUP_ID', ''),
    mode: env('TELEGRAM_MODE', 'polling'),
    webhookSecret: env('TELEGRAM_WEBHOOK_SECRET', 'change-me'),
    // Необязательно: чат для резервных копий базы. По умолчанию — Telegram администратора (ничего задавать не нужно)
    backupChatId: env('TELEGRAM_BACKUP_CHAT_ID', ''),
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
  // Не давать бесплатному Render засыпать (при засыпании стирается база). По умолчанию — для адресов *.onrender.com
  keepAwake: env('KEEP_AWAKE', '') === '1' || (env('KEEP_AWAKE', '') !== '0' && /onrender\.com/.test(env('PUBLIC_URL', ''))),
  // За прокси (Render и т.п.) настоящий IP клиента — в X-Forwarded-For (нужно для лимитов попыток входа)
  trustProxy: env('TRUST_PROXY', /onrender\.com/.test(env('PUBLIC_URL', '')) ? '1' : '0') === '1',
  // Сколько регистраций в час с одного IP (класс или клуб за одним Wi-Fi — поэтому с запасом)
  registerPerHour: num('REGISTER_PER_HOUR', 60),
  sessionDays: 30,
};
