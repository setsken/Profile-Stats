// Profile Stats popup.
// All API calls go through background.js so the service worker keeps the
// in-memory token + cache hot for content scripts and the side panel.

const PROFILE_STATS_API = 'https://profile-stats-production.up.railway.app/api';
const STATS_EDITOR_EXTENSION_ID = 'mflgdblgjakdfkjnfdkfmmobgppgjgom';

// ==================== i18n ====================
// Two-language dictionary for the entire popup. Use t('key') for plain text
// and t('key', { name: 'value' }) for {name}-style interpolation. HTML markup
// is consumed by data-i18n attributes (textContent), data-i18n-placeholder
// (input placeholder), and data-i18n-title (tooltip).
let currentLang = 'en';
const I18N = {
  en: {
    // App / branding
    appTitle: 'Profile Stats',
    // Auth — login
    loginSubtitle: 'Sign in to continue',
    ssoButton: 'Sign in with Stats Editor',
    ssoTitle: 'Use your Stats Editor account',
    dividerOr: 'or',
    email: 'Email',
    emailPlaceholder: 'your@email.com',
    password: 'Password',
    forgotPassword: 'Forgot password?',
    signIn: 'Sign In',
    signInLink: 'Sign in',
    noAccount: "Don't have an account?",
    createOne: 'Create one',
    // Auth — register
    registerTitle: 'Create Account',
    registerSubtitle: '7 days of Profile Stats free',
    passwordMin6: 'Min 6 characters',
    createAccount: 'Create Account',
    haveAccount: 'Already have an account?',
    // Auth — forgot
    resetTitle: 'Reset Password',
    resetSubtitle: 'Enter your email to receive a reset code',
    sendResetCode: 'Send Reset Code',
    backToSignIn: 'Back to sign in',
    // Auth — errors / status
    loginFailed: 'Login failed',
    registerFailed: 'Registration failed',
    accountCreatedCheckEmail: 'Account created. Check your email then sign in.',
    forgotFailed: 'Failed to send reset code',
    forgotSuccess: 'Reset code sent. Check your email.',
    ssoNotAuth: 'Sign in to Stats Editor first, then click this button again.',
    ssoNoExt: 'Stats Editor extension is not installed or disabled.',
    ssoFailed: 'SSO failed',
    ssoStoreFailed: 'Failed to store token',
    // Header / actions
    pluginToggleTitle: 'Enable / Disable Profile Stats',
    notifications: 'Notifications',
    openSidePanel: 'Open in side panel',
    closeSidePanel: 'Close side panel',
    menu: 'Menu',
    back: 'Back',
    close: 'Close',
    clearAll: 'Clear all',
    noNotificationsYet: 'No notifications yet',
    // Subscription header chips
    subActive: 'Active',
    subPro: 'PRO',
    subInactiveLabel: 'No plan',
    subNone: 'NO PLAN',
    // Menu
    menuSettings: 'Settings',
    menuSubscription: 'Subscription',
    menuSupport: 'Support',
    menuLogout: 'Logout',
    // Tabs
    tabTop: 'Top Models',
    tabNotes: 'Notes',
    // Notes sub-tabs
    subtabNote: 'Note',
    subtabTags: 'Tags',
    subtabModels: 'Models',
    // Top Models / leaderboard
    searchUsername: 'Search @username…',
    sortBy: 'Sort by',
    sortScore: 'Score',
    sortFans: 'Fans',
    sortQuality: 'Quality',
    sortRecent: 'Recent',
    filters: 'Filters',
    filterSectionScore: 'Score',
    filterSectionAudience: 'Audience',
    filterSectionActivity: 'Activity',
    filterSectionPrice: 'Subscription price ($)',
    filterMin: 'Min',
    filterMax: 'Max',
    filterAny: 'Any',
    filterMinScore: 'Min score',
    filterMaxScore: 'Max score',
    filterMinFans: 'Min fans',
    filterMinQuality: 'Min quality %',
    filterMinPosts: 'Min posts',
    filterMinVideos: 'Min videos',
    filterMinStreams: 'Min streams',
    filterMinAge: 'Min age (months)',
    filterMinPrice: 'Min price ($)',
    filterMaxPrice: 'Max price ($)',
    filterSocials: 'Socials',
    socialsAny: 'Any',
    socialsWith: 'With socials only',
    socialsWithout: 'No socials only',
    apply: 'Apply',
    reset: 'Reset',
    filterNote: 'Filters fill in for models that have been recently viewed. Older models without data are excluded only when a min/max value is set.',
    loading: 'Loading…',
    loadMore: 'Load more',
    failedToLoad: 'Failed to load',
    noModelsMatch: 'No models match these filters.',
    showingOf: 'Showing {n} of {total}',
    fansLabel: 'Fans',
    qualityLabel: 'Quality',
    metaFansQuality: 'Fans: {fans} · Quality: {quality}%',
    gradeTitle: 'Grade {grade}',
    writeNote: 'Write a note',
    editNote: 'Edit your note',
    // Notes — editor
    pickModelHint: 'Pick a model from the <b>Models</b> tab to edit its note,<br>or type a username below to add a new one.',
    modelUsername: 'Model username',
    usernamePh: '@username',
    openEditor: 'Open editor',
    pickAnother: 'Pick another',
    notePlaceholder: 'Write your note about this model…',
    tagsLabel: 'Tags',
    save: 'Save',
    deleteTitle: 'Delete',
    noTagsYet: 'No tags yet — open the Tags sub-tab to create some.',
    failedSave: 'Failed to save',
    failedDelete: 'Failed to delete',
    deleteNoteTitle: 'Delete note',
    deleteNoteMsg: 'Are you sure you want to delete the note for @{username}? This cannot be undone.',
    deleteNoteBtn: 'Delete',
    // Notes — tags
    createTag: 'Create tag',
    tagNamePh: "Tag name (e.g. 'Top performer')",
    addTag: 'Add',
    yourTags: 'Your tags',
    noTagsList: 'No tags yet. Create one above.',
    nameRequired: 'Name is required',
    tagExists: 'A tag with this name already exists',
    failedSyncTags: 'Failed to sync tags',
    deleteTagTitle: 'Delete tag',
    deleteTagMsg: 'Are you sure you want to delete "{name}"? It will be removed from every note that uses it.',
    // Notes — models list
    noNotesYet: 'No notes yet.',
    noNotesHint: 'Open Note tab and type a username, or write a note from the badge on any profile.',
    noModelsMatchSearch: 'No models match.',
    noText: '(no text)',
    deleteNoteTooltip: 'Delete note',
    // Subscription page
    activeUntil: '{plan} until {date}',
    activeUntilVia: '{plan} until {date} (via Stats Editor Pro)',
    noActiveSub: 'No active subscription',
    unlockTitle: 'Unlock Profile Stats',
    unlockDesc: 'Get badges, AI verdict, fan trends, notes and alerts on every model profile.',
    unlockFeatures: [
      'Badge on every OF profile (score, grade, percentile)',
      'AI verdict on profile quality',
      'Fan trend chart',
      'Personal notes and tags (cloud sync)',
      'Smart alerts on score changes'
    ],
    perMonth: '/month',
    buyButton: 'Buy Profile Stats',
    couldNotStartPayment: 'Could not start payment',
    // Renew (active subscription)
    renewTitle: 'Extend your subscription',
    renewDesc: 'Add another month of Profile Stats. Days are stacked on top of your current expiration.',
    renewButton: 'Renew for $15',
    subscribeButton: 'Subscribe for $15',
    inheritedTitle: 'Profile Stats is included',
    inheritedDesc: 'Your Stats Editor Pro plan grants Profile Stats automatically. You can also subscribe separately so Profile Stats keeps running if Pro ends, or redeem a promo code.',
    // Network selection
    selectNetwork: 'Select Network',
    selectNetworkSub: 'Pay $15 USDT in your preferred network',
    youPayExactly: 'You pay exactly',
    noExtraFees: 'No extra fees.',
    networkFailed: 'Could not start payment. Try another network or refresh.',
    // Promo
    promoCodeLabel: 'Have a promo code?',
    promoCodePh: 'Enter code',
    promoApply: 'Apply',
    promoEnterCode: 'Please enter a promo code',
    promoActivated: 'Promo code activated! {days} days added.',
    promoActivatedTitle: 'Promo Code Activated',
    promoActivatedNotif: 'Code "{code}" activated. {days} days of Profile Stats added.',
    promoInvalid: 'Invalid promo code',
    promoExpired: 'This promo code is no longer active',
    promoLimitReached: 'This promo code has reached its usage limit',
    promoAlreadyUsed: 'You have already used this promo code',
    promoWrongProduct: 'This code is not valid for Profile Stats',
    promoNetworkError: 'Network error. Please try again.',
    promoFailed: 'Failed to apply promo code',
    // Settings
    settingsEnable: 'Enable Profile Stats',
    settingsEnableSub: 'Show badges on OnlyFans profile pages',
    settingsVerdict: 'Verdict AI',
    settingsVerdictSub: 'Show or hide the AI verdict card inside the badge',
    settingsLanguage: 'Language',
    settingsLanguageSub: 'Switch the popup and badge language',
    // Paywall (popup tabs)
    paywallPopupTitle: 'Subscription required',
    paywallPopupHint: 'Activate Profile Stats to unlock Top Models, Notes, and the badge analytics on every OF profile.',
    paywallRenewBtn: 'Renew Subscription',
    // Support
    supportText: 'Need help? Email us at:',
    contactSupport: 'Contact Support',
    supportPromo: 'Found a bug? Report it and get 1 month of Profile Stats free!',
    supportYourEmail: 'Your email',
    supportSubjectLabel: 'Subject',
    supportSubjectDefault: 'Bug Report — Profile Stats',
    supportMessageLabel: 'Message',
    supportMessagePh: 'Describe the issue: what happened, on which page, what you expected…',
    send: 'Send',
    supportTooShort: 'Please describe the issue (at least 10 characters).',
    supportFailed: 'Could not send. Please try again later.',
    supportSentTitle: 'Message sent!',
    supportSentMsg: "We'll get back to you shortly at:",
    supportSentHint: "We typically reply within 24 hours. If your report leads to a confirmed bug fix, you'll get 1 month of Profile Stats free.",
    done: 'Done',
    // Payment
    completePayment: 'Complete payment',
    paymentInfo: "A NOWPayments invoice was opened in a new tab. Complete the payment there — we'll detect it automatically.",
    paymentWaiting: 'Waiting for payment…',
    paymentWaitingConfirm: 'Waiting for payment confirmation…',
    paymentStatusFmt: 'Status: {status}',
    paymentPending: 'pending',
    reopenInvoice: 'Reopen invoice in browser',
    sendExactly: 'Send exactly:',
    toAddress: 'To address:',
    timeRemaining: 'Time remaining',
    expired: 'Expired',
    verifyPayment: 'Verify Payment',
    verifyingPayment: 'Verifying payment…',
    paymentConfirmed: 'Payment confirmed!',
    paymentPartial: 'Incomplete payment received. Please send the remaining amount.',
    paymentNetworkErr: 'Connection error. Retrying automatically…',
    copy: 'Copy address',
    cancelPaymentTitle: 'Cancel payment?',
    cancelPaymentMsg: 'If you leave now, this invoice will be cancelled. You can start a new payment any time.',
    cancelPaymentYes: 'Cancel payment',
    cancelPaymentNo: 'Keep paying',
    // Confirm modal
    confirm: 'Confirm',
    cancel: 'Cancel',
    // Notifications (system)
    notifSubExpiring: 'Subscription expires soon',
    notifSubExpiringTomorrow: 'Your Profile Stats access ends tomorrow. Renew to keep the badge alive.',
    notifSubExpiringDays: 'Your Profile Stats access ends in {n} days.',
    notifSubExpired: 'Subscription expired',
    notifSubExpiredMsg: 'Renew Profile Stats to bring the badge and analytics back.',
    notifNoSub: 'No active subscription',
    notifNoSubMsg: 'Profile Stats analytics require an active plan.',
    notifSubActivated: 'Subscription activated',
    notifSubActivatedMsg: 'Profile Stats is live on your account. Enjoy!',
    // Time-ago
    justNow: 'just now',
    minutesAgo: '{n}m ago',
    hoursAgo: '{n}h ago',
    daysAgo: '{n}d ago',
    dismiss: 'Dismiss'
  },
  ru: {
    appTitle: 'Profile Stats',
    loginSubtitle: 'Войдите для продолжения',
    ssoButton: 'Войти через Stats Editor',
    ssoTitle: 'Использовать аккаунт Stats Editor',
    dividerOr: 'или',
    email: 'Email',
    emailPlaceholder: 'your@email.com',
    password: 'Пароль',
    forgotPassword: 'Забыли пароль?',
    signIn: 'Войти',
    signInLink: 'Войти',
    noAccount: 'Нет аккаунта?',
    createOne: 'Создать',
    registerTitle: 'Создать аккаунт',
    registerSubtitle: '7 дней Profile Stats бесплатно',
    passwordMin6: 'Минимум 6 символов',
    createAccount: 'Создать аккаунт',
    haveAccount: 'Уже есть аккаунт?',
    resetTitle: 'Сброс пароля',
    resetSubtitle: 'Введите email для получения кода сброса',
    sendResetCode: 'Отправить код',
    backToSignIn: 'Назад ко входу',
    loginFailed: 'Не удалось войти',
    registerFailed: 'Не удалось зарегистрироваться',
    accountCreatedCheckEmail: 'Аккаунт создан. Проверьте email и войдите.',
    forgotFailed: 'Не удалось отправить код',
    forgotSuccess: 'Код сброса отправлен. Проверьте email.',
    ssoNotAuth: 'Сначала войдите в Stats Editor, затем нажмите кнопку снова.',
    ssoNoExt: 'Расширение Stats Editor не установлено или отключено.',
    ssoFailed: 'Ошибка SSO',
    ssoStoreFailed: 'Не удалось сохранить токен',
    pluginToggleTitle: 'Включить / выключить Profile Stats',
    notifications: 'Уведомления',
    openSidePanel: 'Открыть в боковой панели',
    closeSidePanel: 'Закрыть боковую панель',
    menu: 'Меню',
    back: 'Назад',
    close: 'Закрыть',
    clearAll: 'Очистить всё',
    noNotificationsYet: 'Уведомлений пока нет',
    subActive: 'Активна',
    subPro: 'PRO',
    subInactiveLabel: 'Нет плана',
    subNone: 'НЕТ ПЛАНА',
    menuSettings: 'Настройки',
    menuSubscription: 'Подписка',
    menuSupport: 'Поддержка',
    menuLogout: 'Выйти',
    tabTop: 'Топ моделей',
    tabNotes: 'Заметки',
    subtabNote: 'Заметка',
    subtabTags: 'Теги',
    subtabModels: 'Модели',
    searchUsername: 'Поиск по @username…',
    sortBy: 'Сортировка',
    sortScore: 'Скор',
    sortFans: 'Фаны',
    sortQuality: 'Качество',
    sortRecent: 'Недавние',
    filters: 'Фильтры',
    filterSectionScore: 'Скор',
    filterSectionAudience: 'Аудитория',
    filterSectionActivity: 'Активность',
    filterSectionPrice: 'Цена подписки ($)',
    filterMin: 'Мин',
    filterMax: 'Макс',
    filterAny: 'Любая',
    filterMinScore: 'Мин. скор',
    filterMaxScore: 'Макс. скор',
    filterMinFans: 'Мин. фанов',
    filterMinQuality: 'Мин. качество %',
    filterMinPosts: 'Мин. постов',
    filterMinVideos: 'Мин. видео',
    filterMinStreams: 'Мин. стримов',
    filterMinAge: 'Мин. возраст (мес.)',
    filterMinPrice: 'Мин. цена ($)',
    filterMaxPrice: 'Макс. цена ($)',
    filterSocials: 'Соцсети',
    socialsAny: 'Любые',
    socialsWith: 'Только с соцсетями',
    socialsWithout: 'Только без соцсетей',
    apply: 'Применить',
    reset: 'Сбросить',
    filterNote: 'Фильтры применяются к моделям, которые недавно просматривались. Модели без данных исключаются только при заданных мин./макс. значениях.',
    loading: 'Загрузка…',
    loadMore: 'Загрузить ещё',
    failedToLoad: 'Не удалось загрузить',
    noModelsMatch: 'Нет моделей под эти фильтры.',
    showingOf: 'Показано {n} из {total}',
    fansLabel: 'Фаны',
    qualityLabel: 'Качество',
    metaFansQuality: 'Фаны: {fans} · Качество: {quality}%',
    gradeTitle: 'Оценка {grade}',
    writeNote: 'Написать заметку',
    editNote: 'Редактировать заметку',
    pickModelHint: 'Выберите модель из вкладки <b>Модели</b> для редактирования заметки,<br>или введите username ниже чтобы добавить новую.',
    modelUsername: 'Username модели',
    usernamePh: '@username',
    openEditor: 'Открыть редактор',
    pickAnother: 'Выбрать другую',
    notePlaceholder: 'Напишите заметку об этой модели…',
    tagsLabel: 'Теги',
    save: 'Сохранить',
    deleteTitle: 'Удалить',
    noTagsYet: 'Тегов пока нет — откройте вкладку Теги чтобы создать.',
    failedSave: 'Не удалось сохранить',
    failedDelete: 'Не удалось удалить',
    deleteNoteTitle: 'Удалить заметку',
    deleteNoteMsg: 'Удалить заметку для @{username}? Это действие нельзя отменить.',
    deleteNoteBtn: 'Удалить',
    createTag: 'Создать тег',
    tagNamePh: 'Название тега (напр. «Топ»)',
    addTag: 'Добавить',
    yourTags: 'Ваши теги',
    noTagsList: 'Тегов нет. Создайте выше.',
    nameRequired: 'Название обязательно',
    tagExists: 'Тег с таким названием уже существует',
    failedSyncTags: 'Не удалось синхронизировать теги',
    deleteTagTitle: 'Удалить тег',
    deleteTagMsg: 'Удалить тег «{name}»? Он будет удалён из всех заметок где используется.',
    noNotesYet: 'Заметок пока нет.',
    noNotesHint: 'Откройте вкладку Заметка и введите username, или напишите заметку из бейджа на любом профиле.',
    noModelsMatchSearch: 'Нет совпадений.',
    noText: '(нет текста)',
    deleteNoteTooltip: 'Удалить заметку',
    activeUntil: '{plan} до {date}',
    activeUntilVia: '{plan} до {date} (через Stats Editor Pro)',
    noActiveSub: 'Нет активной подписки',
    unlockTitle: 'Откройте Profile Stats',
    unlockDesc: 'Получите бейджи, AI-вердикт, тренды фанов, заметки и уведомления на каждом профиле модели.',
    unlockFeatures: [
      'Бейдж на каждом профиле OF',
      'AI-вердикт по качеству профиля',
      'График тренда фанов',
      'Личные заметки и теги (облачная синхронизация)',
      'Умные уведомления об изменении скора'
    ],
    perMonth: '/мес',
    buyButton: 'Купить Profile Stats',
    couldNotStartPayment: 'Не удалось начать оплату',
    renewTitle: 'Продлить подписку',
    renewDesc: 'Добавьте ещё месяц Profile Stats. Дни добавляются к текущему сроку действия.',
    renewButton: 'Продлить за $15',
    subscribeButton: 'Подписаться за $15',
    inheritedTitle: 'Profile Stats уже включён',
    inheritedDesc: 'Ваш план Stats Editor Pro автоматически даёт доступ к Profile Stats. Можно также оформить отдельную подписку — она продолжит работать, если Pro истечёт, либо применить промокод.',
    selectNetwork: 'Выберите сеть',
    selectNetworkSub: 'Оплата $15 USDT в выбранной сети',
    youPayExactly: 'Вы платите ровно',
    noExtraFees: 'Без скрытых комиссий.',
    networkFailed: 'Не удалось создать счёт. Попробуйте другую сеть или обновите.',
    promoCodeLabel: 'Есть промокод?',
    promoCodePh: 'Введите код',
    promoApply: 'Применить',
    promoEnterCode: 'Введите промокод',
    promoActivated: 'Промокод активирован! Добавлено {days} дн.',
    promoActivatedTitle: 'Промокод активирован',
    promoActivatedNotif: 'Код «{code}» активирован. Добавлено {days} дн. Profile Stats.',
    promoInvalid: 'Неверный промокод',
    promoExpired: 'Промокод неактивен',
    promoLimitReached: 'Лимит использований промокода исчерпан',
    promoAlreadyUsed: 'Вы уже использовали этот промокод',
    promoWrongProduct: 'Этот код не подходит для Profile Stats',
    promoNetworkError: 'Ошибка сети. Попробуйте ещё раз.',
    promoFailed: 'Не удалось применить промокод',
    settingsEnable: 'Включить Profile Stats',
    settingsEnableSub: 'Показывать бейджи на страницах профилей OnlyFans',
    settingsVerdict: 'Verdict AI',
    settingsVerdictSub: 'Показывать или скрывать карточку AI-вердикта в бейдже',
    settingsLanguage: 'Язык',
    settingsLanguageSub: 'Переключить язык попапа и бейджа',
    paywallPopupTitle: 'Требуется подписка',
    paywallPopupHint: 'Активируйте Profile Stats чтобы открыть Топ моделей, Заметки и аналитику на бейдже каждого профиля OF.',
    paywallRenewBtn: 'Продлить подписку',
    supportText: 'Нужна помощь? Напишите нам:',
    contactSupport: 'Связаться с поддержкой',
    supportPromo: 'Нашли баг? Сообщите и получите 1 месяц Profile Stats бесплатно!',
    supportYourEmail: 'Ваш email',
    supportSubjectLabel: 'Тема',
    supportSubjectDefault: 'Баг-репорт — Profile Stats',
    supportMessageLabel: 'Сообщение',
    supportMessagePh: 'Опишите проблему: что произошло, на какой странице, что ожидали…',
    send: 'Отправить',
    supportTooShort: 'Опишите проблему подробнее (минимум 10 символов).',
    supportFailed: 'Не удалось отправить. Попробуйте позже.',
    supportSentTitle: 'Сообщение отправлено!',
    supportSentMsg: 'Мы скоро ответим на:',
    supportSentHint: 'Обычно отвечаем в течение 24 часов. Если ваш баг-репорт подтвердится — получите 1 месяц Profile Stats бесплатно.',
    done: 'Готово',
    completePayment: 'Завершить оплату',
    paymentInfo: 'Счёт NOWPayments открыт в новой вкладке. Завершите оплату там — мы определим её автоматически.',
    paymentWaiting: 'Ожидание оплаты…',
    paymentWaitingConfirm: 'Ожидание подтверждения оплаты…',
    paymentStatusFmt: 'Статус: {status}',
    paymentPending: 'ожидание',
    reopenInvoice: 'Открыть счёт в браузере',
    sendExactly: 'Отправьте ровно:',
    toAddress: 'На адрес:',
    timeRemaining: 'Осталось времени',
    expired: 'Истекло',
    verifyPayment: 'Проверить оплату',
    verifyingPayment: 'Проверка оплаты…',
    paymentConfirmed: 'Оплата подтверждена!',
    paymentPartial: 'Получена неполная оплата. Отправьте оставшуюся сумму.',
    paymentNetworkErr: 'Ошибка соединения. Повторяем автоматически…',
    copy: 'Скопировать адрес',
    cancelPaymentTitle: 'Отменить оплату?',
    cancelPaymentMsg: 'Если выйти сейчас, текущий счёт будет отменён. Новый платёж можно создать в любой момент.',
    cancelPaymentYes: 'Отменить',
    cancelPaymentNo: 'Продолжить оплату',
    confirm: 'Подтвердить',
    cancel: 'Отмена',
    notifSubExpiring: 'Подписка скоро истечёт',
    notifSubExpiringTomorrow: 'Ваш доступ к Profile Stats заканчивается завтра. Продлите чтобы сохранить бейдж.',
    notifSubExpiringDays: 'Ваш доступ к Profile Stats заканчивается через {n} дн.',
    notifSubExpired: 'Подписка истекла',
    notifSubExpiredMsg: 'Продлите Profile Stats чтобы вернуть бейдж и аналитику.',
    notifNoSub: 'Нет активной подписки',
    notifNoSubMsg: 'Аналитика Profile Stats требует активный план.',
    notifSubActivated: 'Подписка активирована',
    notifSubActivatedMsg: 'Profile Stats активен на вашем аккаунте. Наслаждайтесь!',
    justNow: 'только что',
    minutesAgo: '{n} мин назад',
    hoursAgo: '{n} ч назад',
    daysAgo: '{n} дн назад',
    dismiss: 'Скрыть'
  }
};

