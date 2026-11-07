// Сборка всего проекта в один файл attention-bank-v2.mjs (сервер + сайт + бот).
// Нужен esbuild: npx esbuild (только для разработчика, для запуска не нужен).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const esbuild = require(process.env.ESBUILD_PATH || 'esbuild');

const assets = { 'schema.sql': fs.readFileSync(path.join(ROOT, 'server/schema.sql')).toString('base64') };
(function walk(dir) {
  for (const f of fs.readdirSync(path.join(ROOT, dir))) {
    const rel = `${dir}/${f}`;
    if (fs.statSync(path.join(ROOT, rel)).isDirectory()) walk(rel);
    else assets[rel] = fs.readFileSync(path.join(ROOT, rel)).toString('base64');
  }
})('public');

await esbuild.build({
  entryPoints: [path.join(ROOT, 'server/index.js')],
  outfile: path.join(ROOT, 'attention-bank-v2.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  define: { 'process.env.AB_BUNDLED': '"1"' },
  banner: { js: '// ATTENTION BANK — собранная версия. Исходный код: папки server/ и public/. Пересборка: npm run build' },
  plugins: [{
    name: 'embed-assets',
    setup(b) {
      b.onResolve({ filter: /\/assets\.js$/ }, () => ({ path: 'assets', namespace: 'ab' }));
      b.onLoad({ filter: /.*/, namespace: 'ab' }, () => ({ contents: `export default ${JSON.stringify(assets)};`, loader: 'js' }));
    },
  }],
});
console.log(`attention-bank-v2.mjs собран: ${Object.keys(assets).length} встроенных файлов`);
