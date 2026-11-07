# ATTENTION BANK — полный контекст проекта (для AI-ассистента)

> Этот документ даёт другому AI всё, что нужно, чтобы продолжить работу над проектом, не ломая существующую логику. Сначала прочитай раздел «Правила работы» в конце.

---

## 1. Что это за продукт

**ATTENTION BANK** — веб-платформа (Web + PWA + Telegram-бот) для добровольного и прозрачного обмена внимания на ценность.

- **Слоган:** Your Attention. Your Value. («Ваше внимание. Ваша ценность.»)
- **Команда:** SithOrder. **Конкурс:** National Founder Cup 2026, Шымкент. **Проблемная зона 4:** The Attention Economy — Digital Attention & Economy.
- **Стартовая ниша:** Gaming & Digital Product Testing — инди-студии и разработчики приложений получают проверенный фидбек; участники (геймеры, tech-аудитория) получают баллы.
- **Язык интерфейса:** русский. Сообщения Telegram-бота — русский с элементами английского («Your task was approved»).

### Главная идея
Компании платят **за подтверждённый результат**, а не за показ. Участник **заранее** видит, что нужно сделать, сколько времени это займёт, какая награда и как проверяется ответ. **AB Points** — внутренние баллы платформы: это не деньги и не криптовалюта, их нельзя вывести, только обменять на награды из каталога.

### Основной цикл
```
НАЙТИ → ВЫБРАТЬ → ВЫПОЛНИТЬ → ПРОВЕРКА → НАЧИСЛЕНИЕ → ОБМЕН
Компания создаёт кампанию (бюджет резервируется)
→ участник находит задание по интересам → «Начать задание» (сервер фиксирует время)
→ отправляет ответы → автопроверка (оценка 0–100 + флаги)
→ компания одобряет/отклоняет (или автоодобрение) → транзакция +AB участнику
→ уведомление (сайт + Telegram) → участник обменивает AB на награду (код)
→ компания видит отчёт, воронку, CSV
```

### Принципы (обязательны, без исключений)
Нет бесконечной ленты, искусственного FOMO, фальшивых таймеров и скидок, искусственного дефицита, скрытых условий, манипулятивных уведомлений. Остаток наград — реальный запас компании. Демо-данные помечены «демо». Не выдумывать реальных партнёров, цены и статистику.

### Исследование и дизайн
- `docs/RESEARCH.md` — исследование рынка и поведенческой экономики (Simon, ad-blocking, opt-in rewarded, goal-gradient Kivetz 2006, overjustification Deci 1999, качество платных ответов, тёмные паттерны ICPEN 2024, рынок Казахстана) со ссылками и выводами для продукта.
- `docs/DESIGN.md` — направление дизайна и дизайн-система.

---

## 2. Технологии и запуск

- **Node.js ≥ 22.13** (используется встроенный `node:sqlite`). **Ноль npm-зависимостей.**
- Сервер: встроенный `node:http`, без Express. База: **SQLite** (`node:sqlite`, `DatabaseSync`). `db/schema.postgres.sql` — только черновик для будущего перехода, приложение его не использует.
- Фронтенд: одна SPA на чистом JS (ES modules), hash-роутер (`#/home`), без сборки и фреймворков. PWA: `manifest.webmanifest` + `sw.js` (API не кэшируется, клик по системному уведомлению открывает нужный раздел).
- **3D:** собственный движок `public/js/ab3d.js` на чистом WebGL (без Three.js и CDN): процедурные модели, трёхточечный свет, орбитальное управление с затуханием, зум колесом и щипком, управление клавиатурой, авто-вращение с паузой, парение, салют кристаллов. Один WebGL-контекст на страницу (`<canvas id="stage3d">`, z-index 5, pointer-events: none), каждая витрина рисуется в свою область через scissor; модальное окно ПК-версии использует отдельный `Stage`.
- Telegram: прямые вызовы Bot API через `fetch`, режимы `polling` и `webhook`.
- **Сборка в один файл:** `npm run build` (esbuild, только для разработчика) собирает сервер, сайт и схему БД в **`attention-bank-v2.mjs`**. `npm start` запускает именно его. Для хостинга достаточно `package.json` и `attention-bank-v2.mjs`.