function t(key, vars) {
  const dict = I18N[currentLang] || I18N.en;
  let s = dict[key] != null ? dict[key] : (I18N.en[key] != null ? I18N.en[key] : key);
  if (vars && typeof s === 'string') {
    s = s.replace(/\{(\w+)\}/g, (m, k) => vars[k] != null ? vars[k] : m);
  }
  return s;
}

// Single date formatter for the popup. European day-first ordering for
// both locales (en-GB / ru-RU) — never US month-first.
function formatDate(d) {
  if (!d) return '';
  const locale = currentLang === 'ru' ? 'ru-RU' : 'en-GB';
  try { return d.toLocaleDateString(locale); } catch { return ''; }
}

// Apply current language to every static element marked with data-i18n*
// attributes. Called after boot and whenever the user toggles the language.
function applyLanguage() {
  document.documentElement.lang = currentLang;
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    const val = t(key);
    // Preserve child markup if the element has a single text node child only;
    // otherwise replace innerHTML for keys that explicitly contain HTML.
    if (val.includes('<')) el.innerHTML = val;
    else el.textContent = val;
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    el.placeholder = t(el.getAttribute('data-i18n-placeholder'));
  });
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    el.title = t(el.getAttribute('data-i18n-title'));
  });
  // Update language buttons active state
  document.querySelectorAll('#langSwitch .lang-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.lang === currentLang);
  });
  // Refresh dynamic regions that may already be rendered
  if (currentSubscription) applySubscriptionHeader();
  // Re-render the open Notes sub-view, if any, so its text follows the language
  if (notesState.loaded && document.getElementById('notesContent')) {
    try { renderNotesView(); } catch {}
  }
  // Refresh the Top Models row count line if shown
  const info = document.getElementById('leaderboardInfo');
  if (info && lbState.total > 0) {
    info.textContent = t('showingOf', { n: lbState.offset, total: lbState.total });
  }
  // Refresh notification panel if open
  const ov = document.getElementById('notifOverlay');
  if (ov && ov.style.display !== 'none') {
    notifLoad().then(renderNotifPanel);
  }
  // Re-render the upgrade card features (they live in i18n, not the DOM)
  const upgradeCard = document.getElementById('upgradeCard');
  if (upgradeCard && upgradeCard.style.display !== 'none') loadPlanFeatures();
  // Active-filter chips have locale-specific labels — re-render so a
  // language switch updates them in place without waiting for the next
  // leaderboard reload.
  try { renderFilterChips(); } catch {}
}

async function setLanguage(lang) {
  if (lang !== 'en' && lang !== 'ru') return;
  currentLang = lang;
  try { await chrome.storage.local.set({ ofStatsLang: lang }); } catch {}
  applyLanguage();
}

const screens = {
  login:        document.getElementById('loginScreen'),
  register:     document.getElementById('registerScreen'),
  forgot:       document.getElementById('forgotScreen'),
  main:         document.getElementById('mainScreen'),
  subscription: document.getElementById('subscriptionScreen'),
  settings:     document.getElementById('settingsScreen'),
  support:      document.getElementById('supportScreen'),
  network:      document.getElementById('networkScreen'),
  payment:      document.getElementById('paymentScreen')
};

const TAG_COLORS = [
  '#8b5cf6', '#10b981', '#ef4444', '#f59e0b',
  '#3b82f6', '#ec4899', '#14b8a6', '#6b7280'
];
function tagColor(ci) { return TAG_COLORS[((ci % TAG_COLORS.length) + TAG_COLORS.length) % TAG_COLORS.length]; }

// Notes / tags state. Mirrors the badge's _notesActiveView model so the
// three sub-tabs (editor/tags/models) behave identically.
const notesState = {
  loaded: false,
  notes: {},        // { username: { text, tags: [tagId], date } }
  avatars: {},      // { username: avatar_url }
  tags: [],         // [ { id, name, ci } ]
  activeView: 'models',
  editingUsername: null,
  editingTagIds: null, // staged tag ids for the current editor session
  draftText: '',
  draftTagName: '',
  newTagColorIndex: 0,
  modelsSearch: ''
};

// Persist the active editor session so a closed popup does not eat the draft.
const DRAFT_STORAGE_KEY = 'psNoteDraft';
async function persistDraft() {
  const payload = {
    activeView: notesState.activeView,
    editingUsername: notesState.editingUsername,
    draftText: notesState.draftText,
    editingTagIds: notesState.editingTagIds
  };
  try { await chrome.storage.local.set({ [DRAFT_STORAGE_KEY]: payload }); } catch {}
}
async function loadDraft() {
  try {
    const r = await chrome.storage.local.get(DRAFT_STORAGE_KEY);
    return r[DRAFT_STORAGE_KEY] || null;
  } catch { return null; }
}
async function clearDraft() {
  try { await chrome.storage.local.remove(DRAFT_STORAGE_KEY); } catch {}
}

// ============ Notifications ============
// System-level notifications (sub expiring soon, sub activated, etc.).
// Stored as an array in chrome.storage.local under NOTIF_KEY. Deduped by id.
const NOTIF_KEY = 'psNotifications';
const NOTIF_MAX = 50;

async function notifLoad() {
  try {
    const r = await chrome.storage.local.get(NOTIF_KEY);
    return Array.isArray(r[NOTIF_KEY]) ? r[NOTIF_KEY] : [];
  } catch { return []; }
}
async function notifSave(list) {
  try { await chrome.storage.local.set({ [NOTIF_KEY]: list.slice(0, NOTIF_MAX) }); } catch {}
}
// Append a notification unless one with the same id already exists.
async function notifAdd(n) {
  const list = await notifLoad();
  if (list.some(x => x.id === n.id)) return list;
  const entry = { ts: Date.now(), read: false, ...n };
  list.unshift(entry);
  await notifSave(list);
  notifRefreshBadge(list);
  return list;
}
async function notifMarkAllRead() {
  const list = await notifLoad();
  list.forEach(n => { n.read = true; });
  await notifSave(list);
  notifRefreshBadge(list);
}
async function notifClearAll() {
  await notifSave([]);
  notifRefreshBadge([]);
  renderNotifPanel([]);
}
async function notifDismiss(id) {
  const list = (await notifLoad()).filter(n => n.id !== id);
  await notifSave(list);
  notifRefreshBadge(list);
  renderNotifPanel(list);
}

