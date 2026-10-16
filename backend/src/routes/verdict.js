const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const { query, getOne } = require('../config/database');

const router = express.Router();

const XAI_API_KEY = process.env.XAI_API_KEY;

// Which Grok writes the verdicts — changeable in Railway without a deploy.
const XAI_MODEL = process.env.XAI_MODEL || 'grok-4.7';

// grok-4.7 always reasons before answering and bills that reasoning as output;
// it cannot be switched off, only turned down (low | medium | high | xhigh,
// default high). A 50-word verdict needs no deep thought, so keep it low.
const XAI_REASONING_EFFORT = process.env.XAI_REASONING_EFFORT || 'low';

// Asked when the main model refuses the request or returns nothing, so the
// badge keeps getting verdicts while the log says what went wrong.
const XAI_FALLBACK_MODEL = process.env.XAI_FALLBACK_MODEL || 'grok-4.20-0309-non-reasoning';

const isReasoningModel = (model) => !/non-reasoning/.test(model);

function requestBody(model, systemMessage, prompt) {
  const body = {
    model,
    messages: [
      { role: 'system', content: systemMessage },
      { role: 'user', content: prompt }
    ]
  };
  if (isReasoningModel(model)) {
    // The reasoning may draw on the same token budget as the answer; 250
    // tokens could leave nothing for the verdict itself. The prompt already
    // caps the answer at about 50 words.
    body.max_tokens = 2000;
    body.reasoning_effort = XAI_REASONING_EFFORT;
  } else {
    body.max_tokens = 250;
    body.temperature = 0.4;
  }
  return body;
}

// One call to xAI. Throws on an HTTP error; returns the trimmed text (or null).
async function askGrok(model, systemMessage, prompt) {
  const response = await fetch('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${XAI_API_KEY}`
    },
    body: JSON.stringify(requestBody(model, systemMessage, prompt))
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    const err = new Error('xAI ' + response.status + ' from ' + model + ': ' + errText.slice(0, 300));
    err.status = response.status;
    throw err;
  }

  const data = await response.json();
  const raw = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;

  // Token counts in the log are the only way to see what reasoning costs.
  const usage = data.usage || {};
  const reasoning = usage.completion_tokens_details && usage.completion_tokens_details.reasoning_tokens;
  console.log('[verdict]', model, 'in', usage.prompt_tokens, 'out', usage.completion_tokens,
    reasoning !== undefined ? 'reasoning ' + reasoning : '');

  return raw ? raw.trim() : null;
}

// The badge asks for a verdict every time a profile is rendered, and the
// client only caches it in memory for the life of the page. Popular profiles
// were therefore re-billed once per view, per user. Cache on (model, score,
// lang): the verdict is a reading of the score, so while the score is
// unchanged the text stays valid.
const VERDICT_TTL_DAYS = 7;
const MAX_PROMPT_CHARS = 4000;

// The prompt is built client-side and starts with a fixed header:
//   "Профиль @name:\nScore: 73/100 (Good)"  /  "Profile @name:\nScore: ..."
// Parsing it here means the cache works for extension builds already in the
// wild — no client change needed to start saving money.
function cacheKeyFromPrompt(prompt, lang) {
  const user = prompt.match(/^(?:Профиль|Profile)\s+@([a-zA-Z0-9._-]{1,100}):/);
  const score = prompt.match(/\nScore:\s*(\d{1,3})\s*\/\s*100/);
  if (!user || !score) return null;
  const n = parseInt(score[1], 10);
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  return { username: user[1].toLowerCase(), score: n, lang };
}

async function readCache(key) {
  try {
    const row = await getOne(
      `SELECT verdict FROM verdict_cache
       WHERE model_username = $1 AND score = $2 AND lang = $3
         AND created_at > NOW() - ($4 || ' days')::interval`,
      [key.username, key.score, key.lang, String(VERDICT_TTL_DAYS)]
    );
    return row ? row.verdict : null;
  } catch (e) {
    // A cache miss must never break the feature.
    console.warn('[verdict] cache read failed:', e.message);
    return null;
  }
}

async function writeCache(key, verdict) {
  try {
    await query(
      `INSERT INTO verdict_cache (model_username, score, lang, verdict, created_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (model_username, score, lang)
       DO UPDATE SET verdict = EXCLUDED.verdict, created_at = NOW(), hits = 0`,
      [key.username, key.score, key.lang, verdict]
    );
  } catch (e) {
    console.warn('[verdict] cache write failed:', e.message);
  }
}

function bumpHits(key) {
  query(
    `UPDATE verdict_cache SET hits = hits + 1
     WHERE model_username = $1 AND score = $2 AND lang = $3`,
    [key.username, key.score, key.lang]
  ).catch(() => {});
}