### Команды
```
npm start      # node attention-bank-v2.mjs (собранная версия)
npm run dev    # node --watch server/index.js (исходники)
npm run build  # пересобрать attention-bank-v2.mjs (нужен esbuild: npm i -D esbuild или ESBUILD_PATH)
npm test       # node --test test/flow.test.js — 19 сквозных тестов
npm run seed   # ОПАСНО: удаляет локальную БД и создаёт демо-данные заново
start-windows.bat — запуск двойным кликом на Windows
```
**После любых правок в `server/` или `public/` нужно выполнить `npm run build`**, иначе `npm start` и Render запустят старую сборку.

### Деплой (сейчас: Render, бесплатный тариф)
GitHub-репозиторий → Render Web Service. Build: `npm install`, Start: `npm start`, Root Directory пусто. На бесплатном тарифе файловая система эфемерная: SQLite сбрасывается при перезапуске или засыпании, и при старте автоматически создаются демо-данные. Сервис засыпает через 15 минут без трафика.

### Переменные окружения (`.env` или Environment на Render)
| Переменная | По умолчанию | Назначение |
|---|---|---|
| `PORT` | 3000 | порт |
| `PUBLIC_URL` | http://localhost:3000 | публичный адрес **без `/` в конце**; нужен для webhook и кнопок в Telegram |
| `DB_PATH` | ./data/attention-bank.db | путь к SQLite |
| `DEMO_MODE` | 1 | 1 — демо (демо-данные, пополнение без оплаты, пометки «демо»); 0 — продакшен |
| `SEED_DEMO` | 1 | создать демо-данные при первом запуске (только при DEMO_MODE=1 логически) |
| `TELEGRAM_BOT_TOKEN` | — | токен от @BotFather; без него бот выключен, сообщения пишутся в консоль |
| `TELEGRAM_BOT_USERNAME` | — | ник бота без @ (если пусто — берётся из getMe) |
| `TELEGRAM_GROUP_ID` | — | ID группы/канала для постов о новых заданиях (узнать: `/chatid` в группе) |
| `TELEGRAM_MODE` | polling | `webhook` для Render/HTTPS |
| `TELEGRAM_WEBHOOK_SECRET` | change-me | из него выводится секретный заголовок webhook |
| `TELEGRAM_VERIFY_BONUS` | 10 | бонус AB за первую привязку Telegram (только участникам) |
| `PLATFORM_FEE_PERCENT` | 20 | комиссия платформы с подтверждённого результата (иллюстративная модель MVP) |
| `AB_TO_KZT` | 10 | только для отображения бюджета компании в ₸ («ориентировочно») |
| `DAILY_SUBMISSION_LIMIT` | 10 | лимит отправок участника за 24 часа |

### Демо-аккаунты (пароль `demo1234`)
`demo@attention.bank` (участник Айгерим, баланс 70 AB, цель — «Qadam Premium на месяц»), `studio@attention.bank` (Nomad Pixel Studio), `apps@attention.bank` (Qadam Apps). Все демо-компании, задания и награды вымышленные и помечены `is_demo = 1`.

---

## 3. Структура файлов