function notifRefreshBadge(list) {
  const badge = document.getElementById('notificationBadge');
  if (!badge) return;
  const unread = list.filter(n => !n.read).length;
  if (unread > 0) {
    badge.textContent = unread > 9 ? '9+' : String(unread);
    badge.style.display = '';
  } else {
    badge.style.display = 'none';
  }
}

function notifFormatTime(ts) {
  const d = (Date.now() - ts) / 1000;
  if (d < 60) return t('justNow');
  if (d < 3600) return t('minutesAgo', { n: Math.floor(d / 60) });
  if (d < 86400) return t('hoursAgo', { n: Math.floor(d / 3600) });
  return t('daysAgo', { n: Math.floor(d / 86400) });
}

function renderNotifPanel(list) {
  const wrap = document.getElementById('notifPanelList');
  const empty = document.getElementById('notifPanelEmpty');
  if (!wrap || !empty) return;
  wrap.innerHTML = '';
  if (!list.length) {
    empty.style.display = '';
    return;
  }
  empty.style.display = 'none';
  for (const n of list) {
    const row = document.createElement('div');
    row.className = 'notif-row' + (n.read ? '' : ' unread');
    const iconClass = n.level || 'info';
    row.innerHTML = `
      <div class="notif-row-icon ${escapeHtml(iconClass)}">
        ${iconSvgFor(n.level)}
      </div>
      <div class="notif-row-main">
        <div class="notif-row-title">${escapeHtml(n.title || '')}</div>
        <div class="notif-row-msg">${escapeHtml(n.message || '')}</div>
        <div class="notif-row-time">${escapeHtml(notifFormatTime(n.ts))}</div>
      </div>
      <button class="notif-row-dismiss" data-dismiss="${escapeHtml(n.id)}" title="${escapeHtml(t('dismiss'))}">
        <svg viewBox="0 0 24 24" fill="none" width="12" height="12" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>`;
    wrap.appendChild(row);
  }
  wrap.querySelectorAll('.notif-row-dismiss').forEach(btn => {
    btn.addEventListener('click', () => notifDismiss(btn.dataset.dismiss));
  });
}
function iconSvgFor(level) {
  if (level === 'ok') return `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>`;
  if (level === 'warn') return `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;
  if (level === 'danger') return `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`;
  return `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`;
}

// Check on each boot: emit "expires soon" / "active" / "expired" entries.
async function notifEvaluateSubscription() {
  const sub = currentSubscription;
  if (!sub) return;
  if (sub.hasAccess && sub.expiresAt) {
    const expMs = new Date(sub.expiresAt).getTime();
    const daysLeft = Math.ceil((expMs - Date.now()) / (24 * 60 * 60 * 1000));
    if (daysLeft <= 3 && daysLeft > 0) {
      const id = `sub-expiring-${new Date(sub.expiresAt).toISOString().slice(0, 10)}`;
      await notifAdd({
        id, level: 'warn',
        title: t('notifSubExpiring'),
        message: daysLeft === 1
          ? t('notifSubExpiringTomorrow')
          : t('notifSubExpiringDays', { n: daysLeft })
      });
    }
    if (daysLeft <= 0) {
      await notifAdd({
        id: 'sub-expired',
        level: 'danger',
        title: t('notifSubExpired'),
        message: t('notifSubExpiredMsg')
      });
    }
  } else if (!sub.hasAccess) {
    // Optional: prompt to subscribe — fire once per session
    const id = 'sub-inactive';
    const list = await notifLoad();
    if (!list.some(n => n.id === id)) {
      await notifAdd({
        id, level: 'info',
        title: t('notifNoSub'),
        message: t('notifNoSubMsg')
      });
    }
  }
}

// Whole-popup UI state: which screen, which top-level tab. The Notes
// sub-view lives in the existing draft so it follows the same lifecycle.
const UI_STATE_KEY = 'psPopupUi';
const uiState = { screen: 'main', tab: 'top' };
async function persistUiState() {
  try { await chrome.storage.local.set({ [UI_STATE_KEY]: uiState }); } catch {}
}
async function loadUiState() {
  try {
    const r = await chrome.storage.local.get(UI_STATE_KEY);
    return r[UI_STATE_KEY] || null;
  } catch { return null; }
}

function show(name) {
  for (const [k, el] of Object.entries(screens)) {
    if (!el) continue; // tolerate missing screens
    el.style.display = k === name ? 'flex' : 'none';
  }
  // The first show() call wins the race against the booting CSS guard
  // (html.booting hides every .screen) — strip it now so the chosen
  // screen actually paints.
  document.documentElement.classList.remove('booting');
  closeDropdown();

  // Coming back to main from a side screen (Support, Settings, etc.) —
  // make sure the current tab actually has rows. If the previous load got
  // interrupted or never finished (popup was closed mid-fetch, user
  // switched screens before the request resolved) the pane stays stuck
  // on "Loading…". Kick it again here.
  if (name === 'main') {
    const tab = uiState.tab;
    if (tab === 'top') {
      const hasRows = document.querySelectorAll('#topList .list-item').length > 0;
      if (!hasRows && !lbState.loading) loadTopTab();
    } else if (tab === 'notes') {
      const content = document.getElementById('notesContent');
      const empty = content && content.querySelector('.list-empty');
      if (empty && /Loading|Загруз/i.test(empty.textContent || '')) loadNotesTab();
    }
  }
  // Persist only screens that make sense to restore after re-open. Auth
  // screens fall through — those are gated by the auth status anyway.
  // Don't persist transient checkout screens (network/payment) — landing
  // back into them after a popup re-open is confusing if the invoice expired.
  if (['main', 'subscription', 'settings', 'support'].includes(name)) {
    uiState.screen = name;
    persistUiState();
  }
}

function setError(id, msg) {
  const el = document.getElementById(id);
  el.textContent = msg || '';
  el.classList.toggle('visible', Boolean(msg));
}

function setSuccess(id, msg) {
  const el = document.getElementById(id);
  el.textContent = msg || '';
  el.classList.toggle('visible', Boolean(msg));
}

function setLoading(btnId, on) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  btn.disabled = on;
  const t = btn.querySelector('.btn-text');
  const l = btn.querySelector('.btn-loader');
  if (t) t.style.display = on ? 'none' : 'inline';
  if (l) l.style.display = on ? 'inline-block' : 'none';
}

function _sendOnce(action, payload) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ action, ...payload }, (resp) => {
        if (chrome.runtime.lastError) resolve({ success: false, error: chrome.runtime.lastError.message });
        else resolve(resp || { success: false, error: 'Empty response' });
      });
    } catch (e) { resolve({ success: false, error: e.message }); }
  });
}

// Promise-based custom confirm dialog (replaces native window.confirm).
function showConfirm({ title, message = '', confirmText, cancelText, danger = true } = {}) {
  if (title == null) title = t('confirm');
  if (confirmText == null) confirmText = t('confirm');
  if (cancelText == null) cancelText = t('cancel');
  return new Promise((resolve) => {
    const overlay = document.getElementById('confirmOverlay');
    const titleEl = document.getElementById('confirmTitle');
    const msgEl = document.getElementById('confirmMessage');
    const okBtn = document.getElementById('confirmAcceptBtn');
    const cancelBtn = document.getElementById('confirmCancelBtn');
    const iconEl = document.getElementById('confirmIcon');

    titleEl.textContent = title;
    msgEl.textContent = message;
    okBtn.textContent = confirmText;
    cancelBtn.textContent = cancelText;
    okBtn.className = 'modal-btn ' + (danger ? 'modal-btn-danger' : 'modal-btn-primary');
    iconEl.className = 'modal-icon' + (danger ? '' : ' info');
    overlay.style.display = 'flex';

    function cleanup(result) {
      overlay.style.display = 'none';
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      overlay.removeEventListener('click', onBackdrop);
      document.removeEventListener('keydown', onKey);
      resolve(result);
    }
    function onOk() { cleanup(true); }
    function onCancel() { cleanup(false); }
    function onBackdrop(e) { if (e.target === overlay) cleanup(false); }
    function onKey(e) {
      if (e.key === 'Escape') cleanup(false);
      else if (e.key === 'Enter') cleanup(true);
    }
    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
    overlay.addEventListener('click', onBackdrop);
    document.addEventListener('keydown', onKey);
    setTimeout(() => okBtn.focus(), 50);
  });
}

// MV3 service workers can be asleep when popup opens; the first message
// occasionally lands before the worker is fully alive. Retry once after a
// short delay to mask that cold-start race.
async function send(action, payload = {}) {
  let resp = await _sendOnce(action, payload);
  const dead = !resp || (resp.success === false &&
    typeof resp.error === 'string' &&
    (resp.error.includes('Could not establish connection') ||
     resp.error.includes('Receiving end does not exist') ||
     resp.error === 'Empty response'));
  if (dead) {
    await new Promise(r => setTimeout(r, 150));
    resp = await _sendOnce(action, payload);
  }
  return resp;
}

// ============ Auth flows ============
async function doLogin(email, password) {
  setError('loginError', '');
  setLoading('loginBtn', true);
  try {
    const r = await send('login', { email, password });
    if (!r.success) { setError('loginError', r.error || t('loginFailed')); return; }
    await enterMainScreen(r.user);
  } finally { setLoading('loginBtn', false); }
}

async function doRegister(email, password) {
  setError('registerError', '');
  setLoading('registerBtn', true);
  try {
    const r = await send('register', { email, password });
    if (!r.success) { setError('registerError', r.error || t('registerFailed')); return; }
    if (r.requiresVerification) {
      setError('registerError', t('accountCreatedCheckEmail'));
      show('login'); return;
    }
    await enterMainScreen(r.user);
  } finally { setLoading('registerBtn', false); }
}

async function doForgot(email) {
  setError('forgotError', ''); setSuccess('forgotSuccess', '');
  setLoading('forgotBtn', true);
  try {
    const r = await send('forgotPassword', { email });
    if (!r.success) { setError('forgotError', r.error || t('forgotFailed')); return; }
    setSuccess('forgotSuccess', r.message || t('forgotSuccess'));
  } finally { setLoading('forgotBtn', false); }
}

async function doLogout() { await send('logout'); show('login'); }

async function doSSO() {
  setError('loginError', '');
  setLoading('loginBtn', true);
  try {
    const resp = await new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(STATS_EDITOR_EXTENSION_ID, { action: 'getStatsEditorToken' }, (r) => {
          if (chrome.runtime.lastError) resolve({ success: false, error: chrome.runtime.lastError.message });
          else resolve(r || { success: false, error: 'Empty response' });
        });
      } catch (e) { resolve({ success: false, error: e.message }); }
    });
    if (!resp.success) {
      const msg = resp.code === 'NOT_AUTHENTICATED'
        ? t('ssoNotAuth')
        : (resp.error && resp.error.includes('Could not establish connection'))
          ? t('ssoNoExt')
          : (resp.error || t('ssoFailed'));
      setError('loginError', msg);
      return;
    }
    const stored = await send('setTokenFromSSO', { token: resp.token, email: resp.email });
    if (!stored.success) { setError('loginError', stored.error || t('ssoStoreFailed')); return; }
    await enterMainScreen({ email: resp.email });
  } finally { setLoading('loginBtn', false); }
}

// ============ Main screen ============
let currentSubscription = null;

async function enterMainScreen(user) {
  const email = user?.email || (await send('getAuthStatus')).email || '';
  document.getElementById('userMenuEmail').textContent = email;

  // Drop the Profile Stats backend's 5-minute positive cache before reading
  // subscription status. Otherwise an externally-modified subscription
  // (admin revoked it, expired naturally, downgraded plan) keeps surfacing
  // as 'active' in the popup for up to 5 minutes after the change, while
  // the badge — which polls SE directly — already shows the right state.
  // refreshAccess() is a cheap no-op when nothing changed.
  try { await send('refreshAccess'); } catch {}

  // Load subscription status to decide subtitle + access state
  const { authToken } = await chrome.storage.local.get('authToken');
  try {
    const r = await fetch(`${PROFILE_STATS_API}/health/check-access`, {
      headers: { Authorization: `Bearer ${authToken}` }
    });
    if (r.status === 401) { await doLogout(); return; }
    const data = await r.json();
    currentSubscription = data.subscription || null;
  } catch { currentSubscription = null; }

  applySubscriptionHeader();
  await loadPluginEnabled();
  await loadVerdictEnabled();

  // Refresh the bell badge on every boot and emit expiry / activity notices.
  notifEvaluateSubscription().catch(() => {});
  notifLoad().then(notifRefreshBadge);

  // Warm the notes/tags cache so the Top Models tab can light up models that
  // already have notes without a second round-trip.
  ensureNotesLoaded().catch(() => {});

  // Pull saved UI state to decide where to land. Default = main / Top Models.
  const saved = await loadUiState();
  const targetScreen = saved && ['main', 'subscription', 'settings', 'support'].includes(saved.screen)
    ? saved.screen
    : 'main';
  const targetTab = saved && ['top', 'notes'].includes(saved.tab) ? saved.tab : 'top';

  if (targetScreen === 'main') {
    show(targetScreen);
    // Apply tab without going through activateTab (which would persist state
    // we just read). Inline the visible swap, then call the loader.
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('tab-active', b.dataset.tab === targetTab));
    document.querySelectorAll('.tab-pane').forEach(p => p.style.display = p.dataset.tabPane === targetTab ? '' : 'none');
    uiState.tab = targetTab;
    // Hydrate filter inputs + sort dropdown from the persisted state
    // BEFORE we ask for data, so the first server call honours them.
    try { applyRestoredFiltersToDom(); } catch {}
    if (targetTab === 'top') loadTopTab();
    else loadNotesTab();
  } else if (targetScreen === 'subscription') {
    openSubscriptionPage();
  } else if (targetScreen === 'support') {
    // Use the full opener — it refills email + restores the saved draft.
    // A bare show('support') would land on empty inputs even when there's
    // a saved draft from a previous session.
    openSupportPage();
  } else {
    show(targetScreen);
  }
}

function applySubscriptionHeader() {
  const sub = currentSubscription || {};
  const subtitle = document.getElementById('logoSubtitle');
  const plan = document.getElementById('userMenuPlan');
  const exp  = document.getElementById('userMenuExpires');

  if (sub.hasAccess) {
    let label = (sub.plan || 'active').toUpperCase();
    if (sub.grantedVia === 'stats_editor_pro') label = t('subPro');
    if (sub.plan === 'profile_stats') label = (t('subActive') || 'Active').toUpperCase();
    subtitle.textContent = label;
    plan.textContent = label;
    // European DD/MM/YYYY (en-GB) for EN, DD.MM.YYYY (ru-RU) for RU —
    // we never want US month-first ordering since the user base reads
    // dates day-first.
    const d = sub.expiresAt ? new Date(sub.expiresAt) : null;
    exp.textContent = d ? '• ' + formatDate(d) : '';
  } else {
    subtitle.textContent = t('subNone');
    plan.textContent = t('subInactiveLabel');
    exp.textContent = '';
  }
}

// ============ Dropdown menu ============
function _setDropdownOpen(open) {
  const d = document.getElementById('userMenuDropdown');
  const bd = document.getElementById('userMenuBackdrop');
  if (d) d.style.display = open ? '' : 'none';
  if (bd) bd.classList.toggle('open', open);
}
function toggleDropdown() {
  const d = document.getElementById('userMenuDropdown');
  _setDropdownOpen(d && d.style.display === 'none');
}
function closeDropdown() { _setDropdownOpen(false); }

document.addEventListener('click', (e) => {
  const d = document.getElementById('userMenuDropdown');
  const btn = document.getElementById('headerMenuBtn');
  if (!d || !btn) return;
  if (d.style.display !== 'none' && !d.contains(e.target) && !btn.contains(e.target)) closeDropdown();
});
// Clicking the dim backdrop closes the menu too — same as the
// notifications overlay behaviour.
document.getElementById('userMenuBackdrop')?.addEventListener('click', () => closeDropdown());

// ============ Tabs ============
// Scroll positions per tab so leaving and returning lands on the same row.
// Hydrated from the persisted lbState so a popup re-open after a model
// click lands at the same row instead of the top.
const tabScroll = (() => {
  const saved = _loadLbPersisted();
  return {
    top: Number(saved.scrollTop) || 0,
    notes: Number(saved.scrollNotes) || 0
  };
})();
function getMainBody() {
  return document.querySelector('#mainScreen .main-body');
}

function activateTab(name) {
  // Snapshot scroll position of the tab we're leaving.
  const body = getMainBody();
  if (body && uiState.tab && uiState.tab !== name) {
    tabScroll[uiState.tab] = body.scrollTop;
    if (uiState.tab === 'top')        persistLbScroll(body.scrollTop);
    else if (uiState.tab === 'notes') persistLbNotesScroll(body.scrollTop);
  }

  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('tab-active', b.dataset.tab === name));
  document.querySelectorAll('.tab-pane').forEach(p => p.style.display = p.dataset.tabPane === name ? '' : 'none');
  uiState.tab = name;
  persistUiState();

  if (name === 'top') {
    // Only reload if we haven't fetched anything yet; otherwise keep the
    // existing rows and just restore the scroll position.
    const hasRows = document.querySelectorAll('#topList .list-item').length > 0;
    if (!hasRows) loadTopTab();
    requestAnimationFrame(() => {
      const b = getMainBody();
      if (b) b.scrollTop = tabScroll.top || 0;
    });
  } else if (name === 'notes') {
    loadNotesTab();
    requestAnimationFrame(() => {
      const b = getMainBody();
      if (b) b.scrollTop = tabScroll.notes || 0;
    });
  }
}

// Score -> grade letter (matches the grading used inside the badge).
function gradeFor(score) {
  const s = Number(score) || 0;
  if (s >= 90) return 'S';
  if (s >= 80) return 'A+';
  if (s >= 70) return 'A';
  if (s >= 60) return 'B+';
  if (s >= 50) return 'B';
  if (s >= 40) return 'C';
  if (s >= 30) return 'D';
  return 'F';
}

// Grade -> hue used for the round badge. Mirrors the badge color scale.
function gradeColor(grade) {
  switch (grade) {
    case 'S':  return '#10b981';
    case 'A+': return '#22c55e';
    case 'A':  return '#84cc16';
    case 'B+': return '#facc15';
    case 'B':  return '#f59e0b';
    case 'C':  return '#fb923c';
    case 'D':  return '#ef4444';
    default:   return '#dc2626';
  }
}

function formatFans(model) {
  if (model.fansText) return model.fansText;
  const c = model.fansCount;
  if (!c) return '—';
  if (c >= 1_000_000) return (c / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (c >= 1_000) return (c / 1_000).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(c);
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function modelRowHtml(model, extras = {}) {
  const grade = gradeFor(model.score);
  const color = gradeColor(grade);
  const avatar = model.avatarUrl
    ? `<img class="list-item-avatar" src="${escapeHtml(model.avatarUrl)}" alt="" referrerpolicy="no-referrer">`
    : `<div class="list-item-avatar" style="display:flex; align-items:center; justify-content:center; color:var(--text-secondary); font-size:13px;">${escapeHtml((model.username || '?').charAt(0).toUpperCase())}</div>`;
  const qPct = Math.round((Number(model.qualityScore) || 0) * 100);
  const meta = extras.meta || escapeHtml(t('metaFansQuality', { fans: formatFans(model), quality: qPct }));
  const score = Math.round(Number(model.score) || 0);
  const rank = extras.rank;
  const rankHtml = rank ? `<div class="list-item-rank">${rank}</div>` : '';
  const itemRankClass = rank && rank <= 3 ? ` rank-${rank}` : '';

  // Has-note indicator. notesState.loaded becomes true once ensureNotesLoaded
  // resolves; before that we render the button in its empty state.
  const username = model.username;
  const note = notesState.notes[username];
  const hasNote = !!(note && ((note.text && note.text.trim()) || (Array.isArray(note.tags) && note.tags.length)));
  const noteBtnTitle = hasNote ? t('editNote') : t('writeNote');
  const noteIcon = hasNote
    ? `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
         <path d="M14.06 2.94a2 2 0 012.83 0l4.17 4.17a2 2 0 010 2.83L8.5 22.5H2v-6.5L14.06 2.94z"/>
       </svg>`
    : `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
         <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
         <path d="M18.5 2.5a2.12 2.12 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
       </svg>`;

  return `
    <div class="list-item${itemRankClass}${hasNote ? ' has-note' : ''}" data-username="${escapeHtml(username)}">
      ${rankHtml}
      ${avatar}
      <div class="list-item-main">
        <div class="list-item-name">@${escapeHtml(username)}</div>
        <div class="list-item-meta">${meta}</div>
      </div>
      <button class="row-note-btn${hasNote ? ' active' : ''}" data-note-username="${escapeHtml(username)}" title="${escapeHtml(noteBtnTitle)}">
        ${noteIcon}
      </button>
      <div class="list-item-score" style="background: ${color}; box-shadow: 0 2px 8px ${color}55;" title="${escapeHtml(t('gradeTitle', { grade }))}">
        ${score} <span style="opacity:.8; font-weight:600; font-size:11px;">${grade}</span>
      </div>
    </div>`;
}

function bindRowClicks(container) {
  // Note button — must come first so stopPropagation prevents the row from
  // also opening the profile.
  container.querySelectorAll('.row-note-btn[data-note-username]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const u = btn.dataset.noteUsername;
      if (!u) return;
      notesState.editingUsername = u;
      notesState.draftText = '';
      notesState.editingTagIds = null;
      notesState.activeView = 'editor';
      persistDraft();
      activateTab('notes');
    });
  });
  container.querySelectorAll('.list-item[data-username]').forEach(el => {
    el.addEventListener('click', () => {
      const u = el.dataset.username;
      if (u) chrome.tabs.create({ url: `https://onlyfans.com/${encodeURIComponent(u)}` });
    });
  });
}

