// Магазин наград: на что тратятся AB Points.
// Награды добавляют сами компании (ключи раннего доступа, внутриигровые предметы, подписки, признание),
// поэтому у баллов есть реальная ценность. Остаток — реальный запас, заданный компанией, без искусственного дефицита.
import { one, all, run, tx } from '../db.js';
import { bad, forbidden, notFound, str, int, randomCode } from '../util.js';
import { REWARD_CATEGORIES, isRewardCategory } from '../catalog.js';
import { postTransaction } from './ledger.js';
import { notify } from './notifications.js';

const categoryLabel = (id) => REWARD_CATEGORIES.find((c) => c.id === id)?.label || id;

export const imageUrl = (r) => (r.image_id ? `/api/images/${r.image_id}` : r.cover || `/img/rewards/cat-${r.category || 'game_access'}.svg`);

const SELECT = `SELECT r.*, u.company_name, u.is_demo AS company_demo,
  (SELECT COUNT(*) FROM redemptions x WHERE x.reward_id = r.id) AS redeemed
  FROM rewards r LEFT JOIN users u ON u.id = r.company_id`;

function view(r, balance = null) {
  const v = {
    id: r.id,
    title: r.title,
    description: r.description,
    howToUse: r.how_to_use,
    category: r.category,
    categoryLabel: categoryLabel(r.category),
    cost: r.cost,
    stock: r.stock,
    active: !!r.active,
    redeemed: r.redeemed ?? 0,
    company: r.company_name || 'ATTENTION BANK',
    demo: !!r.company_demo,
    imageUrl: imageUrl(r),
  };
  if (balance !== null) {
    v.affordable = balance >= r.cost && r.stock > 0;
    v.need = Math.max(0, r.cost - balance);
    v.progress = Math.min(100, Math.round((balance / r.cost) * 100));
  }
  return v;
}

export function listRewards(user = null) {
  const balance = user ? one('SELECT balance FROM users WHERE id = ?', user.id).balance : null;
  return all(`${SELECT} WHERE r.active = 1 ORDER BY r.cost ASC`).map((r) => view(r, balance));
}

// Для лендинга: реальные награды из каталога (без авторизации)
export const publicRewards = (limit = 6) =>
  all(`${SELECT} WHERE r.active = 1 AND r.stock > 0 ORDER BY redeemed DESC, r.id ASC LIMIT ?`, limit).map((r) => view(r));

export function getReward(user, id) {
  const r = one(`${SELECT} WHERE r.id = ?`, id);
  if (!r || (!r.active && r.company_id !== user.id)) throw notFound('Награда не найдена');
  const balance = one('SELECT balance FROM users WHERE id = ?', user.id).balance;
  const mine = all('SELECT code, cost, created_at FROM redemptions WHERE reward_id = ? AND user_id = ? ORDER BY id DESC', id, user.id);
  return { ...view(r, balance), mine, isGoal: user.goal_reward_id === r.id };
}

export function companyRewards(companyId) {
  return all(`${SELECT} WHERE r.company_id = ? ORDER BY r.id DESC`, companyId).map((r) => view(r));
}

export function createReward(company, body) {
  const title = str(body.title, { field: 'Название награды', min: 3, max: 100 });
  const description = str(body.description, { field: 'Описание', min: 5, max: 500 });
  const howToUse = str(body.howToUse, { field: 'Как воспользоваться', max: 500, required: false }) || null;
  const cost = int(body.cost, { field: 'Цена в AB', min: 1, max: 100000 });
  const stock = int(body.stock, { field: 'Количество', min: 1, max: 100000 });
  const category = isRewardCategory(body.category) ? body.category : 'game_access';
  let imageId = null;
  if (body.imageId != null && body.imageId !== '') {
    imageId = int(body.imageId, { field: 'Картинка', min: 1 });
    const img = one('SELECT owner_id FROM images WHERE id = ?', imageId);
    if (!img || img.owner_id !== company.id) throw bad('Картинка не найдена — загрузите её ещё раз');
  }
  const r = run(
    'INSERT INTO rewards (company_id, title, description, how_to_use, cost, stock, category, image_id, cover) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    company.id, title, description, howToUse, cost, stock, category, imageId, body.cover || null
  );
  return one(`${SELECT} WHERE r.id = ?`, Number(r.lastInsertRowid));
}