```
attention-bank/
├─ package.json            type: module, engines node>=22.13, scripts
├─ attention-bank-v2.mjs   СОБРАННАЯ версия (генерируется, не править вручную)
├─ start-windows.bat
├─ .env.example
├─ scripts/build.mjs       esbuild; встраивает public/* и schema.sql в модуль assets.js
├─ server/
│  ├─ index.js             запуск: platformAccountId, seed (если включён), HTTP, Telegram
│  ├─ config.js            .env-загрузчик, config; BUNDLED (process.env.AB_BUNDLED) меняет ROOT
│  ├─ app.js               HTTP: статика/встроенные файлы, JSON body, CSRF, идемпотентность, CSP
│  ├─ routes.js            все REST-маршруты (мини-роутер GET/POST/PUT)
│  ├─ db.js                SQLite, миграции колонок, tx() с SAVEPOINT, onCommit()
│  ├─ schema.sql           схема SQLite
│  ├─ assets.js            в исходниках `export default null`; в сборке — base64-карта файлов
│  ├─ catalog.js           категории кампаний, интересы, категории наград, типы вопросов
│  ├─ util.js              HttpError, валидаторы str/int/email/url, randomCode, sha256
│  ├─ seed.js / seed-cli.js демо-данные через реальные сервисы
│  ├─ services/
│  │  ├─ auth.js           scrypt, сессии, cookie, rate-limit входа, publicUser()
│  │  ├─ ledger.js         postTransaction(), verifyLedger(), verifyAllLedgers()
│  │  ├─ campaigns.js      create/update/status, задания участника, submit, review, статистика, CSV
│  │  ├─ verification.js   validateAnswers(), scoreSubmission(), userTrust(), FLAG_INFO
│  │  ├─ rewards.js        каталог, цель, обмен, картинки (upload/get), управление наградами
│  │  ├─ home.js           /api/home, лента активности, выгрузка данных пользователя
│  │  └─ notifications.js  notify(): запись в БД + Telegram после COMMIT
│  └─ telegram/
│     ├─ api.js            call/sendMessage/linkButton, setTransport() для тестов
│     ├─ bot.js            коды привязки, linkAccount, handleUpdate (команды), startBot
│     └─ group.js          пост о новой кампании в TELEGRAM_GROUP_ID
├─ public/
│  ├─ index.html           каркас: #ribbon, .topbar, main#app, #tabbar, #toasts, dialog#modal
│  ├─ js/app.js            вся SPA
│  ├─ js/extras.js         v5: презентация (viewDeck), статистика (viewStats), маскот, туториал, аватары, серия
│  ├─ js/ab3d.js           3D-движок v2 на WebGL: PBR, отражения, тени (shadow map + PCF), ACES
│  ├─ css/app.css          дизайн-система v2
│  ├─ img/rewards/*.svg    обложки наград (6 демо + 4 по категориям)
│  ├─ icons/               logo.svg (два пересекающихся круга), PNG-иконки PWA
│  ├─ manifest.webmanifest, sw.js (кэш ab-shell-v4)
│  └─ play/                НАСТОЯЩИЕ демо-продукты для заданий (статические страницы, без сервера)
│     ├─ play.css          общая плашка «Демо-продукт»
│     ├─ steppe-runner/    runner.js (движок игры, export createRunner), index.html+game.js (игра), store.html+store.js (страница магазина + трейлер на автопилоте)
│     ├─ video/            index.html + player.js + 2 mp4 — видео-тесты с подсчётом просмотра
│     ├─ qadam/            index.html + qadam.js — прототип онбординга ЕНТ
│     └─ inventory/        index.html + inventory.js — A/B-прототип меню инвентаря с замером времени
├─ db/schema.postgres.sql  черновик
├─ docs/                   RESEARCH.md, DESIGN.md, PROJECT_CONTEXT.md
└─ test/flow.test.js       сквозные тесты (сервер на случайном порту, временная БД, подменённый Telegram)
```

---

## 4. База данных (SQLite, `server/schema.sql`)

- **users** — id, email (unique), password_hash (scrypt), name, role (`user` | `company` | `system`), company_name, interests (JSON), **balance** (кэш, CHECK ≥ 0), telegram_chat_id (unique), telegram_username, telegram_verified_at, notify_telegram, goal_reward_id, is_demo, consent_at, created_at. Роль `system` — служебный аккаунт платформы, получает комиссию.
- **sessions** — id = sha256(token), user_id, expires_at. Сам токен хранится только в HttpOnly-cookie `ab_session`.
- **campaigns** — company_id, title, description, category, product_url, audience (JSON интересов), instructions (шаги через `\n`), est_minutes, reward, fee_per_result, max_participants, min_seconds, auto_approve, require_telegram, questions (JSON), status (`active` | `paused` | `closed`), **reserved** (остаток резерва в AB), closed_at.
- **assignments** — campaign_id, user_id, **UNIQUE(campaign_id, user_id)**, status (`started` | `submitted` | `approved` | `rejected`), started_at, submitted_at, answers (JSON), auto_score, auto_flags (JSON), quality_rating (1–5), review_note, reviewed_by (`company` | `auto`), reviewed_at.
- **transactions** — user_id, amount (≠ 0, со знаком), type (`task_reward` | `bonus` | `redemption` | `deposit` | `campaign_reserve` | `campaign_refund` | `platform_fee`), title, status, ref_type, ref_id, balance_after, created_at.
- **notifications** — user_id, kind, title, body, link, read_at.
- **telegram_link_codes** — code, user_id, expires_at (15 минут), used_at.
- **rewards** — company_id, title, description, how_to_use, cost, stock (CHECK ≥ 0), active, category (`game_access` | `in_game` | `subscription` | `recognition`), image_id, cover (путь к встроенной SVG-обложке).
- **redemptions** — reward_id, user_id, code (`AB-XXXX-XXXX`), cost.
- **images** — owner_id, mime, size, data (BLOB). Только PNG, JPEG и WebP.
- **idempotency** — PK(user_id, key), route, status, response (JSON); записи старше 24 часов удаляются.
- **Миграции:** `db.js` перед выполнением schema.sql добавляет недостающие колонки через `ALTER TABLE`. Базы версии 1 обновляются без потери данных.

