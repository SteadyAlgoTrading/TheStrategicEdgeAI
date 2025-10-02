// server.js — The Strategic Edge AI (Assistants v2 + explicit landing + per-assistant models)
import 'dotenv/config';
import express from 'express';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import cookieParser from 'cookie-parser';
import bcrypt from 'bcrypt';

const app = express();
const __dirname = path.resolve();
const PORT = process.env.PORT || 3000;

/* -------------------------- Core middleware & statics -------------------------- */
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.use('/public', express.static(path.join(__dirname, 'public')));
app.use('/landing', express.static(path.join(__dirname, 'landing')));

// Explicit landing route (just in case)
app.get('/landing/index.html', (_req, res) => {
  res.sendFile(path.join(__dirname, 'landing', 'index.html'));
});

/* ---------------------------------- Auth (demo) --------------------------------- */
const users = new Map(); // email -> { email, passwordHash, plan }
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-not-for-prod';

function authMiddleware(req, _res, next) {
  const token = req.cookies?.tsea;
  if (!token) return next();
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = users.get(payload.email) || null;
  } catch (_) {}
  next();
}
app.use(authMiddleware);

function issueCookie(res, email) {
  const token = jwt.sign({ email }, JWT_SECRET, { expiresIn: '7d' });
  res.cookie('tsea', token, { httpOnly: true, sameSite: 'lax', secure: false });
}

app.post('/api/auth/signup', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'missing_fields' });
  if (users.has(email)) return res.status(400).json({ error: 'exists' });
  const passwordHash = await bcrypt.hash(password, 10);
  users.set(email, { email, passwordHash, plan: 'Basic' });
  issueCookie(res, email);
  res.json({ ok: true });
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  const user = users.get(email);
  if (!user) return res.status(400).json({ error: 'no_user' });
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(401).json({ error: 'bad_creds' });
  issueCookie(res, email);
  res.json({ ok: true });
});

app.post('/api/auth/logout', (_req, res) => { res.clearCookie('tsea'); res.json({ ok: true }); });

app.get('/api/auth/session', (req, res) => {
  if (!req.user) return res.json({ authed: false });
  const { email, plan } = req.user;
  res.json({ authed: true, user: { email, plan } });
});

/* ------------------------------- Content + saves ------------------------------- */
app.get('/api/content/curriculum', (_req, res) => {
  res.sendFile(path.join(__dirname, 'content', 'curriculum.json'));
});

app.post('/api/projects/save', (req, res) => {
  const spec = req.body?.spec || '';
  const email = req.user?.email || 'anon';
  const out = path.join(__dirname, 'uploads', `${email.replace(/[^a-z0-9@.]/gi, '_')}-spec-${Date.now()}.txt`);
  fs.writeFileSync(out, spec);
  res.json({ status: 'ok', file: out });
});

/* --------------------------------- OpenAI wiring -------------------------------- */
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_DEFAULT_MODEL = process.env.OPENAI_DEFAULT_MODEL || 'gpt-4o-mini';

const ASSISTANTS = {
  icator:   process.env.EDGE_ICATOR_ID,
  evaluate: process.env.EDGE_EVALUATE_ID,
  design:   process.env.EDGE_DESIGN_ID,
  generate: process.env.EDGE_GENERATE_ID,
  evolve:   process.env.EDGE_EVOLVE_ID,
};

// Optional per-assistant model overrides
const MODELS = {
  icator:   process.env.EDGE_ICATOR_MODEL,
  evaluate: process.env.EDGE_EVALUATE_MODEL,
  design:   process.env.EDGE_DESIGN_MODEL,
  generate: process.env.EDGE_GENERATE_MODEL,
  evolve:   process.env.EDGE_EVOLVE_MODEL,
};

// Extract text from Assistants v2 "responses" shapes
function extractText(respJson) {
  if (!respJson) return null;
  if (typeof respJson.output_text === 'string' && respJson.output_text.trim()) return respJson.output_text;

  const out = Array.isArray(respJson.output) ? respJson.output : [];
  for (const item of out) {
    if (item?.type === 'message' && Array.isArray(item.content)) {
      const ot = item.content.find(c => c?.type === 'output_text' && typeof c.text === 'string');
      if (ot?.text) return ot.text;
      const tx = item.content.find(c => c?.type === 'text' && typeof c.text === 'string');
      if (tx?.text) return tx.text;
      for (const c of item.content) if (typeof c?.text === 'string' && c.text.trim()) return c.text;
    }
    if (item?.type === 'output_text' && typeof item.text === 'string' && item.text.trim()) return item.text;
  }
  const legacy = respJson?.message?.content?.[0]?.text?.value;
  return (typeof legacy === 'string' && legacy.trim()) ? legacy : null;
}

