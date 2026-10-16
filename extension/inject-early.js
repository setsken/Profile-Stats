// Early injection script - runs at document_start before any content renders
(async function() {
  'use strict';

  // Debug flag — flip to true when bisecting auth / badge issues.
  const DEBUG = false;
  function log(...args) { if (DEBUG) try { console.log('[PS]', ...args); } catch {} }
  function logError(...args) { if (DEBUG) try { console.error('[PS]', ...args); } catch {} }
  function authLog(...args) { if (DEBUG) try { console.log('[PS auth]', ...args); } catch {} }
  
  // Check if user is authenticated.
  // Read OUR flag (psAuthStatus) first — set by Profile Stats background on
  // login/logout. Fall back to the legacy ofStatsAuthStatus from Stats
  // Editor so users who installed only PS before this change keep working
  // until the next PS login round-trip writes the new key.
  const psStatus = localStorage.getItem('psAuthStatus');
  const seStatus = localStorage.getItem('ofStatsAuthStatus');
  const localSaysAuth = psStatus === 'authenticated'
    || (psStatus == null && seStatus === 'authenticated');
  authLog('boot', { psStatus, seStatus, localSaysAuth, url: location.href });

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
      authLog('asking background for auth status…');
      const resp = await new Promise((resolve) => {
        try {
          chrome.runtime.sendMessage({ action: 'getAuthStatus' }, (r) => {
            if (chrome.runtime.lastError) {
              authLog('sendMessage error:', chrome.runtime.lastError.message);
              resolve(null);
            } else {
              resolve(r);
            }
          });
        } catch (e) {
          authLog('sendMessage threw:', e && e.message);
          resolve(null);
        }
      });
      authLog('background response:', resp);
      if (resp && resp.isAuthenticated) {
        isAuthenticated = true;
        // Persist for future quick-starts on this origin
        try { localStorage.setItem('psAuthStatus', 'authenticated'); } catch {}
      }
    } catch (e) {
      authLog('await failed:', e && e.message);
    }
  }

  authLog('final decision: isAuthenticated =', isAuthenticated);
  // If not authenticated, don't run any plugin functionality
  if (!isAuthenticated) {
    log('OF Stats Early: Not authenticated, plugin disabled');
    return;
  }

  // ==================== i18n for Badge ====================
  // Default to English to match the popup's default (Settings → Language).
  // Russian-fallback was a holdover from when this code was forked from
  // Stats Editor — it produced an inconsistent state on fresh installs
  // (popup said EN, badge spoke RU).
  var _ofLang = localStorage.getItem('ofStatsLang') || 'en';
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
  function t(key) { return (_badgeI18n[_ofLang] || _badgeI18n.en)[key] || (_badgeI18n.en)[key] || key; }
  // Escape anything the profile owner controls (display name, location, …)
  // before it goes into a badge template. These strings are attacker-chosen:
  // the badge renders profiles belonging to other people, and the markup
  // lands in the onlyfans.com document.
  function _esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  // Look up a chip/flag label in the current locale, falling back to the
  // original English text if no translation is registered.
  function tLabel(text) {
    var dict = _badgeI18n[_ofLang] || _badgeI18n.en;
    var labels = dict.flagLabels || {};
    return labels[text] || text;
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
      log('Received profile data event:', profileData && profileData.username);
      
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

      // Guaranteed write of extended metrics on every profile view, even
      // when the radar panel never builds (trial expired, user closes
      // the tab early, etc.). The percentile call inside the radar
      // panel will later UPSERT with COALESCE so any field we missed
      // here (e.g. _detectedSocials populated by the late scan) still
      // lands eventually.
      if (profileData.username) {
        try {
          var snapshotMetrics = {
            avatarUrl: profileData.avatar || null,
            postsCount: Number(profileData.postsCount) || 0,
            videosCount: Number(profileData.videosCount) || 0,
            photosCount: Number(profileData.photosCount) || 0,
            streamsCount: Number(profileData.finishedStreamsCount) || 0,
            likesCount: Number(profileData.favoritedCount) || 0,
            subscribePrice: Number(profileData.subscribePrice) || 0
          };
          // Real OF field is profileData.joinDate (we previously read
          // 'joined' which is undefined → joined_date column stayed NULL).
          if (profileData.joinDate) {
            var jt = Date.parse(profileData.joinDate);
            if (!isNaN(jt)) {
              snapshotMetrics.accountMonths = Math.max(1, Math.floor((Date.now() - jt) / (1000*60*60*24*30)));
              snapshotMetrics.joinedDate = new Date(jt).toISOString().slice(0, 10);
            }
          }
          // fansVisible mirrors what the badge uses internally — OF sets
          // showSubscribersCount=false when the model hides their fan
          // count. Anything else (true / undefined) means fans are public.
          snapshotMetrics.fansVisible = profileData.showSubscribersCount !== false;
          if (Array.isArray(profileData._detectedSocials)) snapshotMetrics.hasSocials = profileData._detectedSocials.length > 0;
          if (typeof profileData._farmedStatus === 'string') snapshotMetrics.commentsEnabled = profileData._farmedStatus === 'ready';
          if (typeof profileData._isBotted === 'boolean') snapshotMetrics.isBotted = profileData._isBotted;
          // Fresh fans count — flows through the no-throttle snapshot
          // pipeline so the leaderboard always shows current numbers.
          // The legacy reportFans path (throttled once per day per user)
          // was leaving model_fans_history months out of date.
          if (profileData.subscribersCount != null && profileData.showSubscribersCount !== false) {
            var sc = Number(profileData.subscribersCount);
            if (Number.isFinite(sc) && sc >= 0) {
              snapshotMetrics.fansCount = Math.round(sc);
              snapshotMetrics.fansText  = quickFormatNumber(sc);
            }
          }
          try {
            var socialsWithUrls = scanSocialLinksWithUrls();
            if (socialsWithUrls.length > 0) snapshotMetrics.socials = socialsWithUrls;
          } catch (e) {}
          chrome.runtime.sendMessage({
            action: 'reportProfileMetrics',
            username: profileData.username,
            metrics: snapshotMetrics
          }).catch(function() { /* non-blocking */ });
        } catch (e) { /* swallow */ }
      }
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
      // Expose the inflation/botted verdict for downstream consumers
      // (snapshot/percentile payload, Hide-botted filter on Top Models).
      result.isBotted = !!(isBottedLikes || isInflatedLikes);
      // Mirror on profileData so callers outside displayProfileData (e.g.
      // the post-display snapshot call) can pick up the verdict without
      // re-running the whole score calc.
      try { profileData._isBotted = result.isBotted; } catch (e) {}

      return result;
    }

    // Scan DOM for social media links (OF renders them via Vue as .m-tab-social links)
    // Detect an active "first period at a discount" promo on a paid OF
    // profile. Tries three sources in order:
    //   1) profileData.promotions = [{ price, duration|days|durationDays }, ...]
    //   2) profileData.currentSubscribePrice — a single discounted rate
    //   3) DOM scrape of the Subscribe button text "$N.NN for N days"
    // Returns { price: '8.25', label: '1 mo' } or null when no promo.
    function _detectActivePromo(profileData, baseN) {
      var fmt = function (n) {
        var s = Number(n).toFixed(2);
        return s.replace(/\.00$/, '');
      };
      var labelForDays = function (days) {
        var d = Number(days) || 0;
        if (d <= 0) return '1 mo';
        if (d <= 27) return d + 'd';
        if (d >= 28 && d <= 31) return '1 mo';
        var months = Math.round(d / 30);
        return months + ' mo';
      };
      try {
        // 1) promotions array on profileData
        if (Array.isArray(profileData.promotions) && profileData.promotions.length > 0) {
          var subs = profileData.promotions
            .map(function (p) {
              if (!p) return null;
              var price = Number(p.price);
              if (!Number.isFinite(price) || price <= 0 || price >= baseN) return null;
              var days = Number(p.duration || p.days || p.durationDays || p.duration_days || 0);
              return { price: price, days: days };
            })
            .filter(Boolean);
          if (subs.length > 0) {
            subs.sort(function (a, b) { return a.price - b.price; });
            return { price: fmt(subs[0].price), label: labelForDays(subs[0].days) };
          }
        }
        // 2) currentSubscribePrice fallback
        var cur = Number(profileData.currentSubscribePrice);
        if (Number.isFinite(cur) && cur > 0 && cur < baseN) {
          return { price: fmt(cur), label: '1 mo' };
        }
        // 3) DOM fallback — OF renders "$3.25 for 31 days" inside the
        //    Subscribe CTA. Scan a small set of likely containers and
        //    look for the first "$N(.NN)? for N day(s)" occurrence.
        var domRes = _scrapePromoFromDom(baseN);
        if (domRes) {
          return { price: fmt(domRes.price), label: labelForDays(domRes.days) };
        }
      } catch (e) {}
      return null;
    }

    // DOM scrape helper: walks plausible subscribe-CTA containers and
    // returns { price, days } when a promo string is found, else null.
    function _scrapePromoFromDom(baseN) {
      try {
        // Cast a wide net: subscribe buttons live under different class
        // names depending on the OF layout variant in play.
        var nodes = document.querySelectorAll(
          'a.b-btn-subscribe, button.b-btn-subscribe, ' +
          'a[href*="subscribe"], button[class*="subscribe"], ' +
          '[class*="b-offer-join"], [class*="m-subscribe"], ' +
          '[class*="b-subscribtion"], [class*="subscription"]'
        );
        var re = /\$\s*(\d+(?:\.\d+)?)\s+for\s+(\d+)\s+day/i;
        for (var i = 0; i < nodes.length; i++) {
          var txt = (nodes[i].textContent || '').trim();
          if (!txt) continue;
          var m = txt.match(re);
          if (m) {
            var price = Number(m[1]);
            var days = Number(m[2]);
            if (Number.isFinite(price) && price > 0 && price < baseN && days > 0) {
              return { price: price, days: days };
            }
          }
        }
      } catch (e) {}
      return null;
    }

    function scanSocialLinksFromDOM() {
      var socials = [];
      try {
        // Surface five platforms as row icons. Anything else is ignored.
        var socialLinks = document.querySelectorAll('a.m-tab-social, a[href*="instagram.com"], a[href*="tiktok.com"], a[href*="twitter.com"], a[href*="x.com/"], a[href*="snapchat.com"], a[href*="twitch.tv"]');
        socialLinks.forEach(function(link) {
          var h = (link.href || '').toLowerCase();
          if (h.indexOf('instagram.com') !== -1 || h.indexOf('instagr.am') !== -1) socials.push('instagram');
          else if (h.indexOf('tiktok.com') !== -1) socials.push('tiktok');
          else if (h.indexOf('twitter.com') !== -1 || h.indexOf('x.com/') !== -1) socials.push('twitter');
          else if (h.indexOf('snapchat.com') !== -1) socials.push('snapchat');
          else if (h.indexOf('twitch.tv') !== -1) socials.push('twitch');
        });
      } catch (e) {}
      // Deduplicate
      return socials.filter(function(v, i, a) { return a.indexOf(v) === i; });
    }

    // Same matcher as scanSocialLinksFromDOM but keeps the actual href
    // for each detected link. Used when sending profile metrics to the
    // backend so Top Models rows can render a clickable social icon.
    function scanSocialLinksWithUrls() {
      var out = [];
      var seen = {};
      try {
        var socialLinks = document.querySelectorAll('a.m-tab-social, a[href*="instagram.com"], a[href*="tiktok.com"], a[href*="twitter.com"], a[href*="x.com/"], a[href*="snapchat.com"], a[href*="twitch.tv"]');
        socialLinks.forEach(function(link) {
          var href = link.href || '';
          var h = href.toLowerCase();
          var platform = null;
          if (h.indexOf('instagram.com') !== -1 || h.indexOf('instagr.am') !== -1) platform = 'instagram';
          else if (h.indexOf('tiktok.com') !== -1) platform = 'tiktok';
          else if (h.indexOf('twitter.com') !== -1 || h.indexOf('x.com/') !== -1) platform = 'twitter';
          else if (h.indexOf('snapchat.com') !== -1) platform = 'snapchat';
          else if (h.indexOf('twitch.tv') !== -1) platform = 'twitch';
          if (platform && !seen[platform] && href) {
            seen[platform] = true;
            out.push({ platform: platform, url: href.slice(0, 500) });
          }
        });
      } catch (e) {}
      return out;
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
          avatarWrap += '<img class="' + cls + '" src="' + _esc(model.avatar) + '" onerror="this.style.display=\'none\';this.nextSibling.style.display=\'flex\'" /><div class="' + phCls + '" style="display:none">👤</div>';
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
        + '<div style="font-size:10px;font-weight:700;color:' + (hasWinner && winnerIsA ? '#ffd700' : '#fff') + ';margin-top:4px;max-width:90px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-left:auto;margin-right:auto;">@' + _esc(modelA.username) + '</div>'
        + scoreBadge(modelA, 'a', hasWinner && winnerIsA)
        + '</div>'
        + '<div style="animation:ofBattleVs 0.5s ease 0.2s both;flex-shrink:0;padding-bottom:14px;">'
        + '<div style="font-size:18px;font-weight:900;background:linear-gradient(135deg,#00b4ff,#7c3aed);-webkit-background-clip:text;-webkit-text-fill-color:transparent;line-height:1;">VS</div>'
        + '<div style="width:24px;height:2px;background:linear-gradient(90deg,#00b4ff,#7c3aed);border-radius:1px;margin:4px auto;animation:ofBattleGlow 2s ease infinite;"></div>'
        + '</div>'
        + '<div style="text-align:center;animation:ofBattleSlideIn 0.3s ease 0.1s both;flex:1;min-width:0;">'
        + avatarHtml(modelB, 'b', hasWinner && !winnerIsA)
        + '<div style="font-size:10px;font-weight:700;color:' + (hasWinner && !winnerIsA ? '#ffd700' : '#fff') + ';margin-top:4px;max-width:90px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-left:auto;margin-right:auto;">@' + _esc(modelB.username) + '</div>'
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
        verdict.innerHTML = '<div style="font-size:13px;font-weight:800;animation:ofBattleWinner 0.6s ease 0.6s both;background:linear-gradient(135deg,#ffd700,' + winColor + ');-webkit-background-clip:text;-webkit-text-fill-color:transparent;">🏆 @' + _esc(winner.username) + ' ' + t('compareWins') + '</div>'
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
          + '<span class="of-stats-tiptext" style="display:none;">' + tipText + '<br><span style="color:#00b4ff;">@' + _esc(modelA.username) + ': ' + vA + '/' + k[2] + '</span> · <span style="color:#7c3aed;">@' + _esc(modelB.username) + ': ' + vB + '/' + k[2] + '</span></span>';
        radarDiv.appendChild(lbl);
      });

      // Legend
      var legend = document.createElement('div');
      legend.style.cssText = 'display:flex;justify-content:center;gap:16px;margin-top:4px;font-size:9px;';
      legend.innerHTML = '<div style="display:flex;align-items:center;gap:4px;"><div style="width:8px;height:8px;border-radius:50%;background:#00b4ff;"></div><span style="color:#8899aa;">@' + _esc(modelA.username) + '</span></div>'
        + '<div style="display:flex;align-items:center;gap:4px;"><div style="width:8px;height:8px;border-radius:50%;background:#7c3aed;"></div><span style="color:#8899aa;">@' + _esc(modelB.username) + '</span></div>';
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
      log('displayProfileData() called for @' + (profileData && profileData.username));
      // Check if user is authenticated — use our own key (psAuthStatus) so
      // an SE-side logout doesn't kill the PS badge. The boot-time gate
      // above already async-resolves auth via the SW and stamps
      // psAuthStatus, so by the time this is called the key is set.
      const _ps = localStorage.getItem('psAuthStatus');
      const _se = localStorage.getItem('ofStatsAuthStatus');
      const _authed = _ps === 'authenticated'
        || (_ps == null && _se === 'authenticated');
      if (!_authed) {
        log('Skipping badge — auth gate denied', { ps: _ps, se: _se });
        return;
      }
      log('Badge auth gate passed, rendering…');

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
      _ofLang = settings.ofStatsLang || 'en';
      
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
      
      // Subscription price — when a promo is active, append the first
      // period at the discounted rate so users see both the regular
      // price and the actual cost they'll pay on first purchase.
      // Example: "Price: $15 (1 mo/$8.25)".
      if (profileData.subscribePrice !== undefined && profileData.subscribePrice !== null) {
        const baseN = Number(profileData.subscribePrice) || 0;
        const isFree = baseN === 0;
        const priceText = isFree ? 'FREE' : '$' + baseN;
        const priceColor = isFree ? '#10b981' : '#f59e0b';
        var promoSuffix = '';
        if (!isFree) {
          var promo = _detectActivePromo(profileData, baseN);
          if (promo) {
            promoSuffix = ' <span style="color:#10b981;font-weight:600;font-size:12px;">('
              + promo.label + '/$' + promo.price + ')</span>';
          }
        }
        badgeItems.push(`
          <div style="display:flex;align-items:center;gap:8px;">
            ${svgIcons.price}
            <span style="color:#8a96a3;font-size:12px;">Price:</span>
            <span style="color:${priceColor};font-weight:600;font-size:13px;">${priceText}</span>${promoSuffix}
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
            <span style="color:#3498db;font-weight:600;font-size:13px;">${_esc(locationText)}</span>
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
        transition: min-height 0.35s cubic-bezier(0.4, 0, 0.2, 1);
      `;

      // Inject flip card styles once
      if (!document.getElementById('of-stats-flip-styles')) {
        var flipStyleEl = document.createElement('style');
        flipStyleEl.id = 'of-stats-flip-styles';
        // The active side stays in flow so flipInner sizes naturally to
        // it; the inactive side is position:absolute so it doesn't
        // inflate the height. Toggling the .flipped class swaps which
        // is which — that's the only way to keep the badge tight on
        // the back side without a separate measurement.
        flipStyleEl.textContent = ''
          + '#of-stats-profile-badge .of-flip-inner{position:relative;z-index:1;width:100%;transition:transform 0.6s cubic-bezier(0.4,0,0.2,1),min-height 0.35s cubic-bezier(0.4,0,0.2,1);transform-style:preserve-3d}'
          + '#of-stats-profile-badge .of-flip-inner.flipped{transform:rotateY(180deg)}'
          + '#of-stats-profile-badge .of-flip-front,#of-stats-profile-badge .of-flip-back{width:100%;backface-visibility:hidden;-webkit-backface-visibility:hidden;transform-style:flat}'
          // Inactive side absolute-positioned so it doesn't add to flow.
          + '#of-stats-profile-badge .of-flip-inner:not(.flipped) .of-flip-front{position:relative}'
          + '#of-stats-profile-badge .of-flip-inner:not(.flipped) .of-flip-back{position:absolute;top:0;left:0;height:100%;overflow:hidden;pointer-events:none;transform:rotateY(180deg)}'
          + '#of-stats-profile-badge .of-flip-inner.flipped .of-flip-front{position:absolute;top:0;left:0;height:100%;overflow:hidden;pointer-events:none}'
          + '#of-stats-profile-badge .of-flip-inner.flipped .of-flip-back{position:relative;transform:rotateY(180deg)}';
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
          '#of-stats-tab-notes .nv-textarea::placeholder{color:#94a3b8 !important;-webkit-text-fill-color:#94a3b8 !important;}',
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
          '#of-stats-tab-notes .nv-search-input::placeholder{color:#94a3b8 !important;-webkit-text-fill-color:#94a3b8 !important;font-style:italic;}',
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
          '#of-stats-tab-notes .nv-tag-count{font-size:10px;color:#cbd5e1;font-weight:500;}',
          '#of-stats-tab-notes .nv-tag-del{width:20px;height:20px;border-radius:50%;background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.2);color:#ef4444;cursor:pointer;display:flex;align-items:center;justify-content:center;opacity:0;transition:all 0.15s;flex-shrink:0;}',
          '#of-stats-tab-notes .nv-tag-row:hover .nv-tag-del{opacity:1;}',
          '#of-stats-tab-notes .nv-tag-del:hover{background:rgba(239,68,68,0.25);}',
          '#of-stats-tab-notes .nv-create-row{display:flex;gap:6px;margin-top:10px;align-items:center;}',
          '#of-stats-tab-notes .nv-create-input{flex:1;padding:7px 10px;border-radius:8px;background:rgba(0,0,0,0.3) !important;border:1px solid #1e2d3d !important;color:#e0e6ef !important;-webkit-text-fill-color:#e0e6ef !important;font-size:11px;font-family:inherit;outline:none;min-width:0;box-sizing:border-box;transition:border-color 0.2s;}',
          '#of-stats-tab-notes .nv-create-input:focus{border-color:rgba(0,180,255,0.4) !important;box-shadow:0 0 8px rgba(0,180,255,0.08);}',
          '#of-stats-tab-notes .nv-create-input::placeholder{color:#94a3b8 !important;-webkit-text-fill-color:#94a3b8 !important;font-style:italic;}',
          '#of-stats-tab-notes .nv-create-label{font-size:12px;color:#ffffff;font-weight:700;letter-spacing:0.02em;margin-bottom:6px;}',
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
          '#of-stats-tab-notes .nv-model-note{font-size:11px;color:#cbd5e1;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px;}',
          '#of-stats-tab-notes .nv-model-tags{display:flex;gap:3px;margin-top:4px;flex-wrap:wrap;}',
          '#of-stats-tab-notes .nv-mtag{font-size:8px;padding:2px 7px;border-radius:5px;font-weight:700;}',
          '#of-stats-tab-notes .nv-model-arrow{font-size:11px;color:#445566;flex-shrink:0;transition:color 0.15s;}',
          '#of-stats-tab-notes .nv-model-row:hover .nv-model-arrow{color:#00b4ff;}',
          '#of-stats-tab-notes .nv-empty{text-align:center;padding:16px;color:#445566;font-size:10px;}',
          '#of-stats-tab-notes .nv-models-scroll{max-height:350px;overflow-y:auto;}',
          '.nv-models-scroll::-webkit-scrollbar{width:3px;}',
          '.nv-models-scroll::-webkit-scrollbar-track{background:transparent;}',
          '.nv-models-scroll::-webkit-scrollbar-thumb{background:#1e2d3d;border-radius:2px;}',
          '.nv-models-scroll{scrollbar-width:thin;scrollbar-color:#1e2d3d transparent;}',
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
          // Inline styles here previously hard-coded font-size:9px and a
          // slate-700 colour, which overrode the .nv-create-label CSS
          // class and made 'Create tag' nearly invisible on the dark bg.
          createLabel.style.cssText = 'font-size:12px;color:#ffffff;font-weight:700;letter-spacing:0.02em;margin-bottom:6px;';
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
      // Content-based dedup key: id alone wasn't enough because each
      // visit minted a new alert id for the same event (same model,
      // same metric, same day, same delta), so the list grew with
      // exact duplicates. Key by username + type + day + delta.
      function _alertDedupKey(a) {
        if (!a) return '';
        var day = '';
        if (a.date) {
          var d = new Date(a.date);
          if (!isNaN(d.getTime())) day = d.toISOString().slice(0, 10);
          else day = String(a.date).slice(0, 10);
        }
        var val = a.diff || a.pct || (a.oldScore + '>' + a.newScore) || '';
        return [a.username || '', a.type || '', day, val].join('|');
      }

      function _alertsFetchFromServer(username, callback) {
        try {
          chrome.runtime.sendMessage({ action: 'getAlerts', username: username }, function (resp) {
            if (resp && resp.success && Array.isArray(resp.alerts)) {
              _alertsServerCache[username] = resp.alerts;
              // Merge server alerts into local storage with
              // content-based dedup so revisits don't double up.
              var local = _alertsLoadAll();
              var seen = {};
              local.forEach(function (a) { seen[_alertDedupKey(a)] = true; });
              var merged = false;
              resp.alerts.forEach(function (a) {
                var k = _alertDedupKey(a);
                if (!seen[k]) {
                  seen[k] = true;
                  local.unshift(a);
                  merged = true;
                }
              });
              // Drop any existing duplicates in local (one-time cleanup
              // for users whose storage already filled with dups).
              var cleaned = [];
              var cleanedSeen = {};
              for (var i = 0; i < local.length; i++) {
                var key = _alertDedupKey(local[i]);
                if (cleanedSeen[key]) continue;
                cleanedSeen[key] = true;
                cleaned.push(local[i]);
              }
              if (cleaned.length !== local.length) { merged = true; local = cleaned; }
              if (merged) {
                local.sort(function (a, b) { return (b.date || 0) - (a.date || 0); });
                if (local.length > 100) local = local.slice(0, 100);
                _alertsSave(local);
              }
              if (callback) callback(resp.alerts);
            } else {
              if (callback) callback(null);
            }
          });
        } catch (e) {
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
      // Alerts arrive from a shared server endpoint, so their fields are not
      // ours to trust. Build the row out of DOM nodes and set every value
      // with textContent — nothing here can turn into markup, whatever the
      // server sends back.
      var _ALERT_COLORS = { '#22c55e': 1, '#ef4444': 1, '#eab308': 1 };
      function _alertColor(c) { return _ALERT_COLORS[c] ? c : '#8899aa'; }

      function _alertFillText(el, a) {
        el.textContent = '';
        var append = function (text) { el.appendChild(document.createTextNode(text)); };
        var strong = function (text) {
          var s = document.createElement('strong');
          s.style.color = _alertColor(a.color);
          s.textContent = text;
          el.appendChild(s);
        };
        var u = '@' + (a.username || '');

        switch (a.type) {
          case 'fans_surge':
          case 'fans_drop':
          case 'likes_surge':
          case 'likes_drop': {
            var labels = {
              fans_surge:  ['alertFansSurge',  'alertFans'],
              fans_drop:   ['alertFansDrop',   'alertFans'],
              likes_surge: ['alertLikesSurge', 'alertLikes'],
              likes_drop:  ['alertLikesDrop',  'alertLikes']
            }[a.type];
            append(u + ' ' + t(labels[0]) + ' ');
            strong((a.diff == null ? '' : a.diff) + ' ' + t(labels[1]));
            if (a.pct != null && a.pct !== '') append(' (' + a.pct + ')');
            break;
          }
          case 'score_up':
          case 'score_down': {
            append(u + ' — ' + t(a.type === 'score_up' ? 'alertScoreUp' : 'alertScoreDown') + ' ');
            strong(a.oldScore + ' → ' + a.newScore);
            if (a.oldGrade && a.newGrade) append(' (' + a.oldGrade + ' → ' + a.newGrade + ')');
            break;
          }
          default:
            append(u);
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
        // No max-height — let alerts grow naturally and the badge
        // expand to fit. Avoids the ugly native scrollbar.
        scroll.style.cssText = '';
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
          _alertFillText(textEl, a);
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
        // Hard-lock badge to current rendered height — Alerts must
        // neither grow nor shrink the wrapper. If alerts content
        // overflows, the inner scroll container handles it with a
        // 3px custom scrollbar (matched to .nv-models-scroll).
        var keepH = badge.offsetHeight;
        badge.style.minHeight = keepH + 'px';
        badge.style.maxHeight = keepH + 'px';
        flipInner.style.display = 'none';
        var np = badge.querySelector('#of-stats-notes-panel');
        if (np) np.style.display = 'none';
        var ap = badge.querySelector('#of-stats-alerts-panel');
        if (ap) {
          ap.style.display = '';
          ap.style.height = (keepH - 32) + 'px';
          ap.style.overflowY = 'auto';
          _alertsRebuildPanel();
          _alertsFetchFromServer(_notesUsername, function () {
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
        // Release the hard lock so wrapper can animate to front size.
        badge.style.maxHeight = '';
        requestAnimationFrame(function () {
          badge.style.minHeight = (flipFront.scrollHeight + 32) + 'px';
        });
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
          textDiv.style.cssText = 'font-size:12px;color:#ffffff;font-weight:500;line-height:1.4;display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical;overflow:hidden;';
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
            sp.style.cssText = 'font-size:10px;padding:2px 7px;border-radius:7px;font-weight:700;letter-spacing:0.02em;' + _notesTagStyle(tg.ci);
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
          dateSpan.style.cssText = 'font-size:11px;color:#ffffff;white-space:nowrap;font-weight:600;';
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
        // Lock current badge height so the CSS transition has a
        // starting value to animate from.
        var startH = badge.offsetHeight;
        badge.style.minHeight = startH + 'px';
        flipInner.style.display = 'none';
        // Hide alerts panel if open
        var ap = badge.querySelector('#of-stats-alerts-panel');
        if (ap) ap.style.display = 'none';
        var np = badge.querySelector('#of-stats-notes-panel');
        if (np) {
          np.style.display = '';
          // Notes panel sizes itself to its own content (don't inherit
          // the possibly-taller back-side height).
          np.style.minHeight = '';
          _notesRebuildPanel();
          // Animate badge to the notes panel's natural height.
          requestAnimationFrame(function () {
            badge.style.minHeight = (np.scrollHeight + 32) + 'px';
          });
          _notesSyncFromServer(function () {
            _notesRebuildPanel();
            _notesRenderStrip();
            badge.style.minHeight = (np.scrollHeight + 32) + 'px';
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
        // Snap badge wrapper back to natural front-side height (animated).
        requestAnimationFrame(function () {
          badge.style.minHeight = (flipFront.scrollHeight + 32) + 'px';
        });
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
        usernameDiv.innerHTML = '<span style="color:#00b4ff;">@</span>' + _esc(profileData.username || profileData.name) + verifiedBadge;
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
      verdictDiv.style.cssText = 'margin-top:16px;margin-bottom:2px;border-radius:8px;overflow:hidden;border:1.5px solid ' + _vGradeColor + '66;background:linear-gradient(135deg,' + _vGradeColor + '14,' + _vGradeColor + '05);box-shadow:0 0 0 1px ' + _vGradeColor + '14;';
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
          var lines = String(text || '').split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
          if (lines.length < 2) {
            html += '<span style="color:#ffffff;font-size:11px;line-height:1.55;">' + _esc(lines[0] || '') + '</span>';
          } else {
            lines.forEach(function (line, i) {
              if (i === 0) {
                html += '<div style="color:#ffffff;font-size:12px;font-weight:700;line-height:1.4;margin-bottom:6px;">' + _esc(line) + '</div>';
              } else if (line.charAt(0) === '•') {
                html += '<div style="display:flex;gap:6px;color:#dbe4f0;font-size:11px;line-height:1.5;margin-top:3px;">'
                  + '<span style="color:' + _vGradeColor + ';flex-shrink:0;">•</span>'
                  + '<span>' + _esc(line.replace(/^•\s*/, '')) + '</span></div>';
              } else if (line.charAt(0) === '→') {
                html += '<div style="display:flex;gap:6px;margin-top:7px;padding-top:6px;border-top:1px solid ' + _vGradeColor + '22;color:#ffffff;font-size:11px;font-weight:600;line-height:1.5;">'
                  + '<span style="color:' + _vGradeColor + ';flex-shrink:0;">→</span>'
                  + '<span>' + _esc(line.replace(/^→\s*/, '')) + '</span></div>';
              } else {
                html += '<div style="color:#dbe4f0;font-size:11px;line-height:1.5;margin-top:3px;">' + _esc(line) + '</div>';
              }
            });
          }
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
      
      // Request AI verdict from background. Skip generation when:
      //   - subscription expired (verdict hidden anyway, no point burning tokens)
      //   - user disabled the Verdict-AI toggle in popup Settings
      //     (was the source of a money-loss bug: UI hid but request still fired)
      if (_subExpired || settings.ofStatsVerdictEnabled === false) {
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
              photos: Number(profileData.photosCount) || 0,
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
              // Real OF field is profileData.joinDate, not 'joined'.
              if (profileData.joinDate) {
                var t = Date.parse(profileData.joinDate);
                if (!isNaN(t)) {
                  m.accountMonths = Math.max(1, Math.floor((Date.now() - t) / (1000*60*60*24*30)));
                  m.joinedDate = new Date(t).toISOString().slice(0, 10);
                }
              }
              if (typeof scoreResult.fansVisible === 'boolean') m.fansVisible = scoreResult.fansVisible;
              else m.fansVisible = profileData.showSubscribersCount !== false;
              // _detectedSocials is populated by the badge's late social-link scan.
              if (Array.isArray(profileData._detectedSocials)) m.hasSocials = profileData._detectedSocials.length > 0;
              try {
                var sx = scanSocialLinksWithUrls();
                if (sx.length > 0) m.socials = sx;
              } catch (e) {}
              // Comments open/closed: _farmedStatus === 'ready' is the badge's
              // own signal that comments are open on this profile, available
              // regardless of whether the user is subscribed.
              if (typeof profileData._farmedStatus === 'string') {
                m.commentsEnabled = profileData._farmedStatus === 'ready';
              }
              if (typeof scoreResult.isBotted === 'boolean') m.isBotted = scoreResult.isBotted;
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
        return '<div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;font-size:11px;' + (r !== xrayRows[xrayRows.length - 1] ? 'border-bottom:1px solid rgba(255,255,255,0.06);' : '') + '"><span style="color:#ffffff;font-weight:600;letter-spacing:0.01em;">' + r.key + '</span><span style="display:flex;align-items:center;gap:4px;color:' + valColor + ';font-weight:700;">' + r.val + icon + '</span></div>';
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
        allTabs.forEach(function (tb) {
          if (tb.dataset.tab === active) { tb.style.color = '#00b4ff'; tb.style.borderBottomColor = '#00b4ff'; }
          else { tb.style.color = '#556677'; tb.style.borderBottomColor = 'transparent'; }
        });
        Object.keys(allPanels).forEach(function (k) {
          var el = document.getElementById(allPanels[k]);
          if (el) el.style.display = (k === active) ? '' : 'none';
        });
        // No height change on sub-tab switch — Radar and Trend should
        // visually stay in the same envelope. The Radar height is the
        // dominant one (locked on first flip via adjustFlipHeight) and
        // Trend slots into the same room. We rely on the trend tab
        // having overflow-y handled within its own content.
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
      compareRow.style.cssText = 'margin-top:0px;padding-top:4px;border-top:1px solid rgba(255,255,255,0.04);display:flex;align-items:center;gap:6px;';

      var compareBtn = document.createElement('button');
      compareBtn.id = 'of-stats-compare-btn';
      var swordsIcon = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><circle cx="5" cy="6" r="3"/><path d="M12 6h5a2 2 0 0 1 2 2v7"/><path d="m15 9-3-3 3-3"/><circle cx="19" cy="18" r="3"/><path d="M12 18H7a2 2 0 0 1-2-2V9"/><path d="m9 15 3 3-3 3"/></svg>';
      compareBtn.style.cssText = 'flex:1;padding:7px 10px;border-radius:8px;border:1.5px solid rgba(0,180,255,0.55);background:rgba(0,180,255,0.10);color:#00b4ff;font-size:10px;font-weight:700;cursor:pointer;text-align:center;transition:all 0.2s;display:flex;align-items:center;justify-content:center;gap:5px;font-family:inherit;letter-spacing:0.3px;box-shadow:0 0 0 1px rgba(0,180,255,0.10);';
      compareBtn.onmouseenter = function() { if (!this.dataset.locked) { this.style.background = 'rgba(0,180,255,0.18)'; this.style.borderColor = 'rgba(0,180,255,0.8)'; this.style.boxShadow = '0 0 12px rgba(0,180,255,0.25)'; } };
      compareBtn.onmouseleave = function() { if (!this.dataset.locked) { this.style.background = 'rgba(0,180,255,0.10)'; this.style.borderColor = 'rgba(0,180,255,0.55)'; this.style.boxShadow = '0 0 0 1px rgba(0,180,255,0.10)'; } };

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
            compareBtn.style.borderColor = 'rgba(0,180,255,0.55)';
            compareBtn.style.background = 'rgba(0,180,255,0.10)';
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
            compareBtn.innerHTML = swordsIcon + '<span>vs @' + _esc(saved.username) + '</span>';
            compareBtn.style.background = 'rgba(0,180,255,0.12)';
            compareBtn.style.color = '#00b4ff';
            compareBtn.style.borderColor = 'rgba(0,180,255,0.6)';
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
      alertsPanel.className = 'nv-models-scroll'; // custom thin scrollbar
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
        // The active side is in flow (CSS rule based on .flipped),
        // so its scrollHeight is its natural content height. Both
        // flipInner and badge have a min-height transition, so just
        // assigning the new value triggers the animation — provided
        // the previous min-height was a numeric value (which
        // _initBadgeMinHeight guarantees after first paint).
        //
        // The double rAF gives the browser a chance to commit the
        // .flipped class change to layout before we read scrollHeight,
        // otherwise we'd occasionally measure the OUTGOING side and
        // the badge would snap instead of animating.
        requestAnimationFrame(function () {
          requestAnimationFrame(function () {
            var activeSide = toBack ? flipBack : flipFront;
            var target = activeSide.scrollHeight;
            if (target <= 0) return;
            flipInner.style.minHeight = target + 'px';
            badge.style.minHeight = (target + 32) + 'px'; // + badge padding
          });
        });
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
          _initBadgeMinHeight();
          return true;
        }
        return false;
      }
      // Once the badge is in the DOM and has its natural front-side
      // size, pin that as a numeric min-height on both wrappers.
      // Without this, the very first flip transition jumps because
      // min-height was 'auto' (no value to transition from).
      function _initBadgeMinHeight() {
        // Two rAFs to ensure layout has stabilised after insertion.
        requestAnimationFrame(function () {
          requestAnimationFrame(function () {
            var h = flipFront.scrollHeight || flipInner.offsetHeight;
            if (h > 0) {
              flipInner.style.minHeight = h + 'px';
              badge.style.minHeight = (h + 32) + 'px';
            }
          });
        });
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
  
})();
