import { config } from './config.js';
import { restoreIfNeeded, scheduleBackups, backupProvider } from './services/backup.js';

// 1) Если базы на диске нет (новый сервер, перезапуск бесплатного хостинга) — восстановить из резервной копии.
//    Делается ДО первого открытия базы.
const restored = await restoreIfNeeded();

const { createServer } = await import('./app.js');
const { platformAccountId } = await import('./db.js');
const { ensureAdmin } = await import('./services/admin.js');
const { startBot } = await import('./telegram/bot.js');
const { demoContext, scheduleDemoReset } = await import('./demo.js');

platformAccountId();
const adminId = ensureAdmin();
// Старое поведение (демо-данные прямо в настоящей базе) — только если явно включено SEED_DEMO=1
if (config.seedDemo) {
  const { seedDemo } = await import('./seed.js');
  await seedDemo();
}

createServer().listen(config.port, () => {
  console.log(`\n  ATTENTION BANK запущен: http://localhost:${config.port}`);
  const bp = backupProvider();
  console.log(`  Настоящая база: ${config.dbPath}${bp === 's3' ? ' (копии в S3)' : bp === 'telegram' ? ' (копии в Telegram)' : ''}`);
  console.log(adminId ? `  Администратор: ${config.admin.email}` : '  Администратор НЕ создан: проверьте ADMIN_EMAIL и ADMIN_PASSWORD (не короче 10 символов)');
  if (config.demoSandbox) console.log('  Демо-песочница: кнопка «Демо» на сайте (demo@attention.bank / studio@attention.bank, пароль demo1234)\n');
  startBot();
  scheduleBackups();
  // Сообщить администратору в Telegram, что база вернулась после перезапуска
  if (restored?.chatId) {
    import('./telegram/api.js').then(({ sendMessage }) =>
      sendMessage(restored.chatId, `♻️ Сервер перезапустился, база восстановлена из закреплённой копии (${Math.round(restored.size / 1024)} КБ). Всё на месте.`, { disable_notification: true })
    );
  }
  scheduleDemoReset();
  // Подготовить песочницу заранее, чтобы первый клик «Демо» был мгновенным
  if (config.demoSandbox) demoContext().catch((e) => console.error('[demo]', e));
  // Пинг самого себя через публичный адрес каждые 10 минут: Render Free засыпает после 15 минут без запросов.
  if (config.keepAwake) {
    const ping = () => fetch(`${config.publicUrl}/api/health`, { signal: AbortSignal.timeout(15000) }).catch(() => {});
    setInterval(ping, 10 * 60e3).unref?.();
    console.log('[keep-awake] сервер будет пинговать себя каждые 10 минут:', config.publicUrl);
  }
});