// Компания управляет своей наградой: включить/выключить, пополнить запас
export function updateReward(company, id, body) {
  return tx(() => {
    const r = one('SELECT * FROM rewards WHERE id = ?', id);
    if (!r) throw notFound('Награда не найдена');
    if (r.company_id !== company.id) throw forbidden();
    if (body.active !== undefined) run('UPDATE rewards SET active = ? WHERE id = ?', body.active ? 1 : 0, id);
    if (body.addStock !== undefined) {
      const add = int(body.addStock, { field: 'Пополнение запаса', min: 1, max: 100000 });
      run('UPDATE rewards SET stock = stock + ? WHERE id = ?', add, id);
    }
    return view(one(`${SELECT} WHERE r.id = ?`, id));
  });
}

export function setGoal(user, rewardId) {
  if (rewardId === null || rewardId === undefined || rewardId === '') {
    run('UPDATE users SET goal_reward_id = NULL WHERE id = ?', user.id);
    return { goal: null };
  }
  const id = int(rewardId, { field: 'Награда', min: 1 });
  const r = one('SELECT id FROM rewards WHERE id = ? AND active = 1', id);
  if (!r) throw notFound('Награда не найдена');
  run('UPDATE users SET goal_reward_id = ? WHERE id = ?', id, user.id);
  return { goal: id };
}

export function redeem(user, rewardId) {
  return tx(() => {
    const r = one('SELECT * FROM rewards WHERE id = ? AND active = 1', rewardId);
    if (!r) throw notFound('Награда не найдена');
    if (r.stock <= 0) throw bad('Эта награда закончилась');
    const code = `AB-${randomCode(4)}-${randomCode(4)}`;
    run('UPDATE rewards SET stock = stock - 1 WHERE id = ? AND stock > 0', r.id);
    const red = run('INSERT INTO redemptions (reward_id, user_id, code, cost) VALUES (?, ?, ?, ?)', r.id, user.id, code, r.cost);
    const { balanceAfter } = postTransaction({
      userId: user.id,
      amount: -r.cost,
      type: 'redemption',
      title: `Награда: ${r.title}`,
      refType: 'redemption',
      refId: Number(red.lastInsertRowid),
    });
    // Цель достигнута — снимаем её, чтобы человек выбрал следующую сам
    if (user.goal_reward_id === r.id) run('UPDATE users SET goal_reward_id = NULL WHERE id = ?', user.id);
    notify(user.id, {
      kind: 'redemption',
      title: `Награда получена: ${r.title}`,
      body: `Ваш код: ${code}. Списано ${r.cost} AB, баланс: ${balanceAfter} AB`,
      link: `/#/rewards/${r.id}`,
      telegram: `🎁 <b>Награда получена</b>\n${r.title}\nКод: <code>${code}</code>\n−${r.cost} AB · баланс ${balanceAfter} AB`,
    });
    return { code, balance: balanceAfter, howToUse: r.how_to_use };
  });
}

export const myRedemptions = (userId) =>
  all(
    `SELECT x.id, x.reward_id, x.code, x.cost, x.created_at, r.title, r.description, r.how_to_use FROM redemptions x
     JOIN rewards r ON r.id = x.reward_id WHERE x.user_id = ? ORDER BY x.id DESC`,
    userId
  );

// ---------- Картинки наград ----------
// Принимаем только PNG/JPEG/WebP (SVG запрещён: может содержать скрипты). Проверяем сигнатуру файла.
const SIGNATURES = {
  'image/png': (b) => b.length > 8 && b.readUInt32BE(0) === 0x89504e47,
  'image/jpeg': (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/webp': (b) => b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP',
};
export const MAX_IMAGE_BYTES = 1_500_000;

export function uploadImage(owner, body) {
  const mime = String(body.mime || '');
  if (!SIGNATURES[mime]) throw bad('Поддерживаются PNG, JPEG и WebP');
  const data = Buffer.from(String(body.data || ''), 'base64');
  if (!data.length) throw bad('Пустой файл');
  if (data.length > MAX_IMAGE_BYTES) throw bad('Картинка больше 1,5 МБ — уменьшите её');
  if (!SIGNATURES[mime](data)) throw bad('Файл не похож на картинку выбранного формата');
  const r = run('INSERT INTO images (owner_id, mime, size, data) VALUES (?, ?, ?, ?)', owner.id, mime, data.length, data);
  return { id: Number(r.lastInsertRowid), url: `/api/images/${Number(r.lastInsertRowid)}` };
}

export const getImage = (id) => one('SELECT mime, data FROM images WHERE id = ?', id);

export { view as rewardView };
