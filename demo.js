// ДЕМО-ПЕСОЧНИЦА: отдельная база в памяти с демо-аккаунтами, студиями, кампаниями и наградами.
// Включается кнопкой «Демо» на сайте. Ничего из песочницы не попадает в настоящую базу.
import { config } from './config.js';
import { createContext, withContext, platformAccountId } from './db.js';

let current = null; // готовая песочница
let building = null; // песочница, которая сейчас заполняется
let lastReset = 0;

async function build() {
  const ctx = createContext('demo', ':memory:', true);
  await withContext(ctx, async () => {
    platformAccountId();
    const { seedDemo } = await import('./seed.js');
    await seedDemo({ log: () => {} });
  });
  return ctx;
}

/** Контекст демо-базы (создаётся при первом обращении) */
export async function demoContext() {
  if (current) return current;
  if (!building)
    building = build()
      .then((ctx) => {
        current = ctx;
        lastReset = Date.now();
        return ctx;
      })
      .finally(() => (building = null));
  return building;
}

/** Вернуть песочницу в исходное состояние. Старую базу закрываем позже — вдруг по ней ещё идут запросы. */
export async function resetDemo() {
  const old = current;
  current = null;
  const ctx = await demoContext();
  if (old) setTimeout(() => old.db.close(), 60e3).unref?.();
  return ctx;
}

export const demoInfo = () => ({
  enabled: config.demoSandbox,
  resetHours: config.demoResetHours,
  lastResetAt: lastReset ? new Date(lastReset).toISOString() : null,
  nextResetAt: lastReset ? new Date(lastReset + config.demoResetHours * 3600e3).toISOString() : null,
});

/** Автосброс песочницы по расписанию (только если ею уже кто-то пользовался) */
export function scheduleDemoReset() {
  if (!config.demoSandbox || !(config.demoResetHours > 0)) return;
  setInterval(() => {
    if (current && Date.now() - lastReset >= config.demoResetHours * 3600e3 - 1000) resetDemo().catch((e) => console.error('[demo-reset]', e));
  }, 10 * 60e3).unref?.();
}

// Глобальное ограничение ручного сброса из интерфейса (песочница общая для всех гостей)
export function canManualReset() {
  return Date.now() - lastReset > 5 * 60e3;
}