async function askAssistant(which, userMessage) {
  const assistantId = ASSISTANTS[which];
  const model = MODELS[which] || OPENAI_DEFAULT_MODEL;

  if (!OPENAI_API_KEY) return '(dev) OPENAI_API_KEY not set.';
  if (!assistantId && !model) return '(dev) Set OPENAI_DEFAULT_MODEL or per-assistant model.';

  const body = {
    // include a model to satisfy accounts that require it:
    model,
    input: userMessage || ''
  };
  if (assistantId) body.assistant_id = assistantId;

  const r = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
      'OpenAI-Beta': 'assistants=v2'
    },
    body: JSON.stringify(body)
  });

  let j;
  try { j = await r.json(); } catch (e) {
    console.error('OpenAI JSON parse error:', e);
    throw new Error('openai_json_error');
  }

  if (!r.ok || j.error) {
    console.error('OpenAI error:', { status: r.status, error: j.error, body: j });
    throw new Error(j?.error?.message || `openai_http_${r.status}`);
  }

  const text = extractText(j);
  if (!text) {
    console.warn('OpenAI empty text payload:', j);
    return '(no content)';
  }
  return text;
}

app.post('/api/chat/:assistant', async (req, res) => {
  try {
    const which = req.params.assistant;
    const reply = await askAssistant(which, req.body?.message);
    res.json({ reply });
  } catch (e) {
    console.error('Chat route error:', e?.message || e);
    res.status(500).json({ error: 'chat_failed', detail: String(e?.message || e) });
  }
});

/* --------------------------- Design / Generate / Evolve --------------------------- */
app.post('/api/design/draft', (req, res) => {
  const { instrument, timeframe, session, indicators, rules } = req.body || {};
  const spec = `# Design Spec
Instrument: ${instrument || '—'}
Timeframe: ${timeframe || '—'}
Session (PT): ${session || '—'}
Indicators: ${indicators || '—'}

Entry/Exit:
- Rules: ${rules || '—'}

Risk:
- Stop: ATR multiple (default 0.6×)
- Target: 3R
- Max positions: 1

Filters:
- Time-of-day within session
- ADX threshold for momentum

Notes: Educational use only.`;
  res.json({ spec });
});

app.post('/api/generate', async (req, res) => {
  try {
    const lang = req.body?.lang || 'pinescript';
    const prompt = `Generate a ${
      lang === 'pinescript' ? 'Pine v6' : 'NinjaScript C#'
    } strategy template for an EMA20/50 + RSI + ADX + ATR system with time filter 06:30–12:59 PT. Include inline comments and a run checklist.`;
    const code = await askAssistant('generate', prompt);
    res.json({ code });
  } catch (e) {
    console.error('Generate route error:', e?.message || e);
    res.status(500).json({ error: 'generate_failed' });
  }
});

const upload = multer({ dest: path.join(__dirname, 'uploads') });
app.post('/api/evolve/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'no_file' });
    const sample = fs.readFileSync(req.file.path, 'utf-8').split('\n').slice(0, 50).join('\n');
    const prompt = `Analyze this backtest sample (first 50 lines). Report PF, Win%, Max DD, Avg Trade, MAE/MFE; then prescribe ranked next experiments.\n\n${sample}`;
    const analysis = await askAssistant('evolve', prompt);
    res.json({ analysis });
  } catch (e) {
    console.error('Evolve route error:', e?.message || e);
    res.status(500).json({ error: 'evolve_failed' });
  }
});

/* ----------------------------------- Billing ----------------------------------- */
let stripe = null;
try {
  if (process.env.STRIPE_KEY) {
    const Stripe = (await import('stripe')).default;
    stripe = new Stripe(process.env.STRIPE_KEY);
  }
} catch (_) {}

app.post('/api/billing/checkout', async (req, res) => {
  const tier = req.body?.tier;
  if (!stripe) {
    if (req.user) req.user.plan = tier === 'pro' ? 'Pro' : 'Elite'; // simulate in dev
    return res.json({ url: null, simulated: true });
  }
  const price = tier === 'pro' ? process.env.PRICE_PRO : process.env.PRICE_ELITE;
  if (!price) return res.status(400).json({ error: 'price_missing' });
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price, quantity: 1 }],
    success_url: process.env.SUCCESS_URL || 'http://localhost:3000?success=true',
    cancel_url: process.env.CANCEL_URL || 'http://localhost:3000?canceled=true'
  });
  res.json({ url: session.url });
});

app.post('/api/billing/portal', async (req, res) => {
  if (!stripe) return res.json({ url: null, simulated: true });
  const portal = await stripe.billingPortal.sessions.create({
    customer: req.body?.customerId || process.env.TEST_CUSTOMER_ID,
    return_url: process.env.PORTAL_RETURN_URL || 'http://localhost:3000'
  });
  res.json({ url: portal.url });
});

/* ----------------------------------- Routing ----------------------------------- */
app.get('/', (_req, res) => res.redirect('/landing/index.html'));
app.get('/app', (_req, res) => res.sendFile(path.join(__dirname, 'index.html')));

/* ------------------------------------ Start ------------------------------------ */
app.listen(PORT, () => console.log(`[TSEA] Full app running on http://localhost:${PORT}`));
