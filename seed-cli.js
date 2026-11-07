// npm run seed — пересоздать базу с демо-данными
import fs from 'node:fs';
import { config } from './config.js';

for (const suffix of ['', '-wal', '-shm']) fs.rmSync(config.dbPath + suffix, { force: true });
console.log('[seed] база удалена:', config.dbPath);
const { seedDemo } = await import('./seed.js');
await seedDemo();
