// Server-side proxy for the OpenHuman sandbox demo.
//
// This is the ONLY place the real Anthropic API key is ever used. The
// browser only ever talks to this endpoint with a step name and a plain
// text payload, never to api.anthropic.com directly and never with a key.
//
// Required environment variable (set in Vercel project settings):
//   ANTHROPIC_API_KEY   - create one at https://platform.claude.com
// Optional:
//   ANTHROPIC_MODEL     - defaults to claude-sonnet-5 below

const PROMPTS = {
  research: {
    system: 'You are a market research assistant. Use web search (at most 2 searches) to find the current public pricing page for the given company. Return ONLY valid JSON, no markdown fences, no preamble, in exactly this shape: {"company":"...","category":"...","currency":"USD","plans":[{"name":"...","price":0.0,"cadence":"week|month|year"}],"summary":"one sentence on their pricing model"}. At most 4 plans. If you cannot find real pricing, return {"error":"reason"}.',
    useWebSearch: true
  },
  archetypes: {
    system: 'You design behavioral customer archetypes for pricing simulations. Return ONLY valid JSON: {"archetypes":[{"name":"...","trait":"one short sentence on what drives their decisions","price_sensitivity":"low|medium|high","trust_threshold":"low|medium|high"}]}. Return exactly 4 distinct archetypes tailored to the category of this company (for example a price-driven type, a cautious evaluator, a committed loyalist, a casual low-intent type). No markdown fences.',
    useWebSearch: false
  },
  narrative: {
    system: 'You write concise result narratives for a pricing simulation report. You are given pre-computed simulated LTV index numbers, already final, do not invent or recalculate them, and a list of customer archetypes. Return ONLY valid JSON: {"headline":"one sentence naming the pattern","insights":["...","...","..."],"archetype_notes":[{"archetype":"...","best_variant":"variant id like V2","reason":"one to two sentences grounded in the stated trait of that archetype"}]}. Cover all archetypes given. Keep the whole response under 320 words. No markdown fences.',
    useWebSearch: false
  }
};

// Naive in-memory rate limit. This only holds within a single warm
// serverless instance and resets on cold start or when Vercel spins up a
// new instance under load, so it does NOT protect you at real volume.
// Swap this for Vercel KV or Upstash Redis before sending this link out
// widely, see the PRD's cost-control section for why this matters.
const hits = new Map();
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 8;

function isRateLimited(ip) {
  const now = Date.now();
  const record = hits.get(ip) || { count: 0, resetAt: now + WINDOW_MS };
  if (now > record.resetAt) { record.count = 0; record.resetAt = now + WINDOW_MS; }
  record.count += 1;
  hits.set(ip, record);
  return record.count > MAX_PER_WINDOW;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST only' });
    return;
  }

  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').toString();
  if (isRateLimited(ip)) {
    res.status(429).json({ error: 'Too many requests from this address, try again in a minute.' });
    return;
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  const { step, userText, apiKey: clientApiKey, model: clientModel } = body || {};
  const cfg = PROMPTS[step];
  if (!cfg) {
    res.status(400).json({ error: 'Unknown step: ' + step });
    return;
  }

  // A browser can optionally supply its own key via the Settings page (config.html),
  // saved in that browser's local storage only. We never log or persist it here,
  // it's used for this one outbound call and then discarded. Falls back to the
  // server's own ANTHROPIC_API_KEY if the request didn't include one.
  const apiKey = (typeof clientApiKey === 'string' && clientApiKey.trim()) || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'No API key available. Set ANTHROPIC_API_KEY in Vercel, or add a key on the Settings page for this browser.' });
    return;
  }

  const model = (typeof clientModel === 'string' && clientModel.trim()) || process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';
  const anthropicBody = {
    model,
    max_tokens: 1000,
    system: cfg.system,
    messages: [{ role: 'user', content: String(userText || '').slice(0, 4000) }]
  };
  if (cfg.useWebSearch) {
    anthropicBody.tools = [{ type: 'web_search_20250305', name: 'web_search' }];
  }

  try {
    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(anthropicBody)
    });
    const data = await anthropicRes.json();
    if (!anthropicRes.ok) {
      res.status(anthropicRes.status).json({ error: (data.error && data.error.message) || 'Anthropic API error' });
      return;
    }
    const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
    const searchCount = (data.usage && data.usage.server_tool_use && data.usage.server_tool_use.web_search_requests) || 0;
    res.status(200).json({ text, usage: data.usage, searchCount, model });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
