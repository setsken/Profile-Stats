// Early injection script - runs at document_start before any content renders
(async function() {
  'use strict';
  
  // Debug flag - set to false in production to disable all console logs
  const DEBUG = false;
  function log(...args) { if (DEBUG) log(...args); }
  function logError(...args) { if (DEBUG) logError(...args); }
  
  // Check if user is authenticated.
  // Read OUR flag (psAuthStatus) first — set by Profile Stats background on
  // login/logout. Fall back to the legacy ofStatsAuthStatus from Stats
  // Editor so users who installed only PS before this change keep working
  // until the next PS login round-trip writes the new key.
  const psStatus = localStorage.getItem('psAuthStatus');
  const seStatus = localStorage.getItem('ofStatsAuthStatus');
  const localSaysAuth = psStatus === 'authenticated'
    || (psStatus == null && seStatus === 'authenticated');

  // Synchronous fast-path: if localStorage already says authenticated, run
  // the badge logic immediately so the user sees zero delay.
  // Otherwise we don't bail — instead we ask our background service worker
  // (single source of truth for the PS authToken) and only abort if it
  // confirms no auth. This fixes a startup race: inject-early runs at
  // document_start, but the SW broadcast that stamps psAuthStatus may
  // arrive several ms later, leaving us with a stale 'not_authenticated'
  // from SE's last logout.
  let isAuthenticated = localSaysAuth;
  if (!isAuthenticated) {
    try {
      const resp = await new Promise((resolve) => {
        try {
          chrome.runtime.sendMessage({ action: 'getAuthStatus' }, (r) => {
            if (chrome.runtime.lastError) resolve(null);
            else resolve(r);
          });
        } catch { resolve(null); }
      });
      if (resp && resp.isAuthenticated) {
        isAuthenticated = true;
        // Persist for future quick-starts on this origin
        try { localStorage.setItem('psAuthStatus', 'authenticated'); } catch {}
      }
    } catch {}
  }

  // If not authenticated, don't run any plugin functionality
  if (!isAuthenticated) {
    log('OF Stats Early: Not authenticated, plugin disabled');
    return;
  }

  // ==================== i18n for Badge ====================
  var _ofLang = localStorage.getItem('ofStatsLang') || 'ru';
  var _lastBadgeProfileData = null;
  var _compareModelData = null; // saved model for comparison (loaded from chrome.storage)
  var _badgeI18n = {
    ru: {
      // Front side
      profileStats: 'Статистика профиля', details: 'Детали', back: 'Назад',
      hidden: 'Скрыто', unknown: 'Неизвестно', online: 'Онлайн', free: 'FREE', open: 'Откр.', closed: 'Закр.',
      // Grade tooltips
      gradeTop: '🏆 TOP (80–100 баллов)\nПроверенный профиль с отличными показателями. Реальная модель с высокой активностью, органичным ростом и открытой статистикой.',
      gradeGood: '⭐ Good (60–79 баллов)\nХороший профиль с нормальными метриками. Скорее всего реальная модель, но часть метрик скрыта или ниже идеала.',
      gradeAverage: '📊 Average (40–59 баллов)\nСредний профиль. Много данных скрыто или метрики слабые. Может быть новичок или неактивная модель.',
      gradeSuspicious: '⚠️ Suspicious (20–39 баллов)\nПодозрительный профиль. Обнаружены признаки фарма или накрутки. Рекомендуется осторожность.',
      gradeFake: '🚫 Likely Fake (0–19 баллов)\nВероятно фейковый профиль. Очень низкие показатели, множество красных флагов.',
      // Component tooltips
      compMAT: 'Maturity — возраст аккаунта. Чем старше и активнее, тем выше балл',
      compPOP: 'Popularity — количество фанов. Учитывает скрытость и рост',
      compORG: 'Organicity — органичность лайков. Выявляет накрутки и ботов',
      compACT: 'Activity — активность: посты/мес, онлайн-статус, стримы, видео',
      compTRS: 'Transparency — прозрачность: открытые комменты, фаны, верификация',
      // Sections
      radarAnalysis: 'Radar Stats', xrayMode: 'X-Ray Mode',
      warnings: '⚠ Предупреждения', achievements: '✓ Достижения',
      verdictAI: 'Вердикт AI', analyzing: 'Анализ...', unavailable: 'Недоступно',
      verdictGrade: { 'S': 'Превосходный профиль', 'A+': 'Отличный профиль', 'A': 'Хороший профиль', 'B+': 'Неплохой профиль', 'B': 'Средний профиль', 'C': 'Ниже среднего', 'D': 'Слабый профиль', 'F': 'Критический профиль' },
      // X-Ray keys
      estRevenue: 'Доход (прим.)', fansMonth: 'Фанов/мес', engagement: 'Вовлечённость',
      content: 'Контент', likesPost: 'Лайков/Пост', videos: 'Видео', streams: 'Стримы',
      accountAge: 'Возраст акк.', fans: 'Фаны', comments: 'Комментарии',
      // X-Ray values
      fansPerMonth: ' фанов/мес', postsPerMonth: ' постов/мес',
      videoCount: ' видео', streamCount: ' стримов', fansCount: ' фанов',
      perMonth: '/мес', likesPerFan: ' likes/fan',
      commentsOpen: 'Открыты', commentsRestricted: 'Ограничены',
      yearShort: 'г ', monthShort: 'мес',
      // Flag tooltips
      flagAbandoned: 'Заброшенный аккаунт: ',
      flagPostsFor: ' постов за ',
      flagMonths: ' мес.',
      flagPostsPerMonth: ' постов/мес)',
      flagBottedLikes: 'Подозрение на накрутку лайков: ',
      flagLikesPerPost: ' лайков/пост при ',
      flagPosts: ' постах',
      flagLowContent: 'Мало контента: всего ',
      flagSlowGrowth: 'Медленный рост: ',
      flagFansPerMonth: ' фанов/мес за ',
      flagBoostedLikes: 'Накрученные лайки: 100K+ лайков при аккаунте младше 3 месяцев',
      flagBoughtFans: 'Купленные фаны: 50K+ фанов, но меньше 1K лайков',
      flagFakeFans: 'Накрутка фанов: ',
      flagFakeFansSuffix: ' фанов/мес — невозможно набрать органически',
      flagSuspectGrowth: 'Подозрительный рост: ',
      flagSuspectGrowthSuffix: ' фанов/мес — вероятна накрутка',
      flagLowTrust: 'Низкое доверие: фаны скрыты и комментарии закрыты',
      flagEmptyProfile: 'Пустой профиль: есть фаны, но 0 постов',
      flagNoProfileImage: 'Нет аватарки и шапки профиля — признак фарм-аккаунта',
      flagNoAvatar: 'Нет аватарки — подозрительно для реального профиля',
      flagBulkPosting: 'Массовый постинг: 100+ постов/мес — признак фарма',
      flagNewcomer: 'Новичок: аккаунту меньше 3 месяцев',
      flagInflatedLikes: 'Вероятная накрутка лайков: ',
      flagInflatedByTempo: ' лайков/мес за ',
      flagInflatedByFanRatio: 'x лайков на фана при ',
      flagInflatedByFanRatioSuffix: ' фанах',
      flagInflatedByPostRatio: ' лайков/пост при ',
      flagVerified: 'Верифицирован — подтвержден OnlyFans',
      flagSocial: 'Есть ',
      flagSocialSuffix: ' — подтверждает реальность профиля (+2 балла)',
      flagWebsite: 'Есть внешний сайт (+1 балл)',
      flagStreamLegend: '1000+ стримов — алмазный стример',
      flagStreamPlatinum: '500+ стримов — платиновый стример',
      flagStreamMaster: '100+ стримов — мастер прямых эфиров',
      flagTopStreamer: '30+ стримов — топ-стример',
      flagActiveStreamer: '10+ стримов — активный стример',
      flagStreamer: '3+ стримов — проводит прямые трансляции',
      flagDiamondOG: 'Аккаунту 6+ лет — алмазный креатор',
      flagPlatinumOG: 'Аккаунту 4+ года — платиновый креатор',
      flagOGCreator: 'Аккаунту 3+ года — оригинальный креатор',
      flagVeteran: 'Аккаунту 2+ года — проверенный временем',
      flagLegend: '500K+ фанов — легенда платформы',
      flagIcon: '100K+ фанов — икона с огромной аудиторией',
      flagSuperstar: '50K+ фанов — суперзвезда платформы',
      flagStarPower: '25K+ фанов — мощная звёздная аудитория',
      flagFanFavorite: '10K+ фанов — фаворит аудитории',
      flagTrending: '5K+ фанов — на волне популярности',
      flagRisingStar: '1K+ фанов — восходящая звезда',
      flagOrganicGrowth: 'Органический рост: ~',
      flagOrganicGrowthSuffix: ' — здоровый темп роста',
      flagVideoDiamond: '1000+ видео — алмазный видеограф',
      flagVideoPlatinum: '500+ видео — платиновый видеограф',
      flagVideoMaster: '100+ видео — мастер видео',
      flagVideoCreator: '30+ видео — активно снимает видео',
      flagContentDiamond: '3000+ постов — алмазный объём контента',
      flagContentPlatinum: '1000+ постов — платиновый объём контента',
      flagContentPro: '500+ постов — профессиональный объём',
      flagContentRich: '300+ постов — много контента',
      flagContentMaker: '100+ постов — стабильный контент',
      flagLikesLegend: '1M+ лайков — легендарная вовлечённость',
      flagDiamondLikes: '500K+ лайков — алмазная вовлечённость',
      flagPlatinumLikes: '250K+ лайков — платиновая вовлечённость',
      flagMegaLiked: '100K+ лайков — невероятная вовлечённость',
      flagSuperLiked: '50K+ лайков — очень высокая вовлечённость',
      flagWellLiked: '25K+ лайков — высокая вовлечённость',
      flagLiked: '10K+ лайков — хорошая вовлечённость',
      flagRisingLikes: '5K+ лайков — растущая вовлечённость',
      flagOpenBook: 'Открытый профиль: фаны видны и комментарии открыты',
      flagFreeAccess: 'Бесплатная подписка — свободный доступ',
      flagPremium: '/мес — премиум подписка',
      flagHighEngage: 'Высокая вовлечённость: ',
      flagHighEngageSuffix: ' лайков на фана',
      flagActiveNow: 'Активна прямо сейчас: ',
      flagActiveNowSuffix: ' постов/мес, онлайн',
      // Fans trend
      trendTab: 'Тренд', radarTab: 'Радар', fansTrend: 'Тренд Фанов',
      trendGained: 'Прирост', trendPerDay: 'В день', trendReports: 'Точки',
      trendAll: 'Все', trendNoData: 'Недостаточно данных',
      // Milestone Timeline
      milestoneTitle: 'Milestone Timeline', milestoneFans: 'фанов',
      milestoneCurrent: 'сейчас', milestoneForecast: 'прогноз',
      milestoneFor: 'за', milestoneDays: 'дн.', milestoneNoData: 'Нет данных для трекера',
      msMonths: ['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек'],
      msMonthsFull: ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'],
      msMo: 'мес', msYr: 'г',
      // Engagement percentile (Radar tab)
      engagementPercentileTitle: 'Перцентиль вовлечённости',
      betterThanModels: 'Лучше, чем у ',
      analyzedModelsSuffix: ' профилей',
      engagementRateLabel: 'ВОВЛЕЧЁННОСТЬ',
      vsAverageLabel: 'К СРЕДНЕМУ',
      modelsAnalyzedLabel: 'ПРОФИЛЕЙ',
      percentileBasis: 'на основе score, organicity и red flags',
      aggregatedDB: 'агрегированный перцентиль БД',
      qualityEstimate: 'оценка качества профиля',
      // Compare (Feature #6)
      compareBtn: 'Сравнить', compareSaved: 'Сохранено', compareTitle: 'Сравнение', compareWins: 'побеждает',
      compareByMetrics: 'по метрикам', compareTie: 'Ничья', compareClear: 'Очистить',
      compareBack: 'Назад к профилю',
      // Quick Notes (Feature #7)
      notesTab: 'Заметка', notesTagsTab: 'Теги', notesModelsTab: 'Модели',
      notesSave: 'Сохранить', notesSaved: 'Сохранено', notesPlaceholder: 'Напишите заметку о модели...',
      notesClickToAdd: 'Нажмите, чтобы добавить заметку...', notesCreateTag: 'Создать тег',
      notesTagName: 'Имя тега...', notesNoModels: 'Нет моделей с этим тегом',
      notesAll: 'Все', notesModels: 'моделей', notesModel: 'модель',
      // Smart Alerts (Feature #8)
      alertsTitle: 'Smart Alerts', alertsEmpty: 'Нет уведомлений', alertsClearAll: 'Очистить все',
      alertFansSurge: 'набрала', alertFansDrop: 'потеряла', alertFans: 'фанов за день',
      alertLikesSurge: 'набрала', alertLikesDrop: 'потеряла', alertLikes: 'лайков',
      alertScoreUp: 'Score вырос', alertScoreDown: 'Score упал',
      // Paywall
      paywallRenew: 'Продлить подписку', paywallExpired: 'Подписка истекла',
      // AI payload
      aiDate: 'дата: ', aiRecentlyOnline: 'был(а) недавно', aiUnknown: 'неизвестно',
      // Achievement / warning chip labels (short text shown on the chip itself).
      // Lookup by the original English text — keep keys identical to the EN labels
      // emitted in result.flags so tLabel('Newcomer') maps to 'Новичок' here.
      flagLabels: {
        'Abandoned': 'Заброшен',
        'Botted Likes': 'Накрутка лайков',
        'Low Content': 'Мало контента',
        'Slow Growth': 'Медл. рост',
        'Boosted Likes': 'Бустед лайки',
        'Bought Fans': 'Куплены фаны',
        'Fake Fans': 'Фейк-фаны',
        'Suspect Growth': 'Подозр. рост',
        'Low Trust': 'Низкое доверие',
        'Empty Profile': 'Пустой профиль',
        'No Profile Image': 'Нет фото',
        'No Avatar': 'Нет аватара',
        'Bulk Posting': 'Масс. постинг',
        'Newcomer': 'Новичок',
        'Inflated Likes': 'Накрученные лайки',
        'Verified': 'Верифицирован',
        'Website': 'Сайт',
        'Stream Legend': 'Легенда стримов',
        'Stream Platinum': 'Платина стримов',
        'Stream Master': 'Мастер стримов',
        'Top Streamer': 'Топ-стример',
        'Active Streamer': 'Актив. стример',
        'Streamer': 'Стример',
        'Diamond OG': 'Алмаз. ветеран',
        'Platinum OG': 'Платин. ветеран',
        'OG Creator': 'OG-креатор',
        'Veteran': 'Ветеран',
        'Legend': 'Легенда',
        'Icon': 'Икона',
        'Superstar': 'Суперзвезда',
        'Star Power': 'Звёздная',
        'Fan Favorite': 'Любимица фанов',
        'Trending': 'В тренде',
        'Rising Star': 'Восх. звезда',
        'Organic Growth': 'Органич. рост',
        'Video Diamond': 'Алмаз видео',
        'Video Platinum': 'Платина видео',
        'Video Master': 'Мастер видео',
        'Video Creator': 'Видеокреатор',
        'Content Diamond': 'Алмаз контента',
        'Content Platinum': 'Платина контента',
        'Content Pro': 'Контент-про',
        'Content Rich': 'Много контента',
        'Content Maker': 'Контент-мейкер',
        'Likes Legend': 'Легенда лайков',
        'Diamond Likes': 'Алмаз лайков',
        'Platinum Likes': 'Платина лайков',
        'Mega Liked': 'Мега-лайки',
        'Super Liked': 'Супер-лайки',
        'Well Liked': 'Хорошо лайкают',
        'Liked': 'Лайкают',
        'Rising Likes': 'Растут лайки',
        'Open Book': 'Откр. профиль',
        'Free Access': 'Бесплатный',
        'Premium': 'Премиум',
        'High Engage': 'Выс. вовлеч.',
        'Active Now': 'Активна сейчас'
      },
    },
    en: {
      profileStats: 'Profile Stats', details: 'Details', back: 'Back',
      hidden: 'Hidden', unknown: 'Unknown', online: 'Online', free: 'FREE', open: 'Open', closed: 'Closed',
      gradeTop: '🏆 TOP (80–100 points)\nVerified profile with excellent metrics. Real model with high activity, organic growth and open statistics.',
      gradeGood: '⭐ Good (60–79 points)\nGood profile with normal metrics. Likely a real model, but some metrics are hidden or below ideal.',
      gradeAverage: '📊 Average (40–59 points)\nAverage profile. Many data hidden or metrics are weak. Could be a newcomer or inactive model.',
      gradeSuspicious: '⚠️ Suspicious (20–39 points)\nSuspicious profile. Signs of farming or fake engagement detected. Proceed with caution.',
      gradeFake: '🚫 Likely Fake (0–19 points)\nLikely fake profile. Very low metrics, multiple red flags.',
      compMAT: 'Maturity — account age. The older and more active, the higher the score',
      compPOP: 'Popularity — fan count. Considers hidden status and growth',
      compORG: 'Organicity — like authenticity. Detects bots and fake engagement',
      compACT: 'Activity — posts/month, online status, streams, videos',
      compTRS: 'Transparency — open comments, visible fans, verification',
      radarAnalysis: 'Radar Analysis', xrayMode: 'X-Ray Mode',
      warnings: '⚠ Warnings', achievements: '✓ Achievements',
      verdictAI: 'Verdict AI', analyzing: 'Analyzing...', unavailable: 'Unavailable',
      verdictGrade: { 'S': 'Excellent profile', 'A+': 'Outstanding profile', 'A': 'Good profile', 'B+': 'Above average', 'B': 'Average profile', 'C': 'Below average', 'D': 'Poor profile', 'F': 'Critical profile' },
      estRevenue: 'Est. Revenue', fansMonth: 'Fans/month', engagement: 'Engagement',
      content: 'Content', likesPost: 'Likes/Post', videos: 'Videos', streams: 'Streams',
      accountAge: 'Account Age', fans: 'Fans', comments: 'Comments',
      fansPerMonth: ' fans/mo', postsPerMonth: ' posts/mo',
      videoCount: ' videos', streamCount: ' streams', fansCount: ' fans',
      perMonth: '/mo', likesPerFan: ' likes/fan',
      commentsOpen: 'Open', commentsRestricted: 'Restricted',
      yearShort: 'y ', monthShort: 'mo',
      flagAbandoned: 'Abandoned account: ',
      flagPostsFor: ' posts in ',
      flagMonths: ' mo.',
      flagPostsPerMonth: ' posts/mo)',
      flagBottedLikes: 'Suspected fake likes: ',
      flagLikesPerPost: ' likes/post with ',
      flagPosts: ' posts',
      flagLowContent: 'Low content: only ',
      flagSlowGrowth: 'Slow growth: ',
      flagFansPerMonth: ' fans/mo in ',
      flagBoostedLikes: 'Boosted likes: 100K+ likes on an account younger than 3 months',
      flagBoughtFans: 'Bought fans: 50K+ fans but fewer than 1K likes',
      flagFakeFans: 'Fake fans: ',
      flagFakeFansSuffix: ' fans/mo — impossible to gain organically',
      flagSuspectGrowth: 'Suspect growth: ',
      flagSuspectGrowthSuffix: ' fans/mo — likely boosted',
      flagLowTrust: 'Low trust: fans hidden and comments closed',
      flagEmptyProfile: 'Empty profile: has fans but 0 posts',
      flagNoProfileImage: 'No avatar and header image — sign of a farm account',
      flagNoAvatar: 'No avatar — suspicious for a real profile',
      flagBulkPosting: 'Bulk posting: 100+ posts/mo — sign of farming',
      flagNewcomer: 'Newcomer: account is less than 3 months old',
      flagInflatedLikes: 'Likely inflated likes: ',
      flagInflatedByTempo: ' likes/mo in ',
      flagInflatedByFanRatio: 'x likes per fan with ',
      flagInflatedByFanRatioSuffix: ' fans',
      flagInflatedByPostRatio: ' likes/post with ',
      flagVerified: 'Verified — confirmed by OnlyFans',
      flagSocial: 'Has ',
      flagSocialSuffix: ' — confirms profile authenticity (+2 pts)',
      flagWebsite: 'Has external website (+1 pt)',
      flagStreamLegend: '1000+ streams — diamond streamer',
      flagStreamPlatinum: '500+ streams — platinum streamer',
      flagStreamMaster: '100+ streams — streaming master',
      flagTopStreamer: '30+ streams — top streamer',
      flagActiveStreamer: '10+ streams — active streamer',
      flagStreamer: '3+ streams — does live broadcasts',
      flagDiamondOG: 'Account 6+ years — diamond creator',
      flagPlatinumOG: 'Account 4+ years — platinum creator',
      flagOGCreator: 'Account 3+ years — original creator',
      flagVeteran: 'Account 2+ years — time-tested',
      flagLegend: '500K+ fans — platform legend',
      flagIcon: '100K+ fans — icon with a massive audience',
      flagSuperstar: '50K+ fans — platform superstar',
      flagStarPower: '25K+ fans — powerful star audience',
      flagFanFavorite: '10K+ fans — fan favorite',
      flagTrending: '5K+ fans — riding the wave',
      flagRisingStar: '1K+ fans — rising star',
      flagOrganicGrowth: 'Organic growth: ~',
      flagOrganicGrowthSuffix: ' — healthy growth rate',
      flagVideoDiamond: '1000+ videos — diamond videographer',
      flagVideoPlatinum: '500+ videos — platinum videographer',
      flagVideoMaster: '100+ videos — video master',
      flagVideoCreator: '30+ videos — actively creates video',
      flagContentDiamond: '3000+ posts — diamond content volume',
      flagContentPlatinum: '1000+ posts — platinum content volume',
      flagContentPro: '500+ posts — professional volume',
      flagContentRich: '300+ posts — rich content',
      flagContentMaker: '100+ posts — stable content',
      flagLikesLegend: '1M+ likes — legendary engagement',
      flagDiamondLikes: '500K+ likes — diamond engagement',
      flagPlatinumLikes: '250K+ likes — platinum engagement',
      flagMegaLiked: '100K+ likes — incredible engagement',
      flagSuperLiked: '50K+ likes — very high engagement',
      flagWellLiked: '25K+ likes — high engagement',
      flagLiked: '10K+ likes — good engagement',
      flagRisingLikes: '5K+ likes — growing engagement',
      flagOpenBook: 'Open profile: fans visible and comments open',
      flagFreeAccess: 'Free subscription — open access',
      flagPremium: '/mo — premium subscription',
      flagHighEngage: 'High engagement: ',
      flagHighEngageSuffix: ' likes per fan',
      flagActiveNow: 'Active right now: ',
      flagActiveNowSuffix: ' posts/mo, online',
      // Fans trend
      trendTab: 'Trend', radarTab: 'Radar', fansTrend: 'Fans Trend',
      trendGained: 'Gained', trendPerDay: 'Per Day', trendReports: 'Points',
      trendAll: 'All', trendNoData: 'Not enough data',
      // Milestone Timeline
      milestoneTitle: 'Milestone Timeline', milestoneFans: 'fans',
      milestoneCurrent: 'now', milestoneForecast: 'forecast',
      milestoneFor: 'in', milestoneDays: 'days', milestoneNoData: 'No data for tracker',
      msMonths: ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'],
      msMonthsFull: ['January','February','March','April','May','June','July','August','September','October','November','December'],
      msMo: 'mo', msYr: 'y',
      // Engagement percentile (Radar tab)
      engagementPercentileTitle: 'Engagement Percentile',
      betterThanModels: 'Better engagement than ',
      analyzedModelsSuffix: ' analyzed models',
      engagementRateLabel: 'ENGAGEMENT RATE',
      vsAverageLabel: 'VS AVERAGE',
      modelsAnalyzedLabel: 'MODELS',
      percentileBasis: 'based on score, organicity and red flags',
      aggregatedDB: 'aggregated DB percentile',
      qualityEstimate: 'quality score estimate',
      // Compare (Feature #6)
      compareBtn: 'Compare', compareSaved: 'Saved', compareTitle: 'Comparison', compareWins: 'wins',
      compareByMetrics: 'by metrics', compareTie: 'Tie', compareClear: 'Clear',
      compareBack: 'Back to profile',
      // Quick Notes (Feature #7)
      notesTab: 'Note', notesTagsTab: 'Tags', notesModelsTab: 'Models',
      notesSave: 'Save', notesSaved: 'Saved', notesPlaceholder: 'Write a note about this model...',
      notesClickToAdd: 'Click to add a note...', notesCreateTag: 'Create tag',
      notesTagName: 'Tag name...', notesNoModels: 'No models with this tag',
      notesAll: 'All', notesModels: 'models', notesModel: 'model',
      // Smart Alerts (Feature #8)
      alertsTitle: 'Smart Alerts', alertsEmpty: 'No alerts', alertsClearAll: 'Clear all',
      alertFansSurge: 'gained', alertFansDrop: 'lost', alertFans: 'fans in a day',
      alertLikesSurge: 'gained', alertLikesDrop: 'lost', alertLikes: 'likes',
      alertScoreUp: 'Score increased', alertScoreDown: 'Score decreased',
      // Paywall
      paywallRenew: 'Renew Subscription', paywallExpired: 'Subscription expired',
      aiDate: 'date: ', aiRecentlyOnline: 'recently online', aiUnknown: 'unknown',
      // English flag labels are the source of truth — empty map means "use the
      // original English text passed to tLabel()".
      flagLabels: {}
    }
  };
  function t(key) { return (_badgeI18n[_ofLang] || _badgeI18n.ru)[key] || (_badgeI18n.ru)[key] || key; }
  // Look up a chip/flag label in the current locale, falling back to the
  // original English text if no translation is registered.
  function tLabel(text) {
    var dict = _badgeI18n[_ofLang] || _badgeI18n.ru;
    var labels = dict.flagLabels || {};
    return labels[text] || text;
  }
  
  // Check subscription status from localStorage
  // This is set by popup.js when subscription is checked
  let subscriptionActive = true;
  try {
    const subStatus = localStorage.getItem('ofStatsSubActive');
    if (subStatus === 'false') {
      subscriptionActive = false;
      log('OF Stats Early: Subscription not active, clearing cached data but keeping Profile Interceptor');
      // Clear all cached fake data
      localStorage.removeItem('ofStatsCache');
      localStorage.removeItem('ofStatsEarningStats');
      localStorage.removeItem('ofStatsEarningsData');
      // DON'T return here - we still need Profile Interceptor for fans tracking
    }
  } catch(e) {}
  
  // Get cached values from localStorage (SYNC - instant!)
  let cachedSettings = null;
  try {
    const cached = localStorage.getItem('ofStatsCache');
    if (cached) {
      cachedSettings = JSON.parse(cached);
    }
  } catch(e) {}

  // Pre-inject CSS to hide native .b-top-rated on statistics page immediately.
  // Must be as early as possible (before shouldRunMainLogic return) to prevent blue flash.
  if (cachedSettings && cachedSettings.enabled && cachedSettings.topCreators &&
      window.location.pathname.includes('/my/statistics/statements/earnings')) {
    if (!document.getElementById('of-stats-hide-native-top-rated')) {
      var earlyHideStyle = document.createElement('style');
      earlyHideStyle.id = 'of-stats-hide-native-top-rated';
      earlyHideStyle.textContent = '.b-top-rated:not(#of-stats-top-creators-rated){display:none!important}';
      (document.head || document.documentElement).appendChild(earlyHideStyle);
    }
  }

  // Early declaration of earningStatsData - load from localStorage IMMEDIATELY
  // This ensures preset data is available before any generation happens
  var earningStatsData = null;
  try {
    const savedEarningStats = localStorage.getItem('ofStatsEarningStats');
    if (savedEarningStats) {
      earningStatsData = JSON.parse(savedEarningStats);
      if (earningStatsData && earningStatsData.fromPreset) {
        log('OF Stats Early: Loaded earning stats from preset at startup - Gross: $' + (earningStatsData.gross || 0).toFixed(2));
      }
    }
  } catch(e) {}
  
  // Function to check if current page is our model's profile (where we should apply fake values)
  function isOwnProfilePage() {
    const path = window.location.pathname;
    
    // Check if we're on /my/ pages (definitely own page - stats, settings, etc.)
    if (path.startsWith('/my/')) return true;
    
    // Get our saved model username from settings
    const ourUsername = cachedSettings && cachedSettings.myModelUsername ? cachedSettings.myModelUsername.toLowerCase() : null;
    
    // Get username from URL
    const pathParts = path.split('/').filter(Boolean);
    if (pathParts.length > 0) {
      const firstPart = pathParts[0].toLowerCase();
      
      // System pages - not a profile page, show fake values
      const systemPages = ['my', 'notifications', 'messages', 'chats', 'settings', 'collections', 'bookmarks', 'lists', 'subscribers', 'subscriptions', 'search', 'explore'];
      if (systemPages.includes(firstPart)) {
        return true;
      }
      
      // This is a profile page (username in URL)
      // ONLY show fake values if this is OUR saved username
      if (ourUsername) {
        return firstPart === ourUsername;
      }
      
      // No saved username yet - don't show fake values on any profile page
      return false;
    }
    
    // Root page or other - allow fake values
    return true;
  }
  
  // ==================== PROFILE DATA INTERCEPTOR ====================
  // Intercept API responses to extract hidden profile data (fans count, join date, etc.)
  // This MUST be injected into page context to intercept fetch (content scripts are isolated)
  // Due to CSP, we load an external file instead of inline script
  
  (function setupProfileInterceptor() {
    // Inject the script file into page context (external file to bypass CSP)
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('page-interceptor.js');
    script.onload = function() {
      log('OF Stats: Page interceptor loaded successfully');
      this.remove(); // Clean up DOM
    };
    script.onerror = function() {
      logError('OF Stats: Failed to load page interceptor');
    };
    (document.head || document.documentElement).appendChild(script);
    
    log('OF Stats: Profile interceptor script injected');
    
    // Quick format number for API (1234 -> 1.2K) - needed before main function definition
    function quickFormatNumber(num) {
      if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
      if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
      return String(num);
    }

    // LTTB (Largest-Triangle-Three-Buckets) downsampling
    // Keeps visually important points for chart readability
    function lttbDownsample(data, threshold) {
      if (data.length <= threshold) return data;
      var sampled = [data[0]];
      var bucketSize = (data.length - 2) / (threshold - 2);
      var a = 0;
      for (var i = 1; i < threshold - 1; i++) {
        var avgStart = Math.floor((i) * bucketSize) + 1;
        var avgEnd = Math.min(Math.floor((i + 1) * bucketSize) + 1, data.length);
        var avgX = 0, avgY = 0, cnt = 0;
        for (var j = avgStart; j < avgEnd; j++) { avgX += j; avgY += data[j].f; cnt++; }
        avgX /= cnt; avgY /= cnt;
        var rangeStart = Math.floor((i - 1) * bucketSize) + 1;
        var rangeEnd = Math.floor((i) * bucketSize) + 1;
        var maxArea = -1, maxIdx = rangeStart;
        for (var k = rangeStart; k < rangeEnd; k++) {
          var area = Math.abs((a - avgX) * (data[k].f - data[a].f) - (a - k) * (avgY - data[a].f));
          if (area > maxArea) { maxArea = area; maxIdx = k; }
        }
        sampled.push(data[maxIdx]);
        a = maxIdx;
      }
      sampled.push(data[data.length - 1]);
      return sampled;
    }
    
    // Listen for profile data events dispatched from page context
    window.addEventListener('ofStatsProfileData', async function(e) {
      const profileData = e.detail;
      log('OF Stats: Received profile data event:', profileData);
      
      // Report fans to global registry if visible AND model is verified (has checkmark)
      // Only verified creators should be tracked in global registry
      // Throttle: max once per calendar day per username to ensure daily trend points are updated
      if (profileData.username && profileData.isVerified && profileData.subscribersCount !== undefined && profileData.subscribersCount !== null) {
        const reportDayKey = 'ofStatsLastReportDay_' + profileData.username;
        const reportLegacyTsKey = 'ofStatsLastReport_' + profileData.username;
        const todayLocal = new Date();
        const todayKey = todayLocal.getFullYear() + '-' + String(todayLocal.getMonth() + 1).padStart(2, '0') + '-' + String(todayLocal.getDate()).padStart(2, '0');
        const lastReportDay = localStorage.getItem(reportDayKey);
        
        if (lastReportDay !== todayKey) {
          try {
            const result = await chrome.runtime.sendMessage({
              action: 'reportFans',
              username: profileData.username,
              fansCount: profileData.subscribersCount,
              fansText: quickFormatNumber(profileData.subscribersCount),
              reportDay: todayKey
            });
            if (result && result.recorded) {
              localStorage.setItem(reportDayKey, todayKey);
              localStorage.setItem(reportLegacyTsKey, String(Date.now()));
              log('OF Stats: Fans recorded to global registry for @' + profileData.username + ' (verified)');
            }
          } catch (e) {
            log('OF Stats: Could not report fans:', e);
          }
        } else {
          log('OF Stats: Skipping reportFans for @' + profileData.username + ' (already reported today)');
        }
      }
      
      // If fans are hidden, try to get last known value from global registry
      if (profileData.showSubscribersCount === false && profileData.username) {
        try {
          const fansData = await chrome.runtime.sendMessage({
            action: 'getFans',
            username: profileData.username
          });
          
          if (fansData && fansData.found && fansData.lastFans) {
            profileData._lastKnownFans = fansData.lastFans;
            log('OF Stats: Found last known fans for @' + profileData.username + ':', fansData.lastFans);
          }
        } catch (e) {
          log('OF Stats: Could not fetch last known fans:', e);
        }
      }
      
      // Check farmed model comment status
      if (profileData.username) {
        try {
          const farmedData = await chrome.runtime.sendMessage({
            action: 'checkFarmedModel',
            username: profileData.username
          });
          if (farmedData && farmedData.found) {
            profileData._farmedStatus = farmedData.status; // 'ready', 'none', or null
            log('OF Stats: Farmed model status for @' + profileData.username + ':', farmedData.status);
          }
        } catch (e) {
          log('OF Stats: Could not check farmed model:', e);
        }
      }
      
      // Social media detection happens inside displayProfileData with retry,
      // because OF renders social links via Vue AFTER API data arrives
      profileData._detectedSocials = [];
      
      // Fetch fans trend from server (after reportFans to ensure today's point is written)
      profileData._fansTrend = null;
      profileData._fansTrendRaw = null;
      if (profileData.username) {
        try {
          const trendData = await chrome.runtime.sendMessage({
            action: 'getFansTrend',
            username: profileData.username,
            days: 90
          });
          if (trendData && trendData.points && trendData.points.length >= 1) {
            var pts = trendData.points;
            // Ensure today's point is present (inject from live data if missing)
            if (profileData.subscribersCount != null) {
              var now = new Date();
              var todayStr = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
              var lastPt = pts[pts.length - 1];
              if (lastPt.d !== todayStr) {
                pts.push({ d: todayStr, f: profileData.subscribersCount });
              } else if (lastPt.f !== profileData.subscribersCount) {
                lastPt.f = profileData.subscribersCount;
              }
            }
            profileData._fansTrendRaw = pts.slice();
            if (pts.length >= 2) {
              profileData._fansTrend = pts;
              log('OF Stats: Fans trend loaded for @' + profileData.username + ': ' + pts.length + ' points');
            }
          }
        } catch (e) {
          log('OF Stats: Could not fetch fans trend:', e);
        }
      }
      
      displayProfileData(profileData);
      _lastBadgeProfileData = profileData;
    });
    
    // ==================== MODEL SCORE CALCULATOR ====================
    function calculateModelScore(profileData) {
      const result = {
        score: 0, grade: '', gradeIcon: '', gradeColor: '',
        components: {}, flags: [], verdict: ''
      };

      // === Account age in months ===
      let accountMonths = 0;
      if (profileData.joinDate) {
        const join = new Date(profileData.joinDate);
        const now = new Date();
        accountMonths = (now.getFullYear() - join.getFullYear()) * 12 + (now.getMonth() - join.getMonth());
      }

      // === Key metrics ===
      const fans = profileData.subscribersCount || 0;
      const fansVisible = profileData.showSubscribersCount !== false;
      const likes = profileData.favoritedCount || 0;
      const posts = profileData.postsCount || 0;
      const videos = profileData.videosCount || 0;
      const streams = profileData.finishedStreamsCount || 0;
      const verified = profileData.isVerified || false;
      const websiteUrl = (profileData.website || '').toLowerCase();
      const aboutText = (profileData.about || '').toLowerCase();
      // Detect social media from: 1) DOM-detected links, 2) website URL, 3) about text
      var detectedSocials = profileData._detectedSocials || [];
      var socialMediaType = null;
      var allDetectedSocials = [];
      // Priority 1: DOM-detected social links (most reliable)
      if (detectedSocials.length > 0) {
        socialMediaType = detectedSocials[0];
        allDetectedSocials = detectedSocials.slice();
      }
      // Priority 2: website URL field
      if (!socialMediaType && websiteUrl) {
        if (websiteUrl.indexOf('instagram.com') !== -1 || websiteUrl.indexOf('instagr.am') !== -1) socialMediaType = 'instagram';
        else if (websiteUrl.indexOf('tiktok.com') !== -1) socialMediaType = 'tiktok';
        else if (websiteUrl.indexOf('twitter.com') !== -1 || websiteUrl.indexOf('x.com') !== -1) socialMediaType = 'twitter';
        else if (websiteUrl.indexOf('reddit.com') !== -1) socialMediaType = 'reddit';
        else if (websiteUrl.indexOf('youtube.com') !== -1 || websiteUrl.indexOf('youtu.be') !== -1) socialMediaType = 'youtube';
        if (socialMediaType && allDetectedSocials.indexOf(socialMediaType) === -1) allDetectedSocials.push(socialMediaType);
      }
      // Priority 3 removed: about/bio text mentions are unreliable (word "instagram" in bio ≠ linked account)
      var hasSocialMedia = !!socialMediaType;
      var hasWebsite = !!websiteUrl && !hasSocialMedia;
      const hasAvatar = !!profileData.avatar;
      const hasHeader = !!profileData.header;
      const hasEmptyProfileLook = !hasAvatar && !hasHeader;
      const commentsOpen = profileData._farmedStatus === 'ready';
      const commentsClosed = profileData._farmedStatus === 'none';
      const lastKnownFans = profileData._lastKnownFans ? (profileData._lastKnownFans.count || 0) : 0;
      const effectiveFans = fansVisible ? fans : lastKnownFans;

      // Paid account detection (needed early for anomaly thresholds)
      const subscribePrice = profileData.subscribePrice || 0;
      const isPaidAccount = subscribePrice > 0;

      // === DERIVED METRICS ===
      const postsPerMonth = accountMonths > 0 ? posts / accountMonths : 0;
      const likesPerPost = posts > 0 ? likes / posts : 0;
      const likesPerMonth = accountMonths > 0 ? likes / accountMonths : 0;
      const fansPerMonth = accountMonths > 0 ? effectiveFans / accountMonths : 0;

      // Last seen hours ago
      let hoursSinceOnline = 9999;
      if (profileData.lastSeen) {
        hoursSinceOnline = (Date.now() - new Date(profileData.lastSeen).getTime()) / 3600000;
      }

      // === ANOMALY DETECTION FLAGS (used across components) ===
      // Abandoned: very few posts for account age, or long time offline
      const isAbandoned = accountMonths > 6 && postsPerMonth < 0.5 && posts < 20;
      // Botted likes: absurdly high likes per post with very few posts
      const isBottedLikes = (likesPerPost > 2000 && posts < 30) || (likesPerPost > 500 && posts < 10) || (likes > 10000 && posts < 5);
      // Inflated likes: suspicious ratio — multiple detection methods
      // Method 1: High likes/post with moderate post count
      const inflatedByRatio = !isBottedLikes && likesPerPost > 200 && posts >= 10 && (
        posts < 50 || // few posts with high ratio
        (posts < 100 && likesPerPost > 400) || // moderate posts but extreme ratio
        (likesPerPost > 300 && accountMonths <= 6) // any post count but new account + high ratio
      );
      // Method 2: Temporal anomaly — too many likes too fast for account age
      const inflatedByTempo = !isBottedLikes && accountMonths > 0 && likes > 10000 && (
        (accountMonths <= 6 && likesPerMonth > 5000) || // very young + fast
        (accountMonths <= 12 && likesPerMonth > 8000) // up to 1 year, extreme tempo
      );
      // Method 3: Fan-relative anomaly — likes way too high relative to fan count
      // Normal engagement: 2-5 total likes per fan over account lifetime
      // Free accounts: fans come/go, most don't engage heavily, 2-4 expected
      // If 8.7K fans produced 70K likes = 8x per fan = unrealistic organic engagement
      const likesPerFan = effectiveFans > 0 ? likes / effectiveFans : 0;
      // Paid accounts: paying fans are more loyal and like more, plus fans churn over time
      // but likes remain — so ratio naturally grows with account age
      var fanRatioThresholds;
      if (isPaidAccount) {
        // Paid: much higher thresholds — 30x per fan is normal for 4+ year paid account
        fanRatioThresholds = {
          young6: 15,   // <=6 months
          mid12: 20,    // <=12 months
          mid24: 30,    // <=24 months
          old: 50       // any age
        };
      } else {
        fanRatioThresholds = {
          young6: 5,
          mid12: 6,
          mid24: 7,
          old: 7
        };
      }
      const inflatedByFanRatio = !isBottedLikes && effectiveFans > 0 && effectiveFans < 50000 && (
        (likesPerFan > fanRatioThresholds.young6 && accountMonths <= 6) ||
        (likesPerFan > fanRatioThresholds.mid12 && accountMonths <= 12) ||
        (likesPerFan > fanRatioThresholds.mid24 && accountMonths <= 24) ||
        (likesPerFan > fanRatioThresholds.old)
      );
      const isInflatedLikes = inflatedByRatio || inflatedByTempo || inflatedByFanRatio;
      // Low content: very few posts for a mature account
      const isLowContent = accountMonths > 6 && posts < 10;
      // Slow fan growth: old account with very few fans
      // For paid accounts, slower growth is expected — lower threshold
      const slowGrowthThreshold = isPaidAccount ? 3 : 50;
      const isSlowGrowth = accountMonths > 24 && effectiveFans > 0 && fansPerMonth < slowGrowthThreshold;

      // Revenue-weighted fans: paid fans are worth more for scoring
      // $25/mo × 2300 fans = $57.5K/mo → these fans are premium
      const revenueMultiplier = isPaidAccount ? Math.min(1 + subscribePrice / 10, 5) : 1;
      const weightedFans = Math.round(effectiveFans * revenueMultiplier);

      // === A. MATURITY (0-25) ===
      let maturity = 0;
      if (accountMonths <= 1) maturity = 2;
      else if (accountMonths <= 3) maturity = 5;
      else if (accountMonths <= 6) maturity = 10;
      else if (accountMonths <= 12) maturity = 15;
      else if (accountMonths <= 24) maturity = 20;
      else maturity = 25;
      // Maturity penalty: old account with near-zero content is NOT a positive
      if (accountMonths > 12 && posts < 5) {
        maturity = Math.min(maturity, 10); // Old + empty = not a real benefit
      } else if (accountMonths > 24 && postsPerMonth < 1) {
        maturity = Math.min(maturity, 15); // Old but barely used
      }
      result.components.maturity = maturity;

      // === B. POPULARITY (0-25) ===
      let popularity = 0;
      // For paid accounts, use revenue-weighted fans for scoring
      const popFans = isPaidAccount ? weightedFans : fans;
      if (fansVisible && fans > 0) {
        if (popFans < 100) popularity = 3;
        else if (popFans < 500) popularity = 7;
        else if (popFans < 1000) popularity = 10;
        else if (popFans < 5000) popularity = 15;
        else if (popFans < 10000) popularity = 18;
        else if (popFans < 50000) popularity = 22;
        else popularity = 25;
      } else if (!fansVisible) {
        if (lastKnownFans > 0) {
          if (lastKnownFans < 500) popularity = 5;
          else if (lastKnownFans < 5000) popularity = 10;
          else if (lastKnownFans < 20000) popularity = 14;
          else popularity = 17;
        } else {
          // No fan data at all — estimate from likes and content volume
          // 836K likes with 8K posts clearly indicates a massive audience
          if (likes >= 500000 && posts >= 1000) popularity = 18;
          else if (likes >= 100000 && posts >= 500) popularity = 15;
          else if (likes >= 50000 && posts >= 200) popularity = 12;
          else if (likes >= 10000) popularity = 10;
          else popularity = 8;
        }
      }
      // Penalty: slow fan growth for old accounts
      if (isSlowGrowth) {
        popularity = Math.max(0, popularity - 4);
      }
      // Penalty: fans but almost no content → fans may be from external promo, not OF activity
      if (effectiveFans > 1000 && posts < 10 && accountMonths > 6) {
        popularity = Math.max(0, popularity - 3);
      }
      result.components.popularity = popularity;

      // === C. ORGANICITY (0-25) ===
      let organicity = 0;

      // FIRST: check for botted likes anomaly (overrides normal calculation)
      if (isBottedLikes) {
        // Likes are almost certainly fake — organicity near zero
        organicity = 2;
      } else {
        // Normal organicity calculation
        // Likes/month (reasonable: 200-5000/month for active accounts)
        if (likesPerMonth > 0) {
          if (likesPerMonth < 50) organicity += 3;
          else if (likesPerMonth < 200) organicity += 5;
          else if (likesPerMonth < 1000) organicity += 8;
          else if (likesPerMonth < 5000) organicity += 10;
          else if (likesPerMonth < 15000) organicity += 8;
          else organicity += 4;
        }

        // Likes/post ratio — normalized by fan count for popular accounts
        if (likesPerPost > 0 && posts > 0) {
          // For accounts with many fans, high likes/post is expected
          var engagePerFan = effectiveFans > 0 ? likesPerPost / effectiveFans : 0;
          if (effectiveFans >= 50000) {
            // Popular accounts: judge by engagement rate (likes per post / fans)
            // 0.1-3% engagement per post is healthy for large accounts
            if (engagePerFan < 0.001) organicity += 3; // <0.1% - low engagement
            else if (engagePerFan < 0.005) organicity += 6; // 0.1-0.5%
            else if (engagePerFan < 0.02) organicity += 8; // 0.5-2% - ideal
            else if (engagePerFan < 0.05) organicity += 7; // 2-5%
            else organicity += 5; // >5% - unusually high but not penalized
          } else {
            // Smaller accounts: absolute likes/post thresholds
            if (likesPerPost < 2) organicity += 2;
            else if (likesPerPost < 10) organicity += 5;
            else if (likesPerPost < 50) organicity += 8;
            else if (likesPerPost < 200) organicity += 7;
            else if (likesPerPost < 500) organicity += 5;
            else if (likesPerPost < 1000) organicity += 3;
            else organicity += 1;
          }
        }

        // Fans-to-likes balance
        if (effectiveFans > 0 && likes > 0) {
          const ratio = likes / effectiveFans;
          if (isPaidAccount) {
            // Paid accounts: high engagement from paying fans is expected and positive
            // ratio >5 is normal (loyal paying fans like a lot)
            if (ratio > 1 && ratio < 200) organicity += 7;
            else if (ratio >= 0.3 && ratio <= 500) organicity += 5;
            else organicity += 2;
          } else {
            if (ratio > 0.3 && ratio < 20) organicity += 7;
            else if (ratio >= 0.1 && ratio <= 50) organicity += 4;
            else organicity += 1;
          }
        } else if (likes > 0) {
          organicity += 3;
        }

        // Cross-validation: HIGH likes/post with LOW total posts = anomaly
        if (likesPerPost > 500 && posts < 30) {
          organicity = Math.max(0, organicity - 8);
        } else if (likesPerPost > 200 && posts < 15) {
          organicity = Math.max(0, organicity - 5);
        }

        // Inflated likes penalty: suspicious ratio reduces organicity
        if (isInflatedLikes) {
          // Fan-ratio inflation: graduated penalty based on severity
          if (inflatedByFanRatio) {
            if (likesPerFan > 15) organicity = Math.max(0, organicity - 10);
            else if (likesPerFan > 10) organicity = Math.max(0, organicity - 7);
            else organicity = Math.max(0, organicity - 4); // borderline: mild penalty
          } else if (likesPerPost > 400) {
            organicity = Math.max(0, organicity - 8);
          } else if (likesPerPost > 300) {
            organicity = Math.max(0, organicity - 6);
          } else {
            organicity = Math.max(0, organicity - 4);
          }
        }
      }

      // Low content penalty: few posts means engagement data is unreliable
      if (posts < 5 && accountMonths > 3) {
        organicity = Math.min(organicity, 5);
      } else if (posts < 15 && accountMonths > 6) {
        organicity = Math.min(organicity, 12);
      }

      organicity = Math.min(organicity, 25);
      result.components.organicity = organicity;

      // === D. ACTIVITY (0-15) ===
      let activity = 0;

      // Posts per month
      // For veteran models (2+ years) with lots of streams, high post rate is normal, not bulk farming
      var isVeteranActive = accountMonths >= 24 && streams >= 30;
      if (postsPerMonth > 0) {
        if (postsPerMonth < 0.5) activity += 0;
        else if (postsPerMonth < 1) activity += 1;
        else if (postsPerMonth < 3) activity += 2;
        else if (postsPerMonth < 10) activity += 4;
        else if (postsPerMonth <= 50) activity += 6;
        else if (postsPerMonth <= 100) activity += 5;
        else if (postsPerMonth <= 200 && isVeteranActive) activity += 5; // Veteran active model — high rate is natural
        else activity += 3; // Bulk posting
      }

      // Online status
      if (hoursSinceOnline < 1) activity += 3;
      else if (hoursSinceOnline < 6) activity += 2;
      else if (hoursSinceOnline < 24) activity += 2;
      else if (hoursSinceOnline < 72) activity += 1;
      else if (hoursSinceOnline < 168) activity += 0;
      if (hoursSinceOnline > 168 && accountMonths > 6 && posts > 10) {
        activity = Math.max(0, activity - 1);
      }

      // Streams & videos — scale bonus for extremely active streamers
      if (streams >= 500) activity += 4;
      else if (streams >= 100) activity += 3;
      else if (streams >= 5) activity += 3;
      else if (streams > 0) activity += 2;
      if (videos > 10) activity += 2;
      else if (videos > 0) activity += 1;

      // Abandoned penalty: if almost no posting over long period
      if (isAbandoned) {
        activity = Math.min(activity, 2);
      }

      activity = Math.min(activity, 15);
      result.components.activity = activity;

      // === E. TRANSPARENCY (0-10) ===
      let transparency = 0;
      // Ultra-active model indicator: diamond-level content suggests large real audience
      var isUltraActive = (streams >= 500 || posts >= 3000) && accountMonths >= 24;
      if (commentsOpen) transparency += 4;
      else if (commentsClosed) {
        // High-fan accounts often close comments to fight spam — reduced penalty
        // Ultra-active models with diamond achievements close comments due to spam volume
        if (effectiveFans >= 100000 || isUltraActive) transparency -= 0;
        else if (effectiveFans >= 50000 || isPaidAccount) transparency -= 1;
        else transparency -= 2;
      }
      if (fansVisible) transparency += 3;
      else if (isUltraActive) transparency += 1; // Ultra-active models hiding fans is less concerning
      if (verified) transparency += 3;
      // Empty profile look: no avatar AND no header — farm account indicator
      if (hasEmptyProfileLook) transparency -= 3;
      else if (!hasAvatar) transparency -= 2;
      else if (!hasHeader) transparency -= 1;
      // Ultra-active models get trust bonus — massive content proves real engagement
      if (isUltraActive) transparency += 2;
      // Social media link — confirms real person with external presence
      if (hasSocialMedia) transparency += 2;
      else if (hasWebsite) transparency += 1;
      transparency = Math.max(0, Math.min(transparency, 10));
      result.components.transparency = transparency;

      // === TOTAL SCORE ===
      result.score = maturity + popularity + organicity + activity + transparency;

      // === GLOBAL PENALTIES (cross-component anomalies) ===
      // Abandoned account: moderate global penalty (component penalties already applied)
      if (isAbandoned) {
        result.score -= 5;
      }
      // Botted/farmed likes: moderate global penalty
      if (isBottedLikes) {
        result.score -= 5;
      }
      // Inflated likes: global penalty for suspicious like ratios
      if (isInflatedLikes) {
        result.score -= 5;
      }
      // Low content on mature account (only if not already penalized as abandoned)
      if (isLowContent && !isAbandoned) {
        result.score -= 3;
      }
      // No avatar AND no header — strong farm/shell account indicator
      if (hasEmptyProfileLook) {
        result.score -= 7;
      } else if (!hasAvatar) {
        result.score -= 5;
      }

      result.score = Math.max(0, Math.min(100, result.score));

      // === GRADE (SVG icons) ===
      const gradeIcons = {
        top: '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" fill="#ffd700" stroke="#ffd700" stroke-width="1"/></svg>',
        good: '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M22 11.08V12C21.9988 14.1564 21.3005 16.2547 20.0093 17.9818C18.7182 19.709 16.9033 20.9725 14.8354 21.5839C12.7674 22.1953 10.5573 22.1219 8.53447 21.3746C6.51168 20.6273 4.78465 19.2461 3.61096 17.4371C2.43727 15.628 1.87979 13.4881 2.02168 11.3363C2.16356 9.18457 2.99721 7.13633 4.39828 5.49707C5.79935 3.85782 7.69279 2.71538 9.79619 2.24015C11.8996 1.76491 14.1003 1.98234 16.07 2.86" stroke="#10b981" stroke-width="2" stroke-linecap="round" fill="none"/><polyline points="22,4 12,14.01 9,11.01" stroke="#10b981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>',
        average: '<svg viewBox="0 0 24 24" width="18" height="18"><circle cx="12" cy="12" r="10" stroke="#f59e0b" stroke-width="2" fill="none"/><line x1="8" y1="15" x2="16" y2="15" stroke="#f59e0b" stroke-width="2" stroke-linecap="round"/><circle cx="9" cy="9" r="1.5" fill="#f59e0b"/><circle cx="15" cy="9" r="1.5" fill="#f59e0b"/></svg>',
        suspicious: '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M10.29 3.86L1.82 18C1.64 18.3 1.55 18.65 1.55 19C1.56 19.35 1.65 19.7 1.82 20C2 20.3 2.25 20.56 2.54 20.73C2.84 20.91 3.18 21 3.54 21H20.46C20.82 21 21.16 20.91 21.46 20.73C21.75 20.56 22 20.3 22.18 20C22.35 19.7 22.44 19.35 22.45 19C22.45 18.65 22.36 18.3 22.18 18L13.71 3.86C13.53 3.56 13.28 3.32 12.98 3.15C12.68 2.98 12.34 2.89 12 2.89C11.66 2.89 11.32 2.98 11.02 3.15C10.72 3.32 10.47 3.56 10.29 3.86Z" stroke="#ef4444" stroke-width="2" fill="none"/><line x1="12" y1="9" x2="12" y2="13" stroke="#ef4444" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="17" r="1" fill="#ef4444"/></svg>',
        fake: '<svg viewBox="0 0 24 24" width="18" height="18"><circle cx="12" cy="12" r="10" stroke="#dc2626" stroke-width="2" fill="none"/><line x1="15" y1="9" x2="9" y2="15" stroke="#dc2626" stroke-width="2" stroke-linecap="round"/><line x1="9" y1="9" x2="15" y2="15" stroke="#dc2626" stroke-width="2" stroke-linecap="round"/></svg>'
      };
      if (result.score >= 80) {
        result.grade = 'TOP'; result.gradeIcon = gradeIcons.top; result.gradeColor = '#ffd700';
      } else if (result.score >= 60) {
        result.grade = 'Good'; result.gradeIcon = gradeIcons.good; result.gradeColor = '#10b981';
      } else if (result.score >= 40) {
        result.grade = 'Average'; result.gradeIcon = gradeIcons.average; result.gradeColor = '#f59e0b';
      } else if (result.score >= 20) {
        result.grade = 'Suspicious'; result.gradeIcon = gradeIcons.suspicious; result.gradeColor = '#ef4444';
      } else {
        result.grade = 'Likely Fake'; result.gradeIcon = gradeIcons.fake; result.gradeColor = '#dc2626';
      }

      // === Achievement SVG icons ===
      const achIcons = {
        warning: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>',
        fire: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2c0 0-5.5 5-5.5 11a5.5 5.5 0 0 0 11 0C17.5 7 12 2 12 2z"></path><path d="M12 18a2 2 0 0 1-2-2c0-2 2-4 2-4s2 2 2 4a2 2 0 0 1-2 2z"></path></svg>',
        shield: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path><polyline points="9 12 11 14 15 10"></polyline></svg>',
        lock: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>',
        ghost: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 10h.01M15 10h.01M12 2a8 8 0 0 0-8 8v12l3-3 2 2 3-3 3 3 2-2 3 3V10a8 8 0 0 0-8-8z"></path></svg>',
        bolt: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>',
        globe: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>',
        check: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>',
        camera: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg>',
        video: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"></polygon><rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect></svg>',
        star: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>',
        heart: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>',
        crown: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 20h20L19 8l-5 6-2-8-2 8-5-6-3 12z"></path><rect x="2" y="20" width="20" height="2" rx="1"></rect></svg>',
        clock: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>',
        eye: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>',
        gift: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 12 20 22 4 22 4 12"></polyline><rect x="2" y="7" width="20" height="5"></rect><line x1="12" y1="22" x2="12" y2="7"></line><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"></path><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"></path></svg>',
        skull: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="10" r="8"></circle><circle cx="9" cy="9" r="1.5" fill="currentColor"></circle><circle cx="15" cy="9" r="1.5" fill="currentColor"></circle><path d="M8 18v-2M12 18v-2M16 18v-2"></path></svg>',
        snail: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="13" cy="10" r="6"></circle><path d="M7 16c-3 0-5 1.5-5 3h20c0-1.5-2-3-5-3"></path><circle cx="13" cy="10" r="2.5"></circle></svg>',
        robot: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="7" width="16" height="13" rx="3"></rect><circle cx="9" cy="13" r="1.5" fill="currentColor"></circle><circle cx="15" cy="13" r="1.5" fill="currentColor"></circle><line x1="12" y1="3" x2="12" y2="7"></line><circle cx="12" cy="2" r="1.5" fill="currentColor"></circle></svg>',
        mic: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>',
        trophy: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9H4a2 2 0 0 1-2-2V4h4"></path><path d="M18 9h2a2 2 0 0 0 2-2V4h-4"></path><path d="M4 4h16v5a6 6 0 0 1-6 6h-4a6 6 0 0 1-6-6V4z"></path><path d="M9 15v2a3 3 0 0 0 6 0v-2"></path><line x1="8" y1="20" x2="16" y2="20"></line></svg>',
        diamond: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h12l4 6-10 13L2 9z"></path><path d="M2 9h20"></path><path d="M10 3l-2 6 4 13 4-13-2-6"></path></svg>',
        trending: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"></polyline><polyline points="17 6 23 6 23 12"></polyline></svg>',
        dollar: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"></line><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path></svg>'
      };

      // === CRITICAL RED FLAGS ===
      // Abandoned/Inactive account
      if (isAbandoned) {
        result.flags.push({ text: tLabel('Abandoned'), color: '#ef4444', icon: 'skull', tooltip: t('flagAbandoned') + posts + t('flagPostsFor') + accountMonths + t('flagMonths') + ' (' + postsPerMonth.toFixed(1) + t('flagPostsPerMonth') });
      }
      // Botted/Farmed likes
      if (isBottedLikes) {
        result.flags.push({ text: tLabel('Botted Likes'), color: '#ef4444', icon: 'robot', tooltip: t('flagBottedLikes') + Math.round(likesPerPost).toLocaleString() + t('flagLikesPerPost') + posts + t('flagPosts') });
      }
      // Low content
      if (isLowContent && !isAbandoned) {
        result.flags.push({ text: tLabel('Low Content'), color: '#f97316', icon: 'camera', tooltip: t('flagLowContent') + posts + t('flagPostsFor') + accountMonths + t('flagMonths') });
      }
      // Slow fan growth
      if (isSlowGrowth) {
        result.flags.push({ text: tLabel('Slow Growth'), color: '#f97316', icon: 'snail', tooltip: t('flagSlowGrowth') + Math.round(fansPerMonth) + t('flagFansPerMonth') + accountMonths + t('flagMonths') });
      }
      // Boosted likes — young account with extreme like volume
      if (!isBottedLikes && !isInflatedLikes && likes > 100000 && accountMonths < 3) {
        result.flags.push({ text: tLabel('Boosted Likes'), color: '#ef4444', icon: 'fire', tooltip: t('flagBoostedLikes') });
      }
      if (effectiveFans > 50000 && likes < 1000) {
        result.flags.push({ text: tLabel('Bought Fans'), color: '#ef4444', icon: 'warning', tooltip: t('flagBoughtFans') });
      }
      // Fan growth rate analysis — detect fake/suspect fan acquisition
      if (effectiveFans > 0 && accountMonths >= 2) {
        // For veteran models (4+ years) with massive audience, viral growth is plausible — skip
        var isVeteranLargeAudience = accountMonths >= 48 && effectiveFans >= 100000;
        if (!isVeteranLargeAudience) {
          if (fansPerMonth > 5000) {
            result.flags.push({ text: tLabel('Fake Fans'), color: '#ef4444', icon: 'robot', tooltip: t('flagFakeFans') + Math.round(fansPerMonth).toLocaleString() + t('flagFakeFansSuffix') });
          } else if (fansPerMonth > 3000) {
            result.flags.push({ text: tLabel('Suspect Growth'), color: '#f97316', icon: 'warning', tooltip: t('flagSuspectGrowth') + Math.round(fansPerMonth).toLocaleString() + t('flagSuspectGrowthSuffix') });
          }
        }
      }
      if (!fansVisible && commentsClosed && !isUltraActive) {
        result.flags.push({ text: tLabel('Low Trust'), color: '#f97316', icon: 'lock', tooltip: t('flagLowTrust') });
      }
      if (posts === 0 && effectiveFans > 100) {
        result.flags.push({ text: tLabel('Empty Profile'), color: '#ef4444', icon: 'ghost', tooltip: t('flagEmptyProfile') });
      }
      // No avatar AND no header — likely farm/shell account
      if (hasEmptyProfileLook) {
        result.flags.push({ text: tLabel('No Profile Image'), color: '#f97316', icon: 'camera', tooltip: t('flagNoProfileImage') });
      } else if (!hasAvatar) {
        result.flags.push({ text: tLabel('No Avatar'), color: '#f97316', icon: 'camera', tooltip: t('flagNoAvatar') });
      }
      if (postsPerMonth > 100 && accountMonths > 1 && !isVeteranActive) {
        result.flags.push({ text: tLabel('Bulk Posting'), color: '#f97316', icon: 'bolt', tooltip: t('flagBulkPosting') });
      }
      if (accountMonths < 3 && accountMonths > 0) {
        result.flags.push({ text: tLabel('Newcomer'), color: '#f59e0b', icon: 'clock', tooltip: t('flagNewcomer') });
      }
      // Suspicious likes — inflated by any detection method
      if (isInflatedLikes) {
        var inflReason = '';
        if (inflatedByTempo) inflReason = Math.round(likesPerMonth).toLocaleString() + t('flagInflatedByTempo') + accountMonths + ' ' + t('monthShort');
        else if (inflatedByFanRatio) inflReason = Math.round(likesPerFan) + t('flagInflatedByFanRatio') + effectiveFans + t('flagInflatedByFanRatioSuffix');
        else inflReason = Math.round(likesPerPost) + t('flagInflatedByPostRatio') + posts + t('flagPosts');
        result.flags.push({ text: tLabel('Inflated Likes'), color: '#f97316', icon: 'fire', tooltip: t('flagInflatedLikes') + inflReason });
      }

      // === POSITIVE SIGNALS ===
      if (verified) {
        result.flags.push({ text: tLabel('Verified'), color: '#00b4ff', icon: 'check', tooltip: t('flagVerified') });
      }
      if (hasSocialMedia) {
        var socialNames = { instagram: 'Instagram', tiktok: 'TikTok', twitter: 'Twitter / X', reddit: 'Reddit', youtube: 'YouTube', snapchat: 'Snapchat', twitch: 'Twitch' };
        var socialColors = { instagram: '#E1306C', tiktok: '#00f2ea', twitter: '#1DA1F2', reddit: '#FF4500', youtube: '#FF0000', snapchat: '#FFFC00', twitch: '#9146FF' };
        // Show badge for each detected social network
        var shownSocials = {};
        allDetectedSocials.forEach(function(soc) {
          if (!shownSocials[soc]) {
            shownSocials[soc] = true;
            result.flags.push({ text: socialNames[soc] || soc, color: socialColors[soc] || '#10b981', icon: 'globe', tooltip: t('flagSocial') + (socialNames[soc] || soc) + t('flagSocialSuffix') });
          }
        });
      } else if (hasWebsite) {
        result.flags.push({ text: tLabel('Website'), color: '#10b981', icon: 'globe', tooltip: t('flagWebsite') });
      }
      if (streams >= 1000) {
        result.flags.push({ text: tLabel('Stream Legend'), color: '#b9f2ff', icon: 'diamond', tooltip: t('flagStreamLegend') + ' (' + streams + ')' });
      } else if (streams >= 500) {
        result.flags.push({ text: tLabel('Stream Platinum'), color: '#e5e4e2', icon: 'trophy', tooltip: t('flagStreamPlatinum') + ' (' + streams + ')' });
      } else if (streams >= 100) {
        result.flags.push({ text: tLabel('Stream Master'), color: '#ffd700', icon: 'mic', tooltip: t('flagStreamMaster') + ' (' + streams + ')' });
      } else if (streams >= 30) {
        result.flags.push({ text: tLabel('Top Streamer'), color: '#9b59b6', icon: 'star', tooltip: t('flagTopStreamer') + ' (' + streams + ')' });
      } else if (streams >= 10) {
        result.flags.push({ text: tLabel('Active Streamer'), color: '#9b59b6', icon: 'video', tooltip: t('flagActiveStreamer') + ' (' + streams + ')' });
      } else if (streams >= 3) {
        result.flags.push({ text: tLabel('Streamer'), color: '#9b59b6', icon: 'video', tooltip: t('flagStreamer') });
      }
      // OG Creator only if NOT abandoned (old abandoned account shouldn't get a crown)
      if (accountMonths >= 72 && !isAbandoned) {
        result.flags.push({ text: tLabel('Diamond OG'), color: '#b9f2ff', icon: 'diamond', tooltip: t('flagDiamondOG') });
      } else if (accountMonths >= 48 && !isAbandoned) {
        result.flags.push({ text: tLabel('Platinum OG'), color: '#e5e4e2', icon: 'crown', tooltip: t('flagPlatinumOG') });
      } else if (accountMonths >= 36 && !isAbandoned) {
        result.flags.push({ text: tLabel('OG Creator'), color: '#ffd700', icon: 'crown', tooltip: t('flagOGCreator') });
      } else if (accountMonths >= 24 && !isAbandoned) {
        result.flags.push({ text: tLabel('Veteran'), color: '#10b981', icon: 'shield', tooltip: t('flagVeteran') });
      }
      // === Fan milestone badges ===
      if (effectiveFans >= 500000) {
        result.flags.push({ text: tLabel('Legend'), color: '#b9f2ff', icon: 'diamond', tooltip: t('flagLegend') });
      } else if (effectiveFans >= 100000) {
        result.flags.push({ text: tLabel('Icon'), color: '#ffd700', icon: 'crown', tooltip: t('flagIcon') });
      } else if (effectiveFans >= 50000) {
        result.flags.push({ text: tLabel('Superstar'), color: '#ff6b9d', icon: 'crown', tooltip: t('flagSuperstar') });
      } else if (effectiveFans >= 25000) {
        result.flags.push({ text: tLabel('Star Power'), color: '#ff6b9d', icon: 'heart', tooltip: t('flagStarPower') });
      } else if (effectiveFans >= 10000) {
        result.flags.push({ text: tLabel('Fan Favorite'), color: '#f1c40f', icon: 'star', tooltip: t('flagFanFavorite') });
      } else if (effectiveFans >= 5000) {
        result.flags.push({ text: tLabel('Trending'), color: '#10b981', icon: 'trending', tooltip: t('flagTrending') });
      } else if (effectiveFans >= 1000) {
        result.flags.push({ text: tLabel('Rising Star'), color: '#10b981', icon: 'trending', tooltip: t('flagRisingStar') });
      }
      // === Organic Growth achievement ===
      if (effectiveFans > 0 && accountMonths >= 3 && fansPerMonth >= 100 && fansPerMonth <= 3000 && !isBottedLikes) {
        result.flags.push({ text: tLabel('Organic Growth'), color: '#10b981', icon: 'shield', tooltip: t('flagOrganicGrowth') + Math.round(fansPerMonth) + t('flagFansPerMonth') + accountMonths + ' ' + t('monthShort') + t('flagOrganicGrowthSuffix') });
      }
      if (videos >= 1000) {
        result.flags.push({ text: tLabel('Video Diamond'), color: '#b9f2ff', icon: 'diamond', tooltip: t('flagVideoDiamond') + ' (' + videos + ')' });
      } else if (videos >= 500) {
        result.flags.push({ text: tLabel('Video Platinum'), color: '#e5e4e2', icon: 'trophy', tooltip: t('flagVideoPlatinum') + ' (' + videos + ')' });
      } else if (videos >= 100) {
        result.flags.push({ text: tLabel('Video Master'), color: '#ffd700', icon: 'video', tooltip: t('flagVideoMaster') + ' (' + videos + ')' });
      } else if (videos >= 30) {
        result.flags.push({ text: tLabel('Video Creator'), color: '#00b4ff', icon: 'video', tooltip: t('flagVideoCreator') });
      }
      if (posts >= 3000) {
        result.flags.push({ text: tLabel('Content Diamond'), color: '#b9f2ff', icon: 'diamond', tooltip: t('flagContentDiamond') + ' (' + posts + ')' });
      } else if (posts >= 1000) {
        result.flags.push({ text: tLabel('Content Platinum'), color: '#e5e4e2', icon: 'trophy', tooltip: t('flagContentPlatinum') + ' (' + posts + ')' });
      } else if (posts >= 500) {
        result.flags.push({ text: tLabel('Content Pro'), color: '#ffd700', icon: 'bolt', tooltip: t('flagContentPro') + ' (' + posts + ')' });
      } else if (posts >= 300) {
        result.flags.push({ text: tLabel('Content Rich'), color: '#10b981', icon: 'camera', tooltip: t('flagContentRich') });
      } else if (posts >= 100) {
        result.flags.push({ text: tLabel('Content Maker'), color: '#10b981', icon: 'camera', tooltip: t('flagContentMaker') });
      }
      // Likes tiers — only if NOT botted and NOT inflated
      if (likes >= 1000000 && !isBottedLikes && !isInflatedLikes) {
        result.flags.push({ text: tLabel('Likes Legend'), color: '#b9f2ff', icon: 'diamond', tooltip: t('flagLikesLegend') });
      } else if (likes >= 500000 && !isBottedLikes && !isInflatedLikes) {
        result.flags.push({ text: tLabel('Diamond Likes'), color: '#b9f2ff', icon: 'diamond', tooltip: t('flagDiamondLikes') });
      } else if (likes >= 250000 && !isBottedLikes && !isInflatedLikes) {
        result.flags.push({ text: tLabel('Platinum Likes'), color: '#e5e4e2', icon: 'trophy', tooltip: t('flagPlatinumLikes') });
      } else if (likes >= 100000 && !isBottedLikes && !isInflatedLikes) {
        result.flags.push({ text: tLabel('Mega Liked'), color: '#ffd700', icon: 'trophy', tooltip: t('flagMegaLiked') });
      } else if (likes >= 50000 && !isBottedLikes && !isInflatedLikes) {
        result.flags.push({ text: tLabel('Super Liked'), color: '#ffd700', icon: 'star', tooltip: t('flagSuperLiked') });
      } else if (likes >= 25000 && !isBottedLikes && !isInflatedLikes) {
        result.flags.push({ text: tLabel('Well Liked'), color: '#f1c40f', icon: 'heart', tooltip: t('flagWellLiked') });
      } else if (likes >= 10000 && !isBottedLikes && !isInflatedLikes) {
        result.flags.push({ text: tLabel('Liked'), color: '#10b981', icon: 'heart', tooltip: t('flagLiked') });
      } else if (likes >= 5000 && !isBottedLikes && !isInflatedLikes) {
        result.flags.push({ text: tLabel('Rising Likes'), color: '#10b981', icon: 'heart', tooltip: t('flagRisingLikes') });
      }
      if (fansVisible && commentsOpen) {
        result.flags.push({ text: tLabel('Open Book'), color: '#10b981', icon: 'eye', tooltip: t('flagOpenBook') });
      }
      if (profileData.subscribePrice === 0) {
        result.flags.push({ text: tLabel('Free Access'), color: '#10b981', icon: 'gift', tooltip: t('flagFreeAccess') });
      } else if (profileData.subscribePrice >= 30) {
        result.flags.push({ text: tLabel('Premium'), color: '#e74c3c', icon: 'dollar', tooltip: '$' + profileData.subscribePrice + t('flagPremium') });
      }
      // High engagement rate (likes/fans ratio)
      if (effectiveFans > 0 && !isBottedLikes) {
        var engagementRate = likes / effectiveFans;
        if (engagementRate >= 10 && posts >= 50) {
          result.flags.push({ text: tLabel('High Engage'), color: '#10b981', icon: 'trending', tooltip: t('flagHighEngage') + engagementRate.toFixed(1) + t('flagHighEngageSuffix') });
        }
      }
      // Active & engaged (opposite of abandoned)
      if (postsPerMonth >= 10 && hoursSinceOnline < 24 && posts >= 50) {
        result.flags.push({ text: tLabel('Active Now'), color: '#10b981', icon: 'bolt', tooltip: t('flagActiveNow') + Math.round(postsPerMonth) + t('flagActiveNowSuffix') });
      }

      // Store achIcons reference for display
      result._achIcons = achIcons;

      return result;
    }

    // Scan DOM for social media links (OF renders them via Vue as .m-tab-social links)
    function scanSocialLinksFromDOM() {
      var socials = [];
      try {
        // OF uses .m-tab-social class for social media link tabs
        var socialLinks = document.querySelectorAll('a.m-tab-social, a[href*="instagram.com"], a[href*="tiktok.com"], a[href*="twitter.com"], a[href*="x.com/"], a[href*="reddit.com"], a[href*="youtube.com"], a[href*="snapchat.com"], a[href*="twitch.tv"]');
        socialLinks.forEach(function(link) {
          var h = (link.href || '').toLowerCase();
          if (h.indexOf('instagram.com') !== -1 || h.indexOf('instagr.am') !== -1) socials.push('instagram');
          else if (h.indexOf('tiktok.com') !== -1) socials.push('tiktok');
          else if (h.indexOf('twitter.com') !== -1 || h.indexOf('x.com/') !== -1) socials.push('twitter');
          else if (h.indexOf('reddit.com') !== -1) socials.push('reddit');
          else if (h.indexOf('youtube.com') !== -1 || h.indexOf('youtu.be') !== -1) socials.push('youtube');
          else if (h.indexOf('snapchat.com') !== -1) socials.push('snapchat');
          else if (h.indexOf('twitch.tv') !== -1) socials.push('twitch');
        });
      } catch (e) {}
      // Deduplicate
      return socials.filter(function(v, i, a) { return a.indexOf(v) === i; });
    }

    // ==================== COMPARISON PANEL (Feature #6) ====================
    function showComparisonInBadge(modelA, modelB, badgeEl, flipInner, flipFront, flipBack, adjustFlipHeight, updateCompareButtonCb) {
      // Inject battle animation styles once
      if (!document.getElementById('of-stats-battle-style')) {
        var sty = document.createElement('style');
        sty.id = 'of-stats-battle-style';
        sty.textContent = [
          '@keyframes ofBattleSlideIn{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}',
          '@keyframes ofBattlePulse{0%,100%{box-shadow:0 0 0 0 rgba(0,180,255,0)}50%{box-shadow:0 0 18px 4px rgba(0,180,255,0.25)}}',
          '@keyframes ofBattleVs{0%{transform:scale(0.4) rotate(-20deg);opacity:0}60%{transform:scale(1.3) rotate(5deg);opacity:1}100%{transform:scale(1) rotate(0deg);opacity:1}}',
          '@keyframes ofBattleGlow{0%,100%{opacity:0.3}50%{opacity:0.8}}',
          '@keyframes ofBattleRowIn{from{opacity:0;transform:translateX(-8px)}to{opacity:1;transform:translateX(0)}}',
          '@keyframes ofBattleWinner{0%{transform:scale(1)}50%{transform:scale(1.06)}100%{transform:scale(1)}}',
          '@keyframes ofBattleRadarDraw{from{stroke-dashoffset:600}to{stroke-dashoffset:0}}',
          '@keyframes ofCrownBounce{0%{transform:scale(0) rotate(-15deg);opacity:0}50%{transform:scale(1.3) rotate(5deg);opacity:1}70%{transform:scale(0.9) rotate(-2deg)}100%{transform:scale(1) rotate(0);opacity:1}}',
          '@keyframes ofCrownFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-3px)}}',
          '@keyframes ofWinnerGlow{0%,100%{box-shadow:0 0 8px rgba(255,215,0,0.3)}50%{box-shadow:0 0 20px rgba(255,215,0,0.6)}}',
          '@keyframes ofScorePop{0%{transform:scale(0);opacity:0}60%{transform:scale(1.15);opacity:1}100%{transform:scale(1)}}',
          '@keyframes ofScoreShine{0%{background-position:200% center}100%{background-position:-200% center}}',
          '.of-battle-avatar{width:42px;height:42px;border-radius:50%;object-fit:cover;border:2px solid transparent;animation:ofBattlePulse 2s ease-in-out infinite}',
          '.of-battle-avatar-winner{animation:ofWinnerGlow 2s ease-in-out infinite!important;border-color:#ffd700!important}',
          '.of-battle-avatar-a{border-color:#00b4ff}',
          '.of-battle-avatar-b{border-color:#7c3aed}',
          '.of-battle-placeholder{width:42px;height:42px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:18px;animation:ofBattlePulse 2s ease-in-out infinite}',
          '.of-battle-placeholder-a{background:rgba(0,180,255,0.15);border:2px solid #00b4ff}',
          '.of-battle-placeholder-b{background:rgba(124,58,237,0.15);border:2px solid #7c3aed}',
          '.of-battle-placeholder-winner{animation:ofWinnerGlow 2s ease-in-out infinite!important;border-color:#ffd700!important}'
        ].join('');
        document.head.appendChild(sty);
      }

      // --- PRE-CALCULATE WINS for crown/verdict ---
      var radarKeys = [['MAT','mat',25],['POP','pop',25],['ORG','org',25],['ACT','act',15],['TRS','trs',10]];
      var metrics = [
        ['Score', 'score', 'num', true],
        ['Fans', 'fans', 'short', true],
        ['Posts', 'posts', 'num', true],
        ['Likes', 'likes', 'short', true],
        ['Engage', 'engagement', 'pct', true],
        ['Organic', 'organicityScore', 'num', true],
        ['Videos', 'videos', 'num', true],
        ['Price', 'price', 'dollar', false],
        ['Streams', 'streams', 'num', true]
      ];
      var winsA = 0, winsB = 0;
      metrics.forEach(function(m) {
        var key = m[1], higherBetter = m[3];
        var vA = modelA[key] || 0, vB = modelB[key] || 0;
        if (vA !== vB) {
          if (higherBetter) { if (vA > vB) winsA++; else winsB++; }
          else {
            if (vA === 0 && vB > 0) winsA++;
            else if (vB === 0 && vA > 0) winsB++;
            else { if (vA < vB) winsA++; else winsB++; }
          }
        }
      });
      var hasWinner = winsA !== winsB;
      var winnerIsA = winsA > winsB;

      // Create comparison content div
      var compView = document.createElement('div');
      compView.id = 'of-stats-compare-view';
      compView.style.cssText = 'animation:ofBattleSlideIn 0.4s ease;';

      // --- HEADER: compact with back arrow + close ---
      var hdr = document.createElement('div');
      hdr.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid rgba(0,180,255,0.12);';
      hdr.innerHTML = '<div style="display:flex;align-items:center;gap:6px;">'
        + '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#00b4ff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><circle cx="5" cy="6" r="3"/><path d="M12 6h5a2 2 0 0 1 2 2v7"/><path d="m15 9-3-3 3-3"/><circle cx="19" cy="18" r="3"/><path d="M12 18H7a2 2 0 0 1-2-2V9"/><path d="m9 15 3 3-3 3"/></svg>'
        + '<span style="color:#00b4ff;font-size:10px;text-transform:uppercase;letter-spacing:1px;font-weight:600;">' + t('compareTitle') + '</span></div>'
        + '<div style="display:flex;align-items:center;gap:6px;">'
        + '<div id="of-battle-back-btn" style="display:flex;align-items:center;gap:3px;cursor:pointer;user-select:none;padding:3px 8px;border-radius:6px;background:rgba(0,180,255,0.08);border:1px solid rgba(0,180,255,0.15);transition:all 0.2s;">'
        + '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#00b4ff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5m0 0l7 7m-7-7l7-7"/></svg>'
        + '<span style="color:#00b4ff;font-size:9px;font-weight:600;letter-spacing:0.3px;">' + t('compareBack') + '</span></div>'
        + '<button id="of-battle-close-btn" style="background:none;border:none;color:#5f7388;cursor:pointer;font-size:16px;padding:0 2px;line-height:1;transition:color 0.2s;" onmouseover="this.style.color=\'#ef4444\'" onmouseout="this.style.color=\'#5f7388\'">&times;</button></div>';
      compView.appendChild(hdr);

      // --- AVATARS + VS ROW with crown on winner ---
      var gradeColorA = modelA.gradeColor || '#00b4ff';
      var gradeColorB = modelB.gradeColor || '#00b4ff';

      function avatarHtml(model, side, isWinner) {
        var cls = side === 'a' ? 'of-battle-avatar of-battle-avatar-a' : 'of-battle-avatar of-battle-avatar-b';
        var phCls = side === 'a' ? 'of-battle-placeholder of-battle-placeholder-a' : 'of-battle-placeholder of-battle-placeholder-b';
        if (isWinner) { cls += ' of-battle-avatar-winner'; phCls += ' of-battle-placeholder-winner'; }
        var crown = isWinner ? '<div style="position:absolute;top:-4px;left:50%;transform:translateX(-50%);z-index:3;pointer-events:none;"><div style="animation:ofCrownBounce 0.6s ease 0.8s both;"><div style="animation:ofCrownFloat 2s ease-in-out 1.4s infinite;font-size:20px;filter:drop-shadow(0 2px 8px rgba(255,215,0,0.6));">👑</div></div></div>' : '';
        var avatarWrap = '<div style="position:relative;display:inline-block;padding-top:' + (isWinner ? '18px' : '0') + ';">' + crown;
        if (model.avatar && typeof model.avatar === 'string' && model.avatar.indexOf('http') === 0) {
          avatarWrap += '<img class="' + cls + '" src="' + model.avatar + '" onerror="this.style.display=\'none\';this.nextSibling.style.display=\'flex\'" /><div class="' + phCls + '" style="display:none">👤</div>';
        } else {
          avatarWrap += '<div class="' + phCls + '">👤</div>';
        }
        avatarWrap += '</div>';
        return avatarWrap;
      }

      function scoreBadge(model, side, isWin) {
        var gc = model.gradeColor || '#00b4ff';
        if (isWin) {
          return '<div style="display:inline-flex;align-items:center;gap:3px;margin-top:4px;padding:3px 10px;border-radius:12px;'
            + 'background:linear-gradient(135deg,' + gc + '22,#ffd70022);'
            + 'border:1px solid ' + gc + '44;'
            + 'animation:ofScorePop 0.4s ease 0.6s both;">'
            + '<span style="font-size:13px;filter:drop-shadow(0 0 4px ' + gc + ');">' + (model.gradeIcon || '') + '</span>'
            + '<span style="font-size:14px;font-weight:900;background:linear-gradient(135deg,' + gc + ',#ffd700);-webkit-background-clip:text;-webkit-text-fill-color:transparent;">' + model.score + '</span>'
            + '</div>';
        }
        return '<div style="display:inline-flex;align-items:center;gap:2px;margin-top:3px;padding:2px 8px;border-radius:10px;'
          + 'background:' + gc + '12;border:1px solid ' + gc + '20;">'
          + '<span style="font-size:10px;opacity:0.7;">' + (model.gradeIcon || '') + '</span>'
          + '<span style="font-size:11px;font-weight:700;color:' + gc + ';opacity:0.8;">' + model.score + '</span>'
          + '</div>';
      }

      var vsRow = document.createElement('div');
      vsRow.style.cssText = 'display:flex;align-items:flex-end;justify-content:center;gap:10px;margin-bottom:10px;padding-top:4px;';
      vsRow.innerHTML =
        '<div style="text-align:center;animation:ofBattleSlideIn 0.3s ease;flex:1;min-width:0;">'
        + avatarHtml(modelA, 'a', hasWinner && winnerIsA)
        + '<div style="font-size:10px;font-weight:700;color:' + (hasWinner && winnerIsA ? '#ffd700' : '#fff') + ';margin-top:4px;max-width:90px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-left:auto;margin-right:auto;">@' + modelA.username + '</div>'
        + scoreBadge(modelA, 'a', hasWinner && winnerIsA)
        + '</div>'
        + '<div style="animation:ofBattleVs 0.5s ease 0.2s both;flex-shrink:0;padding-bottom:14px;">'
        + '<div style="font-size:18px;font-weight:900;background:linear-gradient(135deg,#00b4ff,#7c3aed);-webkit-background-clip:text;-webkit-text-fill-color:transparent;line-height:1;">VS</div>'
        + '<div style="width:24px;height:2px;background:linear-gradient(90deg,#00b4ff,#7c3aed);border-radius:1px;margin:4px auto;animation:ofBattleGlow 2s ease infinite;"></div>'
        + '</div>'
        + '<div style="text-align:center;animation:ofBattleSlideIn 0.3s ease 0.1s both;flex:1;min-width:0;">'
        + avatarHtml(modelB, 'b', hasWinner && !winnerIsA)
        + '<div style="font-size:10px;font-weight:700;color:' + (hasWinner && !winnerIsA ? '#ffd700' : '#fff') + ';margin-top:4px;max-width:90px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-left:auto;margin-right:auto;">@' + modelB.username + '</div>'
        + scoreBadge(modelB, 'b', hasWinner && !winnerIsA)
        + '</div>';
      compView.appendChild(vsRow);

      // --- VERDICT right after avatars ---
      var verdict = document.createElement('div');
      verdict.style.cssText = 'text-align:center;padding:4px 0 8px;animation:ofBattleSlideIn 0.4s ease 0.4s both;';
      if (hasWinner) {
        var winner = winnerIsA ? modelA : modelB;
        var winColor = winnerIsA ? '#00b4ff' : '#7c3aed';
        var wMax = Math.max(winsA, winsB), wMin = Math.min(winsA, winsB);
        verdict.innerHTML = '<div style="font-size:13px;font-weight:800;animation:ofBattleWinner 0.6s ease 0.6s both;background:linear-gradient(135deg,#ffd700,' + winColor + ');-webkit-background-clip:text;-webkit-text-fill-color:transparent;">🏆 @' + winner.username + ' ' + t('compareWins') + '</div>'
          + '<div style="font-size:9px;color:#5f7388;margin-top:2px;">' + wMax + ' – ' + wMin + ' ' + t('compareByMetrics') + '</div>';
      } else {
        verdict.innerHTML = '<div style="font-size:13px;font-weight:800;color:#8899aa;">⚖️ ' + t('compareTie') + ' ' + winsA + ' – ' + winsB + '</div>';
      }
      compView.appendChild(verdict);

      // --- RADAR OVERLAY ---
      var radarAngles2 = [-90, -18, 54, 126, 198].map(function(a) { return a * Math.PI / 180; });
      var rR = 80;
      function rPt(angle, r) { return [Math.cos(angle) * r, Math.sin(angle) * r]; }

      var gridLevelsC = [1, 0.75, 0.5, 0.25];
      var gridPolysC = gridLevelsC.map(function(lv) {
        return radarAngles2.map(function(a) { var p = rPt(a, rR * lv); return p[0].toFixed(1) + ',' + p[1].toFixed(1); }).join(' ');
      });
      var axisLinesC = radarAngles2.map(function(a) { var p = rPt(a, rR); return '<line x1="0" y1="0" x2="' + p[0].toFixed(1) + '" y2="' + p[1].toFixed(1) + '"/>'; }).join('');

      function modelPoly(model) {
        return radarKeys.map(function(k, i) {
          var ratio = Math.min((model[k[1]] || 0) / k[2], 1);
          var p = rPt(radarAngles2[i], rR * ratio);
          return p[0].toFixed(1) + ',' + p[1].toFixed(1);
        }).join(' ');
      }
      function modelDots(model, color) {
        return radarKeys.map(function(k, i) {
          var ratio = Math.min((model[k[1]] || 0) / k[2], 1);
          var p = rPt(radarAngles2[i], rR * ratio);
          return '<circle cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="3.5" fill="' + color + '" stroke="#0a0e1e" stroke-width="1"/>';
        }).join('');
      }

      var labelCfg = [
        { anchor: 'center', offx: 0, offy: -10 },
        { anchor: 'left', offx: 6, offy: 0 },
        { anchor: 'left', offx: 6, offy: 0 },
        { anchor: 'right', offx: -6, offy: 0 },
        { anchor: 'right', offx: -6, offy: 0 }
      ];
      var vbX = -130, vbY = -105, vbW = 260, vbH = 220;

      var radarDiv = document.createElement('div');
      radarDiv.style.cssText = 'position:relative;margin-bottom:8px;animation:ofBattleSlideIn 0.4s ease 0.15s both;';
      radarDiv.innerHTML = '<svg width="100%" viewBox="-130 -105 260 220" style="filter:drop-shadow(0 0 8px rgba(0,180,255,0.15));display:block;">'
        + '<g opacity="0.15" stroke="#5f7388" fill="none">'
        + gridPolysC.map(function(pts) { return '<polygon points="' + pts + '"/>'; }).join('')
        + '</g>'
        + '<g stroke="rgba(0,180,255,0.08)">' + axisLinesC + '</g>'
        + (winnerIsA
          ? '<polygon fill="#7c3aed20" stroke="#7c3aed" stroke-width="2" points="' + modelPoly(modelB) + '" style="stroke-dasharray:600;animation:ofBattleRadarDraw 1s ease 0.3s both;"/>'
            + '<g>' + modelDots(modelB, '#7c3aed') + '</g>'
            + '<polygon fill="#00b4ff20" stroke="#00b4ff" stroke-width="2" points="' + modelPoly(modelA) + '" style="stroke-dasharray:600;animation:ofBattleRadarDraw 1s ease 0.5s both;"/>'
            + '<g>' + modelDots(modelA, '#00b4ff') + '</g>'
          : '<polygon fill="#00b4ff20" stroke="#00b4ff" stroke-width="2" points="' + modelPoly(modelA) + '" style="stroke-dasharray:600;animation:ofBattleRadarDraw 1s ease 0.3s both;"/>'
            + '<g>' + modelDots(modelA, '#00b4ff') + '</g>'
            + '<polygon fill="#7c3aed20" stroke="#7c3aed" stroke-width="2" points="' + modelPoly(modelB) + '" style="stroke-dasharray:600;animation:ofBattleRadarDraw 1s ease 0.5s both;"/>'
            + '<g>' + modelDots(modelB, '#7c3aed') + '</g>'
        )
        + '</svg>';

      var radarTipKeys = { MAT: 'compMAT', POP: 'compPOP', ORG: 'compORG', ACT: 'compACT', TRS: 'compTRS' };
      radarKeys.forEach(function(k, i) {
        var vtx = rPt(radarAngles2[i], rR + 12);
        var cfg = labelCfg[i];
        var pctLeft = ((vtx[0] - vbX) / vbW * 100).toFixed(1);
        var pctTop = ((vtx[1] - vbY) / vbH * 100).toFixed(1);
        var xform = cfg.anchor === 'center' ? 'translate(-50%,' + cfg.offy + 'px)' : cfg.anchor === 'right' ? 'translate(calc(-100% + ' + cfg.offx + 'px),' + cfg.offy + 'px)' : 'translate(' + cfg.offx + 'px,' + cfg.offy + 'px)';
        var vA = modelA[k[1]] || 0, vB = modelB[k[1]] || 0;
        var tipText = t(radarTipKeys[k[0]] || 'compMAT');
        var lbl = document.createElement('span');
        lbl.className = 'of-stats-tip';
        lbl.style.cssText = 'position:absolute;top:' + pctTop + '%;left:' + pctLeft + '%;transform:' + xform + ';font-size:10px;font-weight:600;font-family:Inter,-apple-system,sans-serif;white-space:nowrap;z-index:2;';
        lbl.innerHTML = '<span style="color:#00b4ff;">' + vA + '</span><span style="color:#3a4555;margin:0 2px;">·</span><span style="color:#7c3aed;">' + vB + '</span> <span style="color:#5f7388;">' + k[0] + '</span>'
          + '<span class="of-stats-tiptext" style="display:none;">' + tipText + '<br><span style="color:#00b4ff;">@' + modelA.username + ': ' + vA + '/' + k[2] + '</span> · <span style="color:#7c3aed;">@' + modelB.username + ': ' + vB + '/' + k[2] + '</span></span>';
        radarDiv.appendChild(lbl);
      });

      // Legend
      var legend = document.createElement('div');
      legend.style.cssText = 'display:flex;justify-content:center;gap:16px;margin-top:4px;font-size:9px;';
      legend.innerHTML = '<div style="display:flex;align-items:center;gap:4px;"><div style="width:8px;height:8px;border-radius:50%;background:#00b4ff;"></div><span style="color:#8899aa;">@' + modelA.username + '</span></div>'
        + '<div style="display:flex;align-items:center;gap:4px;"><div style="width:8px;height:8px;border-radius:50%;background:#7c3aed;"></div><span style="color:#8899aa;">@' + modelB.username + '</span></div>';
      radarDiv.appendChild(legend);
      compView.appendChild(radarDiv);

      // --- METRIC BATTLE ROWS ---
      function fmtVal(val, type) {
        if (type === 'short') {
          if (val >= 1000000) return (val / 1000000).toFixed(1) + 'M';
          if (val >= 1000) return (val / 1000).toFixed(1) + 'K';
          return String(val);
        }
        if (type === 'pct') return (val || 0).toFixed(1) + '%';
        if (type === 'dollar') return val === 0 ? 'FREE' : '$' + val;
        return String(val);
      }

      var metPanel = document.createElement('div');
      metPanel.style.cssText = 'background:rgba(0,0,0,0.25);border-radius:10px;padding:6px 0;box-shadow:inset 0 2px 10px rgba(0,0,0,0.5);border:1px solid rgba(255,255,255,0.03);margin-bottom:8px;';
      metrics.forEach(function(m, idx) {
        var label = m[0], key = m[1], type = m[2], higherBetter = m[3];
        var vA = modelA[key] || 0, vB = modelB[key] || 0;
        var aWin = false, bWin = false;
        if (vA !== vB) {
          if (higherBetter) { aWin = vA > vB; bWin = vB > vA; }
          else {
            if (vA === 0 && vB > 0) aWin = true;
            else if (vB === 0 && vA > 0) bWin = true;
            else { aWin = vA < vB; bWin = vB < vA; }
          }
        }

        var cA = aWin ? '#22c55e' : (bWin ? '#ef4444' : '#667788');
        var cB = bWin ? '#22c55e' : (aWin ? '#ef4444' : '#667788');
        var arrow = aWin ? '◀' : (bWin ? '▶' : '–');
        var arrowColor = aWin ? '#22c55e' : (bWin ? '#22c55e' : '#334455');
        var delay = (0.2 + idx * 0.06).toFixed(2);

        var row = document.createElement('div');
        row.style.cssText = 'display:grid;grid-template-columns:1fr 18px auto 18px 1fr;align-items:center;padding:5px 12px;animation:ofBattleRowIn 0.3s ease ' + delay + 's both;' + (idx > 0 ? 'border-top:1px solid rgba(255,255,255,0.03);' : '');
        row.innerHTML =
          '<div style="text-align:right;padding-right:4px;font-size:12px;font-weight:700;color:' + cA + ';">' + fmtVal(vA, type) + '</div>'
          + '<div style="text-align:center;font-size:8px;color:' + arrowColor + ';">' + arrow + '</div>'
          + '<div style="text-align:center;font-size:8px;color:#c8d6e5;text-transform:uppercase;letter-spacing:0.4px;min-width:44px;font-weight:600;">' + label + '</div>'
          + '<div style="text-align:center;font-size:8px;color:' + arrowColor + ';">' + arrow + '</div>'
          + '<div style="text-align:left;padding-left:4px;font-size:12px;font-weight:700;color:' + cB + ';">' + fmtVal(vB, type) + '</div>';
        metPanel.appendChild(row);
      });
      compView.appendChild(metPanel);

      // --- ACTION ROW: clear + back ---
      var actions = document.createElement('div');
      actions.style.cssText = 'display:flex;gap:8px;justify-content:center;padding:6px 0 2px;animation:ofBattleSlideIn 0.3s ease 0.9s both;';

      var clearBtn2 = document.createElement('button');
      clearBtn2.style.cssText = 'padding:5px 14px;border-radius:6px;border:1px solid rgba(239,68,68,0.2);background:rgba(239,68,68,0.06);color:#ef4444;font-size:10px;cursor:pointer;font-family:inherit;font-weight:600;transition:all 0.2s;';
      clearBtn2.textContent = '🗑 ' + t('compareClear');
      clearBtn2.onmouseenter = function() { this.style.background = 'rgba(239,68,68,0.12)'; };
      clearBtn2.onmouseleave = function() { this.style.background = 'rgba(239,68,68,0.06)'; };

      actions.appendChild(clearBtn2);
      compView.appendChild(actions);

      // --- SWAP CONTENT: hide front/back, show comparison ---
      flipFront.style.display = 'none';
      flipBack.style.display = 'none';
      if (flipInner.classList.contains('flipped')) flipInner.classList.remove('flipped');
      flipInner.appendChild(compView);
      flipInner.style.minHeight = '';
      flipInner.offsetHeight;
      flipInner.style.minHeight = compView.scrollHeight + 'px';

      function restoreCard() {
        compView.remove();
        flipFront.style.display = '';
        flipBack.style.display = '';
        flipInner.style.minHeight = '';
        flipInner.offsetHeight;
        flipInner.style.minHeight = flipFront.scrollHeight + 'px';
      }

      hdr.querySelector('#of-battle-back-btn').onclick = restoreCard;
      hdr.querySelector('#of-battle-close-btn').onclick = function() { badgeEl.remove(); };

      clearBtn2.onclick = function() {
        chrome.storage.local.remove('ofStatsCompareModel', function() {
          _compareModelData = null;
          restoreCard();
          if (typeof updateCompareButtonCb === 'function') updateCompareButtonCb();
        });
      };
    }

    // Function to display profile data badge on the page
    function displayProfileData(profileData) {
      // Check if user is authenticated - don't show if not logged in
      const authStatus = localStorage.getItem('ofStatsAuthStatus');
      if (authStatus !== 'authenticated') {
        log('OF Stats: Not authenticated, skipping profile badge');
        return;
      }

      // Read settings from chrome.storage.local (shared with popup)
      chrome.storage.local.get(['ofStatsBadgeEnabled', 'ofStatsVerdictEnabled', 'ofStatsLang', 'ofStatsSubscriptionActive'], function(settings) {

      // Subscription paywall flag — use cached value initially
      var _subExpired = settings.ofStatsSubscriptionActive === false;

      // Live server check: verify subscription is still active.
      // hasSubscription=false (no row at all) ⇒ treat as expired too — earlier
      // we only inspected resp.subscription, so users with NO PLAN slipped
      // through with the cached active flag and saw the full badge.
      try {
        chrome.runtime.sendMessage({ action: 'getSubscriptionStatus' }, function(resp) {
          if (chrome.runtime.lastError) return;
          if (!resp || !resp.success) return;

          var serverActive = false;
          if (resp.hasSubscription && resp.subscription) {
            var sub = resp.subscription;
            serverActive = (typeof sub.isActive === 'boolean')
              ? sub.isActive
              : (sub.status === 'active' || sub.status === 'trial');
          }

          if (!serverActive && !_subExpired) {
            // Server says expired / no plan but badge thinks active — flip cache and rebuild
            chrome.storage.local.set({ ofStatsSubscriptionActive: false });
            log('OF Stats: Subscription expired on server, reloading badge');
            var oldBadge = document.getElementById('of-stats-profile-badge');
            if (oldBadge) oldBadge.remove();
            displayProfileData(profileData);
          } else if (serverActive && _subExpired) {
            // Server says active but badge thinks expired — flip cache and rebuild
            chrome.storage.local.set({ ofStatsSubscriptionActive: true });
            log('OF Stats: Subscription renewed on server, reloading badge');
            var oldBadge2 = document.getElementById('of-stats-profile-badge');
            if (oldBadge2) oldBadge2.remove();
            displayProfileData(profileData);
          }
        });
      } catch (e) {}

      // Check if badge is enabled in settings
      if (settings.ofStatsBadgeEnabled === false) {
        log('OF Stats: Badge disabled in settings, skipping');
        return;
      }

      // Refresh language setting
      _ofLang = settings.ofStatsLang || 'ru';
      
      // Only display on profile pages (not own stats/settings pages)
      if (window.location.pathname.startsWith('/my/')) return;
      
      // Check if this profile data matches the current page
      const currentPath = window.location.pathname;
      const pathUsername = currentPath.split('/')[1]?.toLowerCase(); // Get username from URL
      const dataUsername = (profileData.username || '').toLowerCase();
      
      // Only show badge if username matches OR if we're on a profile page and usernames match
      if (pathUsername && dataUsername && pathUsername !== dataUsername) {
        log('OF Stats: Skipping badge - URL username (' + pathUsername + ') != data username (' + dataUsername + ')');
        return;
      }
      
      log('OF Stats: Attempting to display profile data for @' + dataUsername + '...');
      
      // Remove old badge if exists
      const oldBadge = document.getElementById('of-stats-profile-badge');
      if (oldBadge) oldBadge.remove();
      
      // Build badge HTML with available data
      let badgeItems = [];
      
      // SVG Icons for badge
      const svgIcons = {
        fans: '<svg viewBox="0 0 24 24" fill="none" width="16" height="16"><path d="M17 21V19C17 17.9391 16.5786 16.9217 15.8284 16.1716C15.0783 15.4214 14.0609 15 13 15H5C3.93913 15 2.92172 15.4214 2.17157 16.1716C1.42143 16.9217 1 17.9391 1 19V21" stroke="#f1c40f" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="9" cy="7" r="4" stroke="#f1c40f" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M23 21V19C22.9993 18.1137 22.7044 17.2528 22.1614 16.5523C21.6184 15.8519 20.8581 15.3516 20 15.13" stroke="#f1c40f" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M16 3.13C16.8604 3.35031 17.623 3.85071 18.1676 4.55232C18.7122 5.25392 19.0078 6.11683 19.0078 7.005C19.0078 7.89318 18.7122 8.75608 18.1676 9.45769C17.623 10.1593 16.8604 10.6597 16 10.88" stroke="#f1c40f" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
        likes: '<svg viewBox="0 0 24 24" fill="none" width="16" height="16"><path d="M20.84 4.61C20.3292 4.099 19.7228 3.69364 19.0554 3.41708C18.3879 3.14052 17.6725 2.99817 16.95 2.99817C16.2275 2.99817 15.5121 3.14052 14.8446 3.41708C14.1772 3.69364 13.5708 4.099 13.06 4.61L12 5.67L10.94 4.61C9.9083 3.57831 8.50903 2.99871 7.05 2.99871C5.59096 2.99871 4.19169 3.57831 3.16 4.61C2.1283 5.64169 1.54871 7.04097 1.54871 8.5C1.54871 9.95903 2.1283 11.3583 3.16 12.39L4.22 13.45L12 21.23L19.78 13.45L20.84 12.39C21.351 11.8792 21.7563 11.2728 22.0329 10.6054C22.3095 9.93789 22.4518 9.22249 22.4518 8.5C22.4518 7.77751 22.3095 7.0621 22.0329 6.39464C21.7563 5.72718 21.351 5.12075 20.84 4.61Z" fill="#ff6b9d" stroke="#ff6b9d" stroke-width="1"/></svg>',
        joined: '<svg viewBox="0 0 24 24" fill="none" width="14" height="14"><rect x="3" y="4" width="18" height="18" rx="2" ry="2" stroke="#00b4ff" stroke-width="2"/><line x1="16" y1="2" x2="16" y2="6" stroke="#00b4ff" stroke-width="2" stroke-linecap="round"/><line x1="8" y1="2" x2="8" y2="6" stroke="#00b4ff" stroke-width="2" stroke-linecap="round"/><line x1="3" y1="10" x2="21" y2="10" stroke="#00b4ff" stroke-width="2"/></svg>',
        price: '<svg viewBox="0 0 24 24" fill="none" width="14" height="14"><circle cx="12" cy="12" r="10" stroke="#10b981" stroke-width="2"/><path d="M12 6V18" stroke="#10b981" stroke-width="2" stroke-linecap="round"/><path d="M15 9.5C15 8.12 13.66 7 12 7C10.34 7 9 8.12 9 9.5C9 10.88 10.34 12 12 12C13.66 12 15 13.12 15 14.5C15 15.88 13.66 17 12 17C10.34 17 9 15.88 9 14.5" stroke="#10b981" stroke-width="2" stroke-linecap="round"/></svg>',
        location: '<svg viewBox="0 0 24 24" fill="none" width="14" height="14"><path d="M21 10C21 17 12 23 12 23C12 23 3 17 3 10C3 7.61305 3.94821 5.32387 5.63604 3.63604C7.32387 1.94821 9.61305 1 12 1C14.3869 1 16.6761 1.94821 18.364 3.63604C20.0518 5.32387 21 7.61305 21 10Z" stroke="#3498db" stroke-width="2"/><circle cx="12" cy="10" r="3" stroke="#3498db" stroke-width="2"/></svg>',
        online: '<svg viewBox="0 0 24 24" fill="none" width="14" height="14"><circle cx="12" cy="12" r="10" fill="#10b981"/><path d="M8 12L11 15L16 9" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
        offline: '<svg viewBox="0 0 24 24" fill="none" width="14" height="14"><circle cx="12" cy="12" r="10" stroke="#64748b" stroke-width="2"/><circle cx="12" cy="12" r="4" fill="#64748b"/></svg>',
        streams: '<svg viewBox="0 0 24 24" fill="none" width="14" height="14"><path d="M23 7L16 12L23 17V7Z" stroke="#9b59b6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2" stroke="#9b59b6" stroke-width="2"/></svg>',
        subscribed: '<svg viewBox="0 0 24 24" fill="none" width="14" height="14"><path d="M22 11.08V12C21.9988 14.1564 21.3005 16.2547 20.0093 17.9818C18.7182 19.709 16.9033 20.9725 14.8354 21.5839C12.7674 22.1953 10.5573 22.1219 8.53447 21.3746C6.51168 20.6273 4.78465 19.2461 3.61096 17.4371C2.43727 15.628 1.87979 13.4881 2.02168 11.3363C2.16356 9.18457 2.99721 7.13633 4.39828 5.49707C5.79935 3.85782 7.69279 2.71538 9.79619 2.24015C11.8996 1.76491 14.1003 1.98234 16.07 2.86" stroke="#10b981" stroke-width="2" stroke-linecap="round"/><polyline points="22,4 12,14.01 9,11.01" stroke="#10b981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
        stats: '<svg viewBox="0 0 24 24" fill="none" width="14" height="14"><path d="M18 20V10" stroke="#00b4ff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 20V4" stroke="#00b4ff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M6 20V14" stroke="#00b4ff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
        comments: '<svg viewBox="0 0 24 24" fill="none" width="14" height="14"><path d="M21 15C21 15.5304 20.7893 16.0391 20.4142 16.4142C20.0391 16.7893 19.5304 17 19 17H7L3 21V5C3 4.46957 3.21071 3.96086 3.58579 3.58579C3.96086 3.21071 4.46957 3 5 3H19C19.5304 3 20.0391 3.21071 20.4142 3.58579C20.7893 3.96086 21 4.46957 21 5V15Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
      };
      
      // Helper: build micro sparkline SVG from trend points
      function buildMicroSparkline(trendPoints) {
        if (!trendPoints || trendPoints.length < 2) return '';
        var pts = trendPoints;
        var vals = pts.map(function(p) { return p.f; });
        var minV = Math.min.apply(null, vals);
        var maxV = Math.max.apply(null, vals);
        var range = maxV - minV || 1;
        var w = 44, h = 14;
        var coords = vals.map(function(v, i) {
          var x = (i / (vals.length - 1)) * w;
          var y = h - ((v - minV) / range) * (h - 2) - 1;
          return x.toFixed(1) + ',' + y.toFixed(1);
        });
        var pctChange = ((vals[vals.length - 1] - vals[0]) / vals[0] * 100);
        var isUp = pctChange >= 0;
        var color = isUp ? '#22c55e' : '#ef4444';
        var arrow = isUp ? '▲' : '▼';
        var pctText = arrow + ' ' + (isUp ? '+' : '') + pctChange.toFixed(1) + '%';
        return '<span style="display:inline-flex;align-items:center;gap:3px;margin-left:4px;">'
          + '<svg viewBox="0 0 ' + w + ' ' + h + '" width="' + w + '" height="' + h + '" style="vertical-align:middle;" preserveAspectRatio="none">'
          + '<polyline points="' + coords.join(' ') + '" fill="none" stroke="' + color + '" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>'
          + '</svg>'
          + '<span style="font-size:8px;font-weight:700;color:' + color + ';background:' + color + '18;padding:1px 3px;border-radius:3px;white-space:nowrap;">' + pctText + '</span>'
          + '</span>';
      }
      
      // Subscribers/Fans count - THE MAIN DATA!
      if (profileData.subscribersCount !== undefined && profileData.subscribersCount !== null) {
        const fansFormatted = formatNumberShort(profileData.subscribersCount);
        const microSpark = buildMicroSparkline(profileData._fansTrend);
        badgeItems.push(`
          <div style="display:flex;align-items:center;gap:8px;">
            ${svgIcons.fans}
            <span style="color:#8a96a3;font-size:12px;">Fans:</span>
            <span style="color:#f1c40f;font-weight:600;font-size:13px;">${fansFormatted}</span>${microSpark}
          </div>
        `);
      } else if (profileData.showSubscribersCount === false) {
        // Fans are hidden by creator - show last known value from global registry
        if (profileData._lastKnownFans) {
          const lastFans = profileData._lastKnownFans;
          const lastFansText = lastFans.text || formatNumberShort(lastFans.count);
          const lastDate = lastFans.formattedDate || formatDateShort(lastFans.recordedAt);
          badgeItems.push(`
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
              ${svgIcons.fans}
              <span style="color:#8a96a3;font-size:12px;">Fans:</span>
              <span style="color:#64748b;font-weight:600;font-size:12px;">Hidden</span>
              <span style="color:#475569;font-size:12px;">|</span>
              <span style="color:#b0b8c1;font-size:12px;">Last:</span>
              <span style="color:#f1c40f;font-weight:600;font-size:13px;">${lastFansText}</span>
              <span style="color:#8a96a3;font-size:12px;">${lastDate}</span>
            </div>
          `);
        } else {
          // No last known data
          badgeItems.push(`
            <div style="display:flex;align-items:center;gap:8px;">
              ${svgIcons.fans}
              <span style="color:#8a96a3;font-size:12px;">Fans:</span>
              <span style="color:#64748b;font-weight:600;font-style:italic;font-size:13px;">Hidden</span>
            </div>
          `);
        }
      }
      
      // Favorited count (likes received) - POPULARITY INDICATOR
      if (profileData.favoritedCount !== undefined && profileData.favoritedCount !== null && profileData.favoritedCount > 0) {
        const favFormatted = formatNumberShort(profileData.favoritedCount);
        badgeItems.push(`
          <div style="display:flex;align-items:center;gap:8px;">
            ${svgIcons.likes}
            <span style="color:#8a96a3;font-size:12px;">Likes:</span>
            <span style="color:#ff6b9d;font-weight:600;font-size:13px;">${favFormatted}</span>
          </div>
        `);
      }
      
      // Join date
      if (profileData.joinDate) {
        const joinDateFormatted = formatJoinDate(profileData.joinDate);
        badgeItems.push(`
          <div style="display:flex;align-items:center;gap:8px;">
            ${svgIcons.joined}
            <span style="color:#8a96a3;font-size:12px;">Joined:</span>
            <span style="color:#00b4ff;font-weight:600;font-size:13px;">${joinDateFormatted}</span>
          </div>
        `);
      }
      
      // Subscription price
      if (profileData.subscribePrice !== undefined && profileData.subscribePrice !== null) {
        const priceText = profileData.subscribePrice === 0 ? 'FREE' : '$' + profileData.subscribePrice;
        const priceColor = profileData.subscribePrice === 0 ? '#10b981' : '#f59e0b';
        badgeItems.push(`
          <div style="display:flex;align-items:center;gap:8px;">
            ${svgIcons.price}
            <span style="color:#8a96a3;font-size:12px;">Price:</span>
            <span style="color:${priceColor};font-weight:600;font-size:13px;">${priceText}</span>
          </div>
        `);
      }
      
      // Location
      if (profileData.location) {
        const locationText = profileData.location.length > 15 ? profileData.location.substring(0, 15) + '...' : profileData.location;
        badgeItems.push(`
          <div style="display:flex;align-items:center;gap:8px;">
            ${svgIcons.location}
            <span style="color:#8a96a3;font-size:12px;">Location:</span>
            <span style="color:#3498db;font-weight:600;font-size:13px;">${locationText}</span>
          </div>
        `);
      }
      
      // Last seen
      if (profileData.lastSeen) {
        const lastSeenFormatted = formatLastSeen(profileData.lastSeen);
        const isOnline = lastSeenFormatted === 'Online';
        badgeItems.push(`
          <div style="display:flex;align-items:center;gap:8px;">
            ${isOnline ? svgIcons.online : svgIcons.offline}
            <span style="color:#8a96a3;font-size:12px;">Status:</span>
            <span style="color:${isOnline ? '#10b981' : '#64748b'};font-weight:600;font-size:13px;">${lastSeenFormatted}</span>
          </div>
        `);
      }
      
      // Streams count
      if (profileData.finishedStreamsCount !== undefined && profileData.finishedStreamsCount > 0) {
        badgeItems.push(`
          <div style="display:flex;align-items:center;gap:8px;">
            ${svgIcons.streams}
            <span style="color:#8a96a3;font-size:12px;">Streams:</span>
            <span style="color:#9b59b6;font-weight:600;font-size:13px;">${profileData.finishedStreamsCount}</span>
          </div>
        `);
      }
      
      // Subscribed duration (if subscribed)
      if (profileData.subscribedOnDuration) {
        badgeItems.push(`
          <div style="display:flex;align-items:center;gap:8px;">
            ${svgIcons.subscribed}
            <span style="color:#8a96a3;font-size:12px;">Subscribed:</span>
            <span style="color:#10b981;font-weight:600;font-size:13px;">${profileData.subscribedOnDuration}</span>
          </div>
        `);
      }
      
      // Comment status from farmed models database
      if (profileData._farmedStatus !== undefined) {
        var commentColor, commentText, commentIcon;
        if (profileData._farmedStatus === 'ready') {
          commentColor = '#10b981';
          commentText = 'Open';
          commentIcon = svgIcons.comments.replace('currentColor', '#10b981');
        } else if (profileData._farmedStatus === 'none') {
          commentColor = '#ef4444';
          commentText = 'Closed';
          commentIcon = svgIcons.comments.replace('currentColor', '#ef4444');
        } else {
          commentColor = '#f59e0b';
          commentText = 'Unknown';
          commentIcon = svgIcons.comments.replace('currentColor', '#f59e0b');
        }
        badgeItems.push(`
          <div style="display:flex;align-items:center;gap:8px;">
            ${commentIcon}
            <span style="color:#8a96a3;font-size:12px;">Comments:</span>
            <span style="color:${commentColor};font-weight:600;font-size:13px;">${commentText}</span>
          </div>
        `);
      }
      
      if (badgeItems.length === 0) {
        log('OF Stats: No data to display in badge');
        return;
      }
      
      // Create main badge container - INSIDE SIDEBAR (matching popup.css style)
      const badge = document.createElement('div');
      badge.id = 'of-stats-profile-badge';
      badge.style.cssText = `
        background: linear-gradient(180deg, #0e1120 0%, #0a0c14 60%);
        border: 1px solid rgba(139, 92, 246, 0.25);
        border-top: 1px solid rgba(139, 92, 246, 0.4);
        border-radius: 14px;
        padding: 16px;
        margin-bottom: 15px;
        box-shadow: inset 0 1px 0 rgba(255,255,255,0.08);
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        width: 100%;
        box-sizing: border-box;
        position: relative;
        overflow: visible;
        perspective: 800px;
      `;

      // Inject flip card styles once
      if (!document.getElementById('of-stats-flip-styles')) {
        var flipStyleEl = document.createElement('style');
        flipStyleEl.id = 'of-stats-flip-styles';
        flipStyleEl.textContent = '#of-stats-profile-badge .of-flip-inner{position:relative;z-index:1;width:100%;transition:transform 0.6s cubic-bezier(0.4,0,0.2,1),min-height 0.4s ease;transform-style:preserve-3d}#of-stats-profile-badge .of-flip-inner.flipped{transform:rotateY(180deg)}#of-stats-profile-badge .of-flip-front{position:relative;width:100%;backface-visibility:hidden;-webkit-backface-visibility:hidden;transform-style:flat}#of-stats-profile-badge .of-flip-back{position:absolute;top:0;left:0;width:100%;height:100%;overflow:hidden;backface-visibility:hidden;-webkit-backface-visibility:hidden;transform:rotateY(180deg);transform-style:flat}#of-stats-profile-badge .of-flip-inner.flipped .of-flip-front{pointer-events:none}#of-stats-profile-badge .of-flip-inner:not(.flipped) .of-flip-back{pointer-events:none}';
        document.head.appendChild(flipStyleEl);
      }

      // Add inner glow effect (direct child of badge, behind flip content)
      const glowOverlay = document.createElement('div');
      glowOverlay.style.cssText = `
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: radial-gradient(ellipse at 50% 0%, rgba(139, 92, 246, 0.18) 0%, rgba(139, 92, 246, 0) 55%);
        pointer-events: none;
        border-radius: 14px;
        z-index: 0;
      `;
      badge.appendChild(glowOverlay);

      // Create flip structure (wraps entire card content)
      var flipInner = document.createElement('div');
      flipInner.className = 'of-flip-inner';
      var flipFront = document.createElement('div');
      flipFront.className = 'of-flip-front';
      var flipBack = document.createElement('div');
      flipBack.className = 'of-flip-back';
      
      // Header with Details flip button and close button
      const header = document.createElement('div');
      header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid rgba(0, 180, 255, 0.15);position:relative;z-index:1;';
      header.innerHTML = `
        <div style="display:flex;align-items:center;gap:6px;">
          ${svgIcons.stats}
          <span style="color:#00b4ff;font-size:11px;text-transform:uppercase;letter-spacing:1px;font-weight:600;">Profile Stats</span>
        </div>
        <div style="display:flex;align-items:center;gap:8px;">
          <div id="of-stats-alerts-btn" style="display:flex;align-items:center;justify-content:center;width:24px;height:24px;cursor:pointer;border-radius:6px;background:rgba(234,179,8,0.08);border:1px solid rgba(234,179,8,0.15);transition:all 0.2s;opacity:0.65;position:relative;" title="Smart Alerts">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#eab308" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
            <div id="of-stats-alerts-badge" style="display:none;position:absolute;top:-3px;right:-3px;width:14px;height:14px;border-radius:50%;background:#ef4444;color:#fff;font-size:8px;font-weight:700;line-height:14px;text-align:center;"></div>
          </div>
          <div id="of-stats-notes-btn" style="display:flex;align-items:center;justify-content:center;width:24px;height:24px;cursor:pointer;border-radius:6px;background:rgba(0,180,255,0.08);border:1px solid rgba(0,180,255,0.15);transition:all 0.2s;opacity:0.65;" title="Quick Notes">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#00b4ff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
          </div>
          <div id="of-stats-flip-btn" style="display:flex;align-items:center;gap:4px;cursor:pointer;user-select:none;opacity:0.65;transition:opacity 0.2s;padding:2px 6px;border-radius:6px;background:rgba(0,180,255,0.08);border:1px solid rgba(0,180,255,0.15);">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#00b4ff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M7 16V4m0 0L3 8m4-4l4 4M17 8v12m0 0l4-4m-4 4l-4-4"/></svg>
            <span style="color:#00b4ff;font-size:9px;font-weight:600;letter-spacing:0.5px;" id="of-flip-label">${t('details')}</span>
          </div>
          <button class="of-stats-close-btn" style="background:none;border:none;color:#64748b;cursor:pointer;font-size:18px;padding:0 2px;line-height:1;transition:color 0.2s;">&times;</button>
        </div>
      `;
      flipFront.appendChild(header);

      // ==================== QUICK NOTES PANEL (Feature #7) ====================
      var _notesUsername = (profileData.username || '').toLowerCase();
      var _notesTAG_COLORS = [
        { bg:'rgba(0,180,255,0.15)', border:'rgba(0,180,255,0.3)', color:'#00b4ff' },
        { bg:'rgba(34,197,94,0.15)', border:'rgba(34,197,94,0.3)', color:'#22c55e' },
        { bg:'rgba(239,68,68,0.15)', border:'rgba(239,68,68,0.3)', color:'#ef4444' },
        { bg:'rgba(234,179,8,0.15)', border:'rgba(234,179,8,0.3)', color:'#eab308' },
        { bg:'rgba(168,85,247,0.15)', border:'rgba(168,85,247,0.3)', color:'#a855f7' },
        { bg:'rgba(244,114,182,0.15)', border:'rgba(244,114,182,0.3)', color:'#f472b6' },
        { bg:'rgba(251,146,60,0.15)', border:'rgba(251,146,60,0.3)', color:'#fb923c' },
        { bg:'rgba(45,212,191,0.15)', border:'rgba(45,212,191,0.3)', color:'#2dd4bf' }
      ];
      function _notesTagStyle(ci) {
        var c = _notesTAG_COLORS[ci] || _notesTAG_COLORS[0];
        return 'background:'+c.bg+';border:1px solid '+c.border+';color:'+c.color+';';
      }
      function _notesLoadTags() {
        try { var d = localStorage.getItem('ofStatsTags'); return d ? JSON.parse(d) : []; } catch(e) { return []; }
      }
      function _notesSaveTags(tags) {
        localStorage.setItem('ofStatsTags', JSON.stringify(tags));
        // Sync tags to server (fire-and-forget)
        try {
          chrome.runtime.sendMessage({ action: 'syncNoteTags', tags: tags }, function(r) {
            if (r && r.success && r.tags) {
              // Update local tags with server IDs
              localStorage.setItem('ofStatsTags', JSON.stringify(r.tags));
            }
          });
        } catch(e) {}
      }
      function _notesLoadNote(username) {
        try { var d = localStorage.getItem('ofStatsNotes'); var all = d ? JSON.parse(d) : {}; return all[username] || { text: '', tags: [] }; } catch(e) { return { text: '', tags: [] }; }
      }
      function _notesSaveNote(username, note) {
        try { var d = localStorage.getItem('ofStatsNotes'); var all = d ? JSON.parse(d) : {}; all[username] = note; localStorage.setItem('ofStatsNotes', JSON.stringify(all)); } catch(e) {}
        // Sync single note to server
        try {
          chrome.runtime.sendMessage({
            action: 'saveNote',
            username: username,
            text: note.text || '',
            tags: note.tags || [],
            date: note.date || Date.now(),
            avatarUrl: _notesGetAvatar(username)
          }, function(r) {});
        } catch(e) {}
      }
      function _notesDeleteFromServer(username) {
        try {
          chrome.runtime.sendMessage({ action: 'deleteNote', username: username }, function(r) {});
        } catch(e) {}
      }
      // Save avatar URL for current model (called once on badge render)
      function _notesSaveAvatar(username, avatarUrl) {
        if (!username || !avatarUrl) return;
        try { var d = localStorage.getItem('ofStatsAvatars'); var all = d ? JSON.parse(d) : {}; all[username] = avatarUrl; localStorage.setItem('ofStatsAvatars', JSON.stringify(all)); } catch(e) {}
      }
      function _notesGetAvatar(username) {
        try { var d = localStorage.getItem('ofStatsAvatars'); var all = d ? JSON.parse(d) : {}; return all[username] || ''; } catch(e) { return ''; }
      }
      // Store current profile avatar
      if (profileData.avatar) _notesSaveAvatar(_notesUsername, profileData.avatar);
      function _notesLoadAllNotes() {
        try { var d = localStorage.getItem('ofStatsNotes'); return d ? JSON.parse(d) : {}; } catch(e) { return {}; }
      }

      // Sync notes & tags from server to local (called on panel open & page load)
      var _notesSyncedOnce = false;
      function _notesSyncFromServer(callback) {
        try {
          // Sync tags first, then notes
          chrome.runtime.sendMessage({ action: 'getNoteTags' }, function(tagResp) {
            if (tagResp && tagResp.success && Array.isArray(tagResp.tags)) {
              localStorage.setItem('ofStatsTags', JSON.stringify(tagResp.tags));
            }
            chrome.runtime.sendMessage({ action: 'getNotes' }, function(notesResp) {
              if (notesResp && notesResp.success) {
                if (notesResp.notes && typeof notesResp.notes === 'object') {
                  var serverNotes = notesResp.notes;
                  var localNotes = _notesLoadAllNotes();
                  // Merge: server wins, but keep local-only entries
                  var merged = {};
                  // Add all server notes
                  Object.keys(serverNotes).forEach(function(u) { merged[u] = serverNotes[u]; });
                  // Add local-only notes that don't exist on server
                  Object.keys(localNotes).forEach(function(u) {
                    if (!merged[u]) merged[u] = localNotes[u];
                  });
                  localStorage.setItem('ofStatsNotes', JSON.stringify(merged));
                }
                if (notesResp.avatars && typeof notesResp.avatars === 'object') {
                  var localAvatars = {};
                  try { localAvatars = JSON.parse(localStorage.getItem('ofStatsAvatars') || '{}'); } catch(e) {}
                  Object.keys(notesResp.avatars).forEach(function(u) { localAvatars[u] = notesResp.avatars[u]; });
                  localStorage.setItem('ofStatsAvatars', JSON.stringify(localAvatars));
                }
                _notesSyncedOnce = true;
              }
              if (callback) callback();
            });
          });
        } catch(e) {
          if (callback) callback();
        }
      }

      // Upload all local notes to server on first load (one-time migration)
      function _notesUploadLocalToServer() {
        var localNotes = _notesLoadAllNotes();
        var localAvatars = {};
        try { localAvatars = JSON.parse(localStorage.getItem('ofStatsAvatars') || '{}'); } catch(e) {}
        if (Object.keys(localNotes).length === 0) return;
        try {
          chrome.runtime.sendMessage({
            action: 'syncNotes',
            notes: localNotes,
            avatars: localAvatars
          }, function(r) {
            if (r && r.success) log('OF Stats: Local notes uploaded to server');
          });
        } catch(e) {}
        // Also sync tags
        var localTags = _notesLoadTags();
        if (localTags.length > 0) {
          try {
            chrome.runtime.sendMessage({ action: 'syncNoteTags', tags: localTags }, function(r) {
              if (r && r.success && r.tags) {
                localStorage.setItem('ofStatsTags', JSON.stringify(r.tags));
              }
            });
          } catch(e) {}
        }
      }

      // Initial sync: try to merge server data on page load
      (function() {
        var migrationKey = 'ofStatsNotesMigrated';
        if (!localStorage.getItem(migrationKey)) {
          // First time: upload local to server, then sync back
          _notesUploadLocalToServer();
          localStorage.setItem(migrationKey, '1');
        }
        _notesSyncFromServer(function() {
          _notesRenderStrip();
        });
      })();
      function _notesEsc(s) { var d=document.createElement('div'); d.appendChild(document.createTextNode(s)); return d.innerHTML; }

      // Inject notes panel styles
      if (!document.getElementById('of-stats-notes-styles')) {
        var nsEl = document.createElement('style');
        nsEl.id = 'of-stats-notes-styles';
        nsEl.textContent = [
          '#of-stats-tab-notes .nv-tabs{display:flex;gap:3px;background:rgba(0,0,0,0.25);border-radius:8px;padding:3px;margin-bottom:12px;}',
          '#of-stats-tab-notes .nv-tab{flex:1;padding:7px 0;text-align:center;font-size:10px;font-weight:600;color:#556677;cursor:pointer;border-radius:6px;transition:all 0.2s;}',
          '#of-stats-tab-notes .nv-tab:hover{color:#8899aa;}',
          '#of-stats-tab-notes .nv-tab.active{background:rgba(0,180,255,0.12);color:#00b4ff;}',
          '#of-stats-tab-notes .nv-view{display:none;}',
          '#of-stats-tab-notes .nv-view.active{display:block;}',
          '#of-stats-tab-notes .nv-editor-label{font-size:9px;color:#556677;margin-bottom:5px;display:flex;align-items:center;gap:4px;}',
          '#of-stats-tab-notes .nv-textarea{width:100%;min-height:100px;max-height:160px;padding:10px 12px;border-radius:10px;background:rgba(0,0,0,0.3) !important;border:1px solid #1e2d3d !important;color:#e0e6ef !important;font-size:11px;font-family:inherit;resize:vertical;outline:none;transition:border-color 0.2s;line-height:1.5;box-sizing:border-box;}',
          '#of-stats-tab-notes .nv-textarea:focus{border-color:rgba(0,180,255,0.4) !important;box-shadow:0 0 8px rgba(0,180,255,0.08);}',
          '#of-stats-tab-notes .nv-textarea::placeholder{color:#445566 !important;}',
          '#of-stats-tab-notes .nv-chips-label{font-size:8px;color:#556677;margin:8px 0 4px;text-transform:uppercase;letter-spacing:0.5px;}',
          '#of-stats-tab-notes .nv-chips{display:flex;flex-wrap:wrap;gap:5px;margin-top:10px;}',
          '#of-stats-tab-notes .nv-chip{font-size:9px;padding:5px 12px;border-radius:8px;font-weight:600;cursor:pointer;transition:all 0.2s;display:inline-flex;align-items:center;gap:3px;}',
          '#of-stats-tab-notes .nv-chip.assigned{opacity:1;}',
          '#of-stats-tab-notes .nv-chip.available{opacity:0.7;border-style:dashed !important;}',
          '#of-stats-tab-notes .nv-chip.available:hover{opacity:1;}',
          '#of-stats-tab-notes .nv-save-row{display:flex;align-items:center;justify-content:center;gap:12px;margin-top:14px;}',
          '#of-stats-tab-notes .nv-save-btn{padding:8px 28px;border-radius:8px;border:none;background:linear-gradient(135deg,#00b4ff,#7c3aed);color:#fff;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit;transition:all 0.3s;letter-spacing:0.3px;box-shadow:0 2px 10px rgba(0,180,255,0.2);flex:0 0 auto;position:relative;display:inline-flex;align-items:center;justify-content:center;}',
          '#of-stats-tab-notes .nv-save-btn:hover{box-shadow:0 2px 18px rgba(0,180,255,0.35);filter:brightness(1.1);}',
          '@keyframes nv-save-flash{0%{background:linear-gradient(135deg,#22c55e,#16a34a);box-shadow:0 0 18px rgba(34,197,94,0.4);}100%{background:linear-gradient(135deg,#22c55e,#16a34a);box-shadow:0 2px 10px rgba(34,197,94,0.2);}}',
          '#of-stats-tab-notes .nv-save-btn.saved{background:linear-gradient(135deg,#22c55e,#16a34a);color:#fff;animation:nv-save-flash 0.5s ease-out;}',
          '#of-stats-tab-notes .nv-save-btn.saved:hover{box-shadow:0 2px 14px rgba(34,197,94,0.3);}',
          '#of-stats-tab-notes .nv-save-btn .nv-save-check{position:absolute;left:0;right:0;text-align:center;opacity:0;transition:opacity 0.3s;}',
          '#of-stats-tab-notes .nv-save-btn.saved .nv-save-check{opacity:1;}',
          '#of-stats-tab-notes .nv-save-btn .nv-save-label{transition:opacity 0.3s;}',
          '#of-stats-tab-notes .nv-save-btn.saved .nv-save-label{opacity:0;}',
          '#of-stats-tab-notes .nv-search-input{width:100%;padding:7px 10px 7px 30px;border-radius:8px;background:rgba(0,0,0,0.3) !important;border:1px solid #1e2d3d !important;color:#e0e6ef !important;font-size:10px;font-family:inherit;outline:none;box-sizing:border-box;transition:border-color 0.2s;-webkit-text-fill-color:#e0e6ef !important;}',
          '#of-stats-tab-notes .nv-search-input:focus{border-color:rgba(0,180,255,0.4) !important;box-shadow:0 0 8px rgba(0,180,255,0.08);}',
          '#of-stats-tab-notes .nv-search-input::placeholder{color:#445566 !important;-webkit-text-fill-color:#445566 !important;font-style:italic;}',
          '#of-stats-tab-notes .nv-search-wrap{position:relative;margin-bottom:8px;}',
          '#of-stats-tab-notes .nv-search-icon{position:absolute;left:9px;top:50%;transform:translateY(-50%);pointer-events:none;color:#556677;}',
          '#of-stats-tab-notes .nv-delete-btn{padding:6px 12px;border-radius:8px;border:1px solid rgba(239,68,68,0.2);background:rgba(239,68,68,0.08);color:#ef4444;font-size:10px;font-weight:600;cursor:pointer;font-family:inherit;transition:all 0.2s;letter-spacing:0.3px;}',
          '#of-stats-tab-notes .nv-delete-btn:hover{background:rgba(239,68,68,0.18);border-color:rgba(239,68,68,0.4);box-shadow:0 0 10px rgba(239,68,68,0.15);}',
          '#of-stats-tab-notes .nv-saved-msg{font-size:9px;color:#22c55e;opacity:0;transition:opacity 0.3s;display:flex;align-items:center;gap:3px;}',
          '#of-stats-tab-notes .nv-saved-msg.show{opacity:1;}',
          '#of-stats-tab-notes .nv-tag-row{display:flex;align-items:center;gap:10px;padding:9px 10px;border-radius:8px;background:rgba(0,0,0,0.15);transition:background 0.15s;margin-bottom:5px;}',
          '#of-stats-tab-notes .nv-tag-row:hover{background:rgba(0,0,0,0.25);}',
          '#of-stats-tab-notes .nv-tag-dot{width:12px;height:12px;border-radius:50%;flex-shrink:0;}',
          '#of-stats-tab-notes .nv-tag-name{font-size:12px;color:#ccc;flex:1;font-weight:600;}',
          '#of-stats-tab-notes .nv-tag-count{font-size:9px;color:#556677;}',
          '#of-stats-tab-notes .nv-tag-del{width:20px;height:20px;border-radius:50%;background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.2);color:#ef4444;cursor:pointer;display:flex;align-items:center;justify-content:center;opacity:0;transition:all 0.15s;flex-shrink:0;}',
          '#of-stats-tab-notes .nv-tag-row:hover .nv-tag-del{opacity:1;}',
          '#of-stats-tab-notes .nv-tag-del:hover{background:rgba(239,68,68,0.25);}',
          '#of-stats-tab-notes .nv-create-row{display:flex;gap:6px;margin-top:10px;align-items:center;}',
          '#of-stats-tab-notes .nv-create-input{flex:1;padding:7px 10px;border-radius:8px;background:rgba(0,0,0,0.3) !important;border:1px solid #1e2d3d !important;color:#e0e6ef !important;-webkit-text-fill-color:#e0e6ef !important;font-size:11px;font-family:inherit;outline:none;min-width:0;box-sizing:border-box;transition:border-color 0.2s;}',
          '#of-stats-tab-notes .nv-create-input:focus{border-color:rgba(0,180,255,0.4) !important;box-shadow:0 0 8px rgba(0,180,255,0.08);}',
          '#of-stats-tab-notes .nv-create-input::placeholder{color:#445566 !important;-webkit-text-fill-color:#445566 !important;font-style:italic;}',
          '#of-stats-tab-notes .nv-create-label{font-size:10px;color:#556677;margin-bottom:6px;}',
          '#of-stats-tab-notes .nv-cdots{display:flex;gap:3px;align-items:center;}',
          '#of-stats-tab-notes .nv-cdot{width:12px;height:12px;border-radius:50%;cursor:pointer;border:2px solid transparent;transition:all 0.15s;}',
          '#of-stats-tab-notes .nv-cdot:hover{transform:scale(1.2);}',
          '#of-stats-tab-notes .nv-cdot.sel{border-color:#fff;box-shadow:0 0 6px rgba(255,255,255,0.2);}',
          '#of-stats-tab-notes .nv-create-add{padding:5px 10px;border-radius:8px;border:1px solid rgba(0,180,255,0.2);background:rgba(0,180,255,0.1);color:#00b4ff;font-size:10px;font-weight:600;cursor:pointer;font-family:inherit;transition:all 0.2s;}',
          '#of-stats-tab-notes .nv-create-add:hover{background:rgba(0,180,255,0.2);}',
          '#of-stats-tab-notes .nv-filter-row{display:flex;gap:4px;flex-wrap:wrap;margin-bottom:10px;}',
          '#of-stats-tab-notes .nv-filter-btn{font-size:8px;padding:4px 9px;border-radius:6px;font-weight:600;cursor:pointer;transition:all 0.15s;opacity:0.65;}',
          '#of-stats-tab-notes .nv-filter-btn.active{opacity:1;}',
          '#of-stats-tab-notes .nv-filter-btn:hover{opacity:0.8;}',
          '#of-stats-tab-notes .nv-filter-all{font-size:9px;padding:4px 10px;border-radius:6px;background:rgba(255,255,255,0.06);color:#8899aa;cursor:pointer;font-weight:600;border:1px solid rgba(255,255,255,0.08);transition:all 0.15s;}',
          '#of-stats-tab-notes .nv-filter-all.active{background:rgba(0,180,255,0.1);color:#00b4ff;border-color:rgba(0,180,255,0.2);}',
          '#of-stats-tab-notes .nv-model-row{display:flex;align-items:center;gap:10px;padding:10px 10px;border-radius:10px;cursor:pointer;transition:all 0.2s;border-bottom:1px solid rgba(255,255,255,0.03);}',
          '#of-stats-tab-notes .nv-model-row:last-child{border-bottom:none;}',
          '#of-stats-tab-notes .nv-model-row:hover{background:rgba(0,180,255,0.05);box-shadow:inset 0 0 0 1px rgba(0,180,255,0.08),0 0 12px rgba(0,180,255,0.04);}',
          '#of-stats-tab-notes .nv-model-ava{width:36px;height:36px;border-radius:50%;flex-shrink:0;background:linear-gradient(135deg,#1a2535,#0d1117);border:1.5px solid #1e2d3d;display:flex;align-items:center;justify-content:center;overflow:hidden;font-size:12px;color:#556677;transition:border-color 0.2s,box-shadow 0.2s;}',
          '#of-stats-tab-notes .nv-model-row:hover .nv-model-ava{border-color:rgba(0,180,255,0.4);box-shadow:0 0 8px rgba(0,180,255,0.15);}',
          '#of-stats-tab-notes .nv-model-ava img{width:100%;height:100%;object-fit:cover;border-radius:50%;}',
          '#of-stats-tab-notes .nv-model-info{flex:1;min-width:0;}',
          '#of-stats-tab-notes .nv-model-name{font-size:11px;font-weight:600;color:#fff;}',
          '#of-stats-tab-notes .nv-model-note{font-size:10px;color:#556677;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px;}',
          '#of-stats-tab-notes .nv-model-tags{display:flex;gap:3px;margin-top:4px;flex-wrap:wrap;}',
          '#of-stats-tab-notes .nv-mtag{font-size:8px;padding:2px 7px;border-radius:5px;font-weight:700;}',
          '#of-stats-tab-notes .nv-model-arrow{font-size:11px;color:#445566;flex-shrink:0;transition:color 0.15s;}',
          '#of-stats-tab-notes .nv-model-row:hover .nv-model-arrow{color:#00b4ff;}',
          '#of-stats-tab-notes .nv-empty{text-align:center;padding:16px;color:#445566;font-size:10px;}',
          '#of-stats-tab-notes .nv-models-scroll{max-height:350px;overflow-y:auto;}',
          '#of-stats-tab-notes .nv-models-scroll::-webkit-scrollbar{width:3px;}',
          '#of-stats-tab-notes .nv-models-scroll::-webkit-scrollbar-track{background:transparent;}',
          '#of-stats-tab-notes .nv-models-scroll::-webkit-scrollbar-thumb{background:#1e2d3d;border-radius:2px;}',
          '#of-stats-tab-notes .nv-sep{height:1px;background:#1a2535;margin:10px 0;}',
          '@keyframes ofAlertSlide{from{opacity:0;transform:translateX(-10px);}to{opacity:1;transform:translateX(0);}}',
        ].join('\n');
        document.head.appendChild(nsEl);
      }

      var _notesSelColor = 0;
      var _notesFilterTag = null;
      var _notesActiveView = 'editor';
      var _notesDraftText = '';
      var _notesDraftTagName = '';
      var _notesSearchQuery = '';

      // Build notes tab content
      function _notesRebuildPanel() {
        var notesContainer = document.getElementById('of-stats-tab-notes');
        if (!notesContainer) return;
        var tags = _notesLoadTags();
        var note = _notesLoadNote(_notesUsername);
        notesContainer.innerHTML = '';
        var inner = document.createElement('div');

        // Sub-view tabs
        var viewTabs = document.createElement('div');
        viewTabs.className = 'nv-tabs';
        [{ k:'editor', label: t('notesTab') }, { k:'tags', label: t('notesTagsTab') }, { k:'models', label: t('notesModelsTab') }].forEach(function(vt) {
          var tab = document.createElement('div');
          tab.className = 'nv-tab' + (_notesActiveView === vt.k ? ' active' : '');
          tab.textContent = vt.label;
          tab.onclick = function() { _notesActiveView = vt.k; _notesRebuildPanel(); };
          viewTabs.appendChild(tab);
        });
        inner.appendChild(viewTabs);

        // === View: Editor ===
        if (_notesActiveView === 'editor') {
          // Show which model is being edited
          var editorHeader = document.createElement('div');
          editorHeader.style.cssText = 'display:flex;align-items:center;gap:10px;margin-bottom:10px;';
          var profileLink = 'https://onlyfans.com/' + _notesUsername;
          var editorAvaUrl = _notesGetAvatar(_notesUsername);
          if (editorAvaUrl) {
            var editorAva = document.createElement('img');
            editorAva.src = editorAvaUrl;
            editorAva.style.cssText = 'width:36px;height:36px;border-radius:50%;object-fit:cover;border:1.5px solid #1e2d3d;flex-shrink:0;cursor:pointer;transition:border-color 0.2s;';
            editorAva.title = 'Open profile';
            editorAva.onmouseenter = function() { this.style.borderColor='rgba(0,180,255,0.5)'; };
            editorAva.onmouseleave = function() { this.style.borderColor='#1e2d3d'; };
            editorAva.onclick = function(e) { e.stopPropagation(); window.open(profileLink, '_blank'); };
            editorAva.onerror = function() { this.style.display='none'; };
            editorHeader.appendChild(editorAva);
          }
          var editorLabel = document.createElement('span');
          editorLabel.style.cssText = 'font-size:13px;color:#cdd6e0;font-weight:700;cursor:pointer;transition:color 0.2s;';
          editorLabel.textContent = '@' + _notesUsername;
          editorLabel.title = 'Open profile';
          editorLabel.onmouseenter = function() { this.style.color='#00b4ff'; };
          editorLabel.onmouseleave = function() { this.style.color='#cdd6e0'; };
          editorLabel.onclick = function(e) { e.stopPropagation(); window.open(profileLink, '_blank'); };
          editorHeader.appendChild(editorLabel);
          // Rating on the right
          if (typeof scoreResult !== 'undefined' && scoreResult.grade) {
            var editorSpacer = document.createElement('div');
            editorSpacer.style.cssText = 'flex:1;';
            editorHeader.appendChild(editorSpacer);
            var editorRating = document.createElement('div');
            editorRating.style.cssText = 'display:flex;align-items:center;gap:5px;flex-shrink:0;';
            var rScore = document.createElement('span');
            rScore.style.cssText = 'font-size:15px;font-weight:800;color:' + scoreResult.gradeColor + ';';
            rScore.textContent = scoreResult.score;
            editorRating.appendChild(rScore);
            var rGrade = document.createElement('span');
            rGrade.style.cssText = 'font-size:12px;font-weight:700;color:' + scoreResult.gradeColor + ';opacity:0.8;';
            rGrade.textContent = scoreResult.grade;
            editorRating.appendChild(rGrade);
            editorHeader.appendChild(editorRating);
          }
          inner.appendChild(editorHeader);

          var textarea = document.createElement('textarea');
          textarea.className = 'nv-textarea';
          textarea.placeholder = t('notesPlaceholder');
          textarea.value = _notesDraftText || note.text;
          textarea.id = 'of-notes-textarea';
          textarea.addEventListener('input', function() { _notesDraftText = this.value; });
          inner.appendChild(textarea);

          var chipsRow = document.createElement('div');
          chipsRow.className = 'nv-chips';
          // Helper: capture current textarea text before any rebuild
          function _notesCaptureText(n) {
            var ta = document.getElementById('of-notes-textarea');
            if (ta) { n.text = ta.value; _notesDraftText = ta.value; }
          }
          // assigned
          (note.tags || []).forEach(function(tid) {
            var tag = tags.find(function(tg){return tg.id===tid;});
            if (!tag) return;
            var chip = document.createElement('div');
            chip.className = 'nv-chip assigned';
            chip.style.cssText = _notesTagStyle(tag.ci);
            chip.textContent = tag.name;
            chip.title = 'Click to remove';
            chip.onclick = function() {
              _notesCaptureText(note);
              note.tags = note.tags.filter(function(id){return id!==tid;});
              _notesSaveNote(_notesUsername, note);
              _notesRebuildPanel();
            };
            chipsRow.appendChild(chip);
          });
          // available
          tags.filter(function(tg){ return (note.tags||[]).indexOf(tg.id)===-1; }).forEach(function(tag) {
            var chip = document.createElement('div');
            chip.className = 'nv-chip available';
            chip.style.cssText = _notesTagStyle(tag.ci);
            chip.textContent = '+ ' + tag.name;
            chip.onclick = function() {
              _notesCaptureText(note);
              if (!note.tags) note.tags = [];
              note.tags.push(tag.id);
              _notesSaveNote(_notesUsername, note);
              _notesRebuildPanel();
            };
            chipsRow.appendChild(chip);
          });
          inner.appendChild(chipsRow);

          var saveRow = document.createElement('div');
          saveRow.className = 'nv-save-row';
          var saveBtn = document.createElement('button');
          saveBtn.className = 'nv-save-btn';
          saveBtn.innerHTML = '<span class="nv-save-label">' + t('notesSave') + '</span><span class="nv-save-check">\u2713 ' + t('notesSaved') + '</span>';
          saveBtn.onclick = function() {
            var ta = document.getElementById('of-notes-textarea');
            note.text = ta ? ta.value.trim() : '';
            note.date = Date.now();
            _notesSaveNote(_notesUsername, note);
            _notesDraftText = '';
            _notesRenderStrip();
            saveBtn.classList.add('saved');
            setTimeout(function(){ saveBtn.classList.remove('saved'); }, 2000);
          };
          saveRow.appendChild(saveBtn);
          // Delete button — clears note text and tags for this model
          var deleteBtn = document.createElement('button');
          deleteBtn.className = 'nv-delete-btn';
          deleteBtn.innerHTML = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';
          deleteBtn.title = 'Delete note';
          deleteBtn.onclick = function() {
            var allNotes3 = _notesLoadAllNotes();
            delete allNotes3[_notesUsername];
            try { localStorage.setItem('ofStatsNotes', JSON.stringify(allNotes3)); } catch(e) {}
            _notesDeleteFromServer(_notesUsername);
            _notesDraftText = '';
            _notesRenderStrip();
            _notesClosePanel();
          };
          saveRow.appendChild(deleteBtn);
          inner.appendChild(saveRow);
        }

        // === View: Tags Manager ===
        if (_notesActiveView === 'tags') {
          var allNotes = _notesLoadAllNotes();
          tags.forEach(function(tag) {
            var count = 0;
            Object.keys(allNotes).forEach(function(u) { if ((allNotes[u].tags||[]).indexOf(tag.id)!==-1) count++; });
            var row = document.createElement('div');
            row.className = 'nv-tag-row';
            var dot = document.createElement('div');
            dot.className = 'nv-tag-dot';
            dot.style.background = _notesTAG_COLORS[tag.ci].color;
            row.appendChild(dot);
            var nm = document.createElement('div');
            nm.className = 'nv-tag-name';
            nm.textContent = tag.name;
            row.appendChild(nm);
            var cnt = document.createElement('div');
            cnt.className = 'nv-tag-count';
            cnt.textContent = count + ' ' + (count===1 ? t('notesModel') : t('notesModels'));
            row.appendChild(cnt);
            var del = document.createElement('div');
            del.className = 'nv-tag-del';
            del.innerHTML = '<svg width="8" height="8" viewBox="0 0 10 10"><line x1="1" y1="1" x2="9" y2="9" stroke="#ef4444" stroke-width="1.8" stroke-linecap="round"/><line x1="9" y1="1" x2="1" y2="9" stroke="#ef4444" stroke-width="1.8" stroke-linecap="round"/></svg>';
            del.onclick = function() {
              var newTags = tags.filter(function(tg){return tg.id!==tag.id;});
              _notesSaveTags(newTags);
              // Remove from all notes
              Object.keys(allNotes).forEach(function(u) {
                if (allNotes[u].tags) allNotes[u].tags = allNotes[u].tags.filter(function(id){return id!==tag.id;});
              });
              localStorage.setItem('ofStatsNotes', JSON.stringify(allNotes));
              _notesRebuildPanel();
            };
            row.appendChild(del);
            inner.appendChild(row);
          });

          var sep = document.createElement('div');
          sep.className = 'nv-sep';
          inner.appendChild(sep);

          var createLabel = document.createElement('div');
          createLabel.style.cssText = 'font-size:9px;color:#556677;margin-bottom:4px;';
          createLabel.textContent = t('notesCreateTag');
          inner.appendChild(createLabel);

          var createRow = document.createElement('div');
          createRow.className = 'nv-create-row';
          var cInput = document.createElement('input');
          cInput.type = 'text';
          cInput.className = 'nv-create-input';
          cInput.placeholder = t('notesTagName');
          cInput.maxLength = 16;
          cInput.style.cssText = 'color:#e0e6ef !important;background:rgba(0,0,0,0.3) !important;border:1px solid #1e2d3d !important;-webkit-text-fill-color:#e0e6ef !important;';
          if (_notesDraftTagName) cInput.value = _notesDraftTagName;
          createRow.appendChild(cInput);
          cInput.addEventListener('input', function() { _notesDraftTagName = this.value; });
          var cDots = document.createElement('div');
          cDots.className = 'nv-cdots';
          _notesTAG_COLORS.forEach(function(c,i) {
            var d = document.createElement('div');
            d.className = 'nv-cdot' + (i===_notesSelColor?' sel':'');
            d.style.background = c.color;
            d.onclick = function() {
              // Preserve tag name input before rebuild
              var ci2 = badge.querySelector('.nv-create-input');
              if (ci2) _notesDraftTagName = ci2.value;
              _notesSelColor = i;
              _notesRebuildPanel();
            };
            cDots.appendChild(d);
          });
          createRow.appendChild(cDots);
          var cAdd = document.createElement('button');
          cAdd.className = 'nv-create-add';
          cAdd.textContent = '+';
          cAdd.onclick = function() {
            var name = cInput.value.trim();
            if (!name || name.length > 16) return;
            if (tags.some(function(tg){ return tg.name.toLowerCase()===name.toLowerCase(); })) return;
            var maxId = tags.reduce(function(m,tg){return Math.max(m,tg.id);},0);
            tags.push({ id: maxId+1, name: name, ci: _notesSelColor });
            _notesSaveTags(tags);
            _notesDraftTagName = '';
            _notesRebuildPanel();
          };
          createRow.appendChild(cAdd);
          inner.appendChild(createRow);

          cInput.addEventListener('keydown', function(e) { if (e.key==='Enter') cAdd.click(); });
        }

        // === View: Models List ===
        if (_notesActiveView === 'models') {
          var allNotes2 = _notesLoadAllNotes();
          var tags2 = _notesLoadTags();

          // Search bar
          var searchWrap = document.createElement('div');
          searchWrap.className = 'nv-search-wrap';
          var searchIcon = document.createElement('div');
          searchIcon.className = 'nv-search-icon';
          searchIcon.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';
          searchWrap.appendChild(searchIcon);
          var searchInput = document.createElement('input');
          searchInput.className = 'nv-search-input';
          searchInput.type = 'text';
          searchInput.placeholder = 'Search models...';
          searchInput.value = _notesSearchQuery;
          searchInput.style.cssText += '-webkit-text-fill-color:#e0e6ef !important;';
          searchInput.addEventListener('input', function() { _notesSearchQuery = this.value; _notesRebuildPanel(); });
          searchWrap.appendChild(searchInput);
          inner.appendChild(searchWrap);

          // Filter bar
          var filterRow = document.createElement('div');
          filterRow.className = 'nv-filter-row';
          var allBtn = document.createElement('div');
          allBtn.className = 'nv-filter-all' + (_notesFilterTag===null?' active':'');
          allBtn.textContent = t('notesAll');
          allBtn.onclick = function() { _notesFilterTag = null; _notesRebuildPanel(); };
          filterRow.appendChild(allBtn);
          tags2.forEach(function(tag) {
            var fb = document.createElement('div');
            fb.className = 'nv-filter-btn' + (_notesFilterTag===tag.id?' active':'');
            fb.style.cssText = _notesTagStyle(tag.ci);
            fb.textContent = tag.name;
            fb.onclick = function() { _notesFilterTag = (_notesFilterTag===tag.id?null:tag.id); _notesRebuildPanel(); };
            filterRow.appendChild(fb);
          });
          inner.appendChild(filterRow);

          var scrollDiv = document.createElement('div');
          scrollDiv.className = 'nv-models-scroll';
          var usernames = Object.keys(allNotes2);
          if (_notesFilterTag !== null) {
            usernames = usernames.filter(function(u) { return (allNotes2[u].tags||[]).indexOf(_notesFilterTag)!==-1; });
          }
          if (_notesSearchQuery) {
            var sq = _notesSearchQuery.toLowerCase();
            usernames = usernames.filter(function(u) {
              if (u.toLowerCase().indexOf(sq) !== -1) return true;
              var mn2 = allNotes2[u];
              if (mn2.text && mn2.text.toLowerCase().indexOf(sq) !== -1) return true;
              if (mn2.tags && mn2.tags.length > 0) {
                return mn2.tags.some(function(tid) {
                  var tg2 = tags2.find(function(t3){return t3.id===tid;});
                  return tg2 && tg2.name.toLowerCase().indexOf(sq) !== -1;
                });
              }
              return false;
            });
          }
          if (usernames.length === 0) {
            scrollDiv.innerHTML = '<div class="nv-empty">' + t('notesNoModels') + '</div>';
          } else {
            usernames.forEach(function(u) {
              var mn = allNotes2[u];
              var row = document.createElement('div');
              row.className = 'nv-model-row';
              row.onclick = function() { _notesUsername = u; _notesActiveView = 'editor'; _notesRebuildPanel(); _notesRenderStrip(); };
              // Avatar
              var ava = document.createElement('div');
              ava.className = 'nv-model-ava';
              var savedAva = _notesGetAvatar(u);
              if (savedAva) {
                var avaImg = document.createElement('img');
                avaImg.src = savedAva;
                avaImg.onerror = function() { this.parentNode.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#556677" stroke-width="1.5"><circle cx="12" cy="8" r="4"/><path d="M20 21a8 8 0 1 0-16 0"/></svg>'; };
                ava.appendChild(avaImg);
              } else {
                ava.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#556677" stroke-width="1.5"><circle cx="12" cy="8" r="4"/><path d="M20 21a8 8 0 1 0-16 0"/></svg>';
              }
              row.appendChild(ava);
              var info = document.createElement('div');
              info.className = 'nv-model-info';
              info.innerHTML = '<div class="nv-model-name">@' + _notesEsc(u) + '</div>' + (mn.text ? '<div class="nv-model-note">' + _notesEsc(mn.text) + '</div>' : '');
              if ((mn.tags||[]).length > 0) {
                var mTags = document.createElement('div');
                mTags.className = 'nv-model-tags';
                (mn.tags||[]).forEach(function(tid) {
                  var tg = tags2.find(function(t2){return t2.id===tid;});
                  if (!tg) return;
                  var mt = document.createElement('span');
                  mt.className = 'nv-mtag';
                  mt.style.cssText = _notesTagStyle(tg.ci);
                  mt.textContent = tg.name;
                  mTags.appendChild(mt);
                });
                info.appendChild(mTags);
              }
              row.appendChild(info);
              // Delete button for model note
              var delModel = document.createElement('div');
              delModel.style.cssText = 'display:flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:50%;cursor:pointer;flex-shrink:0;opacity:0;transition:all 0.2s;background:rgba(239,68,68,0.08);';
              delModel.innerHTML = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';
              delModel.title = 'Delete note';
              delModel.onclick = function(e) {
                e.stopPropagation();
                // Confirmation overlay on the row
                var existingOv = row.querySelector('.nv-del-confirm');
                if (existingOv) { existingOv.remove(); return; }
                var ov = document.createElement('div');
                ov.className = 'nv-del-confirm';
                ov.style.cssText = 'position:absolute;top:0;left:0;right:0;bottom:0;background:rgba(13,17,23,0.95);border-radius:10px;display:flex;align-items:center;justify-content:center;gap:8px;z-index:10;';
                ov.innerHTML = '<span style="font-size:9px;color:#ef4444;font-weight:600;">Delete note?</span>';
                var yBtn = document.createElement('button');
                yBtn.style.cssText = 'padding:3px 12px;border-radius:6px;border:1px solid rgba(239,68,68,0.3);background:rgba(239,68,68,0.15);color:#ef4444;font-size:9px;font-weight:700;cursor:pointer;font-family:inherit;';
                yBtn.textContent = 'Yes';
                yBtn.onclick = function(ev) {
                  ev.stopPropagation();
                  var allNotes4 = _notesLoadAllNotes();
                  delete allNotes4[u];
                  try { localStorage.setItem('ofStatsNotes', JSON.stringify(allNotes4)); } catch(ex) {}
                  _notesDeleteFromServer(u);
                  _notesRenderStrip();
                  _notesRebuildPanel();
                };
                var nBtn = document.createElement('button');
                nBtn.style.cssText = 'padding:3px 12px;border-radius:6px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.05);color:#8899aa;font-size:9px;font-weight:700;cursor:pointer;font-family:inherit;';
                nBtn.textContent = 'No';
                nBtn.onclick = function(ev) { ev.stopPropagation(); ov.remove(); };
                ov.appendChild(yBtn);
                ov.appendChild(nBtn);
                row.style.position = 'relative';
                row.appendChild(ov);
              };
              delModel.onmouseenter = function() { this.style.background = 'rgba(239,68,68,0.2)'; };
              delModel.onmouseleave = function() { this.style.background = 'rgba(239,68,68,0.08)'; };
              row.appendChild(delModel);
              var arrow = document.createElement('div');
              arrow.className = 'nv-model-arrow';
              arrow.textContent = '\u203A';
              row.appendChild(arrow);
              // Show delete on row hover
              row.addEventListener('mouseenter', function() { delModel.style.opacity = '1'; });
              row.addEventListener('mouseleave', function() { delModel.style.opacity = '0'; });
              scrollDiv.appendChild(row);
            });
          }
          inner.appendChild(scrollDiv);
        }

        notesContainer.appendChild(inner);
        // Re-focus search input after rebuild to maintain cursor position
        if (_notesActiveView === 'models' && _notesSearchQuery) {
          var si = notesContainer.querySelector('.nv-search-input');
          if (si) { si.focus(); si.setSelectionRange(si.value.length, si.value.length); }
        }
      }

      // ==================== SMART ALERTS (Feature #8) ====================
      // Storage helpers (local cache)
      function _alertsLoadAll() { try { return JSON.parse(localStorage.getItem('ofStatsAlerts') || '[]'); } catch(e) { return []; } }
      function _alertsSave(arr) { try { localStorage.setItem('ofStatsAlerts', JSON.stringify(arr)); } catch(e) {} }
      function _alertsLoadSnap(u) { try { var s = JSON.parse(localStorage.getItem('ofStatsSnapshots') || '{}'); return s[u] || null; } catch(e) { return null; } }
      function _alertsSaveSnap(u, snap) { try { var s = JSON.parse(localStorage.getItem('ofStatsSnapshots') || '{}'); s[u] = snap; localStorage.setItem('ofStatsSnapshots', JSON.stringify(s)); } catch(e) {} }
      function _alertsGetUnread(username) {
        var alerts = _alertsLoadAll();
        var readSet = {};
        try { readSet = JSON.parse(localStorage.getItem('ofStatsAlertsRead') || '{}'); } catch(e) {}
        return alerts.filter(function(a) { return a.username === username && !readSet[a.id]; });
      }
      function _alertsMarkRead(username) {
        var alerts = _alertsLoadAll();
        var readSet = {};
        try { readSet = JSON.parse(localStorage.getItem('ofStatsAlertsRead') || '{}'); } catch(e) {}
        alerts.forEach(function(a) { if (a.username === username) readSet[a.id] = true; });
        try { localStorage.setItem('ofStatsAlertsRead', JSON.stringify(readSet)); } catch(e) {}
      }

      // Server sync: send new alerts to backend (global for all users)
      function _alertsSendToServer(username, newAlerts) {
        if (!newAlerts || newAlerts.length === 0) return;
        try {
          chrome.runtime.sendMessage({
            action: 'reportAlerts',
            username: username,
            alerts: newAlerts
          }, function(resp) {
            if (resp && resp.success) log('OF Stats: Alerts reported to server:', resp.inserted);
          });
        } catch(e) { log('OF Stats: Could not report alerts to server:', e); }
      }

      // Server sync: fetch alerts from server for a model
      var _alertsServerCache = {};
      function _alertsFetchFromServer(username, callback) {
        try {
          chrome.runtime.sendMessage({ action: 'getAlerts', username: username }, function(resp) {
            if (resp && resp.success && Array.isArray(resp.alerts)) {
              _alertsServerCache[username] = resp.alerts;
              // Merge server alerts into local storage
              var local = _alertsLoadAll();
              var localIds = {};
              local.forEach(function(a) { localIds[a.id] = true; });
              var merged = false;
              resp.alerts.forEach(function(a) {
                if (!localIds[a.id]) {
                  local.unshift(a);
                  merged = true;
                }
              });
              if (merged) {
                local.sort(function(a,b) { return (b.date||0) - (a.date||0); });
                if (local.length > 100) local = local.slice(0, 100);
                _alertsSave(local);
              }
              if (callback) callback(resp.alerts);
            } else {
              if (callback) callback(null);
            }
          });
        } catch(e) {
          if (callback) callback(null);
        }
      }

      // Detect anomalies for current model
      function _alertsDetect(username, profileData, scoreResult) {
        var snap = _alertsLoadSnap(username);
        var now = Date.now();
        var todayStr = new Date().toISOString().slice(0, 10);
        var newSnap = {
          fans: profileData.subscribersCount || 0,
          likes: profileData.favoritedCount || 0,
          posts: profileData.postsCount || 0,
          score: scoreResult ? scoreResult.score : 0,
          grade: scoreResult ? scoreResult.grade : '',
          date: todayStr,
          ts: now
        };

        if (!snap || snap.date === todayStr) {
          // First visit or already checked today — just save snapshot
          _alertsSaveSnap(username, newSnap);
          return;
        }

        var alerts = _alertsLoadAll();
        var newAlerts = [];
        var daysDiff = Math.max(1, Math.round((now - snap.ts) / 86400000));

        // Fans change detection
        if (snap.fans > 0 && newSnap.fans > 0) {
          var fansDiff = newSnap.fans - snap.fans;
          var fansPct = (fansDiff / snap.fans * 100);
          if (fansPct >= 3 || fansDiff >= 500) {
            newAlerts.push({
              id: username + '_fans_surge_' + todayStr,
              username: username,
              type: 'fans_surge',
              icon: '📈',
              color: '#22c55e',
              diff: '+' + fansDiff.toLocaleString(),
              pct: '+' + fansPct.toFixed(1) + '%',
              date: now
            });
          } else if (fansPct <= -3 || fansDiff <= -500) {
            newAlerts.push({
              id: username + '_fans_drop_' + todayStr,
              username: username,
              type: 'fans_drop',
              icon: '🚨',
              color: '#ef4444',
              diff: fansDiff.toLocaleString(),
              pct: fansPct.toFixed(1) + '%',
              date: now
            });
          }
        }

        // Likes anomaly detection
        if (snap.likes > 0 && newSnap.likes > 0) {
          var likesDiff = newSnap.likes - snap.likes;
          var likesPct = (likesDiff / snap.likes * 100);
          if (likesPct >= 10 || likesDiff >= 10000) {
            newAlerts.push({
              id: username + '_likes_surge_' + todayStr,
              username: username,
              type: 'likes_surge',
              icon: '⚡',
              color: '#eab308',
              diff: '+' + likesDiff.toLocaleString(),
              pct: '+' + likesPct.toFixed(1) + '%',
              date: now
            });
          } else if (likesPct <= -5 || likesDiff <= -5000) {
            newAlerts.push({
              id: username + '_likes_drop_' + todayStr,
              username: username,
              type: 'likes_drop',
              icon: '⚠️',
              color: '#eab308',
              diff: likesDiff.toLocaleString(),
              pct: likesPct.toFixed(1) + '%',
              date: now
            });
          }
        }

        // Score change detection
        if (snap.score > 0 && newSnap.score > 0) {
          var scoreDiff = newSnap.score - snap.score;
          if (scoreDiff >= 5) {
            newAlerts.push({
              id: username + '_score_up_' + todayStr,
              username: username,
              type: 'score_up',
              icon: '🏆',
              color: '#22c55e',
              diff: '+' + scoreDiff,
              oldScore: snap.score,
              newScore: newSnap.score,
              oldGrade: snap.grade,
              newGrade: newSnap.grade,
              date: now
            });
          } else if (scoreDiff <= -5) {
            newAlerts.push({
              id: username + '_score_down_' + todayStr,
              username: username,
              type: 'score_down',
              icon: '📉',
              color: '#ef4444',
              diff: String(scoreDiff),
              oldScore: snap.score,
              newScore: newSnap.score,
              oldGrade: snap.grade,
              newGrade: newSnap.grade,
              date: now
            });
          }
        }

        // Add new alerts (deduplicate by id)
        var existingIds = {};
        alerts.forEach(function(a) { existingIds[a.id] = true; });
        var trulyNew = [];
        newAlerts.forEach(function(a) {
          if (!existingIds[a.id]) {
            alerts.unshift(a);
            trulyNew.push(a);
          }
        });

        // Keep max 100 alerts, trim old ones
        if (alerts.length > 100) alerts = alerts.slice(0, 100);
        _alertsSave(alerts);
        _alertsSaveSnap(username, newSnap);

        // Sync new alerts to server (global)
        _alertsSendToServer(username, trulyNew);
      }

      // Alert text builder
      function _alertText(a) {
        var u = '@' + a.username;
        switch(a.type) {
          case 'fans_surge': return u + ' ' + t('alertFansSurge') + ' <strong style="color:' + a.color + ';">' + a.diff + ' ' + t('alertFans') + '</strong> (' + a.pct + ')';
          case 'fans_drop': return u + ' ' + t('alertFansDrop') + ' <strong style="color:' + a.color + ';">' + a.diff + ' ' + t('alertFans') + '</strong> (' + a.pct + ')';
          case 'likes_surge': return u + ' ' + t('alertLikesSurge') + ' <strong style="color:' + a.color + ';">' + a.diff + ' ' + t('alertLikes') + '</strong> (' + a.pct + ')';
          case 'likes_drop': return u + ' ' + t('alertLikesDrop') + ' <strong style="color:' + a.color + ';">' + a.diff + ' ' + t('alertLikes') + '</strong> (' + a.pct + ')';
          case 'score_up': return u + ' — ' + t('alertScoreUp') + ' <strong style="color:' + a.color + ';">' + a.oldScore + ' → ' + a.newScore + '</strong> (' + a.oldGrade + ' → ' + a.newGrade + ')';
          case 'score_down': return u + ' — ' + t('alertScoreDown') + ' <strong style="color:' + a.color + ';">' + a.oldScore + ' → ' + a.newScore + '</strong> (' + a.oldGrade + ' → ' + a.newGrade + ')';
          default: return u;
        }
      }

      // Build alerts panel content
      function _alertsRebuildPanel() {
        var container = document.getElementById('of-stats-tab-alerts');
        if (!container) return;
        container.innerHTML = '';
        var alerts = _alertsLoadAll();
        var modelAlerts = alerts.filter(function(a) { return a.username === _notesUsername; });

        if (modelAlerts.length === 0) {
          container.innerHTML = '<div style="text-align:center;padding:20px;color:#445566;font-size:11px;">' + t('alertsEmpty') + '</div>';
          return;
        }

        var scroll = document.createElement('div');
        scroll.style.cssText = 'max-height:380px;overflow-y:auto;';
        scroll.className = 'nv-models-scroll';

        modelAlerts.forEach(function(a) {
          var item = document.createElement('div');
          var bgColor = a.color === '#ef4444' ? 'rgba(239,68,68,0.06)' : a.color === '#eab308' ? 'rgba(234,179,8,0.06)' : 'rgba(34,197,94,0.06)';
          var borderColor = a.color === '#ef4444' ? 'rgba(239,68,68,0.15)' : a.color === '#eab308' ? 'rgba(234,179,8,0.15)' : 'rgba(34,197,94,0.15)';
          item.style.cssText = 'display:flex;align-items:flex-start;gap:10px;padding:10px;border-radius:8px;margin-bottom:6px;background:' + bgColor + ';border:1px solid ' + borderColor + ';animation:ofAlertSlide 0.4s ease;';
          var iconEl = document.createElement('div');
          iconEl.style.cssText = 'font-size:16px;flex-shrink:0;line-height:1;padding-top:1px;';
          iconEl.textContent = a.icon;
          item.appendChild(iconEl);
          var textWrap = document.createElement('div');
          textWrap.style.cssText = 'flex:1;min-width:0;';
          var textEl = document.createElement('div');
          textEl.style.cssText = 'font-size:11px;color:#ccc;line-height:1.5;';
          textEl.innerHTML = _alertText(a);
          textWrap.appendChild(textEl);
          var timeEl = document.createElement('div');
          timeEl.style.cssText = 'font-size:9px;color:#556677;margin-top:3px;';
          var nd = new Date(a.date);
          var dd = ('0'+nd.getDate()).slice(-2), mm = ('0'+(nd.getMonth()+1)).slice(-2), yy = String(nd.getFullYear()).slice(-2);
          timeEl.textContent = dd + '.' + mm + '.' + yy;
          textWrap.appendChild(timeEl);
          item.appendChild(textWrap);
          scroll.appendChild(item);
        });

        container.appendChild(scroll);

        // Clear all button
        if (modelAlerts.length > 1) {
          var clearRow = document.createElement('div');
          clearRow.style.cssText = 'text-align:center;margin-top:8px;';
          var clearBtn = document.createElement('button');
          clearBtn.style.cssText = 'padding:5px 16px;border-radius:6px;border:1px solid rgba(239,68,68,0.2);background:rgba(239,68,68,0.06);color:#ef4444;font-size:9px;font-weight:600;cursor:pointer;font-family:inherit;transition:all 0.2s;';
          clearBtn.textContent = t('alertsClearAll');
          clearBtn.onmouseenter = function() { this.style.background='rgba(239,68,68,0.15)'; };
          clearBtn.onmouseleave = function() { this.style.background='rgba(239,68,68,0.06)'; };
          clearBtn.onclick = function() {
            var allAlerts = _alertsLoadAll();
            allAlerts = allAlerts.filter(function(a) { return a.username !== _notesUsername; });
            _alertsSave(allAlerts);
            _alertsRebuildPanel();
            _alertsUpdateBadge();
          };
          clearRow.appendChild(clearBtn);
          container.appendChild(clearRow);
        }
      }

      // Update bell badge counter
      function _alertsUpdateBadge() {
        var badgeEl = document.getElementById('of-stats-alerts-badge');
        if (!badgeEl) return;
        var unread = _alertsGetUnread(_notesUsername);
        if (unread.length > 0) {
          badgeEl.style.display = '';
          badgeEl.textContent = unread.length > 9 ? '9+' : String(unread.length);
        } else {
          badgeEl.style.display = 'none';
        }
      }

      // Open alerts panel
      function _alertsOpenPanel() {
        _alertsMarkRead(_notesUsername);
        _alertsUpdateBadge();
        var badgeHeight = flipInner.offsetHeight || flipFront.scrollHeight;
        flipInner.style.display = 'none';
        // Hide notes panel if open
        var np = badge.querySelector('#of-stats-notes-panel');
        if (np) np.style.display = 'none';
        var ap = badge.querySelector('#of-stats-alerts-panel');
        if (ap) {
          ap.style.display = '';
          ap.style.minHeight = badgeHeight + 'px';
          // Show local data immediately, then refresh from server
          _alertsRebuildPanel();
          _alertsFetchFromServer(_notesUsername, function() {
            _alertsRebuildPanel();
            _alertsUpdateBadge();
          });
        }
      }

      // Close alerts panel
      function _alertsClosePanel() {
        var ap = badge.querySelector('#of-stats-alerts-panel');
        if (ap) ap.style.display = 'none';
        flipInner.style.display = '';
        flipInner.classList.remove('flipped');
        flipInner.style.minHeight = flipFront.scrollHeight + 'px';
      }

      // Init badge count (deferred — see after scoreResult)

      // Mini note strip renderer (shown on badge front)
      var noteStripEl = document.createElement('div');
      noteStripEl.id = 'of-notes-strip';
      noteStripEl.style.cssText = 'display:none;padding:6px 10px;border-radius:7px;background:rgba(0,180,255,0.03);border:1px solid rgba(0,180,255,0.08);cursor:pointer;transition:all 0.3s ease;margin-top:6px;position:relative;z-index:1;overflow:hidden;';
      noteStripEl.onclick = function() { _notesOpenPanel(); };

      // Animate strip hide with collapse
      function _notesHideStrip() {
        if (noteStripEl.style.display === 'none') return;
        noteStripEl.style.opacity = '0';
        noteStripEl.style.maxHeight = '0';
        noteStripEl.style.padding = '0 10px';
        noteStripEl.style.marginTop = '0';
        noteStripEl.style.borderColor = 'transparent';
        setTimeout(function() {
          noteStripEl.style.display = 'none';
          // Update flipInner height to match new front size
          if (flipInner && !flipInner.classList.contains('flipped')) {
            flipInner.style.minHeight = flipFront.scrollHeight + 'px';
          }
        }, 300);
      }

      function _notesRenderStrip() {
        var note = _notesLoadNote(_notesUsername);
        var tags = _notesLoadTags();
        if (!note.text && (!note.tags || note.tags.length === 0)) {
          _notesHideStrip();
          return;
        }
        noteStripEl.style.display = 'flex';
        noteStripEl.style.alignItems = 'center';
        noteStripEl.style.gap = '8px';
        noteStripEl.style.position = 'relative';
        noteStripEl.style.opacity = '1';
        noteStripEl.style.maxHeight = '80px';
        noteStripEl.style.padding = '6px 10px';
        noteStripEl.style.marginTop = '6px';
        noteStripEl.style.borderColor = 'rgba(0,180,255,0.08)';
        noteStripEl.innerHTML = '';

        // Left: note content
        var contentDiv = document.createElement('div');
        contentDiv.style.cssText = 'flex:1;min-width:0;';
        if (note.text) {
          var textDiv = document.createElement('div');
          textDiv.style.cssText = 'font-size:10px;color:#8899aa;line-height:1.4;display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical;overflow:hidden;';
          textDiv.textContent = note.text;
          contentDiv.appendChild(textDiv);
        }
        if ((note.tags||[]).length > 0) {
          var tagsDiv = document.createElement('div');
          tagsDiv.style.cssText = 'display:flex;gap:3px;margin-top:' + (note.text ? '3px' : '0') + ';flex-wrap:wrap;';
          (note.tags||[]).forEach(function(tid) {
            var tg = tags.find(function(t2){return t2.id===tid;});
            if (!tg) return;
            var sp = document.createElement('span');
            sp.style.cssText = 'font-size:7px;padding:1px 5px;border-radius:6px;font-weight:600;' + _notesTagStyle(tg.ci);
            sp.textContent = tg.name;
            tagsDiv.appendChild(sp);
          });
          contentDiv.appendChild(tagsDiv);
        }
        noteStripEl.appendChild(contentDiv);

        // Right: date + arrow
        var rightDiv = document.createElement('div');
        rightDiv.style.cssText = 'display:flex;align-items:center;gap:6px;flex-shrink:0;';
        if (note.date) {
          var dateSpan = document.createElement('span');
          dateSpan.style.cssText = 'font-size:9px;color:#8899aa;white-space:nowrap;font-weight:600;';
          var nd = new Date(note.date);
          var dd = ('0'+nd.getDate()).slice(-2), mm = ('0'+(nd.getMonth()+1)).slice(-2), yy = String(nd.getFullYear()).slice(-2);
          dateSpan.textContent = dd+'.'+mm+'.'+yy;
          rightDiv.appendChild(dateSpan);
        }
        // Delete button
        var stripDel = document.createElement('div');
        stripDel.style.cssText = 'width:18px;height:18px;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;opacity:0;transition:all 0.2s;background:rgba(239,68,68,0.08);flex-shrink:0;';
        stripDel.innerHTML = '<svg width="8" height="8" viewBox="0 0 10 10"><line x1="1" y1="1" x2="9" y2="9" stroke="#ef4444" stroke-width="1.8" stroke-linecap="round"/><line x1="9" y1="1" x2="1" y2="9" stroke="#ef4444" stroke-width="1.8" stroke-linecap="round"/></svg>';
        stripDel.onmouseenter = function() { this.style.background='rgba(239,68,68,0.25)'; };
        stripDel.onmouseleave = function() { this.style.background='rgba(239,68,68,0.08)'; };
        stripDel.onclick = function(e) {
          e.stopPropagation();
          // Confirmation overlay
          var overlay = document.createElement('div');
          overlay.style.cssText = 'position:absolute;top:0;left:0;right:0;bottom:0;background:rgba(13,17,23,0.95);border-radius:7px;display:flex;align-items:center;justify-content:center;gap:8px;z-index:10;';
          overlay.innerHTML = '<span style="font-size:9px;color:#ef4444;font-weight:600;">Delete note?</span>';
          var btnYes = document.createElement('button');
          btnYes.style.cssText = 'padding:3px 12px;border-radius:6px;border:1px solid rgba(239,68,68,0.3);background:rgba(239,68,68,0.15);color:#ef4444;font-size:9px;font-weight:700;cursor:pointer;font-family:inherit;';
          btnYes.textContent = 'Yes';
          btnYes.onclick = function(ev) {
            ev.stopPropagation();
            var allN = _notesLoadAllNotes();
            delete allN[_notesUsername];
            try { localStorage.setItem('ofStatsNotes', JSON.stringify(allN)); } catch(ex) {}
            _notesDeleteFromServer(_notesUsername);
            _notesDraftText = '';
            _notesRenderStrip();
          };
          var btnNo = document.createElement('button');
          btnNo.style.cssText = 'padding:3px 12px;border-radius:6px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.05);color:#8899aa;font-size:9px;font-weight:700;cursor:pointer;font-family:inherit;';
          btnNo.textContent = 'No';
          btnNo.onclick = function(ev) { ev.stopPropagation(); overlay.remove(); };
          overlay.appendChild(btnYes);
          overlay.appendChild(btnNo);
          noteStripEl.appendChild(overlay);
        };
        rightDiv.appendChild(stripDel);
        // Arrow
        var arrowSpan = document.createElement('span');
        arrowSpan.style.cssText = 'font-size:10px;color:#445566;';
        arrowSpan.textContent = '\u203A';
        rightDiv.appendChild(arrowSpan);
        noteStripEl.appendChild(rightDiv);

        // Show delete on hover
        noteStripEl.onmouseenter = function() { this.style.background='rgba(0,180,255,0.06)'; this.style.borderColor='rgba(0,180,255,0.15)'; stripDel.style.opacity='1'; };
        noteStripEl.onmouseleave = function() { this.style.background='rgba(0,180,255,0.03)'; this.style.borderColor='rgba(0,180,255,0.08)'; stripDel.style.opacity='0'; };
      }

      // Open independent Notes panel (hide flip card, show notes).
      // No-op when subscription is expired — notes are part of the paid
      // bundle, so we route the user to the upgrade tab instead.
      function _notesOpenPanel() {
        if (_subExpired) {
          chrome.runtime.sendMessage({ action: 'openSubscriptionTab' });
          return;
        }
        _notesDraftText = '';
        _notesDraftTagName = '';
        // Capture current badge height before hiding
        var badgeHeight = flipInner.offsetHeight || flipFront.scrollHeight;
        flipInner.style.display = 'none';
        // Hide alerts panel if open
        var ap = badge.querySelector('#of-stats-alerts-panel');
        if (ap) ap.style.display = 'none';
        var np = badge.querySelector('#of-stats-notes-panel');
        if (np) {
          np.style.display = '';
          np.style.minHeight = badgeHeight + 'px';
          // Show local data immediately
          _notesRebuildPanel();
          // Then refresh from server
          _notesSyncFromServer(function() {
            _notesRebuildPanel();
            _notesRenderStrip();
          });
        }
      }

      // Close Notes panel and return to front side
      function _notesClosePanel() {
        var np = badge.querySelector('#of-stats-notes-panel');
        if (np) np.style.display = 'none';
        flipInner.style.display = '';
        // Ensure we're on front side
        flipInner.classList.remove('flipped');
        flipInner.style.minHeight = flipFront.scrollHeight + 'px';
        var frontLabel = document.getElementById('of-flip-label');
        var backLabel = document.getElementById('of-flip-label-back');
        if (frontLabel) frontLabel.textContent = t('details');
        if (backLabel) backLabel.textContent = t('details');
        var fb = badge.querySelector('#of-stats-flip-btn');
        if (fb) fb.style.opacity = '0.65';
      }

      _notesRenderStrip();
      
      // Username with verification badge
      if (profileData.username || profileData.name) {
        const usernameDiv = document.createElement('div');
        usernameDiv.style.cssText = 'color:#e2e8f0;font-weight:600;font-size:13px;margin-bottom:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:flex;align-items:center;gap:5px;position:relative;z-index:1;';
        const verifiedBadge = profileData.isVerified ? '<svg viewBox="0 0 24 24" width="14" height="14" style="flex-shrink:0;"><path fill="#00b4ff" d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z"/></svg>' : '';
        usernameDiv.innerHTML = '<span style="color:#00b4ff;">@</span>' + (profileData.username || profileData.name) + verifiedBadge;
        flipFront.appendChild(usernameDiv);
      }
      
      // Stats list
      const list = document.createElement('div');
      list.style.cssText = 'display:flex;flex-direction:column;gap:7px;position:relative;z-index:1;';
      list.innerHTML = badgeItems.join('');
      flipFront.appendChild(list);
      
      // ==================== MODEL SCORE SECTION ====================
      // First scan for social links immediately
      profileData._detectedSocials = scanSocialLinksFromDOM();
      const scoreResult = calculateModelScore(profileData);

      // Run Smart Alerts detection (must be after scoreResult)
      _alertsDetect(_notesUsername, profileData, scoreResult);
      _alertsUpdateBadge();

      // Pre-fetch alerts from server to merge with local
      _alertsFetchFromServer(_notesUsername, function() {
        _alertsUpdateBadge();
      });
      
      // Inject tooltip styles once
      if (!document.getElementById('of-stats-tooltip-styles')) {
        const tooltipStyle = document.createElement('style');
        tooltipStyle.id = 'of-stats-tooltip-styles';
        tooltipStyle.textContent = `
          .of-stats-tip { position: relative; cursor: help; }
          .of-stats-tip .of-stats-tiptext {
            display: none;
          }
          .of-stats-global-tip {
            position: fixed; z-index: 2147483647;
            background: #1a1f3a; color: #e2e8f0;
            font-size: 11px; font-style: normal; font-weight: 400;
            text-align: left; line-height: 1.4;
            border-radius: 8px; padding: 8px 10px;
            border: 1px solid rgba(0,180,255,0.25);
            box-shadow: 0 4px 16px rgba(0,0,0,0.5);
            min-width: 180px; max-width: 260px;
            white-space: normal; word-wrap: break-word;
            pointer-events: none;
            opacity: 0; transition: opacity 0.15s;
          }
          .of-stats-global-tip.visible { opacity: 1; }
          .of-stats-global-tip::after {
            content: ''; position: absolute;
            top: 100%; left: 50%; transform: translateX(-50%);
            border: 5px solid transparent; border-top-color: #1a1f3a;
          }
        `;
        document.head.appendChild(tooltipStyle);

        // Create a single global tooltip element on body (outside transform containers)
        var globalTip = document.createElement('div');
        globalTip.className = 'of-stats-global-tip';
        document.body.appendChild(globalTip);
        var tipHideTimer = null;

        document.addEventListener('mouseover', function(e) {
          var tip = e.target.closest('.of-stats-tip');
          if (!tip) return;
          var tt = tip.querySelector('.of-stats-tiptext');
          if (!tt) return;
          clearTimeout(tipHideTimer);
          globalTip.innerHTML = tt.innerHTML;
          globalTip.classList.add('visible');
          var rect = tip.getBoundingClientRect();
          var ttW = 220;
          var left = rect.left + rect.width / 2 - ttW / 2;
          if (left < 4) left = 4;
          if (left + ttW > window.innerWidth - 4) left = window.innerWidth - 4 - ttW;
          globalTip.style.left = left + 'px';
          globalTip.style.width = ttW + 'px';
          if (rect.top > 80) {
            globalTip.style.bottom = 'auto';
            globalTip.style.top = (rect.top - 8) + 'px';
            globalTip.style.transform = 'translateY(-100%)';
          } else {
            globalTip.style.top = (rect.bottom + 8) + 'px';
            globalTip.style.bottom = 'auto';
            globalTip.style.transform = 'none';
          }
        }, true);

        document.addEventListener('mouseout', function(e) {
          var tip = e.target.closest('.of-stats-tip');
          if (!tip) return;
          tipHideTimer = setTimeout(function() {
            globalTip.classList.remove('visible');
          }, 100);
        }, true);
      }
      
      const scoreSection = document.createElement('div');
      scoreSection.style.cssText = 'position:relative;z-index:1;margin-top:10px;padding-top:10px;border-top:1px solid rgba(0,180,255,0.15);';

      // Grade tooltip descriptions
      const gradeTooltips = {
        'TOP': t('gradeTop'),
        'Good': t('gradeGood'),
        'Average': t('gradeAverage'),
        'Suspicious': t('gradeSuspicious'),
        'Likely Fake': t('gradeFake')
      };
      
      // Score header + big number with tooltip
      const scoreHeader = document.createElement('div');
      scoreHeader.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;';
      const gradeTip = (gradeTooltips[scoreResult.grade] || '').replace(/\n/g, '<br>');
      scoreHeader.innerHTML = `
        <div class="of-stats-tip" style="display:flex;align-items:center;gap:6px;">
          ${scoreResult.gradeIcon}
          <span style="color:${scoreResult.gradeColor};font-weight:700;font-size:14px;">${scoreResult.grade}</span>
          <div class="of-stats-tiptext">${gradeTip}</div>
        </div>
        <div style="display:flex;align-items:baseline;gap:3px;">
          <span style="color:${scoreResult.gradeColor};font-weight:800;font-size:22px;">${scoreResult.score}</span>
          <span style="color:#64748b;font-size:11px;">/100</span>
        </div>
      `;
      // scoreHeader and progressBar are appended in the flip card assembly below
      
      // Progress bar
      const progressBar = document.createElement('div');
      progressBar.style.cssText = 'width:100%;height:6px;background:rgba(255,255,255,0.08);border-radius:3px;overflow:hidden;margin-bottom:8px;';
      progressBar.innerHTML = '<div style="width:' + scoreResult.score + '%;height:100%;background:' + scoreResult.gradeColor + ';border-radius:3px;transition:width 0.5s ease;"></div>';
      
      // Component breakdown (compact, spread across full width with tooltips)
      const components = scoreResult.components;
      const compTooltips = {
        'MAT': t('compMAT'),
        'POP': t('compPOP'),
        'ORG': t('compORG'),
        'ACT': t('compACT'),
        'TRS': t('compTRS')
      };
      const compDiv = document.createElement('div');
      compDiv.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;';
      const compItems = [
        { label: 'MAT', value: components.maturity, max: 25, color: '#00b4ff' },
        { label: 'POP', value: components.popularity, max: 25, color: '#f1c40f' },
        { label: 'ORG', value: components.organicity, max: 25, color: '#10b981' },
        { label: 'ACT', value: components.activity, max: 15, color: '#9b59b6' },
        { label: 'TRS', value: components.transparency, max: 10, color: '#ff6b9d' }
      ];
      compDiv.innerHTML = compItems.map(function(c) {
        var tip = compTooltips[c.label] || '';
        return '<span class="of-stats-tip" style="color:#64748b;font-size:10px;font-weight:700;cursor:help;">' + c.label + ' <span style="color:' + c.color + ';font-weight:700;">' + c.value + '</span><span style="color:#475569;">/' + c.max + '</span><div class="of-stats-tiptext">' + tip + '</div></span>';
      }).join('');
      // compDiv and analysisGroup will be added to scoreSection later

      // === X-RAY MODE (for back side) ===
      // Calculate X-Ray analytics data
      var xrayFans = profileData.subscribersCount || 0;
      var xrayLikes = profileData.favoritedCount || 0;
      var xrayPosts = profileData.postsCount || 0;
      var xrayVideos = profileData.videosCount || 0;
      var xrayStreams = profileData.finishedStreamsCount || 0;
      var xrayPrice = profileData.subscribePrice || 0;
      var xrayMonths = 0;
      if (profileData.joinDate) {
        var xj = new Date(profileData.joinDate), xn = new Date();
        xrayMonths = (xn.getFullYear() - xj.getFullYear()) * 12 + (xn.getMonth() - xj.getMonth());
      }
      var xrayEffectiveFans = profileData.showSubscribersCount !== false ? xrayFans : (profileData._lastKnownFans ? profileData._lastKnownFans.count || 0 : 0);
      var xrayFansPerMonth = xrayMonths > 0 ? xrayEffectiveFans / xrayMonths : 0;
      var xrayPostsPerMonth = xrayMonths > 0 ? xrayPosts / xrayMonths : 0;
      var xrayLikesPerPost = xrayPosts > 0 ? xrayLikes / xrayPosts : 0;
      var xrayEngagement = xrayEffectiveFans > 0 ? (xrayLikes / xrayEffectiveFans) : 0;
      var xrayRevenue = xrayPrice > 0 ? xrayEffectiveFans * xrayPrice : 0;
      var xrayAgeYears = Math.floor(xrayMonths / 12);
      var xrayAgeMonths = xrayMonths % 12;
      var xrayAgeText = xrayAgeYears > 0 ? xrayAgeYears + t('yearShort') + xrayAgeMonths + t('monthShort') : xrayAgeMonths + ' ' + t('monthShort');

      // Build X-Ray rows
      var xrayRows = [];
      if (xrayRevenue > 0) {
        xrayRows.push({ key: t('estRevenue'), val: '$' + formatNumberShort(xrayRevenue) + t('perMonth'), cls: 'good' });
      }
      var fansHidden = xrayEffectiveFans <= 0;
      if (fansHidden) {
        xrayRows.push({ key: t('fansMonth'), val: t('unknown'), cls: 'warn' });
        xrayRows.push({ key: t('engagement'), val: t('unknown'), cls: 'warn' });
      } else {
        xrayRows.push({ key: t('fansMonth'), val: '~' + Math.round(xrayFansPerMonth) + ' ' + t('fansPerMonth'), cls: xrayFansPerMonth > 3000 ? 'bad' : xrayFansPerMonth >= 100 ? 'good' : 'warn' });
        xrayRows.push({ key: t('engagement'), val: xrayEngagement.toFixed(2) + ' ' + t('likesPerFan'), cls: xrayEngagement >= 0.5 && xrayEngagement <= 5 ? 'good' : xrayEngagement > 5 && xrayEngagement < 15 ? 'warn' : xrayEngagement >= 15 ? 'bad' : 'warn' });
      }
      xrayRows.push({ key: t('content'), val: '~' + Math.round(xrayPostsPerMonth) + ' ' + t('postsPerMonth'), cls: xrayPostsPerMonth >= 5 ? 'good' : xrayPostsPerMonth >= 1 ? 'warn' : 'bad' });
      xrayRows.push({ key: t('likesPost'), val: '~' + Math.round(xrayLikesPerPost), cls: xrayLikesPerPost > 500 ? 'bad' : xrayLikesPerPost >= 10 ? 'good' : 'warn' });
      if (xrayVideos > 0) {
        xrayRows.push({ key: t('videos'), val: xrayVideos + ' ' + t('videoCount'), cls: xrayVideos >= 10 ? 'good' : 'warn' });
      }
      if (xrayStreams > 0) {
        xrayRows.push({ key: t('streams'), val: xrayStreams + ' ' + t('streamCount'), cls: xrayStreams >= 3 ? 'good' : 'warn' });
      }
      xrayRows.push({ key: t('accountAge'), val: xrayAgeText, cls: xrayMonths >= 12 ? 'good' : xrayMonths >= 3 ? 'warn' : 'bad' });
      // Fans row: show count if visible, or from DB, or hidden
      var fansVal = t('hidden');
      var fansCls = 'bad';
      if (profileData.showSubscribersCount !== false && xrayFans > 0) {
        fansVal = xrayFans.toLocaleString('ru-RU') + t('fansCount');
        fansCls = 'good';
      } else if (profileData._lastKnownFans && profileData._lastKnownFans.count > 0) {
        fansVal = profileData._lastKnownFans.count.toLocaleString('ru-RU') + t('fansCount');
        fansCls = 'warn';
      }
      xrayRows.push({ key: t('fans'), val: fansVal, cls: fansCls });
      var commentsStatus = profileData._farmedStatus === 'ready' ? t('commentsOpen') : (profileData._farmedStatus === 'restricted' ? t('commentsRestricted') : t('unknown'));
      xrayRows.push({ key: t('comments'), val: commentsStatus, cls: profileData._farmedStatus === 'ready' ? 'good' : profileData._farmedStatus === 'restricted' ? 'bad' : 'warn' });
      
      // Analysis group (inset panel for flags + verdict) — FRONT SIDE
      const analysisGroup = document.createElement('div');
      analysisGroup.style.cssText = 'background:rgba(0,0,0,0.25);border-radius:10px;padding:14px;box-shadow:inset 0 2px 10px rgba(0,0,0,0.5);border:1px solid rgba(255,255,255,0.03);border-bottom:1px solid rgba(255,255,255,0.08);';
      
      // === BADGE CATEGORIES ===
      if (scoreResult.flags.length > 0) {
        const achIcons = scoreResult._achIcons;
        // Separate negative vs positive flags by color
        var negativeColors = ['#ef4444', '#f97316', '#f59e0b'];
        var negativeFlags = [];
        var positiveFlags = [];
        scoreResult.flags.forEach(function(f) {
          if (negativeColors.indexOf(f.color) !== -1) {
            negativeFlags.push(f);
          } else {
            positiveFlags.push(f);
          }
        });

        // Helper to render a row of badges
        function renderBadgeRow(flags) {
          return flags.map(function(f) {
            var iconSvg = f.icon && achIcons[f.icon] ? achIcons[f.icon].replace(/currentColor/g, f.color) : '';
            var tipHtml = f.tooltip ? '<div class="of-stats-tiptext">' + f.tooltip + '</div>' : '';
            return '<span class="of-stats-tip" style="display:inline-flex;align-items:center;gap:3px;background:' + f.color + '18;color:' + f.color + ';font-size:10px;font-weight:600;padding:3px 8px;border-radius:10px;border:1px solid ' + f.color + '35;">' + iconSvg + f.text + tipHtml + '</span>';
          }).join('');
        }

        // Negative flags first (if any)
        if (negativeFlags.length > 0) {
          var negLabel = document.createElement('div');
          negLabel.style.cssText = 'font-size:9px;text-transform:uppercase;letter-spacing:1px;font-weight:600;color:#ef4444;margin-bottom:4px;';
          negLabel.textContent = t('warnings');
          analysisGroup.appendChild(negLabel);

          var negDiv = document.createElement('div');
          negDiv.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;margin-bottom:6px;';
          negDiv.innerHTML = renderBadgeRow(negativeFlags);
          analysisGroup.appendChild(negDiv);
        }

        // Divider between groups (only if both groups exist)
        if (negativeFlags.length > 0 && positiveFlags.length > 0) {
          var badgeDivider = document.createElement('div');
          badgeDivider.style.cssText = 'height:1px;background:linear-gradient(90deg,transparent,rgba(255,255,255,0.06),transparent);margin:6px 0;';
          analysisGroup.appendChild(badgeDivider);
        }

        // Positive flags
        if (positiveFlags.length > 0) {
          var posLabel = document.createElement('div');
          posLabel.style.cssText = 'font-size:9px;text-transform:uppercase;letter-spacing:1px;font-weight:600;color:#10b981;margin-bottom:4px;';
          posLabel.textContent = t('achievements');
          analysisGroup.appendChild(posLabel);

          var posDiv = document.createElement('div');
          posDiv.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px;';
          posDiv.innerHTML = renderBadgeRow(positiveFlags);
          analysisGroup.appendChild(posDiv);
        }
      }
      
      // AI Verdict (async) — styled card with grade accent
      var _vGradeColor = scoreResult.gradeColor || '#00b4ff';
      var _vGradeLabel = (t('verdictGrade') || {})[scoreResult.grade] || '';

      const verdictDiv = document.createElement('div');
      verdictDiv.style.cssText = 'margin-top:8px;border-radius:8px;overflow:hidden;border:1px solid ' + _vGradeColor + '20;background:linear-gradient(135deg,' + _vGradeColor + '08,' + _vGradeColor + '03);';
      // Hide verdict if disabled in settings OR subscription expired
      if (settings.ofStatsVerdictEnabled === false || _subExpired) {
        verdictDiv.style.display = 'none';
      }
      analysisGroup.appendChild(verdictDiv);

      // Render helper for verdict card content
      function _renderVerdict(text, state) {
        // state: 'loading', 'error', 'ready'
        var sparkSvg = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" style="flex-shrink:0;"><path d="M12 2L13.5 8.5L20 10L13.5 11.5L12 18L10.5 11.5L4 10L10.5 8.5L12 2Z" fill="' + _vGradeColor + '"/><path d="M19 15L19.7 17.3L22 18L19.7 18.7L19 21L18.3 18.7L16 18L18.3 17.3L19 15Z" fill="' + _vGradeColor + '" opacity="0.6"/></svg>';
        var html = '<div style="display:flex;align-items:center;gap:6px;padding:8px 10px 4px;">';
        html += sparkSvg;
        html += '<span style="font-size:10px;font-weight:700;letter-spacing:0.5px;color:' + _vGradeColor + ';text-transform:uppercase;">' + t('verdictAI') + '</span>';
        if (_vGradeLabel) {
          html += '<span style="font-size:9px;color:' + _vGradeColor + ';opacity:0.6;margin-left:auto;font-weight:600;">' + _vGradeLabel + '</span>';
        }
        html += '</div>';
        // Accent line
        html += '<div style="height:1px;background:linear-gradient(90deg,transparent,' + _vGradeColor + '30,transparent);margin:0 10px;"></div>';
        // Body
        html += '<div style="padding:6px 10px 9px;">';
        if (state === 'loading') {
          html += '<div style="display:flex;align-items:center;gap:6px;"><div style="width:8px;height:8px;border-radius:50%;border:2px solid ' + _vGradeColor + ';border-top-color:transparent;animation:ofSpin 0.8s linear infinite;"></div><span style="color:#64748b;font-size:11px;font-style:italic;">' + t('analyzing') + '</span></div>';
        } else if (state === 'error') {
          html += '<span style="color:#64748b;font-size:11px;font-style:italic;">' + t('unavailable') + '</span>';
        } else {
          html += '<span style="color:#c9d1d9;font-size:11px;line-height:1.5;">' + text + '</span>';
        }
        html += '</div>';
        return html;
      }

      // Spin animation for loading
      if (!document.getElementById('ofSpinStyle')) {
        var spinStyle = document.createElement('style');
        spinStyle.id = 'ofSpinStyle';
        spinStyle.textContent = '@keyframes ofSpin{to{transform:rotate(360deg)}}';
        document.head.appendChild(spinStyle);
      }
      
      // analysisGroup appended to scoreSection in assembly below
      
      // Request AI verdict from background (skip if subscription expired to save AI resources)
      if (_subExpired) {
        // Do nothing — verdict hidden and not generated
      } else if (profileData._aiVerdict && profileData._aiVerdictLang === _ofLang) {
        verdictDiv.innerHTML = _renderVerdict(profileData._aiVerdict, 'ready');
      } else {
        verdictDiv.innerHTML = _renderVerdict('', 'loading');
        try {
          var lastKnownFansInfo = '';
          if (profileData.showSubscribersCount === false && profileData._lastKnownFans) {
            lastKnownFansInfo = profileData._lastKnownFans.count + ' (' + t('aiDate') + (profileData._lastKnownFans.formattedDate || formatDateShort(profileData._lastKnownFans.recordedAt)) + ')';
          }
          chrome.runtime.sendMessage({
            action: 'getAIVerdict',
            scoreData: {
              lang: _ofLang || 'ru',
              username: profileData.username || '',
              score: scoreResult.score,
              grade: scoreResult.grade,
              components: scoreResult.components,
              flags: scoreResult.flags.map(function(f) { return f.text; }),
              fans: profileData.subscribersCount || 0,
              fansVisible: profileData.showSubscribersCount !== false,
              lastKnownFans: lastKnownFansInfo,
              likes: profileData.favoritedCount || 0,
              posts: profileData.postsCount || 0,
              videos: profileData.videosCount || 0,
              streams: profileData.finishedStreamsCount || 0,
              verified: profileData.isVerified || false,
              website: profileData.website || '',
              joinDate: profileData.joinDate || '',
              accountMonths: (function() { if (!profileData.joinDate) return 0; var j = new Date(profileData.joinDate), n = new Date(); return (n.getFullYear()-j.getFullYear())*12+(n.getMonth()-j.getMonth()); })(),
              price: profileData.subscribePrice,
              commentsOpen: profileData._farmedStatus === 'ready',
              commentsClosed: profileData._farmedStatus === 'none',
              location: profileData.location || '',
              isOnline: profileData.isPerformer ? (profileData.lastSeen ? t('aiRecentlyOnline') : t('aiUnknown')) : t('aiUnknown')
            }
          }).then(function(response) {
            if (response && response.verdict) {
              profileData._aiVerdict = response.verdict;
              profileData._aiVerdictLang = _ofLang;
              verdictDiv.innerHTML = _renderVerdict(response.verdict, 'ready');
            } else {
              verdictDiv.innerHTML = _renderVerdict('', 'error');
            }
          }).catch(function() {
            verdictDiv.innerHTML = _renderVerdict('', 'error');
          });
        } catch (e) {
          verdictDiv.innerHTML = _renderVerdict('', 'error');
        }
      }

      // --- BACK SIDE: Radar Chart + X-Ray ---
      // Build radar pentagon chart SVG
      var radarData = [
        { label: 'MAT', value: components.maturity, max: 25, color: '#00b4ff' },
        { label: 'POP', value: components.popularity, max: 25, color: '#f1c40f' },
        { label: 'ORG', value: components.organicity, max: 25, color: '#10b981' },
        { label: 'ACT', value: components.activity, max: 15, color: '#9b59b6' },
        { label: 'TRS', value: components.transparency, max: 10, color: '#ff6b9d' }
      ];
      var radarR = 80; // max radius
      var radarCx = 0, radarCy = 0;
      // Pentagon vertex angles: -90°, -18°, 54°, 126°, 198° (starting from top, clockwise)
      var radarAngles = [-90, -18, 54, 126, 198].map(function(a) { return a * Math.PI / 180; });
      function radarPt(angle, r) {
        return [Math.cos(angle) * r, Math.sin(angle) * r];
      }
      // Grid polygons (4 levels: 100%, 75%, 50%, 25%)
      var gridLevels = [1, 0.75, 0.5, 0.25];
      var gridPolygons = gridLevels.map(function(level) {
        return radarAngles.map(function(a) { var p = radarPt(a, radarR * level); return p[0].toFixed(1) + ',' + p[1].toFixed(1); }).join(' ');
      });
      // Axis lines
      var axisLines = radarAngles.map(function(a) { var p = radarPt(a, radarR); return '<line x1="0" y1="0" x2="' + p[0].toFixed(1) + '" y2="' + p[1].toFixed(1) + '"/>'; }).join('');
      // Data polygon — normalize all to percentage of their max
      var dataPoints = radarData.map(function(d, i) {
        var ratio = Math.min(d.value / d.max, 1);
        var p = radarPt(radarAngles[i], radarR * ratio);
        return { x: p[0], y: p[1], label: d.label, value: d.value, max: d.max, color: d.color };
      });
      var dataPoly = dataPoints.map(function(p) { return p.x.toFixed(1) + ',' + p.y.toFixed(1); }).join(' ');
      // Data dots — same color as the polygon lines (gradeColor)
      var dotColor = scoreResult.gradeColor;
      var dataDots = dataPoints.map(function(p) { return '<circle cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="3.5" fill="' + dotColor + '" stroke="#0a0e1e" stroke-width="1"/>'; }).join('');
      // SVG has no labels — they are rendered as HTML overlays below
      var radarSvg = '<svg width="100%" viewBox="-130 -105 260 220" style="filter:drop-shadow(0 0 8px rgba(0,180,255,0.15));display:block;">'
        + '<g opacity="0.15" stroke="' + scoreResult.gradeColor + '" fill="none">'
        + gridPolygons.map(function(pts) { return '<polygon points="' + pts + '"/>'; }).join('')
        + '</g>'
        + '<g stroke="rgba(0,180,255,0.08)">' + axisLines + '</g>'
        + '<polygon fill="' + scoreResult.gradeColor + '20" stroke="' + scoreResult.gradeColor + '" stroke-width="2" points="' + dataPoly + '"/>'
        + '<g>' + dataDots + '</g>'
        + '</svg>';

      // Back side header with Back button and close
      var backHeader = document.createElement('div');
      backHeader.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:2px;padding-bottom:8px;border-bottom:1px solid rgba(0, 180, 255, 0.15);';
      backHeader.innerHTML = '<div style="display:flex;align-items:center;gap:6px;">' + svgIcons.stats + '<span style="color:#00b4ff;font-size:11px;text-transform:uppercase;letter-spacing:1px;font-weight:600;">' + t('radarAnalysis') + '</span></div><div style="display:flex;align-items:center;gap:8px;"><div id="of-stats-flip-btn-back" style="display:flex;align-items:center;gap:4px;cursor:pointer;user-select:none;opacity:1;transition:opacity 0.2s;padding:2px 6px;border-radius:6px;background:rgba(0,180,255,0.08);border:1px solid rgba(0,180,255,0.15);"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#00b4ff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5m0 0l7 7m-7-7l7-7"/></svg><span style="color:#00b4ff;font-size:9px;font-weight:600;letter-spacing:0.5px;" id="of-flip-label-back">' + t('back') + '</span></div><button class="of-stats-close-btn" style="background:none;border:none;color:#64748b;cursor:pointer;font-size:18px;padding:0 2px;line-height:1;transition:color 0.2s;">&times;</button></div>';
      flipBack.appendChild(backHeader);

      // === TAB SYSTEM: Radar | Trend ===
      var hasTrend = profileData._fansTrend && profileData._fansTrend.length >= 2;
      var tabBar = document.createElement('div');
      tabBar.style.cssText = 'display:flex;gap:0;margin:4px 0 8px;border-bottom:1px solid rgba(0,180,255,0.12);';
      var svgRadarIcon = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5"/><line x1="12" y1="2" x2="12" y2="22"/><line x1="22" y1="8.5" x2="2" y2="15.5"/><line x1="2" y1="8.5" x2="22" y2="15.5"/></svg>';
      var svgTrendIcon = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 6 13 11 8 4 2 12"/><polyline points="22 12 22 20 2 20 2 12"/></svg>';
      var tabRadar = document.createElement('div');
      tabRadar.className = 'of-tab-btn';
      tabRadar.dataset.tab = 'radar';
      tabRadar.style.cssText = 'flex:1;display:flex;align-items:center;justify-content:center;gap:4px;padding:6px 0;font-size:10px;font-weight:600;color:#00b4ff;cursor:pointer;border-bottom:2px solid #00b4ff;transition:all 0.2s;';
      tabRadar.innerHTML = svgRadarIcon + ' ' + t('radarTab');
      var tabTrend = document.createElement('div');
      tabTrend.className = 'of-tab-btn';
      tabTrend.dataset.tab = 'trend';
      tabTrend.style.cssText = 'flex:1;display:flex;align-items:center;justify-content:center;gap:4px;padding:6px 0;font-size:10px;font-weight:600;color:#556677;cursor:pointer;border-bottom:2px solid transparent;transition:all 0.2s;';
      tabTrend.innerHTML = svgTrendIcon + ' ' + t('trendTab');
      tabBar.appendChild(tabRadar);
      tabBar.appendChild(tabTrend);
      flipBack.appendChild(tabBar);

      // --- RADAR TAB CONTENT ---
      var radarTabContent = document.createElement('div');
      radarTabContent.id = 'of-stats-tab-radar';

      var radarDiv = document.createElement('div');
      radarDiv.style.cssText = 'position:relative;';
      radarDiv.innerHTML = radarSvg;
      radarTabContent.appendChild(radarDiv);

      // HTML labels at pentagon vertices — coords mapped from SVG viewBox -130,-130 w=260 h=245
      var vbX=-130, vbY=-105, vbW=260, vbH=220;
      var labelConfigs = [
        { offy: -18, offx: 0, anchor: 'center' },
        { offy: -6, offx: 6, anchor: 'left' },
        { offy: 4, offx: 4, anchor: 'left' },
        { offy: 4, offx: -4, anchor: 'right' },
        { offy: -6, offx: -6, anchor: 'right' }
      ];
      radarData.forEach(function(d, i) {
        var vtx = radarPt(radarAngles[i], radarR);
        var cfg = labelConfigs[i];
        var pctLeft = ((vtx[0] - vbX) / vbW * 100).toFixed(1);
        var pctTop = ((vtx[1] - vbY) / vbH * 100).toFixed(1);
        var xform = cfg.anchor === 'center' ? 'translate(-50%,' + cfg.offy + 'px)' : cfg.anchor === 'right' ? 'translate(calc(-100% + ' + cfg.offx + 'px),' + cfg.offy + 'px)' : 'translate(' + cfg.offx + 'px,' + cfg.offy + 'px)';
        var tip = compTooltips[d.label] || '';
        var lbl = document.createElement('span');
        lbl.className = 'of-stats-tip';
        lbl.style.cssText = 'position:absolute;top:' + pctTop + '%;left:' + pctLeft + '%;transform:' + xform + ';color:' + d.color + ';font-size:10px;font-weight:600;font-family:Inter,-apple-system,sans-serif;cursor:help;white-space:nowrap;z-index:2;';
        lbl.textContent = d.label + ' ' + d.value;
        if (tip) {
          var tipEl = document.createElement('div');
          tipEl.className = 'of-stats-tiptext';
          tipEl.textContent = tip;
          lbl.appendChild(tipEl);
        }
        radarDiv.appendChild(lbl);
      });

      // Engagement Percentile panel (Feature #5) — now synced with aggregated DB percentile
      var analyzedModels = 1247;
      var engagementRate = Math.max(0, xrayEngagement);
      var negativeColors = ['#ef4444', '#f97316', '#f59e0b'];
      var negativeFlagsCount = (scoreResult.flags || []).filter(function(f) {
        return f && negativeColors.indexOf(f.color) !== -1;
      }).length;
      var scoreNorm = Math.max(0, Math.min(1, (scoreResult.score || 0) / 100));
      var organicityNorm = Math.max(0, Math.min(1, (components.organicity || 0) / 25));
      var engagementNorm = Math.max(0, Math.min(1, engagementRate / 5));
      var qualityRaw = (scoreNorm * 0.60) + (organicityNorm * 0.25) + (engagementNorm * 0.15) - (negativeFlagsCount * 0.04);
      var quality = Math.max(0.01, Math.min(0.99, qualityRaw));
      var betterPercent = Math.max(1, Math.min(99, Math.round(quality * 100)));
      var topPercent = Math.max(1, 100 - betterPercent);
      var percentilePanel = document.createElement('div');
      percentilePanel.style.cssText = 'margin-top:-34px;margin-bottom:10px;background:#0d1420;border-radius:9px;padding:9px 10px;border:1px solid rgba(0,180,255,0.16);';
      percentilePanel.innerHTML =
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">'
        + '<div id="of-percentile-top" style="font-size:19px;font-weight:800;line-height:1;background:linear-gradient(135deg,#00b4ff,#22c55e);-webkit-background-clip:text;-webkit-text-fill-color:transparent;">Top ' + topPercent + '%</div>'
        + '<div style="font-size:9px;color:#8899aa;text-align:right;max-width:170px;line-height:1.25;">'
        + '<span id="of-percentile-better">' + t('betterThanModels') + betterPercent + '% ' + t('analyzedModelsSuffix') + '</span><br>'
        + '<span id="of-percentile-basis" style="font-size:8px;color:#5f7388;">' + t('percentileBasis') + '</span></div>'
        + '</div>'
        + '<div style="position:relative;height:14px;background:#111827;border-radius:8px;overflow:hidden;">'
        + '<div style="height:100%;width:100%;opacity:.32;background:linear-gradient(90deg,#ef4444,#eab308,#22c55e,#00b4ff);"></div>'
        + '<div id="of-percentile-marker" style="position:absolute;top:1px;bottom:1px;width:3px;border-radius:2px;background:#fff;left:' + betterPercent + '%;transform:translateX(-50%);box-shadow:0 0 6px rgba(255,255,255,.45);"></div>'
        + '</div>';
      radarTabContent.appendChild(percentilePanel);

      // Fetch real percentile from aggregated backend DB and replace heuristic values
      if (profileData.username) {
        try {
          chrome.runtime.sendMessage({
            action: 'getEngagementPercentile',
            username: profileData.username,
            metrics: (function buildMetrics(){
              var m = {
                score: Number(scoreResult.score || 0),
                organicity: Number(components.organicity || 0),
                engagementRate: Number(engagementRate || 0),
                negativeFlagsCount: Number(negativeFlagsCount || 0),
                avatarUrl: profileData.avatar || null,
                postsCount: Number(profileData.postsCount) || 0,
                videosCount: Number(profileData.videosCount) || 0,
                photosCount: Number(profileData.photosCount) || 0,
                streamsCount: Number(profileData.finishedStreamsCount) || 0,
                likesCount: Number(profileData.favoritedCount) || 0,
                subscribePrice: Number(profileData.subscribePrice) || 0
              };
              if (profileData.joined) {
                var t = Date.parse(profileData.joined);
                if (!isNaN(t)) m.accountMonths = Math.max(1, Math.floor((Date.now() - t) / (1000*60*60*24*30)));
              }
              if (typeof scoreResult.fansVisible === 'boolean') m.fansVisible = scoreResult.fansVisible;
              else if (typeof profileData.subscribers === 'number') m.fansVisible = profileData.subscribers > 0;
              // _detectedSocials is populated by the badge's late social-link scan.
              if (Array.isArray(profileData._detectedSocials)) m.hasSocials = profileData._detectedSocials.length > 0;
              return m;
            })()
          }).then(function(resp) {
            if (!resp || !resp.success) return;
            var dbModels = Math.max(1, Number(resp.modelsAnalyzed || 1));

            var topEl = percentilePanel.querySelector('#of-percentile-top');
            var betterEl = percentilePanel.querySelector('#of-percentile-better');
            var basisEl = percentilePanel.querySelector('#of-percentile-basis');
            var markerEl = percentilePanel.querySelector('#of-percentile-marker');

            // Only overwrite local heuristic if backend has enough data
            if (resp.sufficient && resp.topPercent != null) {
              var dbBetter = Math.max(1, Math.min(99, Number(resp.betterPercent)));
              var dbTop = Math.max(1, Math.min(99, Number(resp.topPercent)));
              if (topEl) topEl.textContent = 'Top ' + dbTop + '%';
              if (betterEl) betterEl.textContent = t('betterThanModels') + dbBetter + '% ' + t('analyzedModelsSuffix');
              if (basisEl) basisEl.textContent = t('aggregatedDB');
              if (markerEl) markerEl.style.left = dbBetter + '%';
            } else {
              // Keep local heuristic, just update model count and basis text
              if (basisEl) basisEl.textContent = t('qualityEstimate');
            }
          }).catch(function() {});
        } catch (e) {}
      }

      // X-Ray section inside Radar tab
      var xrayTitle = document.createElement('div');
      xrayTitle.style.cssText = 'display:flex;align-items:center;gap:6px;margin:10px 0 8px 0;';
      xrayTitle.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#00b4ff" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg><span style="color:#00b4ff;font-size:10px;text-transform:uppercase;letter-spacing:1.5px;font-weight:600;">' + t('xrayMode') + '</span>';
      radarTabContent.appendChild(xrayTitle);

      var xrayPanel = document.createElement('div');
      xrayPanel.style.cssText = 'background:rgba(0,180,255,0.04);border:1px solid rgba(0,180,255,0.12);border-radius:8px;padding:10px;';
      xrayPanel.innerHTML = xrayRows.map(function(r) {
        var valColor = r.cls === 'good' ? '#10b981' : r.cls === 'bad' ? '#ef4444' : '#f59e0b';
        var icon = r.cls === 'good' ? '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><polyline points="20 6 9 17 4 12"/></svg>'
                 : r.cls === 'bad' ? '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'
                 : '<svg width="12" height="12" viewBox="0 0 24 24" fill="#f59e0b" style="flex-shrink:0"><path d="M12 2L1 21h22L12 2zm0 4l7.5 13h-15L12 6z"/><rect x="11" y="10" width="2" height="5" rx="1"/><rect x="11" y="16" width="2" height="2" rx="1"/></svg>';
        return '<div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;font-size:11px;' + (r !== xrayRows[xrayRows.length - 1] ? 'border-bottom:1px solid rgba(255,255,255,0.04);' : '') + '"><span style="color:#64748b;">' + r.key + '</span><span style="display:flex;align-items:center;gap:4px;color:' + valColor + ';font-weight:600;">' + r.val + icon + '</span></div>';
      }).join('');
      radarTabContent.appendChild(xrayPanel);

      flipBack.appendChild(radarTabContent);

      // --- TREND TAB CONTENT ---
      var trendTabContent = document.createElement('div');
      trendTabContent.id = 'of-stats-tab-trend';
      trendTabContent.style.display = 'none';

      if (hasTrend) {
        var tAllPts = profileData._fansTrendRaw || profileData._fansTrend;
        var tActiveRange = 'all';
        function fmtTrendDate(d) { var p = d.split('-'); return p[2] + '.' + p[1] + '.' + p[0].slice(2); }

        // Filter points by range
        function filterByRange(range) {
          var now = new Date();
          var pts = tAllPts.slice();
          if (range === '24h') {
            var yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1);
            var yStr = yesterday.getFullYear() + '-' + String(yesterday.getMonth() + 1).padStart(2, '0') + '-' + String(yesterday.getDate()).padStart(2, '0');
            pts = pts.filter(function(p) { return p.d >= yStr; });
          } else if (range === '7d') {
            var d7 = new Date(now); d7.setDate(d7.getDate() - 7);
            var s7 = d7.getFullYear() + '-' + String(d7.getMonth() + 1).padStart(2, '0') + '-' + String(d7.getDate()).padStart(2, '0');
            pts = pts.filter(function(p) { return p.d >= s7; });
          } else if (range === '30d') {
            var d30 = new Date(now); d30.setDate(d30.getDate() - 30);
            var s30 = d30.getFullYear() + '-' + String(d30.getMonth() + 1).padStart(2, '0') + '-' + String(d30.getDate()).padStart(2, '0');
            pts = pts.filter(function(p) { return p.d >= s30; });
          }
          // "all" uses everything
          // LTTB downsample for "all" if too many points
          if (range === 'all' && pts.length > 30) {
            pts = lttbDownsample(pts, 30);
          }
          if (pts.length < 2) pts = tAllPts.slice(-2);
          return pts;
        }

        function buildChart(pts) {
          var vals = pts.map(function(p) { return p.f; });
          var mn = Math.min.apply(null, vals), mx = Math.max.apply(null, vals);
          var rng = mx - mn || 1;
          var first = vals[0], last = vals[vals.length - 1];
          var pctCh = ((last - first) / (first || 1) * 100);
          var isUp = pctCh >= 0;
          var col = isUp ? '#22c55e' : '#ef4444';
          var arrow = isUp ? '\u25b2' : '\u25bc';
          var pctTxt = arrow + ' ' + (isUp ? '+' : '') + pctCh.toFixed(1) + '%';
          var gained = last - first;
          var days = pts.length > 1 ? Math.max(1, Math.round((new Date(pts[pts.length - 1].d) - new Date(pts[0].d)) / 86400000)) : 1;
          var perDay = (gained / days).toFixed(0);
          var W = 240, H = 56, padT = 8, padB = 8;
          var coords = vals.map(function(v, i) {
            var x = (i / (vals.length - 1)) * W;
            var y = padT + (1 - ((v - mn) / rng)) * (H - padT - padB);
            return x.toFixed(1) + ',' + y.toFixed(1);
          });
          var line = coords.join(' ');
          var area = line + ' ' + W + ',' + H + ' 0,' + H;
          var dots = '';
          coords.forEach(function(c, idx) {
            var cx = c.split(',')[0], cy = c.split(',')[1];
            dots += '<circle cx="' + cx + '" cy="' + cy + '" r="4" fill="' + col + '" stroke="#0d1117" stroke-width="2" style="cursor:pointer;" data-idx="' + idx + '"/>';
            dots += '<circle cx="' + cx + '" cy="' + cy + '" r="12" fill="transparent" style="cursor:pointer;" data-idx="' + idx + '"/>';
          });
          var firstD = pts[0].d, lastD = pts[pts.length - 1].d;
          var midD = pts[Math.floor(pts.length / 2)] ? pts[Math.floor(pts.length / 2)].d : '';
          return {
            html: '<div id="of-trend-header" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">'
              + '<span style="font-size:10px;color:#8899aa;text-transform:uppercase;letter-spacing:0.3px;">' + t('fansTrend') + ' (' + days + 'd)</span>'
              + '<div style="display:flex;align-items:center;gap:6px;">'
              + '<span style="font-size:18px;font-weight:700;color:#fff;">' + Number(last).toLocaleString() + '</span>'
              + '<span style="font-size:10px;font-weight:600;padding:2px 5px;border-radius:4px;color:' + col + ';background:' + col + '18;">' + pctTxt + '</span>'
              + '</div></div>'
              + '<div style="position:relative;margin:6px 0;">'
              + '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" height="68" preserveAspectRatio="none" id="of-trend-svg" style="opacity:0;animation:ofTrendFadeIn 0.3s ease forwards;">'
              + '<defs><linearGradient id="ofTrendGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="' + col + '" stop-opacity="0.25"/><stop offset="100%" stop-color="' + col + '" stop-opacity="0"/></linearGradient></defs>'
              + '<polygon points="' + area + '" fill="url(#ofTrendGrad)"/>'
              + '<polyline points="' + line + '" fill="none" stroke="' + col + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'
              + dots
              + '</svg>'
              + '<div id="of-trend-tooltip" style="display:none;position:absolute;bottom:2px;left:0;background:#1a2535ee;border:1px solid ' + col + '44;border-radius:6px;padding:4px 8px;pointer-events:none;white-space:nowrap;z-index:10;transform:translateX(-50%);box-shadow:0 4px 12px rgba(0,0,0,0.5);">'
              + '<div style="font-size:11px;font-weight:700;color:#fff;" id="of-trend-tip-fans"></div>'
              + '<div style="font-size:9px;color:#8899aa;" id="of-trend-tip-date"></div>'
              + '</div></div>'
              + '<div style="display:flex;justify-content:space-between;font-size:9px;color:#667788;margin-bottom:8px;">'
              + '<span>' + fmtTrendDate(firstD) + '</span>'
              + (midD ? '<span>' + fmtTrendDate(midD) + '</span>' : '')
              + '<span>' + fmtTrendDate(lastD) + '</span>'
              + '</div>'
              + '<div id="of-trend-stats" style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;">'
              + '<div style="text-align:center;padding:6px 4px;background:rgba(0,180,255,0.04);border-radius:6px;border:1px solid rgba(0,180,255,0.12);">'
              + '<div style="font-size:13px;font-weight:700;color:' + col + ';">' + (gained >= 0 ? '+' : '') + Number(gained).toLocaleString() + '</div>'
              + '<div style="font-size:8px;color:#8899aa;margin-top:2px;text-transform:uppercase;letter-spacing:0.5px;">' + t('trendGained') + '</div></div>'
              + '<div style="text-align:center;padding:6px 4px;background:rgba(0,180,255,0.04);border-radius:6px;border:1px solid rgba(0,180,255,0.12);">'
              + '<div style="font-size:13px;font-weight:700;color:#00b4ff;">~' + perDay + '/d</div>'
              + '<div style="font-size:8px;color:#8899aa;margin-top:2px;text-transform:uppercase;letter-spacing:0.5px;">' + t('trendPerDay') + '</div></div>'
              + '<div style="text-align:center;padding:6px 4px;background:rgba(0,180,255,0.04);border-radius:6px;border:1px solid rgba(0,180,255,0.12);">'
              + '<div style="font-size:13px;font-weight:700;color:#00b4ff;">' + pts.length + '</div>'
              + '<div style="font-size:8px;color:#8899aa;margin-top:2px;text-transform:uppercase;letter-spacing:0.5px;">' + t('trendReports') + '</div></div>'
              + '</div>',
            pts: pts, col: col
          };
        }

        // Inject animation keyframe for chart fade
        if (!document.getElementById('of-trend-anim-style')) {
          var animSty = document.createElement('style');
          animSty.id = 'of-trend-anim-style';
          animSty.textContent = '@keyframes ofTrendFadeIn{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}';
          document.head.appendChild(animSty);
        }

        // Chart container
        var chartWrap = document.createElement('div');
        chartWrap.id = 'of-trend-chart-wrap';
        trendTabContent.appendChild(chartWrap);

        // Range buttons row
        var rangeBtns = document.createElement('div');
        rangeBtns.style.cssText = 'display:flex;gap:4px;margin-top:8px;';
        var ranges = [
          { key: '24h', label: '24h' },
          { key: '7d', label: '7d' },
          { key: '30d', label: '30d' },
          { key: 'all', label: t('trendAll') }
        ];
        var btnEls = {};
        ranges.forEach(function(r) {
          var b = document.createElement('button');
          b.style.cssText = 'flex:1;padding:5px 0;border-radius:6px;border:1px solid rgba(255,255,255,0.06);background:rgba(255,255,255,0.03);color:#667788;font-size:9px;font-weight:600;cursor:pointer;transition:all 0.2s;font-family:inherit;letter-spacing:0.3px;';
          b.textContent = r.label;
          b.onmouseenter = function() { if (tActiveRange !== r.key) { b.style.background = 'rgba(0,180,255,0.06)'; b.style.borderColor = 'rgba(0,180,255,0.15)'; b.style.color = '#8899aa'; } };
          b.onmouseleave = function() { if (tActiveRange !== r.key) { b.style.background = 'rgba(255,255,255,0.03)'; b.style.borderColor = 'rgba(255,255,255,0.06)'; b.style.color = '#667788'; } };
          b.onclick = function() { setRange(r.key); };
          btnEls[r.key] = b;
          rangeBtns.appendChild(b);
        });
        trendTabContent.appendChild(rangeBtns);

        function highlightBtn(key) {
          ranges.forEach(function(r) {
            var b = btnEls[r.key];
            if (r.key === key) {
              b.style.background = 'rgba(0,180,255,0.1)';
              b.style.borderColor = 'rgba(0,180,255,0.25)';
              b.style.color = '#00b4ff';
            } else {
              b.style.background = 'rgba(255,255,255,0.03)';
              b.style.borderColor = 'rgba(255,255,255,0.06)';
              b.style.color = '#667788';
            }
          });
        }

        function attachDotListeners(pts) {
          var svg = document.getElementById('of-trend-svg');
          var tip = document.getElementById('of-trend-tooltip');
          var tipFans = document.getElementById('of-trend-tip-fans');
          var tipDate = document.getElementById('of-trend-tip-date');
          if (!svg || !tip) return;
          svg.querySelectorAll('circle[data-idx]').forEach(function(dot) {
            dot.addEventListener('mouseenter', function() {
              var idx = parseInt(dot.getAttribute('data-idx'));
              var pt = pts[idx];
              if (!pt) return;
              tipFans.textContent = Number(pt.f).toLocaleString() + ' fans';
              tipDate.textContent = fmtTrendDate(pt.d);
              var pct = (idx / (pts.length - 1)) * 100;
              tip.style.left = Math.max(12, Math.min(88, pct)) + '%';
              tip.style.display = '';
            });
            dot.addEventListener('mouseleave', function() { tip.style.display = 'none'; });
          });
        }

        function setRange(key) {
          tActiveRange = key;
          highlightBtn(key);
          var pts = filterByRange(key);
          var result = buildChart(pts);
          chartWrap.innerHTML = result.html;
          setTimeout(function() { attachDotListeners(result.pts); }, 30);
          adjustFlipHeight(true);
        }

        // Initial render
        setRange(tActiveRange);

      } else {
        trendTabContent.innerHTML = '<div style="text-align:center;padding:30px 10px;color:#556677;font-size:12px;">'
          + '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#334455" stroke-width="1.5" style="margin:0 auto 8px;display:block;"><path d="M22 12H18L15 21L9 3L6 12H2"/></svg>'
          + t('trendNoData')
          + '</div>';
      }

      // === MILESTONE TIMELINE (inside Trend tab) ===
      var msTitle = document.createElement('div');
      msTitle.style.cssText = 'display:flex;align-items:center;gap:6px;margin:16px 0 10px 0;';
      msTitle.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" style="flex-shrink:0"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5C6 4 6 6 6 6s0 0 0 3z" fill="#00b4ff"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5C18 4 18 6 18 6s0 0 0 3z" fill="#00b4ff"/><path d="M6 9h12v4c0 3.3-2.7 6-6 6s-6-2.7-6-6V9z" fill="#00b4ff"/><rect x="5" y="8" width="14" height="2" rx="1" fill="#4dc9ff"/><path d="M12 15v4M12 19l-2 2M12 19l2 2" stroke="#0080b3" stroke-width="1.5" stroke-linecap="round"/></svg><span style="color:#00b4ff;font-size:10px;text-transform:uppercase;letter-spacing:1.5px;font-weight:600;">' + t('milestoneTitle') + '</span>';
      trendTabContent.appendChild(msTitle);

      var msPanel = document.createElement('div');
      msPanel.style.cssText = 'background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.06);border-radius:10px;padding:14px 14px 14px 16px;margin-bottom:6px;';

      // Milestone thresholds & unique SVG icons per tier (placed ON the timeline)
      var msTiers = [500, 1000, 2000, 3000, 5000, 10000, 25000, 50000, 100000];
      var msTierIcons = {
        500: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" fill="#06b6d4" opacity="0.15"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2z" fill="none" stroke="#06b6d4" stroke-width="1.5"/><path d="M8 12l2.5 3L16 9" stroke="#06b6d4" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>',
        1000: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2z" fill="#ef4444" opacity="0.15"/><path d="M12 6v5l3 3" stroke="#ef4444" stroke-width="2" stroke-linecap="round" fill="none"/><circle cx="12" cy="12" r="9" stroke="#ef4444" stroke-width="1.5" fill="none"/></svg>',
        2000: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M12 2L2 7v6c0 5.5 4.3 10.7 10 12 5.7-1.3 10-6.5 10-12V7L12 2z" fill="#8b5cf6" opacity="0.15" stroke="#8b5cf6" stroke-width="1.5"/><path d="M9 12l2 2 4-4" stroke="#8b5cf6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>',
        3000: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" fill="#f97316" opacity="0.15" stroke="#f97316" stroke-width="1.5"/><path d="M12 8v4l3 1.5" stroke="#f97316" stroke-width="2" stroke-linecap="round" fill="none"/><circle cx="12" cy="12" r="2" fill="#f97316"/></svg>',
        5000: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M12 2l2.4 4.8 5.3.8-3.8 3.7.9 5.3L12 14l-4.8 2.5.9-5.3-3.8-3.7 5.3-.8z" fill="#f59e0b" stroke="#f59e0b" stroke-width="1" stroke-linejoin="round"/></svg>',
        10000: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M12 2l2.4 4.8 5.3.8-3.8 3.7.9 5.3L12 14l-4.8 2.5.9-5.3-3.8-3.7 5.3-.8z" fill="#ec4899" stroke="#ec4899" stroke-width="1"/><circle cx="12" cy="10" r="3" fill="none" stroke="#fff" stroke-width="1.5"/></svg>',
        25000: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5C6 4 6 7 6 7z" fill="#10b981"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5C18 4 18 7 18 7z" fill="#10b981"/><path d="M6 9h12v5c0 3-2.7 5.5-6 5.5S6 17 6 14V9z" fill="#10b981"/><rect x="5" y="8" width="14" height="2" rx="1" fill="#34d399"/></svg>',
        50000: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" fill="#3b82f6" opacity="0.15" stroke="#3b82f6" stroke-width="1.5"/><path d="M12 6l1.5 3 3.3.5-2.4 2.3.6 3.2L12 13.5 8.9 15l.6-3.2L7.2 9.5l3.3-.5z" fill="#3b82f6"/></svg>',
        100000: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M12 2L2 7v6c0 5.5 4.3 10.7 10 12 5.7-1.3 10-6.5 10-12V7L12 2z" fill="#f59e0b" stroke="#f59e0b" stroke-width="1.5"/><path d="M12 8l1.2 2.4 2.6.4-1.9 1.8.4 2.6L12 14l-2.3 1.2.4-2.6-1.9-1.8 2.6-.4z" fill="#fff"/></svg>'
      };
      var msIconCurrent = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2z" fill="#ef4444" opacity="0.12"/><circle cx="12" cy="12" r="4" fill="#ef4444"><animate attributeName="r" values="3;5;3" dur="2s" repeatCount="indefinite"/><animate attributeName="opacity" values="1;0.6;1" dur="2s" repeatCount="indefinite"/></circle><circle cx="12" cy="12" r="9" stroke="#ef4444" stroke-width="1.5" fill="none" opacity="0.4"/></svg>';
      var msIconFuture = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="#94a3b8" stroke-width="1.5" stroke-dasharray="3 3" fill="none"/><circle cx="12" cy="12" r="3" fill="#94a3b8" opacity="0.5"/></svg>';

      var msCurrentFans = xrayEffectiveFans || 0;
      var msTrendPts = (profileData._fansTrendRaw || profileData._fansTrend || []);
      var msPerDay = 0;
      if (msTrendPts.length >= 2) {
        var msFirst = msTrendPts[0], msLast = msTrendPts[msTrendPts.length - 1];
        var msDaySpan = (new Date(msLast.d) - new Date(msFirst.d)) / 86400000;
        if (msDaySpan > 0) msPerDay = (msLast.f - msFirst.f) / msDaySpan;
      }

      // Join date for duration calculation
      var msJoinDate = profileData.joinDate ? new Date(profileData.joinDate) : null;
      var msNow = new Date();

      function msFormatNum(n) {
        return n >= 1000 ? n.toLocaleString('ru-RU') : n.toString();
      }

      function msDurationFromJoin(dateStr) {
        if (!msJoinDate || !dateStr) return '';
        var d = new Date(dateStr);
        var months = (d.getFullYear() - msJoinDate.getFullYear()) * 12 + (d.getMonth() - msJoinDate.getMonth());
        if (months < 1) return '';
        var y = Math.floor(months / 12);
        var m = months % 12;
        if (y > 0 && m > 0) return y + ' ' + t('msYr') + ' ' + m + ' ' + t('msMo');
        if (y > 0) return y + ' ' + t('msYr');
        return m + ' ' + t('msMo');
      }

      function msAccountAge() {
        if (!msJoinDate) return '';
        var months = (msNow.getFullYear() - msJoinDate.getFullYear()) * 12 + (msNow.getMonth() - msJoinDate.getMonth());
        if (months < 1) return '';
        var y = Math.floor(months / 12);
        var m = months % 12;
        if (y > 0 && m > 0) return y + ' ' + t('msYr') + ' ' + m + ' ' + t('msMo');
        if (y > 0) return y + ' ' + t('msYr');
        return m + ' ' + t('msMo');
      }

      function msHumanDate(dateStr) {
        if (!dateStr) return '';
        var d = new Date(dateStr);
        var monthNames = t('msMonthsFull');
        return d.getDate() + ' ' + monthNames[d.getMonth()] + ' ' + d.getFullYear();
      }

      // Find achieved & future tiers
      var msAchieved = msTiers.filter(function(v) { return v <= msCurrentFans; });
      var msFuture = msTiers.filter(function(v) { return v > msCurrentFans; }).slice(0, 2);

      // Build items: all achieved + current + next 2 future
      var msItems = [];
      msAchieved.forEach(function(tier) {
        var reachedDate = '';
        for (var i = 0; i < msTrendPts.length; i++) {
          if (msTrendPts[i].f >= tier) { reachedDate = msTrendPts[i].d; break; }
        }
        msItems.push({ val: tier, state: 'done', date: reachedDate });
      });
      msItems.push({ val: msCurrentFans, state: 'current' });
      msFuture.forEach(function(tier) {
        var daysNeeded = msPerDay > 0 ? Math.ceil((tier - msCurrentFans) / msPerDay) : 0;
        msItems.push({ val: tier, state: 'future', days: daysNeeded });
      });

      if (msCurrentFans <= 0 && msTrendPts.length < 2) {
        msPanel.innerHTML = '<div style="text-align:center;padding:16px 0;color:#64748b;font-size:11px;">' + t('milestoneNoData') + '</div>';
      } else {
        var msDoneCount = msAchieved.length;
        var msTotalCount = msItems.length;
        var msLineBluePct = msTotalCount > 1 ? Math.round(((msDoneCount + 0.5) / msTotalCount) * 100) : 50;

        var msHtml = '<div style="position:relative;padding-left:32px;">';
        // Vertical timeline line: blue for achieved, grey for future
        msHtml += '<div style="position:absolute;left:8px;top:10px;bottom:10px;width:3px;border-radius:2px;background:linear-gradient(to bottom,#00b4ff ' + msLineBluePct + '%,#334155 ' + msLineBluePct + '%);"></div>';

        msItems.forEach(function(item, idx) {
          var isLast = idx === msItems.length - 1;
          // SVG icon placed directly on the timeline line
          var lineIcon = item.state === 'done' ? msTierIcons[500] : item.state === 'current' ? msIconCurrent : msIconFuture;

          msHtml += '<div style="display:flex;align-items:flex-start;gap:10px;padding:8px 0;position:relative;">';
          // Icon on the timeline line (centered on the 3px line at left:8px, center=9.5px)
          msHtml += '<div style="position:absolute;left:-22px;top:8px;transform:translateX(-50%);display:flex;align-items:center;justify-content:center;z-index:1;background:#141625;border-radius:50%;padding:1px;">' + lineIcon + '</div>';
          msHtml += '<div style="flex:1;">';

          if (item.state === 'done') {
            msHtml += '<div style="display:flex;align-items:center;gap:4px;margin-bottom:2px;">';
            msHtml += '<span style="color:#e2e8f0;font-size:13px;font-weight:700;">' + msFormatNum(item.val) + ' ' + t('milestoneFans') + '</span>';
            msHtml += '</div>';
            var dateText = msHumanDate(item.date);
            var durText = msDurationFromJoin(item.date);
            if (dateText || durText) {
              msHtml += '<div style="color:#64748b;font-size:10px;margin-top:1px;">';
              if (dateText) msHtml += dateText;
              if (dateText && durText) msHtml += ' \u00b7 ';
              if (durText) msHtml += t('milestoneFor') + ' ' + durText;
              msHtml += '</div>';
            }
          } else if (item.state === 'current') {
            msHtml += '<div style="display:flex;align-items:center;gap:4px;margin-bottom:2px;">';
            msHtml += '<span style="color:#00b4ff;font-size:13px;font-weight:700;">' + msFormatNum(item.val) + ' ' + t('milestoneFans') + ' \u2014 ' + t('milestoneCurrent') + '</span>';
            msHtml += '</div>';
            var todayStr2 = msNow.getFullYear() + '-' + String(msNow.getMonth()+1).padStart(2,'0') + '-' + String(msNow.getDate()).padStart(2,'0');
            var ageText = msAccountAge();
            msHtml += '<div style="color:#64748b;font-size:10px;margin-top:1px;">';
            msHtml += msHumanDate(todayStr2);
            if (ageText) msHtml += ' \u00b7 ' + ageText;
            msHtml += '</div>';
          } else {
            msHtml += '<div style="display:flex;align-items:center;gap:4px;margin-bottom:2px;">';
            msHtml += '<span style="color:#94a3b8;font-size:13px;font-weight:700;">' + msFormatNum(item.val) + ' ' + t('milestoneFans') + '</span>';
            msHtml += '</div>';
            var forecastDays = item.days > 0 ? '~' + item.days + ' ' + t('milestoneDays') : '';
            if (forecastDays) {
              msHtml += '<div style="color:#64748b;font-size:10px;font-style:italic;margin-top:1px;">' + forecastDays + ' \u00b7 ' + t('milestoneForecast') + '</div>';
            }
          }

          msHtml += '</div></div>';
        });

        msHtml += '</div>';
        msPanel.innerHTML = msHtml;
      }
      trendTabContent.appendChild(msPanel);

      flipBack.appendChild(trendTabContent);

      // --- TAB SWITCHING LOGIC (2 tabs: Radar, Trend) ---
      function _switchBackTab(active) {
        var allTabs = [tabRadar, tabTrend];
        var allPanels = { radar: 'of-stats-tab-radar', trend: 'of-stats-tab-trend' };
        allTabs.forEach(function(tb) {
          if (tb.dataset.tab === active) { tb.style.color = '#00b4ff'; tb.style.borderBottomColor = '#00b4ff'; }
          else { tb.style.color = '#556677'; tb.style.borderBottomColor = 'transparent'; }
        });
        Object.keys(allPanels).forEach(function(k) {
          var el = document.getElementById(allPanels[k]);
          if (el) el.style.display = (k === active) ? '' : 'none';
        });
        adjustFlipHeight(true);
      }
      tabRadar.addEventListener('click', function() { _switchBackTab('radar'); });
      tabTrend.addEventListener('click', function() { _switchBackTab('trend'); });

      // Assemble: scoreSection goes into flipFront
      scoreSection.appendChild(scoreHeader);
      scoreSection.appendChild(progressBar);
      scoreSection.appendChild(compDiv);
      scoreSection.appendChild(analysisGroup);

      // === PAYWALL: mask real data if subscription expired ===
      if (_subExpired) {
        // Replace score number with "??"
        scoreHeader.innerHTML = scoreHeader.innerHTML
          .replace(/>(\d+)<\/span>\s*<span[^>]*>\/100/g, '>??</span><span style="color:#64748b;font-size:11px;">/100');
        // Replace grade text
        scoreHeader.querySelectorAll('span').forEach(function(s) {
          if (['S','A+','A','B+','B','C','D','F','Good','Average','Suspicious','Likely Fake','TOP'].indexOf(s.textContent.trim()) !== -1) {
            s.textContent = '???';
          }
        });
        // Mask progress bar
        progressBar.innerHTML = '<div style="width:0%;height:100%;background:#475569;border-radius:3px;"></div>';
        // Mask component values
        compDiv.querySelectorAll('span[style*="font-weight:700"]').forEach(function(s) {
          if (/^\d+$/.test(s.textContent.trim())) {
            s.textContent = '?';
          }
        });
        // Mask badge texts in analysisGroup — wipe text content
        analysisGroup.querySelectorAll('span[style*="border-radius:10px"]').forEach(function(badge) {
          badge.textContent = '\u2022\u2022\u2022\u2022\u2022\u2022';
          badge.style.color = '#334155';
          badge.style.pointerEvents = 'none';
          badge.style.userSelect = 'none';
        });
      }

      // === COMPARE BUTTON (Feature #6) ===
      var compareRow = document.createElement('div');
      compareRow.style.cssText = 'margin-top:0px;padding-top:8px;border-top:1px solid rgba(255,255,255,0.04);display:flex;align-items:center;gap:6px;';

      var compareBtn = document.createElement('button');
      compareBtn.id = 'of-stats-compare-btn';
      var swordsIcon = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><circle cx="5" cy="6" r="3"/><path d="M12 6h5a2 2 0 0 1 2 2v7"/><path d="m15 9-3-3 3-3"/><circle cx="19" cy="18" r="3"/><path d="M12 18H7a2 2 0 0 1-2-2V9"/><path d="m9 15 3 3-3 3"/></svg>';
      compareBtn.style.cssText = 'flex:1;padding:7px 10px;border-radius:8px;border:1px solid rgba(0,180,255,0.15);background:rgba(0,180,255,0.06);color:#00b4ff;font-size:10px;font-weight:600;cursor:pointer;text-align:center;transition:all 0.2s;display:flex;align-items:center;justify-content:center;gap:5px;font-family:inherit;letter-spacing:0.3px;';
      compareBtn.onmouseenter = function() { if (!this.dataset.locked) { this.style.background = 'rgba(0,180,255,0.12)'; this.style.borderColor = 'rgba(0,180,255,0.3)'; this.style.boxShadow = '0 0 8px rgba(0,180,255,0.1)'; } };
      compareBtn.onmouseleave = function() { if (!this.dataset.locked) { this.style.background = 'rgba(0,180,255,0.06)'; this.style.borderColor = 'rgba(0,180,255,0.15)'; this.style.boxShadow = 'none'; } };

      // X button to clear saved model (shows only when model is saved)
      var clearXBtn = document.createElement('div');
      clearXBtn.id = 'of-stats-compare-clear-x';
      clearXBtn.style.cssText = 'display:none;width:22px;height:22px;border-radius:50%;background:rgba(239,68,68,0.12);border:1px solid rgba(239,68,68,0.25);color:#ef4444;font-size:13px;cursor:pointer;flex-shrink:0;align-items:center;justify-content:center;transition:all 0.2s;font-weight:700;line-height:22px;text-align:center;';
      clearXBtn.innerHTML = '<svg width="10" height="10" viewBox="0 0 10 10" style="display:block;"><line x1="1" y1="1" x2="9" y2="9" stroke="#ef4444" stroke-width="1.8" stroke-linecap="round"/><line x1="9" y1="1" x2="1" y2="9" stroke="#ef4444" stroke-width="1.8" stroke-linecap="round"/></svg>';
      clearXBtn.title = t('compareClear');
      clearXBtn.onmouseenter = function() { this.style.background = 'rgba(239,68,68,0.25)'; this.style.borderColor = '#ef4444'; };
      clearXBtn.onmouseleave = function() { this.style.background = 'rgba(239,68,68,0.12)'; this.style.borderColor = 'rgba(239,68,68,0.25)'; };
      clearXBtn.onclick = function(e) {
        e.stopPropagation();
        chrome.storage.local.remove('ofStatsCompareModel', function() {
          _compareModelData = null;
          updateCompareButton();
        });
      };

      // Current model data snapshot for comparison
      var currentModelSnap = {
        username: profileData.username || '',
        name: profileData.name || profileData.username || '',
        score: scoreResult.score,
        grade: scoreResult.grade,
        gradeColor: scoreResult.gradeColor,
        gradeIcon: scoreResult.gradeIcon,
        fans: profileData.subscribersCount || 0,
        fansVisible: profileData.showSubscribersCount !== false,
        posts: profileData.postsCount || 0,
        likes: profileData.favoritedCount || 0,
        videos: profileData.videosCount || 0,
        streams: profileData.finishedStreamsCount || 0,
        price: profileData.subscribePrice || 0,
        verified: profileData.isVerified || false,
        mat: components.maturity,
        pop: components.popularity,
        org: components.organicity,
        act: components.activity,
        trs: components.transparency,
        engagement: xrayEngagement,
        organicityScore: components.organicity,
        avatar: profileData.avatar || ''
      };

      function updateCompareButton() {
        chrome.storage.local.get(['ofStatsCompareModel'], function(data) {
          var saved = data.ofStatsCompareModel || null;
          _compareModelData = saved;

          if (!saved || saved.username === currentModelSnap.username) {
            // No saved model or same model — show "Сравнить"
            compareBtn.innerHTML = swordsIcon + '<span>' + t('compareBtn') + '</span>';
            compareBtn.style.borderColor = 'rgba(0,180,255,0.15)';
            compareBtn.style.background = 'rgba(0,180,255,0.06)';
            compareBtn.style.color = '#00b4ff';
            compareBtn.dataset.locked = '';
            clearXBtn.style.display = 'none';
            compareBtn.onclick = function() {
              // Save current model
              chrome.storage.local.set({ ofStatsCompareModel: currentModelSnap }, function() {
                _compareModelData = currentModelSnap;
                compareBtn.innerHTML = '<span>✓</span><span>' + t('compareSaved') + '</span>';
                compareBtn.style.borderColor = 'rgba(34,197,94,0.2)';
                compareBtn.style.color = '#22c55e';
                compareBtn.style.background = 'rgba(34,197,94,0.06)';
                compareBtn.dataset.locked = '1';
                clearXBtn.style.display = 'flex';
                compareBtn.onclick = null;
              });
            };
          } else {
            // Different model saved — show "vs @saved_model"
            compareBtn.innerHTML = swordsIcon + '<span>vs @' + saved.username + '</span>';
            compareBtn.style.background = 'rgba(0,180,255,0.08)';
            compareBtn.style.color = '#00b4ff';
            compareBtn.style.borderColor = 'rgba(0,180,255,0.18)';
            compareBtn.dataset.locked = '';
            compareBtn.onmouseenter = function() { this.style.background = 'rgba(0,180,255,0.15)'; this.style.borderColor = 'rgba(0,180,255,0.35)'; this.style.boxShadow = '0 0 10px rgba(0,180,255,0.12)'; };
            compareBtn.onmouseleave = function() { this.style.background = 'rgba(0,180,255,0.08)'; this.style.borderColor = 'rgba(0,180,255,0.18)'; this.style.boxShadow = 'none'; };
            clearXBtn.style.display = 'flex';
            compareBtn.onclick = function() {
              showComparisonInBadge(saved, currentModelSnap, badge, flipInner, flipFront, flipBack, adjustFlipHeight, updateCompareButton);
            };
          }
        });
      }

      compareRow.appendChild(compareBtn);
      compareRow.appendChild(clearXBtn);
      scoreSection.appendChild(compareRow);

      // Init compare button state
      updateCompareButton();

      flipFront.appendChild(scoreSection);

      // === PAYWALL BLUR OVERLAY (if subscription expired) ===
      if (_subExpired) {
        // Blur + desaturate so colored score chips don't bleed through.
        // saturate(0.15) drains the green/red badges to almost greyscale,
        // brightness(0.7) drops the overall light level so the lock + CTA
        // sit on a near-flat dark backdrop.
        scoreSection.style.filter = 'blur(7px) saturate(0.15) brightness(0.7)';
        scoreSection.style.pointerEvents = 'none';
        scoreSection.style.userSelect = 'none';
        scoreSection.style.position = 'relative';

        // Create overlay with renew button. Opaque dark backdrop kills the
        // remaining color halo from any blurred element underneath.
        var paywallOverlay = document.createElement('div');
        paywallOverlay.style.cssText = 'position:absolute;top:0;left:0;right:0;bottom:0;z-index:10;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;background:rgba(10,12,30,0.78);border-radius:10px;';

        // Lock icon
        paywallOverlay.innerHTML = '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" style="opacity:0.7;"><rect x="3" y="11" width="18" height="11" rx="2" fill="#1e293b" stroke="#475569" stroke-width="1.5"/><path d="M7 11V7a5 5 0 0 1 10 0v4" stroke="#475569" stroke-width="1.5" stroke-linecap="round"/><circle cx="12" cy="16" r="1.5" fill="#64748b"/></svg>'
          + '<div style="color:#94a3b8;font-size:10px;font-weight:600;">' + t('paywallExpired') + '</div>';

        // Renew button
        var renewBtn = document.createElement('button');
        renewBtn.style.cssText = 'padding:7px 20px;border-radius:8px;border:1px solid rgba(0,180,255,0.3);background:rgba(0,180,255,0.12);color:#00b4ff;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit;transition:all 0.2s;letter-spacing:0.3px;';
        renewBtn.textContent = t('paywallRenew');
        renewBtn.onmouseenter = function() { this.style.background = 'rgba(0,180,255,0.25)'; this.style.boxShadow = '0 0 12px rgba(0,180,255,0.2)'; };
        renewBtn.onmouseleave = function() { this.style.background = 'rgba(0,180,255,0.12)'; this.style.boxShadow = 'none'; };
        renewBtn.onclick = function(e) {
          e.stopPropagation();
          // Ask background to open subscription tab
          chrome.runtime.sendMessage({ action: 'openSubscriptionTab' });
        };
        paywallOverlay.appendChild(renewBtn);

        // Wrap scoreSection with a relative container, cap height so card doesn't stretch
        var paywallWrap = document.createElement('div');
        paywallWrap.style.cssText = 'position:relative;max-height:160px;overflow:hidden;border-radius:10px;';
        flipFront.removeChild(scoreSection);
        paywallWrap.appendChild(scoreSection);
        paywallWrap.appendChild(paywallOverlay);
        flipFront.appendChild(paywallWrap);
      }

      // Note strip stays on front side (after score) — but hidden under
      // paywall: don't preview a saved note when access is locked.
      if (!_subExpired) {
        flipFront.appendChild(noteStripEl);
      }

      // Assemble flip card into badge
      flipInner.appendChild(flipFront);

      // === PAYWALL on BACK SIDE — lock Radar & Trend tab CONTENT only ===
      if (_subExpired) {
        // Keep backHeader and tabBar visible, only lock tab content areas
        [radarTabContent, trendTabContent].forEach(function(tabEl) {
          // Wipe real data from this tab
          while (tabEl.firstChild) tabEl.removeChild(tabEl.firstChild);
          tabEl.style.position = 'relative';
          tabEl.style.minHeight = '200px';

          // Skeleton placeholder (blurred)
          var tabDummy = document.createElement('div');
          tabDummy.style.cssText = 'filter:blur(6px);pointer-events:none;user-select:none;padding:10px;opacity:0.4;';
          if (tabEl === radarTabContent) {
            tabDummy.innerHTML = '<div style="width:120px;height:120px;margin:0 auto 12px;border-radius:50%;border:2px solid #1e293b;"></div>'
              + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">'
              + '<div style="height:20px;background:#1e293b;border-radius:6px;"></div>'.repeat(6)
              + '</div>';
          } else {
            tabDummy.innerHTML = '<div style="height:100px;background:#1e293b;border-radius:8px;margin-bottom:10px;"></div>'
              + '<div style="display:flex;gap:6px;">'
              + '<div style="flex:1;height:24px;background:#1e293b;border-radius:6px;"></div>'.repeat(3)
              + '</div>';
          }
          tabEl.appendChild(tabDummy);

          // Overlay with lock + renew
          var tabPaywall = document.createElement('div');
          tabPaywall.style.cssText = 'position:absolute;top:0;left:0;right:0;bottom:0;z-index:10;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;background:rgba(10,12,30,0.45);border-radius:8px;';
          tabPaywall.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" style="opacity:0.7;"><rect x="3" y="11" width="18" height="11" rx="2" fill="#1e293b" stroke="#475569" stroke-width="1.5"/><path d="M7 11V7a5 5 0 0 1 10 0v4" stroke="#475569" stroke-width="1.5" stroke-linecap="round"/><circle cx="12" cy="16" r="1.5" fill="#64748b"/></svg>'
            + '<div style="color:#94a3b8;font-size:10px;font-weight:600;">' + t('paywallExpired') + '</div>';
          var tabRenewBtn = document.createElement('button');
          tabRenewBtn.style.cssText = 'padding:6px 18px;border-radius:8px;border:1px solid rgba(0,180,255,0.3);background:rgba(0,180,255,0.12);color:#00b4ff;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit;transition:all 0.2s;letter-spacing:0.3px;';
          tabRenewBtn.textContent = t('paywallRenew');
          tabRenewBtn.onmouseenter = function() { this.style.background = 'rgba(0,180,255,0.25)'; this.style.boxShadow = '0 0 12px rgba(0,180,255,0.2)'; };
          tabRenewBtn.onmouseleave = function() { this.style.background = 'rgba(0,180,255,0.12)'; this.style.boxShadow = 'none'; };
          tabRenewBtn.onclick = function(e) { e.stopPropagation(); chrome.runtime.sendMessage({ action: 'openSubscriptionTab' }); };
          tabPaywall.appendChild(tabRenewBtn);
          tabEl.appendChild(tabPaywall);
        });
      }

      flipInner.appendChild(flipBack);
      badge.appendChild(flipInner);

      // === INDEPENDENT NOTES PANEL (separate from flip card) ===
      var notesPanel = document.createElement('div');
      notesPanel.id = 'of-stats-notes-panel';
      notesPanel.style.cssText = 'display:none;transition:min-height 0.3s ease;display:none;';
      // Notes panel header
      var notesPanelHeader = document.createElement('div');
      notesPanelHeader.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;padding-bottom:8px;border-bottom:1px solid rgba(0, 180, 255, 0.15);';
      var notesPanelTitle = document.createElement('div');
      notesPanelTitle.style.cssText = 'display:flex;align-items:center;gap:6px;';
      notesPanelTitle.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#00b4ff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg><span style="color:#00b4ff;font-size:11px;text-transform:uppercase;letter-spacing:1px;font-weight:600;">Quick Notes</span>';
      var notesPanelActions = document.createElement('div');
      notesPanelActions.style.cssText = 'display:flex;align-items:center;gap:8px;';
      // Back button
      var notesBackBtn = document.createElement('div');
      notesBackBtn.style.cssText = 'display:flex;align-items:center;gap:4px;cursor:pointer;user-select:none;opacity:1;transition:opacity 0.2s;padding:2px 6px;border-radius:6px;background:rgba(0,180,255,0.08);border:1px solid rgba(0,180,255,0.15);';
      notesBackBtn.innerHTML = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#00b4ff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5m0 0l7 7m-7-7l7-7"/></svg><span style="color:#00b4ff;font-size:9px;font-weight:600;letter-spacing:0.5px;">' + t('back') + '</span>';
      notesBackBtn.addEventListener('click', function() { _notesClosePanel(); });
      notesBackBtn.addEventListener('mouseenter', function() { this.style.background = 'rgba(0,180,255,0.15)'; });
      notesBackBtn.addEventListener('mouseleave', function() { this.style.background = 'rgba(0,180,255,0.08)'; });
      notesPanelActions.appendChild(notesBackBtn);
      // Close button
      var notesCloseBtn = document.createElement('button');
      notesCloseBtn.className = 'of-stats-close-btn';
      notesCloseBtn.style.cssText = 'background:none;border:none;color:#64748b;cursor:pointer;font-size:18px;padding:0 2px;line-height:1;transition:color 0.2s;';
      notesCloseBtn.innerHTML = '&times;';
      notesCloseBtn.addEventListener('click', function() { badge.remove(); });
      notesPanelActions.appendChild(notesCloseBtn);
      notesPanelHeader.appendChild(notesPanelTitle);
      notesPanelHeader.appendChild(notesPanelActions);
      notesPanel.appendChild(notesPanelHeader);
      // Notes content container (reuses same ID for CSS and _notesRebuildPanel)
      var notesPanelContent = document.createElement('div');
      notesPanelContent.id = 'of-stats-tab-notes';
      notesPanel.appendChild(notesPanelContent);
      badge.appendChild(notesPanel);

      // === INDEPENDENT ALERTS PANEL (Feature #8) ===
      var alertsPanel = document.createElement('div');
      alertsPanel.id = 'of-stats-alerts-panel';
      alertsPanel.style.cssText = 'display:none;transition:min-height 0.3s ease;';
      // Alerts panel header
      var alertsPanelHeader = document.createElement('div');
      alertsPanelHeader.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;padding-bottom:8px;border-bottom:1px solid rgba(234,179,8,0.15);';
      var alertsPanelTitle = document.createElement('div');
      alertsPanelTitle.style.cssText = 'display:flex;align-items:center;gap:6px;';
      alertsPanelTitle.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#eab308" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg><span style="color:#eab308;font-size:11px;text-transform:uppercase;letter-spacing:1px;font-weight:600;">' + t('alertsTitle') + '</span>';
      var alertsPanelActions = document.createElement('div');
      alertsPanelActions.style.cssText = 'display:flex;align-items:center;gap:8px;';
      var alertsBackBtn = document.createElement('div');
      alertsBackBtn.style.cssText = 'display:flex;align-items:center;gap:4px;cursor:pointer;user-select:none;padding:2px 6px;border-radius:6px;background:rgba(234,179,8,0.08);border:1px solid rgba(234,179,8,0.15);transition:all 0.2s;';
      alertsBackBtn.innerHTML = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#eab308" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5m0 0l7 7m-7-7l7-7"/></svg><span style="color:#eab308;font-size:9px;font-weight:600;letter-spacing:0.5px;">' + t('back') + '</span>';
      alertsBackBtn.addEventListener('click', function() { _alertsClosePanel(); });
      alertsBackBtn.addEventListener('mouseenter', function() { this.style.background = 'rgba(234,179,8,0.15)'; });
      alertsBackBtn.addEventListener('mouseleave', function() { this.style.background = 'rgba(234,179,8,0.08)'; });
      alertsPanelActions.appendChild(alertsBackBtn);
      var alertsCloseBtn = document.createElement('button');
      alertsCloseBtn.className = 'of-stats-close-btn';
      alertsCloseBtn.style.cssText = 'background:none;border:none;color:#64748b;cursor:pointer;font-size:18px;padding:0 2px;line-height:1;transition:color 0.2s;';
      alertsCloseBtn.innerHTML = '&times;';
      alertsCloseBtn.addEventListener('click', function() { badge.remove(); });
      alertsPanelActions.appendChild(alertsCloseBtn);
      alertsPanelHeader.appendChild(alertsPanelTitle);
      alertsPanelHeader.appendChild(alertsPanelActions);
      alertsPanel.appendChild(alertsPanelHeader);
      var alertsPanelContent = document.createElement('div');
      alertsPanelContent.id = 'of-stats-tab-alerts';
      alertsPanel.appendChild(alertsPanelContent);
      badge.appendChild(alertsPanel);

      // Alerts button click handler
      var alertsBtnEl = badge.querySelector('#of-stats-alerts-btn');
      if (alertsBtnEl) {
        alertsBtnEl.addEventListener('mouseenter', function() { this.style.opacity = '1'; this.style.background = 'rgba(234,179,8,0.15)'; });
        alertsBtnEl.addEventListener('mouseleave', function() { this.style.opacity = '0.65'; this.style.background = 'rgba(234,179,8,0.08)'; });
        alertsBtnEl.addEventListener('click', function(e) { e.stopPropagation(); _alertsOpenPanel(); });
      }

      // Notes button click handler (must be after badge assembly for querySelector)
      var notesBtnEl = badge.querySelector('#of-stats-notes-btn');
      if (notesBtnEl) {
        // When subscription is expired we still want the icon visible so the
        // user understands notes are part of the product, but clicking it must
        // route to the upgrade tab instead of opening the panel. We also tint
        // it muted so it's clearly disabled.
        if (_subExpired) {
          notesBtnEl.style.opacity = '0.45';
          notesBtnEl.style.cursor = 'not-allowed';
          notesBtnEl.title = t('paywallExpired') + ' — ' + t('paywallRenew');
          notesBtnEl.addEventListener('click', function(e) {
            e.stopPropagation();
            chrome.runtime.sendMessage({ action: 'openSubscriptionTab' });
          });
        } else {
          notesBtnEl.addEventListener('mouseenter', function() { this.style.opacity = '1'; this.style.background = 'rgba(0,180,255,0.15)'; });
          notesBtnEl.addEventListener('mouseleave', function() { this.style.opacity = '0.65'; this.style.background = 'rgba(0,180,255,0.08)'; });
          notesBtnEl.addEventListener('click', function(e) { e.stopPropagation(); _notesOpenPanel(); });
        }
      }

      // Helper: adjust flipInner height to fit active side
      function adjustFlipHeight(toBack) {
        var targetSide = toBack ? flipBack : flipFront;
        // Temporarily make back visible to measure
        if (toBack) { flipBack.style.position = 'relative'; flipBack.style.height = 'auto'; }
        var h = targetSide.scrollHeight;
        if (toBack) { flipBack.style.position = ''; flipBack.style.height = ''; }
        // Lock current height first so transition can animate from it
        if (!flipInner.style.minHeight) {
          flipInner.style.minHeight = flipFront.scrollHeight + 'px';
          // Force reflow so browser registers the starting value
          flipInner.offsetHeight;
        }
        flipInner.style.minHeight = h + 'px';
      }
      
      // Flip button handler (in header)
      var flipBtnEl = badge.querySelector('#of-stats-flip-btn');
      if (flipBtnEl) {
        flipBtnEl.addEventListener('mouseenter', function() { this.style.opacity = '1'; });
        flipBtnEl.addEventListener('mouseleave', function() { var f = flipInner.classList.contains('flipped'); this.style.opacity = f ? '1' : '0.65'; });
        flipBtnEl.addEventListener('click', function(e) {
          e.stopPropagation();
          var isFlipped = flipInner.classList.contains('flipped');
          flipInner.classList.toggle('flipped');
          adjustFlipHeight(!isFlipped);
          var frontLabel = document.getElementById('of-flip-label');
          var backLabel = document.getElementById('of-flip-label-back');
          if (frontLabel) frontLabel.textContent = isFlipped ? t('details') : t('back');
          if (backLabel) backLabel.textContent = isFlipped ? t('details') : t('back');
          this.style.opacity = isFlipped ? '0.65' : '1';
        });
      }
      // Back flip button handler
      var flipBtnBack = badge.querySelector('#of-stats-flip-btn-back');
      if (flipBtnBack) {
        flipBtnBack.addEventListener('mouseenter', function() { this.style.opacity = '1'; });
        flipBtnBack.addEventListener('mouseleave', function() { this.style.opacity = '1'; });
        flipBtnBack.addEventListener('click', function(e) {
          e.stopPropagation();
          flipInner.classList.remove('flipped');
          adjustFlipHeight(false);
          var frontLabel = document.getElementById('of-flip-label');
          var backLabel = document.getElementById('of-flip-label-back');
          if (frontLabel) frontLabel.textContent = t('details');
          if (backLabel) backLabel.textContent = t('details');
          if (flipBtnEl) flipBtnEl.style.opacity = '0.65';
        });
      }
      // Close button handlers (both sides)
      badge.querySelectorAll('.of-stats-close-btn').forEach(function(btn) {
        btn.addEventListener('click', function() { badge.remove(); });
      });
      
      // Function to insert badge into sidebar
      function insertBadgeIntoSidebar() {
        const sidebar = document.querySelector('.l-wrapper__sidebar');
        if (sidebar) {
          // Check if already inserted
          if (document.getElementById('of-stats-profile-badge')) return true;
          sidebar.insertBefore(badge, sidebar.firstChild);
          log('OF Stats: Badge inserted into sidebar!');
          return true;
        }
        return false;
      }
      
      // Try to insert immediately
      if (!insertBadgeIntoSidebar()) {
        // If sidebar not found, wait for it with MutationObserver
        log('OF Stats: Sidebar not found, waiting...');
        
        let attempts = 0;
        const maxAttempts = 50; // 5 seconds max
        
        const waitForSidebar = setInterval(function() {
          attempts++;
          if (insertBadgeIntoSidebar() || attempts >= maxAttempts) {
            clearInterval(waitForSidebar);
            
            // Final fallback if still not found
            if (attempts >= maxAttempts && !document.getElementById('of-stats-profile-badge')) {
              log('OF Stats: Sidebar never found, using fixed position');
              badge.style.cssText += `
                position: fixed;
                top: 70px;
                left: 10px;
                z-index: 999999;
                max-width: 240px;
              `;
              document.body.appendChild(badge);
            }
          }
        }, 100);
      }
      
      log('OF Stats: Successfully displayed profile badge!');
      
      // Delayed social media re-scan: OF renders social links via Vue AFTER API data
      // Retry scan every 500ms up to 5 times, re-calculate score if socials found
      if (!profileData._detectedSocials || profileData._detectedSocials.length === 0) {
        var socialRetry = 0;
        var socialRetryMax = 10;
        var socialRetryTimer = setInterval(function() {
          socialRetry++;
          var foundSocials = scanSocialLinksFromDOM();
          if (foundSocials.length > 0 || socialRetry >= socialRetryMax) {
            clearInterval(socialRetryTimer);
            if (foundSocials.length > 0 && (!profileData._detectedSocials || profileData._detectedSocials.length === 0)) {
              log('OF Stats: Social links found on retry #' + socialRetry + ':', foundSocials);
              profileData._detectedSocials = foundSocials;
              // Re-display badge with updated social data
              displayProfileData(profileData);
            }
          }
        }, 500);
      }

      }); // end chrome.storage.local.get settings callback
    }

    // Re-render badge when language changes in popup settings
    chrome.storage.onChanged.addListener(function(changes, area) {
      if (area === 'local' && changes.ofStatsLang && _lastBadgeProfileData) {
        _ofLang = changes.ofStatsLang.newValue || 'ru';
        var oldBadge = document.getElementById('of-stats-badge-card');
        if (oldBadge) oldBadge.remove();
        displayProfileData(_lastBadgeProfileData);
      }
    });
    
    // Helper to format last seen time
    function formatLastSeen(dateStr) {
      if (!dateStr) return '?';
      try {
        const date = new Date(dateStr);
        const now = new Date();
        const diffMs = now - date;
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMs / 3600000);
        const diffDays = Math.floor(diffMs / 86400000);
        
        if (diffMins < 5) return 'Online';
        if (diffMins < 60) return diffMins + 'm ago';
        if (diffHours < 24) return diffHours + 'h ago';
        if (diffDays < 7) return diffDays + 'd ago';
        return formatJoinDate(dateStr);
      } catch(e) {
        return '?';
      }
    }
    
    // Helper to format numbers (1234 -> 1.2K)
    function formatNumberShort(num) {
      if (num === undefined || num === null) return '?';
      if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
      if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
      return num.toString();
    }
    
    // Helper to format date short (2025-02-02T12:00:00Z -> 02.02.25)
    function formatDateShort(dateStr) {
      if (!dateStr) return '?';
      try {
        const date = new Date(dateStr);
        const day = String(date.getDate()).padStart(2, '0');
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const year = String(date.getFullYear()).slice(-2);
        return `${day}.${month}.${year}`;
      } catch(e) {
        return '?';
      }
    }
    
    // Helper to format join date
    function formatJoinDate(dateStr) {
      if (!dateStr) return '?';
      try {
        const date = new Date(dateStr);
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        return months[date.getMonth()] + ' ' + date.getFullYear();
      } catch(e) {
        return dateStr;
      }
    }
    
    // Watch for SPA navigation
    let lastUrl = location.href;
    function startNavigationObserver() {
      const target = document.body || document.documentElement;
      if (!target) {
        setTimeout(startNavigationObserver, 100);
        return;
      }
      new MutationObserver(function() {
        if (location.href !== lastUrl) {
          lastUrl = location.href;
          // Remove old badge on navigation
          const oldBadge = document.getElementById('of-stats-profile-badge');
          if (oldBadge) oldBadge.remove();
        }
      }).observe(target, { childList: true, subtree: true });
    }
    
    // Start observer when DOM is ready
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', startNavigationObserver);
    } else {
      startNavigationObserver();
    }
    
    log('OF Stats: Profile interceptor initialized');
  })();
  // ==================== END PROFILE DATA INTERCEPTOR ====================
  
  // Flag to track if we should run the main logic (fake values)
  // Only run if subscription is active AND settings are enabled
  const shouldRunMainLogic = subscriptionActive && cachedSettings && cachedSettings.enabled;
  
  // If no cached settings, disabled, or subscription expired, only export the function and return
  if (!shouldRunMainLogic) {
    // Export a function that can be called from content.js even if inject-early didn't run fully
    window.ofStatsApplyStatisticsEarningsPage = function(newSettings) {
      // Re-read settings
      cachedSettings = newSettings;
      if (!cachedSettings) {
        try {
          const cached = localStorage.getItem('ofStatsCache');
          if (cached) {
            cachedSettings = JSON.parse(cached);
          }
        } catch(e) {}
      }
      
      if (!cachedSettings || !cachedSettings.enabled) return;
      
      // Check if we're on the right page
      if (!window.location.pathname.includes('/my/statistics/statements/earnings')) return;
      
      // IMPORTANT: Prevent infinite reload loop
      // Check if we already tried to reload recently (within 3 seconds)
      const lastReloadAttempt = sessionStorage.getItem('ofStatsLastReloadAttempt');
      const now = Date.now();
      if (lastReloadAttempt && (now - parseInt(lastReloadAttempt)) < 3000) {
        log('OF Stats: Skipping reload to prevent infinite loop');
        return;
      }
      
      // Mark that we're about to reload
      sessionStorage.setItem('ofStatsLastReloadAttempt', now.toString());
      
      // The full function will be defined when inject-early runs with settings
      // For now, just reload the page to apply changes
      log('OF Stats: Reloading page to apply statistics/statements/earnings changes');
      window.location.reload();
    };
    return;
  }
  
  // Hide original data rows but NOT the loading spinner row
  // The infinite-loading-container shows the spinner - we want that visible
  if ((cachedSettings.earningsCount || cachedSettings.earningsCompleteCount) && window.location.pathname.includes('/my/statements/earnings')) {
    var hideStyle = document.createElement('style');
    hideStyle.id = 'of-stats-hide-earnings';
    // Hide only data rows (those with multiple td), not the loading row (which has colspan)
    hideStyle.textContent = 'table.b-table.m-responsive.m-earnings tbody tr:not([data-of-stats]):not(:has(.infinite-loading-container)) { visibility: hidden !important; height: 0 !important; overflow: hidden !important; }';
    document.documentElement.appendChild(hideStyle);
  }
  
  // Note: We'll handle Earnings section replacement via JS, not CSS
  // CSS :has() selector is not fully supported in all browsers
  
  // Hide earnings stats page elements until our data is applied (/my/stats/earnings page)
  if (window.location.pathname.includes('/my/stats/earnings')) {
    var hideStatsStyle = document.createElement('style');
    hideStatsStyle.id = 'of-stats-hide-stats';
    // Hide ALL category values, original month rows, and original chart until our data is applied
    // This prevents any flash of original values
    hideStatsStyle.textContent = `
      .b-stats-row__content:not([data-of-stats-ready]) .b-stats-row__val,
      .b-stats-row__content:not([data-of-stats-ready]) .b-stats-row__total-net span {
        visibility: hidden !important;
      }
      /* ALWAYS hide original month rows (not generated by us and not All time) */
      .b-stats-wrap .b-stats-row:not([data-of-stats-generated]):not([data-of-stats-alltime]) {
        display: none !important;
      }
      .b-chart__wrapper canvas:not([data-of-stats-overlay]) {
        visibility: hidden !important;
      }
      /* Expandable month rows styles */
      .b-stats-row[data-of-stats-generated] .b-stats-row__head {
        cursor: pointer;
      }
      .b-stats-row[data-of-stats-generated] .b-stats-row__arrow {
        transition: transform 0.2s ease;
      }
      .b-stats-row[data-of-stats-generated].m-expanded .b-stats-row__arrow {
        transform: rotate(180deg);
      }
      .b-stats-row[data-of-stats-generated] .b-stats-row__body {
        padding: 0;
      }
      .b-stats-row[data-of-stats-generated] .b-stats-row__chart-wrapper {
        position: relative;
        margin-bottom: 16px;
      }
      .b-stats-row[data-of-stats-generated] .b-chart__wrapper {
        min-height: 220px;
        height: 220px;
        overflow: visible;
        margin-top: -35px;
      }
      .b-stats-row[data-of-stats-generated] .b-chart__wrapper canvas {
        display: block;
        box-sizing: border-box;
        width: 608px;
        height: 220px;
      }
      /* Calendar button styling for months */
      .b-stats-row[data-of-stats-generated] .b-stats-row__chart-wrapper .g-btn.m-time-period {
        margin-top: 25px;
      }
      /* Active category styling for generated month rows - m-active class */
      .b-stats-wrap .b-stats-row[data-of-stats-generated] .b-stats-row__content .b-stats-row__label.m-border-line.m-active .b-stats-row__name.g-md-text {
        color: #000 !important;
        opacity: 1 !important;
        font-weight: 600 !important;
      }
      .b-stats-wrap .b-stats-row[data-of-stats-generated] .b-stats-row__content .b-stats-row__label.m-border-line:not(.m-active):not(.m-total) .b-stats-row__name.g-md-text {
        color: #8a96a3 !important;
        opacity: 0.6 !important;
        font-weight: 400 !important;
      }
      /* Active category styling for All time row - m-current class (like original site) */
      .b-stats-wrap .b-stats-row[data-of-stats-alltime] .b-stats-row__content .b-stats-row__label.m-border-line.m-current .b-stats-row__name.g-md-text {
        color: #000 !important;
        opacity: 1 !important;
        font-weight: 600 !important;
      }
      .b-stats-wrap .b-stats-row[data-of-stats-alltime] .b-stats-row__content .b-stats-row__label.m-border-line:not(.m-current):not(.m-total) .b-stats-row__name.g-md-text {
        color: #8a96a3 !important;
        opacity: 0.6 !important;
        font-weight: 400 !important;
      }
      /* Clickable category labels */
      .b-stats-row[data-of-stats-generated] .b-stats-row__label.m-border-line:not(.m-total),
      .b-stats-row[data-of-stats-alltime] .b-stats-row__label.m-border-line:not(.m-total) {
        cursor: pointer;
      }
      /* All time row chart wrapper - same as month charts */
      .b-stats-row[data-of-stats-alltime] .b-chart__wrapper {
        min-height: 200px;
      }
      .b-stats-row[data-of-stats-alltime] .b-chart__wrapper canvas[data-of-stats-overlay] {
        display: block;
        box-sizing: border-box;
        width: 608px;
        height: 200px;
      }
    `;
    document.documentElement.appendChild(hideStatsStyle);
    
    // Dynamic dark mode styles for generated category labels
    var darkModeStatsStyle = document.createElement('style');
    darkModeStatsStyle.id = 'of-stats-dark-mode-labels';
    function updateDarkModeLabels() {
      if (!document.body) return;
      var dark = isDarkMode();
      darkModeStatsStyle.textContent = dark ? '\
        .b-stats-wrap .b-stats-row[data-of-stats-generated] .b-stats-row__content .b-stats-row__label.m-border-line.m-active .b-stats-row__name.g-md-text { color: #fff !important; }\
        .b-stats-wrap .b-stats-row[data-of-stats-alltime] .b-stats-row__content .b-stats-row__label.m-border-line.m-current .b-stats-row__name.g-md-text { color: #fff !important; }\
      ' : '';
    }
    document.documentElement.appendChild(darkModeStatsStyle);
    
    // Theme observer for /my/stats/earnings charts - redraw on dark/light switch
    // Deferred until body exists
    function setupStatsThemeObserver() {
      if (!document.body) {
        setTimeout(setupStatsThemeObserver, 50);
        return;
      }
      updateDarkModeLabels();
      // Also re-check after short delays to catch late body style application
      setTimeout(updateDarkModeLabels, 100);
      setTimeout(updateDarkModeLabels, 300);
      setTimeout(updateDarkModeLabels, 600);
      setTimeout(updateDarkModeLabels, 1000);
      var statsLastDarkMode = isDarkMode();
      function redrawStatsChartsOnThemeChange() {
        var currentDark = isDarkMode();
        if (currentDark !== statsLastDarkMode) {
          statsLastDarkMode = currentDark;
          updateDarkModeLabels();
          log('OF Stats: Theme changed on stats page, redrawing charts');
          
          var alltimeCanvases = document.querySelectorAll('canvas[data-of-stats-alltime-canvas]');
          var monthCanvases = document.querySelectorAll('canvas[data-of-stats-month-canvas]');
          
          if (alltimeCanvases.length === 0) {
            // Canvases were destroyed by OF re-render, re-apply everything
            log('OF Stats: No overlay canvases found after theme change, scheduling re-apply...');
            var reapplyAttempts = 0;
            function tryReapplyAfterThemeChange() {
              reapplyAttempts++;
              if (reapplyAttempts > 25) {
                log('OF Stats: Gave up re-applying after theme change');
                return;
              }
              var container = document.querySelector('.b-stats-wrap');
              var originalCanvas = document.querySelector('.b-chart__wrapper canvas');
              if (!container || !originalCanvas) {
                setTimeout(tryReapplyAfterThemeChange, 200);
                return;
              }
              log('OF Stats: DOM ready after theme change, re-applying (attempt ' + reapplyAttempts + ')');
              document.querySelectorAll('[data-of-stats-modified]').forEach(function(el) {
                el.removeAttribute('data-of-stats-modified');
              });
              container.removeAttribute('data-of-stats-months-applied');
              applyMonthlyEarningsEarly();
              applyEarningStats();
              updateDarkModeLabels();
              // Verify overlay was created, retry if not
              setTimeout(function() {
                var overlay = document.querySelector('canvas[data-of-stats-alltime-canvas]');
                if (!overlay) {
                  log('OF Stats: Overlay not created, retrying...');
                  setTimeout(tryReapplyAfterThemeChange, 300);
                } else {
                  log('OF Stats: Theme switch re-apply successful');
                  updateDarkModeLabels();
                }
              }, 150);
            }
            setTimeout(tryReapplyAfterThemeChange, 150);
            return;
          }
          
          // Redraw alltime overlay canvases (clear position cache for theme font change)
          alltimeCanvases.forEach(function(canvas) {
            canvas._fixedDatePositions = null;
            canvas._fixedDateLabels = null;
            var chartData = canvas._chartData;
            if (chartData) {
              var ctx = canvas.getContext('2d');
              if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
              drawAllTimeChartCanvasNoAnimation(canvas, chartData);
            }
          });
          // Redraw month chart canvases
          monthCanvases.forEach(function(canvas) {
            canvas._fixedDatePositions = null;
            canvas._fixedDateLabels = null;
            var chartData = canvas._chartData;
            if (chartData) {
              var ctx = canvas.getContext('2d');
              if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
              drawMonthChartCanvasNoAnimation(canvas, chartData);
            }
          });
        }
      }
      var statsThemeObserver = new MutationObserver(function() {
        redrawStatsChartsOnThemeChange();
      });
      statsThemeObserver.observe(document.body, { attributes: true, attributeFilter: ['style', 'class'] });
      statsThemeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class'] });
      // Also catch theme button click
      document.addEventListener('click', function(e) {
        var btn = e.target.closest('[data-name="SwitchTheme"]');
        if (btn) {
          [10, 30, 60, 100, 150, 250, 400].forEach(function(delay) {
            setTimeout(redrawStatsChartsOnThemeChange, delay);
          });
        }
      }, true);
    }
    setupStatsThemeObserver();
  }
  
  // Hide original Earnings section content until we replace it
  // Always hide when plugin is enabled - we generate data from /my/stats/earnings even without Earnings counts
  if (window.location.pathname.includes('/my/statistics/statements/earnings')) {
    // Check if chart generation is disabled (user clicked Reset)
    var statisticsChartDisabled = false;
    try {
      statisticsChartDisabled = localStorage.getItem('ofStatsStatisticsChartDisabled') === 'true';
    } catch(e) {}
    
    // Check if earnings counts are set
    var hasEarningsCounts = cachedSettings && (
      (parseInt(cachedSettings.earningsCount) || 0) > 0 || 
      (parseInt(cachedSettings.earningsCompleteCount) || 0) > 0
    );
    // Store globally for SPA navigation handlers
    window.ofStatsHasEarningsCounts = hasEarningsCounts;
    
    // Hide when plugin is enabled AND chart generation is NOT disabled
    if (cachedSettings && cachedSettings.enabled && !statisticsChartDisabled) {
      var hideEarningsStyle = document.createElement('style');
      hideEarningsStyle.id = 'of-stats-hide-earnings-content';
      // Only hide transactions table (.b-separate-section) if earnings counts are set
      var transactionsCSS = hasEarningsCounts ? `
        .b-statistics-page-content__wrapper[data-of-stats-applied] .b-separate-section:not([data-of-stats-generated]),
        [data-of-stats-original-hidden].b-separate-section {
          display: none !important;
        }
      ` : '';
      hideEarningsStyle.textContent = `
        /* Hide original Earnings section content (not header) until replaced */
        .b-useful-data:not([data-of-stats-processed]) .b-statistics-columns,
        .b-useful-data:not([data-of-stats-processed]) .b-useful-data__empty {
          visibility: hidden !important;
          height: 0 !important;
          overflow: hidden !important;
        }
        /* After processing: hide ALL native children except header and our generated wrapper */
        .b-useful-data[data-of-stats-processed] > *:not(.b-useful-data__header):not([data-of-stats-earnings-generated]) {
          display: none !important;
        }
        /* Hide original chart and summary when our generated content exists */
        .b-statistics-page-content__wrapper[data-of-stats-applied] .b-elements-determinant:not([data-of-stats-generated]),
        .b-statistics-page-content__wrapper[data-of-stats-applied] .b-chart:not([data-of-stats-generated]) {
          display: none !important;
        }
        /* Hide elements marked as original-hidden (except transactions if no earnings counts) */
        [data-of-stats-original-hidden]:not(.b-separate-section) {
          display: none !important;
        }
        ${transactionsCSS}
      `;
      document.documentElement.appendChild(hideEarningsStyle);
    }
  }
  
  // Helper to safely get className as string (handles SVGAnimatedString)
  function getClassStr(element) {
    if (!element) return '';
    var cn = element.className || '';
    return typeof cn === 'string' ? cn : (cn.baseVal || '');
  }
  
  // Listen for settings changes from content.js (Apply Changes button)
  window.addEventListener('ofStatsSettingsChanged', function(e) {
    if (e.detail) {
      cachedSettings = e.detail;
      log('OF Stats: cachedSettings updated from Apply Changes');
    }
  });
  
  // Store last hovered item for tooltip replacement
  let lastHoveredType = null; // 'fans' or 'following'
  
  // Store current active category for syncing between All time and months
  let currentActiveCategory = 'subscriptions';
  
  // Convert K/M notation to full number (42.5K -> 42500)
  function convertToFullNumber(value) {
    if (!value) return '';
    const str = value.toString().trim().toUpperCase();
    
    // Check for K (thousands)
    const kMatch = str.match(/^([\d.]+)\s*K$/i);
    if (kMatch) {
      return Math.round(parseFloat(kMatch[1]) * 1000).toString();
    }
    
    // Check for M (millions)
    const mMatch = str.match(/^([\d.]+)\s*M$/i);
    if (mMatch) {
      return Math.round(parseFloat(mMatch[1]) * 1000000).toString();
    }
    
    // Already a number - just extract digits
    return str.replace(/[^\d]/g, '');
  }
  
  // Function to replace tooltip content - only on own profile page
  function replaceTooltip(tooltip) {
    if (!tooltip || !cachedSettings || !cachedSettings.enabled) return;
    // Skip our own custom tooltips
    if (tooltip.hasAttribute('data-of-stats-custom')) return;
    // Only replace tooltips on our own profile page
    if (!isOwnProfilePage()) return;
    
    // Flag to prevent recursive observer calls
    let isReplacing = false;
    let ourValue = null; // Store our value to keep replacing
    
    // Function to determine tooltip type by finding which element is hovered
    function detectHoveredType() {
      // Primary: check which sidebar element is currently hovered
      const fansItem = document.querySelector('.l-sidebar__user-data__item:first-child');
      const followingItem = document.querySelector('.l-sidebar__user-data__item:nth-child(2)');
      
      if (fansItem && fansItem.matches(':hover')) return 'fans';
      if (followingItem && followingItem.matches(':hover')) return 'following';
      
      // Secondary: use tracked type but VALIDATE against tooltip position
      // This prevents stale lastHoveredType from corrupting unrelated tooltips
      if (lastHoveredType) {
        const tooltipRect = tooltip.getBoundingClientRect();
        const targetItem = lastHoveredType === 'fans' ? fansItem : followingItem;
        if (targetItem) {
          const itemRect = targetItem.getBoundingClientRect();
          const hDist = Math.abs(tooltipRect.left + tooltipRect.width/2 - (itemRect.left + itemRect.width/2));
          const vDist = Math.abs(tooltipRect.top - itemRect.top);
          if (hDist < 100 && vDist < 100) {
            return lastHoveredType;
          }
        }
        // Tooltip is far from expected sidebar item — stale lastHoveredType, ignore
        return null;
      }
      
      // Tertiary: check by tooltip position alone
      const tooltipRect = tooltip.getBoundingClientRect();
      if (fansItem) {
        const fansRect = fansItem.getBoundingClientRect();
        if (Math.abs(tooltipRect.left + tooltipRect.width/2 - (fansRect.left + fansRect.width/2)) < 50) {
          return 'fans';
        }
      }
      if (followingItem) {
        const followingRect = followingItem.getBoundingClientRect();
        if (Math.abs(tooltipRect.left + tooltipRect.width/2 - (followingRect.left + followingRect.width/2)) < 50) {
          return 'following';
        }
      }
      
      return null;
    }
    
    // Determine our value once
    function determineOurValue() {
      if (ourValue) return ourValue;
      
      const hoveredType = detectHoveredType();
      
      if (hoveredType === 'fans') {
        if (cachedSettings.fansTooltip) {
          ourValue = cachedSettings.fansTooltip;
        } else if (cachedSettings.fansCount) {
          ourValue = convertToFullNumber(cachedSettings.fansCount);
        }
      } else if (hoveredType === 'following') {
        if (cachedSettings.followingTooltip) {
          ourValue = cachedSettings.followingTooltip;
        } else if (cachedSettings.followingCount) {
          ourValue = convertToFullNumber(cachedSettings.followingCount);
        }
      }
      
      return ourValue;
    }
    
    // Function to actually replace the text
    function doReplace() {
      // Prevent recursion
      if (isReplacing) return;
      
      // Find the inner element where text is displayed
      const inner = tooltip.querySelector('.tooltip-inner');
      if (!inner) return;
      
      const text = inner.textContent.trim();
      const targetValue = determineOurValue();
      
      // If already our value, nothing to do
      if (text === targetValue) return;
      
      // Check if it's a number (tooltip shows exact count) or replace if original is trying to overwrite
      if (targetValue && /^\d+$/.test(text)) {
        // Save original width before change
        const originalWidth = tooltip.offsetWidth;
        
        isReplacing = true;
        inner.textContent = targetValue;
        isReplacing = false;
        
        // Recenter tooltip after content change
        recenterTooltip(tooltip, originalWidth);
      }
    }
    
    // Try to replace immediately
    doReplace();
    
    // Keep observing - OnlyFans may try to overwrite our value
    const tooltipObserver = new MutationObserver(function() {
      doReplace();
    });
    tooltipObserver.observe(tooltip, { childList: true, subtree: true, characterData: true });
    
    // Also try with small delays for async content
    setTimeout(doReplace, 10);
    setTimeout(doReplace, 50);
    setTimeout(doReplace, 100);
    setTimeout(doReplace, 200);
    
    // Disconnect observer when tooltip is removed from DOM
    const cleanupObserver = new MutationObserver(function(mutations) {
      if (!document.body.contains(tooltip)) {
        tooltipObserver.disconnect();
        cleanupObserver.disconnect();
      }
    });
    cleanupObserver.observe(document.body, { childList: true, subtree: true });
    
    // Fallback disconnect after 5 seconds
    setTimeout(function() {
      tooltipObserver.disconnect();
      cleanupObserver.disconnect();
    }, 5000);
  }
  
  // Function to recenter tooltip after text change
  function recenterTooltip(tooltip, originalWidth) {
    if (!tooltip) return;
    
    // Force reflow to get new width
    tooltip.offsetHeight;
    const newWidth = tooltip.offsetWidth;
    
    // Calculate width difference
    const widthDiff = newWidth - originalWidth;
    
    if (widthDiff !== 0) {
      // Get current transform - OnlyFans uses translate3d(X, Y, 0)
      const computedStyle = window.getComputedStyle(tooltip);
      const transform = computedStyle.transform;
      
      if (transform && transform !== 'none') {
        // Parse matrix or translate3d values
        // matrix(1, 0, 0, 1, X, Y) or translate3d(X, Y, Z)
        const matrixMatch = transform.match(/matrix.*\((.+)\)/);
        if (matrixMatch) {
          const values = matrixMatch[1].split(', ');
          // For matrix(a, b, c, d, tx, ty) - tx is at index 4, ty at index 5
          let tx = parseFloat(values[4]) || 0;
          let ty = parseFloat(values[5]) || 0;
          
          // Adjust X position by half of width difference
          tx = tx - (widthDiff / 2);
          
          // Apply new transform
          tooltip.style.transform = `translate3d(${tx}px, ${ty}px, 0px)`;
        }
      }
      
      // Recenter the arrow - it should be at center of tooltip
      const arrow = tooltip.querySelector('.tooltip-arrow');
      if (arrow) {
        // Arrow should be at (newWidth / 2) - 5px (5px is half arrow width)
        const arrowLeft = (newWidth / 2) - 5;
        arrow.style.left = arrowLeft + 'px';
      }
    }
  }
  
  // Track hover on fans/following
  document.addEventListener('mouseover', function(e) {
    const item = e.target.closest('.l-sidebar__user-data__item');
    if (item) {
      const allItems = document.querySelectorAll('.l-sidebar__user-data__item');
      const index = Array.from(allItems).indexOf(item);
      if (index === 0) lastHoveredType = 'fans';
      else if (index === 1) lastHoveredType = 'following';
    }
  }, true);
  
  // Force-create tooltip for fans/following when OF doesn't show one (<1K fans)
  // Only on own profile page
  var customFansTooltipEl = null;
  var customFansTooltipTimeout = null;
  
  function getCustomFansTooltipValue(type) {
    if (!cachedSettings || !cachedSettings.enabled) return null;
    if (type === 'fans') {
      if (cachedSettings.fansTooltip) return cachedSettings.fansTooltip;
      if (cachedSettings.fansCount) return convertToFullNumber(cachedSettings.fansCount);
    } else if (type === 'following') {
      if (cachedSettings.followingTooltip) return cachedSettings.followingTooltip;
      if (cachedSettings.followingCount) return convertToFullNumber(cachedSettings.followingCount);
    }
    return null;
  }
  
  function showCustomFansTooltip(targetItem, value) {
    hideCustomFansTooltip();
    
    // Center over the whole item block (same as native OF tooltip)
    var anchorEl = targetItem;
    
    var el = document.createElement('div');
    el.className = 'tooltip vue-tooltip-theme';
    el.setAttribute('role', 'tooltip');
    el.setAttribute('aria-hidden', 'false');
    el.setAttribute('x-placement', 'top');
    el.setAttribute('data-of-stats-custom', 'true');
    el.style.position = 'fixed';
    el.style.zIndex = '99999';
    
    var arrow = document.createElement('div');
    arrow.className = 'tooltip-arrow';
    // Force exact center: 50% minus half-arrow-width, clear any OF margin
    arrow.style.cssText = 'left: 50% !important; margin-left: -3px !important; margin-right: 0 !important; transform: none !important;';
    el.appendChild(arrow);
    
    var inner = document.createElement('div');
    inner.className = 'tooltip-inner';
    inner.textContent = value;
    el.appendChild(inner);
    
    document.body.appendChild(el);
    customFansTooltipEl = el;
    
    // getBoundingClientRect gives viewport coords — perfect for position:fixed
    var rect = anchorEl.getBoundingClientRect();
    var tooltipWidth = el.offsetWidth;
    var tooltipHeight = el.offsetHeight;
    
    // Center tooltip above the whole item block with 5px gap, nudged 3px left
    var left = rect.left + (rect.width / 2) - (tooltipWidth / 2) - 2;
    var top = rect.top - tooltipHeight - 5;
    
    el.style.left = Math.round(left) + 'px';
    el.style.top = Math.round(top) + 'px';
  }
  
  function hideCustomFansTooltip() {
    if (customFansTooltipEl && customFansTooltipEl.parentNode) {
      customFansTooltipEl.parentNode.removeChild(customFansTooltipEl);
    }
    customFansTooltipEl = null;
    if (customFansTooltipTimeout) {
      clearTimeout(customFansTooltipTimeout);
      customFansTooltipTimeout = null;
    }
  }
  
  // Track which user-data item the mouse is currently over
  var currentHoveredItem = null;
  
  document.addEventListener('mouseover', function(e) {
    if (!isOwnProfilePage()) return;
    var item = e.target.closest('.l-sidebar__user-data__item');
    
    // Mouse moved to something outside user-data items
    if (!item) {
      if (currentHoveredItem) {
        currentHoveredItem = null;
        hideCustomFansTooltip();
      }
      return;
    }
    
    // Same item — do nothing
    if (item === currentHoveredItem) return;
    
    // New item — clean up previous
    hideCustomFansTooltip();
    currentHoveredItem = item;
    
    var allItems = document.querySelectorAll('.l-sidebar__user-data__item');
    var index = Array.from(allItems).indexOf(item);
    var type = index === 0 ? 'fans' : (index === 1 ? 'following' : null);
    if (!type) return;
    
    var value = getCustomFansTooltipValue(type);
    if (!value) return;
    
    // Wait for OF to potentially create its own tooltip
    customFansTooltipTimeout = setTimeout(function() {
      // Double check we're still hovering the same item
      if (currentHoveredItem !== item) return;
      
      // Check if OF already created a native tooltip
      var existingTooltip = document.querySelector('.tooltip.vue-tooltip-theme:not([data-of-stats-custom])');
      if (existingTooltip) return; // OF handled it, replaceTooltip will handle the value
      
      // OF didn't create one — show our custom tooltip
      showCustomFansTooltip(item, value);
    }, 150);
  }, true);
  
  document.addEventListener('mouseout', function(e) {
    var item = e.target.closest('.l-sidebar__user-data__item');
    if (!item || item !== currentHoveredItem) return;
    
    // Check if mouse moved to another element inside the same item
    var related = e.relatedTarget;
    if (related && item.contains(related)) return;
    
    // Mouse truly left the item
    currentHoveredItem = null;
    lastHoveredType = null;
    hideCustomFansTooltip();
  }, true);
  
  // Get current balance value as integer (no decimals, no commas)
  // Cache for found balance from DOM (to use when section is collapsed/expanded)
  // Use window object to persist across potential re-initializations
  if (typeof window.ofStatsCachedDOMBalance === 'undefined') {
    window.ofStatsCachedDOMBalance = null;
  }
  
  function getCurrentBalanceInteger() {
    try {
      // First try to get from cached settings (user-defined value has highest priority)
      if (cachedSettings && cachedSettings.currentBalance) {
        // Remove $, commas, and everything after decimal point
        var cleanValue = cachedSettings.currentBalance.toString()
          .replace(/[$,]/g, '')
          .split('.')[0]
          .trim();
        var intValue = parseInt(cleanValue);
        if (!isNaN(intValue) && intValue > 0) {
          return intValue;
        }
      }
      
      // Fallback 1: read from DOM - /my/statements/earnings page
      var balanceEl = document.querySelector('.b-statements__current-balance__value');
      if (balanceEl) {
        var text = balanceEl.textContent || '';
        var cleanValue2 = text.replace(/[$,]/g, '').split('.')[0].trim();
        var intValue2 = parseInt(cleanValue2);
        if (!isNaN(intValue2) && intValue2 > 0) {
          window.ofStatsCachedDOMBalance = intValue2; // Cache found value
          return intValue2;
        }
      }
      
      // Fallback 2: read from DOM - /my/statistics/statements/earnings page
      var balanceEl2 = document.querySelector('.b-statements-balances__col.m-current .b-statements-balances__sum');
      if (balanceEl2) {
        var text2 = balanceEl2.textContent || '';
        var cleanValue3 = text2.replace(/[$,]/g, '').split('.')[0].trim();
        var intValue3 = parseInt(cleanValue3);
        if (!isNaN(intValue3) && intValue3 > 0) {
          window.ofStatsCachedDOMBalance = intValue3; // Cache found value
          return intValue3;
        }
      }
      
      // Fallback 3: use cached DOM balance if we found it before
      if (window.ofStatsCachedDOMBalance && window.ofStatsCachedDOMBalance > 0) {
        return window.ofStatsCachedDOMBalance;
      }
    } catch(e) {
      log('OF Stats: Error getting balance:', e);
    }
    return 0;
  }
  
  // Format integer with commas for thousands (manual implementation for reliability)
  function formatIntegerWithCommas(num) {
    // Ensure num is a valid number
    var n = parseInt(num, 10);
    if (isNaN(n)) return '0';
    // Manual comma insertion (works reliably in all contexts)
    var str = n.toString();
    var result = '';
    var count = 0;
    for (var i = str.length - 1; i >= 0; i--) {
      if (count > 0 && count % 3 === 0) {
        result = ',' + result;
      }
      result = str[i] + result;
      count++;
    }
    return result;
  }
  
  // Create and show withdrawal modal
  function showWithdrawalModal() {
    // Remove existing modal if any
    var existingModal = document.getElementById('of-stats-withdrawal-modal');
    if (existingModal) existingModal.remove();
    var existingBackdrop = document.getElementById('of-stats-modal-backdrop');
    if (existingBackdrop) existingBackdrop.remove();
    
    // Try to refresh balance from DOM before showing modal
    // This handles cases where user switched dropdown options and DOM was recreated
    var balanceEl = document.querySelector('.b-statements__current-balance__value');
    if (balanceEl) {
      var text = balanceEl.textContent || '';
      var cleanValue = text.replace(/[$,]/g, '').split('.')[0].trim();
      var intValue = parseInt(cleanValue);
      if (!isNaN(intValue) && intValue > 0) {
        window.ofStatsCachedDOMBalance = intValue;
      }
    }
    var balanceEl2 = document.querySelector('.b-statements-balances__col.m-current .b-statements-balances__sum');
    if (balanceEl2) {
      var text2 = balanceEl2.textContent || '';
      var cleanValue2 = text2.replace(/[$,]/g, '').split('.')[0].trim();
      var intValue2 = parseInt(cleanValue2);
      if (!isNaN(intValue2) && intValue2 > 0) {
        window.ofStatsCachedDOMBalance = intValue2;
      }
    }
    
    var maxAmount = getCurrentBalanceInteger();
    var maxAmountFormatted = formatIntegerWithCommas(maxAmount);
    
    log('OF Stats: showWithdrawalModal - maxAmount:', maxAmount, 'formatted:', maxAmountFormatted, 'cachedDOMBalance:', window.ofStatsCachedDOMBalance, 'cachedSettings.currentBalance:', cachedSettings ? cachedSettings.currentBalance : 'no settings');
    
    // Make original page button disabled/grey when modal is open (like original OF behavior)
    // Only target the main page button, not buttons inside modals
    document.querySelectorAll('button[data-of-stats-processed]').forEach(function(btn) {
      if (isWithdrawalButton(btn.textContent)) {
        // Remove all inline styles so OnlyFans CSS can apply disabled styles
        btn.removeAttribute('style');
        btn.setAttribute('disabled', 'disabled');
      }
    });
    
    // Create backdrop
    var backdrop = document.createElement('div');
    backdrop.id = 'of-stats-modal-backdrop';
    backdrop.className = 'modal-backdrop fade show';
    backdrop.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 1040;';
    
    // Create modal
    var modal = document.createElement('div');
    modal.id = 'of-stats-withdrawal-modal';
    modal.className = 'modal fade show';
    modal.style.cssText = 'display: block; position: fixed; top: 0; left: 0; width: 100%; height: 100%; z-index: 1050; overflow: auto;';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    
    var lang = getPageLanguage();
    var modalTitle = lang === 'ru' ? 'Выплаты вручную' : lang === 'es' ? 'Pagos manuales' : lang === 'de' ? 'Manuelle Auszahlungen' : 'Manual payouts';
    var modalPlaceholder = lang === 'ru' ? 'Сумма выво...' : lang === 'es' ? 'Monto de retiro' : lang === 'de' ? 'Auszahlungsbetrag' : 'Withdrawal amount';
    var modalMinimum = lang === 'ru' ? 'Минимум $20 USD' : lang === 'es' ? 'Mínimo $20 USD' : lang === 'de' ? 'Mindestens $20 USD' : 'Minimum $20 USD';
    var modalMax = lang === 'ru' ? 'Максимум' : lang === 'es' ? 'Máx' : lang === 'de' ? 'Max' : 'Max';
    var modalCancel = lang === 'ru' ? 'Отменить' : lang === 'es' ? 'Cancelar' : lang === 'de' ? 'Abbrechen' : 'Cancel';
    var modalSubmit = lang === 'ru' ? 'Запрос на вывод' : lang === 'es' ? 'Solicitar retiro' : lang === 'de' ? 'Auszahlung anfordern' : 'Request withdrawal';
    modal.innerHTML = '<div class="modal-dialog modal-sm modal-dialog-centered"><span tabindex="0"></span><div id="ModalPayouts___BV_modal_content_" tabindex="-1" class="modal-content"><header id="ModalPayouts___BV_modal_header_" class="modal-header"><h4 class="modal-title"> ' + modalTitle + ' </h4></header><div id="ModalPayouts___BV_modal_body_" class="modal-body m-reset-body-padding-bottom"><form id="of-stats-withdrawal-form"><div class="b-inline-form d-flex align-items-start"><div class="g-input__wrapper mr-2 flex-fill-1 m-reset-bottom-gap" step="1"><div class="g-input__wrapper input-text-field m-empty m-reset-bottom-gap"><div class="" id="of-stats-input-wrapper"><div class="v-input form-control g-input mb-0 theme--light v-text-field v-text-field--is-booted v-text-field--enclosed v-text-field--outlined v-text-field--placeholder m-placeholder-gap" id="of-stats-v-input"><div class="v-input__control"><div class="v-input__slot"><fieldset aria-hidden="true"><legend style="width: 0px;"><span class="notranslate">\u200B</span></legend></fieldset><div class="v-text-field__slot" id="of-stats-text-slot"><input at-attr="input" inputmode="decimal" autocomplete="tip-input" name="" required="required" id="of-stats-tip-input" placeholder="' + modalPlaceholder + '" type="text"></div></div><div class="v-text-field__details"><div class="v-messages theme--light"><div class="v-messages__wrapper"></div></div></div></div><div class="v-input__append-outer"><div class="g-input__help"><div>' + modalMinimum + '</div></div></div></div></div></div></div><button type="button" class="g-btn m-lg m-rounded" id="of-stats-max-btn"><span class="g-spacer-r">' + modalMax + '</span><span class=""> $' + maxAmountFormatted + ' </span></button></div><div class="modal-footer"><button type="button" class="g-btn m-flat m-btn-gaps m-reset-width" id="of-stats-cancel-btn"> ' + modalCancel + ' </button><button type="submit" class="g-btn m-flat m-btn-gaps m-reset-width" id="of-stats-submit-btn" disabled="disabled"> ' + modalSubmit + ' </button></div></form></div></div><span tabindex="0"></span></div>';
    
    document.body.appendChild(backdrop);
    document.body.appendChild(modal);
    document.body.classList.add('modal-open');
    
    var inputEl = document.getElementById('of-stats-tip-input');
    var submitBtn = document.getElementById('of-stats-submit-btn');
    var maxBtn = document.getElementById('of-stats-max-btn');
    var textSlot = document.getElementById('of-stats-text-slot');
    var vInput = document.getElementById('of-stats-v-input');
    var inputWrapper = document.getElementById('of-stats-input-wrapper');
    var cancelBtn = document.getElementById('of-stats-cancel-btn');
    
    log('OF Stats: Modal elements:', inputEl, submitBtn, maxBtn, textSlot, vInput, inputWrapper, cancelBtn);
    
    // Function to add $ prefix when there's a value
    var updateInputState = function() {
      try {
        var currentInputEl = document.getElementById('of-stats-tip-input');
        var currentSubmitBtn = document.getElementById('of-stats-submit-btn');
        var currentTextSlot = document.getElementById('of-stats-text-slot');
        var currentInputWrapper = document.getElementById('of-stats-input-wrapper');
        var currentVInput = document.getElementById('of-stats-v-input');
        
        if (!currentInputEl || !currentSubmitBtn) {
          log('OF Stats: updateInputState - elements not found');
          return;
        }
        
        var hasValue = currentInputEl.value.trim().length > 0;
        var existingPrefix = currentTextSlot ? currentTextSlot.querySelector('.v-text-field__prefix') : null;
        log('OF Stats: updateInputState called, hasValue:', hasValue);
        
        var styleEl = document.getElementById('of-stats-submit-style');
        if (!styleEl) {
          styleEl = document.createElement('style');
          styleEl.id = 'of-stats-submit-style';
          styleEl.textContent = '#of-stats-submit-btn:not([disabled]):not(.disabled) { color: #00aff0 !important; opacity: 1 !important; pointer-events: auto !important; cursor: pointer !important; background-color: transparent !important; } #of-stats-submit-btn:not([disabled]):not(.disabled):hover { background-color: rgba(0, 145, 234, 0.06) !important; color: #0091ea !important; } #of-stats-submit-btn[disabled], #of-stats-submit-btn.disabled { color: #8a96a3 !important; opacity: 0.4 !important; pointer-events: none !important; cursor: default !important; }';
          document.head.appendChild(styleEl);
        }
        
        if (hasValue) {
          // Add $ prefix if not exists
          if (currentTextSlot && !existingPrefix) {
            var prefix = document.createElement('div');
            prefix.className = 'v-text-field__prefix';
            prefix.textContent = '$';
            currentTextSlot.prepend(prefix);
          }
          // Update classes for filled state
          if (currentInputWrapper) currentInputWrapper.className = 'm-filled';
          if (currentVInput) currentVInput.className = 'v-input form-control g-input mb-0 v-input--is-label-active v-input--is-dirty theme--light v-text-field v-text-field--prefix v-text-field--is-booted v-text-field--enclosed v-text-field--outlined v-text-field--placeholder m-placeholder-gap';
          // Enable submit button - убираем всё что делает её неактивной, стили через CSS
          currentSubmitBtn.removeAttribute('disabled');
          currentSubmitBtn.removeAttribute('aria-disabled');
          currentSubmitBtn.classList.remove('disabled');
          currentSubmitBtn.removeAttribute('style');
          currentSubmitBtn.style.cssText = '';
          log('OF Stats: Submit button ENABLED via CSS');
        } else {
          // Remove $ prefix
          if (existingPrefix) {
            existingPrefix.remove();
          }
          // Reset classes
          if (currentInputWrapper) currentInputWrapper.className = '';
          if (currentVInput) currentVInput.className = 'v-input form-control g-input mb-0 theme--light v-text-field v-text-field--is-booted v-text-field--enclosed v-text-field--outlined v-text-field--placeholder m-placeholder-gap';
          // Disable submit button - добавляем всё что делает её неактивной, стили через CSS 
          currentSubmitBtn.setAttribute('disabled', 'disabled');
          currentSubmitBtn.classList.add('disabled');
          currentSubmitBtn.removeAttribute('style');
          currentSubmitBtn.style.cssText = '';
          log('OF Stats: Submit button DISABLED via CSS');
        }
      } catch (e) {
        logError('OF Stats: updateInputState error:', e);
      }
    };
    
    // Set initial disabled state for submit button (стили через CSS)
    submitBtn.classList.add('disabled');
    log('OF Stats: Initial disabled state set');
    
    // Listen for input changes
    inputEl.addEventListener('input', updateInputState);
    
    // Обработчики фокуса — синяя рамка при клике на поле ввода (как на оригинальном сайте)
    inputEl.addEventListener('focus', function() {
      if (vInput) {
        vInput.classList.add('v-input--is-focused');
        vInput.classList.add('primary--text');
      }
      // Синяя рамка через fieldset
      var fieldset = modal.querySelector('#of-stats-v-input fieldset');
      if (fieldset) {
        fieldset.style.borderColor = '#00aff0';
      }
    });
    inputEl.addEventListener('blur', function() {
      if (vInput) {
        vInput.classList.remove('v-input--is-focused');
        vInput.classList.remove('primary--text');
      }
      var fieldset = modal.querySelector('#of-stats-v-input fieldset');
      if (fieldset) {
        fieldset.style.borderColor = '';
      }
    });
    
    // Close modal function
    var closeModal = function() {
      modal.remove();
      backdrop.remove();
      document.body.classList.remove('modal-open');
      // Restore original page button to active state
      document.querySelectorAll('button[data-of-stats-processed]').forEach(function(btn) {
        if (isWithdrawalButton(btn.textContent)) {
          btn.removeAttribute('disabled');
          // Remove inline styles - button will use OnlyFans default active styles
          btn.removeAttribute('style');
        }
      });
    };
    
    // Close on backdrop click
    modal.addEventListener('click', function(e) {
      if (e.target === modal) closeModal();
    });
    
    // Cancel button
    cancelBtn.addEventListener('click', closeModal);
    
    // Max button - fill input with max amount and disable button
    // Используем делегирование событий на случай если кнопка пересоздаётся
    modal.addEventListener('click', function(e) {
      // Проверяем что клик был по кнопке MAX или её дочерним элементам
      var target = e.target;
      var maxButton = target.closest('#of-stats-max-btn');
      if (!maxButton) return;
      
      log('OF Stats: MAX button clicked (delegated)');
      
      // Получаем актуальные элементы из DOM
      var currentInputEl = document.getElementById('of-stats-tip-input');
      var currentSubmitBtn = document.getElementById('of-stats-submit-btn');
      
      if (currentInputEl) {
        currentInputEl.value = maxAmount;
      }
      
      // Disable the Max button after click
      maxButton.setAttribute('disabled', 'disabled');
      
      // ПРИНУДИТЕЛЬНО делаем Request withdrawal активной
      if (currentSubmitBtn) {
        // Убираем ВСЁ что делает кнопку неактивной
        currentSubmitBtn.removeAttribute('disabled');
        currentSubmitBtn.removeAttribute('aria-disabled');
        currentSubmitBtn.classList.remove('disabled');
        currentSubmitBtn.removeAttribute('style');
        currentSubmitBtn.style.cssText = '';
        // Ставим точные такие же классы как у Cancel
        currentSubmitBtn.className = 'g-btn m-flat m-btn-gaps m-reset-width';
        
        // Добавляем CSS правило
        var styleEl = document.getElementById('of-stats-submit-style');
        if (!styleEl) {
          styleEl = document.createElement('style');
          styleEl.id = 'of-stats-submit-style';
          document.head.appendChild(styleEl);
        }
        styleEl.textContent = '#of-stats-submit-btn:not([disabled]):not(.disabled) { color: #00aff0 !important; opacity: 1 !important; background: none !important; background-color: transparent !important; pointer-events: auto !important; cursor: pointer !important; } #of-stats-submit-btn:not([disabled]):not(.disabled):hover { background-color: rgba(0, 145, 234, 0.06) !important; color: #0091ea !important; }';
        
        log('OF Stats: Submit button activated - className:', currentSubmitBtn.className, 'disabled:', currentSubmitBtn.disabled, 'style:', currentSubmitBtn.getAttribute('style'));
      }
      
      // Update input state (add $ prefix)
      updateInputState();
    });
    
    // Form submit
    document.getElementById('of-stats-withdrawal-form').addEventListener('submit', function(e) {
      e.preventDefault();
      var amount = inputEl.value;
      log('OF Stats: Withdrawal requested for $' + amount);
      closeModal();
    });
    
    log('OF Stats: Withdrawal modal opened with max $' + maxAmount);
  }
  
  // Function to activate withdrawal button
  function activateWithdrawButton(button) {
    if (!button || !cachedSettings || !cachedSettings.enabled) return;
    
    // Skip if already processed
    if (button.getAttribute('data-of-stats-processed')) return;
    button.setAttribute('data-of-stats-processed', 'true');
    
    // Just remove disabled, let OnlyFans CSS handle the active styling
    button.removeAttribute('disabled');
    
    // Clone to remove existing event listeners
    var newBtn = button.cloneNode(true);
    button.parentNode.replaceChild(newBtn, button);
    
    // Add our click handler
    newBtn.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      showWithdrawalModal();
    }, true);
    
    log('OF Stats: Withdrawal button activated');
  }
  
  // Function to replace element content immediately
  function replaceContent(element) {
    if (!element || !cachedSettings) return;
    
    const className = element.className || '';
    // className может быть объектом SVGAnimatedString, пробразуем в строку
    const classStr = typeof className === 'string' ? className : (className.baseVal || '');
    
    // If this is a profile count span, update only if its parent button is Fans
    // AND we're on our own profile page
    if (classStr.indexOf('b-profile__sections__count') !== -1) {
      try {
        const parentBtn = element.closest('button.b-profile__sections__item');
        if (parentBtn && parentBtn.getAttribute) {
          const label = (parentBtn.getAttribute('aria-label') || '').toLowerCase();
          // Only replace fans count on OUR profile page
          if (label.indexOf('fans') !== -1 && cachedSettings.fansCount && isOwnProfilePage()) {
            element.textContent = cachedSettings.fansCount.trim();
          }
        }
      } catch (e) {}
    }
    
    // Current Balance - /my/statements/earnings page
    if (classStr.indexOf('current-balance__value') !== -1 || classStr.indexOf('current-balance_value') !== -1) {
      if (cachedSettings.currentBalance) {
        const formatted = formatNumber(cachedSettings.currentBalance);
        element.textContent = '$' + formatted;
      }
    }
    
    // Pending Balance - /my/statements/earnings page
    if (classStr.indexOf('pending-balance__value') !== -1 || classStr.indexOf('pending-balance_value') !== -1) {
      if (cachedSettings.pendingBalance) {
        const formatted = formatNumber(cachedSettings.pendingBalance);
        element.textContent = '$' + formatted;
      }
    }
    
    // Balance sums on /my/statistics/statements/earnings page
    if (classStr.indexOf('b-statements-balances__sum') !== -1) {
      // Find parent column to determine which balance this is
      const parentCol = element.closest('.b-statements-balances__col');
      if (parentCol) {
        if (parentCol.classList.contains('m-current')) {
          // Current balance
          if (cachedSettings.currentBalance) {
            const formatted = formatNumber(cachedSettings.currentBalance);
            element.textContent = ' $' + formatted + ' ';
            element.classList.remove('m-zero-value');
          }
        } else {
          // Pending balance (column without m-current class)
          if (cachedSettings.pendingBalance) {
            const formatted = formatNumber(cachedSettings.pendingBalance);
            element.textContent = ' $' + formatted + ' ';
            element.classList.remove('m-zero-value');
          }
        }
      }
    }
    
    // Fans/Following counts - only on our own profile page
    if (classStr.indexOf('user-data__item__count') !== -1 && isOwnProfilePage()) {
      // Find which one it is by checking parent
      const parent = element.closest('.l-sidebar__user-data__item');
      if (parent) {
        const allItems = document.querySelectorAll('.l-sidebar__user-data__item');
        const index = Array.from(allItems).indexOf(parent);
        
        if (index === 0 && cachedSettings.fansCount) {
          element.textContent = ' ' + cachedSettings.fansCount + ' ';
          // Also update aria-label for tooltip
          const ariaValue = cachedSettings.fansCount.replace(/[^\d]/g, '') || cachedSettings.fansCount;
          parent.setAttribute('aria-label', ariaValue);
        } else if (index === 1 && cachedSettings.followingCount) {
          element.textContent = ' ' + cachedSettings.followingCount + ' ';
          // Also update aria-label for tooltip
          const ariaValue = cachedSettings.followingCount.replace(/[^\d]/g, '') || cachedSettings.followingCount;
          parent.setAttribute('aria-label', ariaValue);
        }
      }
    }
    
    // Profile page: replace Fans count inside profile sections (button with aria-label="Fans")
    // Only on our own profile page
    try {
      // If the element is a profile sections button, check aria-label
      if (element.tagName === 'BUTTON' && element.getAttribute && element.getAttribute('aria-label') && isOwnProfilePage()) {
        const label = (element.getAttribute('aria-label') || '').toLowerCase();
        if (label.indexOf('fans') !== -1) {
          const span = element.querySelector('span.b-profile__sections__count');
          if (span && cachedSettings.fansCount) {
            span.textContent = cachedSettings.fansCount.trim();
          }
        }
      }
    } catch (e) {}
    
    // Earning stats page: replace category values immediately
    if (isEarningStatsPage()) {
      // Check if this is a category row value (.b-stats-row__val)
      if (classStr.indexOf('b-stats-row__val') !== -1) {
        replaceEarningStatsValue(element);
      }
      // Check if this is total net value
      if (classStr.indexOf('b-stats-row__total-net') !== -1) {
        var span = element.querySelector('span');
        if (span) replaceEarningStatsValue(span);
      }
    }
  }
  
  // Check if we're on earning stats page
  function isEarningStatsPage() {
    return window.location.pathname.includes('/my/stats/earnings');
  }
  
  // Replace earning stats values immediately using cached/generated data
  function replaceEarningStatsValue(element) {
    if (!element || element.getAttribute('data-of-stats-modified')) return;
    
    // Get or generate stats data
    var stats = getOrGenerateEarningStatsEarly();
    if (!stats) return;
    
    // Find which category this element belongs to
    var parent = element.closest('.b-stats-row__label');
    if (!parent) {
      // Maybe it's in All time row
      var row = element.closest('.b-stats-row');
      if (row) {
        var monthEl = row.querySelector('.b-stats-row__month');
        if (monthEl && isAllTimeText(monthEl.textContent)) {
          var netSpan = row.querySelector('.b-stats-row__total-net span');
          if (netSpan === element && !element.getAttribute('data-of-stats-modified')) {
            element.textContent = ' $' + formatCurrencyEarly(stats.net) + ' ';
            element.setAttribute('data-of-stats-modified', 'true');
            markContentReady();
          }
        }
      }
      return;
    }
    
    var parentClass = getClassStr(parent);
    
    // Category mapping
    var categoryMap = {
      'm-subscriptions': 'subscriptions',
      'm-tips': 'tips', 
      'm-posts': 'posts',
      'm-messages': 'messages',
      'm-referrals': 'referrals',
      'm-calls': 'streams'
    };
    
    // Check for total items (Gross/Net)
    if (parentClass.indexOf('m-total-item') !== -1) {
      var nameEl = parent.querySelector('.b-stats-row__name');
      if (nameEl) {
        var name = nameEl.textContent.trim().toLowerCase();
        if (isGrossLabel(name) && !element.getAttribute('data-of-stats-modified')) {
          element.textContent = ' $' + formatCurrencyEarly(stats.gross) + ' ';
          element.setAttribute('data-of-stats-modified', 'true');
          element.style.cursor = 'pointer';
          element.title = 'Click to regenerate stats';
          nameEl.textContent = getLocalizedGrossLabel();
          markContentReady();
        } else if (isNetLabel(name) && !element.getAttribute('data-of-stats-modified')) {
          element.textContent = ' $' + formatCurrencyEarly(stats.net) + ' ';
          element.setAttribute('data-of-stats-modified', 'true');
          nameEl.textContent = getLocalizedNetLabel();
          markContentReady();
        }
      }
      return;
    }
    
    // Find which category
    var catName = null;
    for (var cls in categoryMap) {
      if (parentClass.indexOf(cls) !== -1) {
        catName = categoryMap[cls];
        break;
      }
    }
    
    if (catName && stats.categories && stats.categories[catName]) {
      var catData = stats.categories[catName];
      var vals = parent.querySelectorAll('.b-stats-row__val');
      var idx = Array.from(vals).indexOf(element);
      
      if (idx === 0 && !element.getAttribute('data-of-stats-modified')) {
        // First val is Gross
        element.textContent = ' $' + formatCurrencyEarly(catData.gross) + ' ';
        element.setAttribute('data-of-stats-modified', 'true');
        markContentReady();
      } else if (idx === 1 && !element.getAttribute('data-of-stats-modified')) {
        // Second val is Net
        element.textContent = ' $' + formatCurrencyEarly(catData.net) + ' ';
        element.setAttribute('data-of-stats-modified', 'true');
        markContentReady();
      }
    }
  }
  
  // Mark content container as ready to show (removes CSS hiding)
  function markContentReady() {
    var contentContainer = document.querySelector('.b-stats-row__content');
    if (contentContainer && !contentContainer.getAttribute('data-of-stats-ready')) {
      contentContainer.setAttribute('data-of-stats-ready', 'true');
    }
  }
  
  // Early version of getOrGenerateEarningStats for immediate replacement
  function getOrGenerateEarningStatsEarly() {
    // Try to get from memory first, but validate against current balance
    if (typeof earningStatsData !== 'undefined' && earningStatsData) {
      // If data was loaded from a preset, use it without validation
      if (earningStatsData.fromPreset) {
        return earningStatsData;
      }
      
      // Check if current month is still valid
      var minRequired = 0;
      try {
        if (cachedSettings && cachedSettings.currentBalance) {
          minRequired += parseFloat(String(cachedSettings.currentBalance).replace(/[^0-9.]/g, '')) || 0;
        }
        if (cachedSettings && cachedSettings.pendingBalance) {
          minRequired += parseFloat(String(cachedSettings.pendingBalance).replace(/[^0-9.]/g, '')) || 0;
        }
      } catch(e) {}
      
      if (minRequired > 0 && earningStatsData.months && earningStatsData.months.length > 0) {
        var currentMonthNet = earningStatsData.months[0].net || 0;
        if (currentMonthNet < minRequired) {
          log('OF Stats Early: Cached current month ($' + currentMonthNet.toFixed(2) + ') < balance ($' + minRequired.toFixed(2) + '), will regenerate');
          earningStatsData = null;
          localStorage.removeItem('ofStatsEarningStats');
        } else {
          return earningStatsData;
        }
      } else {
        return earningStatsData;
      }
    }
    
    // Try localStorage
    try {
      var saved = localStorage.getItem('ofStatsEarningStats');
      if (saved) {
        var parsed = JSON.parse(saved);
        
        // If data was loaded from a preset, use it without validation
        if (parsed.fromPreset) {
          log('OF Stats Early: Using earning stats from preset - Gross: $' + (parsed.gross || 0).toFixed(2) + ', Net: $' + (parsed.net || 0).toFixed(2));
          earningStatsData = parsed;
          return earningStatsData;
        }
        
        // Validate against current balance before using
        var minRequired = 0;
        try {
          if (cachedSettings && cachedSettings.currentBalance) {
            minRequired += parseFloat(String(cachedSettings.currentBalance).replace(/[^0-9.]/g, '')) || 0;
          }
          if (cachedSettings && cachedSettings.pendingBalance) {
            minRequired += parseFloat(String(cachedSettings.pendingBalance).replace(/[^0-9.]/g, '')) || 0;
          }
        } catch(e) {}
        
        if (minRequired > 0 && parsed.months && parsed.months.length > 0) {
          var currentMonthNet = parsed.months[0].net || 0;
          if (currentMonthNet < minRequired) {
            log('OF Stats Early: Stored current month ($' + currentMonthNet.toFixed(2) + ') < balance ($' + minRequired.toFixed(2) + '), will regenerate');
            localStorage.removeItem('ofStatsEarningStats');
            // Continue to generate new data
          } else {
            earningStatsData = parsed;
            return earningStatsData;
          }
        } else {
          earningStatsData = parsed;
          return earningStatsData;
        }
      }
    } catch(e) {}
    
    // On /my/stats/earnings page, always generate initial data if none exists
    // This ensures the first load shows values instead of $0.00
    if (isEarningStatsPage()) {
      log('OF Stats Early: No valid data found on earnings stats page, generating initial data...');
      
      // Get minimum balance requirement (Current + Pending balance)
      var minRequired = 0;
      try {
        if (cachedSettings && cachedSettings.currentBalance) {
          minRequired += parseFloat(String(cachedSettings.currentBalance).replace(/[^0-9.]/g, '')) || 0;
        }
        if (cachedSettings && cachedSettings.pendingBalance) {
          minRequired += parseFloat(String(cachedSettings.pendingBalance).replace(/[^0-9.]/g, '')) || 0;
        }
      } catch(e) {}
      
      // Generate random initial gross (1K-10K range, but at least 1.5x of min required for proper distribution)
      var minGross = Math.max(1000, (minRequired / 0.8) * 1.5);
      var maxGross = Math.max(10000, minGross * 2);
      var gross = minGross + Math.random() * (maxGross - minGross);
      gross = Math.floor(gross) + Math.random() * 0.99; // Add cents
      
      var net = gross * 0.8;
      
      // Distribute earnings across categories
      var messagesPercent = 0.73 + Math.random() * 0.04;
      var postsPercent = 0.02 + Math.random() * 0.02;
      var tipsPercent = 1 - messagesPercent - postsPercent;
      
      var categories = {
        subscriptions: { gross: 0, net: 0 },
        tips: { gross: gross * tipsPercent, net: net * tipsPercent },
        posts: { gross: gross * postsPercent, net: net * postsPercent },
        messages: { gross: gross * messagesPercent, net: net * messagesPercent },
        referrals: { gross: 0, net: 0 },
        streams: { gross: 0, net: 0 }
      };
      
      // Generate months data
      var months = generateMonthlyEarningsEarly(net, minRequired);
      
      earningStatsData = {
        gross: gross,
        net: net,
        categories: categories,
        months: months
      };
      
      // Save to localStorage so subsequent calls use this data
      try {
        localStorage.setItem('ofStatsEarningStats', JSON.stringify(earningStatsData));
      } catch(e) {}
      
      log('OF Stats Early: Generated initial stats - Gross: $' + gross.toFixed(2) + ', Net: $' + net.toFixed(2) + ', MinRequired: $' + minRequired.toFixed(2));
      return earningStatsData;
    }
    
    // For other pages (like /my/statistics/statements/earnings), generate temporary stats from transactions
    if (cachedSettings && (parseInt(cachedSettings.earningsCount) > 0 || parseInt(cachedSettings.earningsCompleteCount) > 0)) {
      var pendingCount = parseInt(cachedSettings.earningsCount) || 0;
      var completeCount = parseInt(cachedSettings.earningsCompleteCount) || 0;
      
      // Generate basic month data from transactions
      var transactions = getOrGenerateEarningsData(pendingCount, completeCount);
      if (transactions && transactions.length > 0) {
        // Calculate totals from transactions
        var totalNet = 0;
        transactions.forEach(function(t) {
          totalNet += t.net || 0;
        });
        
        // Generate 2 months data for Gross calculation
        var now = new Date();
        var currentMonth = now.getMonth();
        var currentYear = now.getFullYear();
        var prevMonth = currentMonth === 0 ? 11 : currentMonth - 1;
        var prevYear = currentMonth === 0 ? currentYear - 1 : currentYear;
        
        // Split net between 2 months (60/40 current/previous)
        var currentMonthNet = totalNet * 0.6;
        var prevMonthNet = totalNet * 0.4;
        
        // Generate category breakdown with fixed percentages for consistency
        var subsPercent = 0.35;
        var tipsPercent = 0.25;
        var messagesPercent = 0.25;
        var postsPercent = 0.10;
        var remainingPercent = 0.05;
        
        // Create temporary stats object (NOT saved to localStorage)
        var tempStats = {
          months: [
            {
              month: currentMonth,
              year: currentYear,
              net: currentMonthNet,
              categories: {
                subscriptions: currentMonthNet * subsPercent,
                tips: currentMonthNet * tipsPercent,
                messages: currentMonthNet * messagesPercent,
                posts: currentMonthNet * postsPercent,
                streams: currentMonthNet * remainingPercent,
                referrals: 0
              }
            },
            {
              month: prevMonth,
              year: prevYear,
              net: prevMonthNet,
              categories: {
                subscriptions: prevMonthNet * subsPercent,
                tips: prevMonthNet * tipsPercent,
                messages: prevMonthNet * messagesPercent,
                posts: prevMonthNet * postsPercent,
                streams: prevMonthNet * remainingPercent,
                referrals: 0
              }
            }
          ]
        };
        
        log('OF Stats: Created temporary earning stats from transactions (Net: $' + totalNet.toFixed(2) + ')');
        return tempStats;
      }
    }
    
    return null;
  }
  
  // Early version of generateMonthlyEarnings for initial data generation
  function generateMonthlyEarningsEarly(totalNet, minCurrentMonth) {
    var months = [];
    var now = new Date();
    var currentYear = now.getFullYear();
    var currentMonth = now.getMonth();
    
    // Generate 15-25 months of data
    var numMonths = 15 + Math.floor(Math.random() * 11);
    
    // Generate weights for each month (newer months get more weight)
    var weights = [];
    var totalWeight = 0;
    for (var i = 0; i < numMonths; i++) {
      var progressRatio = (numMonths - 1 - i) / (numMonths - 1);
      var weight = Math.pow(progressRatio, 2.2) + 0.05;
      weight *= (0.8 + Math.random() * 0.4);
      weights.push(weight);
      totalWeight += weight;
    }
    
    // Generate month data
    for (var i = 0; i < numMonths; i++) {
      var monthDate = new Date(currentYear, currentMonth - i, 1);
      var monthValue = (totalNet * weights[i] / totalWeight);
      
      // Current month: ensure MORE than minCurrentMonth (add 10-50% buffer)
      if (i === 0 && minCurrentMonth > 0) {
        var minWithBuffer = minCurrentMonth * (1.1 + Math.random() * 0.4); // 110-150% of min
        monthValue = Math.max(monthValue, minWithBuffer);
      }
      
      // For oldest months, cap at $1000
      var monthsFromStart = numMonths - 1 - i;
      if (monthsFromStart < 3) {
        monthValue = Math.min(monthValue, 300 + Math.random() * 700);
      } else if (monthsFromStart < 6) {
        monthValue = Math.min(monthValue, 800 + Math.random() * 1200);
      }
      
      monthValue = Math.max(monthValue, 50 + Math.random() * 100);
      
      // Generate category breakdown
      var messagesShare = 0.70 + Math.random() * 0.10;
      var postsShare = 0.02 + Math.random() * 0.02;
      var tipsShare = 1 - messagesShare - postsShare;
      
      months.push({
        date: monthDate,
        year: monthDate.getFullYear(),
        month: monthDate.getMonth(),
        net: monthValue,
        categories: {
          subscriptions: 0,
          tips: tipsShare * monthValue,
          posts: postsShare * monthValue,
          messages: messagesShare * monthValue,
          referrals: 0,
          streams: 0
        }
      });
    }
    
    // Normalize to match total net, but preserve minCurrentMonth for current month
    var generatedTotal = months.reduce(function(sum, m) { return sum + m.net; }, 0);
    var adjustFactor = totalNet / generatedTotal;
    
    months.forEach(function(m, idx) {
      m.net *= adjustFactor;
      Object.keys(m.categories).forEach(function(cat) {
        m.categories[cat] *= adjustFactor;
      });
    });
    
    // After normalization, ensure current month is MORE than minCurrentMonth (with buffer)
    var minWithBufferFinal = minCurrentMonth * (1.1 + Math.random() * 0.4); // 110-150% of min
    if (minCurrentMonth > 0 && months.length > 0 && months[0].net < minWithBufferFinal) {
      var newNet = minWithBufferFinal;
      // Redistribute across categories proportionally
      var catTotal = 0;
      Object.keys(months[0].categories).forEach(function(cat) {
        catTotal += months[0].categories[cat];
      });
      if (catTotal > 0) {
        var catScale = newNet / catTotal;
        Object.keys(months[0].categories).forEach(function(cat) {
          months[0].categories[cat] *= catScale;
        });
      }
      months[0].net = newNet;
    }
    
    return months;
  }
  
  // Early version of formatCurrency for immediate replacement
  function formatCurrencyEarly(num) {
    if (typeof num !== 'number') num = parseFloat(num) || 0;
    return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  
  // Month names for early display
  var monthNamesEarly = ['January', 'February', 'March', 'April', 'May', 'June', 
                         'July', 'August', 'September', 'October', 'November', 'December'];
  var monthNamesEarlyRu = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
                           'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
  var monthNamesShortRu = ['янв.', 'февр.', 'март', 'апр.', 'май', 'июнь', 'июль', 'авг.', 'сент.', 'окт.', 'нояб.', 'дек.'];
  var monthNamesEarlyEs = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  var monthNamesShortEs = ['ene.', 'feb.', 'mar.', 'abr.', 'may.', 'jun.', 'jul.', 'ago.', 'sep.', 'oct.', 'nov.', 'dic.'];
  var monthNamesEarlyDe = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
  var monthNamesShortDe = ['Jan.', 'Feb.', 'Mär.', 'Apr.', 'Mai', 'Jun.', 'Jul.', 'Aug.', 'Sep.', 'Okt.', 'Nov.', 'Dez.'];
  
  // Create expandable month row HTML (early version)
  function createExpandableMonthRowEarly(monthData) {
    var lang = getPageLanguage();
    var monthName = lang === 'ru' ? monthNamesEarlyRu[monthData.month] : lang === 'es' ? monthNamesEarlyEs[monthData.month] : lang === 'de' ? monthNamesEarlyDe[monthData.month] : monthNamesEarly[monthData.month];
    var monthNameShort = lang === 'ru' ? monthNamesShortRu[monthData.month] : lang === 'es' ? monthNamesShortEs[monthData.month] : lang === 'de' ? monthNamesShortDe[monthData.month] : ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][monthData.month];
    var yearStr = monthData.year.toString();
    var netValue = monthData.net;
    var netStr = formatCurrencyEarly(netValue);
    
    // Calculate gross from net (net is ~80% of gross)
    var grossValue = netValue / 0.8;
    var grossStr = formatCurrencyEarly(grossValue);
    
    // Get category data
    var categories = monthData.categories || {};
    var subsNet = categories.subscriptions || 0;
    var tipsNet = categories.tips || 0;
    var postsNet = categories.posts || 0;
    var messagesNet = categories.messages || 0;
    var streamsNet = categories.streams || 0;
    
    // Calculate gross for each category
    var subsGross = subsNet / 0.8;
    var tipsGross = tipsNet / 0.8;
    var postsGross = postsNet / 0.8;
    var messagesGross = messagesNet / 0.8;
    var streamsGross = streamsNet / 0.8;
    
    // Check if values are zero for m-zero-value class
    var subsZero = subsNet === 0 ? ' m-zero-value' : '';
    var tipsZero = tipsNet === 0 ? ' m-zero-value' : '';
    var postsZero = postsNet === 0 ? ' m-zero-value' : '';
    var messagesZero = messagesNet === 0 ? ' m-zero-value' : '';
    var streamsZero = streamsNet === 0 ? ' m-zero-value' : '';
    
    // Calculate first and last day of month for calendar button
    var daysInMonth = new Date(monthData.year, monthData.month + 1, 0).getDate();
    var fromDate = monthNameShort + ' 1, ' + yearStr;
    var toDate = monthNameShort + ' ' + daysInMonth + ', ' + yearStr;
    
    var row = document.createElement('div');
    row.className = 'b-stats-row';
    row.setAttribute('data-of-stats-generated', 'true');
    row.setAttribute('data-month-year', monthData.month + '-' + monthData.year);
    
    row.innerHTML = '<div class="b-stats-row__head">' +
      '<div class="b-stats-row__month"> ' + monthName + ', ' + yearStr + ' </div>' +
      '<div class="b-stats-row__total-net g-semibold"><span class="" data-of-stats-modified="true"> $' + netStr + ' </span></div>' +
      '<svg class="b-stats-row__arrow g-icon" data-icon-name="icon-arrow-down" aria-hidden="true"><use href="#icon-arrow-down" xlink:href="#icon-arrow-down"></use></svg>' +
      '</div>' +
      '<div class="b-stats-row__body" style="display: none;">' +
        '<div>' +
          '<div class="b-chart__wrapper" style="position: relative; margin-top: -15px;" data-of-month-chart="true">' +
            '<canvas class="b-chart__multiple-line" height="220" width="608" style="display: block; box-sizing: border-box; height: 220px; width: 608px;" data-of-stats-month-canvas="' + monthData.month + '-' + monthData.year + '" data-of-stats-overlay="true"></canvas>' +
          '</div>' +
        '</div>' +
        '<button class="g-btn m-border m-rounded m-block m-no-uppercase m-icon-absolute m-time-period m-lg">' +
          '<svg class="m-half-left g-icon" data-icon-name="icon-calendar" aria-hidden="true"><use href="#icon-calendar" xlink:href="#icon-calendar"></use></svg>' +
          '<span class="b-btn-text"> ' + (lang === 'ru' ? 'От ' : lang === 'es' ? 'Desde ' : lang === 'de' ? 'Von ' : 'From ') + '<span class="b-date-value">' + fromDate + '</span> ' + (lang === 'ru' ? 'К ' : lang === 'es' ? 'Hasta ' : lang === 'de' ? 'Bis ' : 'To ') + '<span class="b-date-value">' + toDate + '</span></span>' +
        '</button>' +
        '<div class="b-stats-row__content" data-of-stats-ready="true">' +
          '<div class="b-stats-row__label m-border-line m-subscriptions m-active">' +
            '<span class="b-stats-row__name g-md-text m-dots m-break-word"> ' + (lang === 'ru' ? 'Подписки' : lang === 'es' ? 'Suscripciones' : lang === 'de' ? 'Abonnements' : 'Subscriptions') + ' </span>' +
            '<span class="b-stats-row__val g-semibold' + subsZero + '" data-of-stats-modified="true"> $' + formatCurrencyEarly(subsGross) + ' </span>' +
            '<span class="b-stats-row__val g-semibold' + subsZero + '" data-of-stats-modified="true"> $' + formatCurrencyEarly(subsNet) + ' </span>' +
          '</div>' +
          '<div class="b-stats-row__label m-border-line m-tips">' +
            '<span class="b-stats-row__name g-md-text m-dots m-break-word"> ' + (lang === 'ru' ? 'Чаевые' : lang === 'es' ? 'Propinas' : lang === 'de' ? 'Trinkgelder' : 'Tips') + ' </span>' +
            '<span class="b-stats-row__val g-semibold' + tipsZero + '" data-of-stats-modified="true"> $' + formatCurrencyEarly(tipsGross) + ' </span>' +
            '<span class="b-stats-row__val g-semibold' + tipsZero + '" data-of-stats-modified="true"> $' + formatCurrencyEarly(tipsNet) + ' </span>' +
          '</div>' +
          '<div class="b-stats-row__label m-border-line m-posts">' +
            '<span class="b-stats-row__name g-md-text m-dots m-break-word"> ' + (lang === 'ru' ? 'Посты' : lang === 'es' ? 'Publicaciones' : lang === 'de' ? 'Beiträge' : 'Posts') + ' </span>' +
            '<span class="b-stats-row__val g-semibold' + postsZero + '" data-of-stats-modified="true"> $' + formatCurrencyEarly(postsGross) + ' </span>' +
            '<span class="b-stats-row__val g-semibold' + postsZero + '" data-of-stats-modified="true"> $' + formatCurrencyEarly(postsNet) + ' </span>' +
          '</div>' +
          '<div class="b-stats-row__label m-border-line m-messages">' +
            '<span class="b-stats-row__name g-md-text m-dots m-break-word"> ' + (lang === 'ru' ? 'Сообщения' : lang === 'es' ? 'Mensajes' : lang === 'de' ? 'Nachrichten' : 'Messages') + ' </span>' +
            '<span class="b-stats-row__val g-semibold' + messagesZero + '" data-of-stats-modified="true"> $' + formatCurrencyEarly(messagesGross) + ' </span>' +
            '<span class="b-stats-row__val g-semibold' + messagesZero + '" data-of-stats-modified="true"> $' + formatCurrencyEarly(messagesNet) + ' </span>' +
          '</div>' +
          '<div class="b-stats-row__label m-border-line m-referrals">' +
            '<span class="b-stats-row__name g-md-text m-dots m-break-word"> ' + (lang === 'ru' ? 'Рефералы' : lang === 'es' ? 'Referidos' : lang === 'de' ? 'Empfehlungen' : 'Referrals') + ' </span>' +
            '<span class="b-stats-row__val g-semibold m-zero-value" data-of-stats-modified="true"> $0.00 </span>' +
            '<span class="b-stats-row__val g-semibold m-zero-value" data-of-stats-modified="true"> $0.00 </span>' +
          '</div>' +
          '<div class="b-stats-row__label m-border-line m-calls">' +
            '<span class="b-stats-row__name g-md-text m-dots m-break-word"> ' + (lang === 'ru' ? 'Потоки' : lang === 'es' ? 'Transmisiones' : lang === 'de' ? 'Streams' : 'Streams') + ' </span>' +
            '<span class="b-stats-row__val g-semibold' + streamsZero + '" data-of-stats-modified="true"> $' + formatCurrencyEarly(streamsGross) + ' </span>' +
            '<span class="b-stats-row__val g-semibold' + streamsZero + '" data-of-stats-modified="true"> $' + formatCurrencyEarly(streamsNet) + ' </span>' +
          '</div>' +
          '<div class="b-stats-row__label m-border-line m-total">' +
            '<span class="b-stats-row__name g-md-text"> ' + (lang === 'ru' ? 'Итого' : lang === 'es' ? 'Total' : lang === 'de' ? 'Gesamt' : 'Total') + ' </span>' +
            '<div class="b-stats-row__label m-total-item pt-0 pb-0">' +
              '<span class="b-stats-row__name g-md-text"> ' + (lang === 'ru' ? 'Валовой' : lang === 'es' ? 'Bruto' : lang === 'de' ? 'Brutto' : 'Gross') + ' </span>' +
              '<span class="b-stats-row__val g-semibold" data-of-stats-modified="true"> $' + grossStr + ' </span>' +
            '</div>' +
            '<div class="b-stats-row__label m-total-item pt-0 pb-0">' +
              '<span class="b-stats-row__name g-md-text"> ' + (lang === 'ru' ? 'Чистая' : lang === 'es' ? 'Neto' : lang === 'de' ? 'Netto' : 'Net') + ' </span>' +
              '<span class="b-stats-row__val g-semibold" data-of-stats-modified="true"> $' + netStr + ' </span>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';
    
    // Add click handler to expand/collapse
    var head = row.querySelector('.b-stats-row__head');
    if (head) {
      head.style.cursor = 'pointer';
      head.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        toggleMonthRowEarly(row);
      });
    }
    
    // Use event delegation on the content area for category clicks
    var monthContent = row.querySelector('.b-stats-row__content');
    if (monthContent) {
      monthContent.addEventListener('click', function(e) {
        var label = e.target.closest('.b-stats-row__label.m-border-line:not(.m-total)');
        if (label) {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          switchActiveCategory(row, label);
        }
      }, true); // capture phase
    }
    
    // Map current active category to class name
    var categoryClassMap = {
      'subscriptions': 'm-subscriptions',
      'tips': 'm-tips',
      'posts': 'm-posts',
      'messages': 'm-messages',
      'referrals': 'm-referrals',
      'streams': 'm-calls'
    };
    var activeClass = categoryClassMap[currentActiveCategory] || 'm-subscriptions';
    
    // Add cursor and handlers on labels, set initial styles based on current active category
    var categoryLabels = row.querySelectorAll('.b-stats-row__label.m-border-line:not(.m-total)');
    categoryLabels.forEach(function(label) {
      // Set initial styles based on current global active category
      var nameEl = label.querySelector('.b-stats-row__name');
      var isActive = label.classList.contains(activeClass);
      if (nameEl) {
        if (isActive) {
          label.classList.add('m-active');
          nameEl.style.color = '#000';
          nameEl.style.opacity = '1';
        } else {
          label.classList.remove('m-active');
          nameEl.style.color = '#8a96a3';
          nameEl.style.opacity = '0.6';
        }
      }
      label.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        switchActiveCategory(row, label);
      }, true); // capture phase
    });
    
    return row;
  }
  
  // Switch active category and redraw chart with new active line
  function switchActiveCategory(row, clickedLabel) {
    log('OF Stats: switchActiveCategory called, clickedLabel:', clickedLabel.className);
    
    // Remove m-active from all category labels and reset styles
    var allLabels = row.querySelectorAll('.b-stats-row__label.m-border-line:not(.m-total)');
    allLabels.forEach(function(label) {
      label.classList.remove('m-active');
      // Reset style to inactive - just color change, no font weight
      var nameEl = label.querySelector('.b-stats-row__name');
      if (nameEl) {
        nameEl.style.color = '#8a96a3';
        nameEl.style.opacity = '0.6';
      }
    });
    
    // Add m-active to clicked label and apply active styles - just black color
    clickedLabel.classList.add('m-active');
    var activeNameEl = clickedLabel.querySelector('.b-stats-row__name');
    if (activeNameEl) {
      activeNameEl.style.color = '#000';
      activeNameEl.style.opacity = '1';
    }
    log('OF Stats: m-active added to:', clickedLabel.className);
    
    // Determine which category was clicked
    var categoryMap = {
      'm-subscriptions': 'subscriptions',
      'm-tips': 'tips',
      'm-posts': 'posts',
      'm-messages': 'messages',
      'm-referrals': 'referrals',
      'm-calls': 'streams'
    };
    
    var activeCategory = 'subscriptions'; // default
    var labelClass = clickedLabel.className || '';
    for (var cls in categoryMap) {
      if (labelClass.indexOf(cls) !== -1) {
        activeCategory = categoryMap[cls];
        break;
      }
    }
    
    // Save active category globally for syncing
    currentActiveCategory = activeCategory;
    
    // Also update All time row to use same category
    var container = row.closest('.b-stats-wrap');
    if (container) {
      var allTimeRow = container.querySelector('.b-stats-row[data-of-stats-alltime]');
      if (allTimeRow) {
        applyActiveCategoryToAllTime(allTimeRow, activeCategory);
      }
    }
    
    // Redraw chart with new active category (no animation on switch)
    var canvas = row.querySelector('canvas[data-of-stats-month-canvas]');
    if (canvas) {
      // Store active category on canvas for redraw
      canvas.setAttribute('data-active-category', activeCategory);
      
      // Use no-animation version for quick switch
      var chartData = canvas._chartData;
      if (chartData) {
        var ctx = canvas.getContext('2d');
        if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
        drawMonthChartCanvasNoAnimation(canvas, chartData);
      }
    }
  }
  
  // Apply active category to All time row (sync from month)
  function applyActiveCategoryToAllTime(allTimeRow, activeCategory) {
    var categoryClassMap = {
      'subscriptions': 'm-subscriptions',
      'tips': 'm-tips',
      'posts': 'm-posts',
      'messages': 'm-messages',
      'referrals': 'm-referrals',
      'streams': 'm-calls'
    };
    
    var targetClass = categoryClassMap[activeCategory] || 'm-subscriptions';
    
    // Update category labels in All time row
    var allLabels = allTimeRow.querySelectorAll('.b-stats-row__label.m-border-line:not(.m-total)');
    allLabels.forEach(function(label) {
      label.classList.remove('m-current');
      if (label.classList.contains(targetClass)) {
        label.classList.add('m-current');
      }
    });
    
    // Redraw All time chart with new category (only if expanded)
    if (allTimeRow.classList.contains('m-expanded')) {
      var canvas = allTimeRow.querySelector('.b-chart__wrapper canvas[data-of-stats-overlay]');
      if (canvas) {
        canvas.setAttribute('data-active-category', activeCategory);
        var chartData = canvas._chartData;
        if (chartData) {
          var ctx = canvas.getContext('2d');
          if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
          drawAllTimeChartCanvasNoAnimation(canvas, chartData);
        }
      }
    }
  }
  
  // Toggle month row expansion (early version)
  // Cannot close all - can only switch between rows
  function toggleMonthRowEarly(row) {
    var isExpanded = row.classList.contains('m-expanded');
    var body = row.querySelector('.b-stats-row__body');
    
    // If already expanded, do nothing (can't close last open row)
    if (isExpanded) {
      return;
    }
    
    // Collapse All time row and other expanded months first
    var container = row.closest('.b-stats-wrap');
    if (container) {
      container.querySelectorAll('.b-stats-row.m-expanded').forEach(function(expandedRow) {
        expandedRow.classList.remove('m-expanded');
        var expandedBody = expandedRow.querySelector('.b-stats-row__body');
        if (expandedBody) expandedBody.style.display = 'none';
        
        // Destroy previous month chart instance when collapsing
        var prevCanvas = expandedBody ? expandedBody.querySelector('canvas[data-of-stats-month-canvas]') : null;
        if (prevCanvas) {
          prevCanvas.removeAttribute('data-chart-drawn');
          if (prevCanvas._chartInstance) {
            prevCanvas._chartInstance.destroy();
            prevCanvas._chartInstance = null;
          }
          var ctx = prevCanvas.getContext('2d');
          if (ctx) ctx.clearRect(0, 0, prevCanvas.width, prevCanvas.height);
        }
        
        // Also reset All time canvas when collapsing All time row
        var allTimeCanvas = expandedBody ? expandedBody.querySelector('canvas[data-of-stats-overlay]') : null;
        if (allTimeCanvas) {
          allTimeCanvas.removeAttribute('data-chart-drawn');
          if (allTimeCanvas._chartInstance) {
            allTimeCanvas._chartInstance.destroy();
            allTimeCanvas._chartInstance = null;
          }
          var ctxAll = allTimeCanvas.getContext('2d');
          if (ctxAll) ctxAll.clearRect(0, 0, allTimeCanvas.width, allTimeCanvas.height);
        }
      });
    }
    
    // Expand this row
    row.classList.add('m-expanded');
    if (body) {
      body.style.display = 'block';
      
      // Apply current active category from All time to this month
      applyActiveCategoryToMonth(row, currentActiveCategory);
      
      // Draw chart for this month (always redraw for animation)
      var canvas = body.querySelector('canvas[data-of-stats-month-canvas]');
      if (canvas) {
        // Set active category before drawing
        canvas.setAttribute('data-active-category', currentActiveCategory);
        
        // Remove previous drawn attribute to force redraw with animation
        canvas.removeAttribute('data-chart-drawn');
        // Clear any previous content
        if (canvas._chartInstance) {
          canvas._chartInstance.destroy();
          canvas._chartInstance = null;
        }
        var ctx = canvas.getContext('2d');
        if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        // Draw fresh with animation
        drawMonthChartEarly(canvas, row);
      }
    }
  }
  
  // Draw chart for a specific month (early version) - uses Chart.js like All time
  function drawMonthChartEarly(canvas, row) {
    if (!canvas) return;
    
    // Always clear and redraw for animation
    if (canvas._chartInstance) {
      canvas._chartInstance.destroy();
      canvas._chartInstance = null;
    }
    var ctx = canvas.getContext('2d');
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    var monthKey = canvas.getAttribute('data-of-stats-month-canvas');
    if (!monthKey) return;
    
    var stats = getOrGenerateEarningStatsEarly();
    if (!stats || !stats.months) return;
    
    var parts = monthKey.split('-');
    var targetMonth = parseInt(parts[0]);
    var targetYear = parseInt(parts[1]);
    
    var monthData = null;
    for (var i = 0; i < stats.months.length; i++) {
      if (stats.months[i].month === targetMonth && stats.months[i].year === targetYear) {
        monthData = stats.months[i];
        break;
      }
    }
    
    if (!monthData) {
      log('OF Stats: Month data not found for', targetMonth, targetYear, 'in stats.months:', stats.months.map(function(m) { return m.month + '-' + m.year; }));
      return;
    }
    
    // Generate daily cumulative data for this month (like All time chart)
    var now = new Date();
    var isCurrentMonth = (targetYear === now.getFullYear() && targetMonth === now.getMonth());
    var currentDay = now.getDate();
    
    // Always use full month for chart display
    var daysInMonth = new Date(targetYear, targetMonth + 1, 0).getDate();
    
    // For current month, data is only generated up to today
    var daysWithData = isCurrentMonth ? currentDay : daysInMonth;
    
    var categories = monthData.categories || {};
    
    // Ensure we have at least some data
    var hasAnyData = Object.keys(categories).some(function(cat) {
      return categories[cat] > 0;
    });
    
    if (!hasAnyData) {
      log('OF Stats: No category data for month', targetMonth, targetYear);
      // Still draw an empty chart for consistency
    }
    
    // Generate daily breakdown per category
    var dailyCategories = {
      subscriptions: [],
      tips: [],
      messages: [],
      posts: [],
      streams: [],
      referrals: []
    };
    
    // Distribute each category across days with cumulative growth (only up to daysWithData)
    Object.keys(dailyCategories).forEach(function(cat) {
      var totalForCat = categories[cat] || 0;
      var cumulative = 0;
      var remaining = totalForCat;
      
      // Generate data up to daysWithData
      for (var d = 0; d < daysWithData; d++) {
        var dayShare;
        if (d === daysWithData - 1) {
          dayShare = remaining;
        } else {
          var avgDaily = remaining / (daysWithData - d);
          // More variation for realistic growth
          dayShare = avgDaily * (0.2 + Math.random() * 1.6);
          dayShare = Math.max(0, Math.min(dayShare, remaining * 0.4));
        }
        cumulative += dayShare;
        remaining -= dayShare;
        dailyCategories[cat].push(cumulative);
      }
      
      // For current month: add flat line from today to end of month
      if (isCurrentMonth && daysWithData < daysInMonth) {
        var lastValue = cumulative; // Value at current day
        for (var d = daysWithData; d < daysInMonth; d++) {
          dailyCategories[cat].push(lastValue); // Flat line - same value
        }
      }
    });
    
    // Generate labels (day numbers) - always full month
    var labels = [];
    var langChart = getPageLanguage();
    var monthNamesShort = langChart === 'ru' ? ['янв.', 'февр.', 'март', 'апр.', 'май', 'июнь', 'июль', 'авг.', 'сент.', 'окт.', 'нояб.', 'дек.']
      : langChart === 'es' ? ['ene.', 'feb.', 'mar.', 'abr.', 'may.', 'jun.', 'jul.', 'ago.', 'sep.', 'oct.', 'nov.', 'dic.']
      : langChart === 'de' ? ['Jan.', 'Feb.', 'Mär.', 'Apr.', 'Mai', 'Jun.', 'Jul.', 'Aug.', 'Sep.', 'Okt.', 'Nov.', 'Dez.']
      : ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    for (var d = 1; d <= daysInMonth; d++) {
      labels.push(d.toString().padStart(2, '0') + ' ' + monthNamesShort[targetMonth] + ' ' + (targetYear % 100).toString().padStart(2, '0'));
    }
    
    // Prepare chart data in same format as All time
    var chartData = {
      labels: labels,
      datasets: dailyCategories
    };
    
    // Set canvas dimensions
    canvas.width = 608;
    canvas.height = 220;
    canvas.style.width = '608px';
    canvas.style.height = '220px';
    
    // Mark as drawn
    canvas.setAttribute('data-chart-drawn', 'true');
    
    // Use Chart.js via custom event (same as All time)
    triggerMonthChartDraw(canvas, chartData);
    
    log('OF Stats: Month chart triggered for', monthNamesShort[targetMonth], targetYear);
  }
  
  // Trigger month chart drawing (same approach as All time)
  function triggerMonthChartDraw(canvas, chartData) {
    // Store chartData on canvas for redraw when switching categories
    canvas._chartData = chartData;
    // For month charts, use same canvas drawing as All time
    drawMonthChartCanvas(canvas, chartData);
  }
  
  // Canvas drawing for month charts - identical to All time chart
  function drawMonthChartCanvas(canvas, chartData) {
    var ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    var width = canvas.width;
    var height = canvas.height;
    
    // Chart colors - same as All time
    var colors = {
      subscriptions: '#2196f3', // Blue - main line
      messages: '#ff7043',
      tips: '#00bcd4',
      posts: '#ec407a',
      streams: '#ffa000',
      referrals: '#9575cd'     // Purple
    };
    
    // Padding - minimal top spacing, bottom for X-axis labels
    var padding = { top: 0, right: 10, bottom: 40, left: 10 };
    var chartWidth = width - padding.left - padding.right;
    var chartHeight = height - padding.top - padding.bottom;
    
    // Find max value from full data
    var maxValue = 0;
    var categories = ['subscriptions', 'messages', 'tips', 'posts', 'streams', 'referrals'];
    categories.forEach(function(cat) {
      var data = chartData.datasets[cat];
      if (data && data.length > 0) {
        var catMax = Math.max.apply(null, data);
        if (catMax > maxValue) maxValue = catMax;
      }
    });
    if (maxValue === 0) maxValue = 100;
    maxValue *= 1.15; // 15% grace like Chart.js - data won't touch top grid line
    
    var numPoints = chartData.labels.length;
    var xStep = chartWidth / (numPoints - 1);
    
    // Get active category - determines which line is bold
    var activeCategory = canvas.getAttribute('data-active-category') || 'subscriptions';
    
    // Prepare line data - active category LAST so it draws on top
    var drawOrder = ['tips', 'messages', 'posts', 'streams', 'referrals', 'subscriptions'];
    // Reorder: move active category to end so it draws on top
    drawOrder = drawOrder.filter(function(c) { return c !== activeCategory; });
    drawOrder.push(activeCategory);
    
    var linesToDraw = [];
    
    drawOrder.forEach(function(cat) {
      var data = chartData.datasets[cat];
      if (!data || data.length === 0) return;
      
      var points = [];
      for (var i = 0; i < data.length; i++) {
        var x = padding.left + i * xStep;
        var y = padding.top + chartHeight * (1 - data[i] / maxValue);
        points.push({ x: x, y: y });
      }
      
      // Active category line is slightly thicker and opaque, others thin and very transparent
      var isMain = cat === activeCategory;
      linesToDraw.push({
        points: points,
        color: colors[cat],
        lineWidth: isMain ? 1.8 : 2.5,
        alpha: isMain ? 1 : 0.25
      });
    });
    
    // Animation variables - vertical grow like Chart.js
    var animationDuration = 800;
    var startTime = null;
    
    function easeOutQuart(t) {
      return 1 - Math.pow(1 - t, 4);
    }
    
    // Calculate baseline Y (bottom of chart)
    var baselineY = padding.top + chartHeight;
    
    function animate(currentTime) {
      if (!startTime) startTime = currentTime;
      var elapsed = currentTime - startTime;
      var progress = Math.min(elapsed / animationDuration, 1);
      var easedProgress = easeOutQuart(progress);
      
      // Clear canvas
      ctx.clearRect(0, 0, width, height);
      
      // Draw grid lines (4 horizontal lines - matches All time Chart.js with maxTicksLimit:4)
      // 4 ticks = 4 lines dividing into 3 intervals: top line, 2 middle lines, bottom line
      ctx.strokeStyle = getChartGridColor();
      ctx.lineWidth = 1;
      for (var i = 0; i < 4; i++) {
        var gridY = padding.top + (chartHeight * i / 3);
        ctx.beginPath();
        ctx.moveTo(padding.left, gridY);
        ctx.lineTo(width - padding.right, gridY);
        ctx.stroke();
      }
      
      // Draw animated lines - vertical grow from baseline
      linesToDraw.forEach(function(line) {
        ctx.beginPath();
        ctx.strokeStyle = line.color;
        ctx.lineWidth = line.lineWidth;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.globalAlpha = line.alpha;
        
        // Calculate animated points (grow vertically from baseline)
        var animatedPoints = line.points.map(function(p) {
          var animatedY = baselineY + (p.y - baselineY) * easedProgress;
          return { x: p.x, y: animatedY };
        });
        
        ctx.moveTo(animatedPoints[0].x, animatedPoints[0].y);
        for (var i = 0; i < animatedPoints.length - 1; i++) {
          var p0 = animatedPoints[i === 0 ? i : i - 1];
          var p1 = animatedPoints[i];
          var p2 = animatedPoints[i + 1];
          var p3 = animatedPoints[i + 2 < animatedPoints.length ? i + 2 : i + 1];
          var tension = 0.35;
          var cp1x = p1.x + (p2.x - p0.x) * tension;
          var cp1y = p1.y + (p2.y - p0.y) * tension;
          var cp2x = p2.x - (p3.x - p1.x) * tension;
          var cp2y = p2.y - (p3.y - p1.y) * tension;
          ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
        }
        ctx.stroke();
        ctx.globalAlpha = 1;
      });
      
      // Draw X-axis labels - theme-aware color, 5 evenly spaced
      ctx.globalAlpha = easedProgress;
      ctx.fillStyle = getChartLabelColor();
      ctx.font = getChartDateFont();
      ctx.textBaseline = 'top';
      
      // Position: bottom of chart area + offset for label spacing
      var labelY = chartHeight + padding.top + 15;
      
      // 5 label positions
      var labelIndices = [0, Math.floor(numPoints * 0.25), Math.floor(numPoints * 0.5), Math.floor(numPoints * 0.75), numPoints - 1];
      
      // === РќРђРЎРўР РћР™РљРђ ===
      var minLeftPosition = 67;
      
      var labelData = labelIndices.map(function(idx, i) {
        var label = chartData.labels[idx] || '';
        var dataPointX = padding.left + idx * xStep;
        var labelWidth = ctx.measureText(label).width;
        return { label: label, dataPointX: dataPointX, width: labelWidth, index: i };
      });
      
      var positions;
      if (canvas._fixedDatePositions) {
        positions = canvas._fixedDatePositions;
      } else {
        positions = new Array(5);
        var lastLabelLeft = (width - padding.right) - labelData[4].width;
        var labelSpace = (lastLabelLeft - minLeftPosition) / 4;
        for (var i = 0; i < 4; i++) {
          positions[i] = minLeftPosition + labelSpace * i;
        }
        positions[4] = width - padding.right;
        
        canvas._fixedDatePositions = positions.slice();
        canvas._fixedDateLabels = labelData.map(function(ld) { return ld.label; });
      }
      
      var labelsToUse = canvas._fixedDateLabels || labelData.map(function(ld) { return ld.label; });
      labelsToUse.forEach(function(label, i) {
        var x = positions[i];
        ctx.textAlign = (i === 4) ? 'right' : 'left';
        ctx.fillText(label, x, labelY);
      });
      ctx.globalAlpha = 1;
      
      // Continue animation
      if (progress < 1) {
        requestAnimationFrame(animate);
      }
    }
    
    // Start animation
    requestAnimationFrame(animate);
  }
  
  // Draw month chart without animation (for category switching)
  function drawMonthChartCanvasNoAnimation(canvas, chartData) {
    var ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    var width = canvas.width;
    var height = canvas.height;
    
    var colors = {
      subscriptions: '#2196f3',
      messages: '#ff7043',
      tips: '#00bcd4',
      posts: '#ec407a',
      streams: '#ffa000',
      referrals: '#9575cd'
    };
    
    var padding = { top: 0, right: 10, bottom: 40, left: 10 };
    var chartWidth = width - padding.left - padding.right;
    var chartHeight = height - padding.top - padding.bottom;
    
    var maxValue = 0;
    var categories = ['subscriptions', 'messages', 'tips', 'posts', 'streams', 'referrals'];
    categories.forEach(function(cat) {
      var data = chartData.datasets[cat];
      if (data && data.length > 0) {
        var catMax = Math.max.apply(null, data);
        if (catMax > maxValue) maxValue = catMax;
      }
    });
    if (maxValue === 0) maxValue = 100;
    maxValue *= 1.15;
    
    var numPoints = chartData.labels.length;
    var xStep = chartWidth / (numPoints - 1);
    
    var activeCategory = canvas.getAttribute('data-active-category') || 'subscriptions';
    
    var drawOrder = ['tips', 'messages', 'posts', 'streams', 'referrals', 'subscriptions'];
    drawOrder = drawOrder.filter(function(c) { return c !== activeCategory; });
    drawOrder.push(activeCategory);
    
    ctx.clearRect(0, 0, width, height);
    
    // Draw grid
    ctx.strokeStyle = getChartGridColor();
    ctx.lineWidth = 1;
    for (var i = 0; i < 4; i++) {
      var gridY = padding.top + (chartHeight * i / 3);
      ctx.beginPath();
      ctx.moveTo(padding.left, gridY);
      ctx.lineTo(width - padding.right, gridY);
      ctx.stroke();
    }
    
    // Draw lines
    drawOrder.forEach(function(cat) {
      var data = chartData.datasets[cat];
      if (!data || data.length === 0) return;
      
      var points = [];
      for (var i = 0; i < data.length; i++) {
        var x = padding.left + i * xStep;
        var y = padding.top + chartHeight * (1 - data[i] / maxValue);
        points.push({ x: x, y: y });
      }
      
      var isMain = cat === activeCategory;
      
      ctx.beginPath();
      ctx.strokeStyle = colors[cat];
      ctx.lineWidth = isMain ? 1.8 : 2.5;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.globalAlpha = isMain ? 1 : 0.25;
      
      ctx.moveTo(points[0].x, points[0].y);
      for (var i = 0; i < points.length - 1; i++) {
        var p0 = points[i === 0 ? i : i - 1];
        var p1 = points[i];
        var p2 = points[i + 1];
        var p3 = points[i + 2 < points.length ? i + 2 : i + 1];
        var tension = 0.35;
        
        var cp1x = p1.x + (p2.x - p0.x) * tension;
        var cp1y = p1.y + (p2.y - p0.y) * tension;
        var cp2x = p2.x - (p3.x - p1.x) * tension;
        var cp2y = p2.y - (p3.y - p1.y) * tension;
        
        ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
      }
      ctx.stroke();
    });
    ctx.globalAlpha = 1;
    
    // X-axis labels - theme-aware color
    ctx.globalAlpha = 1;
    ctx.fillStyle = getChartLabelColor();
    ctx.font = getChartDateFont();
    ctx.textBaseline = 'top';
    var labelY = chartHeight + padding.top + 15;
    
    var labelIndices = [0, Math.floor(numPoints * 0.25), Math.floor(numPoints * 0.5), Math.floor(numPoints * 0.75), numPoints - 1];
    
    // === РќРђРЎРўР РћР™РљРђ ===
    var minLeftPosition = 67;
    
    var labelData = labelIndices.map(function(idx, i) {
      var label = chartData.labels[idx] || '';
      var dataPointX = padding.left + idx * xStep;
      var labelWidth = ctx.measureText(label).width;
      return { label: label, dataPointX: dataPointX, width: labelWidth, index: i };
    });
    
    var positions;
    if (canvas._fixedDatePositions) {
      positions = canvas._fixedDatePositions;
    } else {
      positions = new Array(5);
      var lastLabelLeft = (width - padding.right) - labelData[4].width;
      var labelSpace = (lastLabelLeft - minLeftPosition) / 4;
      for (var i = 0; i < 4; i++) {
        positions[i] = minLeftPosition + labelSpace * i;
      }
      positions[4] = width - padding.right;
      
      canvas._fixedDatePositions = positions.slice();
      canvas._fixedDateLabels = labelData.map(function(ld) { return ld.label; });
    }
    
    var labelsToUse = canvas._fixedDateLabels || labelData.map(function(ld) { return ld.label; });
    labelsToUse.forEach(function(label, i) {
      var x = positions[i];
      ctx.textAlign = (i === 4) ? 'right' : 'left';
      ctx.fillText(label, x, labelY);
    });
  }
  
  // Apply monthly earnings immediately when container appears
  function applyMonthlyEarningsEarly() {
    if (!isEarningStatsPage()) return;
    
    var container = document.querySelector('.b-stats-wrap');
    if (!container) return;
    
    // Check if already applied
    if (container.getAttribute('data-of-stats-months-applied')) return;
    
    var stats = getOrGenerateEarningStatsEarly();
    if (!stats || !stats.months || stats.months.length === 0) return;
    
    // Find "All time" row and collect rows to remove
    var allTimeRow = null;
    var existingMonthRows = [];
    var existingGeneratedRows = [];
    var allRows = container.querySelectorAll('.b-stats-row');
    
    allRows.forEach(function(row) {
      var monthEl = row.querySelector('.b-stats-row__month');
      if (monthEl) {
        if (isAllTimeText(monthEl.textContent)) {
          allTimeRow = row;
          // Mark All time row so CSS doesn't hide it
          row.setAttribute('data-of-stats-alltime', 'true');
        } else if (row.getAttribute('data-of-stats-generated')) {
          // Our previously generated rows - remove them too (for tab navigation)
          existingGeneratedRows.push(row);
        } else {
          existingMonthRows.push(row);
        }
      }
    });
    
    // Remove existing month rows (original ones)
    existingMonthRows.forEach(function(row) {
      row.remove();
    });
    
    // Remove previously generated rows (fixes duplicate bug on tab navigation)
    existingGeneratedRows.forEach(function(row) {
      row.remove();
    });
    
    // Watch for new original month rows being added and remove them
    if (!container.getAttribute('data-of-stats-observer')) {
      container.setAttribute('data-of-stats-observer', 'true');
      var observer = new MutationObserver(function(mutations) {
        mutations.forEach(function(mutation) {
          mutation.addedNodes.forEach(function(node) {
            if (node.nodeType === 1 && node.classList && node.classList.contains('b-stats-row')) {
              // Check if it's an original month row (not ours and not All time)
              if (!node.getAttribute('data-of-stats-generated') && !node.getAttribute('data-of-stats-alltime')) {
                var monthEl = node.querySelector('.b-stats-row__month');
                if (monthEl && !isAllTimeText(monthEl.textContent)) {
                  node.remove();
                  log('OF Stats: Removed dynamically added original month row');
                }
              }
            }
          });
        });
      });
      observer.observe(container, { childList: true });
    }
    
    // Add click handler to All time row if not already added
    if (allTimeRow && !allTimeRow.getAttribute('data-of-stats-click-handler')) {
      allTimeRow.setAttribute('data-of-stats-click-handler', 'true');
      var allTimeHead = allTimeRow.querySelector('.b-stats-row__head');
      if (allTimeHead) {
        allTimeHead.style.cursor = 'pointer';
        allTimeHead.addEventListener('click', function(e) {
          e.preventDefault();
          e.stopPropagation();
          toggleAllTimeRow(allTimeRow);
        });
      }
      
      // Use event delegation on the content area for category clicks
      // This ensures we catch clicks even if elements are recreated
      var allTimeContent = allTimeRow.querySelector('.b-stats-row__content');
      if (allTimeContent) {
        allTimeContent.addEventListener('click', function(e) {
          // Find the clicked label
          var label = e.target.closest('.b-stats-row__label.m-border-line:not(.m-total)');
          if (label) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            log('OF Stats: Category clicked in All time (delegated):', label.className);
            switchActiveCategoryAllTime(allTimeRow, label);
          }
        }, true); // capture phase
      }
      
      // Also add direct handlers on labels as backup
      var allTimeCategoryLabels = allTimeRow.querySelectorAll('.b-stats-row__label.m-border-line:not(.m-total)');
      allTimeCategoryLabels.forEach(function(label) {
        label.style.cursor = 'pointer';
        label.addEventListener('click', function(e) {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          log('OF Stats: Category clicked in All time (direct):', label.className);
          switchActiveCategoryAllTime(allTimeRow, label);
        }, true); // capture phase
      });
      
      // Set initial m-current on Subscriptions if not already set
      var subscriptionsLabel = allTimeRow.querySelector('.b-stats-row__label.m-subscriptions');
      if (subscriptionsLabel && !allTimeRow.querySelector('.b-stats-row__label.m-current')) {
        subscriptionsLabel.classList.add('m-current');
      }
    }
    
    // Mark as applied
    container.setAttribute('data-of-stats-months-applied', 'true');
    
    // Insert month rows after "All time" row
    var insertAfter = allTimeRow || container.firstChild;
    
    stats.months.forEach(function(monthData) {
      var row = createExpandableMonthRowEarly(monthData);
      
      if (insertAfter && insertAfter.nextSibling) {
        container.insertBefore(row, insertAfter.nextSibling);
        insertAfter = row;
      } else {
        container.appendChild(row);
        insertAfter = row;
      }
    });
    
    // Ensure All time row is expanded by default
    if (allTimeRow && !allTimeRow.classList.contains('m-expanded')) {
      var body = allTimeRow.querySelector('.b-stats-row__body');
      allTimeRow.classList.add('m-expanded');
      if (body) body.style.display = 'block';
    }
    
    log('OF Stats: Early applied ' + stats.months.length + ' expandable month rows');
  }
  
  // Toggle All time row expansion
  // Can switch between rows
  function toggleAllTimeRow(row) {
    var isExpanded = row.classList.contains('m-expanded');
    var body = row.querySelector('.b-stats-row__body');
    
    // If already expanded, do nothing (can't close last open row)
    if (isExpanded) {
      return;
    }
    
    // Collapse all other expanded rows (generated months)
    var container = row.closest('.b-stats-wrap');
    if (container) {
      container.querySelectorAll('.b-stats-row.m-expanded').forEach(function(expandedRow) {
        expandedRow.classList.remove('m-expanded');
        var expandedBody = expandedRow.querySelector('.b-stats-row__body');
        if (expandedBody) expandedBody.style.display = 'none';
        
        // Destroy previous month chart instance when collapsing
        var prevCanvas = expandedBody ? expandedBody.querySelector('canvas[data-of-stats-month-canvas]') : null;
        if (prevCanvas) {
          prevCanvas.removeAttribute('data-chart-drawn');
          if (prevCanvas._chartInstance) {
            prevCanvas._chartInstance.destroy();
            prevCanvas._chartInstance = null;
          }
          var ctx = prevCanvas.getContext('2d');
          if (ctx) ctx.clearRect(0, 0, prevCanvas.width, prevCanvas.height);
        }
      });
    }
    
    // Apply current active category to All time row before expanding
    applyActiveCategoryToAllTime(row, currentActiveCategory);
    
    // Expand All time row
    row.classList.add('m-expanded');
    if (body) {
      body.style.display = 'block';
      
      // Redraw All time chart with animation
      var canvas = row.querySelector('.b-chart__wrapper canvas[data-of-stats-overlay]');
      if (canvas) {
        // Set active category before drawing
        canvas.setAttribute('data-active-category', currentActiveCategory);
        
        // Destroy old Chart.js instance if exists
        if (canvas._chartInstance) {
          canvas._chartInstance.destroy();
          canvas._chartInstance = null;
        }
        canvas.removeAttribute('data-chart-drawn');
        
        // Clear canvas
        var ctx = canvas.getContext('2d');
        if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        // Get chart data and redraw with animation
        var chartData = canvas._chartData;
        if (chartData) {
          drawAllTimeChartCanvas(canvas, chartData);
        }
      }
    }
  }
  
  // Switch active category for All time chart and redraw
  function switchActiveCategoryAllTime(row, clickedLabel) {
    // Remove m-current from all category labels in this row (use m-current like original site)
    var allLabels = row.querySelectorAll('.b-stats-row__label.m-border-line:not(.m-total)');
    allLabels.forEach(function(label) {
      label.classList.remove('m-current');
    });
    
    // Add m-current to clicked label
    clickedLabel.classList.add('m-current');
    
    // Determine which category was clicked
    var categoryMap = {
      'm-subscriptions': 'subscriptions',
      'm-tips': 'tips',
      'm-posts': 'posts',
      'm-messages': 'messages',
      'm-referrals': 'referrals',
      'm-calls': 'streams'
    };
    
    var activeCategory = 'subscriptions'; // default
    var labelClass = clickedLabel.className || '';
    for (var cls in categoryMap) {
      if (labelClass.indexOf(cls) !== -1) {
        activeCategory = categoryMap[cls];
        break;
      }
    }
    
    // Save active category globally for syncing with month rows
    currentActiveCategory = activeCategory;
    
    // Also update all expanded month rows to use same category
    var container = row.closest('.b-stats-wrap');
    if (container) {
      container.querySelectorAll('.b-stats-row[data-of-stats-generated].m-expanded').forEach(function(monthRow) {
        applyActiveCategoryToMonth(monthRow, activeCategory);
      });
    }
    
    // Redraw chart with new active category (no animation on switch)
    // Canvas is inside .b-chart__wrapper with our overlay attribute
    var canvas = row.querySelector('.b-chart__wrapper canvas[data-of-stats-overlay][data-of-stats-alltime-canvas]');
    if (!canvas) {
      canvas = row.querySelector('canvas[data-of-stats-alltime-canvas]');
    }
    if (!canvas) {
      canvas = row.querySelector('.b-chart__wrapper canvas[data-of-stats-overlay]');
    }
    log('OF Stats: switchActiveCategoryAllTime - canvas found:', !!canvas, 'activeCategory:', activeCategory);
    if (canvas) {
      // Store active category on canvas for redraw
      canvas.setAttribute('data-active-category', activeCategory);
      
      // Trigger redraw without animation
      var chartData = canvas._chartData;
      log('OF Stats: chartData exists:', !!chartData, 'chartData:', chartData);
      if (chartData) {
        var ctx = canvas.getContext('2d');
        if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
        drawAllTimeChartCanvasNoAnimation(canvas, chartData);
        log('OF Stats: Chart redrawn with active category:', activeCategory);
      }
    }
  }
  
  // Apply active category to a month row (sync from All time)
  function applyActiveCategoryToMonth(monthRow, activeCategory) {
    var categoryClassMap = {
      'subscriptions': 'm-subscriptions',
      'tips': 'm-tips',
      'posts': 'm-posts',
      'messages': 'm-messages',
      'referrals': 'm-referrals',
      'streams': 'm-calls'
    };
    
    var targetClass = categoryClassMap[activeCategory] || 'm-subscriptions';
    
    // Find and click the matching category label
    var allLabels = monthRow.querySelectorAll('.b-stats-row__label.m-border-line:not(.m-total)');
    allLabels.forEach(function(label) {
      label.classList.remove('m-active');
      var nameEl = label.querySelector('.b-stats-row__name');
      if (nameEl) {
        nameEl.style.color = '#8a96a3';
        nameEl.style.opacity = '0.6';
      }
      
      if (label.classList.contains(targetClass)) {
        label.classList.add('m-active');
        if (nameEl) {
          nameEl.style.color = '#000';
          nameEl.style.opacity = '1';
        }
      }
    });
    
    // Redraw month chart with new category
    var canvas = monthRow.querySelector('canvas[data-of-stats-month-canvas]');
    if (canvas) {
      canvas.setAttribute('data-active-category', activeCategory);
      var chartData = canvas._chartData;
      if (chartData) {
        var ctx = canvas.getContext('2d');
        if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
        drawMonthChartCanvasNoAnimation(canvas, chartData);
      }
    }
  }
  
  // Detect dark mode by checking body background color
  function isDarkMode() {
    try {
      var bg = window.getComputedStyle(document.body).backgroundColor;
      if (!bg || bg === 'transparent') return false;
      var match = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      if (match) {
        var r = parseInt(match[1]), g = parseInt(match[2]), b = parseInt(match[3]);
        // If average brightness < 128, it's dark mode
        return (r + g + b) / 3 < 128;
      }
    } catch(e) {}
    return false;
  }

  // Get chart grid line color based on theme
  function getChartGridColor() {
    return isDarkMode() ? '#34363c' : '#eef2f7';
  }

  // Get chart label text color based on theme
  function getChartLabelColor() {
    return isDarkMode() ? '#e8e8e8' : '#333333';
  }

  // Get chart date label font based on theme
  function getChartDateFont() {
    return isDarkMode() ? '12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' : '600 11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  }

  // Apply chart overlay immediately when canvas appears
  function applyChartEarly() {
    if (!isEarningStatsPage()) return;
    
    var wrapper = document.querySelector('.b-chart__wrapper');
    if (!wrapper) return;
    
    // Check if overlay already exists
    if (wrapper.querySelector('[data-of-stats-overlay]')) return;
    
    var originalCanvas = wrapper.querySelector('canvas:not([data-of-stats-overlay])');
    if (!originalCanvas) return;
    
    var stats = getOrGenerateEarningStatsEarly();
    if (!stats || !stats.months || stats.months.length === 0) return;
    
    // Hide original canvas
    originalCanvas.style.visibility = 'hidden';
    
    // Generate chart data and create overlay
    // This will be handled by the full applyEarningStats later, 
    // but we hide original immediately to prevent flash
    log('OF Stats: Early hidden original chart canvas');
  }
  
  // Format number with commas
  function formatNumber(value) {
    if (!value) return value;
    let cleanValue = value.toString().trim().replace(/^\$/, '').trim();
    if (cleanValue.includes(',')) return cleanValue;
    const numMatch = cleanValue.match(/^(\d+)(\.(\d+))?$/);
    if (numMatch) {
      const intPart = numMatch[1];
      const decPart = numMatch[3] || '';
      const formattedInt = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
      return decPart ? formattedInt + '.' + decPart : formattedInt;
    }
    return cleanValue;
  }
  
  // Format percentage value
  function formatTopCreatorsPercentage(value) {
    if (!value) return value;
    let cleanValue = value.toString().trim().replace('%', '').trim();
    let num = parseFloat(cleanValue);
    if (isNaN(num)) return value;
    if (num < 1) return num.toFixed(2) + '%';
    if (Number.isInteger(num)) return num + '%';
    return cleanValue + '%';
  }
  
  // Check if we're on earnings page (statements or stats)
  function isEarningsPage() {
    const path = window.location.pathname;
    return path.includes('/my/statements/earnings') || path.includes('/my/stats/earnings') || path.includes('/my/statistics/statements/earnings');
  }
  
  // Check if we're on statistics/statements/earnings page (different UI)
  function isStatisticsStatementsEarningsPage() {
    return window.location.pathname.includes('/my/statistics/statements/earnings');
  }

  // Detect page language (ru / es / de / en)
  function getPageLanguage() {
    var htmlLang = (document.documentElement.lang || '').toLowerCase();
    if (htmlLang.startsWith('ru')) return 'ru';
    if (htmlLang.startsWith('es')) return 'es';
    if (htmlLang.startsWith('de')) return 'de';
    // Fallback: check for known UI text on the page
    var body = document.body ? (document.body.textContent || '').substring(0, 3000) : '';
    if (body.indexOf('Статистика') !== -1 || body.indexOf('Заявления') !== -1 || body.indexOf('Заработок') !== -1) return 'ru';
    if (body.indexOf('Estadísticas') !== -1 || body.indexOf('Ganancias') !== -1 || body.indexOf('Suscripciones') !== -1) return 'es';
    if (body.indexOf('Statistiken') !== -1 || body.indexOf('Einnahmen') !== -1 || body.indexOf('Abonnements') !== -1) return 'de';
    return 'en';
  }

  // Check if text is "All time" in any language
  function isAllTimeText(text) {
    var t = text.trim().toLowerCase();
    return t === 'all time' || t === 'все время' || t === 'за все время' || t === 'всё время'
        || t === 'todo el tiempo' || t === 'siempre' || t === 'todo tiempo'
        || t === 'gesamte zeit' || t === 'alle zeit' || t === 'gesamtzeitraum'
        || t === 'gesamt' || t === 'alle zeiten' || t === 'gesamter zeitraum'
        || t === 'immer' || t === 'zeitraum gesamt';
  }

  // Get localized Top Creators text
  function getTopCreatorsText(formattedPercentage) {
    var lang = getPageLanguage();
    var num = formattedPercentage.replace('%', '');
    if (lang === 'ru') return 'ВЫ НАХОДИТЕСЬ В ТОП% ' + num + 'ВСЕХ СОЗДАТЕЛЕЙ!';
    if (lang === 'es') return '¡Estáis en el TOP% ' + num + 'de todos los creadores!';
    if (lang === 'de') return 'SIE SINDEN IN DEN TOP% ' + num + 'ALLE Schöpfer!';
    return 'YOU ARE IN THE TOP ' + formattedPercentage + ' OF ALL CREATORS!';
  }

  // Check if text content looks like a Top Creators block (any language)
  function isTopCreatorsText(textContent) {
    var t = textContent.toUpperCase();
    return (t.indexOf('TOP') !== -1 && (t.indexOf('CREATORS') !== -1 || t.indexOf('CREADORES') !== -1 || t.indexOf('ERSTELLER') !== -1 || t.indexOf('SCHÖPFER') !== -1 || t.indexOf('SCHOPFER') !== -1)) ||
           (t.indexOf('ТОП') !== -1 && t.indexOf('СОЗДАТЕЛЕЙ') !== -1);
  }

  // Check if button text is a withdrawal request button (any language)
  function isWithdrawalButton(btnText) {
    var t = btnText.toLowerCase();
    return t.includes('request withdrawal') || t.includes('запрос на вывод')
        || t.includes('solicitar retiro') || t.includes('auszahlung anfordern');
  }

  // Check if name matches Gross label (any language)
  function isGrossLabel(name) {
    var n = name.toLowerCase().trim();
    return n === 'gross' || n === 'валовой' || n === 'гросс' || n === 'bruto' || n === 'brutto';
  }

  // Check if name matches Net label (any language)
  function isNetLabel(name) {
    var n = name.toLowerCase().trim();
    return n === 'net' || n === 'чистая' || n === 'neto' || n === 'neta' || n === 'netto';
  }

  // Get localized label for Gross
  function getLocalizedGrossLabel() {
    var lang = getPageLanguage();
    if (lang === 'ru') return 'Валовой';
    if (lang === 'es') return 'Bruto';
    if (lang === 'de') return 'Brutto';
    return 'Gross';
  }

  // Get localized label for Net
  function getLocalizedNetLabel() {
    var lang = getPageLanguage();
    if (lang === 'ru') return 'Чистая';
    if (lang === 'es') return 'Neto';
    if (lang === 'de') return 'Netto';
    return 'Net';
  }

  // Get localized earnings description
  function getEarningsDescription(type, userId, username) {
    var lang = getPageLanguage();
    if (lang === 'ru') {
      return type === 'tip'
        ? 'Чаевые от <a href="https://onlyfans.com/' + userId + '">' + username + '</a>'
        : 'Оплата за сообщение от <a href="https://onlyfans.com/' + userId + '">' + username + '</a>';
    }
    if (lang === 'es') {
      return type === 'tip'
        ? 'Propina de <a href="https://onlyfans.com/' + userId + '">' + username + '</a>'
        : 'Pago por mensaje de <a href="https://onlyfans.com/' + userId + '">' + username + '</a>';
    }
    if (lang === 'de') {
      return type === 'tip'
        ? 'Trinkgeld von <a href="https://onlyfans.com/' + userId + '">' + username + '</a>'
        : 'Zahlung für Nachricht von <a href="https://onlyfans.com/' + userId + '">' + username + '</a>';
    }
    return type === 'tip'
      ? 'Tip from <a href="https://onlyfans.com/' + userId + '">' + username + '</a>'
      : 'Payment for message from <a href="https://onlyfans.com/' + userId + '">' + username + '</a>';
  }

  // Get localized status tooltip text
  function getStatusTooltipText(status, daysRemaining) {
    var lang = getPageLanguage();
    if (lang === 'ru') {
      if (status === 'complete') return 'Завершить';
      if (status === 'reversed') return 'Перевернутый';
      return 'Заработок станет доступен в ' + daysRemaining + ' течение нескольких дней';
    }
    if (lang === 'es') {
      if (status === 'complete') return 'Completado';
      if (status === 'reversed') return 'Revertido';
      return 'Las ganancias estarán disponibles en ' + daysRemaining + ' día' + (daysRemaining !== 1 ? 's' : '');
    }
    if (lang === 'de') {
      if (status === 'complete') return 'Abgeschlossen';
      if (status === 'reversed') return 'Storniert';
      return 'Einnahmen verfügbar in ' + daysRemaining + ' Tag' + (daysRemaining !== 1 ? 'en' : '');
    }
    if (status === 'complete') return 'Complete';
    if (status === 'reversed') return 'Reversed';
    return 'Earning will become available in ' + daysRemaining + ' day' + (daysRemaining !== 1 ? 's' : '');
  }

  // Russian pluralization for days
  function getRuDaysWord(n) {
    var m = n % 10;
    var m2 = n % 100;
    if (m === 1 && m2 !== 11) return 'день';
    if (m >= 2 && m <= 4 && (m2 < 12 || m2 > 14)) return 'дня';
    return 'дней';
  }
  
  // Update Top Creators percentage in existing block or create new
  function updateTopCreatorsBanner() {
    if (!cachedSettings || !cachedSettings.topCreators) return;
    if (!isEarningsPage()) return;
    
    const formattedPercentage = formatTopCreatorsPercentage(cachedSettings.topCreators);

    // === /my/statistics/statements/earnings page ===
    // This page has a native Vue-controlled .b-top-rated block.
    // Vue re-renders this block continuously (first English, then translated).
    // We CANNOT edit its textContent — Vue overwrites it immediately.
    // Instead: hide native block via CSS, create our own block next to it.
    if (isStatisticsStatementsEarningsPage()) {
      // Inject persistent CSS to hide ALL native .b-top-rated blocks on this page
      // (always inject, even before native block exists, to prevent flash)
      if (!document.getElementById('of-stats-hide-native-top-rated')) {
        var hideStyle = document.createElement('style');
        hideStyle.id = 'of-stats-hide-native-top-rated';
        hideStyle.textContent = '.b-top-rated:not(#of-stats-top-creators-rated){display:none!important}';
        (document.head || document.documentElement).appendChild(hideStyle);
      }
      // Create or update our own block
      createTopCreatorsBlockStatistics(formattedPercentage);
      return;
    }
    
    // === /my/statements/earnings page ===
    // This page has a g-box style block with Top Creators text.
    // We update its text to our localized version.
    var localizedText = getTopCreatorsText(formattedPercentage);
    const allGBoxes = document.querySelectorAll('.g-box.m-with-icon.m-panel');
    let found = false;
    
    allGBoxes.forEach(function(box) {
      const textContent = box.textContent || '';
      if (isTopCreatorsText(textContent)) {
        const paragraph = box.querySelector('p, .g-box__header p');
        if (paragraph) {
          paragraph.innerHTML = localizedText;
          found = true;
          // If OF's own block was found (not our custom one), remove our custom block
          if (box.id !== 'of-stats-top-creators') {
            var ourBlock = document.getElementById('of-stats-top-creators');
            if (ourBlock) ourBlock.remove();
          }
        }
      }
    });
    
    // If not found, create the block
    if (!found) {
      createTopCreatorsBlock(formattedPercentage);
    }
  }
  
  // Create Top Creators block
  function createTopCreatorsBlock(formattedPercentage) {
    if (!isEarningsPage()) return false;
    if (document.getElementById('of-stats-top-creators')) return true;
    
    // Use different structure for /my/statistics/statements/earnings page
    if (isStatisticsStatementsEarningsPage()) {
      return createTopCreatorsBlockStatistics(formattedPercentage);
    }
    
    var block = document.createElement('div');
    block.id = 'of-stats-top-creators';
    block.className = 'g-box m-with-icon m-panel';
    block.innerHTML = '<div class="g-box__header"><svg class="g-box__icon g-icon" aria-hidden="true"><use href="#icon-star6" xlink:href="#icon-star6"></use></svg><p>' + getTopCreatorsText(formattedPercentage) + '</p></div>';
    
    // Add styles immediately
    if (!document.getElementById('of-stats-top-creators-style')) {
      var style = document.createElement('style');
      style.id = 'of-stats-top-creators-style';
      style.textContent = '#of-stats-top-creators{position:relative;border-radius:6px;margin:0 0 12px;width:100%;font-size:13px;overflow:hidden}#of-stats-top-creators::after{content:"";position:absolute;left:0;right:0;top:0;bottom:0;border:1px solid rgba(138,150,163,.25);border-radius:6px;pointer-events:none;z-index:1}#of-stats-top-creators .g-box__header{background:rgba(0,175,240,.12);padding:10px 17px 10px 52px;font-size:13px;font-weight:500;border-radius:6px;text-transform:uppercase;width:100%;display:flex;flex-direction:row;align-items:center;justify-content:flex-start}#of-stats-top-creators .g-box__icon{position:absolute;top:50%;left:16px;transform:translateY(-50%);width:24px;height:24px;display:inline-block;fill:currentColor;line-height:1;flex:0 0 24px}#of-stats-top-creators .g-box__icon use{color:#fa0}#of-stats-top-creators .g-box__header p{margin:0;line-height:16px}';
      if (document.head) {
        document.head.appendChild(style);
      } else {
        document.documentElement.appendChild(style);
      }
    }
    
    // Try multiple insertion points - with null checks
    var inserted = false;
    
    // Try .g-main-content first (main content wrapper)
    var mainContent = document.querySelector('.g-main-content');
    if (mainContent && mainContent.firstElementChild && !inserted) {
      try {
        mainContent.insertBefore(block, mainContent.firstElementChild);
        inserted = true;
      } catch(e) {}
    }
    
    // Try balance section
    if (!inserted) {
      var balanceSection = document.querySelector('.b-make-modal-w, [class*="balance"]');
      if (balanceSection && balanceSection.parentNode) {
        try {
          balanceSection.parentNode.insertBefore(block, balanceSection);
          inserted = true;
        } catch(e) {}
      }
    }
    
    // Try .b-payout__wrapper
    if (!inserted) {
      var payoutWrapper = document.querySelector('.b-payout__wrapper');
      if (payoutWrapper && payoutWrapper.firstChild) {
        try {
          payoutWrapper.insertBefore(block, payoutWrapper.firstChild);
          inserted = true;
        } catch(e) {}
      }
    }
    
    // Try row container after header
    if (!inserted) {
      var rowAfterHeader = document.querySelector('.g-page__header + .row, .row');
      if (rowAfterHeader && rowAfterHeader.firstChild) {
        try {
          rowAfterHeader.insertBefore(block, rowAfterHeader.firstChild);
          inserted = true;
        } catch(e) {}
      }
    }
    
    return inserted;
  }
  
  // Create Top Creators block for /my/statistics/statements/earnings page (b-top-rated style)
  function createTopCreatorsBlockStatistics(formattedPercentage) {
    var localizedText = getTopCreatorsText(formattedPercentage);
    // If our block already exists, just update its text
    var existing = document.getElementById('of-stats-top-creators-rated');
    if (existing) {
      var existingText = existing.querySelector('.b-top-rated__text');
      if (existingText) existingText.textContent = ' ' + localizedText + ' ';
      return true;
    }
    
    var block = document.createElement('div');
    block.id = 'of-stats-top-creators-rated';
    block.className = 'b-top-rated m-bordered';
    block.setAttribute('data-v-e08a9fd4', '');
    block.innerHTML = '<svg data-v-e08a9fd4="" class="b-top-rated__icon g-icon" data-icon-name="icon-star-on" aria-hidden="true"><use href="#icon-star-on" xlink:href="#icon-star-on"></use></svg><div data-v-e08a9fd4="" class="b-top-rated__text"> ' + localizedText + ' </div>';
    
    // Add styles immediately
    if (!document.getElementById('of-stats-top-creators-rated-style')) {
      var style = document.createElement('style');
      style.id = 'of-stats-top-creators-rated-style';
      style.textContent = '#of-stats-top-creators-rated.b-top-rated{display:flex!important;align-items:center;gap:4px;background:#fff!important;border:1px solid rgba(138,150,163,.25)!important;border-radius:6px;padding:14px 20px;margin-bottom:12px;font-size:14px;font-weight:500;white-space:nowrap;text-transform:none!important}#of-stats-top-creators-rated .b-top-rated__icon{width:24px;height:24px;flex-shrink:0;fill:#00aff0}#of-stats-top-creators-rated .b-top-rated__text{line-height:1.2;white-space:nowrap;position:relative;top:1px;margin-left:-2px;text-transform:none!important}';

      if (document.head) {
        document.head.appendChild(style);
      } else {
        document.documentElement.appendChild(style);
      }
    }
    
    // Try multiple insertion points
    var inserted = false;
    
    // Try .b-statements-balances (balance section on this page)
    var balancesSection = document.querySelector('.b-statements-balances');
    if (balancesSection && balancesSection.parentNode && !inserted) {
      try {
        balancesSection.parentNode.insertBefore(block, balancesSection);
        inserted = true;
      } catch(e) {}
    }
    
    // Try .g-main-content
    if (!inserted) {
      var mainContent = document.querySelector('.g-main-content');
      if (mainContent && mainContent.firstElementChild) {
        try {
          mainContent.insertBefore(block, mainContent.firstElementChild);
          inserted = true;
        } catch(e) {}
      }
    }
    
    // Try .b-payout__wrapper
    if (!inserted) {
      var payoutWrapper = document.querySelector('.b-payout__wrapper');
      if (payoutWrapper && payoutWrapper.firstChild) {
        try {
          payoutWrapper.insertBefore(block, payoutWrapper.firstChild);
          inserted = true;
        } catch(e) {}
      }
    }
    
    return inserted;
  }

  // Watch html[lang] changes — Vue sets this when i18n initializes.
  // When the language changes, update our Top Creators block text.
  (function() {
    var langObserver = new MutationObserver(function() {
      var our = document.getElementById('of-stats-top-creators-rated');
      if (!our || !cachedSettings || !cachedSettings.topCreators) return;
      var lang = getPageLanguage();
      if (lang === 'en') return; // still waiting
      var textEl = our.querySelector('.b-top-rated__text');
      if (textEl) {
        var pct = formatTopCreatorsPercentage(cachedSettings.topCreators);
        textEl.textContent = ' ' + getTopCreatorsText(pct) + ' ';
      }
    });
    langObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
  })();

  // ==================== EARLY EARNINGS GENERATOR ====================
  
  // Realistic usernames based on real patterns
  var earningsUsernames = [
    // Short names (most common)
    'Dan', 'Alex', 'John', 'Jake', 'Mike', 'Chris', 'Matt', 'Nick', 'Tom', 'Ben',
    'Sam', 'Joe', 'Rob', 'Dave', 'Steve', 'Mark', 'Paul', 'Ryan', 'Tony', 'James',
    'Viktor', 'Nader', 'Joel', 'Robbin', 'Marty', 'Jale', 'Cristian', 'Sean', 'Kris',
    'Charlie', 'Jan', 'Jindra', 'Kairi', 'ElDano', 'Kowal', 'Clone', 'Fastburn',
    // Internet style names
    'MrXhot', 'Mongalio', 'HadTraNer', 'Nomore', 'djwkflsla', 'JayWDRM', 'PonasBybis',
    'TheRealKing', 'szamsik', 'hotbillybob', 'Clone_Soldat', 'Lx1', 'BigBoss',
    // With numbers
    'Mike92', 'Chris85', 'Alex2001', 'John88', 'Dave87', 'Matt99', 'James82',
    'Rob94', 'Tom00', 'Nick91', 'hotbillybob1903', 'Gamer2020', 'Player1',
    // Gamer/cool tags  
    'DarkKnight', 'ShadowX', 'IceMan', 'WolfPack', 'StormRider', 'NightOwl',
    'RedFox', 'BlackHawk', 'SilentKing', 'PhantomX', 'IronWolf', 'GhostRider',
    'ThunderX', 'Viper', 'Falcon', 'Blaze', 'Reaper', 'Hunter', 'Warrior',
    // Compound names
    'BigDave', 'LilSam', 'MrJames', 'TheReal', 'JustMike', 'OnlyAlex',
    'CoolCat', 'ChillGuy', 'HappyDude', 'LazyBear', 'WildCard', 'LuckyStar',
    // Location/hobby style
    'NYCGuy', 'LAKid', 'TexasBoy', 'Skater', 'Surfer', 'Biker', 'Gamer',
    'Traveler', 'Photographer', 'Artist', 'Musician', 'Boxer', 'Wrestler',
    // Mixed style
    'xXShadowXx', 'Pr0Player', 'EpicWin', 'TryHard', 'NoobMaster', 'EzMode',
    // Simple variations
    'Johnny', 'Mikey', 'Danny', 'Sammy', 'Bobby', 'Jimmy', 'Tommy', 'Billy',
    'Ricky', 'Franky', 'Eddie', 'Freddy', 'Teddy', 'Kenny', 'Jerry', 'Larry'
  ];
  
  var earningsUsedNames = {};
  
  function earningsGenerateUsername() {
    // 8% chance for numeric ID style
    if (Math.random() < 0.08) {
      return 'u' + Math.floor(Math.random() * 900000000 + 100000000);
    }
    
    // Reset if too many used
    var usedCount = 0;
    for (var k in earningsUsedNames) usedCount++;
    if (usedCount > earningsUsernames.length * 0.8) {
      earningsUsedNames = {};
    }
    
    // Pick unused username
    var attempts = 0;
    var username;
    do {
      username = earningsUsernames[Math.floor(Math.random() * earningsUsernames.length)];
      attempts++;
    } while (earningsUsedNames[username] && attempts < 20);
    
    // Small variation sometimes (10% chance)
    if (Math.random() < 0.10) {
      var rand = Math.random();
      if (rand < 0.5) {
        username = username + Math.floor(Math.random() * 99 + 1);
      } else {
        username = username + (1980 + Math.floor(Math.random() * 45));
      }
    }
    
    earningsUsedNames[username] = true;
    return username;
  }
  
  function earningsGenerateAmount() {
    var rand = Math.random();
    if (rand < 0.35) return 5 + Math.floor(Math.random() * 11);
    if (rand < 0.60) return 15 + Math.floor(Math.random() * 16);
    if (rand < 0.80) return 30 + Math.floor(Math.random() * 21);
    if (rand < 0.92) return 50 + Math.floor(Math.random() * 51);
    return 100 + Math.floor(Math.random() * 51);
  }
  
  function earningsFormatDate(date) {
    var lang = getPageLanguage();
    if (lang === 'ru') {
      var ruMonths = ['янв.', 'февр.', 'март', 'апр.', 'май', 'июнь', 'июль', 'авг.', 'сент.', 'окт.', 'нояб.', 'дек.'];
      return date.getDate() + ' ' + ruMonths[date.getMonth()] + ', ' + date.getFullYear();
    }
    if (lang === 'es') {
      var esMonths = ['ene.', 'feb.', 'mar.', 'abr.', 'may.', 'jun.', 'jul.', 'ago.', 'sep.', 'oct.', 'nov.', 'dic.'];
      return date.getDate() + ' ' + esMonths[date.getMonth()] + ', ' + date.getFullYear();
    }
    if (lang === 'de') {
      var deMonths = ['Jan.', 'Feb.', 'Mär.', 'Apr.', 'Mai', 'Jun.', 'Jul.', 'Aug.', 'Sep.', 'Okt.', 'Nov.', 'Dez.'];
      return date.getDate() + '. ' + deMonths[date.getMonth()] + ' ' + date.getFullYear();
    }
    var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return months[date.getMonth()] + ' ' + date.getDate() + ', ' + date.getFullYear();
  }
  
  function earningsFormatTime(date) {
    var hours = date.getHours();
    var minutes = date.getMinutes().toString().padStart(2, '0');
    var ampm = hours >= 12 ? 'pm' : 'am';
    hours = hours % 12 || 12;
    return hours + ':' + minutes + ' ' + ampm;
  }
  
  var earningsApplied = false; // Flag to prevent re-applying
  var lastCheckedUrl = window.location.href; // Track URL for SPA navigation
  var lastCheckedLang = getPageLanguage(); // Track language for re-render on language switch
  
  // Reset earnings state when navigating away
  function resetEarningsState() {
    earningsApplied = false;
    window.ofStatsEarningsApplied = false;
    window.ofStatsEarningsIndex = 0;
    window.ofStatsEarningsDelayDone = false; // Reset delay flag for next visit
    // Disconnect observer if exists
    if (window.ofStatsTbodyObserver) {
      window.ofStatsTbodyObserver.disconnect();
      window.ofStatsTbodyObserver = null;
    }
    // Remove scroll handler
    if (window.ofStatsScrollHandler) {
      window.removeEventListener('scroll', window.ofStatsScrollHandler);
      window.ofStatsScrollHandler = null;
    }
    // Don't clear transactions - keep cached data
  }
  
  // Helper to check if URL is an earnings page
  function isEarningsPageUrl(url) {
    return url.includes('/my/statements/earnings') || 
           url.includes('/my/statistics/statements/earnings') ||
           url.includes('/my/stats/earnings');
  }
  
  // Check if URL changed (SPA navigation)
  function checkUrlChange() {
    var currentUrl = window.location.href;
    if (currentUrl !== lastCheckedUrl) {
      var wasEarningsPage = isEarningsPageUrl(lastCheckedUrl);
      var isNowEarningsPage = isEarningsPageUrl(currentUrl);
      // Also track if we're moving between different earnings pages
      var changedEarningsPage = wasEarningsPage && isNowEarningsPage && lastCheckedUrl !== currentUrl;
      
      lastCheckedUrl = currentUrl;
      
      // If navigated away from earnings, reset state and remove hide style
      if (wasEarningsPage && !isNowEarningsPage) {
        resetEarningsState();
        // Remove hide style when leaving earnings page
        var hideStyle = document.getElementById('of-stats-hide-earnings-spa');
        if (hideStyle) hideStyle.remove();
      }
      
      // If navigated to earnings (or moved between earnings pages), hide original rows first, then apply our data
      if (isNowEarningsPage || changedEarningsPage) {
        // Re-read settings from localStorage in case they were updated
        try {
          var freshCache = localStorage.getItem('ofStatsCache');
          if (freshCache) {
            cachedSettings = JSON.parse(freshCache);
          }
        } catch(e) {}
        
        // Immediately hide original rows to prevent flash
        if (cachedSettings && (cachedSettings.earningsCount || cachedSettings.earningsCompleteCount)) {
          if (!document.getElementById('of-stats-hide-earnings-spa')) {
            var hideStyle = document.createElement('style');
            hideStyle.id = 'of-stats-hide-earnings-spa';
            hideStyle.textContent = 'table.b-table.m-responsive.m-earnings tbody tr:not([data-of-stats]):not(:has(.infinite-loading-container)) { visibility: hidden !important; height: 0 !important; overflow: hidden !important; }';
            document.head.appendChild(hideStyle);
          }
        }
        
        // Only reset the applied flag, not the cached data
        earningsApplied = false;
        window.ofStatsEarningsApplied = false;
        setTimeout(applyEarningsEarly, 100);
        setTimeout(applyEarningsEarly, 250);
        setTimeout(applyEarningsEarly, 400);
        setTimeout(applyEarningsEarly, 600);
        setTimeout(applyEarningsEarly, 800);
      }
    }
    
    // Detect language change (e.g. switching OnlyFans between English and Russian)
    var currentLang = getPageLanguage();
    if (currentLang !== lastCheckedLang) {
      log('OF Stats: Language changed from ' + lastCheckedLang + ' to ' + currentLang + ', re-rendering');
      lastCheckedLang = currentLang;
      
      // Force re-render of statistics/statements/earnings page
      var wrapper = document.querySelector('.b-statistics-page-content__wrapper');
      if (wrapper) {
        wrapper.querySelectorAll('[data-of-stats-generated]').forEach(function(el) {
          el.remove();
        });
        wrapper.removeAttribute('data-of-stats-applied');
      }
      
      // Force re-render of stats page (/my/stats)
      var statsWrap = document.querySelector('.b-stats-wrap');
      if (statsWrap) {
        statsWrap.removeAttribute('data-of-stats-months-applied');
        statsWrap.removeAttribute('data-of-stats-observer');
        // Remove generated month rows
        statsWrap.querySelectorAll('[data-of-stats-generated]').forEach(function(el) {
          el.remove();
        });
        // Remove data-of-stats-modified from All time values so they re-apply
        statsWrap.querySelectorAll('[data-of-stats-modified]').forEach(function(el) {
          el.removeAttribute('data-of-stats-modified');
        });
        // Remove click handler flags so they re-attach
        statsWrap.querySelectorAll('[data-of-stats-click-handler]').forEach(function(el) {
          el.removeAttribute('data-of-stats-click-handler');
        });
      }
      
      // Remove overlay canvases (they have old language labels)
      document.querySelectorAll('canvas[data-of-stats-overlay]').forEach(function(el) {
        el.remove();
      });
      // Remove chart tooltips
      document.querySelectorAll('[data-of-stats-alltime-tooltip]').forEach(function(el) {
        el.remove();
      });
      // Restore hidden original canvases
      document.querySelectorAll('.b-chart__wrapper canvas').forEach(function(el) {
        if (el.style.visibility === 'hidden') {
          el.style.visibility = '';
        }
      });
      
      // Force re-render of earnings (statements) page
      earningsApplied = false;
      window.ofStatsEarningsApplied = false;
      
      // Remove generated earnings rows so they get recreated with new language
      document.querySelectorAll('tr[data-of-stats]').forEach(function(el) {
        el.remove();
      });
      
      // Re-apply everything with staggered timeouts
      setTimeout(applyEarningsEarly, 100);
      setTimeout(applyEarningsEarly, 300);
      setTimeout(applyEarningsEarly, 600);
      
      // Re-apply stats page
      setTimeout(function() {
        if (isEarningStatsPage()) {
          applyMonthlyEarningsEarly();
          applyChartEarly();
        }
        applyEarningStats();
      }, 150);
      setTimeout(function() {
        if (isEarningStatsPage()) {
          applyMonthlyEarningsEarly();
          applyChartEarly();
        }
        applyEarningStats();
      }, 400);
      setTimeout(function() {
        if (isEarningStatsPage()) {
          applyMonthlyEarningsEarly();
          applyChartEarly();
        }
        applyEarningStats();
      }, 800);
      
      // Re-apply statistics/statements/earnings page
      try {
        if (localStorage.getItem('ofStatsStatisticsChartDisabled') !== 'true') {
          setTimeout(applyStatisticsEarningsPage, 200);
          setTimeout(applyStatisticsEarningsPage, 500);
          setTimeout(applyStatisticsEarningsPage, 1000);
        }
      } catch(e) {
        setTimeout(applyStatisticsEarningsPage, 200);
      }
    }
  }
  
  // Poll for URL changes (catches SPA navigation)
  setInterval(checkUrlChange, 200);
  
  // Also listen to popstate for back/forward navigation
  window.addEventListener('popstate', function() {
    setTimeout(checkUrlChange, 50);
  });
  
  // Check if already applied (also check window flag for cross-script coordination)
  function isEarningsAlreadyApplied() {
    if (earningsApplied) return true;
    if (window.ofStatsEarningsApplied) return true;
    return false;
  }
  
  // Get or generate earnings data - uses localStorage to persist across page reloads
  // pendingCount = transactions within 7 days (status: pending/loading)
  // completeCount = transactions older than 7 days (status: complete ~98%, reversed ~2%)
  function getOrGenerateEarningsData(pendingCount, completeCount) {
    completeCount = completeCount || 0;
    var totalCount = pendingCount + completeCount;
    var cacheKey = 'ofStatsEarningsData';
    var keyKey = 'ofStatsEarningsKey';
    // Version 7: Fixed tooltip days calculation (7 - daysSince instead of 6)
    var today = new Date();
    var todayStr = today.getFullYear() + '-' + (today.getMonth() + 1) + '-' + today.getDate();
    var currentKey = 'earnings_v7_' + pendingCount + '_' + completeCount + '_' + todayStr;
    
    try {
      var savedKey = localStorage.getItem(keyKey);
      var savedData = localStorage.getItem(cacheKey);
      
      // If key matches and data exists, use cached data
      if (savedKey === currentKey && savedData) {
        var parsed = JSON.parse(savedData);
        // Restore Date objects
        for (var i = 0; i < parsed.length; i++) {
          parsed[i].date = new Date(parsed[i].date);
        }
        return parsed;
      }
    } catch(e) {}
    
    // Generate new data
    var generated = [];
    var now = new Date();
    
    // Calculate cutoff date (7 days ago at start of day)
    // If today is Jan 16, pending can be Jan 9-16 (16 - 7 = 9)
    // So cutoff is 7 days ago at 00:00:00
    var cutoffDate = new Date(now);
    cutoffDate.setDate(cutoffDate.getDate() - 7);
    cutoffDate.setHours(0, 0, 0, 0);
    
    // Generate PENDING transactions (last 7 days) - STRICT 7 day limit
    // Jan 16 minus 7 days = Jan 9, so we need Jan 9-16 = 8 calendar days
    // First, create array of available days (today and 7 days back)
    var pendingDays = [];
    for (var d = 0; d <= 7; d++) {  // 0-7 = 8 days (Jan 9-16)
      var dayDate = new Date(now);
      dayDate.setDate(dayDate.getDate() - d);
      dayDate.setHours(0, 0, 0, 0);
      pendingDays.push(dayDate);
    }
    
    // Distribute transactions evenly across all 8 days
    var numDays = pendingDays.length; // 8 days
    var basePerDay = Math.floor(pendingCount / numDays);
    var extraTrans = pendingCount % numDays;
    
    var transPerDay = [];
    for (var d = 0; d < numDays; d++) {
      // Give extra transactions to earlier days (more recent)
      var dayTrans = basePerDay + (d < extraTrans ? 1 : 0);
      transPerDay.push(dayTrans);
    }
    
    // Generate transactions for each day
    for (var dayIndex = 0; dayIndex < numDays; dayIndex++) {
      var dayTransCount = transPerDay[dayIndex];
      if (dayTransCount <= 0) continue;
      
      var dayStart = new Date(pendingDays[dayIndex]);
      dayStart.setHours(0, 0, 0, 0);
      var dayEnd = new Date(pendingDays[dayIndex]);
      dayEnd.setHours(23, 59, 59, 0);
      
      // Generate times for this day, spread throughout the day
      var dayTransactions = [];
      for (var t = 0; t < dayTransCount; t++) {
        // Spread evenly with some randomness
        var hourSlot = 23 - Math.floor((t / dayTransCount) * 24);
        var hour = Math.max(0, Math.min(23, hourSlot + Math.floor(Math.random() * 2 - 1)));
        var minute = Math.floor(Math.random() * 60);
        
        var transDate = new Date(dayStart);
        transDate.setHours(hour, minute, Math.floor(Math.random() * 60), 0);
        
        var amount = earningsGenerateAmount();
        dayTransactions.push({
          date: transDate,
          amount: amount,
          fee: amount * 0.20,
          net: amount * 0.80,
          type: Math.random() < 0.70 ? 'payment' : 'tip',
          username: earningsGenerateUsername(),
          userId: 'u' + Math.floor(Math.random() * 900000000 + 100000000),
          status: 'pending'
        });
      }
      
      // Sort by time descending and add to generated
      dayTransactions.sort(function(a, b) { return b.date - a.date; });
      generated = generated.concat(dayTransactions);
    }
    
    // Debug logging for pending date range
    if (pendingDays.length > 0) {
      var firstPending = pendingDays[0]; // Most recent (today)
      var lastPending = pendingDays[pendingDays.length - 1]; // Oldest pending (7 days ago)
      log('OF Stats: Pending date range: ' + earningsFormatDate(lastPending) + ' to ' + earningsFormatDate(firstPending) + ' (' + pendingDays.length + ' days)');
    }
    
    // Generate COMPLETE transactions (older than 7 days)
    // Pending is last 7 days (e.g., Jan 9-16), so complete starts from day 8 (Jan 8)
    if (completeCount > 0) {
      // Calculate how many days we need for complete transactions
      var daysNeeded = Math.ceil(completeCount / 10); // ~10 per day max
      daysNeeded = Math.max(daysNeeded, 7); // At least spread over a week
      
      // Create array of available days for complete (starting 8 days ago)
      var completeDays = [];
      for (var cd = 8; cd < 8 + daysNeeded; cd++) {
        var cDayDate = new Date(now);
        cDayDate.setDate(cDayDate.getDate() - cd);
        cDayDate.setHours(0, 0, 0, 0);
        completeDays.push(cDayDate);
      }
      
      // Debug logging for complete date range
      if (completeDays.length > 0) {
        var firstComplete = completeDays[0]; // Most recent complete (8 days ago)
        var lastComplete = completeDays[completeDays.length - 1]; // Oldest complete
        log('OF Stats: Complete date range: ' + earningsFormatDate(lastComplete) + ' to ' + earningsFormatDate(firstComplete) + ' (' + completeDays.length + ' days)');
      }
      
      // Distribute complete transactions across days
      var completePerDay = [];
      var remainingComplete = completeCount;
      
      for (var cd = 0; cd < completeDays.length; cd++) {
        if (cd < completeDays.length - 1) {
          var cDayTrans = Math.ceil(remainingComplete / (completeDays.length - cd) * (0.8 + Math.random() * 0.4));
          cDayTrans = Math.max(1, Math.min(cDayTrans, remainingComplete));
          completePerDay.push(cDayTrans);
          remainingComplete -= cDayTrans;
        } else {
          completePerDay.push(remainingComplete);
        }
      }
      
      // Generate transactions for each complete day
      for (var cDayIndex = 0; cDayIndex < completeDays.length; cDayIndex++) {
        var cDayTransCount = completePerDay[cDayIndex];
        if (cDayTransCount <= 0) continue;
        
        var cDayStart = new Date(completeDays[cDayIndex]);
        
        for (var ct = 0; ct < cDayTransCount; ct++) {
          var cHour = 23 - Math.floor((ct / cDayTransCount) * 24);
          cHour = Math.max(0, Math.min(23, cHour + Math.floor(Math.random() * 2 - 1)));
          var cMinute = Math.floor(Math.random() * 60);
          
          var transDate2 = new Date(cDayStart);
          transDate2.setHours(cHour, cMinute, Math.floor(Math.random() * 60), 0);
          
          var amount2 = earningsGenerateAmount();
          // ~2% reversed, ~98% complete
          var status = Math.random() < 0.02 ? 'reversed' : 'complete';
          
          generated.push({
            date: transDate2,
            amount: amount2,
            fee: amount2 * 0.20,
            net: amount2 * 0.80,
            type: Math.random() < 0.70 ? 'payment' : 'tip',
            username: earningsGenerateUsername(),
            userId: 'u' + Math.floor(Math.random() * 900000000 + 100000000),
            status: status
          });
        }
      }
    }
    
    generated.sort(function(a, b) { return b.date - a.date; });
    
    // Save to localStorage
    try {
      localStorage.setItem(keyKey, currentKey);
      localStorage.setItem(cacheKey, JSON.stringify(generated));
    } catch(e) {}
    
    return generated;
  }
  
  // Status tooltip element (singleton)
  var statusTooltipEl = null;
  
  function getStatusTooltip() {
    if (!statusTooltipEl) {
      statusTooltipEl = document.createElement('div');
      statusTooltipEl.className = 'of-stats-status-tooltip';
      document.body.appendChild(statusTooltipEl);
    }
    return statusTooltipEl;
  }
  
  function showStatusTooltip(target, text) {
    var tooltip = getStatusTooltip();
    tooltip.textContent = text;
    
    var rect = target.getBoundingClientRect();
    tooltip.style.left = (rect.left + rect.width / 2) + 'px';
    tooltip.style.top = (rect.top - 8) + 'px';
    tooltip.style.transform = 'translate(-50%, -100%)';
    tooltip.classList.add('visible');
  }
  
  function hideStatusTooltip() {
    if (statusTooltipEl) {
      statusTooltipEl.classList.remove('visible');
    }
  }
  
  // Hide tooltip on scroll
  window.addEventListener('scroll', hideStatusTooltip, true);
  
  // Add tooltip handlers to existing status-tip elements on page
  function initStatusTooltips() {
    var statusTips = document.querySelectorAll('.b-table__status-tip:not([data-of-tooltip-init])');
    statusTips.forEach(function(tip) {
      tip.setAttribute('data-of-tooltip-init', 'true');
      tip.addEventListener('mouseenter', function() {
        var text = tip.getAttribute('data-tooltip-text') || tip.getAttribute('aria-label');
        if (text) showStatusTooltip(tip, text);
      });
      tip.addEventListener('mouseleave', function() {
        hideStatusTooltip();
      });
    });
  }
  
  // Export for content.js
  window.ofStatsInitStatusTooltips = initStatusTooltips;
  
  // Create a full TR element with our data
  function createEarningsRow(trans) {
    var tr = document.createElement('tr');
    tr.setAttribute('data-of-stats', 'true');
    
    var desc = getEarningsDescription(trans.type, trans.userId, trans.username);
    
    // Determine icon and label based on status
    var status = trans.status || 'pending';
    var iconName, ariaLabel;
    
    if (status === 'complete') {
      iconName = 'icon-done';
    } else if (status === 'reversed') {
      iconName = 'icon-undo';
    } else {
      // Calculate days remaining based on transaction date (max 6 days)
      var now = new Date();
      now.setHours(0, 0, 0, 0);
      var transDate = new Date(trans.date);
      transDate.setHours(0, 0, 0, 0);
      var daysSince = Math.floor((now - transDate) / (1000 * 60 * 60 * 24));
      var daysRemaining = Math.max(1, 6 - daysSince);
      iconName = 'icon-loading';
    }
    ariaLabel = getStatusTooltipText(status, typeof daysRemaining !== 'undefined' ? daysRemaining : 1);
    
    tr.innerHTML = '<td class="b-table__date"><span class="b-table__date__date"><span title=""> ' + earningsFormatDate(trans.date) + ' </span></span><span class="b-table__date__time"><span title=""> ' + earningsFormatTime(trans.date) + ' </span></span></td><td data-title="Amount" class="b-table__amount"><span class=""> $' + trans.amount.toFixed(2) + ' </span></td><td data-title="Fee" class="b-table__fee"><span class=""> $' + trans.fee.toFixed(2) + ' </span></td><td data-title="Net" class="b-table__net"><strong><span class=""> $' + trans.net.toFixed(2) + ' </span></strong></td><td class="b-table__desc"><span>' + desc + '</span><span tabindex="0" class="b-table__status-tip" data-tooltip-text="' + ariaLabel + '"><svg class="g-icon" data-icon-name="' + iconName + '" aria-hidden="true"><use href="#' + iconName + '" xlink:href="#' + iconName + '"></use></svg></span></td><td class="b-table__status"><span tabindex="0" class="b-table__status-tip" data-tooltip-text="' + ariaLabel + '"><svg class="g-icon" data-icon-name="' + iconName + '" aria-hidden="true"><use href="#' + iconName + '" xlink:href="#' + iconName + '"></use></svg></span></td>';
    
    // Add hover handlers for status tooltips
    var statusTips = tr.querySelectorAll('.b-table__status-tip');
    statusTips.forEach(function(tip) {
      tip.addEventListener('mouseenter', function() {
        var text = tip.getAttribute('data-tooltip-text') || tip.getAttribute('aria-label');
        if (text) showStatusTooltip(tip, text);
      });
      tip.addEventListener('mouseleave', function() {
        hideStatusTooltip();
      });
    });
    
    return tr;
  }
  
  // Check if a row is the infinite-loading row
  function isInfiniteLoadingRow(tr) {
    return tr.querySelector('.infinite-loading-container') !== null;
  }
  
  // Find the infinite-loading row
  function findInfiniteLoadingRow(tbody) {
    var rows = tbody.querySelectorAll('tr');
    for (var i = 0; i < rows.length; i++) {
      if (isInfiniteLoadingRow(rows[i])) return rows[i];
    }
    return null;
  }
  
  // Remove original data rows (keep only infinite-loading)
  function removeOriginalDataRows(tbody) {
    var rows = tbody.querySelectorAll('tr');
    for (var i = rows.length - 1; i >= 0; i--) {
      var tr = rows[i];
      if (!isInfiniteLoadingRow(tr) && tr.getAttribute('data-of-stats') !== 'true') {
        tr.remove();
      }
    }
  }
  
  function applyEarningsEarly() {
    if (!cachedSettings) return;
    if (!cachedSettings.earningsCount && !cachedSettings.earningsCompleteCount) return;
    if (!isEarningsPage()) return;
    if (isEarningsAlreadyApplied()) return;
    
    var pendingCount = parseInt(cachedSettings.earningsCount) || 0;
    var completeCount = parseInt(cachedSettings.earningsCompleteCount) || 0;
    
    if (pendingCount <= 0 && completeCount <= 0) return;
    
    var table = document.querySelector('table.b-table.m-responsive.m-earnings');
    if (!table) return;
    
    var tbody = table.querySelector('tbody');
    if (!tbody) return;
    
    // Find infinite-loading row (loading spinner)
    var loadingRow = findInfiniteLoadingRow(tbody);
    if (!loadingRow) {
      // No loading row yet, wait
      setTimeout(applyEarningsEarly, 50);
      return;
    }
    
    // Add artificial delay for first load to show spinner naturally (500-800ms)
    if (!window.ofStatsEarningsDelayDone) {
      window.ofStatsEarningsDelayDone = true;
      var delay = 500 + Math.floor(Math.random() * 300); // 500-800ms
      setTimeout(applyEarningsEarly, delay);
      return;
    }
    
    // Mark as applied immediately
    earningsApplied = true;
    window.ofStatsEarningsApplied = true;
    
    // Get cached or generate transactions
    var transactions = getOrGenerateEarningsData(pendingCount, completeCount);
    window.ofStatsEarningsTransactions = transactions;
    var totalCount = transactions.length;
    
    // Remove any original data rows that OnlyFans might have added
    removeOriginalDataRows(tbody);
    
    // Insert our rows BEFORE the loading row
    var initialCount = Math.min(30, transactions.length);
    for (var i = 0; i < initialCount; i++) {
      var row = createEarningsRow(transactions[i]);
      tbody.insertBefore(row, loadingRow);
    }
    window.ofStatsEarningsIndex = initialCount;
    
    // Remove hiding styles (both initial and SPA navigation styles)
    var hideStyle = document.getElementById('of-stats-hide-earnings');
    if (hideStyle) hideStyle.remove();
    var hideStyleSpa = document.getElementById('of-stats-hide-earnings-spa');
    if (hideStyleSpa) hideStyleSpa.remove();
    
    // If there's more data, keep spinner visible at bottom. Otherwise hide it.
    if (initialCount >= transactions.length) {
      loadingRow.style.display = 'none';
    }
    // Spinner stays visible for scroll loading
    
    log('OF Stats Editor: Added ' + initialCount + ' earnings, total: ' + totalCount + ' (' + pendingCount + ' pending + ' + completeCount + ' complete)');
    
    // Setup observer to remove any future original rows and handle scroll
    setupTbodyObserver(tbody);
    
    // Setup scroll handler for loading more of OUR rows
    setupScrollHandler(loadingRow);
    
    // Init tooltips for status icons
    initStatusTooltips();
  }
  
  // Setup scroll handler to load more rows with loading animation
  function setupScrollHandler(loadingRow) {
    if (window.ofStatsScrollHandler) {
      window.removeEventListener('scroll', window.ofStatsScrollHandler);
    }
    
    var isLoadingMore = false;
    
    log('OF Stats Editor: Scroll handler setup, loadingRow:', loadingRow);
    
    window.ofStatsScrollHandler = function() {
      if (isLoadingMore) return;
      
      var trans = window.ofStatsEarningsTransactions;
      var idx = window.ofStatsEarningsIndex || 0;
      if (!trans || idx >= trans.length) return;
      
      var scrollY = window.scrollY || window.pageYOffset;
      var windowHeight = window.innerHeight;
      var documentHeight = document.documentElement.scrollHeight;
      
      // Trigger early (400px from bottom) so user doesn't see loading
      if (scrollY + windowHeight >= documentHeight - 400) {
        log('OF Stats Editor: Bottom reached, loading more...');
        isLoadingMore = true;
        
        var tbl = document.querySelector('table.b-table.m-responsive.m-earnings');
        if (!tbl) { isLoadingMore = false; return; }
        var tb = tbl.querySelector('tbody');
        if (!tb) { isLoadingMore = false; return; }
        
        // Find loading row fresh (in case DOM changed)
        var spinner = findInfiniteLoadingRow(tb);
        
        // Make sure spinner is visible
        if (spinner) {
          spinner.style.display = '';
        }
        
        // Quick load (2x faster)
        var loadDelay = 300 + Math.random() * 200; // 300-500ms
        
        setTimeout(function() {
          // Add next batch of 10 rows
          var endIdx = Math.min(idx + 10, trans.length);
          for (var j = idx; j < endIdx; j++) {
            var row = createEarningsRow(trans[j]);
            if (spinner) {
              tb.insertBefore(row, spinner);
            } else {
              tb.appendChild(row);
            }
          }
          window.ofStatsEarningsIndex = endIdx;
          log('OF Stats Editor: Loaded more (' + endIdx + '/' + trans.length + ')');
          
          // Hide spinner if no more data
          if (endIdx >= trans.length && spinner) {
            spinner.style.display = 'none';
          }
          
          // Reset flag immediately
          isLoadingMore = false;
        }, loadDelay);
      }
    };
    
    window.addEventListener('scroll', window.ofStatsScrollHandler, { passive: true });
    log('OF Stats Editor: Scroll listener added');
  }
  
  // Observer to remove original rows that OnlyFans might add
  function setupTbodyObserver(tbody) {
    if (window.ofStatsTbodyObserver) {
      window.ofStatsTbodyObserver.disconnect();
    }
    
    window.ofStatsTbodyObserver = new MutationObserver(function(mutations) {
      mutations.forEach(function(mutation) {
        mutation.addedNodes.forEach(function(node) {
          if (node.nodeType === 1 && node.tagName === 'TR') {
            // Skip infinite-loading row
            if (isInfiniteLoadingRow(node)) return;
            
            // Skip our rows
            if (node.getAttribute('data-of-stats') === 'true') return;
            
            // Remove original OnlyFans rows (we manage our own)
            node.remove();
          }
        });
      });
    });
    
    window.ofStatsTbodyObserver.observe(tbody, { childList: true });
  }
  
  // ==================== END EARLY EARNINGS GENERATOR ====================

  // Observe DOM and replace content as elements appear
  const observer = new MutationObserver(function(mutations) {
    mutations.forEach(function(mutation) {
      mutation.addedNodes.forEach(function(node) {
        if (node.nodeType === 1) {
          // Check for tooltip (skip our custom tooltips)
          if (node.classList && node.classList.contains('tooltip') && !node.hasAttribute('data-of-stats-custom')) {
            replaceTooltip(node);
          }
          
          // Check this element
          replaceContent(node);
          
          // Check for Top Creators block
          if (node.classList && node.classList.contains('g-box')) {
            const text = node.textContent || '';
            if (isTopCreatorsText(text)) {
              updateTopCreatorsBanner();
            }
          }
          
          // Check if a container appeared where we can insert Top Creators
          if (isEarningsPage() && cachedSettings && cachedSettings.topCreators) {
            var classStr1 = getClassStr(node);
            if (classStr1.indexOf('g-main-content') !== -1 || 
                classStr1.indexOf('b-payout') !== -1 || 
                classStr1.indexOf('balance') !== -1 ||
                classStr1.indexOf('row') !== -1) {
              updateTopCreatorsBanner();
            }
          }
          
          // Check for earnings table
          if (isEarningsPage() && cachedSettings && cachedSettings.earningsCount) {
            var classStr2 = getClassStr(node);
            if (classStr2.indexOf('b-table') !== -1 || classStr2.indexOf('m-earnings') !== -1) {
              applyEarningsEarly();
            }
          }
          
          // Check for withdrawal button
          if (node.tagName === 'BUTTON' && isWithdrawalButton(node.textContent)) {
            activateWithdrawButton(node);
          }
          
          // Check all children
          if (node.querySelectorAll) {
            // Check for tooltips in children
            node.querySelectorAll('.tooltip').forEach(replaceTooltip);
            
            node.querySelectorAll(
              '[class*="balance__value"], [class*="balance_value"], ' +
              '.l-sidebar__user-data__item__count, .b-profile__sections__count'
            ).forEach(replaceContent);
            
            // Check for earning stats values on /my/stats/earnings page
            if (isEarningStatsPage()) {
              node.querySelectorAll('.b-stats-row__val, .b-stats-row__total-net span').forEach(replaceContent);
              
              // Check for months container - apply monthly earnings immediately
              if (node.classList && node.classList.contains('b-stats-wrap')) {
                applyMonthlyEarningsEarly();
              }
              node.querySelectorAll('.b-stats-wrap').forEach(function() {
                applyMonthlyEarningsEarly();
              });
              
              // Check for chart wrapper - apply chart overlay immediately
              if (node.classList && node.classList.contains('b-chart__wrapper')) {
                applyChartEarly();
              }
              node.querySelectorAll('.b-chart__wrapper').forEach(function() {
                applyChartEarly();
              });
            }
            
            // Check for Top Creators blocks in children
            node.querySelectorAll('.g-box.m-with-icon.m-panel').forEach(function(box) {
              const text = box.textContent || '';
              if (isTopCreatorsText(text)) {
                updateTopCreatorsBanner();
              }
            });
            
            // Check for b-top-rated blocks (re-rendered by Vue on language/page changes)
            node.querySelectorAll('.b-top-rated').forEach(function() {
              updateTopCreatorsBanner();
            });
            if (node.classList && node.classList.contains('b-top-rated')) {
              updateTopCreatorsBanner();
            }
            
            // Check for containers in children where we can insert Top Creators
            if (isEarningsPage() && cachedSettings && cachedSettings.topCreators) {
              if (node.querySelector('.g-main-content, .b-payout__wrapper, .row, [class*="balance"]')) {
                updateTopCreatorsBanner();
              }
            }
            
            // Find withdrawal buttons in children
            node.querySelectorAll('button[disabled]').forEach(function(btn) {
              if (isWithdrawalButton(btn.textContent)) {
                activateWithdrawButton(btn);
              }
            });
          }
        }
      });
    });
  });
  
  // ==================== EARNING STATISTICS PAGE (/my/stats/earnings) ====================
  
  function isEarningStatsPage() {
    return window.location.pathname.includes('/my/stats/earnings');
  }
  
  // Click counter for progressive generation
  var earningStatsClickCount = 0;
  
  // Get current balance from cached settings
  function getCurrentBalanceValue() {
    var currentBalance = 0;
    
    if (cachedSettings && cachedSettings.currentBalance) {
      currentBalance = parseFloat(cachedSettings.currentBalance.toString().replace(/[$,]/g, '')) || 0;
    }
    
    return currentBalance;
  }
  
  // Get current balance + pending from cached settings
  function getMinBalanceRequirement() {
    var currentBalance = 0;
    var pendingBalance = 0;
    
    if (cachedSettings) {
      if (cachedSettings.currentBalance) {
        currentBalance = parseFloat(cachedSettings.currentBalance.toString().replace(/[$,]/g, '')) || 0;
      }
      if (cachedSettings.pendingBalance) {
        pendingBalance = parseFloat(cachedSettings.pendingBalance.toString().replace(/[$,]/g, '')) || 0;
      }
    }
    
    return currentBalance + pendingBalance;
  }
  
  // Calculate Gross from average of 2 most recent months (from /my/stats/earnings page)
  // Gross must always be greater than Current balance
  // NOTE: This function must return STABLE values (no random) for chart caching to work
  function calculateGrossFromMonths(months) {
    if (!months || months.length < 2) {
      // Not enough months data, fallback to basic calculation
      var minRequired = getMinBalanceRequirement();
      return Math.max(minRequired * 1.5, 2500); // Fixed value, no random
    }
    
    // Get 2 most recent months (months[0] is current, months[1] is previous)
    var month1Net = months[0].net || 0;
    var month2Net = months[1].net || 0;
    
    // Average of 2 months (net values)
    var avgNet = (month1Net + month2Net) / 2;
    
    // Convert Net to Gross (Net = 80% of Gross, so Gross = Net / 0.8)
    var avgGross = avgNet / 0.8;
    
    // Ensure Gross is always greater than Current balance
    var currentBalance = getCurrentBalanceValue();
    if (avgGross <= currentBalance) {
      // Add 20% buffer above current balance (fixed, no random)
      avgGross = currentBalance * 1.2;
    }
    
    // Round to 2 decimal places for stability
    avgGross = Math.round(avgGross * 100) / 100;
    
    log('OF Stats: Calculated Gross from 2 months average - Month1 Net: $' + month1Net.toFixed(2) + ', Month2 Net: $' + month2Net.toFixed(2) + ', Avg Gross: $' + avgGross.toFixed(2) + ', Current Balance: $' + currentBalance.toFixed(2));
    return avgGross;
  }
  
  // Calculate percentage change between current and previous month
  function calculateMonthlyPercentageChange(months) {
    if (!months || months.length < 2) {
      return { value: 0, isIncrease: false };
    }
    
    var currentMonthNet = months[0].net || 0;
    var previousMonthNet = months[1].net || 0;
    
    if (previousMonthNet === 0) {
      return { value: 100, isIncrease: true }; // First month with earnings
    }
    
    var percentChange = ((currentMonthNet - previousMonthNet) / previousMonthNet) * 100;
    
    return {
      value: Math.abs(percentChange),
      isIncrease: percentChange >= 0
    };
  }
  
  // Generate Gross amount based on click count and minimum balance requirement
  function generateGrossAmount() {
    // Progressive ranges based on click count
    var ranges = [
      { min: 1000, max: 10000 },      // 1st click: up to 10K
      { min: 10000, max: 50000 },     // 2nd click: up to 50K
      { min: 50000, max: 100000 },    // 3rd click: up to 100K
      { min: 100000, max: 300000 },   // 4th click: up to 300K
      { min: 300000, max: 500000 }    // 5th+ click: up to 500K
    ];
    
    var rangeIndex = Math.min(earningStatsClickCount, ranges.length - 1);
    var range = ranges[rangeIndex];
    
    // Get minimum balance requirement (Current + Pending)
    var minRequired = getMinBalanceRequirement();
    // Gross needs to be at least 1.5x the required NET (since NET = 80% of Gross)
    // And we need at least 12 months of data, so multiply more
    var minGross = (minRequired / 0.8) * 1.5; // At least 1.5x to cover current month + some history
    
    // Adjust range minimum if needed
    var actualMin = Math.max(range.min, minGross);
    var actualMax = Math.max(range.max, minGross * 2);
    
    var gross = Math.floor(Math.random() * (actualMax - actualMin + 1)) + actualMin;
    // Add cents
    gross += Math.random() * 0.99;
    
    log('OF Stats: Generated gross with range ' + actualMin.toFixed(0) + '-' + actualMax.toFixed(0) + ' (click #' + (earningStatsClickCount + 1) + ', minRequired: $' + minRequired.toFixed(2) + ')');
    return gross;
  }
  
  // Calculate Net from Gross (80% after 20% commission)
  function calculateNet(gross) {
    return gross * 0.8;
  }
  
  // Format number as currency
  function formatCurrency(num) {
    return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  
  // Distribute earnings across categories
  function distributeEarnings(gross, net) {
    // Messages: ~75%
    // Tips: ~22%
    // Posts: ~3%
    // Subscriptions: always $0.00
    // Streams: always $0.00
    // Referrals: always $0.00
    
    var messagesPercent = 0.73 + Math.random() * 0.04; // 73-77%
    var postsPercent = 0.02 + Math.random() * 0.02; // 2-4%
    var tipsPercent = 1 - messagesPercent - postsPercent; // rest (~19-25%)
    
    return {
      subscriptions: { gross: 0, net: 0 },
      tips: { gross: gross * tipsPercent, net: net * tipsPercent },
      posts: { gross: gross * postsPercent, net: net * postsPercent },
      messages: { gross: gross * messagesPercent, net: net * messagesPercent },
      referrals: { gross: 0, net: 0 },
      streams: { gross: 0, net: 0 }
    };
  }
  
  // earningStatsData is already declared at the top of the file and loaded from localStorage
  // DO NOT redeclare it here - this was causing preset data to be overwritten!
  
  // Clear in-memory cache (called when localStorage is cleared externally)
  function clearEarningStatsCache() {
    earningStatsData = null;
    earningStatsClickCount = 0;
    log('OF Stats: Cleared earning stats in-memory cache');
  }
  
  // Load saved earning stats from localStorage
  function loadEarningStats() {
    try {
      var saved = localStorage.getItem('ofStatsEarningStats');
      if (saved) {
        earningStatsData = JSON.parse(saved);
        log('OF Stats: Loaded earning stats from localStorage:', earningStatsData);
        return earningStatsData;
      } else {
        // localStorage was cleared, also clear in-memory cache
        if (earningStatsData) {
          log('OF Stats: localStorage empty but memory has data, clearing memory cache');
          earningStatsData = null;
        }
      }
    } catch (e) {
      logError('OF Stats: Error loading earning stats:', e);
    }
    return null;
  }
  
  // Save earning stats to localStorage
  function saveEarningStats(data) {
    try {
      localStorage.setItem('ofStatsEarningStats', JSON.stringify(data));
      log('OF Stats: Saved earning stats to localStorage');
    } catch (e) {
      logError('OF Stats: Error saving earning stats:', e);
    }
  }
  
  function getOrGenerateEarningStats() {
    // Always check localStorage first - it might have been cleared externally (by popup reset/apply)
    var savedData = loadEarningStats();
    
    // Use saved data if available, but validate against current balance
    if (savedData) {
      // If data was loaded from a preset, use it without validation
      if (savedData.fromPreset) {
        log('OF Stats: Using earning stats from preset - Gross: $' + (savedData.gross || 0).toFixed(2) + ', Net: $' + (savedData.net || 0).toFixed(2));
        return savedData;
      }
      
      // Check if current month earnings are still >= Current + Pending balance
      var minRequired = getMinBalanceRequirement();
      if (minRequired > 0 && savedData.months && savedData.months.length > 0) {
        var currentMonthNet = savedData.months[0].net || 0;
        if (currentMonthNet < minRequired) {
          log('OF Stats: Current month ($' + currentMonthNet.toFixed(2) + ') < balance requirement ($' + minRequired.toFixed(2) + '), regenerating...');
          // Need to regenerate - clear saved data
          savedData = null;
          earningStatsData = null;
          localStorage.removeItem('ofStatsEarningStats');
        }
      }
      
      if (savedData) {
        return savedData;
      }
    }
    
    // If no data in localStorage, generate new
    var gross = generateGrossAmount();
    var net = calculateNet(gross);
    var categories = distributeEarnings(gross, net);
    var months = generateMonthlyEarnings(net);
    
    earningStatsData = {
      gross: gross,
      net: net,
      categories: categories,
      months: months
    };
    
    // Save initial generation
    saveEarningStats(earningStatsData);
    
    log('OF Stats: Generated initial earning stats:', earningStatsData);
    return earningStatsData;
  }
  
  // Show modal for custom Gross input
  function showGrossInputModal() {
    // Remove any existing modal
    var existingModal = document.getElementById('of-stats-gross-modal');
    if (existingModal) existingModal.remove();
    
    // Create modal overlay
    var modal = document.createElement('div');
    modal.id = 'of-stats-gross-modal';
    modal.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 999999; display: flex; align-items: center; justify-content: center;';
    
    // Create modal content
    var content = document.createElement('div');
    content.style.cssText = 'background: #fff; border-radius: 12px; padding: 24px; min-width: 320px; box-shadow: 0 4px 20px rgba(0,0,0,0.3);';
    
    content.innerHTML = '<div style="margin-bottom: 16px; font-size: 18px; font-weight: 600; color: #000;">Set Custom Gross Value</div>' +
      '<div style="margin-bottom: 12px; font-size: 13px; color: #8a96a3;">Enter the Gross amount. Net and all months will be calculated automatically.</div>' +
      '<div style="position: relative; margin-bottom: 20px;">' +
        '<span style="position: absolute; left: 12px; top: 50%; transform: translateY(-50%); font-size: 16px; color: #000;">$</span>' +
        '<input type="text" id="of-stats-gross-input" placeholder="0.00" style="width: 100%; padding: 12px 12px 12px 28px; font-size: 16px; border: 1px solid #e0e0e0; border-radius: 8px; outline: none; box-sizing: border-box;" autocomplete="off">' +
      '</div>' +
      '<div style="display: flex; gap: 12px;">' +
        '<button id="of-stats-gross-cancel" style="flex: 1; padding: 12px; font-size: 14px; border: 1px solid #e0e0e0; border-radius: 8px; background: #fff; cursor: pointer;">Cancel</button>' +
        '<button id="of-stats-gross-apply" style="flex: 1; padding: 12px; font-size: 14px; border: none; border-radius: 8px; background: #00aff0; color: #fff; cursor: pointer; font-weight: 600;">Apply</button>' +
      '</div>';
    
    modal.appendChild(content);
    document.body.appendChild(modal);
    
    // Focus input
    var input = document.getElementById('of-stats-gross-input');
    if (input) {
      input.focus();
      
      // Format input as user types
      input.addEventListener('input', function(e) {
        var value = e.target.value.replace(/[^0-9.]/g, '');
        // Only allow one decimal point
        var parts = value.split('.');
        if (parts.length > 2) {
          value = parts[0] + '.' + parts.slice(1).join('');
        }
        // Limit decimal places to 2
        if (parts.length === 2 && parts[1].length > 2) {
          value = parts[0] + '.' + parts[1].substring(0, 2);
        }
        // Add thousand separators for display
        if (value) {
          var numParts = value.split('.');
          numParts[0] = numParts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
          e.target.value = numParts.join('.');
        } else {
          e.target.value = value;
        }
      });
      
      // Handle Enter key
      input.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          applyCustomGross();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          modal.remove();
        }
      });
    }
    
    // Cancel button
    var cancelBtn = document.getElementById('of-stats-gross-cancel');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', function() {
        modal.remove();
      });
    }
    
    // Apply button
    var applyBtn = document.getElementById('of-stats-gross-apply');
    if (applyBtn) {
      applyBtn.addEventListener('click', function() {
        applyCustomGross();
      });
    }
    
    // Close on overlay click
    modal.addEventListener('click', function(e) {
      if (e.target === modal) {
        modal.remove();
      }
    });
  }
  
  // Apply custom Gross value and recalculate everything
  function applyCustomGross() {
    var input = document.getElementById('of-stats-gross-input');
    var modal = document.getElementById('of-stats-gross-modal');
    
    if (!input) return;
    
    // Parse the value (remove commas)
    var value = input.value.replace(/,/g, '');
    var gross = parseFloat(value);
    
    if (isNaN(gross) || gross <= 0) {
      input.style.borderColor = '#ff0000';
      return;
    }
    
    // Always add random cents (0.01 - 0.99) if user entered whole number
    if (gross === Math.floor(gross)) {
      gross = gross + Math.random() * 0.99 + 0.01;
    }
    // Round to 2 decimal places
    gross = Math.round(gross * 100) / 100;
    
    log('OF Stats: Applying custom Gross value: $' + gross);
    
    // Clear the statistics chart disabled flag (user is actively setting custom values)
    try {
      localStorage.removeItem('ofStatsStatisticsChartDisabled');
      log('OF Stats: Cleared statistics chart disabled flag (custom Gross applied)');
    } catch(e) {}
    
    // Calculate Net (80% of Gross)
    var net = calculateNet(gross);
    var categories = distributeEarnings(gross, net);
    
    // Check if we have preset data with oldest month to preserve
    var oldestMonthData = null;
    if (earningStatsData && earningStatsData.fromPreset && earningStatsData.oldestMonth) {
      oldestMonthData = earningStatsData.oldestMonth;
      log('OF Stats: Preserving oldest month from preset: ' + oldestMonthData.year + '-' + (oldestMonthData.month + 1));
    }
    
    // Generate new monthly data based on net (preserve oldest month if from preset)
    var months = generateMonthlyEarnings(net, oldestMonthData);
    
    // Update global stats
    earningStatsData = {
      gross: gross,
      net: net,
      categories: categories,
      months: months
    };
    
    // Preserve fromPreset and oldestMonth if it was from a preset
    if (oldestMonthData) {
      earningStatsData.fromPreset = true;
      earningStatsData.oldestMonth = oldestMonthData;
    }
    
    // Save to localStorage
    saveEarningStats(earningStatsData);
    
    // Remove all modified markers to allow re-update
    document.querySelectorAll('[data-of-stats-modified]').forEach(function(el) {
      el.removeAttribute('data-of-stats-modified');
    });
    
    // Remove months-replaced flag to allow re-generating
    var container = document.querySelector('.b-stats-wrap');
    if (container) {
      container.removeAttribute('data-of-stats-months-replaced');
      container.removeAttribute('data-of-stats-months-applied');
      // Remove all generated month rows
      container.querySelectorAll('[data-of-stats-generated]').forEach(function(row) {
        row.remove();
      });
    }
    
    // Remove content ready flag to allow re-applying values
    var contentContainer = document.querySelector('.b-stats-row__content');
    if (contentContainer) {
      contentContainer.removeAttribute('data-of-stats-ready');
    }
    
    // Remove chart modification flag and overlays
    var wrapper = document.querySelector('.b-chart__wrapper');
    if (wrapper) {
      var overlay = wrapper.querySelector('[data-of-stats-overlay]');
      if (overlay) overlay.remove();
      
      // Restore original canvas visibility
      var originalCanvas = wrapper.querySelector('canvas:not([data-of-stats-overlay])');
      if (originalCanvas) {
        originalCanvas.style.visibility = 'visible';
      }
    }
    var canvas = document.querySelector('.b-chart__wrapper canvas');
    if (canvas) {
      canvas.removeAttribute('data-of-stats-chart-modified');
    }
    
    // Close modal
    if (modal) modal.remove();
    
    // Apply the new stats
    applyEarningStats();
    
    log('OF Stats: Custom Gross applied - Gross: $' + formatCurrency(gross) + ', Net: $' + formatCurrency(net));
  }
  
  // Regenerate stats (called on GROSS click)
  function regenerateEarningStats() {
    earningStatsClickCount++;
    
    // Check if we have preset data with oldest month to preserve
    var oldestMonthData = null;
    var wasFromPreset = false;
    if (earningStatsData && earningStatsData.fromPreset && earningStatsData.oldestMonth) {
      oldestMonthData = earningStatsData.oldestMonth;
      wasFromPreset = true;
      log('OF Stats: Preserving oldest month from preset: ' + oldestMonthData.year + '-' + (oldestMonthData.month + 1));
    }
    
    var gross = generateGrossAmount();
    var net = calculateNet(gross);
    var categories = distributeEarnings(gross, net);
    
    // Generate new monthly data (preserve oldest month if from preset)
    var months = generateMonthlyEarnings(net, oldestMonthData);
    
    earningStatsData = {
      gross: gross,
      net: net,
      categories: categories,
      months: months
    };
    
    // Preserve fromPreset and oldestMonth if it was from a preset
    if (wasFromPreset && oldestMonthData) {
      earningStatsData.fromPreset = true;
      earningStatsData.oldestMonth = oldestMonthData;
    }
    
    // Save to localStorage
    saveEarningStats(earningStatsData);
    
    // Remove months-replaced flag to allow re-generating
    var container = document.querySelector('.b-stats-wrap');
    if (container) {
      container.removeAttribute('data-of-stats-months-replaced');
      container.removeAttribute('data-of-stats-months-applied');
      // Remove all generated month rows
      container.querySelectorAll('[data-of-stats-generated]').forEach(function(row) {
        row.remove();
      });
    }
    
    // Reset All time row click handler so it can be re-added
    // BUT keep it expanded (don't remove m-expanded class)
    var allTimeRows = document.querySelectorAll('.b-stats-row');
    allTimeRows.forEach(function(row) {
      var monthEl = row.querySelector('.b-stats-row__month');
      if (monthEl && isAllTimeText(monthEl.textContent)) {
        row.removeAttribute('data-of-stats-click-handler');
        // Don't remove data-of-stats-alltime - it's needed for styling
        // Don't remove m-expanded - keep it open
      }
    });
    
    // Remove content ready flag to allow re-applying values
    var contentContainer = document.querySelector('.b-stats-row__content');
    if (contentContainer) {
      contentContainer.removeAttribute('data-of-stats-ready');
    }
    
    // Remove chart modification flag and overlays
    var wrapper = document.querySelector('.b-chart__wrapper');
    if (wrapper) {
      var overlay = wrapper.querySelector('[data-of-stats-overlay]');
      if (overlay) overlay.remove();
      
      // Restore original canvas visibility
      var originalCanvas = wrapper.querySelector('canvas:not([data-of-stats-overlay])');
      if (originalCanvas) {
        originalCanvas.style.visibility = 'visible';
      }
    }
    var canvas = document.querySelector('.b-chart__wrapper canvas');
    if (canvas) {
      canvas.removeAttribute('data-of-stats-chart-modified');
    }
    
    log('OF Stats: Regenerated earning stats (click #' + earningStatsClickCount + '):', earningStatsData);
    return earningStatsData;
  }
  
  // Apply earning stats to the page
  function applyEarningStats() {
    if (!isEarningStatsPage()) return;
    
    var stats = getOrGenerateEarningStats();
    
    log('OF Stats: applyEarningStats called, looking for elements...');
    
    // 1. Update "All time" Net value (top right): .b-stats-row__total-net span
    var allTimeRows = document.querySelectorAll('.b-stats-row');
    log('OF Stats: Found ' + allTimeRows.length + ' .b-stats-row elements');
    
    allTimeRows.forEach(function(row) {
      var monthEl = row.querySelector('.b-stats-row__month');
      if (monthEl && isAllTimeText(monthEl.textContent)) {
        var netEl = row.querySelector('.b-stats-row__total-net span');
        log('OF Stats: Found All time row, netEl:', netEl);
        if (netEl && !netEl.getAttribute('data-of-stats-modified')) {
          netEl.textContent = ' $' + formatCurrency(stats.net) + ' ';
          netEl.setAttribute('data-of-stats-modified', 'true');
          log('OF Stats: Updated All time Net to $' + formatCurrency(stats.net));
        }
      }
    });
    
    // 2. Update GROSS total: .b-stats-row__label.m-total-item with "Gross"
    var totalItems = document.querySelectorAll('.b-stats-row__label.m-total-item');
    log('OF Stats: Found ' + totalItems.length + ' .b-stats-row__label.m-total-item elements');
    
    totalItems.forEach(function(item) {
      var nameEl = item.querySelector('.b-stats-row__name');
      var valEl = item.querySelector('.b-stats-row__val');
      log('OF Stats: Total item - name:', nameEl ? nameEl.textContent.trim() : 'null', 'val:', valEl ? valEl.textContent.trim() : 'null');
      if (nameEl && valEl) {
        var name = nameEl.textContent.trim().toLowerCase();
        if (isGrossLabel(name)) {
          if (!valEl.getAttribute('data-of-stats-modified')) {
            valEl.textContent = ' $' + formatCurrency(stats.gross) + ' ';
            valEl.setAttribute('data-of-stats-modified', 'true');
            nameEl.textContent = getLocalizedGrossLabel();
            valEl.style.cursor = 'pointer';
            valEl.title = 'Click to regenerate stats | Right-click to set custom value';
            log('OF Stats: Updated GROSS to $' + formatCurrency(stats.gross));
          }
          // Add click handler only once
          if (!valEl.getAttribute('data-of-stats-click-handler')) {
            valEl.setAttribute('data-of-stats-click-handler', 'true');
            valEl.addEventListener('click', function() {
              log('OF Stats: GROSS clicked, regenerating...');
              // Clear the statistics chart disabled flag (user is actively changing values)
              try {
                localStorage.removeItem('ofStatsStatisticsChartDisabled');
                log('OF Stats: Cleared statistics chart disabled flag (GROSS clicked)');
              } catch(e) {}
              // Remove all modified markers to allow re-update
              document.querySelectorAll('[data-of-stats-modified]').forEach(function(el) {
                el.removeAttribute('data-of-stats-modified');
              });
              regenerateEarningStats();
              applyEarningStats();
            });
            // Add right-click context menu handler
            valEl.addEventListener('contextmenu', function(e) {
              e.preventDefault();
              e.stopPropagation();
              showGrossInputModal();
            });
          }
        } else if (isNetLabel(name) && !valEl.getAttribute('data-of-stats-modified')) {
          valEl.textContent = ' $' + formatCurrency(stats.net) + ' ';
          valEl.setAttribute('data-of-stats-modified', 'true');
          nameEl.textContent = getLocalizedNetLabel();
          log('OF Stats: Updated NET to $' + formatCurrency(stats.net));
        }
      }
    });
    
    // 3. Update category values
    // Categories have classes: m-subscriptions, m-tips, m-posts, m-messages, m-referrals, m-calls (streams)
    var categoryMap = {
      'm-subscriptions': 'subscriptions',
      'm-tips': 'tips',
      'm-posts': 'posts',
      'm-messages': 'messages',
      'm-referrals': 'referrals',
      'm-calls': 'streams'  // Streams uses m-calls class
    };
    
    Object.keys(categoryMap).forEach(function(className) {
      var catName = categoryMap[className];
      var catRow = document.querySelector('.b-stats-row__label.' + className);
      log('OF Stats: Looking for .' + className + ', found:', catRow ? 'yes' : 'no');
      if (catRow) {
        var vals = catRow.querySelectorAll('.b-stats-row__val');
        var catData = stats.categories[catName];
        if (catData && vals.length >= 2) {
          // First val is Gross, second is Net
          if (!vals[0].getAttribute('data-of-stats-modified')) {
            vals[0].textContent = ' $' + formatCurrency(catData.gross) + ' ';
            vals[0].setAttribute('data-of-stats-modified', 'true');
          }
          if (!vals[1].getAttribute('data-of-stats-modified')) {
            vals[1].textContent = ' $' + formatCurrency(catData.net) + ' ';
            vals[1].setAttribute('data-of-stats-modified', 'true');
          }
          log('OF Stats: Updated ' + catName + ' - Gross: $' + formatCurrency(catData.gross) + ', Net: $' + formatCurrency(catData.net));
        }
      }
    });
    
    // Mark content container as ready to show values (removes CSS hiding)
    var contentContainer = document.querySelector('.b-stats-row__content');
    if (contentContainer && !contentContainer.getAttribute('data-of-stats-ready')) {
      contentContainer.setAttribute('data-of-stats-ready', 'true');
      log('OF Stats: Marked content container as ready');
    }
    
    // 4. Generate and update monthly data
    applyMonthlyEarnings(stats);
    
    // 5. Update chart with our data
    updateEarningsChart(stats);
    
    // 6. Remove hiding style now that our data is applied
    var hideStatsStyle = document.getElementById('of-stats-hide-stats');
    if (hideStatsStyle) {
      hideStatsStyle.remove();
      log('OF Stats: Removed hide-stats style');
    }
  }
  
  // Update Chart.js chart by injecting script into page context
  // Version to force overlay recreation when code changes
  var CHART_OVERLAY_VERSION = 20;
  
  function updateEarningsChart(stats) {
    var canvas = document.querySelector('.b-chart__wrapper canvas:not([data-of-stats-overlay])');
    if (!canvas) {
      log('OF Stats: No chart canvas found');
      return;
    }
    
    var wrapper = canvas.closest('.b-chart__wrapper');
    
    // Check if overlay already exists and is up to date
    var existingOverlay = wrapper ? wrapper.querySelector('[data-of-stats-overlay]') : null;
    if (existingOverlay) {
      // Check version - recreate if outdated
      var overlayVersion = parseInt(existingOverlay.getAttribute('data-overlay-version') || '0');
      if (overlayVersion >= CHART_OVERLAY_VERSION) {
        log('OF Stats: Chart overlay already exists (v' + overlayVersion + ')');
        return;
      }
      log('OF Stats: Recreating overlay (old v' + overlayVersion + ' -> new v' + CHART_OVERLAY_VERSION + ')');
      existingOverlay.remove();
    }
    
    // Generate chart data
    var chartData = generateChartDataFromMonths(stats);
    
    log('OF Stats: Creating chart overlay...');
    
    // Create overlay canvas to prevent Chart.js from overwriting
    createOverlayChart(canvas, chartData);
  }
  
  // Create overlay canvas on top of original
  function createOverlayChart(originalCanvas, chartData) {
    var wrapper = originalCanvas.closest('.b-chart__wrapper');
    if (!wrapper) {
      log('OF Stats: No chart wrapper found');
      return;
    }
    
    // Remove existing overlay
    var existingOverlay = wrapper.querySelector('[data-of-stats-overlay]');
    if (existingOverlay) {
      existingOverlay.remove();
    }
    
    // Remove existing tooltip
    var existingTooltip = wrapper.querySelector('[data-of-stats-alltime-tooltip]');
    if (existingTooltip) {
      existingTooltip.remove();
    }
    
    // Create overlay canvas - fixed 608x200 like month charts
    var canvas = document.createElement('canvas');
    canvas.width = 608;
    canvas.height = 200;
    canvas.style.cssText = 'position: absolute; top: 0; left: 0; display: block; box-sizing: border-box; width: 608px; height: 200px; z-index: 1;';
    canvas.setAttribute('data-of-stats-overlay', 'true');
    canvas.setAttribute('data-of-stats-alltime-canvas', 'true');
    canvas.setAttribute('data-overlay-version', CHART_OVERLAY_VERSION.toString());
    
    // Make wrapper position relative for absolute positioning, allow overflow for tooltip
    wrapper.style.position = 'relative';
    wrapper.style.overflow = 'visible';
    
    // Hide original canvas by making it invisible
    originalCanvas.style.visibility = 'hidden';
    
    wrapper.appendChild(canvas);
    
    // Create tooltip element with all 6 categories
    var tooltip = document.createElement('div');
    tooltip.className = 'b-chart__tooltip of-stats-tooltip';
    tooltip.setAttribute('data-of-stats-alltime-tooltip', 'true');
    tooltip.style.cssText = 'position: absolute; opacity: 0; left: 0; top: 0; width: 156px; pointer-events: none; z-index: 100;';
    var langTooltip = getPageLanguage();
    tooltip.innerHTML = 
      '<div class="b-chart__tooltip__title"></div>' +
      '<div class="b-chart__tooltip__text" data-cat="subscriptions">' +
        '<div class="b-chart__tooltip__circle" style="background: #2196f3;"></div>' +
        '<div class="b-chart__tooltip__text__title"> ' + (langTooltip === 'ru' ? 'Подписки' : langTooltip === 'es' ? 'Suscripciones' : langTooltip === 'de' ? 'Abonnements' : 'Subscriptions') + ' </div>' +
        '<div class="b-chart__tooltip__text__value"> $0 </div>' +
      '</div>' +
      '<div class="b-chart__tooltip__text" data-cat="tips">' +
        '<div class="b-chart__tooltip__circle" style="background: #00bcd4;"></div>' +
        '<div class="b-chart__tooltip__text__title"> ' + (langTooltip === 'ru' ? 'Чаевые' : langTooltip === 'es' ? 'Propinas' : langTooltip === 'de' ? 'Trinkgelder' : 'Tips') + ' </div>' +
        '<div class="b-chart__tooltip__text__value"> $0 </div>' +
      '</div>' +
      '<div class="b-chart__tooltip__text" data-cat="posts">' +
        '<div class="b-chart__tooltip__circle" style="background: #ec407a;"></div>' +
        '<div class="b-chart__tooltip__text__title"> ' + (langTooltip === 'ru' ? 'Посты' : langTooltip === 'es' ? 'Publicaciones' : langTooltip === 'de' ? 'Beiträge' : 'Posts') + ' </div>' +
        '<div class="b-chart__tooltip__text__value"> $0 </div>' +
      '</div>' +
      '<div class="b-chart__tooltip__text" data-cat="messages">' +
        '<div class="b-chart__tooltip__circle" style="background: #ff7043;"></div>' +
        '<div class="b-chart__tooltip__text__title"> ' + (langTooltip === 'ru' ? 'Сообщения' : langTooltip === 'es' ? 'Mensajes' : langTooltip === 'de' ? 'Nachrichten' : 'Messages') + ' </div>' +
        '<div class="b-chart__tooltip__text__value"> $0 </div>' +
      '</div>' +
      '<div class="b-chart__tooltip__text" data-cat="referrals">' +
        '<div class="b-chart__tooltip__circle" style="background: #9575cd;"></div>' +
        '<div class="b-chart__tooltip__text__title"> ' + (langTooltip === 'ru' ? 'Рефералы' : langTooltip === 'es' ? 'Referidos' : langTooltip === 'de' ? 'Empfehlungen' : 'Referrals') + ' </div>' +
        '<div class="b-chart__tooltip__text__value"> $0 </div>' +
      '</div>' +
      '<div class="b-chart__tooltip__text" data-cat="streams">' +
        '<div class="b-chart__tooltip__circle" style="background: #ffa000;"></div>' +
        '<div class="b-chart__tooltip__text__title"> ' + (langTooltip === 'ru' ? 'Потоки' : langTooltip === 'es' ? 'Transmisiones' : langTooltip === 'de' ? 'Streams' : 'Streams') + ' </div>' +
        '<div class="b-chart__tooltip__text__value"> $0 </div>' +
      '</div>';
    wrapper.appendChild(tooltip);
    
    log('OF Stats: Overlay created, canvas size:', canvas.width, 'x', canvas.height);
    
    // Store chartData on canvas for redraw when switching categories
    canvas._chartData = chartData;
    
    // Store tooltip reference on canvas
    canvas._tooltip = tooltip;
    
    // Add mouse event handlers for tooltip
    setupAllTimeChartTooltip(canvas, wrapper, tooltip, chartData);
    
    // Draw the chart using canvas (same as month charts for consistency)
    drawAllTimeChartCanvas(canvas, chartData);
  }
  
  // Setup mouse events for All time chart tooltip
  function setupAllTimeChartTooltip(canvas, wrapper, tooltip, chartData) {
    var padding = { top: 20, right: 10, bottom: 28, left: 10 };
    var chartWidth = canvas.width - padding.left - padding.right;
    var chartHeight = canvas.height - padding.top - padding.bottom;
    var numPoints = chartData.labels.length;
    var xStep = chartWidth / (numPoints - 1);
    
    // Find max value for Y calculation
    var maxValue = 0;
    var categories = ['subscriptions', 'messages', 'tips', 'posts', 'streams', 'referrals'];
    categories.forEach(function(cat) {
      var data = chartData.datasets[cat];
      if (data && data.length > 0) {
        var catMax = Math.max.apply(null, data);
        if (catMax > maxValue) maxValue = catMax;
      }
    });
    if (maxValue === 0) maxValue = 100;
    maxValue *= 1.15;
    
    var lastHoveredIndex = -1;
    
    // Pre-calculate line points for hit detection
    function getLinePoints(cat) {
      var data = chartData.datasets[cat];
      if (!data || data.length === 0) return [];
      var points = [];
      for (var i = 0; i < data.length; i++) {
        var px = padding.left + i * xStep;
        var py = padding.top + chartHeight * (1 - data[i] / maxValue);
        points.push({ x: px, y: py });
      }
      return points;
    }
    
    // Check if point is near any line
    function isNearLine(x, y, threshold) {
      var checkCategories = ['subscriptions', 'messages', 'tips'];
      for (var c = 0; c < checkCategories.length; c++) {
        var cat = checkCategories[c];
        var points = getLinePoints(cat);
        for (var i = 0; i < points.length - 1; i++) {
          var p1 = points[i];
          var p2 = points[i + 1];
          // Distance from point to line segment
          var dx = p2.x - p1.x;
          var dy = p2.y - p1.y;
          var lengthSq = dx * dx + dy * dy;
          var t = Math.max(0, Math.min(1, ((x - p1.x) * dx + (y - p1.y) * dy) / lengthSq));
          var nearX = p1.x + t * dx;
          var nearY = p1.y + t * dy;
          var dist = Math.sqrt((x - nearX) * (x - nearX) + (y - nearY) * (y - nearY));
          if (dist < threshold) return true;
        }
      }
      return false;
    }
    
    canvas.addEventListener('mousemove', function(e) {
      var rect = canvas.getBoundingClientRect();
      var scaleX = canvas.width / rect.width;
      var scaleY = canvas.height / rect.height;
      var x = (e.clientX - rect.left) * scaleX;
      var y = (e.clientY - rect.top) * scaleY;
      
      // Check if mouse is in chart area
      if (x < padding.left || x > canvas.width - padding.right ||
          y < padding.top || y > canvas.height - padding.bottom) {
        if (lastHoveredIndex !== -1) {
          lastHoveredIndex = -1;
          tooltip.style.opacity = '0';
          redrawAllTimeChartWithPoint(canvas, chartData, -1);
        }
        return;
      }
      
      // Check if cursor is near any line (within 15px)
      if (!isNearLine(x, y, 15)) {
        if (lastHoveredIndex !== -1) {
          lastHoveredIndex = -1;
          tooltip.style.opacity = '0';
          redrawAllTimeChartWithPoint(canvas, chartData, -1);
        }
        return;
      }
      
      // Calculate nearest data point index
      var relativeX = x - padding.left;
      var index = Math.round(relativeX / xStep);
      index = Math.max(0, Math.min(index, numPoints - 1));
      
      if (index !== lastHoveredIndex) {
        lastHoveredIndex = index;
        
        // Apply dark mode class
        if (isDarkMode()) {
          tooltip.classList.add('dark-mode');
        } else {
          tooltip.classList.remove('dark-mode');
        }
        
        // Update tooltip content
        var titleEl = tooltip.querySelector('.b-chart__tooltip__title');
        if (titleEl) {
          titleEl.textContent = ' ' + chartData.labels[index] + ' ';
        }
        
        // Update each category value - show cumulative value with cents
        categories.forEach(function(cat) {
          var catRow = tooltip.querySelector('[data-cat="' + cat + '"]');
          if (catRow) {
            var valueEl = catRow.querySelector('.b-chart__tooltip__text__value');
            if (valueEl) {
              var currentValue = chartData.datasets[cat][index] || 0;
              // Format with commas and 2 decimal places
              var formatted = currentValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
              valueEl.textContent = ' $' + formatted + ' ';
            }
          }
        });
        
        // Calculate tooltip position
        var pointX = padding.left + index * xStep;
        
        // Position tooltip relative to Tips line (center line)
        var tipsValue = chartData.datasets['tips'][index] || 0;
        var pointY = padding.top + chartHeight * (1 - tipsValue / maxValue);
        
        // Position tooltip - to the right of the Tips point, vertically centered
        var tooltipWidth = 156;
        var tooltipHeight = 160; // Approximate tooltip height
        var tooltipX = pointX / scaleX + 15; // РЎРїСЂР°РІР° РѕС‚ С‚РѕС‡РєРё
        var tooltipY = pointY / scaleX - tooltipHeight / 2; // РџРѕ С†РµРЅС‚СЂСѓ РѕС‚ С‚РѕС‡РєРё Tips
        
        // Only flip to left if not enough space on right
        if (tooltipX + tooltipWidth > rect.width) {
          tooltipX = pointX / scaleX - tooltipWidth - 15;
        }
        // No vertical bounds checking - allow tooltip to go outside canvas
        
        tooltip.style.left = tooltipX + 'px';
        tooltip.style.top = tooltipY + 'px';
        tooltip.style.opacity = '1';
        
        // Redraw chart with highlighted point
        redrawAllTimeChartWithPoint(canvas, chartData, index);
      }
    });
    
    canvas.addEventListener('mouseleave', function() {
      lastHoveredIndex = -1;
      tooltip.style.opacity = '0';
      redrawAllTimeChartWithPoint(canvas, chartData, -1);
    });
  }
  
  // Redraw All time chart with highlighted point (no animation)
  function redrawAllTimeChartWithPoint(canvas, chartData, highlightIndex) {
    var ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    var width = canvas.width;
    var height = canvas.height;
    
    var colors = {
      subscriptions: '#2196f3',
      messages: '#ff7043',
      tips: '#00bcd4',
      posts: '#ec407a',
      streams: '#ffa000',
      referrals: '#9575cd'
    };
    
    var padding = { top: 20, right: 10, bottom: 28, left: 10 };
    var chartWidth = width - padding.left - padding.right;
    var chartHeight = height - padding.top - padding.bottom;
    
    // Find max value
    var maxValue = 0;
    var categories = ['subscriptions', 'messages', 'tips', 'posts', 'streams', 'referrals'];
    categories.forEach(function(cat) {
      var data = chartData.datasets[cat];
      if (data && data.length > 0) {
        var catMax = Math.max.apply(null, data);
        if (catMax > maxValue) maxValue = catMax;
      }
    });
    if (maxValue === 0) maxValue = 100;
    maxValue *= 1.15;
    
    var numPoints = chartData.labels.length;
    var xStep = chartWidth / (numPoints - 1);
    
    var activeCategory = canvas.getAttribute('data-active-category') || 'subscriptions';
    
    var drawOrder = ['tips', 'messages', 'posts', 'streams', 'referrals', 'subscriptions'];
    drawOrder = drawOrder.filter(function(c) { return c !== activeCategory; });
    drawOrder.push(activeCategory);
    
    // Clear canvas
    ctx.clearRect(0, 0, width, height);
    
    // Draw grid lines
    ctx.strokeStyle = getChartGridColor();
    ctx.lineWidth = 1;
    for (var i = 0; i < 4; i++) {
      var gridY = padding.top + (chartHeight * i / 3);
      ctx.beginPath();
      ctx.moveTo(padding.left, gridY);
      ctx.lineTo(width - padding.right, gridY);
      ctx.stroke();
    }
    
    // Draw lines
    drawOrder.forEach(function(cat) {
      var data = chartData.datasets[cat];
      if (!data || data.length === 0) return;
      
      var points = [];
      for (var i = 0; i < data.length; i++) {
        var x = padding.left + i * xStep;
        var y = padding.top + chartHeight * (1 - data[i] / maxValue);
        points.push({ x: x, y: y });
      }
      
      var isMain = cat === activeCategory;
      
      ctx.beginPath();
      ctx.strokeStyle = colors[cat];
      ctx.lineWidth = isMain ? 1.8 : 2.5;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.globalAlpha = isMain ? 1 : 0.25;
      
      ctx.moveTo(points[0].x, points[0].y);
      for (var i = 0; i < points.length - 1; i++) {
        var p0 = points[i === 0 ? i : i - 1];
        var p1 = points[i];
        var p2 = points[i + 1];
        var p3 = points[i + 2 < points.length ? i + 2 : i + 1];
        var tension = 0.35;
        
        var cp1x = p1.x + (p2.x - p0.x) * tension;
        var cp1y = p1.y + (p2.y - p0.y) * tension;
        var cp2x = p2.x - (p3.x - p1.x) * tension;
        var cp2y = p2.y - (p3.y - p1.y) * tension;
        
        ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
      }
      ctx.stroke();
      
      // Draw points at highlighted index for subscriptions, messages, tips
      var showPointCategories = ['subscriptions', 'messages', 'tips'];
      if (showPointCategories.indexOf(cat) !== -1 && highlightIndex >= 0 && highlightIndex < points.length) {
        var p = points[highlightIndex];
        ctx.globalAlpha = 1;
        
        // White outer circle
        ctx.beginPath();
        ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        
        // Colored inner circle
        ctx.beginPath();
        ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
        ctx.fillStyle = colors[cat];
        ctx.fill();
      }
    });
    ctx.globalAlpha = 1;
    
    // Draw X-axis labels
    ctx.fillStyle = getChartLabelColor();
    ctx.font = getChartDateFont();
    ctx.textBaseline = 'top';
    var labelY = chartHeight + padding.top + 15;
    
    var labelIndices = [0, Math.floor(numPoints * 0.25), Math.floor(numPoints * 0.5), Math.floor(numPoints * 0.75), numPoints - 1];
    var labelsToUse = canvas._fixedDateLabels || chartData.labels;
    var positions = canvas._fixedDatePositions;
    
    if (positions && labelsToUse) {
      labelIndices.forEach(function(idx, i) {
        var label = labelsToUse[i] || chartData.labels[idx] || '';
        var x = positions[i];
        if (i === 4) {
          ctx.textAlign = 'right';
        } else {
          ctx.textAlign = 'left';
        }
        ctx.fillText(label, x, labelY);
      });
    }
  }
  
  // Draw All time chart using canvas (same style as month charts)
  function drawAllTimeChartCanvas(canvas, chartData) {
    var ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    var width = canvas.width;
    var height = canvas.height;
    
    // Chart colors - same as month charts
    var colors = {
      subscriptions: '#2196f3', // Blue - main line
      messages: '#ff7043',
      tips: '#00bcd4',
      posts: '#ec407a',
      streams: '#ffa000',
      referrals: '#9575cd'     // Purple
    };
    
    // Padding - top:10 for spacing from header, bottom for X-axis labels
    var padding = { top: 20, right: 10, bottom: 28, left: 10 };
    var chartWidth = width - padding.left - padding.right;
    var chartHeight = height - padding.top - padding.bottom;
    
    // Find max value from full data
    var maxValue = 0;
    var categories = ['subscriptions', 'messages', 'tips', 'posts', 'streams', 'referrals'];
    categories.forEach(function(cat) {
      var data = chartData.datasets[cat];
      if (data && data.length > 0) {
        var catMax = Math.max.apply(null, data);
        if (catMax > maxValue) maxValue = catMax;
      }
    });
    if (maxValue === 0) maxValue = 100;
    maxValue *= 1.15; // 15% grace like Chart.js - data won't touch top grid line
    
    var numPoints = chartData.labels.length;
    var xStep = chartWidth / (numPoints - 1);
    
    // Get active category - determines which line is bold
    var activeCategory = canvas.getAttribute('data-active-category') || 'subscriptions';
    
    // Prepare line data - active category LAST so it draws on top
    var drawOrder = ['tips', 'messages', 'posts', 'streams', 'referrals', 'subscriptions'];
    // Reorder: move active category to end so it draws on top
    drawOrder = drawOrder.filter(function(c) { return c !== activeCategory; });
    drawOrder.push(activeCategory);
    
    var linesToDraw = [];
    
    drawOrder.forEach(function(cat) {
      var data = chartData.datasets[cat];
      if (!data || data.length === 0) return;
      
      var points = [];
      for (var i = 0; i < data.length; i++) {
        var x = padding.left + i * xStep;
        var y = padding.top + chartHeight * (1 - data[i] / maxValue);
        points.push({ x: x, y: y });
      }
      
      // Active category line is slightly thicker and opaque, others thicker but very transparent
      var isMain = cat === activeCategory;
      linesToDraw.push({
        points: points,
        color: colors[cat],
        lineWidth: isMain ? 1.8 : 2.5,
        alpha: isMain ? 1 : 0.25
      });
    });
    
    // Animation variables - vertical grow like Chart.js
    var animationDuration = 800;
    var startTime = null;
    
    function easeOutQuart(t) {
      return 1 - Math.pow(1 - t, 4);
    }
    
    // Calculate baseline Y (bottom of chart)
    var baselineY = padding.top + chartHeight;
    
    function animate(currentTime) {
      if (!startTime) startTime = currentTime;
      var elapsed = currentTime - startTime;
      var progress = Math.min(elapsed / animationDuration, 1);
      var easedProgress = easeOutQuart(progress);
      
      // Clear canvas
      ctx.clearRect(0, 0, width, height);
      
      // Draw grid lines (4 horizontal lines - matches All time Chart.js with maxTicksLimit:4)
      // 4 ticks = 4 lines dividing into 3 intervals: top line, 2 middle lines, bottom line
      ctx.strokeStyle = getChartGridColor();
      ctx.lineWidth = 1;
      for (var i = 0; i < 4; i++) {
        var gridY = padding.top + (chartHeight * i / 3);
        ctx.beginPath();
        ctx.moveTo(padding.left, gridY);
        ctx.lineTo(width - padding.right, gridY);
        ctx.stroke();
      }
      
      // Draw animated lines - vertical grow from baseline
      linesToDraw.forEach(function(line) {
        ctx.beginPath();
        ctx.strokeStyle = line.color;
        ctx.lineWidth = line.lineWidth;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.globalAlpha = line.alpha;
        
        // Calculate animated points (grow vertically from baseline)
        var animatedPoints = line.points.map(function(p) {
          var animatedY = baselineY + (p.y - baselineY) * easedProgress;
          return { x: p.x, y: animatedY };
        });
        
        ctx.moveTo(animatedPoints[0].x, animatedPoints[0].y);
        for (var i = 0; i < animatedPoints.length - 1; i++) {
          var p0 = animatedPoints[i === 0 ? i : i - 1];
          var p1 = animatedPoints[i];
          var p2 = animatedPoints[i + 1];
          var p3 = animatedPoints[i + 2 < animatedPoints.length ? i + 2 : i + 1];
          var tension = 0.35;
          var cp1x = p1.x + (p2.x - p0.x) * tension;
          var cp1y = p1.y + (p2.y - p0.y) * tension;
          var cp2x = p2.x - (p3.x - p1.x) * tension;
          var cp2y = p2.y - (p3.y - p1.y) * tension;
          ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
        }
        ctx.stroke();
        ctx.globalAlpha = 1;
      });
      
      // Draw X-axis labels - theme-aware color, 5 evenly spaced
      ctx.globalAlpha = easedProgress;
      ctx.fillStyle = getChartLabelColor();
      ctx.font = getChartDateFont();
      ctx.textBaseline = 'top';
      
      // Position: bottom of chart area + padding
      var labelY = chartHeight + padding.top + 15;
      
      // 5 label positions
      var labelIndices = [0, Math.floor(numPoints * 0.25), Math.floor(numPoints * 0.5), Math.floor(numPoints * 0.75), numPoints - 1];
      
      // === РќРђРЎРўР РћР™РљРђ ===
      var minLeftPosition = 67;
      
      var labelData = labelIndices.map(function(idx, i) {
        var label = chartData.labels[idx] || '';
        var dataPointX = padding.left + idx * xStep;
        var labelWidth = ctx.measureText(label).width;
        return { label: label, dataPointX: dataPointX, width: labelWidth, index: i };
      });
      
      var positions;
      if (canvas._fixedDatePositions) {
        positions = canvas._fixedDatePositions;
      } else {
        positions = new Array(5);
        var lastLabelLeft = (width - padding.right) - labelData[4].width;
        var labelSpace = (lastLabelLeft - minLeftPosition) / 4;
        for (var i = 0; i < 4; i++) {
          positions[i] = minLeftPosition + labelSpace * i;
        }
        positions[4] = width - padding.right;
        
        canvas._fixedDatePositions = positions.slice();
        canvas._fixedDateLabels = labelData.map(function(ld) { return ld.label; });
      }
      
      var labelsToUse = canvas._fixedDateLabels || labelData.map(function(ld) { return ld.label; });
      labelsToUse.forEach(function(label, i) {
        var x = positions[i];
        ctx.textAlign = (i === 4) ? 'right' : 'left';
        ctx.fillText(label, x, labelY);
      });
      ctx.globalAlpha = 1;
      
      // Continue animation
      if (progress < 1) {
        requestAnimationFrame(animate);
      }
    }
    
    // Start animation
    requestAnimationFrame(animate);
  }

  // Draw All time chart without animation (for category switching)
  function drawAllTimeChartCanvasNoAnimation(canvas, chartData) {
    var ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    var width = canvas.width;
    var height = canvas.height;
    
    // Chart colors
    var colors = {
      subscriptions: '#2196f3',
      messages: '#ff7043',
      tips: '#00bcd4',
      posts: '#ec407a',
      streams: '#ffa000',
      referrals: '#9575cd'
    };
    
    var padding = { top: 20, right: 10, bottom: 28, left: 10 };
    var chartWidth = width - padding.left - padding.right;
    var chartHeight = height - padding.top - padding.bottom;
    
    // Find max value
    var maxValue = 0;
    var categories = ['subscriptions', 'messages', 'tips', 'posts', 'streams', 'referrals'];
    categories.forEach(function(cat) {
      var data = chartData.datasets[cat];
      if (data && data.length > 0) {
        var catMax = Math.max.apply(null, data);
        if (catMax > maxValue) maxValue = catMax;
      }
    });
    if (maxValue === 0) maxValue = 100;
    maxValue *= 1.15;
    
    var numPoints = chartData.labels.length;
    var xStep = chartWidth / (numPoints - 1);
    
    // Get active category
    var activeCategory = canvas.getAttribute('data-active-category') || 'subscriptions';
    
    // Prepare line data
    var drawOrder = ['tips', 'messages', 'posts', 'streams', 'referrals', 'subscriptions'];
    drawOrder = drawOrder.filter(function(c) { return c !== activeCategory; });
    drawOrder.push(activeCategory);
    
    // Clear canvas
    ctx.clearRect(0, 0, width, height);
    
    // Draw grid lines
    ctx.strokeStyle = getChartGridColor();
    ctx.lineWidth = 1;
    for (var i = 0; i < 4; i++) {
      var gridY = padding.top + (chartHeight * i / 3);
      ctx.beginPath();
      ctx.moveTo(padding.left, gridY);
      ctx.lineTo(width - padding.right, gridY);
      ctx.stroke();
    }
    
    // Draw lines (no animation)
    drawOrder.forEach(function(cat) {
      var data = chartData.datasets[cat];
      if (!data || data.length === 0) return;
      
      var points = [];
      for (var i = 0; i < data.length; i++) {
        var x = padding.left + i * xStep;
        var y = padding.top + chartHeight * (1 - data[i] / maxValue);
        points.push({ x: x, y: y });
      }
      
      var isMain = cat === activeCategory;
      
      ctx.beginPath();
      ctx.strokeStyle = colors[cat];
      ctx.lineWidth = isMain ? 1.8 : 2.5;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.globalAlpha = isMain ? 1 : 0.25;
      
      ctx.moveTo(points[0].x, points[0].y);
      for (var i = 0; i < points.length - 1; i++) {
        var p0 = points[i === 0 ? i : i - 1];
        var p1 = points[i];
        var p2 = points[i + 1];
        var p3 = points[i + 2 < points.length ? i + 2 : i + 1];
        var tension = 0.35;
        
        var cp1x = p1.x + (p2.x - p0.x) * tension;
        var cp1y = p1.y + (p2.y - p0.y) * tension;
        var cp2x = p2.x - (p3.x - p1.x) * tension;
        var cp2y = p2.y - (p3.y - p1.y) * tension;
        
        ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
      }
      ctx.stroke();
    });
    ctx.globalAlpha = 1;
    
    // Draw X-axis labels - theme-aware color, 5 evenly spaced
    ctx.globalAlpha = 1;
    ctx.fillStyle = getChartLabelColor();
    ctx.font = getChartDateFont();
    ctx.textBaseline = 'top';
    var labelY = chartHeight + padding.top + 15;
    
    var labelIndices = [0, Math.floor(numPoints * 0.25), Math.floor(numPoints * 0.5), Math.floor(numPoints * 0.75), numPoints - 1];
    
    // === РќРђРЎРўР РћР™РљРђ ===
    var minLeftPosition = 67;
    
    var labelData = labelIndices.map(function(idx, i) {
      var label = chartData.labels[idx] || '';
      var dataPointX = padding.left + idx * xStep;
      var labelWidth = ctx.measureText(label).width;
      return { label: label, dataPointX: dataPointX, width: labelWidth, index: i };
    });
    
    var positions;
    if (canvas._fixedDatePositions) {
      positions = canvas._fixedDatePositions;
    } else {
      positions = new Array(5);
      var lastLabelLeft = (width - padding.right) - labelData[4].width;
      var labelSpace = (lastLabelLeft - minLeftPosition) / 4;
      for (var i = 0; i < 4; i++) {
        positions[i] = minLeftPosition + labelSpace * i;
      }
      positions[4] = width - padding.right;
      
      canvas._fixedDatePositions = positions.slice();
      canvas._fixedDateLabels = labelData.map(function(ld) { return ld.label; });
    }
    
    var labelsToUse = canvas._fixedDateLabels || labelData.map(function(ld) { return ld.label; });
    labelsToUse.forEach(function(label, i) {
      var x = positions[i];
      ctx.textAlign = (i === 4) ? 'right' : 'left';
      ctx.fillText(label, x, labelY);
    });
  }

  // Load Chart.js and drawer from extension (kept for backwards compatibility)
  function loadChartAndDraw(canvas, chartData) {
    log('OF Stats: Loading Chart.js from extension...');
    
    // First load Chart.js
    var chartScript = document.createElement('script');
    chartScript.src = chrome.runtime.getURL('chart.min.js');
    chartScript.onload = function() {
      log('OF Stats: Chart.js loaded successfully');
      
      // Then load our drawer script
      var drawerScript = document.createElement('script');
      drawerScript.src = chrome.runtime.getURL('chart-drawer.js');
      drawerScript.onload = function() {
        log('OF Stats: Chart drawer loaded');
        
        // Now trigger chart drawing via custom event
        triggerChartDraw(canvas, chartData);
      };
      drawerScript.onerror = function() {
        log('OF Stats: Failed to load chart drawer');
        drawCanvasFallback(canvas, chartData);
      };
      document.head.appendChild(drawerScript);
    };
    chartScript.onerror = function() {
      log('OF Stats: Failed to load Chart.js, using canvas fallback');
      drawCanvasFallback(canvas, chartData);
    };
    document.head.appendChild(chartScript);
  }
  
  // Trigger chart drawing via custom event
  function triggerChartDraw(canvas, chartData) {
    // Prepare data - only 5 points for cleaner chart
    var totalPoints = chartData.labels.length;
    var indices = [];
    for (var i = 0; i < 5; i++) {
      indices.push(Math.round(i * (totalPoints - 1) / 4));
    }
    
    var labels = indices.map(function(i) { return chartData.labels[i]; });
    
    // Chart colors
    var colors = {
      subscriptions: '#2196f3', // Blue - first, solid
      messages: '#ff7043',
      tips: '#00bcd4',
      posts: '#ec407a',
      streams: '#ffa000'
    };
    
    var datasets = [];
    // Subscriptions first (blue solid line), then others
    var categories = ['subscriptions', 'messages', 'tips', 'posts', 'streams'];
    
    categories.forEach(function(cat) {
      var fullData = chartData.datasets[cat];
      if (!fullData || fullData.length === 0) return;
      
      var hasData = fullData.some(function(v) { return v > 0; });
      if (!hasData) return;
      
      var data = indices.map(function(i) { return fullData[i]; });
      
      datasets.push({
        data: data,
        borderColor: colors[cat],
        borderWidth: 2,
        tension: 0.35,
        pointRadius: 0,
        fill: false
      });
    });
    
    log('OF Stats: Triggering chart draw with', datasets.length, 'datasets, labels:', labels);
    
    // Give canvas an ID for the drawer to find it
    canvas.id = 'of-stats-chart-' + Date.now();
    
    // Dispatch custom event with chart config
    var event = new CustomEvent('of-stats-draw-chart', {
      detail: {
        canvasId: canvas.id,
        labels: labels,
        datasets: datasets,
        labelColor: '#8b8b8b'
      }
    });
    window.dispatchEvent(event);
  }
  
  // Fallback canvas drawing if Chart.js fails
  function drawCanvasFallback(canvas, chartData) {
    var ctx = canvas.getContext('2d');
    if (!ctx) {
      log('OF Stats: Could not get canvas context');
      return;
    }
    
    var width = canvas.width;
    var height = canvas.height;
    
    // Clear canvas
    ctx.clearRect(0, 0, width, height);
    
    // Chart colors matching OnlyFans style
    var colors = {
      messages: '#ff7043',      // Orange/Coral (main line)
      tips: '#00bcd4',          // Cyan
      subscriptions: '#2196f3', // Blue
      posts: '#ec407a',         // Pink
      referrals: '#9575cd',     // Purple
      streams: '#ffa000'        // Amber
    };
    
    // Chart padding
    var padding = { top: 10, right: 10, bottom: 25, left: 10 };
    var chartWidth = width - padding.left - padding.right;
    var chartHeight = height - padding.top - padding.bottom;
    
    // Find max value
    var maxValue = 0;
    var categories = ['messages', 'tips', 'subscriptions', 'posts', 'streams'];
    categories.forEach(function(cat) {
      var data = chartData.datasets[cat];
      if (data) {
        data.forEach(function(val) {
          if (val > maxValue) maxValue = val;
        });
      }
    });
    
    if (maxValue === 0) maxValue = 100;
    maxValue *= 1.15; // 15% grace
    
    var numPoints = chartData.labels.length;
    if (numPoints < 2) return;
    
    var xStep = chartWidth / (numPoints - 1);
    
    // Draw each line
    categories.forEach(function(cat) {
      var data = chartData.datasets[cat];
      if (!data || data.length === 0) return;
      
      ctx.beginPath();
      ctx.strokeStyle = colors[cat];
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      
      // Calculate points
      var points = [];
      for (var i = 0; i < data.length; i++) {
        var x = padding.left + i * xStep;
        var y = padding.top + chartHeight * (1 - data[i] / maxValue);
        points.push({ x: x, y: y });
      }
      
      // Draw smooth bezier curve
      ctx.moveTo(points[0].x, points[0].y);
      
      for (var i = 0; i < points.length - 1; i++) {
        var p0 = points[i === 0 ? i : i - 1];
        var p1 = points[i];
        var p2 = points[i + 1];
        var p3 = points[i + 2 < points.length ? i + 2 : i + 1];
        
        var tension = 0.35;
        var cp1x = p1.x + (p2.x - p0.x) * tension;
        var cp1y = p1.y + (p2.y - p0.y) * tension;
        var cp2x = p2.x - (p3.x - p1.x) * tension;
        var cp2y = p2.y - (p3.y - p1.y) * tension;
        
        ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
      }
      
      ctx.stroke();
    });
    
    // Draw X-axis labels - 5 evenly spaced
    ctx.fillStyle = getChartLabelColor();
    ctx.font = getChartDateFont();
    ctx.textBaseline = 'top';
    
    var labels = chartData.labels;
    var totalLabels = labels.length;
    
    // 5 label positions
    var labelPositions = [];
    for (var i = 0; i < 5; i++) {
      labelPositions.push(Math.round(i * (totalLabels - 1) / 4));
    }
    
    labelPositions.forEach(function(idx) {
      var x = padding.left + idx * xStep;
      var y = height - 18;
      ctx.textAlign = 'center';
      ctx.fillText(labels[idx], x, y);
    });
    
    log('OF Stats: Canvas chart drawn with ' + numPoints + ' points');
  }
  
  // Generate chart data from monthly stats - creates cumulative growth chart
  function generateChartDataFromMonths(stats) {
    var labels = [];
    var dates = []; // ISO date strings for Chart.js time axis
    var datasets = {
      subscriptions: [],
      tips: [],
      posts: [],
      messages: [],
      referrals: [],
      streams: []
    };
    
    // Use existing months if available, otherwise generate new ones
    var months = stats.months;
    if (!months || months.length === 0) {
      months = generateMonthlyEarnings(stats.net);
      stats.months = months;
      saveEarningStats(stats); // Save newly generated months
    }
    
    // Sort months from oldest to newest
    var sortedMonths = months.slice().sort(function(a, b) {
      return new Date(a.year, a.month) - new Date(b.year, b.month);
    });
    
    // Generate cumulative data points from each month's categories
    var cumulative = {
      subscriptions: 0,
      tips: 0,
      posts: 0,
      messages: 0,
      referrals: 0,
      streams: 0
    };
    
    var langChart2 = getPageLanguage();
    var monthNamesShort = langChart2 === 'ru' ? ['янв.', 'февр.', 'март', 'апр.', 'май', 'июнь', 'июль', 'авг.', 'сент.', 'окт.', 'нояб.', 'дек.']
      : langChart2 === 'es' ? ['ene.', 'feb.', 'mar.', 'abr.', 'may.', 'jun.', 'jul.', 'ago.', 'sep.', 'oct.', 'nov.', 'dic.']
      : langChart2 === 'de' ? ['Jan.', 'Feb.', 'Mär.', 'Apr.', 'Mai', 'Jun.', 'Jul.', 'Aug.', 'Sep.', 'Okt.', 'Nov.', 'Dez.']
      : ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    
    // Add data points for every other month (skip 1 month between points)
    sortedMonths.forEach(function(monthData, index) {
      // Skip odd indices to show every other month
      if (index % 2 !== 0 && index !== sortedMonths.length - 1) {
        // Still accumulate data for skipped months
        var monthCategories = monthData.categories;
        if (monthCategories) {
          Object.keys(cumulative).forEach(function(cat) {
            cumulative[cat] += monthCategories[cat] || 0;
          });
        } else {
          var catTotals = stats.categories;
          var totalNet = stats.net || 1;
          var monthNet = monthData.net;
          Object.keys(cumulative).forEach(function(cat) {
            var proportion = catTotals[cat] ? catTotals[cat].net / totalNet : 0;
            cumulative[cat] += monthNet * proportion;
          });
        }
        return; // Skip adding point but keep accumulating
      }
      
      // Create consistent day per month (1-28 range)
      var daysInMonth = new Date(monthData.year, monthData.month + 1, 0).getDate();
      var dayOffset = (monthData.month * 13 + monthData.year * 7) % 22;
      var day = 1 + dayOffset;
      if (day > daysInMonth) day = Math.floor(daysInMonth / 2);
      
      // ISO date string for Chart.js (YYYY-MM-DD)
      var monthNum = (monthData.month + 1).toString().padStart(2, '0');
      var dayStr = day.toString().padStart(2, '0');
      var isoDate = monthData.year + '-' + monthNum + '-' + dayStr;
      dates.push(isoDate);
      
      // Human readable label
      var monthStr = monthNamesShort[monthData.month];
      var yearStr = monthData.year.toString().slice(-2);
      var label = day + ' ' + monthStr + ' ' + yearStr;
      labels.push(label);
      
      // Use month's own category breakdown if available
      var monthCategories = monthData.categories;
      
      if (monthCategories) {
        // Add this month's categories to cumulative totals
        Object.keys(cumulative).forEach(function(cat) {
          cumulative[cat] += monthCategories[cat] || 0;
          datasets[cat].push(Math.round(cumulative[cat] * 100) / 100);
        });
      } else {
        // Fallback: distribute month net using total proportions
        var catTotals = stats.categories;
        var totalNet = stats.net || 1;
        var monthNet = monthData.net;
        
        Object.keys(cumulative).forEach(function(cat) {
          var proportion = catTotals[cat] ? catTotals[cat].net / totalNet : 0;
          cumulative[cat] += monthNet * proportion;
          datasets[cat].push(Math.round(cumulative[cat] * 100) / 100);
        });
      }
    });
    
    log('OF Stats: Generated chart data - ' + labels.length + ' points (every other month), dates:', dates.slice(0, 3), '...', dates.slice(-1));
    
    // Normalize datasets so last point equals actual Gross values from stats.categories
    if (stats.categories) {
      Object.keys(datasets).forEach(function(cat) {
        var data = datasets[cat];
        if (data.length > 0) {
          var lastValue = data[data.length - 1];
          var targetGross = stats.categories[cat] ? (stats.categories[cat].gross || stats.categories[cat].net || 0) : 0;
          
          if (lastValue > 0 && targetGross > 0) {
            // Scale all values proportionally so last value equals targetGross
            var scaleFactor = targetGross / lastValue;
            for (var i = 0; i < data.length; i++) {
              data[i] = Math.round(data[i] * scaleFactor * 100) / 100;
            }
          } else if (targetGross > 0) {
            // If lastValue is 0 but we have a target, set last point to target
            data[data.length - 1] = targetGross;
          } else {
            // If target is 0, ensure all values are 0
            for (var i = 0; i < data.length; i++) {
              data[i] = 0;
            }
          }
        }
      });
      log('OF Stats: Normalized chart data to match Gross values');
    }
    
    return {
      labels: labels,
      dates: dates,
      datasets: datasets
    };
  }
  
  // Get current balance + pending from cached settings
  function getMinimumCurrentMonthEarning() {
    var currentBalance = 0;
    var pendingBalance = 0;
    
    if (cachedSettings) {
      // Parse current balance
      if (cachedSettings.currentBalance) {
        currentBalance = parseFloat(cachedSettings.currentBalance.toString().replace(/[$,]/g, '')) || 0;
      }
      // Parse pending balance
      if (cachedSettings.pendingBalance) {
        pendingBalance = parseFloat(cachedSettings.pendingBalance.toString().replace(/[$,]/g, '')) || 0;
      }
    }
    
    return currentBalance + pendingBalance;
  }
  
  // Generate monthly earnings data
  // Optional oldestMonthData: {year, month} - if provided, generates months starting from current month to this oldest month
  function generateMonthlyEarnings(totalNet, oldestMonthData) {
    var months = [];
    var now = new Date();
    var currentYear = now.getFullYear();
    var currentMonth = now.getMonth(); // 0-11
    
    // Get minimum for current month (Current + Pending balance)
    var minCurrentMonth = getMinimumCurrentMonthEarning();
    
    // If oldest month is provided (from preset), calculate exact number of months
    var numMonths;
    if (oldestMonthData && oldestMonthData.year && typeof oldestMonthData.month === 'number') {
      // Calculate months between current month and oldest month
      var oldestDate = new Date(oldestMonthData.year, oldestMonthData.month, 1);
      var currentDate = new Date(currentYear, currentMonth, 1);
      numMonths = (currentYear - oldestMonthData.year) * 12 + (currentMonth - oldestMonthData.month) + 1;
      numMonths = Math.max(numMonths, 1); // At least 1 month
      log('OF Stats: Generating ' + numMonths + ' months to match preset oldest month (' + oldestMonthData.year + '-' + (oldestMonthData.month + 1) + ')');
    } else {
      // Determine how many months based on total amount - MORE MONTHS
      // Small amounts ($0-$10k): 15-25 months
      // Medium amounts ($10k-$50k): 25-40 months
      // Large amounts ($50k-$100k): 35-50 months
      // Huge amounts ($100k+): 40-60 months
      if (totalNet < 10000) {
        numMonths = 15 + Math.floor(Math.random() * 11);
      } else if (totalNet < 50000) {
        numMonths = 25 + Math.floor(Math.random() * 16);
      } else if (totalNet < 100000) {
        numMonths = 35 + Math.floor(Math.random() * 16);
      } else {
        numMonths = 40 + Math.floor(Math.random() * 21);
      }
    }
    
    // Choose a growth pattern randomly
    // 1: Consistent growth (40%)
    // 2: Peak in middle then decline (25%)
    // 3: Slow start then rapid growth (20%)
    // 4: Plateau after growth (15%)
    var patternRand = Math.random();
    var growthPattern;
    if (patternRand < 0.40) {
      growthPattern = 'consistent';
    } else if (patternRand < 0.65) {
      growthPattern = 'peak-middle';
    } else if (patternRand < 0.85) {
      growthPattern = 'rapid-late';
    } else {
      growthPattern = 'plateau';
    }
    
    // Generate growth curve - start small, grow gradually
    // Using exponential growth from past to present
    var weights = [];
    var totalWeight = 0;
    
    for (var i = 0; i < numMonths; i++) {
      // i=0 is current month, i=numMonths-1 is oldest
      var monthsFromStart = i; // 0 for current, numMonths-1 for oldest
      var progressRatio = (numMonths - 1 - monthsFromStart) / (numMonths - 1); // 0 for oldest, 1 for newest
      
      var baseGrowthFactor;
      
      // Apply different growth patterns
      if (growthPattern === 'consistent') {
        // Consistent growth from small to large
        baseGrowthFactor = Math.pow(progressRatio, 2.2);
        
      } else if (growthPattern === 'peak-middle') {
        // Peak around 60-70% of career, then slight decline
        var peakPoint = 0.65 + Math.random() * 0.1; // 65-75%
        if (progressRatio < peakPoint) {
          baseGrowthFactor = Math.pow(progressRatio / peakPoint, 1.8);
        } else {
          var declineRatio = (1 - progressRatio) / (1 - peakPoint);
          baseGrowthFactor = 1 - (declineRatio * 0.3); // 30% decline after peak
        }
        
      } else if (growthPattern === 'rapid-late') {
        // Slow start, then rapid growth in last 30%
        if (progressRatio < 0.7) {
          baseGrowthFactor = Math.pow(progressRatio, 3.5) * 0.4;
        } else {
          baseGrowthFactor = Math.pow((progressRatio - 0.7) / 0.3, 1.5) * 0.6 + 0.4;
        }
        
      } else { // plateau
        // Growth then plateau at 70-90%
        var plateauStart = 0.7 + Math.random() * 0.2;
        if (progressRatio < plateauStart) {
          baseGrowthFactor = Math.pow(progressRatio / plateauStart, 2.0);
        } else {
          baseGrowthFactor = 0.9 + Math.random() * 0.2; // Plateau with slight variation
        }
      }
      
      // Smooth randomization (85-115% for most, bigger for very early months)
      var randomFluctuation;
      if (monthsFromStart > numMonths - 5) {
        // First 5 months can have bigger variation (60-140%)
        randomFluctuation = 0.6 + Math.random() * 0.8;
      } else {
        // Later months: smoother (85-115%)
        randomFluctuation = 0.85 + Math.random() * 0.3;
      }
      
      // Very rare special events (5% chance, not 2x but 1.4x or 0.7x)
      var specialEvent = Math.random();
      if (specialEvent < 0.025 && monthsFromStart < numMonths - 8) {
        randomFluctuation *= 1.4; // Good month (+40%)
      } else if (specialEvent < 0.05 && monthsFromStart < numMonths - 8) {
        randomFluctuation *= 0.7; // Bad month (-30%)
      }
      
      // Force very early months to be tiny
      if (monthsFromStart > numMonths - 4) {
        baseGrowthFactor *= 0.03; // First 4 months extremely small
      } else if (monthsFromStart > numMonths - 8) {
        baseGrowthFactor *= 0.12; // Months 5-8 still very small
      }
      
      var weight = Math.max(0.005, baseGrowthFactor * randomFluctuation);
      
      weights.push(weight);
      totalWeight += weight;
    }
    
    // Distribute total net across months based on weights
    for (var i = 0; i < numMonths; i++) {
      var monthDate = new Date(currentYear, currentMonth - i, 1);
      var monthValue = (totalNet * weights[i] / totalWeight);
      
      // Current month: ensure MORE than minCurrentMonth (add 10-50% buffer)
      if (i === 0 && minCurrentMonth > 0) {
        var minWithBuffer = minCurrentMonth * (1.1 + Math.random() * 0.4); // 110-150% of min
        monthValue = Math.max(monthValue, minWithBuffer);
      }
      
      // Add extra randomness variation (90-110% for current month, 80-120% for others)
      if (i === 0) {
        monthValue *= (0.95 + Math.random() * 0.15); // Less variation for current month
      } else {
        monthValue *= (0.8 + Math.random() * 0.4);
      }
      
      // For very early months (oldest), cap at $1000
      var monthsFromStart = numMonths - 1 - i;
      if (monthsFromStart < 3) {
        monthValue = Math.min(monthValue, 300 + Math.random() * 700); // $300-$1000
      } else if (monthsFromStart < 6) {
        monthValue = Math.min(monthValue, 800 + Math.random() * 1200); // $800-$2000
      }
      
      // Ensure minimum value for each month (very small for early months)
      monthValue = Math.max(monthValue, 50 + Math.random() * 100);
      
      // Generate category breakdown for this month
      var monthCategories = generateMonthCategoryBreakdown(monthValue);
      
      months.push({
        date: monthDate,
        year: monthDate.getFullYear(),
        month: monthDate.getMonth(),
        net: monthValue,
        categories: monthCategories
      });
    }
    
    // Normalize to match total net exactly
    var generatedTotal = months.reduce(function(sum, m) { return sum + m.net; }, 0);
    var adjustFactor = totalNet / generatedTotal;
    months.forEach(function(m) {
      m.net *= adjustFactor;
      // Also adjust categories
      Object.keys(m.categories).forEach(function(cat) {
        m.categories[cat] *= adjustFactor;
      });
    });
    
    // IMPORTANT: After normalization, ensure current month (index 0) is MORE than minCurrentMonth
    // This prevents Current Balance from being higher than current month earnings
    // Add 10-50% buffer to make it look natural
    var minWithBuffer = minCurrentMonth * (1.1 + Math.random() * 0.4); // 110-150% of min
    if (minCurrentMonth > 0 && months.length > 0 && months[0].net < minWithBuffer) {
      log('OF Stats: Current month after normalization ($' + months[0].net.toFixed(2) + ') < minRequired with buffer ($' + minWithBuffer.toFixed(2) + '), adjusting...');
      
      // Set to the buffered minimum
      var newNet = minWithBuffer;
      
      // Redistribute the deficit across categories proportionally
      var catTotal = 0;
      Object.keys(months[0].categories).forEach(function(cat) {
        catTotal += months[0].categories[cat];
      });
      
      if (catTotal > 0) {
        // Scale categories to match new net value
        var catScale = newNet / catTotal;
        Object.keys(months[0].categories).forEach(function(cat) {
          months[0].categories[cat] *= catScale;
        });
      } else {
        // If no categories had values, distribute to messages (main category)
        months[0].categories.messages = newNet * 0.75;
        months[0].categories.tips = newNet * 0.22;
        months[0].categories.posts = newNet * 0.03;
      }
      
      months[0].net = newNet;
      log('OF Stats: Adjusted current month to $' + months[0].net.toFixed(2));
    }
    
    log('OF Stats: Generated ' + numMonths + ' months, minCurrentMonth: $' + minCurrentMonth.toFixed(2));
    return months;
  }
  
  // Generate category breakdown for a single month
  function generateMonthCategoryBreakdown(monthNet) {
    // Distribution: Messages ~75%, Tips ~22%, Posts ~3%
    // Subscriptions: always $0.00
    // Streams: always $0.00
    // Referrals: always $0.00
    
    var messagesShare = 0.70 + Math.random() * 0.10;  // 70-80%
    var postsShare = 0.02 + Math.random() * 0.02;     // 2-4%
    var tipsShare = 1 - messagesShare - postsShare;   // rest (~16-28%)
    
    return {
      subscriptions: 0,
      tips: tipsShare * monthNet,
      posts: postsShare * monthNet,
      messages: messagesShare * monthNet,
      referrals: 0,
      streams: 0
    };
  }
  
  // Month names for display
  var monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 
                    'July', 'August', 'September', 'October', 'November', 'December'];
  
  // Create a month row HTML element with expandable content
  function createMonthRowElement(monthData) {
    var lang = getPageLanguage();
    var monthName = lang === 'ru' ? monthNamesEarlyRu[monthData.month] : lang === 'es' ? monthNamesEarlyEs[monthData.month] : lang === 'de' ? monthNamesEarlyDe[monthData.month] : monthNames[monthData.month];
    var monthNameShort = lang === 'ru' ? monthNamesShortRu[monthData.month] : lang === 'es' ? monthNamesShortEs[monthData.month] : lang === 'de' ? monthNamesShortDe[monthData.month] : ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][monthData.month];
    var yearStr = monthData.year.toString();
    var netValue = monthData.net;
    var netStr = formatCurrency(netValue);
    
    // Calculate gross from net (net is ~80% of gross)
    var grossValue = netValue / 0.8;
    var grossStr = formatCurrency(grossValue);
    
    // Get category data
    var categories = monthData.categories || {};
    var subsNet = categories.subscriptions || 0;
    var tipsNet = categories.tips || 0;
    var postsNet = categories.posts || 0;
    var messagesNet = categories.messages || 0;
    var referralsNet = categories.referrals || 0;
    var streamsNet = categories.streams || 0;
    
    // Calculate gross for each category
    var subsGross = subsNet / 0.8;
    var tipsGross = tipsNet / 0.8;
    var postsGross = postsNet / 0.8;
    var messagesGross = messagesNet / 0.8;
    var referralsGross = referralsNet / 0.8;
    var streamsGross = streamsNet / 0.8;
    
    // Check if values are zero for m-zero-value class
    var subsZero = subsNet === 0 ? ' m-zero-value' : '';
    var tipsZero = tipsNet === 0 ? ' m-zero-value' : '';
    var postsZero = postsNet === 0 ? ' m-zero-value' : '';
    var messagesZero = messagesNet === 0 ? ' m-zero-value' : '';
    var streamsZero = streamsNet === 0 ? ' m-zero-value' : '';
    
    // Calculate first and last day of month for calendar button
    var daysInMonth = new Date(monthData.year, monthData.month + 1, 0).getDate();
    var fromDate = monthNameShort + ' 1, ' + yearStr;
    var toDate = monthNameShort + ' ' + daysInMonth + ', ' + yearStr;
    
    var row = document.createElement('div');
    row.className = 'b-stats-row';
    row.setAttribute('data-of-stats-generated', 'true');
    row.setAttribute('data-month-year', monthData.month + '-' + monthData.year);
    
    row.innerHTML = '<div class="b-stats-row__head">' +
      '<div class="b-stats-row__month"> ' + monthName + ', ' + yearStr + ' </div>' +
      '<div class="b-stats-row__total-net g-semibold"><span class="" data-of-stats-modified="true"> $' + netStr + ' </span></div>' +
      '<svg class="b-stats-row__arrow g-icon" data-icon-name="icon-arrow-down" aria-hidden="true"><use href="#icon-arrow-down" xlink:href="#icon-arrow-down"></use></svg>' +
      '</div>' +
      '<div class="b-stats-row__body" style="display: none;">' +
        '<div>' +
          '<div class="b-chart__wrapper" style="position: relative; margin-top: -15px;" data-of-month-chart="true">' +
            '<canvas class="b-chart__multiple-line" height="220" width="608" style="display: block; box-sizing: border-box; height: 220px; width: 608px;" data-of-stats-month-canvas="' + monthData.month + '-' + monthData.year + '" data-of-stats-overlay="true"></canvas>' +
          '</div>' +
        '</div>' +
        '<button class="g-btn m-border m-rounded m-block m-no-uppercase m-icon-absolute m-time-period m-lg">' +
          '<svg class="m-half-left g-icon" data-icon-name="icon-calendar" aria-hidden="true"><use href="#icon-calendar" xlink:href="#icon-calendar"></use></svg>' +
          '<span class="b-btn-text"> ' + (lang === 'ru' ? 'От ' : lang === 'es' ? 'Desde ' : lang === 'de' ? 'Von ' : 'From ') + '<span class="b-date-value">' + fromDate + '</span> ' + (lang === 'ru' ? 'К ' : lang === 'es' ? 'Hasta ' : lang === 'de' ? 'Bis ' : 'To ') + '<span class="b-date-value">' + toDate + '</span></span>' +
        '</button>' +
        '<div class="b-stats-row__content" data-of-stats-ready="true">' +
          '<div class="b-stats-row__label m-border-line m-subscriptions m-active">' +
            '<span class="b-stats-row__name g-md-text m-dots m-break-word"> ' + (lang === 'ru' ? 'Подписки' : lang === 'es' ? 'Suscripciones' : lang === 'de' ? 'Abonnements' : 'Subscriptions') + ' </span>' +
            '<span class="b-stats-row__val g-semibold' + subsZero + '" data-of-stats-modified="true"> $' + formatCurrency(subsGross) + ' </span>' +
            '<span class="b-stats-row__val g-semibold' + subsZero + '" data-of-stats-modified="true"> $' + formatCurrency(subsNet) + ' </span>' +
          '</div>' +
          '<div class="b-stats-row__label m-border-line m-tips">' +
            '<span class="b-stats-row__name g-md-text m-dots m-break-word"> ' + (lang === 'ru' ? 'Чаевые' : lang === 'es' ? 'Propinas' : lang === 'de' ? 'Trinkgelder' : 'Tips') + ' </span>' +
            '<span class="b-stats-row__val g-semibold' + tipsZero + '" data-of-stats-modified="true"> $' + formatCurrency(tipsGross) + ' </span>' +
            '<span class="b-stats-row__val g-semibold' + tipsZero + '" data-of-stats-modified="true"> $' + formatCurrency(tipsNet) + ' </span>' +
          '</div>' +
          '<div class="b-stats-row__label m-border-line m-posts">' +
            '<span class="b-stats-row__name g-md-text m-dots m-break-word"> ' + (lang === 'ru' ? 'Посты' : lang === 'es' ? 'Publicaciones' : lang === 'de' ? 'Beiträge' : 'Posts') + ' </span>' +
            '<span class="b-stats-row__val g-semibold' + postsZero + '" data-of-stats-modified="true"> $' + formatCurrency(postsGross) + ' </span>' +
            '<span class="b-stats-row__val g-semibold' + postsZero + '" data-of-stats-modified="true"> $' + formatCurrency(postsNet) + ' </span>' +
          '</div>' +
          '<div class="b-stats-row__label m-border-line m-messages">' +
            '<span class="b-stats-row__name g-md-text m-dots m-break-word"> ' + (lang === 'ru' ? 'Сообщения' : lang === 'es' ? 'Mensajes' : lang === 'de' ? 'Nachrichten' : 'Messages') + ' </span>' +
            '<span class="b-stats-row__val g-semibold' + messagesZero + '" data-of-stats-modified="true"> $' + formatCurrency(messagesGross) + ' </span>' +
            '<span class="b-stats-row__val g-semibold' + messagesZero + '" data-of-stats-modified="true"> $' + formatCurrency(messagesNet) + ' </span>' +
          '</div>' +
          '<div class="b-stats-row__label m-border-line m-referrals">' +
            '<span class="b-stats-row__name g-md-text m-dots m-break-word"> ' + (lang === 'ru' ? 'Рефералы' : lang === 'es' ? 'Referidos' : lang === 'de' ? 'Empfehlungen' : 'Referrals') + ' </span>' +
            '<span class="b-stats-row__val g-semibold m-zero-value" data-of-stats-modified="true"> $0.00 </span>' +
            '<span class="b-stats-row__val g-semibold m-zero-value" data-of-stats-modified="true"> $0.00 </span>' +
          '</div>' +
          '<div class="b-stats-row__label m-border-line m-calls">' +
            '<span class="b-stats-row__name g-md-text m-dots m-break-word"> ' + (lang === 'ru' ? 'Потоки' : lang === 'es' ? 'Transmisiones' : lang === 'de' ? 'Streams' : 'Streams') + ' </span>' +
            '<span class="b-stats-row__val g-semibold' + streamsZero + '" data-of-stats-modified="true"> $' + formatCurrency(streamsGross) + ' </span>' +
            '<span class="b-stats-row__val g-semibold' + streamsZero + '" data-of-stats-modified="true"> $' + formatCurrency(streamsNet) + ' </span>' +
          '</div>' +
          '<div class="b-stats-row__label m-border-line m-total">' +
            '<span class="b-stats-row__name g-md-text"> ' + (lang === 'ru' ? 'Итого' : lang === 'es' ? 'Total' : lang === 'de' ? 'Gesamt' : 'Total') + ' </span>' +
            '<div class="b-stats-row__label m-total-item pt-0 pb-0">' +
              '<span class="b-stats-row__name g-md-text"> ' + (lang === 'ru' ? 'Валовой' : lang === 'es' ? 'Bruto' : lang === 'de' ? 'Brutto' : 'Gross') + ' </span>' +
              '<span class="b-stats-row__val g-semibold" data-of-stats-modified="true"> $' + grossStr + ' </span>' +
            '</div>' +
            '<div class="b-stats-row__label m-total-item pt-0 pb-0">' +
              '<span class="b-stats-row__name g-md-text"> ' + (lang === 'ru' ? 'Чистая' : lang === 'es' ? 'Neto' : lang === 'de' ? 'Netto' : 'Net') + ' </span>' +
              '<span class="b-stats-row__val g-semibold" data-of-stats-modified="true"> $' + netStr + ' </span>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';
    
    // Add click handler to expand/collapse
    var head = row.querySelector('.b-stats-row__head');
    if (head) {
      head.style.cursor = 'pointer';
      head.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        toggleMonthRow(row);
      });
    }
    
    // Use event delegation on the content area for category clicks
    var monthContent = row.querySelector('.b-stats-row__content');
    if (monthContent) {
      monthContent.addEventListener('click', function(e) {
        var label = e.target.closest('.b-stats-row__label.m-border-line:not(.m-total)');
        if (label) {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          switchActiveCategory(row, label);
        }
      }, true); // capture phase
    }
    
    // Add cursor and handlers on labels, set initial styles
    var categoryLabels = row.querySelectorAll('.b-stats-row__label.m-border-line:not(.m-total)');
    categoryLabels.forEach(function(label) {
      // Set initial styles - Subscriptions active, others inactive
      var nameEl = label.querySelector('.b-stats-row__name');
      if (nameEl) {
        if (label.classList.contains('m-subscriptions')) {
          nameEl.style.color = '#000';
          nameEl.style.opacity = '1';
        } else {
          nameEl.style.color = '#8a96a3';
          nameEl.style.opacity = '0.6';
        }
      }
      label.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        switchActiveCategory(row, label);
      }, true); // capture phase
    });
    
    return row;
  }
  
  // Toggle month row expansion
  // Cannot close all - can only switch between rows
  function toggleMonthRow(row) {
    var isExpanded = row.classList.contains('m-expanded');
    var body = row.querySelector('.b-stats-row__body');
    
    // If already expanded, do nothing (can't close last open row)
    if (isExpanded) {
      return;
    }
    
    // Collapse All time row and other expanded months first
    var container = row.closest('.b-stats-wrap');
    if (container) {
      container.querySelectorAll('.b-stats-row.m-expanded').forEach(function(expandedRow) {
        expandedRow.classList.remove('m-expanded');
        var expandedBody = expandedRow.querySelector('.b-stats-row__body');
        if (expandedBody) expandedBody.style.display = 'none';
      });
    }
    
    // Expand this row
    row.classList.add('m-expanded');
    if (body) {
      body.style.display = 'block';
      
      // Always draw chart with animation when expanding
      var canvas = body.querySelector('canvas[data-of-stats-month-canvas]');
      if (canvas) {
        drawMonthChart(canvas, row);
      }
    }
  }
  
  // Draw chart for a specific month - uses same logic as All time chart via drawMonthChartCanvas
  function drawMonthChart(canvas, row) {
    if (!canvas) return;
    
    // Always clear and redraw for animation
    if (canvas._chartInstance) {
      canvas._chartInstance.destroy();
      canvas._chartInstance = null;
    }
    var ctx = canvas.getContext('2d');
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    var monthKey = canvas.getAttribute('data-of-stats-month-canvas');
    if (!monthKey) return;
    
    // Get month data from stats
    var stats = getOrGenerateEarningStats();
    if (!stats || !stats.months) return;
    
    var parts = monthKey.split('-');
    var targetMonth = parseInt(parts[0]);
    var targetYear = parseInt(parts[1]);
    
    var monthData = stats.months.find(function(m) {
      return m.month === targetMonth && m.year === targetYear;
    });
    
    if (!monthData) {
      log('OF Stats: Month data not found for', targetMonth, targetYear);
      return;
    }
    
    // Generate daily cumulative data for this month (like All time chart)
    var now = new Date();
    var isCurrentMonth = (targetYear === now.getFullYear() && targetMonth === now.getMonth());
    var currentDay = now.getDate();
    
    // Always use full month for chart display
    var daysInMonth = new Date(targetYear, targetMonth + 1, 0).getDate();
    
    // For current month, data is only generated up to today
    var daysWithData = isCurrentMonth ? currentDay : daysInMonth;
    
    var categories = monthData.categories || {};
    
    // Generate daily breakdown per category
    var dailyCategories = {
      subscriptions: [],
      tips: [],
      messages: [],
      posts: [],
      streams: []
    };
    
    // Distribute each category across days with cumulative growth (only up to daysWithData)
    Object.keys(dailyCategories).forEach(function(cat) {
      var totalForCat = categories[cat] || 0;
      var cumulative = 0;
      var remaining = totalForCat;
      
      // Generate data up to daysWithData
      for (var d = 0; d < daysWithData; d++) {
        var dayShare;
        if (d === daysWithData - 1) {
          dayShare = remaining;
        } else {
          var avgDaily = remaining / (daysWithData - d);
          dayShare = avgDaily * (0.2 + Math.random() * 1.6);
          dayShare = Math.max(0, Math.min(dayShare, remaining * 0.4));
        }
        cumulative += dayShare;
        remaining -= dayShare;
        dailyCategories[cat].push(cumulative);
      }
      
      // For current month: add flat line from today to end of month
      if (isCurrentMonth && daysWithData < daysInMonth) {
        var lastValue = cumulative;
        for (var d = daysWithData; d < daysInMonth; d++) {
          dailyCategories[cat].push(lastValue);
        }
      }
    });
    
    // Generate labels (day numbers)
    var labels = [];
    var langChart3 = getPageLanguage();
    var monthNamesShort = langChart3 === 'ru' ? ['янв.', 'февр.', 'март', 'апр.', 'май', 'июнь', 'июль', 'авг.', 'сент.', 'окт.', 'нояб.', 'дек.']
      : langChart3 === 'es' ? ['ene.', 'feb.', 'mar.', 'abr.', 'may.', 'jun.', 'jul.', 'ago.', 'sep.', 'oct.', 'nov.', 'dic.']
      : langChart3 === 'de' ? ['Jan.', 'Feb.', 'Mär.', 'Apr.', 'Mai', 'Jun.', 'Jul.', 'Aug.', 'Sep.', 'Okt.', 'Nov.', 'Dez.']
      : ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    for (var d = 1; d <= daysInMonth; d++) {
      labels.push(d.toString().padStart(2, '0') + ' ' + monthNamesShort[targetMonth] + ' ' + (targetYear % 100).toString().padStart(2, '0'));
    }
    
    // Fixed canvas size matching OnlyFans (608x220)
    canvas.width = 608;
    canvas.height = 220;
    canvas.style.width = '608px';
    canvas.style.height = '220px';
    
    // Prepare chart data in same format as All time
    var chartData = {
      labels: labels,
      datasets: dailyCategories
    };
    
    // Store chartData on canvas for redraw when switching categories
    canvas._chartData = chartData;
    
    // Use same drawing function as All time chart
    drawMonthChartCanvas(canvas, chartData);
    
    canvas.setAttribute('data-chart-drawn', 'true');
  }
  
  // Apply monthly earnings to the page
  function applyMonthlyEarnings(stats) {
    // Find the container for month rows (b-stats-wrap)
    var container = document.querySelector('.b-stats-wrap');
    if (!container) {
      log('OF Stats: No .b-stats-wrap container found');
      return;
    }
    
    // Check if we already applied months to this container (prevents re-generation on page refresh)
    if (container.getAttribute('data-of-stats-months-applied')) {
      log('OF Stats: Monthly earnings already applied, skipping');
      return;
    }
    
    // Find "All time" row and collect all rows
    var allTimeRow = null;
    var existingMonthRows = [];
    var existingGeneratedRows = [];
    var allRows = container.querySelectorAll('.b-stats-row');
    
    allRows.forEach(function(row) {
      var monthEl = row.querySelector('.b-stats-row__month');
      if (monthEl) {
        if (isAllTimeText(monthEl.textContent)) {
          allTimeRow = row;
        } else if (row.getAttribute('data-of-stats-generated')) {
          // Our previously generated rows - collect for removal (tab navigation fix)
          existingGeneratedRows.push(row);
        } else {
          // Only collect non-generated original month rows for removal
          existingMonthRows.push(row);
        }
      }
    });
    
    // Remove ALL previously generated rows first (fixes duplicate bug on tab navigation)
    existingGeneratedRows.forEach(function(row) {
      row.remove();
    });
    log('OF Stats: Removed ' + existingGeneratedRows.length + ' previously generated month rows');
    
    // Use existing months data from stats if available, only generate if missing
    var monthsData;
    if (stats.months && stats.months.length > 0) {
      monthsData = stats.months;
      log('OF Stats: Using cached months data (' + monthsData.length + ' months)');
    } else {
      monthsData = generateMonthlyEarnings(stats.net);
      stats.months = monthsData;
      // Save updated stats with new months
      saveEarningStats(stats);
      log('OF Stats: Generated new months data (' + monthsData.length + ' months)');
    }
    
    // Remove ALL existing month rows (including previously generated ones)
    existingMonthRows.forEach(function(row) {
      row.remove();
    });
    
    // Mark container as processed to prevent re-generation
    container.setAttribute('data-of-stats-months-applied', 'true');
    
    log('OF Stats: Applying ' + monthsData.length + ' month rows');
    
    // Insert month rows after "All time" row
    var insertAfter = allTimeRow || container.firstChild;
    
    monthsData.forEach(function(monthData, index) {
      var rowEl = createMonthRowElement(monthData);
      if (insertAfter && insertAfter.nextSibling) {
        container.insertBefore(rowEl, insertAfter.nextSibling);
        insertAfter = rowEl;
      } else {
        container.appendChild(rowEl);
        insertAfter = rowEl;
      }
    });
  }
  
  // ============================================
  // STATISTICS/STATEMENTS/EARNINGS PAGE SUPPORT
  // ============================================
  
  // Check if we're on the statistics/statements/earnings page
  function isStatisticsEarningsPage() {
    return window.location.pathname === '/my/statistics/statements/earnings';
  }

  // Determine currently selected time period on statistics/statements/earnings page.
  // Returns: 'last30' | 'alltime' | 'other'
  // Detects the dropdown header text (e.g. "Last 30 days", "All time", etc.)
  function getSelectedStatisticsPeriod() {
    // The period dropdown on OF statistics page uses:
    // .b-sticky-position-dropdown > .dropdown > button.b-holder-options
    //   > div > .b-holder-options__title (contains "All time", "Last 30 days", etc.)
    var titleEl = document.querySelector('.b-holder-options__title');
    if (!titleEl) {
      // Fallback: try dropdown toggle button text
      titleEl = document.querySelector('.b-sticky-position-dropdown .dropdown-toggle, .b-holder-options');
    }
    if (!titleEl) {
      // Last fallback: scan page for known period text
      var candidates = document.querySelectorAll('.b-statistics-page-content__wrapper div, .b-statistics-page-content__wrapper button');
      for (var i = 0; i < Math.min(candidates.length, 60); i++) {
        var el = candidates[i];
        var elText = (el.textContent || '').trim();
        if (elText.length > 3 && elText.length < 30) {
          var lt = elText.toLowerCase();
          if (lt === 'all time' || lt === 'все время' || lt === 'за все время'
              || lt === 'todo el tiempo' || lt === 'gesamte zeit'
              || lt.indexOf('last') === 0 || lt.indexOf('послед') === 0
              || lt.indexOf('últim') === 0 || lt.indexOf('letzt') === 0) {
            titleEl = el;
            break;
          }
        }
      }
    }
    
    if (!titleEl) return 'last30'; // Default fallback
    
    var text = (titleEl.textContent || '').trim().toLowerCase();
    log('OF Stats: Period dropdown text: "' + text + '"');
    
    // Check for "All time" in various languages
    if (text.indexOf('all time') !== -1 
        || text.indexOf('все время') !== -1 || text.indexOf('за все время') !== -1
        || text.indexOf('todo el tiempo') !== -1 || text.indexOf('siempre') !== -1
        || text.indexOf('gesamte zeit') !== -1 || text.indexOf('gesamtzeitraum') !== -1
        || text.indexOf('alle zeiten') !== -1 || text.indexOf('immer') !== -1
        || isAllTimeText(text)) {
      return 'alltime';
    }
    
    // Check for "Last 30 days" in various languages
    if (text.indexOf('last 30') !== -1 || text.indexOf('últimos 30') !== -1 
        || text.indexOf('letzten 30') !== -1 || text.indexOf('последние 30') !== -1 
        || text.indexOf('30 дн') !== -1 || text.indexOf('30 day') !== -1
        || text.indexOf('30 día') !== -1 || text.indexOf('30 tag') !== -1) {
      return 'last30';
    }
    
    return 'other';
  }
  
  // Get transactions for statistics page - USES THE SAME DATA as /my/statements/earnings page
  // This ensures consistency between the two pages (users see the same nicknames/amounts)
  // If no Earnings counts configured, generates automatic transactions based on Gross value
  function getStatisticsTransactions(autoGenerateFromGross) {
    // Use the same data source as /my/statements/earnings (getOrGenerateEarningsData function)
    var pendingCount = 0;
    var completeCount = 0;
    
    if (cachedSettings) {
      pendingCount = parseInt(cachedSettings.earningsCount) || 0;
      completeCount = parseInt(cachedSettings.earningsCompleteCount) || 0;
    }
    
    // If no counts configured but autoGenerateFromGross is true, generate automatic transactions
    if (pendingCount === 0 && completeCount === 0) {
      if (autoGenerateFromGross) {
        // Auto-generate transactions based on Gross value from /my/stats/earnings data
        return generateAutoTransactionsForStatistics();
      }
      log('OF Stats: No earnings counts configured, returning empty transactions');
      return [];
    }
    
    // Get/generate the same transactions as /my/statements/earnings page
    var allTransactions = getOrGenerateEarningsData(pendingCount, completeCount);
    
    // Filter to only include transactions from last 30 days for the chart display
    var now = new Date();
    var thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    var filteredTransactions = allTransactions.filter(function(t) {
      return t.date >= thirtyDaysAgo;
    });
    
    log('OF Stats: Statistics page using same data as earnings page - ' + filteredTransactions.length + ' transactions from last 30 days (total: ' + allTransactions.length + ')');
    return filteredTransactions;
  }
  
  // Generate automatic transactions for statistics page when no Earnings counts are configured
  // Uses the Gross value from /my/stats/earnings data
  function generateAutoTransactionsForStatistics() {
    var cacheKey = 'ofStatsAutoTransactionsData';
    var grossKey = 'ofStatsAutoTransactionsGross';
    
    // Get Gross value from earning stats
    var earningStats = getOrGenerateEarningStatsEarly();
    if (!earningStats) {
      log('OF Stats: No earning stats available for auto-generating transactions');
      return [];
    }
    
    var months = earningStats.months || [];
    var totalGross = calculateGrossFromMonths(months);
    var roundedGross = Math.round(totalGross * 100) / 100;
    
    // Check cache - if Gross hasn't changed, use cached transactions
    try {
      var cachedGross = localStorage.getItem(grossKey);
      var cachedData = localStorage.getItem(cacheKey);
      
      if (cachedGross && cachedData) {
        var cachedGrossRounded = Math.round(parseFloat(cachedGross) * 100) / 100;
        if (cachedGrossRounded === roundedGross) {
          var parsed = JSON.parse(cachedData);
          // Restore Date objects
          for (var i = 0; i < parsed.length; i++) {
            parsed[i].date = new Date(parsed[i].date);
          }
          log('OF Stats: Using cached auto-transactions (' + parsed.length + ' transactions, Gross: $' + roundedGross.toFixed(2) + ')');
          return parsed;
        }
      }
    } catch(e) {}
    
    log('OF Stats: Generating auto-transactions from Gross value $' + roundedGross.toFixed(2));
    
    // Calculate how many transactions to generate based on Gross
    // Average transaction ~$25-50, so count = Gross / avgAmount
    var avgTransactionAmount = 30 + Math.random() * 20; // $30-50
    var transactionCount = Math.max(10, Math.round(totalGross / avgTransactionAmount));
    transactionCount = Math.min(transactionCount, 200); // Cap at 200 transactions
    
    // Split into pending (30%) and complete (70%) - last 30 days
    var pendingCount = Math.round(transactionCount * 0.3);
    var completeCount = transactionCount - pendingCount;
    
    // Generate transactions
    var generated = [];
    var now = new Date();
    
    // Generate pending transactions (last 7 days)
    for (var p = 0; p < pendingCount; p++) {
      var pendingDaysAgo = Math.floor(Math.random() * 7); // 0-6 days ago
      var transDatePending = new Date(now);
      transDatePending.setDate(transDatePending.getDate() - pendingDaysAgo);
      transDatePending.setHours(Math.floor(Math.random() * 24), Math.floor(Math.random() * 60), Math.floor(Math.random() * 60), 0);
      
      var amountPending = earningsGenerateAmount();
      generated.push({
        date: transDatePending,
        amount: amountPending,
        fee: amountPending * 0.20,
        net: amountPending * 0.80,
        type: Math.random() < 0.70 ? 'payment' : 'tip',
        username: earningsGenerateUsername(),
        userId: 'u' + Math.floor(Math.random() * 900000000 + 100000000),
        status: 'pending'
      });
    }
    
    // Generate complete transactions (8-30 days ago)
    for (var c = 0; c < completeCount; c++) {
      var completeDaysAgo = 8 + Math.floor(Math.random() * 22); // 8-29 days ago
      var transDateComplete = new Date(now);
      transDateComplete.setDate(transDateComplete.getDate() - completeDaysAgo);
      transDateComplete.setHours(Math.floor(Math.random() * 24), Math.floor(Math.random() * 60), Math.floor(Math.random() * 60), 0);
      
      var amountComplete = earningsGenerateAmount();
      var statusComplete = Math.random() < 0.02 ? 'reversed' : 'complete';
      
      generated.push({
        date: transDateComplete,
        amount: amountComplete,
        fee: amountComplete * 0.20,
        net: amountComplete * 0.80,
        type: Math.random() < 0.70 ? 'payment' : 'tip',
        username: earningsGenerateUsername(),
        userId: 'u' + Math.floor(Math.random() * 900000000 + 100000000),
        status: statusComplete
      });
    }
    
    // Sort by date descending
    generated.sort(function(a, b) { return b.date - a.date; });
    
    // Save to cache
    try {
      localStorage.setItem(grossKey, roundedGross.toString());
      localStorage.setItem(cacheKey, JSON.stringify(generated));
    } catch(e) {}
    
    log('OF Stats: Generated ' + generated.length + ' auto-transactions for statistics page');
    return generated;
  }
  
  // Apply statistics/statements/earnings page content
  function applyStatisticsEarningsPage() {
    if (!isStatisticsEarningsPage()) return;
    
    // Check if chart generation is disabled (user clicked Reset)
    try {
      if (localStorage.getItem('ofStatsStatisticsChartDisabled') === 'true') {
        log('OF Stats: Statistics chart generation disabled (after Reset). Showing original content.');
        // Remove any hiding styles to show original content
        var hideStyle = document.getElementById('of-stats-hide-earnings-content');
        if (hideStyle) hideStyle.remove();
        
        // Stop the observer that hides original elements
        stopOriginalElementsObserver();
        
        // Also remove any already generated elements (in case they were created before flag was set)
        var wrapper = document.querySelector('.b-statistics-page-content__wrapper');
        if (wrapper) {
          // Destroy Chart.js instances before removing canvas elements
          if (typeof Chart !== 'undefined') {
            var mainCanvas = document.getElementById('of-stats-earnings-chart-main');
            var asideCanvas = document.getElementById('of-stats-earnings-chart-aside');
            if (mainCanvas) {
              var mainChart = Chart.getChart(mainCanvas);
              if (mainChart) mainChart.destroy();
            }
            if (asideCanvas) {
              var asideChart = Chart.getChart(asideCanvas);
              if (asideChart) asideChart.destroy();
            }
            document.querySelectorAll('canvas[id^="of-stats-mini-chart-"]').forEach(function(canvas) {
              var chart = Chart.getChart(canvas);
              if (chart) chart.destroy();
            });
          }
          wrapper.querySelectorAll('[data-of-stats-generated]').forEach(function(el) {
            el.remove();
          });
          wrapper.removeAttribute('data-of-stats-applied');
          
          // Restore visibility of original hidden elements
          wrapper.querySelectorAll('[data-of-stats-original-hidden]').forEach(function(el) {
            el.removeAttribute('data-of-stats-original-hidden');
            el.style.display = '';
          });
        }
        // Reset Earnings section processed flag to show original
        document.querySelectorAll('.b-useful-data[data-of-stats-processed]').forEach(function(el) {
          el.removeAttribute('data-of-stats-processed');
        });
        document.querySelectorAll('[data-of-stats-earnings-generated]').forEach(function(el) {
          el.remove();
        });
        return;
      }
    } catch(e) {}
    
    // Check if earnings counts are configured in the plugin
    var pendingCount = 0;
    var completeCount = 0;
    if (cachedSettings) {
      pendingCount = parseInt(cachedSettings.earningsCount) || 0;
      completeCount = parseInt(cachedSettings.earningsCompleteCount) || 0;
    }
    
    // Even if no counts configured, we still generate data automatically from /my/stats/earnings
    var hasEarningsCounts = (pendingCount > 0 || completeCount > 0);
    // Store globally so observer can check this
    window.ofStatsHasEarningsCounts = hasEarningsCounts;
    
    var wrapper = document.querySelector('.b-statistics-page-content__wrapper');
    if (!wrapper) return;
    
    // Check if already applied
    if (wrapper.getAttribute('data-of-stats-applied')) {
      var hasMain = wrapper.querySelector('#of-stats-earnings-chart-main');
      var hasAside = wrapper.querySelector('#of-stats-earnings-chart-aside');
      var hasCombined = wrapper.querySelector('#of-stats-earnings-chart-combined');
      if (!hasMain || !hasAside || hasCombined) {
        // Remove old generated elements so we can re-apply
        wrapper.querySelectorAll('[data-of-stats-generated]').forEach(function(el) {
          el.remove();
        });
        if (hasCombined) {
          var oldChart = hasCombined.closest('.b-chart');
          if (oldChart) oldChart.remove();
        }
        wrapper.removeAttribute('data-of-stats-applied');
      } else {
        return;
      }
    }
    wrapper.setAttribute('data-of-stats-applied', 'true');
    
    // Determine currently selected period
    var selectedPeriod = getSelectedStatisticsPeriod();
    log('OF Stats: Selected statistics period: ' + selectedPeriod);
    // Store globally for observer
    window.ofStatsCurrentPeriod = selectedPeriod;
    
    // For periods other than last30/alltime — show native content as-is
    if (selectedPeriod === 'other') {
      // Restore any previously hidden native elements
      wrapper.querySelectorAll('[data-of-stats-original-hidden]').forEach(function(el) {
        el.removeAttribute('data-of-stats-original-hidden');
        el.style.display = '';
      });
      document.querySelectorAll('.b-useful-data[data-of-stats-processed]').forEach(function(el) {
        el.removeAttribute('data-of-stats-processed');
      });
      document.querySelectorAll('[data-of-stats-earnings-generated]').forEach(function(el) {
        el.remove();
      });
      log('OF Stats: Period is "other" — showing native content');
      startOriginalElementsObserver();
      return;
    }
    
    // Hide/remove original elements that we're replacing (charts, summary)
    // Mark them with attribute so CSS can hide them reliably
    wrapper.querySelectorAll('.b-elements-determinant:not([data-of-stats-generated])').forEach(function(el) {
      el.setAttribute('data-of-stats-original-hidden', 'true');
      el.style.display = 'none';
    });
    wrapper.querySelectorAll('.b-chart:not([data-of-stats-generated])').forEach(function(el) {
      el.setAttribute('data-of-stats-original-hidden', 'true');
      el.style.display = 'none';
    });
    // Only hide original transactions table if earnings counts are set
    if (hasEarningsCounts) {
      wrapper.querySelectorAll('.b-separate-section:not([data-of-stats-generated])').forEach(function(el) {
        el.setAttribute('data-of-stats-original-hidden', 'true');
        el.style.display = 'none';
      });
    }
    
    log('OF Stats: Applying statistics/statements/earnings page (period: ' + selectedPeriod + ')');
    
    // Get monthly data from /my/stats/earnings to calculate Gross and % change
    var earningStats = getOrGenerateEarningStatsEarly();
    var months = earningStats ? earningStats.months : null;
    
    log('OF Stats Debug: earningStats=' + (earningStats ? 'exists' : 'null') + ', months=' + (months ? months.length + ' items' : 'null'));
    
    // Get balances from settings
    var currentBalance = getCurrentBalanceValue();
    
    // Calculate Gross/Net based on selected period
    var totalGross;
    if (selectedPeriod === 'alltime' && earningStats && earningStats.gross) {
      // All Time — use total Gross from /my/stats/earnings data
      totalGross = earningStats.gross;
      log('OF Stats: Using All Time Gross from earningStats: $' + totalGross.toFixed(2));
    } else {
      // Last 30 days — average of 2 most recent months
      totalGross = calculateGrossFromMonths(months);
    }
    
    log('OF Stats Debug: totalGross=' + totalGross + ', currentBalance=' + currentBalance);
    var totalNet;
    if (selectedPeriod === 'alltime' && earningStats && earningStats.net) {
      totalNet = earningStats.net;
    } else {
      totalNet = totalGross * 0.8;
    }
    
    // Calculate percentage change from comparing current and previous month
    var percentChange = calculateMonthlyPercentageChange(months);
    
    // Get transactions - SAME DATA as /my/statements/earnings page, or auto-generate if no counts set
    // Pass true to enable auto-generation from Gross when no Earnings counts configured
    var transactions = getStatisticsTransactions(true);
    
    // Build percentage change display with correct icon (increase/decrease)
    var percentIcon = percentChange.isIncrease ? 'icon-increase' : 'icon-decrease';
    var percentClass = percentChange.isIncrease ? 'm-level-up' : 'm-level-down';
    var percentValue = percentChange.value.toFixed(1);
    
    // Create the summary display with Net/Gross and calculated % change
    var summaryDiv = document.createElement('div');
    summaryDiv.className = 'b-elements-determinant mb-0';
    summaryDiv.setAttribute('data-of-stats-generated', 'true');
    summaryDiv.innerHTML = '<div class="b-elements-determinant__value m-inline">' +
      '<span class=""> $' + formatCurrency(totalNet) + ' </span>' +
      '<div class="g-gray-text b-statistics-level__text"> (<span id="of-stats-gross-clickable" style="cursor:pointer;"> $' + formatCurrency(totalGross) + ' </span> ' + getLocalizedGrossLabel() + ') </div>' +
      '<span class="b-statistics-level ' + percentClass + '"><svg data-icon-name="' + percentIcon + '" aria-hidden="true" class="g-icon"><use href="#' + percentIcon + '" xlink:href="#' + percentIcon + '"></use></svg> ' + percentValue + '% </span>' +
      '</div>';
    
    // Create charts container - two canvases like original
    var chartDiv = document.createElement('div');
    chartDiv.className = 'b-chart b-chart--no-padding';
    chartDiv.setAttribute('data-of-stats-generated', 'true');
    chartDiv.style.marginTop = '5px';
    chartDiv.innerHTML = '<div class="b-chart__wrapper" style="position: relative; width: 100%;">' +
      '<canvas height="196" class="b-chart__double-line__main" style="display: block; box-sizing: border-box; height: 112px; width: 100%;" id="of-stats-earnings-chart-main"></canvas>' +
      '<div class="b-chart__tooltip of-stats-tooltip" id="of-stats-chart-tooltip" style="opacity: 0; left: 0px; top: 4.5px; width: 156px;">' +
        '<div class="b-chart__tooltip__title">&nbsp;</div>' +
        '<div class="b-chart__tooltip__text">' +
          '<div class="b-chart__tooltip__circle" style="background: rgb(0, 175, 240);"></div>' +
          '<div class="b-chart__tooltip__text__title"> ' + (getPageLanguage() === 'ru' ? 'Заработок' : getPageLanguage() === 'es' ? 'Ganancias' : getPageLanguage() === 'de' ? 'Verdienst' : 'Earnings') + ' </div>' +
          '<div class="b-chart__tooltip__text__value"> $0.00 </div>' +
        '</div>' +
        '<div class="b-chart__tooltip__text">' +
          '<div class="b-chart__tooltip__circle" style="background: rgb(138, 150, 163);"></div>' +
          '<div class="b-chart__tooltip__text__title"> ' + (getPageLanguage() === 'ru' ? 'Транзакции' : getPageLanguage() === 'es' ? 'Transacciones' : getPageLanguage() === 'de' ? 'Transaktionen' : 'Transactions') + ' </div>' +
          '<div class="b-chart__tooltip__text__value"> 0 </div>' +
        '</div>' +
      '</div>' +
      '</div>' +
      '<div class="b-chart__wrapper" style="position: relative; width: 100%;">' +
      '<canvas height="160" class="b-chart__double-line__aside" style="display: block; box-sizing: border-box; height: 90px; width: 100%;" id="of-stats-earnings-chart-aside"></canvas>' +
      '</div>';
    
    // Create transactions table only if earnings counts are set
    var tableDiv = null;
    if (hasEarningsCounts) {
      tableDiv = document.createElement('div');
      tableDiv.className = 'b-separate-section g-negative-sides-gaps g-sides-gaps';
      tableDiv.setAttribute('data-of-stats-generated', 'true');
    
      var langTable = getPageLanguage();
      var tableHTML = '<table cellspacing="0" cellpadding="0" border="0" class="b-table m-responsive m-compact-view-mode m-default-table b-statements-table">' +
        '<thead><tr><th class="m-width-statements"> ' + (langTable === 'ru' ? 'Дата' : langTable === 'es' ? 'Fecha' : langTable === 'de' ? 'Datum' : 'Date') + ' </th><th class="text-right"> ' + (langTable === 'ru' ? 'Сумма' : langTable === 'es' ? 'Monto' : langTable === 'de' ? 'Betrag' : 'Amount') + ' </th><th class="text-right"> ' + (langTable === 'ru' ? 'Сбор' : langTable === 'es' ? 'Tarifa' : langTable === 'de' ? 'Gebühr' : 'Fee') + ' </th><th class="text-right"> ' + (langTable === 'ru' ? 'Чистая' : langTable === 'es' ? 'Neto' : langTable === 'de' ? 'Netto' : 'Net') + ' </th></tr></thead>' +
      '<tbody>';
    
    var months = langTable === 'ru'
      ? ['янв.', 'февр.', 'март', 'апр.', 'май', 'июнь', 'июль', 'авг.', 'сент.', 'окт.', 'нояб.', 'дек.']
      : langTable === 'es'
      ? ['ene.', 'feb.', 'mar.', 'abr.', 'may.', 'jun.', 'jul.', 'ago.', 'sep.', 'oct.', 'nov.', 'dic.']
      : langTable === 'de'
      ? ['Jan.', 'Feb.', 'Mär.', 'Apr.', 'Mai', 'Jun.', 'Jul.', 'Aug.', 'Sep.', 'Okt.', 'Nov.', 'Dez.']
      : ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    
    transactions.forEach(function(t) {
      var dateStr = months[t.date.getMonth()] + ' ' + t.date.getDate() + ', ' + t.date.getFullYear() + ',';
      var hours = t.date.getHours();
      var minutes = t.date.getMinutes().toString().padStart(2, '0');
      var ampm = hours >= 12 ? 'pm' : 'am';
      hours = hours % 12 || 12;
      var timeStr = hours + ':' + minutes + ' ' + ampm;
      
      var description = t.type === 'tip' 
        ? (langTable === 'ru' ? 'Чаевые от' : langTable === 'es' ? 'Propina de' : langTable === 'de' ? 'Trinkgeld von' : 'Tip from') + ' <a href="https://onlyfans.com/' + t.userId + '">' + t.username + '</a>'
        : (langTable === 'ru' ? 'Оплата за сообщение от' : langTable === 'es' ? 'Pago por mensaje de' : langTable === 'de' ? 'Zahlung für Nachricht von' : 'Payment for message from') + ' <a href="https://onlyfans.com/' + t.userId + '">' + t.username + '</a>';
      
      // Use the status from the transaction data (same as /my/statements/earnings)
      var status = t.status || 'pending';
      var iconName, statusText;
      
      if (status === 'complete') {
        iconName = 'icon-done';
        statusText = langTable === 'ru' ? 'Завершить' : langTable === 'es' ? 'Completado' : langTable === 'de' ? 'Abgeschlossen' : 'Complete';
      } else if (status === 'reversed') {
        iconName = 'icon-undo';
        statusText = langTable === 'ru' ? 'Перевернутый' : langTable === 'es' ? 'Revertido' : langTable === 'de' ? 'Storniert' : 'Reversed';
      } else {
        // pending - calculate days remaining (max 6 days)
        var now = new Date();
        now.setHours(0, 0, 0, 0);
        var transDateNorm = new Date(t.date);
        transDateNorm.setHours(0, 0, 0, 0);
        var daysSince = Math.floor((now - transDateNorm) / (1000 * 60 * 60 * 24));
        var daysRemaining = Math.max(1, 6 - daysSince);
        iconName = 'icon-loading';
        if (langTable === 'ru') {
          statusText = 'Заработок станет доступен в ' + daysRemaining + ' течение нескольких дней';
        } else if (langTable === 'es') {
          statusText = 'Las ganancias estarán disponibles en ' + daysRemaining + ' día' + (daysRemaining !== 1 ? 's' : '');
        } else if (langTable === 'de') {
          statusText = 'Einnahmen verfügbar in ' + daysRemaining + ' Tag' + (daysRemaining !== 1 ? 'en' : '');
        } else {
          statusText = 'Earning will become available in ' + daysRemaining + ' day' + (daysRemaining !== 1 ? 's' : '');
        }
      }
      
      tableHTML += '<tr class="m-responsive__reset-pb">' +
        '<td class="m-responsive__before-line-over m-width-statements"><strong><span class="d-inline-block">' + dateStr + '</span><span class="d-inline-block">' + timeStr + '</span></strong></td>' +
        '<td class="m-responsive__before-line-over"><span class=""> $' + t.amount.toFixed(2) + ' </span></td>' +
        '<td class="m-responsive__before-line-over"><span class=""> $' + t.fee.toFixed(2) + ' </span></td>' +
        '<td class="m-responsive__before-line-over m-last-in-row"><strong><span class=""> $' + t.net.toFixed(2) + ' </span></strong></td>' +
        '<td class="m-responsive__border-line__over text-left"><span class="b-statements-text-table">' + description + '</span>' +
        '<div class="b-table-group-btns"><span tabindex="0" class="b-table__status-tip" data-tooltip-text="' + statusText + '">' +
        '<svg class="g-icon" data-icon-name="' + iconName + '" aria-hidden="true"><use href="#' + iconName + '" xlink:href="#' + iconName + '"></use></svg></span></div></td>' +
        '</tr>';
    });
    
      tableHTML += '</tbody></table>';
      tableDiv.innerHTML = tableHTML;
    }
    
    // Find and hide "No data during selected period" text
    var noDataEl = wrapper.querySelector('.b-elements-determinant, .g-gray-text');
    if (!noDataEl) {
      // Try to find any text node with "No data"
      var textNodes = wrapper.querySelectorAll('*');
      textNodes.forEach(function(el) {
        if (el.textContent && el.textContent.includes('No data during selected period')) {
          el.style.display = 'none';
        }
      });
    }
    
    // Find the category tabs (All, Subscriptions, Tips, etc.) and insert after them
    var tabsNav = wrapper.querySelector('.b-tabs__nav');
    if (tabsNav) {
      // Insert summary after tabs
      tabsNav.parentNode.insertBefore(summaryDiv, tabsNav.nextSibling);
      // Insert charts after summary
      summaryDiv.parentNode.insertBefore(chartDiv, summaryDiv.nextSibling);
      // Insert table after charts (only if created)
      if (tableDiv) {
        chartDiv.parentNode.insertBefore(tableDiv, chartDiv.nextSibling);
      }
    } else {
      // Fallback: prepend to wrapper
      if (tableDiv) {
        wrapper.prepend(tableDiv);
      }
      wrapper.prepend(chartDiv);
      wrapper.prepend(summaryDiv);
    }
    
    // Generate Earnings breakdown (Total, Tips, Messages) with caching (tied to Gross)
    // Pass the already calculated percentChange to ensure consistency
    var earningsBreakdown = getOrGenerateEarningsBreakdown(totalNet, totalGross, percentChange);
    
    // Find original Earnings section by header text and replace its content
    // This works on all page types (with data or "No earnings for this period")
    function findAndReplaceEarningsSection() {
      var allUsefulData = document.querySelectorAll('.b-useful-data');
      var originalEarningsSection = null;
      
      allUsefulData.forEach(function(section) {
        // Skip already processed sections
        if (section.hasAttribute('data-of-stats-processed')) return;
        
        var header = section.querySelector('.b-useful-data__header');
        if (header) {
          var hText = header.textContent.trim();
          if (hText === 'Earnings' || hText === 'Заработок' || hText === 'Ganancias' || hText === 'Provision') {
            originalEarningsSection = section;
          }
        }
      });
      
      if (originalEarningsSection) {
        // Mark as processed
        originalEarningsSection.setAttribute('data-of-stats-processed', 'true');
        
        // Hide all native children except header (don't remove — Vue would re-create them)
        var children = Array.from(originalEarningsSection.children);
        children.forEach(function(child) {
          if (!child.classList.contains('b-useful-data__header') && !child.hasAttribute('data-of-stats-earnings-generated')) {
            child.style.display = 'none';
            child.setAttribute('data-of-stats-original-hidden', 'true');
          }
        });
        
        // Only add our content if not already added
        if (!originalEarningsSection.querySelector('[data-of-stats-earnings-generated]')) {
          var contentWrapper = document.createElement('div');
          contentWrapper.className = 'b-statistics-columns m-separate-block m-rows-items';
          contentWrapper.setAttribute('data-of-stats-earnings-generated', 'true');
          contentWrapper.innerHTML = generateEarningsRowsHTML(earningsBreakdown);
          originalEarningsSection.appendChild(contentWrapper);
        }
        
        log('OF Stats: Replaced Earnings section content');
        
        // Draw mini charts
        setTimeout(function() {
          if (earningsBreakdown.miniCharts) {
            drawMiniChartsDirectly(earningsBreakdown.miniCharts);
          }
        }, 200);
        
        return true;
      }
      return false;
    }
    
    // Try to find and replace now
    if (!findAndReplaceEarningsSection()) {
      // If not found, observe for it
      var earningsObserver = new MutationObserver(function(mutations) {
        if (findAndReplaceEarningsSection()) {
          earningsObserver.disconnect();
        }
      });
      earningsObserver.observe(document.body, { childList: true, subtree: true });
      
      // Timeout to stop observing after 10 seconds
      setTimeout(function() {
        earningsObserver.disconnect();
      }, 10000);
    }
    
    // Store chart params for Gross click regeneration
    window.ofStatsLastChartParams = {
      transactions: transactions,
      grossValue: totalGross,
      earningsBreakdown: earningsBreakdown
    };
    
    // Load Chart.js and draw charts (pass grossValue for caching)
    loadChartJsAndDraw(transactions, totalGross, earningsBreakdown);
    
    // Attach click handler to Gross value for chart regeneration
    setTimeout(function() {
      var grossEl = document.getElementById('of-stats-gross-clickable');
      if (grossEl && !grossEl.getAttribute('data-of-stats-click-bound')) {
        grossEl.setAttribute('data-of-stats-click-bound', 'true');
        grossEl.addEventListener('click', function() {
          log('OF Stats: Gross clicked — full regeneration');
          // Clear chart cache to force new random data
          try {
            localStorage.removeItem('ofStatsChartDataCache');
            localStorage.removeItem('ofStatsEarningsBreakdownCache');
          } catch(e) {}
          // Destroy existing Chart.js instances
          if (typeof Chart !== 'undefined') {
            var mc = document.getElementById('of-stats-earnings-chart-main');
            var ac = document.getElementById('of-stats-earnings-chart-aside');
            if (mc) { var c = Chart.getChart(mc); if (c) c.destroy(); }
            if (ac) { var c2 = Chart.getChart(ac); if (c2) c2.destroy(); }
            document.querySelectorAll('canvas[id^="of-stats-mini-chart-"]').forEach(function(canvas) {
              var ch = Chart.getChart(canvas); if (ch) ch.destroy();
            });
          }
          // Full cleanup — remove all generated elements and re-apply from scratch
          var w = document.querySelector('.b-statistics-page-content__wrapper');
          if (w) {
            w.querySelectorAll('[data-of-stats-generated]').forEach(function(el) { el.remove(); });
            w.querySelectorAll('[data-of-stats-original-hidden]').forEach(function(el) {
              el.removeAttribute('data-of-stats-original-hidden');
              el.style.display = '';
            });
            document.querySelectorAll('.b-useful-data[data-of-stats-processed]').forEach(function(el) {
              el.removeAttribute('data-of-stats-processed');
            });
            document.querySelectorAll('[data-of-stats-earnings-generated]').forEach(function(el) {
              el.remove();
            });
            w.removeAttribute('data-of-stats-applied');
          }
          applyStatisticsEarningsPage();
        });
      }
    }, 100);
    
    // Init tooltips for status icons
    initStatusTooltips();
    
    log('OF Stats: Statistics earnings page applied with', transactions.length, 'transactions');
    
    // Start/restart the global observer for hiding original elements
    // This observer watches document.body to catch all dynamically loaded content
    startOriginalElementsObserver();
  }
  
  // Global observer for hiding original elements on statistics/statements/earnings page
  function startOriginalElementsObserver() {
    // Don't start if already running
    if (window.ofStatsOriginalElementsObserver) return;
    
    // Check if disabled
    try {
      if (localStorage.getItem('ofStatsStatisticsChartDisabled') === 'true') return;
    } catch(e) {}
    
    window.ofStatsOriginalElementsObserver = new MutationObserver(function(mutations) {
      // Check if disabled flag is set
      try {
        if (localStorage.getItem('ofStatsStatisticsChartDisabled') === 'true') {
          stopOriginalElementsObserver();
          return;
        }
      } catch(e) {}
      
      // Only process if on the right page
      if (!isStatisticsEarningsPage()) return;
      
      var wrapper = document.querySelector('.b-statistics-page-content__wrapper');
      if (!wrapper) return;
      
      // --- Hide original elements ---
      var currentPeriod = window.ofStatsCurrentPeriod || 'last30';
      if (currentPeriod === 'other') return;
      
      // Hide any original elements (those without our generated attribute)
      var hiddenCount = 0;
      wrapper.querySelectorAll('.b-elements-determinant:not([data-of-stats-generated]):not([data-of-stats-original-hidden])').forEach(function(el) {
        el.setAttribute('data-of-stats-original-hidden', 'true');
        el.style.display = 'none';
        hiddenCount++;
      });
      wrapper.querySelectorAll('.b-chart:not([data-of-stats-generated]):not([data-of-stats-original-hidden])').forEach(function(el) {
        el.setAttribute('data-of-stats-original-hidden', 'true');
        el.style.display = 'none';
        hiddenCount++;
      });
      // Only hide original transactions table if earnings counts are set
      if (window.ofStatsHasEarningsCounts) {
        wrapper.querySelectorAll('.b-separate-section:not([data-of-stats-generated]):not([data-of-stats-original-hidden])').forEach(function(el) {
          el.setAttribute('data-of-stats-original-hidden', 'true');
          el.style.display = 'none';
          hiddenCount++;
        });
      }
      
      if (hiddenCount > 0) {
        log('OF Stats: Hidden ' + hiddenCount + ' original elements');
      }
    });
    
    // Observe document.body to catch all changes including SPA navigation
    window.ofStatsOriginalElementsObserver.observe(document.body, { childList: true, subtree: true });
    log('OF Stats: Started original elements observer');
    
    // Also start dropdown click listener for immediate period detection
    startDropdownClickListener();
  }
  
  // Stop the global observer
  function stopOriginalElementsObserver() {
    if (window.ofStatsOriginalElementsObserver) {
      window.ofStatsOriginalElementsObserver.disconnect();
      window.ofStatsOriginalElementsObserver = null;
      log('OF Stats: Stopped original elements observer');
    }
  }
  
  // Listen for dropdown clicks to immediately detect period changes
  function startDropdownClickListener() {
    if (window.ofStatsDropdownClickListener) return;
    
    window.ofStatsDropdownClickListener = function(e) {
      if (!isStatisticsEarningsPage()) return;
      
      // Check if click is on or inside the period dropdown area
      var dropdownArea = e.target.closest('.b-sticky-position-dropdown, .b-holder-options, .dropdown-menu, .dropdown-item, .b-holder-options__title, .dropdown');
      if (!dropdownArea) return;
      
      // After dropdown item click, check period change with short delays (multiple checks)
      var delays = [150, 400, 800];
      delays.forEach(function(delay) {
        setTimeout(function() {
          var appliedPeriod = window.ofStatsCurrentPeriod || 'last30';
          var newPeriod = getSelectedStatisticsPeriod();
          if (newPeriod !== appliedPeriod) {
            log('OF Stats: Dropdown click detected period change: ' + appliedPeriod + ' -> ' + newPeriod);
            var wrapper = document.querySelector('.b-statistics-page-content__wrapper');
            if (wrapper) {
              wrapper.querySelectorAll('[data-of-stats-generated]').forEach(function(el) { el.remove(); });
              wrapper.querySelectorAll('[data-of-stats-original-hidden]').forEach(function(el) {
                el.removeAttribute('data-of-stats-original-hidden');
                el.style.display = '';
              });
              document.querySelectorAll('.b-useful-data[data-of-stats-processed]').forEach(function(el) {
                el.removeAttribute('data-of-stats-processed');
              });
              document.querySelectorAll('[data-of-stats-earnings-generated]').forEach(function(el) {
                el.remove();
              });
              wrapper.removeAttribute('data-of-stats-applied');
              try {
                localStorage.removeItem('ofStatsChartDataCache');
                localStorage.removeItem('ofStatsEarningsBreakdownCache');
              } catch(e) {}
              applyStatisticsEarningsPage();
            }
          }
        }, delay);
      });
    };
    
    document.addEventListener('click', window.ofStatsDropdownClickListener, true);
    log('OF Stats: Started dropdown click listener');
  }
  
  // Export function to window for content.js to call after Apply Changes
  // forceRegenerate=true means user explicitly clicked Apply and wants fresh data
  window.ofStatsApplyStatisticsEarningsPage = function(newSettings, forceRegenerate) {
    // Only clear the statistics chart disabled flag when user explicitly clicked Apply
    // Don't clear on auto-apply (page load) - let user control when to re-enable
    if (forceRegenerate) {
      try {
        localStorage.removeItem('ofStatsStatisticsChartDisabled');
        log('OF Stats: Cleared statistics chart disabled flag (Apply Changes with forceRegenerate)');
      } catch(e) {}
    } else {
      // Check if chart generation is disabled (user clicked Reset) - don't generate if disabled
      try {
        if (localStorage.getItem('ofStatsStatisticsChartDisabled') === 'true') {
          log('OF Stats: Statistics chart generation disabled (skipping auto-apply)');
          return;
        }
      } catch(e) {}
    }
    
    // Update cachedSettings with new values
    if (newSettings) {
      cachedSettings = newSettings;
      
      // Only clear chart caches if explicitly requested (user clicked Apply button)
      // Don't clear on auto-apply (F5 reload) to preserve cached chart data
      if (forceRegenerate) {
        try {
          localStorage.removeItem('ofStatsChartDataCache');
          localStorage.removeItem('ofStatsChartGrossValue');
          localStorage.removeItem('ofStatsEarningsBreakdownCache');
          // Also clear auto-transactions cache
          localStorage.removeItem('ofStatsAutoTransactionsData');
          localStorage.removeItem('ofStatsAutoTransactionsGross');
          log('OF Stats: Cleared chart caches for Apply Changes (forceRegenerate=true)');
        } catch(e) {}
      } else {
        log('OF Stats: Preserving chart caches (forceRegenerate=false)');
      }
    } else {
      // Re-read from localStorage
      try {
        const cached = localStorage.getItem('ofStatsCache');
        if (cached) {
          cachedSettings = JSON.parse(cached);
        }
      } catch(e) {}
    }
    
    // Reset the applied flag so we can re-apply
    var wrapper = document.querySelector('.b-statistics-page-content__wrapper');
    if (wrapper) {
      // Remove old generated elements
      wrapper.querySelectorAll('[data-of-stats-generated]').forEach(function(el) {
        el.remove();
      });
      wrapper.removeAttribute('data-of-stats-applied');
    }
    
    // Also reset Earnings section processed flag
    document.querySelectorAll('.b-useful-data[data-of-stats-processed]').forEach(function(el) {
      el.removeAttribute('data-of-stats-processed');
    });
    document.querySelectorAll('[data-of-stats-earnings-generated]').forEach(function(el) {
      el.remove();
    });
    
    // Remove hiding style if present
    var hideStyle = document.getElementById('of-stats-hide-earnings-content');
    if (hideStyle) hideStyle.remove();
    
    // Apply the page
    applyStatisticsEarningsPage();
  };

  // Get or generate Earnings breakdown (Total, Tips, Messages) with caching
  // Cache is tied to Gross value so it updates when Gross changes
  // percentChange is the already calculated change from the main display
  function getOrGenerateEarningsBreakdown(totalNet, totalGross, percentChange) {
    var cacheKey = 'ofStatsEarningsBreakdownCache';
    var grossKey = 'ofStatsChartGrossValue'; // Use same key as charts!
    
    // Round values for stable comparison
    var roundedNet = Math.round(totalNet * 100) / 100;
    var roundedGross = Math.round(totalGross * 100) / 100;
    
    try {
      var cachedData = localStorage.getItem(cacheKey);
      var cachedGross = localStorage.getItem(grossKey);
      
      // Use cache if Gross hasn't changed (same key as main charts)
      if (cachedData && cachedGross) {
        var cachedGrossRounded = Math.round(parseFloat(cachedGross) * 100) / 100;
        if (cachedGrossRounded === roundedGross) {
          var parsed = JSON.parse(cachedData);
          // Verify cached data has correct Total (matches current Net)
          if (parsed.total && Math.round(parsed.total.amount * 100) / 100 === roundedNet) {
            log('OF Stats: Using cached Earnings breakdown (Gross unchanged: $' + roundedGross.toFixed(2) + ')');
            return parsed;
          }
        }
      }
    } catch (e) {
      log('OF Stats: Cannot access localStorage for earnings breakdown cache');
    }
    
    log('OF Stats: Generating new Earnings breakdown for Net $' + roundedNet.toFixed(2) + ' (Gross: $' + roundedGross.toFixed(2) + ')');
    
    // Generate random split between Tips and Messages (40%-60% each way)
    var tipsPercent = 0.40 + Math.random() * 0.20; // 40% to 60%
    var tipsAmount = totalNet * tipsPercent;
    var messagesAmount = totalNet - tipsAmount;
    
    // Use the passed percentChange for Total, add variation for Tips and Messages
    var totalChange = percentChange || { value: 0, isIncrease: false };
    var tipsChange = { value: 0, isIncrease: false };
    var messagesChange = { value: 0, isIncrease: false };
    
    if (totalChange.value > 0) {
      // Calculate signed percent value
      var signedPercent = totalChange.isIncrease ? totalChange.value : -totalChange.value;
      
      // Tips and Messages changes (add some variation from the base)
      var tipsPctChange = signedPercent + (Math.random() * 30 - 15); // В±15% variation
      var messagesPctChange = signedPercent + (Math.random() * 40 - 20); // В±20% variation
      
      tipsChange = { value: Math.abs(tipsPctChange), isIncrease: tipsPctChange >= 0 };
      messagesChange = { value: Math.abs(messagesPctChange), isIncrease: messagesPctChange >= 0 };
    } else {
      // Generate random changes if no base percentage
      var randomTipsChange = (Math.random() * 60 - 30); // -30% to +30%
      var randomMessagesChange = (Math.random() * 80 - 40); // -40% to +40%
      
      tipsChange = { value: Math.abs(randomTipsChange), isIncrease: randomTipsChange >= 0 };
      messagesChange = { value: Math.abs(randomMessagesChange), isIncrease: randomMessagesChange >= 0 };
    }
    
    // Generate mini chart data and include in breakdown
    var miniChartsData = {
      total: generateMiniChartData(30, totalChange.isIncrease),
      tips: generateMiniChartData(30, tipsChange.isIncrease),
      messages: generateMiniChartData(30, messagesChange.isIncrease)
    };
    
    var breakdown = {
      total: { amount: roundedNet, change: totalChange },
      tips: { amount: Math.round(tipsAmount * 100) / 100, change: tipsChange },
      messages: { amount: Math.round(messagesAmount * 100) / 100, change: messagesChange },
      miniCharts: miniChartsData
    };
    
    // Save to cache (earnings breakdown saved separately, gross key shared with charts)
    try {
      localStorage.setItem(cacheKey, JSON.stringify(breakdown));
      log('OF Stats: Earnings breakdown cached for Net $' + roundedNet.toFixed(2));
    } catch (e) {
      log('OF Stats: Cannot save earnings breakdown to cache');
    }
    
    return breakdown;
  }
  
  // Generate HTML for Earnings section (full, with header)
  function generateEarningsHTML(breakdown) {
    var elLang = getPageLanguage();
    var earningsLabel = elLang === 'ru' ? 'Заработок' : elLang === 'es' ? 'Ganancias' : elLang === 'de' ? 'Provision' : 'Earnings';
    return '<div class="b-useful-data__header"> ' + earningsLabel + ' </div>' +
      generateEarningsContentOnlyHTML(breakdown);
  }
  
  // Generate HTML for Earnings content only (without header) - for replacing inside existing section
  function generateEarningsContentHTML(breakdown) {
    // Wrap in a div that can be appended
    return '<div class="b-statistics-columns m-separate-block m-rows-items of-stats-earnings-content">' +
      generateEarningsRowsHTML(breakdown) +
    '</div>';
  }
  
  // Generate only the content part (without wrapper)
  function generateEarningsContentOnlyHTML(breakdown) {
    return '<div class="b-statistics-columns m-separate-block m-rows-items">' +
      generateEarningsRowsHTML(breakdown) +
    '</div>';
  }
  
  // Generate the rows HTML (reusable)
  function generateEarningsRowsHTML(breakdown) {
    function getChangeHTML(change) {
      var iconName = change.isIncrease ? 'icon-increase' : 'icon-decrease';
      var levelClass = change.isIncrease ? 'm-level-up' : 'm-level-down';
      var sign = change.isIncrease ? '' : '-';
      return '<span class="b-statistics-level ' + levelClass + '">' +
        '<svg class="g-icon" data-icon-name="' + iconName + '" aria-hidden="true">' +
        '<use href="#' + iconName + '" xlink:href="#' + iconName + '"></use></svg> ' + 
        sign + change.value.toFixed(1) + '% </span>';
    }
    
    var rlang = getPageLanguage();
    var lTotal = rlang === 'ru' ? 'Итого' : rlang === 'es' ? 'Total' : rlang === 'de' ? 'Gesamt' : 'Total';
    var lTips = rlang === 'ru' ? 'Чаевые' : rlang === 'es' ? 'Propinas' : rlang === 'de' ? 'Trinkgelder' : 'Tips';
    var lMessages = rlang === 'ru' ? 'Сообщения' : rlang === 'es' ? 'Mensajes' : rlang === 'de' ? 'Nachrichten' : 'Messages';

    return '' +
        // Total
        '<div class="b-elements-determinant g-pointer-cursor m-rows-charts">' +
          '<div class="b-elements-determinant__unit">' +
            '<div class="b-elements-determinant__label"> ' + lTotal + ' </div>' +
            '<div class="b-elements-determinant__value">' +
              '<span class=""> $' + formatCurrency(breakdown.total.amount) + ' </span>' +
              getChangeHTML(breakdown.total.change) +
            '</div>' +
          '</div>' +
          '<div class="b-elements-determinant__unit m-chart">' +
            '<div class="b-chart-wrapper m-chart-stat">' +
              '<canvas id="of-stats-earnings-total-chart" style="display: block; box-sizing: border-box; height: 50px; width: 132px;" width="132" height="50"></canvas>' +
            '</div>' +
          '</div>' +
        '</div>' +
        // Tips
        '<div class="b-elements-determinant g-pointer-cursor m-rows-charts">' +
          '<div class="b-elements-determinant__unit">' +
            '<div class="b-elements-determinant__label"> ' + lTips + ' </div>' +
            '<div class="b-elements-determinant__value">' +
              '<span class=""> $' + formatCurrency(breakdown.tips.amount) + ' </span>' +
              getChangeHTML(breakdown.tips.change) +
            '</div>' +
          '</div>' +
          '<div class="b-elements-determinant__unit m-chart">' +
            '<div class="b-chart-wrapper m-chart-stat">' +
              '<canvas id="of-stats-earnings-tips-chart" style="display: block; box-sizing: border-box; height: 50px; width: 132px;" width="132" height="50"></canvas>' +
            '</div>' +
          '</div>' +
        '</div>' +
        // Messages
        '<div class="b-elements-determinant g-pointer-cursor m-rows-charts">' +
          '<div class="b-elements-determinant__unit">' +
            '<div class="b-elements-determinant__label"> ' + lMessages + ' </div>' +
            '<div class="b-elements-determinant__value">' +
              '<span class=""> $' + formatCurrency(breakdown.messages.amount) + ' </span>' +
              getChangeHTML(breakdown.messages.change) +
            '</div>' +
          '</div>' +
          '<div class="b-elements-determinant__unit m-chart">' +
            '<div class="b-chart-wrapper m-chart-stat">' +
              '<canvas id="of-stats-earnings-messages-chart" style="display: block; box-sizing: border-box; height: 50px; width: 132px;" width="132" height="50"></canvas>' +
            '</div>' +
          '</div>' +
        '</div>';
  }
  
  // Generate mini chart data (30 points with realistic variation and trend)
  function generateMiniChartData(points, isUptrend) {
    var data = [];
    var baseValue = 50;
    var trend = isUptrend ? 0.5 : -0.5; // Positive or negative trend
    
    for (var i = 0; i < points; i++) {
      // Add trend component
      var trendComponent = trend * i;
      // Add random variation
      var randomVariation = (Math.random() - 0.5) * 30;
      // Occasional spikes
      if (Math.random() < 0.1) {
        randomVariation += (Math.random() > 0.5 ? 1 : -1) * 20;
      }
      
      var value = baseValue + trendComponent + randomVariation;
      value = Math.max(10, Math.min(90, value)); // Keep within bounds
      data.push(Math.round(value));
    }
    
    return data;
  }
  
  // Draw mini charts with animation (manual canvas drawing)
  // Animation grows from bottom to top like b-chart--no-padding charts
  function drawMiniChartsDirectly(miniChartsData) {
    function drawMiniChart(canvasId, data, color) {
      var canvas = document.getElementById(canvasId);
      if (!canvas) {
        log('OF Stats: Mini chart canvas not found: ' + canvasId);
        return;
      }
      
      var ctx = canvas.getContext('2d');
      if (!ctx) return;
      
      var width = canvas.width;
      var height = canvas.height;
      
      // Clear canvas
      ctx.clearRect(0, 0, width, height);
      
      if (!data || data.length === 0) return;
      
      // Calculate scales
      var maxVal = Math.max.apply(null, data);
      var minVal = Math.min.apply(null, data);
      var range = maxVal - minVal || 1;
      
      var padding = { left: 2, right: 2, top: 5, bottom: 5 };
      var chartWidth = width - padding.left - padding.right;
      var chartHeight = height - padding.top - padding.bottom;
      var xStep = chartWidth / (data.length - 1);
      
      // Build final points (full amplitude)
      var finalPoints = [];
      var baseY = padding.top + chartHeight; // Bottom of chart
      for (var i = 0; i < data.length; i++) {
        var x = padding.left + i * xStep;
        var y = padding.top + chartHeight * (1 - (data[i] - minVal) / range);
        finalPoints.push({ x: x, y: y, baseY: baseY });
      }
      
      // Animation: grow from bottom to top (like Chart.js y-axis animation)
      var animationDuration = 800; // ms
      var startTime = null;
      
      function animateChart(timestamp) {
        if (!startTime) startTime = timestamp;
        var progress = Math.min((timestamp - startTime) / animationDuration, 1);
        
        // Easing function (easeOutQuart like Chart.js)
        var easedProgress = 1 - Math.pow(1 - progress, 4);
        
        // Clear and redraw
        ctx.clearRect(0, 0, width, height);
        
        ctx.beginPath();
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.lineJoin = 'miter'; // Sharp corners
        ctx.lineCap = 'butt';   // Sharp line ends
        ctx.miterLimit = 10;    // Allow sharp angles
        
        // Calculate current points (interpolate Y from baseY to finalY)
        var currentPoints = [];
        for (var i = 0; i < finalPoints.length; i++) {
          var finalY = finalPoints[i].y;
          var baseY = finalPoints[i].baseY;
          // Interpolate from baseY (bottom) to finalY (actual position)
          var currentY = baseY + (finalY - baseY) * easedProgress;
          currentPoints.push({ x: finalPoints[i].x, y: currentY });
        }
        
        // Draw the line
        ctx.moveTo(currentPoints[0].x, currentPoints[0].y);
        for (var j = 1; j < currentPoints.length; j++) {
          ctx.lineTo(currentPoints[j].x, currentPoints[j].y);
        }
        
        ctx.stroke();
        
        if (progress < 1) {
          requestAnimationFrame(animateChart);
        } else {
          log('OF Stats: Drew mini chart ' + canvasId);
        }
      }
      
      requestAnimationFrame(animateChart);
    }
    
    // Colors as specified:
    // Total = #8a96a3 (gray)
    // Tips = #9575cd (purple)
    // Messages = #00aff0 (blue)
    if (miniChartsData.total) {
      drawMiniChart('of-stats-earnings-total-chart', miniChartsData.total, '#8a96a3');
    }
    if (miniChartsData.tips) {
      drawMiniChart('of-stats-earnings-tips-chart', miniChartsData.tips, '#9575cd');
    }
    if (miniChartsData.messages) {
      drawMiniChart('of-stats-earnings-messages-chart', miniChartsData.messages, '#00aff0');
    }
  }

  // Load Chart.js and chart-drawer.js from extension (both are external files, no CSP issues)
  function loadChartJsAndDraw(transactions, grossValue, earningsBreakdown) {
    // Check if we have cached chart data and if Gross hasn't changed
    var cacheKey = 'ofStatsChartDataCache';
    var grossKey = 'ofStatsChartGrossValue';
    var cachedData = null;
    var cachedGross = null;
    
    try {
      cachedData = localStorage.getItem(cacheKey);
      cachedGross = localStorage.getItem(grossKey);
    } catch (e) {
      log('OF Stats: Cannot access localStorage for chart cache');
    }
    
    log('OF Stats Chart Cache Debug: cachedData=' + (cachedData ? 'exists' : 'null') + ', cachedGross=' + cachedGross + ', currentGross=' + grossValue);
    
    // If Gross is the same and we have cached data, use it
    if (cachedData && cachedGross && parseFloat(cachedGross) === grossValue) {
      // If charts already exist and rendered, skip completely
      var existingMainCanvas = document.getElementById('of-stats-earnings-chart-main');
      if (existingMainCanvas && typeof Chart !== 'undefined' && Chart.getChart(existingMainCanvas)) {
        log('OF Stats: Charts already rendered with cached data, skipping');
        return;
      }
      log('OF Stats: Using cached chart data (Gross unchanged: $' + grossValue + ')');
      var chartData = JSON.parse(cachedData);
      loadChartScriptsAndDraw(chartData);
      return;
    }
    
    log('OF Stats: Generating new chart data (Gross changed from $' + cachedGross + ' to $' + grossValue + ')');
    
    // All Time — generate monthly data points from earningStatsData.months
    if (window.ofStatsCurrentPeriod === 'alltime') {
      var allTimeStats = getOrGenerateEarningStatsEarly();
      if (allTimeStats && allTimeStats.months && allTimeStats.months.length > 0) {
        var monthsChron = allTimeStats.months.slice().reverse(); // chronological order
        var atLabels = [];
        var atEarnings = [];
        var atCounts = [];
        var atMonthDates = [];
        var monNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        
        var rawNetTotal = monthsChron.reduce(function(sum, m) { return sum + m.net; }, 0);
        var atScale = rawNetTotal > 0 ? grossValue / rawNetTotal : 1;
        var avgMonthNet = rawNetTotal / monthsChron.length;
        
        // Generate raw earnings with random variation (±30%) per month
        var rawAtEarnings = [];
        monthsChron.forEach(function(m) {
          atLabels.push(monNames[m.month] + ', ' + m.year);
          atMonthDates.push(new Date(m.year, m.month, 1).toISOString());
          var baseValue = m.net * atScale;
          // Random variation: 70% to 130% of base value
          var variation = 0.7 + Math.random() * 0.6;
          rawAtEarnings.push(baseValue * variation);
          // Transaction count proportional to earnings with variation
          var monthFrac = avgMonthNet > 0 ? m.net / avgMonthNet : 1;
          var baseCount = grossValue < 3000 ? 80 : grossValue < 10000 ? 200 : 400;
          atCounts.push(Math.max(5, Math.round(baseCount * monthFrac * (0.6 + Math.random() * 0.8))));
        });
        
        // Normalize so sum = grossValue
        var rawAtSum = rawAtEarnings.reduce(function(a, b) { return a + b; }, 0);
        var normFactor = rawAtSum > 0 ? grossValue / rawAtSum : 1;
        rawAtEarnings.forEach(function(val) {
          atEarnings.push(Math.round(val * normFactor * 100) / 100);
        });
        
        // Normalize earnings sum to grossValue
        var atSum = atEarnings.reduce(function(a, b) { return a + b; }, 0);
        var atDiff = grossValue - atSum;
        if (Math.abs(atDiff) > 0.01 && atEarnings.length > 0) {
          atEarnings[atEarnings.length - 1] = Math.round((atEarnings[atEarnings.length - 1] + atDiff) * 100) / 100;
        }
        
        var chartData = {
          labels: atLabels,
          earnings: atEarnings,
          counts: atCounts,
          startDate: atMonthDates[0],
          monthlyMode: true,
          monthDates: atMonthDates,
          miniCharts: {
            total: generateMiniChartData(30, earningsBreakdown.total.change.isIncrease),
            tips: generateMiniChartData(30, earningsBreakdown.tips.change.isIncrease),
            messages: generateMiniChartData(30, earningsBreakdown.messages.change.isIncrease)
          }
        };
        
        try {
          localStorage.setItem(cacheKey, JSON.stringify(chartData));
          localStorage.setItem(grossKey, grossValue.toString());
        } catch (e) {}
        
        loadChartScriptsAndDraw(chartData);
        return;
      }
    }
    
    // Prepare chart data - generate synthetic data for the entire 30-day period
    // This ensures the chart starts from day 1, not just where transactions exist
    var dailyData = {};
    var now = new Date();
    
    // Initialize all 30 days with base values
    for (var d = 0; d < 30; d++) {
      var dayDate = new Date(now);
      dayDate.setDate(dayDate.getDate() - (29 - d));
      var dayKey = dayDate.getFullYear() + '-' + 
        String(dayDate.getMonth() + 1).padStart(2, '0') + '-' + 
        String(dayDate.getDate()).padStart(2, '0');
      dailyData[dayKey] = { earnings: 0, count: 0, date: dayKey, dayIndex: d };
    }
    
    // Add actual transaction data
    transactions.forEach(function(t) {
      var dayKey = t.date.getFullYear() + '-' + 
        String(t.date.getMonth() + 1).padStart(2, '0') + '-' + 
        String(t.date.getDate()).padStart(2, '0');
      if (dailyData[dayKey]) {
        dailyData[dayKey].earnings += t.net;
        dailyData[dayKey].count += 1;
      }
    });
    
    // Calculate average daily earnings from transaction days
    var totalEarnings = 0;
    var totalCount = 0;
    var daysWithData = 0;
    Object.keys(dailyData).forEach(function(key) {
      if (dailyData[key].earnings > 0) {
        totalEarnings += dailyData[key].earnings;
        totalCount += dailyData[key].count;
        daysWithData++;
      }
    });
    
    var avgDailyEarnings = daysWithData > 0 ? totalEarnings / daysWithData : 150;
    var avgDailyCount = daysWithData > 0 ? totalCount / daysWithData : 5;
    
    // Determine max transactions per day based on Gross value
    // Small Gross (< $3000) в†’ max 20 transactions (scale 10, 20)
    // Medium Gross ($3000-$10000) в†’ max 30 transactions
    // Large Gross (> $10000) в†’ max 40 transactions
    var maxTransactionsPerDay;
    var baseAvgTransactions;
    if (grossValue < 3000) {
      maxTransactionsPerDay = 20;
      baseAvgTransactions = 3 + (grossValue / 3000) * 5; // 3-8 avg for small
    } else if (grossValue < 10000) {
      maxTransactionsPerDay = 30;
      baseAvgTransactions = 8 + ((grossValue - 3000) / 7000) * 7; // 8-15 avg for medium
    } else {
      maxTransactionsPerDay = 40;
      baseAvgTransactions = 15 + Math.min(10, (grossValue - 10000) / 5000 * 5); // 15-25 avg for large
    }
    
    // Use calculated base or actual average, whichever is appropriate
    if (avgDailyCount < baseAvgTransactions * 0.5) {
      avgDailyCount = baseAvgTransactions;
    }
    
    log('OF Stats: Gross $' + grossValue.toFixed(2) + ' в†’ max ' + maxTransactionsPerDay + ' transactions/day, avg target: ' + baseAvgTransactions.toFixed(1));
    
    // Generate realistic data for days without transactions
    // Use a growth pattern - earlier days have less, recent days have more
    Object.keys(dailyData).sort().forEach(function(key) {
      var day = dailyData[key];
      
      if (day.earnings === 0) {
        // Generate synthetic data based on day position (growth pattern)
        var progressRatio = day.dayIndex / 29; // 0 at start, 1 at end
        
        // Base multiplier grows over time (simulating account growth)
        var growthMultiplier = 0.3 + progressRatio * 0.7; // 30% to 100%
        
        // Add significant random variation (40% to 180% of average)
        var randomVariation = 0.4 + Math.random() * 1.4;
        
        // Some days are "slow" (20% chance of very low earnings)
        if (Math.random() < 0.2) {
          randomVariation *= 0.3;
        }
        // Some days are "hot" (15% chance of high earnings)
        else if (Math.random() < 0.15) {
          randomVariation *= 1.8;
        }
        
        day.earnings = avgDailyEarnings * growthMultiplier * randomVariation;
        
        // Generate transaction count based on Gross level
        var countVariation = 0.3 + Math.random() * 1.4; // 30% to 170% variation
        day.count = Math.max(1, Math.round(avgDailyCount * growthMultiplier * countVariation));
        
        // Some days have spikes in transactions (10% chance)
        if (Math.random() < 0.1) {
          day.count = Math.round(day.count * (1.5 + Math.random() * 1)); // 1.5x to 2.5x
        }
        // Some days have very few transactions (15% chance)
        else if (Math.random() < 0.15) {
          day.count = Math.max(1, Math.round(day.count * 0.4));
        }
        
        // Cap at max transactions based on Gross
        day.count = Math.min(maxTransactionsPerDay, day.count);
      } else {
        // For days WITH transactions, add more variation to count
        // Randomly adjust count by -30% to +50%
        var countAdjust = 0.7 + Math.random() * 0.8;
        day.count = Math.max(1, Math.round(day.count * countAdjust));
        
        // Occasional spike
        if (Math.random() < 0.12) {
          day.count = Math.round(day.count * (1.3 + Math.random() * 0.7));
        }
        
        // Cap at max transactions based on Gross
        day.count = Math.min(maxTransactionsPerDay, day.count);
      }
    });
    
    var labels = [];
    var earningsData = [];
    var countData = [];
    var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    
    // First pass: collect raw earnings values
    var rawEarnings = [];
    Object.keys(dailyData).sort().forEach(function(key) {
      var dd = dailyData[key];
      var dt = new Date(dd.date);
      labels.push(months[dt.getMonth()] + ' ' + String(dt.getDate()).padStart(2, '0') + ', ' + dt.getFullYear());
      rawEarnings.push(dd.earnings);
      countData.push(dd.count);
    });
    
    // Normalize earnings so that sum equals grossValue
    var rawSum = rawEarnings.reduce(function(a, b) { return a + b; }, 0);
    var scaleFactor = rawSum > 0 ? grossValue / rawSum : 1;
    
    rawEarnings.forEach(function(val) {
      earningsData.push(Math.round(val * scaleFactor * 100) / 100);
    });
    
    // Verify the sum matches Gross (with small rounding adjustment if needed)
    var finalSum = earningsData.reduce(function(a, b) { return a + b; }, 0);
    var diff = grossValue - finalSum;
    if (Math.abs(diff) > 0.01 && earningsData.length > 0) {
      // Add the difference to the last day to ensure exact match
      earningsData[earningsData.length - 1] = Math.round((earningsData[earningsData.length - 1] + diff) * 100) / 100;
    }
    
    // Get start date (30 days ago)
    var startDateObj = new Date(now);
    startDateObj.setDate(startDateObj.getDate() - 29);
    
    // Generate mini chart data for Total, Tips, Messages (30 points each)
    var totalMiniData = generateMiniChartData(30, earningsBreakdown.total.change.isIncrease);
    var tipsMiniData = generateMiniChartData(30, earningsBreakdown.tips.change.isIncrease);
    var messagesMiniData = generateMiniChartData(30, earningsBreakdown.messages.change.isIncrease);
    
    var chartData = {
      labels: labels,
      earnings: earningsData,
      counts: countData,
      startDate: startDateObj.toISOString(),
      // Mini charts data for Earnings section
      miniCharts: {
        total: totalMiniData,
        tips: tipsMiniData,
        messages: messagesMiniData
      }
    };
    
    var chartSum = earningsData.reduce(function(a, b) { return a + b; }, 0);
    log('OF Stats: Chart data generated - earnings range: $' + Math.min.apply(null, earningsData).toFixed(2) + ' - $' + Math.max.apply(null, earningsData).toFixed(2) + ', SUM: $' + chartSum.toFixed(2) + ' (Gross: $' + grossValue.toFixed(2) + '), transactions range: ' + Math.min.apply(null, countData) + ' - ' + Math.max.apply(null, countData));
    
    // Save chart data to cache
    try {
      localStorage.setItem(cacheKey, JSON.stringify(chartData));
      localStorage.setItem(grossKey, grossValue.toString());
      log('OF Stats: Chart data cached with Gross value $' + grossValue);
    } catch (e) {
      log('OF Stats: Cannot save chart data to cache');
    }
    
    // Load scripts and draw
    loadChartScriptsAndDraw(chartData);
  }
  
  // Helper function to load Chart.js scripts and draw charts
  function loadChartScriptsAndDraw(chartData) {
    function dispatchChartEvents(data) {
      window.dispatchEvent(new CustomEvent('of-stats-draw-statistics-charts', {
        detail: data
      }));
      if (data.miniCharts) {
        setTimeout(function() {
          window.dispatchEvent(new CustomEvent('of-stats-draw-mini-charts', {
            detail: data.miniCharts
          }));
        }, 100);
      }
    }
    
    // Check if Chart.js is already loaded
    if (window.Chart) {
      log('OF Stats: Chart.js already loaded, drawing charts');
      dispatchChartEvents(chartData);
      return;
    }
    
    // Prevent multiple simultaneous script loads
    if (window.ofStatsChartScriptsLoading) {
      // Scripts are loading — queue this chartData for when they finish
      window.ofStatsPendingChartData = chartData;
      log('OF Stats: Chart scripts already loading, queued data');
      return;
    }
    window.ofStatsChartScriptsLoading = true;
    
    // Load Chart.js from extension
    var chartScript = document.createElement('script');
    chartScript.src = chrome.runtime.getURL('chart.min.js');
    chartScript.onload = function() {
      log('OF Stats: Chart.js loaded from extension');
      
      // Load chart-drawer.js from extension
      var drawerScript = document.createElement('script');
      drawerScript.src = chrome.runtime.getURL('chart-drawer.js');
      drawerScript.onload = function() {
        log('OF Stats: Chart drawer loaded');
        window.ofStatsChartScriptsLoading = false;
        // Use queued data if available (most recent), otherwise original
        var dataToUse = window.ofStatsPendingChartData || chartData;
        window.ofStatsPendingChartData = null;
        dispatchChartEvents(dataToUse);
      };
      document.head.appendChild(drawerScript);
    };
    chartScript.onerror = function() {
      logError('OF Stats: Failed to load Chart.js');
      window.ofStatsChartScriptsLoading = false;
    };
    document.head.appendChild(chartScript);
  }
  
  // Start observing immediately
  observer.observe(document.documentElement, { 
    childList: true, 
    subtree: true 
  });
  
  // Also check existing elements periodically during load
  const checkExisting = function() {
    // Proactively cache balance from DOM for later use (when section is collapsed/expanded)
    getCurrentBalanceInteger();
    
    document.querySelectorAll(
      '[class*="balance__value"], [class*="balance_value"], ' +
      '.l-sidebar__user-data__item__count, .b-profile__sections__count, button.b-profile__sections__item'
    ).forEach(replaceContent);
    
    // Activate withdrawal button
    document.querySelectorAll('button').forEach(function(btn) {
      if (isWithdrawalButton(btn.textContent)) {
        activateWithdrawButton(btn);
      }
    });
    
    // Update Top Creators percentage
    updateTopCreatorsBanner();
    
    // Apply earnings generation
    applyEarningsEarly();
    
    // Apply earning stats page elements immediately
    if (isEarningStatsPage()) {
      // Replace category values
      document.querySelectorAll('.b-stats-row__val, .b-stats-row__total-net span').forEach(replaceContent);
      // Apply monthly earnings
      applyMonthlyEarningsEarly();
      // Apply chart
      applyChartEarly();
    }
    
    // Apply earning stats page (full version with click handlers etc)
    applyEarningStats();
    
    // Apply statistics/statements/earnings page - but only if not disabled by Reset
    try {
      if (localStorage.getItem('ofStatsStatisticsChartDisabled') !== 'true') {
        applyStatisticsEarningsPage();
      }
    } catch(e) {
      applyStatisticsEarningsPage();
    }
  };
  
  // Run checks during page load - more frequently for faster appearance
  checkExisting();
  setTimeout(checkExisting, 10);
  setTimeout(checkExisting, 30);
  setTimeout(checkExisting, 50);
  setTimeout(checkExisting, 100);
  setTimeout(checkExisting, 150);
  setTimeout(checkExisting, 250);
  setTimeout(checkExisting, 400);
  setTimeout(checkExisting, 600);
  setTimeout(checkExisting, 1000);
  setTimeout(checkExisting, 1500);
  setTimeout(checkExisting, 2000);
  setTimeout(checkExisting, 3000);
  
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', checkExisting);
  }
  
  // Handle SPA navigation (when user navigates between tabs)
  var lastUrl = window.location.href;
  var urlCheckInterval = setInterval(function() {
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      log('OF Stats: URL changed, re-checking elements');

      // Clean up Top Creators blocks from previous page.
      // These are outside Vue's component tree so Vue never removes them.
      ['of-stats-top-creators', 'of-stats-top-creators-rated',
       'of-stats-top-creators-style', 'of-stats-top-creators-rated-style',
       'of-stats-hide-native-top-rated'].forEach(function(id) {
        var el = document.getElementById(id);
        if (el) el.remove();
      });
      
      // Reset flags for earning stats page if we're on it
      if (isEarningStatsPage()) {
        // Reset content ready flag
        var contentContainer = document.querySelector('.b-stats-row__content');
        if (contentContainer) {
          contentContainer.removeAttribute('data-of-stats-ready');
        }
        // Reset months applied flag
        var statsWrap = document.querySelector('.b-stats-wrap');
        if (statsWrap) {
          statsWrap.removeAttribute('data-of-stats-months-applied');
        }
        // Reset modified flags on values
        document.querySelectorAll('[data-of-stats-modified]').forEach(function(el) {
          el.removeAttribute('data-of-stats-modified');
        });
      }
      
      // Handle statistics/statements/earnings page SPA navigation
      if (isStatisticsEarningsPage()) {
        // Check if disabled
        var isDisabled = false;
        try {
          isDisabled = localStorage.getItem('ofStatsStatisticsChartDisabled') === 'true';
        } catch(e) {}
        
        if (!isDisabled) {
          var wrapper = document.querySelector('.b-statistics-page-content__wrapper');
          if (wrapper) {
            // DON'T reset the applied flag - just ensure originals are hidden
            // Hide any original elements that may have appeared
            wrapper.querySelectorAll('.b-elements-determinant:not([data-of-stats-generated]):not([data-of-stats-original-hidden])').forEach(function(el) {
              el.setAttribute('data-of-stats-original-hidden', 'true');
              el.style.display = 'none';
            });
            wrapper.querySelectorAll('.b-chart:not([data-of-stats-generated]):not([data-of-stats-original-hidden])').forEach(function(el) {
              el.setAttribute('data-of-stats-original-hidden', 'true');
              el.style.display = 'none';
            });
            // Only hide original transactions table if earnings counts are set
            if (window.ofStatsHasEarningsCounts) {
              wrapper.querySelectorAll('.b-separate-section:not([data-of-stats-generated]):not([data-of-stats-original-hidden])').forEach(function(el) {
                el.setAttribute('data-of-stats-original-hidden', 'true');
                el.style.display = 'none';
              });
            }
            
            // Start/restart observer to catch any future original elements
            startOriginalElementsObserver();
            
            // If our content doesn't exist yet, apply it
            if (!wrapper.getAttribute('data-of-stats-applied')) {
              // Re-add the hiding style if it was removed
              if (!document.getElementById('of-stats-hide-earnings-content')) {
                var hideEarningsStyle = document.createElement('style');
                hideEarningsStyle.id = 'of-stats-hide-earnings-content';
                hideEarningsStyle.textContent = `
                  .b-useful-data:not([data-of-stats-processed]) .b-statistics-columns,
                  .b-useful-data:not([data-of-stats-processed]) .b-useful-data__empty {
                    visibility: hidden !important;
                    height: 0 !important;
                    overflow: hidden !important;
                  }
                  .b-useful-data[data-of-stats-processed] > *:not(.b-useful-data__header):not([data-of-stats-earnings-generated]) {
                    display: none !important;
                  }
                  .b-statistics-page-content__wrapper[data-of-stats-applied] .b-elements-determinant:not([data-of-stats-generated]),
                  .b-statistics-page-content__wrapper[data-of-stats-applied] .b-chart:not([data-of-stats-generated]) {
                    display: none !important;
                  }
                  [data-of-stats-original-hidden]:not(.b-separate-section) {
                    display: none !important;
                  }
                ` + (window.ofStatsHasEarningsCounts ? `
                  .b-statistics-page-content__wrapper[data-of-stats-applied] .b-separate-section:not([data-of-stats-generated]),
                  [data-of-stats-original-hidden].b-separate-section {
                    display: none !important;
                  }
                ` : '');
                document.documentElement.appendChild(hideEarningsStyle);
              }
            }
          }
        }
      } else {
        // If navigated away from statistics/statements/earnings page, stop the observer
        stopOriginalElementsObserver();
      }
      
      // Re-run checks
      checkExisting();
      setTimeout(checkExisting, 100);
      setTimeout(checkExisting, 300);
      setTimeout(checkExisting, 500);
      setTimeout(checkExisting, 1000);
    }
  }, 200);
})();
