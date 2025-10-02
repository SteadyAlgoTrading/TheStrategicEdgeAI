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

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use('/public', express.static(path.join(__dirname, 'public')));
app.use('/landing', express.static(path.join(__dirname, 'landing')));

const users = new Map();
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-not-for-prod';

function authMiddleware(req, _res, next){
  const token = req.cookies?.tsea;
  if (!token) return next();
  try { const payload = jwt.verify(token, JWT_SECRET); req.user = users.get(payload.email) || null; } catch (_) {}
  next();
}
app.use(authMiddleware);
function issueCookie(res, email){
  const token = jwt.sign({ email }, JWT_SECRET, { expiresIn: '7d' });
  res.cookie('tsea', token, { httpOnly: true, sameSite: 'lax', secure: false });
}

app.post('/api/auth/signup', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'missing_fields' });
  if (users.has(email)) return res.status(400).json({ error: 'exists' });
  const passwordHash = await bcrypt.hash(password, 10);
  const user = { email, passwordHash, plan: 'Basic' };
  users.set(email, user); issueCookie(res, email);
  res.json({ ok: true });
});
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  const user = users.get(email);
  if (!user) return res.status(400).json({ error: 'no_user' });
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(401).json({ error: 'bad_creds' });
  issueCookie(res, email); res.json({ ok: true });
});
app.post('/api/auth/logout', (req, res) => { res.clearCookie('tsea'); res.json({ ok: true }); });
app.get('/api/auth/session', (req, res) => {
  if (!req.user) return res.json({ authed:false });
  const { email, plan } = req.user; res.json({ authed:true, user:{ email, plan } });
});

app.get('/api/content/curriculum', (_req, res) => {
  const p = path.join(__dirname, 'content', 'curriculum.json');
  res.sendFile(p);
});

app.post('/api/projects/save', (req, res) => {
  const spec = req.body?.spec || '';
  const email = req.user?.email || 'anon';
  const out = path.join(__dirname, 'uploads', `${email.replace(/[^a-z0-9@.]/gi,'_')}-spec-${Date.now()}.txt`);
  fs.writeFileSync(out, spec); res.json({ status:'ok', file: out });
});

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ASSISTANTS = {
  icator: process.env.EDGE_ICATOR_ID,
  evaluate: process.env.EDGE_EVALUATE_ID,
  design: process.env.EDGE_DESIGN_ID,
  generate: process.env.EDGE_GENERATE_ID,
  evolve: process.env.EDGE_EVOLVE_ID,
};
async function askAssistant(assistantId, userMessage){
  if (!OPENAI_API_KEY || !assistantId) return "(dev) OpenAI not configured. " + (userMessage||"");
  const r = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ assistant_id: assistantId, input: userMessage || "" })
  });
  const j = await r.json();
  const out = j.output || []; const firstText = out.find(p => p.type === 'output_text');
  return (firstText && firstText.text) ? firstText.text : '(no content)';
}
app.post('/api/chat/:assistant', async (req, res) => {
  const id = ASSISTANTS[req.params.assistant] || ASSISTANTS.icator;
  const reply = await askAssistant(id, req.body?.message);
  res.json({ reply });
});
app.post('/api/design/draft', (req, res) => {
  const { instrument, timeframe, session, indicators, rules } = req.body || {};
  const spec = `# Design Spec
Instrument: ${instrument||'—'}
Timeframe: ${timeframe||'—'}
Session (PT): ${session||'—'}
Indicators: ${indicators||'—'}

Entry/Exit:
- Rules: ${rules||'—'}

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
  const lang = req.body?.lang || 'pinescript';
  const prompt = `Generate a ${lang==='pinescript'?'Pine v6':'NinjaScript C#'} strategy template for an EMA20/50 + RSI + ADX + ATR system with time filter 06:30–12:59 PT. Include inline comments and a run checklist.`;
  const code = await askAssistant(ASSISTANTS.generate, prompt);
  res.json({ code });
});
const upload = multer({ dest: path.join(__dirname, 'uploads') });
app.post('/api/evolve/upload', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error:'no_file' });
  const sample = fs.readFileSync(req.file.path, 'utf-8').split('\n').slice(0, 50).join('\n');
  const prompt = `Analyze this backtest sample (first 50 lines). Report PF, Win%, Max DD, Avg Trade, MAE/MFE; then prescribe ranked next experiments.\n\n${sample}`;
  const analysis = await askAssistant(ASSISTANTS.evolve, prompt);
  res.json({ analysis });
});

app.get('/', (_req, res) => res.redirect('/landing/index.html'));
app.get('/app', (_req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.listen(PORT, () => console.log(`[TSEA] Full app running on http://localhost:${PORT}`));
