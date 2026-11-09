// Демо-данные создаются через реальные сервисы и не ломают журнал транзакций.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ab-seed-'));
process.env.DB_PATH = path.join(dir, 'seed.db');
process.env.TELEGRAM_BOT_TOKEN = '';

test('seed: демо-данные, история по дням, видео-задания с контрольным вопросом', async () => {
  const { seedDemo } = await import('../server/seed.js');
  assert.equal(await seedDemo({ log: () => {} }), true);
  const { one, all, db } = await import('../server/db.js');
  const { verifyAllLedgers } = await import('../server/services/ledger.js');
  const { userStats } = await import('../server/services/stats.js');
  assert.equal(verifyAllLedgers().ok, true, 'баланс = сумма транзакций у всех');
  const { treasury } = await import('../server/services/economy.js');
  const t = treasury();
  assert.equal(t.ok, true, 'демо-экономика полностью обеспечена пополнениями');
  assert.ok(t.flows.sellerRevenue > 0, 'демо-студия получила выручку за проданные награды');
  const demo = one("SELECT id FROM users WHERE email = 'demo@attention.bank'");
  const s = userStats(demo.id);
  assert.equal(s.yesterday.earned + s.dayBefore.earned, 150, 'демо-заработок разложен на вчера и позавчера');
  const video = all("SELECT questions, product_url FROM campaigns WHERE category = 'video_review'");
  assert.equal(video.length, 2);
  assert.ok(video.every((v) => JSON.parse(v.questions).some((q) => q.correct) && v.product_url.includes('/play/video/')));
  assert.ok(one("SELECT COUNT(*) AS n FROM rewards WHERE platform = 'steam'").n >= 1);
  assert.equal(await seedDemo({ log: () => {} }), false, 'повторный запуск ничего не дублирует');
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