### Вопросы кампании (`questions` JSON)
`{ id: 'q1', type: 'rating' | 'text' | 'choice' | 'url', label, required, minLength? (text, по умолчанию 30), options? (choice, 2–10) }`. Максимум 15 вопросов. `url` — ссылка-доказательство, только http/https.

---

## 5. Бизнес-логика (важно не сломать)

### Леджер (`services/ledger.js`)
- **Единственный** способ изменить баланс — `postTransaction({ userId, amount, type, title, refType, refId })`. Внутри `tx()` вставляется транзакция и обновляется `users.balance`; уход в минус бросает 400.
- Инвариант: `users.balance == SUM(transactions.amount)`. Проверка: `verifyLedger(userId)` (показывается в UI) и `verifyAllLedgers()` (`/api/health`).

### Транзакции БД (`db.js`)
- `tx(fn)` — `BEGIN IMMEDIATE`; вложенные вызовы используют SAVEPOINT. Все обработчики финансовых операций **синхронные**.
- `onCommit(fn)` — побочные эффекты (Telegram) выполняются только после успешного COMMIT.

### Экономика кампании (`services/campaigns.js`)
- `fee_per_result = ceil(reward × PLATFORM_FEE_PERCENT / 100)`. При создании резервируется `(reward + fee) × max_participants`: транзакция `campaign_reserve` у компании, `campaigns.reserved = бюджет`.
- **Одобрение:** `reserved −= reward + fee` (только если хватает), участнику `+reward` (`task_reward`), системному аккаунту `+fee` (`platform_fee`), уведомление.
- **Отклонение:** место освобождается, денег не движется, комментарий обязателен.
- **Закрытие:** нельзя, пока есть ответы на проверке. Остаток `reserved` возвращается компании (`campaign_refund`), `reserved = 0`.
- **Редактирование** (`updateCampaign`): можно менять тексты, шаги, оценку времени, ссылку, аудиторию, min_seconds, auto_approve, require_telegram. `max_participants` увеличивается с доплатой в резерв или уменьшается с возвратом, но не ниже числа занятых мест. **`reward` и категорию после публикации менять нельзя.** Вопросы нельзя менять после первого отправленного ответа. Закрытую кампанию изменить нельзя.
- Место занято, если ответ в статусе `submitted` или `approved`.

### Выполнение задания
- `start` создаёт assignment `started`, проверяет статус кампании, свободные места и `require_telegram`.
- `submit` проверяет: ответ ещё не отправлялся, есть места, суточный лимит; затем `validateAnswers` (жёсткая валидация, 400 с `details` по каждому вопросу) и `scoreSubmission`.
- **Автопроверка** (`verification.js`): старт 100 минус штрафы — `too_fast` −40 (быстрее min_seconds), `low_effort_text` −25, `duplicate_text` −50 (тот же текст у другого участника кампании), `straight_lining` −15 (≥ 3 одинаковые оценки), `unverified_account` −10 (нет Telegram), `low_trust` −15 (много отклонений). Оценка < 30 — автоотклонение; ≥ 70 при `auto_approve` — автоодобрение; иначе ответ ждёт решения компании.
- Репутация `userTrust`: new / regular / trusted / risky — по доле одобренных ответов.

### Награды (`services/rewards.js`)
- Обмен: проверка активности и остатка, `stock − 1`, код `AB-XXXX-XXXX`, транзакция `redemption`; если награда была целью — цель снимается.
- **Цель** (`goal_reward_id`): прогресс = баланс / цена. `pathToGoal` в `home.js` жадно подбирает открытые задания до нужной суммы и честно помечает те, где нужен Telegram. Иллюзорный прогресс запрещён.
- Картинки: компания загружает base64 JSON (`POST /api/images`, до 1,5 МБ). Проверяются mime и сигнатура файла, SVG запрещён. Отдаются с `nosniff` и `CSP sandbox`. URL: `/api/images/:id`; без картинки — `cover` или `/img/rewards/cat-<category>.svg`.

