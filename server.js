import 'dotenv/config';
import express from 'express';
import expressLayouts from 'express-ejs-layouts';
import session from 'express-session';
import fileUpload from 'express-fileupload';
import path from 'path';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import morgan from 'morgan';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { nanoid } from 'nanoid';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(expressLayouts);
app.set('layout', 'layout');

app.use(helmet({ contentSecurityPolicy:false }));
app.use(morgan('dev'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());
app.use(session({ secret: process.env.SESSION_SECRET || 'dev_secret', resave:false, saveUninitialized:false }));
app.use(fileUpload());
app.use(express.static(path.join(__dirname, 'public')));

// flash
app.use((req,res,next)=>{ res.locals.flash = req.session.flash || []; req.session.flash = []; next(); });
function flash(req, type, text){ (req.session.flash||[]).push({type,text}); }

// data helpers
const DATA_DIR = path.join(__dirname, 'data');
const PROJECTS_PATH = path.join(DATA_DIR, 'projects.json');
const readJson = p => JSON.parse(fs.readFileSync(p,'utf-8'));
const writeJson = (p,v)=> fs.writeFileSync(p, JSON.stringify(v,null,2));
if (!fs.existsSync(PROJECTS_PATH)) writeJson(PROJECTS_PATH, { projects: [] });

// auth
const requireAuth = (req,res,next)=>{ if(!req.session.user) return res.redirect('/login'); res.locals.user = req.session.user; next(); };
const requireTier = tiers => (req,res,next)=>{ const u=req.session.user; if(!u) return res.redirect('/login'); if(!tiers.includes(u.tier)) { flash(req,'warn',`Requires ${tiers.join('/')}`); return res.redirect('/dashboard'); } next(); };

// root/login/logout
app.get('/', (req,res)=>{ if(req.session.user) return res.redirect('/dashboard'); res.render('index',{title:'Welcome', user:null}); });
app.get('/login',(req,res)=> res.render('login',{title:'Sign In', user:null}));
app.post('/login',(req,res)=>{ const {name,tier,firstTime}=req.body; req.session.user={name,tier}; if(firstTime) return res.redirect('/intake'); res.redirect('/dashboard'); });
app.post('/logout',(req,res)=> req.session.destroy(()=>res.redirect('/')));

// intake
app.get('/intake', requireAuth, (req,res)=> res.render('intake',{title:'Guided Intake'}));
app.post('/intake', requireAuth, (req,res)=>{
  const b=req.body;
  const db=readJson(PROJECTS_PATH);
  const id = nanoid(8);
  db.projects.unshift({
    id, name:'My First Strategy', template:'es-1m-3ema-atr', status:'Draft',
    goal:b.objective||'Learn basics', markets:b.markets||'ES', timeframe:b.bars||'1–3 min',
    riskPrefs:b.style||'Scalping', versions:[], updatedAt:Date.now()
  });
  writeJson(PROJECTS_PATH, db);
  res.redirect('/dashboard');
});

// dashboard
app.get('/dashboard', requireAuth, (req,res)=>{
  const roadmap = readJson(path.join(DATA_DIR,'roadmap_prompts.json'));
  const lessons = readJson(path.join(DATA_DIR,'lessons.json'));
  const db = readJson(PROJECTS_PATH);
  res.render('dashboard', { title:'Dashboard', user:req.session.user, roadmap, resume: db.projects[0]||null });
});

// projects
app.get('/projects', requireAuth, (req,res)=>{
  const db=readJson(PROJECTS_PATH);
  res.render('projects',{ title:'Projects', user:req.session.user, projects:db.projects });
});
app.get('/projects/new', requireAuth, (req,res)=>{
  const db=readJson(PROJECTS_PATH);
  const id = nanoid(8);
  db.projects.unshift({ id, name:`Project ${id}`, template:'es-1m-3ema-atr', status:'Draft', goal:'Design a ruleset', markets:'ES,NQ', timeframe:'1–3 min', riskPrefs:'ATR stops; RR=3', versions:[], updatedAt:Date.now() });
  writeJson(PROJECTS_PATH, db);
  res.redirect('/projects/'+id);
});
app.get('/projects/:id', requireAuth, (req,res)=>{
  const db=readJson(PROJECTS_PATH);
  const project = db.projects.find(p=>p.id===req.params.id);
  if(!project) { flash(req,'error','Not found'); return res.redirect('/projects'); }
  res.render('project_detail',{ title:project.name, user:req.session.user, project });
});

// --- Assistant Chat Helpers ---
const ASSISTANT_PROMPTS = readJson(path.join(DATA_DIR,'assistant_prompts.json'));
function ensureChats(req){
  if(!req.session.chats) req.session.chats = { evaluate:[], design:[], generate:[], evolve:[] };
  return req.session.chats;
}
function replyFor(phase,text){
  const t=(text||'').toLowerCase();
  if(phase==='evaluate'){
    if(t.includes('trend')||t.includes('range')) return 'Regimes: Up/Down/Sideways. Use EMA(20/50) slope + recent true range. High ATR ⇒ wider stops; low ATR ⇒ selective entries.';
    if(t.includes('vol')||t.includes('atr')) return 'ATR is a simple vol proxy. For 1–3m, ATR stop ~0.5–0.8× is a start. Keep risk/trade inside your DD budget.';
    return 'Pick market+timeframe, identify regime, and calibrate risk to volatility. I can translate this to Design checks next.';
  }
  if(phase==='design'){
    if(t.includes('adx')) return 'ADX>20 is a common floor. 22–25 trims chop; >30 may be too strict on 1–3m. Consider “ADX rising” over a hard threshold.';
    if(t.includes('ruleset')||t.includes('draft')) return 'Sketch: EMA20>EMA50 bias; pullback to VWMA20; RSI(14) recross>50; ADX>22; SL=ATR(14)*0.6; TP=3R; Session 06:30–12:59 PT.';
    if(t.includes('session')) return 'Normalize to exchange time (PT shown). Keep one canonical window to avoid timezone drift across users.';
    return 'Tell me your objective (WR vs PF), indicators (EMA/RSI/ADX), and session. I’ll produce a clean spec and save it to your Project.';
  }
  if(phase==='generate'){
    if(t.includes('locked')) return 'Locked parameters = no user tuning in code. Adjustable = inputs exposed (e.g., `[NinjaScriptProperty]` or Pine `input`).';
    if(t.includes('tradingview')||t.includes('pine')) return 'Pine example: `rsiLen = input.int(14)` then gate entries with `ta.rsi(close,rsiLen)>50`. Locked mode removes inputs and hardcodes values.';
    if(t.includes('ninjatrader')) return 'NinjaTrader: consts for locked; public inputs for adjustable. Artifacts are cloud-only previews for compliance.';
    return 'Choose target (NinjaTrader/TradingView) + visibility (Locked/Adjustable). I’ll generate a preview artifact and save it.';
  }
  if(phase==='evolve'){
    if(t.includes('profit factor')||t.includes('pf')) return 'PF ~1.3 & WR 46% hints edge with chop leakage. Check time-of-day & vol buckets; try ATR 0.5–0.7 and ADX rising.';
    if(t.includes('atr')&&t.includes('stop')) return 'Tighter stops lower avg loss but risk stop-outs in high vol. Consider vol-aware bands: 0.5 low ATR, 0.7 high ATR.';
    if(t.includes('revision')||t.includes('propose')) return 'Revision: 07:10–10:45 PT; ADX>22; ATR(14)*0.6; RR=3. I can write this back to Design as Spec v2.';
    return 'Upload a backtest; we’ll slice by time-of-day, volatility, and momentum. Ask a specific diagnostic and I’ll propose a revision.';
  }
  return 'How can I help?';
}

// Assistant routes
function renderAssistantChat(req,res,phase,opts={}){
  const chats = ensureChats(req);
  const messages = chats[phase];
  const titles = { evaluate:'Evaluate — Open Chat', design:'Design — Open Chat', generate:'Generate — Open Chat', evolve:'Evolve — Open Chat' };
  const subtitles = { evaluate:'Discuss regimes and volatility.', design:'Co-create rulesets and guardrails.', generate:'Artifacts and parameter visibility.', evolve:'Diagnostics, uploads, and revisions.' };
  res.render('assistant_chat', {
    user:req.session.user,
    title: titles[phase],
    subtitle: subtitles[phase],
    assistantName: 'EDGE ' + phase[0].toUpperCase()+phase.slice(1),
    messages,
    recs: ASSISTANT_PROMPTS[phase]||[],
    action: `/assistants/${phase}/chat`,
    extrasHtml: opts.extrasHtml || ''
  });
}

app.get('/assistants/evaluate', requireAuth, (req,res)=> renderAssistantChat(req,res,'evaluate'));
app.post('/assistants/evaluate/chat', requireAuth, (req,res)=>{
  const chats=ensureChats(req);
  chats.evaluate.push({role:'user', text:req.body.text});
  chats.evaluate.push({role:'assistant', text:replyFor('evaluate', req.body.text)});
  res.redirect('/assistants/evaluate');
});

app.get('/assistants/design', requireAuth, (req,res)=> renderAssistantChat(req,res,'design'));
app.post('/assistants/design/chat', requireAuth, (req,res)=>{
  const chats=ensureChats(req);
  chats.design.push({role:'user', text:req.body.text});
  chats.design.push({role:'assistant', text:replyFor('design', req.body.text)});
  res.redirect('/assistants/design');
});

app.get('/assistants/generate', requireAuth, (req,res)=> renderAssistantChat(req,res,'generate'));
app.post('/assistants/generate/chat', requireAuth, (req,res)=>{
  const chats=ensureChats(req);
  chats.generate.push({role:'user', text:req.body.text});
  chats.generate.push({role:'assistant', text:replyFor('generate', req.body.text)});
  res.redirect('/assistants/generate');
});

app.get('/assistants/evolve', requireAuth, requireTier(['Elite']), (req,res)=> renderAssistantChat(req,res,'evolve'));
app.post('/assistants/evolve/chat', requireAuth, requireTier(['Elite']), (req,res)=>{
  const chats=ensureChats(req);
  chats.evolve.push({role:'user', text:req.body.text});
  chats.evolve.push({role:'assistant', text:replyFor('evolve', req.body.text)});
  res.redirect('/assistants/evolve');
});

// learning
app.get('/learning', requireAuth, (req,res)=>{
  const lessons=readJson(path.join(DATA_DIR,'lessons.json'));
  res.render('projects',{title:'Learning (stub)', user:req.session.user, projects:[]});
});

// uploads
const UPLOADS = [];
app.get('/uploads', requireAuth, (req,res)=>{
  const db=readJson(PROJECTS_PATH);
  res.render('uploads',{ title:'Uploads', user:req.session.user, uploads:UPLOADS, projects:db.projects });
});
app.post('/uploads', requireAuth, (req,res)=>{
  if(!req.files?.file){ flash(req,'error','No file'); return res.redirect('/uploads'); }
  const f=req.files.file; const projectId=req.body.projectId||null;
  const projectName = (readJson(PROJECTS_PATH).projects.find(p=>p.id===projectId)||{}).name;
  UPLOADS.unshift({ name:f.name, size:f.size, status:'Queued', projectId, projectName });
  flash(req,'info','File received.');
  res.redirect('/uploads');
});

// account/support
app.get('/account', requireAuth, (req,res)=> res.render('account',{ title:'Account', user:req.session.user }));
app.post('/account/plan', requireAuth, (req,res)=>{ req.session.user.tier=req.body.tier; res.redirect('/account'); });
app.get('/support', requireAuth, (req,res)=> res.render('support',{ title:'Support', user:req.session.user }));
app.post('/support/ticket', requireAuth, (req,res)=>{ flash(req,'info','Thanks!'); res.redirect('/support'); });

// 404
app.use((req,res)=> res.status(404).send('Not Found'));
app.listen(PORT, ()=> console.log('Running on http://localhost:'+PORT));