const SYSTEM_PROMPTS = {
  ru: 'Ты опытный аналитик профилей OnlyFans. Пиши кратко и по делу, своими словами — без пересказа флагов и метрик. Будь объективным. НЕ ВЫДУМЫВАЙ факты. Если в данных есть «Последние известные» фаны — используй эту цифру, не пиши просто «фаны скрыты». Не упоминай верификацию — она есть у всех. Не называй флаги по имени (Inflated Likes, Low Trust и т.д.) — описывай ситуацию своими словами. Скрытые фаны сами по себе НЕ подозрение на накрутку. Если фаны скрыты и нет «Последних известных» — оценивай размер аудитории ТОЛЬКО по лайкам: менее 5K лайков = маленькая аудитория, 5-50K = средняя, 50K+ = большая. НЕ ПИШИ «широкая аудитория» если лайков мало. Если подписка ПЛАТНАЯ и есть фаны — упомяни доход. Если подписка FREE — КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО упоминать доход, заработок, подписку, монетизацию, слово «бесплатный», слово «платная». Просто НЕ ПИШИ об этом. СТИЛЬ: живой и экспертный тон, как разбор от аналитика. Начни с ключевого наблюдения. Используй 1-2 уместных emoji (📈📉🔥⚡💰🎯🚀⚠️🧊) в начале предложений для акцента — НЕ в конце. ФОРМАТ: 2-3 предложения, максимум 50 слов, на русском. ОБЯЗАТЕЛЬНО заканчивай выводом — что это значит для аудитории или качества аккаунта. НЕ начинай с имени/@username. Без markdown.',
  en: 'You are an experienced OnlyFans profile analyst. Write concisely and to the point, in your own words — do not restate flags or metrics. Be objective. DO NOT fabricate facts. If the data includes "Last known" fans — use that number, don\'t just write "fans hidden". Do not mention verification — everyone has it. Do not name flags by name (Inflated Likes, Low Trust, etc.) — describe the situation in your own words. Hidden fans alone are NOT suspicious of fake engagement. If fans are hidden and there are no "Last known" — estimate audience size ONLY by likes: under 5K likes = small audience, 5-50K = medium, 50K+ = large. DO NOT write "wide audience" if likes are low. If subscription is PAID and fans exist — mention revenue. If subscription is FREE — it is STRICTLY FORBIDDEN to mention revenue, earnings, subscription, monetization, the word "free", the word "paid". Just DO NOT write about it. STYLE: lively and expert tone, like an analyst breakdown. Start with a key observation. Use 1-2 fitting emoji (📈📉🔥⚡💰🎯🚀⚠️🧊) at the START of sentences for emphasis — NOT at the end. FORMAT: 2-3 sentences, max 50 words, in English. MUST end with a conclusion — what this means for the audience or account quality. DO NOT start with the name/@username. No markdown.'
};

// POST / — proxy to xAI Chat Completions for the AI verdict text
router.post('/', authenticateToken, async (req, res) => {
  try {
    if (!XAI_API_KEY) {
      return res.status(503).json({ error: 'AI service not configured' });
    }

    const { prompt, lang } = req.body;
    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({ error: 'prompt is required' });
    }
    if (prompt.length > MAX_PROMPT_CHARS) {
      return res.status(400).json({ error: 'prompt is too long' });
    }

    const safeLang = lang === 'ru' ? 'ru' : 'en';
    const systemMessage = SYSTEM_PROMPTS[safeLang];

    const cacheKey = cacheKeyFromPrompt(prompt, safeLang);
    if (cacheKey) {
      const cached = await readCache(cacheKey);
      if (cached) {
        bumpHits(cacheKey);
        return res.json({ verdict: cached, cached: true });
      }
    }

    let verdict = null;
    try {
      verdict = await askGrok(XAI_MODEL, systemMessage, prompt);
      if (!verdict) console.warn('[verdict]', XAI_MODEL, 'returned an empty answer');
    } catch (err) {
      console.error('[verdict]', err.message);
    }

    if (!verdict && XAI_FALLBACK_MODEL && XAI_FALLBACK_MODEL !== XAI_MODEL) {
      try {
        verdict = await askGrok(XAI_FALLBACK_MODEL, systemMessage, prompt);
      } catch (err) {
        console.error('[verdict] fallback failed:', err.message);
      }
    }

    if (!verdict) {
      return res.status(502).json({ error: 'AI service error' });
    }

    if (verdict && cacheKey) await writeCache(cacheKey, verdict);

    res.json({ verdict });
  } catch (error) {
    console.error('Verdict error:', error);
    res.status(500).json({ error: 'Internal error' });
  }
});

module.exports = router;