### Telegram (`server/telegram/`)
- Привязка: сайт выдаёт одноразовый код (15 минут) и deep link `t.me/<bot>?start=<code>` → `/start CODE` → `linkAccount`: один Telegram — один аккаунт, бонус за первую верификацию.
- Команды в личке: `/start`, `/balance`, `/history`, `/tasks`, `/unlink`, `/help`. В группе: `/tasks`, `/chatid`.
- Уведомления идут через `notify()` и учитывают `notify_telegram`. Одобрение: «🎉 +N AB Points / Your task was approved / New balance: X AB».
- Webhook: `POST /api/telegram/webhook`, проверяется заголовок `X-Telegram-Bot-Api-Secret-Token = sha256(TELEGRAM_WEBHOOK_SECRET)`. Один бот может слать webhook только на один сервер.
- В тестах транспорт подменяется через `setTransport()`.

---

## 6. API (все ответы JSON; ошибки `{ error, details? }`)

**Публичные:** `GET /api/meta` (категории, интересы, категории наград, типы вопросов, экономика, верификация, telegram, demoMode) · `GET /api/stats` · `GET /api/public/rewards` · `GET /api/health`

**Аутентификация:** `POST /api/auth/register` (role, email, password ≥ 8, name, companyName, consent, ageConfirmed для участников 16+) · `POST /api/auth/login` · `POST /api/auth/logout` · `GET /api/me` · `PUT /api/me` (name, interests, notifyTelegram — баланс и роль игнорируются) · `GET /api/me/export` (JSON-файл) · `PUT /api/me/goal` (rewardId | null)

**Участник:** `GET /api/home` · `GET /api/activity` · `GET /api/tasks` · `GET /api/tasks/:id` · `POST /api/tasks/:id/start` · `POST /api/tasks/:id/submit`* · `GET /api/my/submissions` · `GET /api/wallet` · `GET /api/rewards` · `GET /api/rewards/:id` · `POST /api/rewards/:id/redeem`* · `GET/POST /api/notifications(/read)` · `POST /api/telegram/link-code` · `POST /api/telegram/unlink`

**Компания:** `GET /api/company/overview` · `POST /api/company/campaigns`* · `GET /api/company/campaigns/:id` · `PUT /api/company/campaigns/:id`* · `POST /api/company/campaigns/:id/status`* · `GET /api/company/campaigns/:id/export.csv` · `POST /api/company/submissions/:id/review`* (decision approve/reject, rating 1–5, note) · `POST /api/company/deposit`* (только в демо-режиме) · `GET/POST /api/company/rewards`* · `PUT /api/company/rewards/:id` (active, addStock) · `POST /api/images` · `GET /api/images/:id`

\* — **идемпотентные** маршруты: принимают `Idempotency-Key` (8–100 символов `[A-Za-z0-9_-]`). Повтор с тем же ключом возвращает сохранённый ответ с заголовком `Idempotent-Replay: true`. Тот же ключ на другом маршруте — 422. Обработчики этих маршрутов обязаны быть синхронными (проверка и запись ключа без `await` между ними). Клиент генерирует ключ автоматически (`api(..., { idem: true })`).

---

## 7. Безопасность

- Пароли — scrypt с солью; сессии — случайный токен в HttpOnly SameSite=Lax cookie (Secure при https), в БД хранится sha256.
- CSRF: не-GET запросы принимаются только с `Content-Type: application/json` и Origin своего хоста.
- Ограничение попыток входа: 10 за 15 минут на пару IP + email.
- Роли проверяются в каждом маршруте (`need(ctx, 'user' | 'company')`); чужие кампании, награды и картинки — 403/400.
- CSP: `script-src 'self'`; стили `'self' 'unsafe-inline'` + Google Fonts; `img-src 'self' data: blob:`. Плюс X-Frame-Options DENY и nosniff.
- Экспорт CSV защищён от формул Excel; JSON-выгрузка не содержит хэш пароля.
- Клиент никогда не вычисляет баланс сам — только показывает данные сервера.

---

## 8. Фронтенд (`public/js/app.js`, `public/css/app.css`)

