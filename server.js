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
import OpenAI from 'openai';

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
app.use((req, res, next) => { res.locals.flash = req.session.flash || []; req.session.flash = []; next(); });
function flash(req, type, text){ (req.session.flash||[]).push({ type, text }); }

// data helpers
const DATA_DIR = path.join(__dirname, 'data');
const PROJECTS_PATH = path.join(DATA_DIR, 'projects.json');
const readJson = p => JSON.parse(fs.readFileSync(p, 'utf-8'));
const writeJson = (p,v) => fs.writeFileSync(p, JSON.stringify(v, null, 2));
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
  const nextLesson = req.session.user.tier==='Basic' ? lessons.beginner[0] : lessons.full[0];
  res.render('dashboard', { title:'Dashboard', user:req.session.user, roadmap, projects: db.projects, resume: db.projects[0]||null, nextLesson });
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

app.get('/assistants', requireAuth, (req,res)=> res.render('assistants_hub', { title:'Assistants', user:req.session.user }));

// Assistants (open chat) with optional GPT replies
const PROMPTS = readJson(path.join(DATA_DIR, 'assistant_prompts.json'));
function ensureChats(req){
  if(!req.session.chats) req.session.chats = { evaluate:[], design:[], generate:[], evolve:[] };
  return req.session.chats;
}
const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;
async function llmReply(phase, text){
  if(!openai) return null;
  const model = process.env.ASSISTANT_MODEL || 'gpt-4o-mini';
  try{
    const resp = await openai.chat.completions.create({
      model,
      messages: [
        { role:'system', content:`You are EDGE-${phase.toUpperCase()}, an assistant for The Strategic Edge AI. Be concise, educational, and actionable.` },
        { role:'user', content:text }
      ],
      temperature: 0.4
    });
    return resp.choices?.[0]?.message?.content || null;
  }catch(e){ return null; }
}
function canned(){ return 'Ask anything about this phase. (Set OPENAI_API_KEY to enable real GPT replies.)'; }
async function handleChat(req,res,phase){
  const chats = ensureChats(req);
  const txt = req.body.text;
  chats[phase].push({ role:'user', text:txt });
  let answer = await llmReply(phase, txt);
  if(!answer) answer = canned();
  chats[phase].push({ role:'assistant', text:answer });
  res.redirect(`/assistants/${phase}`);
}
function renderChat(req,res,phase){
  const chats = ensureChats(req);
  const titles = { evaluate:'Evaluate — Open Chat', design:'Design — Open Chat', generate:'Generate — Open Chat', evolve:'Evolve — Open Chat' };
  const subtitles = { evaluate:'Discuss regimes and volatility.', design:'Co-create rulesets and guardrails.', generate:'Artifacts and parameter visibility.', evolve:'Diagnostics, uploads, and revisions.' };
  res.render('assistant_chat', {
    user:req.session.user,
    title: titles[phase],
    subtitle: subtitles[phase],
    assistantName: 'EDGE ' + phase[0].toUpperCase()+phase.slice(1),
    messages: chats[phase],
    recs: PROMPTS[phase] || [],
    action: `/assistants/${phase}/chat`,
    extrasHtml: openai ? 'Using OpenAI replies.' : 'Using built-in guidance.'
  });
}
app.get('/assistants/evaluate', requireAuth, (req,res)=> renderChat(req,res,'evaluate'));
app.post('/assistants/evaluate/chat', requireAuth, (req,res)=> handleChat(req,res,'evaluate'));
app.get('/assistants/design', requireAuth, (req,res)=> renderChat(req,res,'design'));
app.post('/assistants/design/chat', requireAuth, (req,res)=> handleChat(req,res,'design'));
app.get('/assistants/generate', requireAuth, (req,res)=> renderChat(req,res,'generate'));
app.post('/assistants/generate/chat', requireAuth, (req,res)=> handleChat(req,res,'generate'));
app.get('/assistants/evolve', requireAuth, requireTier(['Elite']), (req,res)=> renderChat(req,res,'evolve'));
app.post('/assistants/evolve/chat', requireAuth, requireTier(['Elite']), (req,res)=> handleChat(req,res,'evolve'));

// learning
app.get('/learning', requireAuth, (req,res)=>{
  const lessons=readJson(path.join(DATA_DIR,'lessons.json'));
  res.render('learning', { title:'Learning', user:req.session.user, lessons });
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
