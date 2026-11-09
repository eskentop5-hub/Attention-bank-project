import { config } from './config.js';
import { createServer } from './app.js';
import { seedDemo } from './seed.js';
import { startBot } from './telegram/bot.js';
import { platformAccountId } from './db.js';

platformAccountId();
if (config.seedDemo) await seedDemo();

createServer().listen(config.port, () => {
  console.log(`\n  ATTENTION BANK запущен: http://localhost:${config.port}\n`);
  console.log('  Демо-участник:  demo@attention.bank   / demo1234');
  console.log('  Демо-компания:  studio@attention.bank / demo1234\n');
  startBot();
  // Пинг самого себя через публичный адрес каждые 10 минут: Render Free засыпает после 15 минут без запросов,
  // а при пробуждении стирает базу. Это держит демо живым (кроме момента нового деплоя).
  if (config.keepAwake) {
    const ping = () => fetch(`${config.publicUrl}/api/health`, { signal: AbortSignal.timeout(15000) }).catch(() => {});
    setInterval(ping, 10 * 60e3).unref?.();
    console.log('[keep-awake] сервер будет пинговать себя каждые 10 минут:', config.publicUrl);
  }
});