### Дизайн-система «Прозрачная обменная касса» (v3: тёмная кинематографичная тема)
- Цвета: фон `#060C14` / `#0E1A2B`, текст `--ink: #E8EEF4`, бирюзовый `#19B3D4` («внимание»), золото `#F2B705` («ценность», AB, прогресс), ok `#3DD68C`, bad `#FF7A66`, wait `#F5B547`. Поверхности — стекло: `rgba(255,255,255,.045)` + `backdrop-filter: blur(20px)` + светлая грань `inset 0 1px 0 rgba(255,255,255,.07)`.
- 3D-витрины: элемент с `data-3d data-model="logo|game_access|in_game|subscription|recognition" data-variant data-wheel="focus|always" data-touch="pan-y|none" data-href`. Их автоматически подключает `enhance()` (MutationObserver на `#app`). Если у награды есть загруженная компанией картинка (`/api/images/…`), показывается фото, а не 3D. Без WebGL остаётся обычная картинка.
- Карточки `.tilt` наклоняются за курсором (только мышь, учитывается reduced-motion).
- **ПК-версия:** кнопка `[data-desktop]` в шапке и профиле → окно с 3D-знаком и настоящей установкой PWA (`beforeinstallprompt`) или инструкцией для браузера. Поддельных установщиков нет.
- **Системные уведомления:** `osNote` (Notification API + `registration.showNotification`); включаются в настройках или окне ПК-версии; срабатывают, пока сайт или приложение открыты (в том числе в фоне). Настоящий Web Push при закрытом приложении требует серверного VAPID — его нет.
- **Обмен:** после `POST /api/rewards/:id/redeem` (с Idempotency-Key) — салют кристаллов над 3D-витриной и чек с кодом `AB-XXXX-XXXX` и кнопкой копирования.
- **Задания:** фильтры по категории, минимальной награде, времени и сортировка (награда, быстрее, лучший обмен AB за минуту); метка обмена `≈ 15 МИН ВНИМАНИЯ ⇄ +50 AB POINTS`.
- Шрифты: **Geologica** (заголовки, баланс, цены), **Onest** (текст); цифры с tabular-nums.
- Фирменные элементы: строка обмена `≈ 15 мин ⇄ +50 AB` в заданиях, золотая полоса прогресса к цели, штамп «Подтверждено». Тени почти не используются. Анимации: заполнение полосы цели и штамп; учитывается `prefers-reduced-motion`.
- Адаптив проверен на 360 / 390 / 430 / 768 / 1024 / 1440 / 1920 px. На мобильных — нижняя панель вкладок, полка наград с горизонтальной прокруткой.

### v5: новые серверные части
- `server/services/stats.js`: `recordVisit` (таблица `user_visits`, отмечается в `GET /api/me`), `streak`, `dailyChallenge`, `userStats` → `GET /api/me/stats`; краткая версия в `/api/home` → `pulse`. Дни считаются в `TZ_OFFSET_MIN`.
- `server/services/mascot.js`: `POST /api/mascot/ask` (доступен гостям). С `ANTHROPIC_API_KEY` — Claude (`MASCOT_MODEL`), иначе FAQ; ответ `{ answer, source: 'ai'|'faq' }`; лимит `MASCOT_QUESTIONS_PER_HOUR`.
- Колонки: `users.avatar` (a1…a12, `PUT /api/me { avatar }`), `rewards.platform` (steam | epic | google_play | app_store | in_game | web).
- Контрольные вопросы: у choice-вопроса поле `correct`; участникам отдаётся `check: true` без ответа; флаг `failed_attention_check` (−45).
- Категория кампаний `video_review`. Статика `.mp4` отдаётся с Range (206).

### Демо-продукты (`public/play/`)
- Ссылки задаются в `server/seed.js` как `${config.publicUrl}/play/...` (полные пути к `.html`: каталог без файла отдаёт SPA). В клиенте `productHref()` переписывает любую ссылку на `/play/...` на текущий домен.
- CSP запрещает инлайн-скрипты, поэтому весь JS — внешние модули; стили инлайн разрешены.
- Ничего не отправляют на сервер: статистика (время, промахи, падения) показывается тестировщику с кнопкой «Скопировать», чтобы он сам вставил её в ответ. Начисления по-прежнему только через проверку ответа и леджер.

### Маршруты SPA
Гость: `#/` (лендинг), `#/about`, `#/login`, `#/register(?role=company)`.
Участник: `#/onboarding`, `#/home`, `#/rewards` (фильтры cat/only/sort в query), `#/rewards/:id`, `#/tasks` (tab/all/cat), `#/tasks/:id`, `#/activity`, `#/profile`, `#/settings`, `#/notifications`.
Компания: `#/company`, `#/company/new`, `#/company/campaigns/:id(?tab=review|report|all)`, `#/company/campaigns/:id/edit`, `#/company/rewards`, `#/budget`, `#/profile`, `#/settings`.