// ============ Leaderboard state ============
const PAGE_SIZE = 50;
const lbState = {
  offset: 0,
  total: 0,
  loading: false,
  filters: {
    search: '', sort: 'score',
    minScore: '', maxScore: '', minFans: '', minQuality: '',
    minPosts: '', minVideos: '', minStreams: '', minAge: '',
    minPrice: '', maxPrice: ''
  }
};

// Synchronously rehydrate filters / sort from localStorage before the
// first loadTopTab() call, so a re-opened popup keeps the user's view.
(function _restoreLbFilters() {
  try {
    const saved = _loadLbPersisted();
    if (saved && saved.filters && typeof saved.filters === 'object') {
      for (const k of Object.keys(lbState.filters)) {
        if (typeof saved.filters[k] === 'string') lbState.filters[k] = saved.filters[k];
      }
    }
  } catch {}
})();

// Push the restored values into the actual DOM inputs + sort dropdown
// after they're rendered. Called from boot once the DOM is ready.
function applyRestoredFiltersToDom() {
  const map = {
    filterMinScore: 'minScore', filterMaxScore: 'maxScore',
    filterMinFans: 'minFans', filterMinQuality: 'minQuality',
    filterMinPosts: 'minPosts', filterMinVideos: 'minVideos',
    filterMinStreams: 'minStreams', filterMinAge: 'minAge',
    filterMinPrice: 'minPrice', filterMaxPrice: 'maxPrice'
  };
  for (const [inputId, key] of Object.entries(map)) {
    const el = document.getElementById(inputId);
    if (el) el.value = lbState.filters[key] || '';
  }
  // Search field
  const search = document.getElementById('topSearch');
  if (search) search.value = lbState.filters.search || '';
  // Sort dropdown — apply selected state + label
  const sortVal = lbState.filters.sort || 'score';
  const sortWrap = document.getElementById('sortDropdown');
  const sortLabel = document.getElementById('sortDropdownLabel');
  if (sortWrap && sortLabel) {
    let selectedOpt = null;
    sortWrap.querySelectorAll('.custom-dropdown-option').forEach(o => {
      const match = o.dataset.value === sortVal;
      o.classList.toggle('selected', match);
      if (match) selectedOpt = o;
    });
    if (selectedOpt) {
      const inner = selectedOpt.querySelector('[data-i18n]');
      const k = inner && inner.getAttribute('data-i18n');
      if (k) sortLabel.innerHTML =
        `<span data-i18n="${k}">${escapeHtml(t(k))}</span> <span class="opt-arrow">↓</span>`;
    }
  }
}

function currentLeaderboardParams() {
  const f = lbState.filters;
  const params = { offset: lbState.offset, limit: PAGE_SIZE, sort: f.sort };
  if (f.search) params.search = f.search;
  if (f.minScore !== '') params.minScore = f.minScore;
  if (f.maxScore !== '') params.maxScore = f.maxScore;
  if (f.minFans !== '')  params.minFans  = f.minFans;
  if (f.minQuality !== '') params.minQuality = (Number(f.minQuality) / 100).toFixed(2);
  if (f.minPosts !== '')   params.minPosts   = f.minPosts;
  if (f.minVideos !== '')  params.minVideos  = f.minVideos;
  if (f.minStreams !== '') params.minStreams = f.minStreams;
  if (f.minAge !== '')     params.minAgeMonths = f.minAge;
  if (f.minPrice !== '')   params.minPrice   = f.minPrice;
  if (f.maxPrice !== '')   params.maxPrice   = f.maxPrice;
  return params;
}

// Persist leaderboard filters + sort + scroll across popup re-opens.
// localStorage is sync and survives the popup teardown that async
// chrome.storage.local writes don't always finish in time for.
const LB_STATE_KEY = 'psLbState';
function _loadLbPersisted() {
  try { return JSON.parse(localStorage.getItem(LB_STATE_KEY) || '{}') || {}; }
  catch { return {}; }
}
function _saveLbPersisted(patch) {
  try {
    const cur = _loadLbPersisted();
    localStorage.setItem(LB_STATE_KEY, JSON.stringify({ ...cur, ...patch }));
  } catch {}
}
function persistLbFilters() { _saveLbPersisted({ filters: { ...lbState.filters } }); }
function persistLbScroll(top)  { _saveLbPersisted({ scrollTop: top || 0 }); }
function persistLbNotesScroll(top) { _saveLbPersisted({ scrollNotes: top || 0 }); }

// Active-filter chips next to "Showing N of M". Ranges (min/max pairs)
// collapse into a single chip — "Score: 53–66" — and their X clears both
// endpoints at once. Singles render as "Label: value".
const FILTER_DEFS = [
  // Ranges
  { kind: 'range',
    keyMin: 'minScore', keyMax: 'maxScore',
    inputMin: 'filterMinScore', inputMax: 'filterMaxScore',
    labelEn: 'Score', labelRu: 'Скор' },
  { kind: 'range',
    keyMin: 'minPrice', keyMax: 'maxPrice',
    inputMin: 'filterMinPrice', inputMax: 'filterMaxPrice',
    labelEn: 'Price', labelRu: 'Цена', prefix: '$' },
  // Singles
  { kind: 'single', key: 'minFans',    inputId: 'filterMinFans',    labelEn: 'Min fans',         labelRu: 'Мин. фанов' },
  { kind: 'single', key: 'minQuality', inputId: 'filterMinQuality', labelEn: 'Min quality %',    labelRu: 'Мин. качество %' },
  { kind: 'single', key: 'minPosts',   inputId: 'filterMinPosts',   labelEn: 'Min posts',        labelRu: 'Мин. постов' },
  { kind: 'single', key: 'minVideos',  inputId: 'filterMinVideos',  labelEn: 'Min videos',       labelRu: 'Мин. видео' },
  { kind: 'single', key: 'minStreams', inputId: 'filterMinStreams', labelEn: 'Min streams',      labelRu: 'Мин. стримов' },
  { kind: 'single', key: 'minAge',     inputId: 'filterMinAge',     labelEn: 'Min age (months)', labelRu: 'Мин. возраст (мес.)' }
];

function _chipHtml(label, value) {
  return `<span class="filter-chip-label">${escapeHtml(label)}: <b>${escapeHtml(value)}</b></span>` +
    `<button class="filter-chip-x" type="button" aria-label="Remove">` +
    `<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>` +
    `</button>`;
}

function renderFilterChips() {
  const wrap = document.getElementById('filterChips');
  if (!wrap) return;
  const f = lbState.filters;
  wrap.innerHTML = '';
  let any = false;
  for (const d of FILTER_DEFS) {
    const lbl = (currentLang === 'ru' ? d.labelRu : d.labelEn);
    if (d.kind === 'range') {
      const lo = f[d.keyMin], hi = f[d.keyMax];
      if (lo === '' && hi === '') continue;
      const px = d.prefix || '';
      let value;
      if (lo !== '' && hi !== '')      value = `${px}${lo}–${px}${hi}`;
      else if (lo !== '' && hi === '') value = `≥ ${px}${lo}`;
      else                              value = `≤ ${px}${hi}`;
      const chip = document.createElement('span');
      chip.className = 'filter-chip';
      chip.innerHTML = _chipHtml(lbl, value);
      chip.querySelector('.filter-chip-x').addEventListener('click', () => {
        lbState.filters[d.keyMin] = '';
        lbState.filters[d.keyMax] = '';
        const a = document.getElementById(d.inputMin); if (a) a.value = '';
        const b = document.getElementById(d.inputMax); if (b) b.value = '';
        persistLbFilters();
        loadTopTab(true);
      });
      wrap.appendChild(chip);
      any = true;
    } else {
      const v = f[d.key];
      if (v === '' || v == null) continue;
      const chip = document.createElement('span');
      chip.className = 'filter-chip';
      chip.innerHTML = _chipHtml(lbl, v);
      chip.querySelector('.filter-chip-x').addEventListener('click', () => {
        lbState.filters[d.key] = '';
        const el = document.getElementById(d.inputId);
        if (el) el.value = '';
        persistLbFilters();
        loadTopTab(true);
      });
      wrap.appendChild(chip);
      any = true;
    }
  }
  wrap.style.display = any ? '' : 'none';
}

