import 'dotenv/config';
import express from 'express';
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

app.use(helmet({
  contentSecurityPolicy: false
}));
app.use(morgan('dev'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev_secret_change_me',
  resave: false,
  saveUninitialized: false,
}));
app.use(fileUpload());
app.use(express.static(path.join(__dirname, 'public')));

// simple flash messaging
app.use((req, res, next) => {
  res.locals.flash = req.session.flash || [];
  req.session.flash = [];
  next();
});
function flash(req, type, text){
  req.session.flash.push({ type, text });
}

// data helpers
const DATA_DIR = path.join(__dirname, 'data');
const PROJECTS_PATH = path.join(DATA_DIR, 'projects.json');
function readJson(p){ return JSON.parse(fs.readFileSync(p, 'utf-8')); }
function writeJson(p, v){ fs.writeFileSync(p, JSON.stringify(v, null, 2)); }

function ensureProjects(){
  if(!fs.existsSync(PROJECTS_PATH)){
    writeJson(PROJECTS_PATH, { projects: [] });
  }
}
ensureProjects();

// auth guards
function requireAuth(req, res, next){
  if(!req.session.user) return res.redirect('/login');
  res.locals.user = req.session.user;
  next();
}
function requireTier(tiers){
  return (req, res, next) => {
    const u = req.session.user;
    if(!u) return res.redirect('/login');
    if(!tiers.includes(u.tier)){
      flash(req, 'warn', `This feature requires ${tiers.join('/')} tier.`);
      return res.redirect('/dashboard');
    }
    next();
  }
}

// root
app.get('/', (req, res) => {
  if(req.session.user) return res.redirect('/dashboard');
  res.render('index', { title: 'Welcome', user: null });
});

// login/logout
app.get('/login', (req, res) => {
  res.render('login', { user: null, title: 'Sign In' });
});
app.post('/login', (req, res) => {
  const { name, tier, firstTime } = req.body;
  req.session.user = { name, tier };
  if(firstTime) return res.redirect('/intake');
  res.redirect('/dashboard');
});
app.post('/logout', (req, res) => {
  req.session.destroy(()=> res.redirect('/'));
});

// intake
app.get('/intake', requireAuth, (req, res) => {
  res.render('intake', { user: req.session.user, title: 'Guided Intake' });
});
app.post('/intake', requireAuth, (req, res) => {
  const body = req.body;
  // seed a starter project
  ensureProjects();
  const db = readJson(PROJECTS_PATH);
  const id = nanoid(8);
  const proj = {
    id,
    name: 'My First Strategy',
    template: 'es-1m-3ema-atr',
    status: 'Draft',
    goal: body.objective || 'Learn basics',
    markets: body.markets || 'ES',
    timeframe: body.bars || '1–3 min',
    riskPrefs: `${body.style || 'Scalping'}`,
    versions: [],
    updatedAt: Date.now()
  };
  db.projects.unshift(proj);
  writeJson(PROJECTS_PATH, db);
  flash(req, 'info', 'Starter project created from Guided Intake.');
  res.redirect('/dashboard');
});

// dashboard
app.get('/dashboard', requireAuth, (req, res) => {
  const user = req.session.user;
  const roadmap = readJson(path.join(DATA_DIR, 'roadmap_prompts.json'));
  const lessons = readJson(path.join(DATA_DIR, 'lessons.json'));
  ensureProjects();
  const db = readJson(PROJECTS_PATH);
  const projects = db.projects;
  const resume = projects[0] || null;
  const nextLesson = user.tier === 'Basic' ? lessons.beginner[0] : lessons.full[0];
  res.render('dashboard', {
    user, roadmap, projects, resume, nextLesson, title: 'Dashboard'
  });
});

// projects
app.get('/projects', requireAuth, (req, res) => {
  const db = readJson(PROJECTS_PATH);
  res.render('projects', { user: req.session.user, projects: db.projects, title: 'Projects' });
});
app.get('/projects/new', requireAuth, (req, res) => {
  // create a blank project using first template as hint
  const templates = readJson(path.join(DATA_DIR, 'templates.json'));
  const db = readJson(PROJECTS_PATH);
  const id = nanoid(8);
  const p = {
    id, name: `Project ${id}`,
    template: templates.list[0].id,
    status: 'Draft',
    goal: 'Design a ruleset',
    markets: 'ES, NQ',
    timeframe: '1–3 min',
    riskPrefs: 'ATR-based stops; RR=3',
    versions: [],
    updatedAt: Date.now()
  };
  db.projects.unshift(p);
  writeJson(PROJECTS_PATH, db);
  flash(req, 'info', 'Blank project created.');
  res.redirect('/projects/' + id);
});
app.get('/projects/:id', requireAuth, (req, res) => {
  const db = readJson(PROJECTS_PATH);
  const project = db.projects.find(p => p.id === req.params.id);
  if(!project){ flash(req,'error','Project not found'); return res.redirect('/projects'); }
  res.render('project_detail', { user: req.session.user, project, title: project.name });
});

// assistants: evaluate
app.get('/assistants/evaluate', requireAuth, (req, res) => {
  const params = { symbol: req.query.symbol, tf: req.query.tf };
  const evalOut = {
    trend: ['Up','Down','Sideways'][Math.floor(Math.random()*3)],
    vol: ['Low','Moderate','High'][Math.floor(Math.random()*3)],
    context: 'Using MA slope and recent range width (mock).',
    why: 'Trend + volatility guide entry timing and risk sizing.'
  };
  res.render('assistants_evaluate', { user: req.session.user, params, evalOut, title: 'Evaluate' });
});
app.post('/assistants/evaluate/send-to-design', requireAuth, (req, res) => {
  flash(req,'info','Insights sent to Design scaffold.');
  res.redirect('/assistants/design?symbol='+encodeURIComponent(req.body.symbol)+'&tf='+encodeURIComponent(req.body.tf));
});

