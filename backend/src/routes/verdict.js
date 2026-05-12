const express = require('express');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

const XAI_API_KEY = process.env.XAI_API_KEY;

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

    const systemMessage = SYSTEM_PROMPTS[lang === 'ru' ? 'ru' : 'en'];

    const response = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${XAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'grok-4.20-beta-0309-non-reasoning',
        messages: [
          { role: 'system', content: systemMessage },
          { role: 'user', content: prompt }
        ],
        max_tokens: 250,
        temperature: 0.4
      })
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      console.error('xAI API error:', response.status, errText);
      return res.status(502).json({ error: 'AI service error' });
    }

    const data = await response.json();
    const verdict = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    res.json({ verdict: verdict ? verdict.trim() : null });
  } catch (error) {
    console.error('Verdict error:', error);
    res.status(500).json({ error: 'Internal error' });
  }
});

module.exports = router;
