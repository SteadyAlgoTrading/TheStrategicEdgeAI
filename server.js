import 'dotenv/config';
import express from 'express';
import expressLayouts from 'express-ejs-layouts';
import session from 'express-session';
import path from 'path';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import morgan from 'morgan';
import { fileURLToPath } from 'url';
import fs from 'fs';

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
app.use(express.static(path.join(__dirname, 'public')));

// flash
app.use((req,res,next)=>{ res.locals.flash = req.session.flash || []; req.session.flash = []; next(); });
function flash(req, type, text){ (req.session.flash||[]).push({ type, text }); }

// data
const DATA_DIR = path.join(__dirname, 'data');
const mastery = JSON.parse(fs.readFileSync(path.join(DATA_DIR,'mastery.json'),'utf-8'));

// auth
const requireAuth = (req,res,next)=>{ if(!req.session.user) return res.redirect('/login'); res.locals.user = req.session.user; next(); };

// helpers
function gate(tier, track){ if(tier==='Elite') return true; if(tier==='Pro') return track!=='advanced'; if(tier==='Basic') return track==='beginner'; return false; }
function modPct(progress, mod){ const total=mod.lessons.length+1; let done=0; mod.lessons.forEach(L=>{ if(progress[`${mod.id}:${L.id}`]) done++; }); if(progress[`${mod.id}:quiz`]) done++; return (done/total)*100; }
function trackPct(progress, trackId){ const mods=mastery.modules.filter(m=>m.track===trackId); if(!mods.length) return 0; return mods.reduce((a,m)=>a+modPct(progress,m),0)/mods.length; }
function nextHref(progress, tier){ for(const m of mastery.modules){ if(!gate(tier,m.track)) continue; for(const L of m.lessons){ if(!progress[`${m.id}:${L.id}`]) return `/learning/module/${m.id}/lesson/${L.id}`; } if(!progress[`${m.id}:quiz`]) return `/learning/module/${m.id}/quiz`; } return null; }
function md2html(md){ return md.replace(/^### (.*)$/gm,'<h3>$1</h3>').replace(/^## (.*)$/gm,'<h2>$1</h2>').replace(/^# (.*)$/gm,'<h1>$1</h1>').replace(/\*\*(.*?)\*\*/g,'<strong>$1</strong>').replace(/\*(.*?)\*/g,'<em>$1</em>').replace(/^- (.*)$/gm,'<li>$1</li>').replace(/\n\n/g,'<br/><br/>'); }

// routes
app.get('/', (req,res)=>{ if(req.session.user) return res.redirect('/dashboard'); res.render('index',{title:'Welcome', user:null}); });
app.get('/login',(req,res)=> res.render('login',{title:'Sign In', user:null}));
app.post('/login',(req,res)=>{ const { name, tier } = req.body; req.session.user = { name, tier }; res.redirect('/dashboard'); });
app.post('/logout',(req,res)=> req.session.destroy(()=> res.redirect('/')));

app.get('/dashboard', requireAuth, (req,res)=>{
  req.session.progress = req.session.progress || {};
  const href = nextHref(req.session.progress, req.session.user.tier);
  let acc=0,cnt=0; mastery.tracks.forEach(t=>{ if(gate(req.session.user.tier,t.id)){ acc+=trackPct(req.session.progress,t.id); cnt++; }});
  const pct = cnt? acc/cnt : 0;
  const badges = mastery.tracks.filter(t=>gate(req.session.user.tier,t.id)).filter(t=>trackPct(req.session.progress,t.id)>=100).map(t=>t.name);
  res.render('dashboard',{ title:'Dashboard', user:req.session.user, continueHref:href, learningPct:pct, trackBadges:badges });
});

app.get('/learning', requireAuth, (req,res)=>{
  req.session.progress=req.session.progress||{};
  const moduleProgress={}; mastery.modules.forEach(m=> moduleProgress[m.id]=modPct(req.session.progress,m));
  const trackProgress={}; mastery.tracks.forEach(t=> trackProgress[t.id]=trackPct(req.session.progress,t.id));
  res.render('learning_index',{ title:'Learning', user:req.session.user, tracks:mastery.tracks, modules:mastery.modules, moduleProgress, trackProgress });
});

app.get('/learning/module/:modId', requireAuth, (req,res)=>{
  req.session.progress=req.session.progress||{};
  const mod=mastery.modules.find(m=>m.id===req.params.modId); if(!mod) return res.status(404).send('Not found');
  if(!gate(req.session.user.tier,mod.track)) return res.redirect('/learning');
  res.render('learning_module',{ title:'Module', user:req.session.user, mod, modulePct:modPct(req.session.progress,mod), progress:req.session.progress });
});

app.get('/learning/module/:modId/lesson/:lessonId', requireAuth, (req,res)=>{
  req.session.progress=req.session.progress||{};
  const mod=mastery.modules.find(m=>m.id===req.params.modId); if(!mod) return res.status(404).send('Not found');
  if(!gate(req.session.user.tier,mod.track)) return res.redirect('/learning');
  const lesson=mod.lessons.find(l=>l.id===req.params.lessonId); if(!lesson) return res.status(404).send('Not found');
  const idx=mod.lessons.findIndex(l=>l.id===req.params.lessonId)+1; const prev=mod.lessons[idx-2]; const next=mod.lessons[idx];
  const prevHref=prev?`/learning/module/${mod.id}/lesson/${prev.id}`:null; const nextHref=next?`/learning/module/${mod.id}/lesson/${next.id}`:null;
  req.session.progress[`${mod.id}:${lesson.id}`]=true;
  res.render('learning_lesson',{ title:'Lesson', user:req.session.user, mod, lesson, html:md2html(lesson.content_md), prevHref, nextHref });
});

app.get('/learning/module/:modId/quiz', requireAuth, (req,res)=>{
  const mod=mastery.modules.find(m=>m.id===req.params.modId); if(!mod) return res.status(404).send('Not found');
  res.render('learning_quiz',{ title:'Quiz', user:req.session.user, mod });
});

app.post('/learning/module/:modId/quiz', requireAuth, (req,res)=>{
  let body=''; req.on('data',c=> body+=c.toString()); req.on('end',()=>{
    const params = Object.fromEntries(new URLSearchParams(body));
    const mod=mastery.modules.find(m=>m.id===req.params.modId);
    let correct=0; mod.quiz.questions.forEach(q=>{ const given=parseInt(params[`q_${q.id}`]??'-1',10); if(given===q.answer) correct++; });
    req.session.progress=req.session.progress||{}; req.session.progress[`${mod.id}:quiz`]=true;
    res.render('learning_results',{ title:'Results', user:req.session.user, mod, correct, total: mod.quiz.questions.length });
  });
});

app.get('/account', requireAuth, (req,res)=> res.send('<h2>Account</h2>'));
app.use((req,res)=> res.status(404).send('Not Found'));
app.listen(PORT, ()=> console.log('Running on http://localhost:'+PORT));