// assistants: design
app.get('/assistants/design', requireAuth, (req, res) => {
  const templates = readJson(path.join(DATA_DIR, 'templates.json'));
  res.render('assistants_design', { user: req.session.user, templates, params: req.query, spec: null, title: 'Design' });
});
app.post('/assistants/design/spec', requireAuth, (req, res) => {
  const templates = readJson(path.join(DATA_DIR, 'templates.json'));
  const b = req.body;
  const spec = `Strategy Spec
Symbol: ${b.symbol}  |  Timeframe: ${b.timeframe}
Entries:
- Use EMAs (${b.emaFast}/${b.emaMid}/${b.emaSlow}) for bias & pullback timing
- RSI(${b.rsiPeriod}) confirmation; ADX>${b.adx} for trend strength
Risk:
- ATR(${b.atrPeriod}) stop x${b.atrMultStop}; RR=${b.rr}
Session:
- Window ${b.session} PT (normalized to exchange/session)
Tradeoffs:
- Tighter ATR stops can reduce losers but may reduce RR; consider volatility regimes
`;
  // save as a new version in most recent project
  const db = readJson(PROJECTS_PATH);
  if(db.projects.length){
    db.projects[0].versions.unshift({ name: 'Spec v1', date: Date.now(), spec });
    db.projects[0].updatedAt = Date.now();
    writeJson(PROJECTS_PATH, db);
    flash(req,'info','Spec saved to latest project.');
  }
  res.render('assistants_design', { user: req.session.user, templates, params: b, spec, title: 'Design' });
});

// assistants: generate
app.get('/assistants/generate', requireAuth, (req, res) => {
  res.render('assistants_generate', { user: req.session.user, artifact: null, title: 'Generate' });
});
app.post('/assistants/generate/build', requireAuth, (req, res) => {
  const { platform, visibility } = req.body;
  // mock code artifact (non-downloadable)
  const artifact = `// ${platform} artifact (${visibility})
// Cloud-hosted preview only
// Parameters would be ${visibility.toLowerCase()} in this build.
`;
  const db = readJson(PROJECTS_PATH);
  if(db.projects.length){
    db.projects[0].versions.unshift({ name: `${platform} artifact`, date: Date.now(), spec: artifact });
    db.projects[0].updatedAt = Date.now();
    writeJson(PROJECTS_PATH, db);
    flash(req,'info','Artifact saved to latest project.');
  }
  res.render('assistants_generate', { user: req.session.user, artifact, title: 'Generate' });
});

// assistants: evolve (Elite only)
app.get('/assistants/evolve', requireAuth, requireTier(['Elite']), (req, res) => {
  res.render('assistants_evolve', { user: req.session.user, title: 'Evolve' });
});
app.post('/assistants/evolve/propose-revision', requireAuth, requireTier(['Elite']), (req, res) => {
  const suggestion = `Suggested Revision
- Narrow session to 07:10–10:45 PT
- Adjust ATR stop to 0.5–0.7
- Require ADX>22 during entries
`;
  const db = readJson(PROJECTS_PATH);
  if(db.projects.length){
    db.projects[0].versions.unshift({ name: 'Evolve Suggestion', date: Date.now(), spec: suggestion });
    db.projects[0].updatedAt = Date.now();
    writeJson(PROJECTS_PATH, db);
    flash(req,'info','Design revision proposed and saved to project.');
  }
  res.redirect('/projects/'+db.projects[0].id);
});

// learning
app.get('/learning', requireAuth, (req, res) => {
  const lessons = readJson(path.join(DATA_DIR, 'lessons.json'));
  res.render('learning', { user: req.session.user, lessons, title: 'Learning' });
});

// uploads
const UPLOADS = [];
app.get('/uploads', requireAuth, (req, res) => {
  const db = readJson(PROJECTS_PATH);
  res.render('uploads', { user: req.session.user, uploads: UPLOADS, projects: db.projects, title: 'Uploads' });
});
app.post('/uploads', requireAuth, (req, res) => {
  if(!req.files?.file){
    flash(req,'error','No file uploaded'); return res.redirect('/uploads');
  }
  const f = req.files.file;
  const projectId = req.body.projectId || null;
  const projectName = (readJson(PROJECTS_PATH).projects.find(p=>p.id===projectId)||{}).name;
  UPLOADS.unshift({ name: f.name, size: f.size, status: 'Queued', projectId, projectName });
  flash(req,'info','File received. Analysis will appear here once ready.');
  res.redirect('/uploads');
});

// account & billing
app.get('/account', requireAuth, (req, res) => {
  res.render('account', { user: req.session.user, title: 'Account & Billing' });
});
app.post('/account/plan', requireAuth, (req, res) => {
  const { tier } = req.body;
  req.session.user.tier = tier;
  flash(req,'info',`Plan updated to ${tier}.`);
  res.redirect('/account');
});

// support
app.get('/support', requireAuth, (req, res) => {
  res.render('support', { user: req.session.user, title: 'Support' });
});
app.post('/support/ticket', requireAuth, (req, res) => {
  flash(req,'info','Thanks! We received your ticket and will respond if needed.');
  res.redirect('/support');
});

// 404
app.use((req,res)=>{
  res.status(404).send('Not Found');
});

app.listen(PORT, () => {
  console.log('TSEA app running on http://localhost:'+PORT);
});
