// Стартовая ниша: Gaming & Digital Product Testing
export const CATEGORIES = [
  { id: 'game_testing', label: 'Тестирование игры', short: 'Game Testing' },
  { id: 'game_feedback', label: 'Отзыв об игре', short: 'Game Feedback' },
  { id: 'app_testing', label: 'Тестирование приложения', short: 'App Testing' },
  { id: 'ux_research', label: 'UX-исследование', short: 'UX Research' },
];

export const INTERESTS = [
  { id: 'mobile_games', label: 'Мобильные игры' },
  { id: 'pc_games', label: 'PC-игры' },
  { id: 'console_games', label: 'Консоли' },
  { id: 'indie_games', label: 'Инди-игры' },
  { id: 'esports', label: 'Киберспорт' },
  { id: 'mobile_apps', label: 'Мобильные приложения' },
  { id: 'web_services', label: 'Веб-сервисы' },
  { id: 'edtech', label: 'Образовательные сервисы' },
  { id: 'ux_design', label: 'UX и дизайн' },
  { id: 'beta_testing', label: 'Бета-тесты' },
];

export const QUESTION_TYPES = ['text', 'rating', 'choice', 'url'];

export const categoryLabel = (id) => CATEGORIES.find((c) => c.id === id)?.short || id;
export const isCategory = (id) => CATEGORIES.some((c) => c.id === id);
export const cleanInterests = (list) =>
  Array.isArray(list) ? [...new Set(list.filter((i) => INTERESTS.some((x) => x.id === i)))] : [];

// Категории наград: то, что студии и сервисы могут дать игрокам
export const REWARD_CATEGORIES = [
  { id: 'game_access', label: 'Ранний доступ' },
  { id: 'in_game', label: 'Внутриигровые предметы' },
  { id: 'subscription', label: 'Подписки и сервисы' },
  { id: 'recognition', label: 'Признание' },
];
export const isRewardCategory = (id) => REWARD_CATEGORIES.some((c) => c.id === id);

export const QUESTION_TYPE_LABELS = { rating: 'Оценка 1–5', text: 'Текстовый ответ', choice: 'Выбор варианта', url: 'Ссылка-доказательство' };
