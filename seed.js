// Демо-данные: проходят через те же сервисы, что и реальные действия
// (ледж, проверка, начисления) — поэтому база всегда консистентна.

export async function seedDemo({ log = console.log } = {}) {
  const { one, all, run, tx } = await import('./db.js');
  const { dayKey } = await import('./services/stats.js');
  const { hashPassword } = await import('./services/auth.js');
  const { postTransaction } = await import('./services/ledger.js');
  const C = await import('./services/campaigns.js');
  const R = await import('./services/rewards.js');

  const { config } = await import('./config.js');
  const PLAY = {
    'steppe-runner-beta': `${config.publicUrl}/play/steppe-runner/index.html`,
    'steppe-runner-store': `${config.publicUrl}/play/steppe-runner/store.html`,
    'qadam-beta': `${config.publicUrl}/play/qadam/index.html`,
    'inventory-prototype': `${config.publicUrl}/play/inventory/index.html`,
    'video-steppe': `${config.publicUrl}/play/video/index.html?v=steppe`,
    'video-qadam': `${config.publicUrl}/play/video/index.html?v=qadam`,
  };
  // Базы, созданные прошлыми версиями: заменить заглушки example.com на встроенные продукты
  for (const [slug, link] of Object.entries(PLAY)) {
    run("UPDATE campaigns SET product_url = ? WHERE product_url = ? AND company_id IN (SELECT id FROM users WHERE is_demo = 1)", link, `https://example.com/${slug}`);
  }

  if (one("SELECT id FROM users WHERE role = 'company' LIMIT 1")) return false;
  tx(() => {

  const pass = hashPassword('demo1234');
  const mkUser = (email, name, role, extra = {}) => {
    const r = run(
      'INSERT INTO users (email, password_hash, name, role, company_name, interests, consent_at, telegram_verified_at, is_demo) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)',
      email, pass, name, role, extra.company || null, JSON.stringify(extra.interests || []), new Date().toISOString(), extra.verified ? new Date().toISOString() : null
    );
    return one('SELECT * FROM users WHERE id = ?', Number(r.lastInsertRowid));
  };

  const studio = mkUser('studio@attention.bank', 'Данияр', 'company', { company: 'Nomad Pixel Studio' });
  const qadam = mkUser('apps@attention.bank', 'Мадина', 'company', { company: 'Qadam Apps' });
  postTransaction({ userId: studio.id, amount: 20000, type: 'deposit', title: 'Пополнение бюджета (демо)' });
  postTransaction({ userId: qadam.id, amount: 10000, type: 'deposit', title: 'Пополнение бюджета (демо)' });

  const demo = mkUser('demo@attention.bank', 'Айгерим', 'user', { interests: ['mobile_games', 'indie_games', 'mobile_apps', 'beta_testing'] });

  const playtest = C.createCampaign(studio, {
    title: 'Плейтест Steppe Runner: первые 15 минут',
    description:
      'Steppe Runner — браузерный раннер про гонку по степи на коне: овраги, камни, монеты, смена дня и ночи. Откройте тестовую сборку прямо в браузере, пройдите обучение и три уровня, затем ответьте на вопросы. Нам важно понять, где игроки путаются и в какой момент теряют интерес.',
    category: 'game_testing',
    productUrl: PLAY['steppe-runner-beta'],
    estMinutes: 15,
    instructions: 'Нажмите «Открыть продукт» — игра запустится в браузере, устанавливать ничего не нужно.\nПройдите обучение и три уровня (утро, закат, ночь).\nЗапомните моменты, где было непонятно, скучно или нечестно.\nПо желанию скопируйте итоги теста под игрой и приложите к ответу.\nОтветьте на вопросы ниже.',
    audience: ['mobile_games', 'indie_games', 'beta_testing'],
    reward: 50,
    maxParticipants: 20,
    minSeconds: 120,
    questions: [
      { type: 'rating', label: 'Насколько интересно было играть?' },
      { type: 'rating', label: 'Насколько понятным было обучение?' },
      { type: 'text', label: 'В какой момент вы запутались или захотели выйти из игры? Опишите подробно.', minLength: 40 },
      { type: 'choice', label: 'Продолжите играть после теста?', options: ['Да', 'Возможно', 'Нет'] },
    ],
  });

  const trailer = C.createCampaign(studio, {
    title: 'Первое впечатление: страница игры и трейлер',
    description:
      'Посмотрите 40-секундный трейлер и страницу игры Steppe Runner в магазине. Расскажите, что вы поняли об игре и захотелось ли её скачать. Ответы с хорошей оценкой качества одобряются автоматически.',
    category: 'game_feedback',
    productUrl: PLAY['steppe-runner-store'],
    estMinutes: 3,
    instructions: 'Откройте страницу игры и досмотрите трейлер до конца (40 секунд).\nПролистайте скриншоты, описание и особенности.\nОтветьте, что вы поняли об игре и захотелось ли в неё сыграть.',
    audience: ['mobile_games', 'pc_games', 'indie_games'],
    reward: 20,
    maxParticipants: 50,
    minSeconds: 45,
    autoApprove: true,
    questions: [
      { type: 'text', label: 'Опишите своими словами, о чём эта игра.', minLength: 30 },
      { type: 'rating', label: 'Насколько вам хочется её скачать?' },
      { type: 'choice', label: 'Что больше всего зацепило?', options: ['Графика', 'Музыка', 'Сеттинг', 'Геймплей', 'Ничего'] },
    ],
  });

  const onboarding = C.createCampaign(qadam, {
    title: 'Тест онбординга приложения Qadam',
    description:
      'Qadam — приложение для подготовки к ЕНТ в формате коротких ежедневных шагов. Интерактивный прототип открывается в браузере: регистрация, выбор предметов, цель на день и первый урок из 5 вопросов. Нас интересует, что мешает дойти до конца онбординга.',
    category: 'app_testing',
    productUrl: PLAY['qadam-beta'],
    estMinutes: 20,
    instructions: 'Откройте прототип Qadam по кнопке «Открыть продукт».\nЗарегистрируйтесь и выберите пару профильных предметов ЕНТ.\nПройдите первый урок до конца.\nСправа от телефона есть автоматический отчёт (время на экранах, ошибки) — его можно вставить в ответ.\nПриложите ссылку на скриншот экрана, где возникла трудность (если была).',
    audience: ['mobile_apps', 'edtech', 'beta_testing'],
    reward: 100,
    maxParticipants: 15,
    minSeconds: 180,
    questions: [
      { type: 'rating', label: 'Насколько легко было зарегистрироваться?' },
      { type: 'text', label: 'Что было непонятно или раздражало во время онбординга?', minLength: 40 },
      { type: 'text', label: 'Что бы вы изменили в первую очередь?', minLength: 20 },
      { type: 'choice', label: 'На каком устройстве тестировали?', options: ['Android', 'iPhone', 'Планшет'] },
      { type: 'url', label: 'Ссылка на скриншот проблемного экрана', required: false },
    ],
  });

  C.createCampaign(studio, {
    title: 'UX-исследование: новое меню инвентаря',
    description:
      'Сравните два варианта меню инвентаря (A и B) на интерактивном прототипе и выберите удобный. Задание только для участников с подтверждённым через Telegram аккаунтом.',
    category: 'ux_research',
    productUrl: PLAY['inventory-prototype'],
    estMinutes: 8,
    instructions: 'Откройте прототип и нажмите «Начать замер» в варианте A — найдите «Зелье лечения».\nСделайте то же в варианте B.\nСравните время и промахи в таблице справа, итог можно скопировать.\nОтветьте, какой вариант удобнее и почему.',
    audience: ['ux_design', 'mobile_games', 'pc_games'],
    reward: 40,
    maxParticipants: 30,
    minSeconds: 90,
    requireTelegram: true,
    questions: [
      { type: 'choice', label: 'Какой вариант удобнее?', options: ['Вариант A', 'Вариант B', 'Одинаково'] },
      { type: 'text', label: 'Почему? Что именно помогло или мешало найти нужный предмет?', minLength: 30 },
      { type: 'rating', label: 'Оцените выбранный вариант' },
    ],
  });

  // Видео-тесты с контрольным вопросом: проверяют, что ролик действительно посмотрели
  C.createCampaign(studio, {
    title: 'Видео-тест: трейлер Steppe Runner',
    description: 'Посмотрите 45-секундный трейлер игры до конца и ответьте на 3 вопроса. В ролике есть контрольное слово — по нему автопроверка понимает, что видео действительно посмотрели. Хорошие ответы одобряются автоматически.',
    category: 'video_review',
    productUrl: PLAY['video-steppe'],
    estMinutes: 2,
    instructions: 'Откройте видео по кнопке «Открыть продукт» и посмотрите его целиком, без перемотки.\nЗапомните контрольное слово, которое появится в середине ролика.\nОтветьте на вопросы ниже.',
    audience: ['mobile_games', 'pc_games', 'indie_games'],
    reward: 15,
    maxParticipants: 100,
    minSeconds: 50,
    autoApprove: true,
    questions: [
      { type: 'choice', label: 'Какое контрольное слово появилось в середине трейлера?', options: ['БАЙГЕ', 'ТУЛПАР', 'ДАЛА', 'КЫМЫЗ'], correct: 'ТУЛПАР' },
      { type: 'rating', label: 'Насколько трейлер передаёт атмосферу игры?' },
      { type: 'text', label: 'Какой момент трейлера запомнился и почему?', minLength: 25 },
    ],
  });
  C.createCampaign(qadam, {
    title: 'Видео-тест: реклама приложения Qadam',
    description: 'Посмотрите 30-секундный вертикальный рекламный ролик Qadam, как будто увидели его в соцсетях. Нам важно понять, ясно ли из ролика, что это за продукт и для кого он.',
    category: 'video_review',
    productUrl: PLAY['video-qadam'],
    estMinutes: 2,
    instructions: 'Откройте ролик по кнопке «Открыть продукт» и посмотрите его целиком.\nОбратите внимание, сколько времени в день предлагает тратить приложение.\nОтветьте на вопросы ниже.',
    audience: ['mobile_apps', 'edtech'],
    reward: 15,
    maxParticipants: 100,
    minSeconds: 35,
    autoApprove: true,
    questions: [
      { type: 'choice', label: 'Сколько минут в день предлагает заниматься реклама?', options: ['5', '10', '15', '30'], correct: '10' },
      { type: 'text', label: 'Что, по-вашему, рекламирует ролик и для кого он?', minLength: 25 },
      { type: 'choice', label: 'Установили бы приложение после такой рекламы?', options: ['Да', 'Возможно', 'Нет'] },
    ],
  });

  // Помощник: пройти задание «как будто 10 минут назад»
  const complete = (user, campaign, answers, decision, extra = {}) => {
    C.startTask(user, campaign.id);
    run("UPDATE assignments SET started_at = ? WHERE campaign_id = ? AND user_id = ?", new Date(Date.now() - 600e3).toISOString(), campaign.id, user.id);
    const res = C.submitTask(user, campaign.id, answers);
    if (decision && res.outcome === 'pending') {
      const a = one('SELECT id FROM assignments WHERE campaign_id = ? AND user_id = ?', campaign.id, user.id);
      C.reviewSubmission(campaign.company_id === studio.id ? studio : qadam, a.id, { decision, ...extra });
    }
  };

  // История демо-пользователя: +50, +100, −80 (как в плане)
  complete(demo, playtest, {
    q1: 4, q2: 3,
    q3: 'На втором уровне не понял, что нужно свайпать вверх для прыжка через овраг — подсказка появилась слишком поздно, и я дважды проиграл.',
    q4: 'Да',
  }, 'approve', { rating: 5, note: 'Очень полезное наблюдение про подсказку' });
  complete(demo, onboarding, {
    q1: 4,
    q2: 'Экран выбора предметов ЕНТ не объясняет, можно ли потом поменять выбор. Я долго боялась нажать «Далее».',
    q3: 'Добавить подпись, что предметы можно сменить в настройках.',
    q4: 'Android',
  }, 'approve', { rating: 4 });

  const key = R.createReward(studio, {
    title: 'Ранний доступ Steppe Runner (Android)', category: 'game_access', cover: '/img/rewards/steppe-key.svg', platform: 'google_play',
    description: 'Полная мобильная версия игры за две недели до релиза. Промокод активируется в Google Play.',
    howToUse: 'Google Play → Профиль → Платежи и подписки → Активировать промокод. Код одноразовый.', cost: 80, stock: 50,
  });
  R.createReward(studio, {
    title: 'Steam-ключ Steppe Runner: PC-издание', category: 'game_access', cover: '/img/rewards/steppe-key.svg', platform: 'steam',
    description: 'Ключ ПК-версии игры от самой студии: геймпад, 4K и таблица рекордов. Студия раздаёт ключи своей игры тестировщикам.',
    howToUse: 'Steam → Игры → Активировать в Steam… → введите ключ. Игра появится в библиотеке.', cost: 200, stock: 30,
  });
  R.createReward(studio, {
    title: 'Ключ Steppe Runner для Epic Games Store', category: 'game_access', cover: '/img/rewards/steppe-key.svg', platform: 'epic',
    description: 'Та же ПК-версия, если вы играете через Epic Games Store. Ключ выдаёт сама студия.',
    howToUse: 'Epic Games Launcher → профиль → Активировать код → введите ключ.', cost: 200, stock: 15,
  });
  R.createReward(studio, {
    title: 'Скин «Тулпар»', category: 'in_game', cover: '/img/rewards/tulpar.svg', platform: 'in_game',
    description: 'Крылатый конь для Steppe Runner. Выдаётся только участникам тестов.',
    howToUse: 'В игре: Профиль → Подарочный код. Скин появится в гараже сразу.', cost: 40, stock: 200,
  });
  R.createReward(studio, {
    title: '500 кристаллов', category: 'in_game', cover: '/img/rewards/crystals.svg', platform: 'in_game',
    description: 'Внутриигровая валюта Steppe Runner для покупки улучшений.',
    howToUse: 'В игре: Магазин → Ввести код.', cost: 120, stock: 300,
  });
  const premium = R.createReward(qadam, {
    title: 'Qadam Premium на месяц', category: 'subscription', cover: '/img/rewards/qadam.svg', platform: 'web',
    description: 'Все уроки и пробные тесты ЕНТ без ограничений на 30 дней.',
    howToUse: 'В приложении Qadam: Настройки → Промокод.', cost: 150, stock: 100,
  });
  R.createReward(studio, {
    title: 'Чат с разработчиками', category: 'recognition', cover: '/img/rewards/devchat.svg', platform: 'web',
    description: 'Приглашение в закрытый чат команды: обсуждение обновлений до их выхода.',
    howToUse: 'Отправьте код боту студии — он пришлёт приглашение.', cost: 60, stock: 40,
  });
  R.createReward(studio, {
    title: 'Ваше имя в титрах', category: 'recognition', cover: '/img/rewards/credits.svg',
    description: 'Имя в разделе «Тестировщики» в финальных титрах Steppe Runner.',
    howToUse: 'Отправьте код и имя для титров на почту студии до релиза.', cost: 300, stock: 20,
  });
  R.redeem(demo, key.id);
  run('UPDATE users SET goal_reward_id = ? WHERE id = ?', premium.id, demo.id);

  // Другие участники — чтобы у компании были результаты и очередь на проверку
  const people = [
    ['arman@example.com', 'Арман', true],
    ['dana@example.com', 'Дана', true],
    ['timur@example.com', 'Тимур', false],
    ['alina@example.com', 'Алина', true],
    ['erlan@example.com', 'Ерлан', false],
    ['zhanna@example.com', 'Жанна', true],
  ].map(([e, n, v]) => mkUser(e, n, 'user', { interests: ['mobile_games', 'indie_games'], verified: v }));

  const fb = [
    [5, 4, 'Обучение хорошее, но на третьем уровне камера слишком близко — не видно препятствий заранее, приходится угадывать.', 'Да', 'approve', 5],
    [3, 2, 'Не понял, зачем собирать монеты: магазин открывается только после уровня 5, а об этом нигде не сказано.', 'Возможно', 'approve', 4],
    [4, 4, 'Музыка отличная, но после проигрыша реклама показывается слишком часто — хотелось закрыть игру.', 'Возможно', 'approve', 4],
    [2, 3, 'Управление свайпами иногда не срабатывает на маленьком экране, особенно при резком повороте коня.', 'Нет', 'approve', 3],
    [4, 5, 'Всё понятно с первого раза, хотелось бы больше вариантов коней и ежедневные задания для мотивации.', 'Да', null],
    [5, 5, 'норм норм норм норм норм всё норм норм норм норм норм', 'Да', null],
  ];
  people.forEach((p, i) => {
    const [q1, q2, q3, q4, decision, rating] = fb[i];
    if (i === 5) {
      // «Быстрый» ответ: попадает в очередь с флагами автопроверки
      C.startTask(p, playtest.id);
      run("UPDATE assignments SET started_at = ? WHERE campaign_id = ? AND user_id = ?", new Date(Date.now() - 100e3).toISOString(), playtest.id, p.id);
      C.submitTask(p, playtest.id, { q1, q2, q3, q4 });
      return;
    }
    complete(p, playtest, { q1, q2, q3, q4 }, decision, rating ? { rating } : {});
  });
  complete(people[0], trailer, { q1: 'Раннер про скачки по степи с казахскими мотивами и сменой времени суток.', q2: 5, q3: 'Сеттинг' });
  complete(people[1], trailer, { q1: 'Бесконечный забег на коне, нужно уворачиваться от препятствий и собирать монеты.', q2: 4, q3: 'Графика' });


  // Демо-история Айгерим по дням (для статистики «вчера / позавчера» и серии заходов).
  // Меняются только даты демо-записей: суммы и баланс остаются согласованными с леджером.
  // Момент «d дней назад в h часов» по часовому поясу платформы
  const ago = (d, h = 12) => new Date(Date.parse(dayKey(Date.now() - d * 864e5) + 'T00:00:00Z') - config.tzOffsetMin * 60e3 + h * 3600e3).toISOString();
  const demoTx = all('SELECT id, type, ref_id FROM transactions WHERE user_id = ? ORDER BY id', demo.id);
  const rewardsTx = demoTx.filter((t) => t.type === 'task_reward');
  if (rewardsTx[0]) run('UPDATE transactions SET created_at = ? WHERE id = ?', ago(2, 15), rewardsTx[0].id);
  if (rewardsTx[1]) run('UPDATE transactions SET created_at = ? WHERE id = ?', ago(1, 13), rewardsTx[1].id);
  const red = demoTx.find((t) => t.type === 'redemption');
  if (red) {
    run('UPDATE transactions SET created_at = ? WHERE id = ?', ago(1, 19), red.id);
    // Та же дата у самой продажи: запись обмена, выручка продавца и комиссия
    run('UPDATE redemptions SET created_at = ? WHERE id = ?', ago(1, 19), red.ref_id);
    run("UPDATE transactions SET created_at = ? WHERE ref_type = 'redemption' AND ref_id = ? AND type IN ('reward_sale', 'platform_fee')", ago(1, 19), red.ref_id);
  }
  const demoSubs = all('SELECT id FROM assignments WHERE user_id = ? ORDER BY id', demo.id);
  demoSubs.forEach((a, i) => run('UPDATE assignments SET started_at = ?, submitted_at = ?, reviewed_at = ? WHERE id = ?', ago(2 - i, 12), ago(2 - i, 12.3), ago(2 - i, i ? 13 : 15), a.id));
  for (let d = 1; d <= 4; d++) run('INSERT OR IGNORE INTO user_visits (user_id, day) VALUES (?, ?)', demo.id, dayKey(Date.now() - d * 864e5));
  });
  log('[seed] демо-данные созданы: demo@attention.bank / studio@attention.bank / apps@attention.bank (пароль demo1234)');
  return true;
}