async function loadTopTab(reset = true) {
  // Paywall: no active subscription → render masked rows + lock overlay,
  // do NOT hit the backend. The user can't bypass via DevTools because we
  // never fetch real data while locked.
  if (!hasAccess()) {
    const pane = document.querySelector('[data-tab-pane="top"]');
    if (pane) renderPaywall(pane, { rows: 6, variant: 'list' });
    return;
  }

  if (lbState.loading) return;
  lbState.loading = true;
  // Make sure we know which models already have notes before rendering rows.
  await ensureNotesLoaded().catch(() => {});

  const list = document.getElementById('topList');
  const empty = document.getElementById('topEmpty');
  const info = document.getElementById('leaderboardInfo');
  const loadMoreBtn = document.getElementById('loadMoreBtn');

  if (reset) {
    lbState.offset = 0;
    list.querySelectorAll('.list-item').forEach(n => n.remove());
    empty.textContent = t('loading');
    empty.style.display = '';
    info.textContent = '';
    loadMoreBtn.style.display = 'none';
    renderFilterChips();
  } else {
    loadMoreBtn.textContent = t('loading');
    loadMoreBtn.disabled = true;
  }

  const r = await send('getLeaderboard', { params: currentLeaderboardParams() });

  lbState.loading = false;
  loadMoreBtn.disabled = false;
  loadMoreBtn.textContent = t('loadMore');

  if (!r.success) {
    empty.textContent = r.error || t('failedToLoad');
    empty.style.display = '';
    return;
  }

  lbState.total = Number(r.total) || 0;
  const models = r.models || [];
  const startRank = lbState.offset + 1;

  if (lbState.total === 0) {
    empty.textContent = t('noModelsMatch');
    empty.style.display = '';
    info.textContent = '';
    return;
  }

  empty.style.display = 'none';

  const html = models.map((m, i) => modelRowHtml(m, { rank: m.globalRank || (startRank + i) })).join('');
  list.insertAdjacentHTML('beforeend', html);
  bindRowClicks(list);

  lbState.offset += models.length;
  info.textContent = t('showingOf', { n: lbState.offset, total: lbState.total });
  loadMoreBtn.style.display = lbState.offset < lbState.total ? '' : 'none';

  // After the very first paint of rows, restore the persisted scroll
  // position so a re-opened popup lands on the same row the user was
  // looking at when they clicked a model.
  if (reset && uiState.tab === 'top' && tabScroll.top > 0) {
    requestAnimationFrame(() => {
      const b = getMainBody();
      if (b) b.scrollTop = tabScroll.top;
    });
  }
}

// Throttled persist of the main scroll position on every user scroll.
(function _wireScrollPersist() {
  let raf = 0;
  document.addEventListener('scroll', (e) => {
    const body = e.target;
    if (!body || !body.classList || !body.classList.contains('main-body')) return;
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      const top = body.scrollTop || 0;
      if (uiState.tab === 'top')        { tabScroll.top = top;        persistLbScroll(top); }
      else if (uiState.tab === 'notes') { tabScroll.notes = top;      persistLbNotesScroll(top); }
    });
  }, true /* capture — main-body's scroll doesn't bubble to document by default */);
})();

// ============ Notes Tab (sub-tabs: editor / tags / models) ============

// Loads notes/tags into notesState without touching any UI. Safe to call from
// other tabs that need to know which models the user has noted.
async function ensureNotesLoaded() {
  if (notesState.loaded) return;
  const [notesResp, tagsResp] = await Promise.all([send('getNotes'), send('getNoteTags')]);
  if (notesResp.success) {
    notesState.notes = notesResp.notes || {};
    notesState.avatars = notesResp.avatars || {};
  }
  if (tagsResp.success) notesState.tags = tagsResp.tags || [];
  notesState.loaded = true;
}

async function loadNotesTab() {
  const content = document.getElementById('notesContent');
  // Paywall: when there's no active sub, hide the sub-tabs (Note/Tags/Models)
  // since none of them are usable, and replace the content with masked notes.
  if (!hasAccess()) {
    const pane = document.querySelector('[data-tab-pane="notes"]');
    const subtabs = pane && pane.querySelector('.notes-subtabs');
    if (subtabs) subtabs.style.display = 'none';
    if (content) renderPaywall(content, { rows: 4, variant: 'notes' });
    return;
  }
  // Restore sub-tabs when re-entering with access
  const pane = document.querySelector('[data-tab-pane="notes"]');
  const subtabs = pane && pane.querySelector('.notes-subtabs');
  if (subtabs) subtabs.style.display = '';

  content.innerHTML = `<div class="list-empty">${escapeHtml(t('loading'))}</div>`;

  const [notesResp, tagsResp, savedDraft] = await Promise.all([
    send('getNotes'),
    send('getNoteTags'),
    loadDraft()
  ]);
  if (!notesResp.success) {
    content.innerHTML = `<div class="list-empty">${escapeHtml(notesResp.error || t('failedToLoad'))}</div>`;
    return;
  }
  notesState.notes = notesResp.notes || {};
  notesState.avatars = notesResp.avatars || {};
  notesState.tags = tagsResp.success ? (tagsResp.tags || []) : [];
  notesState.loaded = true;

  // Restore the in-progress editor session if the popup was closed mid-edit.
  if (savedDraft && savedDraft.editingUsername) {
    notesState.editingUsername = savedDraft.editingUsername;
    notesState.draftText = savedDraft.draftText || '';
    notesState.editingTagIds = Array.isArray(savedDraft.editingTagIds) ? savedDraft.editingTagIds : null;
    notesState.activeView = savedDraft.activeView || 'editor';
    document.querySelectorAll('.notes-subtab').forEach(b => {
      b.classList.toggle('active', b.dataset.subview === notesState.activeView);
    });
  }
  renderNotesView();
}

function setNotesView(view) {
  notesState.activeView = view;
  document.querySelectorAll('.notes-subtab').forEach(b => {
    b.classList.toggle('active', b.dataset.subview === view);
  });
  persistDraft();
  renderNotesView();
}

function renderNotesView() {
  const content = document.getElementById('notesContent');
  if (!content) return;
  if (!notesState.loaded) return;
  if (notesState.activeView === 'editor') renderEditorView(content);
  else if (notesState.activeView === 'tags') renderTagsView(content);
  else renderModelsView(content);
}

// ---- Editor view ----
function renderEditorView(content) {
  const username = notesState.editingUsername;
  if (!username) {
    content.innerHTML = `
      <div class="editor-empty">
        ${t('pickModelHint')}
      </div>
      <div class="form-field">
        <label class="form-label">${escapeHtml(t('modelUsername'))}</label>
        <input type="text" id="editorUsernameInput" class="form-input" placeholder="${escapeHtml(t('usernamePh'))}" autocomplete="off">
      </div>
      <button class="auth-btn" id="editorPickBtn">
        <span class="btn-text">${escapeHtml(t('openEditor'))}</span>
        <div class="btn-loader" style="display:none;"></div>
      </button>`;
    document.getElementById('editorPickBtn').addEventListener('click', () => {
      const u = document.getElementById('editorUsernameInput').value.trim().toLowerCase().replace(/^@/, '');
      if (!u) return;
      notesState.editingUsername = u;
      notesState.draftText = '';
      notesState.editingTagIds = null;
      persistDraft();
      renderEditorView(content);
      ensureAvatar(u);
    });
    return;
  }

  const note = notesState.notes[username] || { text: '', tags: [], date: 0 };
  const avatarUrl = notesState.avatars[username] || null;
  const profileUrl = `https://onlyfans.com/${encodeURIComponent(username)}`;

  content.innerHTML = `
    <div class="editor-header">
      <div class="editor-avatar-slot" id="editorAvatarSlot">
        ${avatarUrl
          ? `<img class="editor-avatar" src="${escapeHtml(avatarUrl)}" referrerpolicy="no-referrer" alt="" id="editorAvatar">`
          : `<div class="editor-avatar" style="display:flex; align-items:center; justify-content:center; color:var(--text-secondary); font-weight:700;">${escapeHtml(username.charAt(0).toUpperCase())}</div>`}
      </div>
      <span class="editor-label" id="editorOpenProfile">@${escapeHtml(username)}</span>
      <span style="flex:1;"></span>
      <button class="header-icon-btn" id="editorCloseBtn" title="${escapeHtml(t('pickAnother'))}">
        <svg viewBox="0 0 24 24" fill="none" width="14" height="14" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
    <textarea id="editorTextarea" class="form-input form-textarea" rows="5" placeholder="${escapeHtml(t('notePlaceholder'))}" maxlength="5000">${escapeHtml(notesState.draftText || note.text || '')}</textarea>
    <div class="form-hint"><span id="editorCharCount">${(notesState.draftText || note.text || '').length}</span> / 5000</div>
    <div class="form-field" style="margin-top: 10px;">
      <label class="form-label">${escapeHtml(t('tagsLabel'))}</label>
      <div class="tag-picker" id="editorTagPicker"></div>
    </div>
    <div class="auth-error" id="editorError"></div>
    <div class="editor-actions">
      <button class="auth-btn" id="editorSaveBtn">
        <span class="btn-text">${escapeHtml(t('save'))}</span>
        <div class="btn-loader" style="display:none;"></div>
      </button>
      ${note.date ? `<button class="editor-action-delete" id="editorDeleteBtn" title="${escapeHtml(t('deleteTitle'))}">
        <svg viewBox="0 0 24 24" fill="none" width="16" height="16" stroke="currentColor" stroke-width="2">
          <polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 01-2 2H9a2 2 0 01-2-2L5 6"/>
        </svg>
      </button>` : ''}
    </div>
  `;

  // Tag chips: assigned first (full opacity), available second (dimmed). Click toggles.
  const initialTagIds = notesState.editingTagIds || note.tags || [];
  renderEditorTagPicker(initialTagIds);

  // Auto-load avatar from server if we don't have one locally yet.
  if (!avatarUrl) ensureAvatar(username);

  // Wire up
  document.getElementById('editorOpenProfile').addEventListener('click', () => chrome.tabs.create({ url: profileUrl }));
  const av = document.getElementById('editorAvatar');
  if (av && avatarUrl) av.addEventListener('click', () => chrome.tabs.create({ url: profileUrl }));
  document.getElementById('editorCloseBtn').addEventListener('click', () => {
    notesState.editingUsername = null;
    notesState.draftText = '';
    notesState.editingTagIds = null;
    persistDraft();
    renderEditorView(content);
  });
  document.getElementById('editorTextarea').addEventListener('input', (e) => {
    notesState.draftText = e.target.value;
    document.getElementById('editorCharCount').textContent = e.target.value.length;
    persistDraft();
  });
  document.getElementById('editorSaveBtn').addEventListener('click', () => saveCurrentNote());
  const delBtn = document.getElementById('editorDeleteBtn');
  if (delBtn) delBtn.addEventListener('click', () => deleteCurrentNote());
}

async function ensureAvatar(username) {
  if (!username) return;
  if (notesState.avatars[username]) return;
  const r = await send('getModelInfo', { username });
  if (r && r.success && r.avatarUrl) {
    notesState.avatars[username] = r.avatarUrl;
    // Swap the placeholder avatar element in place if the editor is still open.
    const slot = document.getElementById('editorAvatarSlot');
    if (slot && notesState.editingUsername === username) {
      const profileUrl = `https://onlyfans.com/${encodeURIComponent(username)}`;
      slot.innerHTML = `<img class="editor-avatar" src="${escapeHtml(r.avatarUrl)}" referrerpolicy="no-referrer" alt="" id="editorAvatar">`;
      document.getElementById('editorAvatar').addEventListener('click', () => chrome.tabs.create({ url: profileUrl }));
    }
  }
}

function renderEditorTagPicker(selectedIds) {
  const picker = document.getElementById('editorTagPicker');
  if (!picker) return;
  picker.innerHTML = '';
  if (notesState.tags.length === 0) {
    picker.innerHTML = `<div style="font-size:11px; color: var(--text-muted); padding: 8px;">${escapeHtml(t('noTagsYet'))}</div>`;
    return;
  }
  const selectedSet = new Set(selectedIds);
  const sorted = [...notesState.tags].sort((a, b) => Number(selectedSet.has(b.id)) - Number(selectedSet.has(a.id)));
  sorted.forEach(tag => {
    const chip = document.createElement('span');
    chip.className = 'tag-chip' + (selectedSet.has(tag.id) ? ' selected' : '');
    chip.style.background = tagColor(tag.ci);
    chip.dataset.tagId = tag.id;
    chip.textContent = tag.name;
    chip.addEventListener('click', () => {
      chip.classList.toggle('selected');
      // Capture the staged tag set so the draft survives a popup close.
      notesState.editingTagIds = Array.from(picker.querySelectorAll('.tag-chip.selected'))
        .map(el => Number(el.dataset.tagId)).filter(n => !Number.isNaN(n));
      persistDraft();
    });
    picker.appendChild(chip);
  });
}