### Устройство клиента
- `state` (me, meta, unread…). `api()` — fetch с JSON и опциональным Idempotency-Key. `router()` проверяет авторизацию и роль.
- Компоненты-функции возвращают HTML-строки: `rewardCard`, `ticket`, `exchange`, `meter`, `feedGrouped`, `empty`. **Все пользовательские строки проходят через `esc()`.**
- `busy(btn, fn)` — состояние загрузки кнопки; `confirmDialog` / `infoDialog` — нативный `<dialog>`; `toast()`.
- Опрос `/api/me` каждые 10 секунд: новые уведомления показываются тостами, страница перерисовывается при изменении баланса (`state.onReward`).
- Демо-плашка сверху показывается, если `meta.demoMode`.

---

## 9. Тесты (`npm test`, 24 штуки, все проходят; test/seed.test.js проверяет демо-данные)
Регистрация и запрет смены баланса/роли; резерв бюджета; валидация ответов; дубликаты; Telegram (код, бонус, повтор кода, 1 Telegram = 1 аккаунт, /balance); одобрение → транзакция → сообщение «+50 AB Points / New balance»; награды и запрет ухода в минус; возврат при закрытии; CSRF, webhook без секрета, обнаружение подмены баланса; идемпотентность (повтор пополнения, двойной клик «Одобрить», повтор обмена возвращает тот же код, 422 при чужом ключе); редактирование кампании (резерв и возврат, запрет смены награды, чужая кампания 403); ссылка-доказательство; блокировка вопросов; загрузка картинок (сигнатура, запрет SVG, роли, чужая картинка); цель/главная/каталог; активность и выгрузка; отключение пополнения в продакшене; публичный каталог.

---

## 10. Текущее состояние и ограничения
- Работает: всё перечисленное выше. Демо развёрнуто на Render (бесплатный тариф, webhook-бот).
- Ограничения: демо-продукты в `public/play/` не передают телеметрию на сервер (честно: тестировщик копирует итоги сам); системные уведомления работают только пока сайт/приложение открыты (нет серверного Web Push); SQLite на Render сбрасывается при перезапуске (нужна PostgreSQL или постоянный диск); пополнение бюджета — демо без платёжного шлюза; нет восстановления пароля и подтверждения email; нет админ-панели и модерации кампаний; нет загрузки файлов-доказательств (только ссылка); проценты экономики иллюстративные.
- Возможные следующие шаги: переход на PostgreSQL (адаптер БД), платёжный шлюз, модерация кампаний, восстановление пароля, расширенный антифрод, загрузка скриншотов-доказательств.

---

## 11. Правила работы для AI (обязательно)
1. **Не менять стек** без явной причины: без фреймворков, без новых npm-зависимостей в runtime. Сервер — `node:http`, БД — `node:sqlite`, клиент — чистый JS.
2. **Не ослаблять защиту:** баланс меняется только через `postTransaction` внутри `tx()`; не убирать проверки ролей, резерв бюджета, идемпотентность, лимиты, валидацию, CSRF, CSP.
3. Новые финансовые маршруты: помечать `{ idempotent: true }`, обработчик делать синхронным, использовать `tx()`. Побочные эффекты — через `onCommit` или `notify`.
4. Новые колонки БД добавлять и в `schema.sql`, и в массив `MIGRATIONS` в `db.js`.
5. Во фронтенде экранировать все данные через `esc()`; не хранить секреты на клиенте; каждая кнопка — реальное действие с состоянием загрузки и обратной связью.
6. Не выдумывать партнёров, награды, цены и статистику; демо-данные помечать `is_demo`.
7. Соблюдать принципы честного дизайна (раздел 1) и дизайн-систему (раздел 8, `docs/DESIGN.md`).
8. После изменений: `npm test`, `node --check` изменённых файлов, `npm run build`, проверка в браузере.
9. **Не запускать `npm run seed`** на данных, которые нужно сохранить, не удалять БД, не коммитить `.env`, `*.db`, `*-wal`, `*-shm`.
10. Тексты интерфейса — на русском, простыми глаголами, в sentence case; кнопка называет действие («Получить за 80 AB», «Одобрить, +50 AB»).