// Re-render the note-state of a single Top Models row in place. Called after
// save/delete so the user does not have to switch tabs or reopen the popup to
// see the icon flip between outlined and filled.
function refreshNoteIconFor(username) {
  const list = document.getElementById('topList');
  if (!list || !username) return;
  let row;
  try { row = list.querySelector(`.list-item[data-username="${CSS.escape(username)}"]`); }
  catch { row = null; }
  if (!row) return;
  const note = notesState.notes[username];
  const hasNote = !!(note && ((note.text && note.text.trim()) || (Array.isArray(note.tags) && note.tags.length)));
  row.classList.toggle('has-note', hasNote);
  const btn = row.querySelector('.row-note-btn');
  if (!btn) return;
  btn.classList.toggle('active', hasNote);
  btn.title = hasNote ? t('editNote') : t('writeNote');
  btn.innerHTML = hasNote
    ? `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M14.06 2.94a2 2 0 012.83 0l4.17 4.17a2 2 0 010 2.83L8.5 22.5H2v-6.5L14.06 2.94z"/></svg>`
    : `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
}

async function saveCurrentNote() {
  const username = notesState.editingUsername;
  if (!username) return;
  const text = (document.getElementById('editorTextarea')?.value || '').trim();
  const tags = Array.from(document.querySelectorAll('#editorTagPicker .tag-chip.selected'))
    .map(el => Number(el.dataset.tagId)).filter(n => !Number.isNaN(n));
  setError('editorError', '');
  setLoading('editorSaveBtn', true);
  try {
    const r = await send('saveNote', {
      username, text, tags, date: Date.now(),
      avatarUrl: notesState.avatars[username] || null
    });
    if (!r.success) { setError('editorError', r.error || t('failedSave')); return; }
    notesState.notes[username] = { text, tags, date: Date.now() };
    notesState.draftText = '';
    notesState.editingTagIds = null;
    await clearDraft();
    refreshNoteIconFor(username);
    setNotesView('models');
  } finally { setLoading('editorSaveBtn', false); }
}

async function deleteCurrentNote() {
  const username = notesState.editingUsername;
  if (!username) return;
  const ok = await showConfirm({
    title: t('deleteNoteTitle'),
    message: t('deleteNoteMsg', { username }),
    confirmText: t('deleteNoteBtn')
  });
  if (!ok) return;
  const r = await send('deleteNote', { username });
  if (!r.success) { setError('editorError', r.error || t('failedDelete')); return; }
  delete notesState.notes[username];
  notesState.editingUsername = null;
  notesState.draftText = '';
  notesState.editingTagIds = null;
  await clearDraft();
  refreshNoteIconFor(username);
  setNotesView('models');
}

// Quick delete from the Models list row.
async function deleteNoteByUsername(username) {
  if (!username) return;
  const ok = await showConfirm({
    title: t('deleteNoteTitle'),
    message: t('deleteNoteMsg', { username }),
    confirmText: t('deleteNoteBtn')
  });
  if (!ok) return;
  const r = await send('deleteNote', { username });
  if (!r.success) { alert(r.error || t('failedDelete')); return; }
  delete notesState.notes[username];
  if (notesState.editingUsername === username) {
    notesState.editingUsername = null;
    notesState.draftText = '';
    notesState.editingTagIds = null;
    await clearDraft();
  }
  refreshNoteIconFor(username);
  renderModelsListBody();
}

// ---- Tags view ----
function renderTagsView(content) {
  content.innerHTML = `
    <div class="form-field">
      <label class="form-label">${escapeHtml(t('createTag'))}</label>
      <div class="tag-create-row">
        <input type="text" id="newTagName" class="form-input" placeholder="${escapeHtml(t('tagNamePh'))}" maxlength="50" value="${escapeHtml(notesState.draftTagName || '')}">
        <div class="tag-create-row-bottom">
          <div class="color-picker" id="newTagColorPicker"></div>
          <button class="toolbar-btn primary" id="addTagBtn">${escapeHtml(t('addTag'))}</button>
        </div>
      </div>
      <div class="auth-error" id="tagError"></div>
    </div>
    <div class="form-field">
      <label class="form-label">${escapeHtml(t('yourTags'))}</label>
      <div class="tag-list" id="tagList"></div>
    </div>
  `;
  renderColorPicker();
  renderTagList();
  const nameInput = document.getElementById('newTagName');
  nameInput.addEventListener('input', (e) => { notesState.draftTagName = e.target.value; });
  nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') addTag(); });
  document.getElementById('addTagBtn').addEventListener('click', () => addTag());
}

function renderColorPicker() {
  const wrap = document.getElementById('newTagColorPicker');
  if (!wrap) return;
  wrap.innerHTML = '';
  TAG_COLORS.forEach((c, idx) => {
    const dot = document.createElement('div');
    dot.className = 'color-dot' + (idx === notesState.newTagColorIndex ? ' selected' : '');
    dot.style.background = c;
    dot.addEventListener('click', () => {
      notesState.newTagColorIndex = idx;
      renderColorPicker();
    });
    wrap.appendChild(dot);
  });
}

function renderTagList() {
  const list = document.getElementById('tagList');
  if (!list) return;
  list.innerHTML = '';
  if (notesState.tags.length === 0) {
    list.innerHTML = `<div class="list-empty">${escapeHtml(t('noTagsList'))}</div>`;
    return;
  }
  notesState.tags.forEach(tag => {
    const row = document.createElement('div');
    row.className = 'tag-row';
    row.innerHTML = `
      <div class="tag-row-dot" style="background:${tagColor(tag.ci)}"></div>
      <div class="tag-row-name">${escapeHtml(tag.name)}</div>
      <button class="tag-row-delete" data-tag-id="${tag.id}" title="${escapeHtml(t('deleteTitle'))}">
        <svg viewBox="0 0 24 24" fill="none" width="14" height="14" stroke="currentColor" stroke-width="2">
          <polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 01-2 2H9a2 2 0 01-2-2L5 6"/>
        </svg>
      </button>`;
    row.querySelector('.tag-row-delete').addEventListener('click', () => deleteTag(tag.id));
    list.appendChild(row);
  });
}

async function syncTags() {
  const r = await send('syncNoteTags', { tags: notesState.tags });
  if (!r.success) { setError('tagError', r.error || t('failedSyncTags')); return false; }
  notesState.tags = r.tags || notesState.tags;
  return true;
}

async function addTag() {
  const name = (document.getElementById('newTagName')?.value || '').trim().slice(0, 50);
  if (!name) { setError('tagError', t('nameRequired')); return; }
  if (notesState.tags.some(tag => tag.name.toLowerCase() === name.toLowerCase())) {
    setError('tagError', t('tagExists')); return;
  }
  setError('tagError', '');
  notesState.tags.push({ id: -Date.now(), name, ci: notesState.newTagColorIndex });
  if (await syncTags()) {
    notesState.draftTagName = '';
    renderTagsView(document.getElementById('notesContent'));
  } else {
    notesState.tags.pop();
  }
}

async function deleteTag(tagId) {
  const target = notesState.tags.find(tag => tag.id === tagId);
  const name = target ? target.name : 'this tag';
  const ok = await showConfirm({
    title: t('deleteTagTitle'),
    message: t('deleteTagMsg', { name }),
    confirmText: t('deleteNoteBtn')
  });
  if (!ok) return;
  const before = notesState.tags;
  notesState.tags = notesState.tags.filter(tag => tag.id !== tagId);
  if (!(await syncTags())) { notesState.tags = before; return; }
  for (const u of Object.keys(notesState.notes)) {
    const n = notesState.notes[u];
    if (Array.isArray(n?.tags) && n.tags.includes(tagId)) {
      n.tags = n.tags.filter(id => id !== tagId);
    }
  }
  renderTagList();
}

// ---- Models view ----
function renderModelsView(content) {
  content.innerHTML = `
    <div class="notes-search-wrap">
      <div class="search-wrap">
        <svg viewBox="0 0 24 24" fill="none" width="14" height="14" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="7"/><path d="M21 21l-4.35-4.35"/>
        </svg>
        <input type="search" id="modelsSearch" class="search-input" placeholder="${escapeHtml(t('searchUsername'))}" value="${escapeHtml(notesState.modelsSearch || '')}">
      </div>
    </div>
    <div class="notes-models-list" id="notesModelsList"></div>
  `;
  document.getElementById('modelsSearch').addEventListener('input', (e) => {
    notesState.modelsSearch = e.target.value.trim().toLowerCase();
    renderModelsListBody();
  });
  renderModelsListBody();
}

function renderModelsListBody() {
  const wrap = document.getElementById('notesModelsList');
  if (!wrap) return;
  const tagsById = new Map(notesState.tags.map(tag => [tag.id, tag]));
  const q = notesState.modelsSearch || '';
  const entries = Object.entries(notesState.notes)
    .filter(([u, n]) => n && ((n.text && n.text.trim()) || (Array.isArray(n.tags) && n.tags.length)))
    .filter(([u]) => !q || u.toLowerCase().includes(q))
    .sort((a, b) => (b[1].date || 0) - (a[1].date || 0));

  if (entries.length === 0) {
    wrap.innerHTML = `<div class="list-empty">${escapeHtml(q ? t('noModelsMatchSearch') : t('noNotesYet'))}<br><span style="font-size:11px; color:var(--text-muted);">${escapeHtml(t('noNotesHint'))}</span></div>`;
    return;
  }
  wrap.innerHTML = entries.map(([username, note]) => {
    const avatarUrl = notesState.avatars[username] || null;
    const preview = escapeHtml((note.text || '').slice(0, 90));
    const tagIds = Array.isArray(note.tags) ? note.tags : [];
    const chips = tagIds.map(tid => tagsById.get(tid)).filter(Boolean).map(tag =>
      `<span class="tag-chip selected" style="background:${tagColor(tag.ci)}; cursor:default; padding:2px 7px; font-size:10px;">${escapeHtml(tag.name)}</span>`
    ).join('');
    return `
      <div class="notes-model-row" data-username="${escapeHtml(username)}">
        ${avatarUrl
          ? `<img class="notes-model-avatar" src="${escapeHtml(avatarUrl)}" referrerpolicy="no-referrer" alt="">`
          : `<div class="notes-model-avatar">${escapeHtml(username.charAt(0).toUpperCase())}</div>`}
        <div class="notes-model-main">
          <div class="notes-model-name">@${escapeHtml(username)}</div>
          <div class="notes-model-preview">${preview || `<em style="opacity:.6;">${escapeHtml(t('noText'))}</em>`}</div>
          ${chips ? `<div class="notes-model-tags">${chips}</div>` : ''}
        </div>
        <button class="notes-model-delete" data-delete-username="${escapeHtml(username)}" title="${escapeHtml(t('deleteNoteTooltip'))}">
          <svg viewBox="0 0 24 24" fill="none" width="14" height="14" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 01-2 2H9a2 2 0 01-2-2L5 6"/>
          </svg>
        </button>
      </div>`;
  }).join('');
  // Delete buttons first (stop propagation so click does not also open editor).
  wrap.querySelectorAll('.notes-model-delete[data-delete-username]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteNoteByUsername(btn.dataset.deleteUsername);
    });
  });
  // Row click anywhere else opens the editor for that model.
  wrap.querySelectorAll('.notes-model-row[data-username]').forEach(el => {
    el.addEventListener('click', () => {
      notesState.editingUsername = el.dataset.username;
      notesState.draftText = '';
      notesState.editingTagIds = null;
      persistDraft();
      setNotesView('editor');
    });
  });
}

// ============ Plugin enabled toggle ============
async function loadPluginEnabled() {
  const { ofStatsBadgeEnabled } = await chrome.storage.local.get('ofStatsBadgeEnabled');
  // default: enabled
  const enabled = ofStatsBadgeEnabled !== false;
  const a = document.getElementById('pluginEnabled');
  const b = document.getElementById('settingsPluginEnabled');
  if (a) a.checked = enabled;
  if (b) b.checked = enabled;
}

async function setPluginEnabled(enabled) {
  await chrome.storage.local.set({ ofStatsBadgeEnabled: enabled });
  // Mirror into the other checkbox so both stay in sync.
  const a = document.getElementById('pluginEnabled');
  const b = document.getElementById('settingsPluginEnabled');
  if (a) a.checked = enabled;
  if (b) b.checked = enabled;
}

// ============ Support form ============
// Draft persistence: keep subject/message across popup re-opens so a user
// who accidentally closes the popup mid-typing doesn't lose their report.
// We use localStorage (sync) instead of chrome.storage.local (async) — the
// previous version lost the last keystroke when the user closed the popup
// before the async write could land. localStorage commits synchronously
// on each call and survives the popup teardown.
const SUPPORT_DRAFT_KEY = 'psSupportDraft';

function loadSupportDraft() {
  try { return JSON.parse(localStorage.getItem(SUPPORT_DRAFT_KEY) || '{}') || {}; }
  catch { return {}; }
}
function saveSupportDraft(patch) {
  try {
    const cur = loadSupportDraft();
    localStorage.setItem(SUPPORT_DRAFT_KEY, JSON.stringify({ ...cur, ...patch }));
  } catch {}
}
function clearSupportDraft() {
  try { localStorage.removeItem(SUPPORT_DRAFT_KEY); } catch {}
}

async function openSupportPage() {
  // Reset to the form view (in case user came back from a previous Success).
  const form = document.getElementById('supportForm');
  const success = document.getElementById('supportSuccess');
  const banner = document.getElementById('supportBanner');
  if (form) form.style.display = '';
  if (banner) banner.style.display = '';
  if (success) success.style.display = 'none';
  setError('supportError', '');

  // Pre-fill email from auth status; always read-only — we send as the
  // authenticated user, ignore any tampering with the field.
  const auth = await send('getAuthStatus');
  const emailEl = document.getElementById('supportEmail');
  if (emailEl) emailEl.value = auth.email || '';

  // Restore draft (subject defaults to the localised "Bug Report — Profile Stats").
  const draft = loadSupportDraft();
  const subjectEl = document.getElementById('supportSubject');
  const msgEl = document.getElementById('supportMessage');
  if (subjectEl) subjectEl.value = draft.subject || t('supportSubjectDefault');
  if (msgEl) msgEl.value = draft.message || '';

  show('support');
}

async function submitSupportForm(e) {
  if (e) e.preventDefault();
  const emailEl = document.getElementById('supportEmail');
  const subjectEl = document.getElementById('supportSubject');
  const msgEl = document.getElementById('supportMessage');
  const sendBtn = document.getElementById('supportSendBtn');
  const errEl = document.getElementById('supportError');

  const email = (emailEl?.value || '').trim();
  const subject = (subjectEl?.value || '').trim() || t('supportSubjectDefault');
  const message = (msgEl?.value || '').trim();

  setError('supportError', '');

  if (message.length < 10) {
    setError('supportError', t('supportTooShort'));
    msgEl?.focus();
    return;
  }

  setLoading('supportSendBtn', true);
  try {
    const r = await send('sendSupportEmail', { subject, message });
    if (!r || !r.success) {
      setError('supportError', (r && r.error) || t('supportFailed'));
      return;
    }
    // Success → swap to confirmation view, drop the draft
    clearSupportDraft();
    const successEmail = document.getElementById('supportSuccessEmail');
    if (successEmail) successEmail.textContent = email;
    document.getElementById('supportForm').style.display = 'none';
    document.getElementById('supportBanner').style.display = 'none';
    document.getElementById('supportSuccess').style.display = '';
  } catch (err) {
    setError('supportError', err.message || t('supportFailed'));
  } finally {
    setLoading('supportSendBtn', false);
  }
}

// ============ Verdict AI toggle ============
async function loadVerdictEnabled() {
  const { ofStatsVerdictEnabled } = await chrome.storage.local.get('ofStatsVerdictEnabled');
  // default: enabled
  const enabled = ofStatsVerdictEnabled !== false;
  const cb = document.getElementById('settingsVerdictEnabled');
  if (cb) cb.checked = enabled;
}

async function setVerdictEnabled(enabled) {
  await chrome.storage.local.set({ ofStatsVerdictEnabled: enabled });
  const cb = document.getElementById('settingsVerdictEnabled');
  if (cb) cb.checked = enabled;
}

// ============ Paywall (no active subscription) ============
// True when the user has any kind of paid access (own profile_stats sub OR
// inherited Stats Editor Pro). When false, Top Models and Notes tabs are
// covered by a lock overlay and we never request real data from the server.
function hasAccess() {
  return !!(currentSubscription && currentSubscription.hasAccess);
}

// Renders a paywall overlay with masked rows + a Renew CTA into the given
// pane. The masked rows are static placeholders (no real data leaves the
// host — we never fetched any). After a successful renewal the popup
// reloads itself, so we don't try to undo this DOM rewrite in place.
function renderPaywall(container, opts) {
  if (!container) return;
  opts = opts || {};
  const rows = opts.rows || 5;
  const variant = opts.variant || 'list'; // 'list' | 'notes'
  const hint = opts.hint || t('paywallPopupHint');

  let maskedHtml = '';
  if (variant === 'list') {
    for (let i = 0; i < rows; i++) {
      maskedHtml += `
        <div class="paywall-row paywall-row-${(i % 3) + 1}">
          <div class="paywall-rank"></div>
          <div class="paywall-avatar"></div>
          <div class="paywall-row-main">
            <div class="paywall-line paywall-line-name"></div>
            <div class="paywall-line paywall-line-meta"></div>
          </div>
          <div class="paywall-score"></div>
        </div>`;
    }
  } else {
    for (let i = 0; i < rows; i++) {
      maskedHtml += `
        <div class="paywall-note-row">
          <div class="paywall-avatar"></div>
          <div class="paywall-row-main">
            <div class="paywall-line paywall-line-name"></div>
            <div class="paywall-line paywall-line-meta paywall-line-${(i % 3) + 1}"></div>
            <div class="paywall-line paywall-line-meta paywall-line-${((i + 1) % 3) + 1}" style="width:50%;"></div>
          </div>
        </div>`;
    }
  }

  container.innerHTML = `
    <div class="paywall-wrap">
      <div class="paywall-masked" aria-hidden="true">${maskedHtml}</div>
      <div class="paywall-overlay">
        <div class="paywall-icon">
          <svg viewBox="0 0 24 24" fill="none" width="28" height="28" stroke="currentColor" stroke-width="2">
            <rect x="3" y="11" width="18" height="11" rx="2" stroke-linejoin="round"/>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
        </div>
        <div class="paywall-title">${escapeHtml(t('paywallPopupTitle'))}</div>
        <div class="paywall-msg">${escapeHtml(hint)}</div>
        <button type="button" class="paywall-btn" id="paywallRenewBtn-${Math.random().toString(36).slice(2,8)}">
          ${escapeHtml(t('paywallRenewBtn'))}
        </button>
      </div>
    </div>`;

  const btn = container.querySelector('.paywall-btn');
  if (btn) btn.addEventListener('click', () => openSubscriptionPage());
}

// ============ Subscription page (opened via menu) ============
async function openSubscriptionPage() {
  const email = (await chrome.storage.local.get('userEmail')).userEmail || '';
  document.getElementById('subUserEmail').textContent = email;
  const sub = currentSubscription || {};
  const upgradeCard = document.getElementById('upgradeCard');
  const renewCard = document.getElementById('renewCard');

  if (sub.hasAccess) {
    const date = sub.expiresAt ? formatDate(new Date(sub.expiresAt)) : '?';
    const plan = (sub.plan || t('subActive')).toUpperCase();
    const key = sub.grantedVia === 'stats_editor_pro' ? 'activeUntilVia' : 'activeUntil';
    document.getElementById('subUserSub').textContent = t(key, { plan, date });
    upgradeCard.style.display = 'none';

    // Renew card is always shown for active users so the promo input stays
    // reachable — including for Stats Editor Pro members who can stack a
    // promo code on top of their inherited access.
    renewCard.style.display = '';

    // For Pro users from Stats Editor we change the wording — Profile Stats
    // is already included via Pro, but they can still subscribe to a separate
    // PS plan (it will run in parallel and outlive Pro if Pro ends first) or
    // redeem a promo code. Price + buy button stay visible.
    const isProInherited = sub.grantedVia === 'stats_editor_pro';
    const titleEl = document.getElementById('renewTitleEl');
    const descEl = document.getElementById('renewDescEl');
    const renewBtnText = document.querySelector('#renewBtn .btn-text');
    if (titleEl) titleEl.textContent = isProInherited ? t('inheritedTitle') : t('renewTitle');
    if (descEl) descEl.textContent = isProInherited ? t('inheritedDesc') : t('renewDesc');
    if (renewBtnText) renewBtnText.textContent = isProInherited ? t('subscribeButton') : t('renewButton');

    setPromoMessage('renewPromoMessage', '', '');
  } else {
    document.getElementById('subUserSub').textContent = t('noActiveSub');
    upgradeCard.style.display = '';
    renewCard.style.display = 'none';
    setPromoMessage('buyPromoMessage', '', '');
    loadPlanFeatures();
  }
  show('subscription');
}

function setPromoMessage(elId, text, kind) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.textContent = text;
  el.className = 'promo-code-message' + (kind ? ' ' + kind : '');
}

function loadPlanFeatures() {
  // Features are localised on the client (the backend hard-codes English).
  // Render straight from the i18n dictionary so they switch with the popup
  // language and stay in sync with applyLanguage().
  const ul = document.getElementById('upgradeFeatures');
  if (!ul) return;
  const dict = I18N[currentLang] || I18N.en;
  const items = Array.isArray(dict.unlockFeatures) ? dict.unlockFeatures : (I18N.en.unlockFeatures || []);
  ul.innerHTML = '';
  items.forEach(text => {
    const li = document.createElement('li');
    li.textContent = text;
    ul.appendChild(li);
  });
}

// ============ Payment flow ============
let paymentPollInterval = null;
// Tracks whether user is buying first time or renewing. Used by network
// selection to surface the right error placeholder back to the user.
let _paymentReturnTo = 'subscription';

// Step 1: user clicks Buy or Renew → switch to Network selection screen.
function startBuy() {
  setError('buyError', '');
  _paymentReturnTo = 'subscription';
  // Reset busy state on cards in case the user came back from a failed attempt
  document.querySelectorAll('#networkScreen .network-card').forEach(c => c.classList.remove('busy'));
  setError('networkError', '');
  show('network');
}

function startRenew() {
  setError('renewError', '');
  _paymentReturnTo = 'subscription';
  document.querySelectorAll('#networkScreen .network-card').forEach(c => c.classList.remove('busy'));
  setError('networkError', '');
  show('network');
}

// Step 2: user picks a network → create payment, open NOWPayments invoice,
// land on payment screen and start polling.
async function selectNetwork(networkId, cardEl) {
  setError('networkError', '');
  if (cardEl) cardEl.classList.add('busy');
  // Lock all cards so the user doesn't double-tap into two invoices
  document.querySelectorAll('#networkScreen .network-card').forEach(c => c.classList.add('busy'));
  try {
    const r = await send('createPayment', { currency: networkId });
    if (!r || !r.success) {
      setError('networkError', (r && r.error) || t('networkFailed'));
      document.querySelectorAll('#networkScreen .network-card').forEach(c => c.classList.remove('busy'));
      return;
    }
    // Persist enough state to restore the in-flight payment if the popup
    // closes before the user finishes paying.
    const ctx = {
      paymentId: r.paymentId,
      payAddress: r.payAddress || '',
      payAmount: r.payAmount || null,
      payCurrency: r.payCurrency || networkId.toUpperCase().replace('USDT', 'USDT '),
      invoiceUrl: r.invoiceUrl || '',
      expiresAt: r.expiresAt || new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      planName: 'Profile Stats — $15/month'
    };
    await chrome.storage.local.set({ psPayment: ctx });
    renderPaymentScreen(ctx);
    // Open the hosted NOWPayments invoice as a convenience tab — most users
    // pay there directly. The in-popup address + QR is the offline fallback.
    if (ctx.invoiceUrl) chrome.tabs.create({ url: ctx.invoiceUrl });
    show('payment');
    startPaymentTimer(ctx.expiresAt);
    startPaymentStatusCheck(ctx.paymentId);
  } catch (e) {
    setError('networkError', e.message || t('networkFailed'));
    document.querySelectorAll('#networkScreen .network-card').forEach(c => c.classList.remove('busy'));
  }
}

// Populate the payment screen DOM from a saved/just-created payment context.
// Map raw NOWPayments currency codes to a readable label.
// 'usdttrc20' → 'USDT (TRC20)', etc. Falls back to upper-case as-is.
function formatPayCurrency(code) {
  if (!code) return 'USDT';
  const c = String(code).toLowerCase();
  if (c === 'usdttrc20') return 'USDT (TRC20)';
  if (c === 'usdtbsc')   return 'USDT (BEP20)';
  if (c === 'usdtsol')   return 'USDT (SOL)';
  if (c === 'usdterc20') return 'USDT (ERC20)';
  if (c === 'usdtton')   return 'USDT (TON)';
  return String(code).toUpperCase();
}

// Trim NOWPayments amounts: '15' → '15', '15.0' → '15', '15.250000' → '15.25'.
function formatPayAmount(amount) {
  if (amount == null) return '';
  const n = Number(amount);
  if (!Number.isFinite(n)) return String(amount);
  return n.toFixed(6).replace(/\.?0+$/, '');
}

function renderPaymentScreen(ctx) {
  const planEl = document.getElementById('paymentPlanName');
  const amountEl = document.getElementById('paymentAmount');
  const addrEl = document.getElementById('paymentAddressText');
  const linkEl = document.getElementById('paymentInvoiceLink');
  const statusEl = document.getElementById('paymentStatus');
  const checkBtn = document.getElementById('checkPaymentBtn');

  if (planEl) planEl.textContent = ctx.planName || 'Profile Stats — $15/month';
  if (amountEl) {
    amountEl.textContent = ctx.payAmount
      ? `${formatPayAmount(ctx.payAmount)} ${formatPayCurrency(ctx.payCurrency)}`
      : '$15.00 USD';
  }
  if (addrEl) addrEl.textContent = ctx.payAddress || '—';
  if (linkEl) {
    if (ctx.invoiceUrl) { linkEl.href = ctx.invoiceUrl; linkEl.style.display = ''; }
    else linkEl.style.display = 'none';
  }
  if (statusEl) statusEl.style.display = 'none';
  if (checkBtn) { checkBtn.style.display = ''; checkBtn.disabled = false; }
  generatePaymentQR(ctx.payAddress);
  // Hide QR + address blocks if the backend didn't return them (invoice-only
  // mode, e.g. when crypto was not pre-selected — shouldn't happen here, but
  // we guard anyway).
  document.getElementById('paymentQr').style.display = ctx.payAddress ? '' : 'none';
}

// Generate a QR for the pay address using an external service. The image is
// fetched on click — no third-party JS runs in the popup.
function generatePaymentQR(address) {
  const qr = document.getElementById('paymentQr');
  if (!qr) return;
  qr.innerHTML = '';
  if (!address) return;
  // Render at 2x for retina, scale down via CSS so the card fits without scroll.
  const renderSize = 260;
  const displaySize = 130;
  qr.innerHTML = `
    <div class="qr-code-container">
      <img src="https://api.qrserver.com/v1/create-qr-code/?size=${renderSize}x${renderSize}&data=${encodeURIComponent(address)}&margin=2"
           alt="QR" width="${displaySize}" height="${displaySize}">
    </div>`;
}

// Payment timer (counts down to expiresAt). Doesn't kill polling on expiry —
// NOWPayments can still confirm after the deadline, we just visually warn.
let paymentTimerInterval = null;
function startPaymentTimer(expiresAt) {
  if (paymentTimerInterval) { clearInterval(paymentTimerInterval); paymentTimerInterval = null; }
  const timerEl = document.getElementById('paymentTimer');
  const leftEl = document.getElementById('paymentTimeLeft');
  if (!timerEl || !leftEl) return;
  const expMs = new Date(expiresAt).getTime();
  const tick = () => {
    const diff = expMs - Date.now();
    if (diff <= 0) {
      clearInterval(paymentTimerInterval); paymentTimerInterval = null;
      leftEl.textContent = t('expired') || 'Expired';
      timerEl.classList.add('expired');
      return;
    }
    const m = Math.floor(diff / 60000);
    const s = Math.floor((diff % 60000) / 1000);
    leftEl.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    timerEl.classList.toggle('expired', diff < 120000);
  };
  tick();
  paymentTimerInterval = setInterval(tick, 1000);
}

// Auto-check every 15s; user can click Verify to force an immediate check.
let paymentAutoCheckInterval = null;
function startPaymentStatusCheck(paymentId) {
  if (paymentPollInterval) { clearInterval(paymentPollInterval); paymentPollInterval = null; }
  if (paymentAutoCheckInterval) { clearInterval(paymentAutoCheckInterval); paymentAutoCheckInterval = null; }
  paymentAutoCheckInterval = setInterval(() => checkPaymentOnce(paymentId, true), 15000);
  const btn = document.getElementById('checkPaymentBtn');
  if (btn) btn.onclick = () => checkPaymentOnce(paymentId, false);
}

async function checkPaymentOnce(paymentId, isAuto) {
  const statusEl = document.getElementById('paymentStatus');
  const statusText = document.getElementById('paymentStatusText');
  const checkBtn = document.getElementById('checkPaymentBtn');

  if (!isAuto && checkBtn) {
    checkBtn.disabled = true;
    setTimeout(() => { if (checkBtn) checkBtn.disabled = false; }, 1500);
  }
  if (statusEl) {
    statusEl.style.display = '';
    statusEl.className = 'payment-status';
    if (statusText) statusText.textContent = t('verifyingPayment');
  }

  try {
    const r = await send('getPaymentStatus', { paymentId });
    if (!r || r.success === false) {
      if (statusText) statusText.textContent = t('paymentNetworkErr');
      return;
    }
    const status = String(r.status || '').toLowerCase();
    const done = r.subscriptionActivated || ['completed', 'finished', 'confirmed', 'complete', 'paid'].includes(status);
    if (done) {
      if (paymentTimerInterval) { clearInterval(paymentTimerInterval); paymentTimerInterval = null; }
      if (paymentAutoCheckInterval) { clearInterval(paymentAutoCheckInterval); paymentAutoCheckInterval = null; }
      if (paymentPollInterval) { clearInterval(paymentPollInterval); paymentPollInterval = null; }

      await chrome.storage.local.remove('psPayment');
      await send('clearCache');
      await send('refreshAccess');

      if (statusEl) {
        statusEl.className = 'payment-status success';
        if (statusText) statusText.textContent = t('paymentConfirmed');
      }
      if (checkBtn) checkBtn.style.display = 'none';

      await notifAdd({
        id: `sub-activated-${paymentId}`,
        level: 'ok',
        title: t('notifSubActivated'),
        message: t('notifSubActivatedMsg')
      });

      // Full popup reload — guarantees Top Models/Notes panes are restored
      // (we replaced their HTML with the paywall placeholder while locked).
      setTimeout(() => { location.reload(); }, 1500);
      return;
    }

    if (status === 'partial' || status === 'partially_paid') {
      if (statusEl) statusEl.className = 'payment-status warn';
      if (statusText) statusText.textContent = t('paymentPartial');
      return;
    }

    // Still pending — keep polling
    if (statusText) statusText.textContent = t('paymentStatusFmt', { status: status || t('paymentPending') });
  } catch (e) {
    if (statusText) statusText.textContent = t('paymentNetworkErr');
  }
}

// Keep around for back-compat (timer-only polling not used anymore).
function pollPayment(paymentId) { startPaymentStatusCheck(paymentId); }

// Stops every payment-screen interval and drops the persisted invoice context.
// Use when the payment is finished, abandoned, or being closed by the user.
async function abandonPayment() {
  if (paymentPollInterval) { clearInterval(paymentPollInterval); paymentPollInterval = null; }
  if (paymentAutoCheckInterval) { clearInterval(paymentAutoCheckInterval); paymentAutoCheckInterval = null; }
  if (paymentTimerInterval) { clearInterval(paymentTimerInterval); paymentTimerInterval = null; }
  try { await chrome.storage.local.remove('psPayment'); } catch {}
}

// Triggered when the user hits Back / Close from the payment screen. Pops a
// confirmation — yes drops the in-flight invoice; no keeps them on screen.
async function requestClosePaymentScreen(target) {
  const ok = await showConfirm({
    title: t('cancelPaymentTitle'),
    message: t('cancelPaymentMsg'),
    confirmText: t('cancelPaymentYes'),
    cancelText: t('cancelPaymentNo'),
    danger: true
  });
  if (!ok) return; // stay on payment screen
  await abandonPayment();
  show(target || 'subscription');
}

// Kept for back-compat with any caller that wants the timers cleared without
// the prompt (e.g. successful confirmation flow).
function closePaymentScreen() {
  abandonPayment().finally(() => show('main'));
}

// Restore an in-flight payment after popup re-open.
async function restorePaymentIfAny() {
  try {
    const { psPayment } = await chrome.storage.local.get('psPayment');
    if (!psPayment || !psPayment.paymentId) return false;
    // If the saved expiry is more than an hour ago, drop it
    if (psPayment.expiresAt && new Date(psPayment.expiresAt).getTime() < Date.now() - 3600 * 1000) {
      await chrome.storage.local.remove('psPayment');
      return false;
    }
    renderPaymentScreen(psPayment);
    show('payment');
    startPaymentTimer(psPayment.expiresAt);
    startPaymentStatusCheck(psPayment.paymentId);
    return true;
  } catch { return false; }
}

// Copy address handler
function setupCopyAddress() {
  const btn = document.getElementById('copyAddressBtn');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    const addr = (document.getElementById('paymentAddressText')?.textContent || '').trim();
    if (!addr || addr === '—') return;
    try {
      await navigator.clipboard.writeText(addr);
      btn.classList.add('copied');
      const orig = btn.innerHTML;
      btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" width="14" height="14" stroke="currentColor" stroke-width="2.5"><path d="M20 6L9 17L4 12" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
      setTimeout(() => { btn.classList.remove('copied'); btn.innerHTML = orig; }, 1500);
    } catch {}
  });
}
setupCopyAddress();

// ============ Promo code redemption ============
async function applyPromo(scope) {
  // scope = 'buy' | 'renew' — picks the input/message/button trio to drive.
  const inputId   = scope === 'renew' ? 'renewPromoInput'   : 'buyPromoInput';
  const btnId     = scope === 'renew' ? 'renewPromoBtn'     : 'buyPromoBtn';
  const messageId = scope === 'renew' ? 'renewPromoMessage' : 'buyPromoMessage';
  const input = document.getElementById(inputId);
  const btn = document.getElementById(btnId);
  if (!input || !btn) return;

  const code = (input.value || '').trim().toUpperCase();
  if (!code) { setPromoMessage(messageId, t('promoEnterCode'), 'error'); return; }

  setPromoMessage(messageId, '', '');
  btn.disabled = true;
  const oldText = btn.textContent;
  btn.textContent = '…';

  try {
    const r = await send('applyPromoCode', { code });
    if (r && r.success) {
      const days = (r.subscription && r.subscription.days) || 0;
      setPromoMessage(messageId, t('promoActivated', { days }), 'success');
      input.value = '';
      await notifAdd({
        id: `promo-${code}-${Date.now()}`,
        level: 'ok',
        title: t('promoActivatedTitle'),
        message: t('promoActivatedNotif', { code, days })
      });
      // Refresh access. The Profile Stats backend caches negative
      // subscription status for ~20s; refreshAccess flushes that cache so
      // the next /health/check-access reflects the freshly redeemed promo.
      await send('clearCache');
      await send('refreshAccess');
      setTimeout(() => { location.reload(); }, 800);
    } else {
      const errCode = (r && r.code) || '';
      const errMsg = String((r && r.error) || '').toLowerCase();
      let msg;
      if (errCode === 'INVALID_CODE' || errMsg.includes('invalid') || errMsg.includes('not found')) msg = t('promoInvalid');
      else if (errCode === 'EXPIRED' || errMsg.includes('expired') || errMsg.includes('no longer active')) msg = t('promoExpired');
      else if (errCode === 'LIMIT_REACHED' || errMsg.includes('limit')) msg = t('promoLimitReached');
      else if (errCode === 'ALREADY_USED' || errMsg.includes('already used')) msg = t('promoAlreadyUsed');
      else if (errCode === 'WRONG_PRODUCT') msg = t('promoWrongProduct');
      else msg = (r && r.error) || t('promoFailed');
      setPromoMessage(messageId, msg, 'error');
    }
  } catch (e) {
    setPromoMessage(messageId, t('promoNetworkError'), 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = t('promoApply') || oldText;
  }
}

// ============ Side panel toggle ============
const _modeParam = new URLSearchParams(location.search).get('mode');
const isSidePanel = _modeParam === 'sidepanel';
const isStandaloneWindow = _modeParam === 'window';
if (isSidePanel) document.documentElement.classList.add('mode-sidepanel');
if (isStandaloneWindow) document.documentElement.classList.add('mode-window');

function applySidePanelButtons() {
  const expand = document.getElementById('expandPanelBtn');
  const collapse = document.getElementById('collapsePanelBtn');
  if (expand) expand.style.display = isSidePanel ? 'none' : '';
  if (collapse) collapse.style.display = isSidePanel ? '' : 'none';
}
// chrome.sidePanel.open() needs a user gesture and any await before it
// breaks that gesture context, so call the API synchronously inside the
// click handler. WINDOW_ID_CURRENT keeps Chrome happy without a tabs.query.
function openSidePanel() {
  try {
    chrome.sidePanel.open({ windowId: chrome.windows.WINDOW_ID_CURRENT });
  } catch (e) { console.error('openSidePanel failed', e); }
  // Closing the popup right after lets the side panel take focus.
  setTimeout(() => window.close(), 50);
}
async function closeSidePanel() {
  // No direct close API for side panel; just shut down our window — Chrome
  // collapses the panel when the document goes away.
  window.close();
}

// ============ Wire up ============
function wire(id, evt, fn) { const el = document.getElementById(id); if (el) el.addEventListener(evt, fn); }

// Auth forms
document.getElementById('loginForm').addEventListener('submit', (e) => {
  e.preventDefault();
  doLogin(document.getElementById('loginEmail').value.trim(), document.getElementById('loginPassword').value);
});
document.getElementById('registerForm').addEventListener('submit', (e) => {
  e.preventDefault();
  doRegister(document.getElementById('registerEmail').value.trim(), document.getElementById('registerPassword').value);
});
document.getElementById('forgotForm').addEventListener('submit', (e) => {
  e.preventDefault();
  doForgot(document.getElementById('forgotEmail').value.trim());
});
wire('showRegister', 'click', (e) => { e.preventDefault(); show('register'); });
wire('showLogin',    'click', (e) => { e.preventDefault(); show('login'); });
wire('forgotLink',   'click', (e) => { e.preventDefault(); show('forgot'); });
wire('backToLoginFromForgot', 'click', (e) => { e.preventDefault(); show('login'); });
wire('ssoBtn', 'click', () => doSSO());

// Header
wire('pluginEnabled', 'change', (e) => setPluginEnabled(e.target.checked));
wire('settingsPluginEnabled', 'change', (e) => setPluginEnabled(e.target.checked));
wire('settingsVerdictEnabled', 'change', (e) => setVerdictEnabled(e.target.checked));

// Language switcher (Settings page)
document.querySelectorAll('#langSwitch .lang-btn').forEach(btn => {
  btn.addEventListener('click', () => setLanguage(btn.dataset.lang));
});
function closeNotifOverlay() {
  const ov = document.getElementById('notifOverlay');
  if (ov) ov.style.display = 'none';
}
wire('notificationBtn', 'click', async (e) => {
  e.stopPropagation();
  const ov = document.getElementById('notifOverlay');
  if (!ov) return;
  const opening = ov.style.display === 'none';
  if (opening) {
    const list = await notifLoad();
    renderNotifPanel(list);
    ov.style.display = 'flex';
    // Mark all read after the user has actually seen the list.
    await notifMarkAllRead();
  } else {
    closeNotifOverlay();
  }
});
wire('notifClearBtn', 'click', () => notifClearAll());
wire('notifCloseBtn', 'click', () => closeNotifOverlay());
// Click on the dimmed backdrop (outside the panel) closes the overlay.
document.getElementById('notifOverlay')?.addEventListener('click', (e) => {
  if (e.target.id === 'notifOverlay') closeNotifOverlay();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeNotifOverlay();
});
wire('expandPanelBtn', 'click', () => openSidePanel());
wire('collapsePanelBtn', 'click', () => closeSidePanel());
applySidePanelButtons();
wire('headerMenuBtn', 'click', (e) => { e.stopPropagation(); toggleDropdown(); });

// Dropdown items
wire('menuSettings',     'click', () => show('settings'));
wire('menuSubscription', 'click', () => openSubscriptionPage());
wire('menuSupport',      'click', () => openSupportPage());
wire('menuLogout',       'click', () => doLogout());

// Back buttons
wire('subBackBtn',      'click', () => show('main'));
wire('settingsBackBtn', 'click', () => show('main'));
wire('supportBackBtn',  'click', () => show('main'));
wire('networkBackBtn',  'click', () => show(_paymentReturnTo || 'subscription'));
wire('paymentBackBtn',  'click', () => requestClosePaymentScreen('subscription'));
wire('paymentCloseBtn', 'click', () => requestClosePaymentScreen('main'));

// Buy / Renew → network selection
wire('buyBtn',   'click', () => startBuy());
wire('renewBtn', 'click', () => startRenew());

// Network cards — one handler picks the network value off the data attribute
document.querySelectorAll('#networkScreen .network-card[data-network]').forEach(card => {
  card.addEventListener('click', () => selectNetwork(card.dataset.network, card));
});

// Support form
const supportFormEl = document.getElementById('supportForm');
if (supportFormEl) supportFormEl.addEventListener('submit', submitSupportForm);
wire('supportCancelBtn', 'click', () => { clearSupportDraft(); show('main'); });
wire('supportSuccessClose', 'click', () => show('main'));
['supportSubject', 'supportMessage'].forEach(id => {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener('input', () => {
    const key = id === 'supportSubject' ? 'subject' : 'message';
    saveSupportDraft({ [key]: el.value });
  });
});

// Promo Apply — both Buy and Renew screens share the same redemption logic
wire('buyPromoBtn',   'click', () => applyPromo('buy'));
wire('renewPromoBtn', 'click', () => applyPromo('renew'));
['buyPromoInput', 'renewPromoInput'].forEach(id => {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); applyPromo(id === 'renewPromoInput' ? 'renew' : 'buy'); }
  });
});

// Tabs
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => activateTab(btn.dataset.tab));
});

// Leaderboard filters
let searchDebounce = null;
wire('topSearch', 'input', (e) => {
  lbState.filters.search = e.target.value.trim();
  persistLbFilters();
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => loadTopTab(true), 300);
});
// Custom sort dropdown
(function setupSortDropdown() {
  const wrap = document.getElementById('sortDropdown');
  const btn = document.getElementById('sortDropdownBtn');
  const label = document.getElementById('sortDropdownLabel');
  if (!wrap || !btn) return;

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    wrap.classList.toggle('open');
    btn.classList.toggle('open', wrap.classList.contains('open'));
  });

  wrap.querySelectorAll('.custom-dropdown-option').forEach(opt => {
    opt.addEventListener('click', () => {
      const val = opt.dataset.value;
      wrap.querySelectorAll('.custom-dropdown-option').forEach(o => o.classList.toggle('selected', o === opt));
      const inner = opt.querySelector('[data-i18n]');
      const key = inner && inner.getAttribute('data-i18n');
      if (key) {
        label.innerHTML = `<span data-i18n="${key}">${escapeHtml(t(key))}</span> <span class="opt-arrow">↓</span>`;
      } else {
        label.textContent = opt.textContent.trim();
      }
      wrap.classList.remove('open');
      btn.classList.remove('open');
      lbState.filters.sort = val;
      persistLbFilters();
      loadTopTab(true);
    });
  });

  document.addEventListener('click', (e) => {
    if (!wrap.contains(e.target)) {
      wrap.classList.remove('open');
      btn.classList.remove('open');
    }
  });
})();
// Filter modal — overlay + centred panel. Open on the filter icon, close
// on Apply / Esc / backdrop click. (Reset stays open so the user can
// re-tune without re-opening.)
function _openFilterModal() {
  const ov = document.getElementById('filterOverlay');
  const btn = document.getElementById('filterToggleBtn');
  if (ov) ov.style.display = 'flex';
  if (btn) btn.classList.add('active');
}
function _closeFilterPanel() {
  const ov = document.getElementById('filterOverlay');
  const btn = document.getElementById('filterToggleBtn');
  if (ov) ov.style.display = 'none';
  if (btn) btn.classList.remove('active');
}
wire('filterToggleBtn', 'click', () => {
  const ov = document.getElementById('filterOverlay');
  if (ov && ov.style.display !== 'none') _closeFilterPanel();
  else _openFilterModal();
});
// Click on the dim backdrop (anything outside the .filter-advanced panel) closes
document.getElementById('filterOverlay')?.addEventListener('click', (e) => {
  if (e.target.id === 'filterOverlay') _closeFilterPanel();
});
// Esc closes the modal — register once at module scope, harmless when modal is hidden
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const ov = document.getElementById('filterOverlay');
  if (ov && ov.style.display !== 'none') _closeFilterPanel();
});

const FILTER_FIELD_MAP = {
  filterMinScore:   'minScore',
  filterMaxScore:   'maxScore',
  filterMinFans:    'minFans',
  filterMinQuality: 'minQuality',
  filterMinPosts:   'minPosts',
  filterMinVideos:  'minVideos',
  filterMinStreams: 'minStreams',
  filterMinAge:     'minAge',
  filterMinPrice:   'minPrice',
  filterMaxPrice:   'maxPrice'
};
wire('filterApplyBtn', 'click', () => {
  for (const [inputId, key] of Object.entries(FILTER_FIELD_MAP)) {
    lbState.filters[key] = document.getElementById(inputId)?.value || '';
  }
  persistLbFilters();
  _closeFilterPanel();
  loadTopTab(true);
});
wire('filterResetBtn', 'click', () => {
  for (const [inputId, key] of Object.entries(FILTER_FIELD_MAP)) {
    const el = document.getElementById(inputId); if (el) el.value = '';
    lbState.filters[key] = '';
  }
  persistLbFilters();
  loadTopTab(true);
});
wire('loadMoreBtn', 'click', () => loadTopTab(false));

// Notes sub-tabs
document.querySelectorAll('.notes-subtab').forEach(btn => {
  btn.addEventListener('click', () => setNotesView(btn.dataset.subview));
});

// ============ Boot ============
(async () => {
  // Load saved language before any text is rendered, so the very first paint
  // is already in the user's language. Defaults to English when unset.
  try {
    const { ofStatsLang } = await chrome.storage.local.get('ofStatsLang');
    if (ofStatsLang === 'ru' || ofStatsLang === 'en') currentLang = ofStatsLang;
  } catch {}
  applyLanguage();

  const auth = await send('getAuthStatus');
  if (auth.isAuthenticated) {
    await enterMainScreen({ email: auth.email });
    // If there was an unfinished payment when the popup last closed, jump
    // straight back to it so the user can keep paying or click Verify.
    await restorePaymentIfAny();
    // When the popup is opened in a standalone window from the badge
    // "Renew" CTA, the user has already expressed intent to subscribe —
    // skip the locked Top Models view and land them on the Subscription
    // page right away.
    if (isStandaloneWindow) {
      try { await openSubscriptionPage(); } catch {}
    }
  } else {
    show('login');
  }
})();
