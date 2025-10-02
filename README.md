# The Strategic Edge AI — Demo Web App

This is a working Node/Express demo that implements your **Ideal Signed-In UX Blueprint**.  
It uses EJS templates, server-side rendering, in-memory session storage, and local JSON files for seed data.

> **Cloud-only policy:** This demo renders artifacts in the app UI (no downloads) to align with your compliance model.

## Quick Start

```bash
# 1) Create .env
cp .env.example .env

# 2) Install deps
npm install

# 3) Run
npm start
# Visit http://localhost:3000
```

## Deploying to Render
- Use **Node 18+**.
- Set a `SESSION_SECRET` in env vars.
- Start command: `npm start`

## Structure
```
.
├─ server.js
├─ package.json
├─ .env.example
├─ README.md
├─ data/
│  ├─ templates.json
│  ├─ lessons.json
│  ├─ roadmap_prompts.json
│  └─ projects.json (created at runtime if missing)
├─ public/
│  ├─ styles.css
│  ├─ main.js
│  └─ logo.svg
└─ views/
   ├─ partials/
   │  ├─ head.ejs
   │  ├─ nav.ejs
   │  └─ flash.ejs
   ├─ layout.ejs
   ├─ index.ejs
   ├─ login.ejs
   ├─ intake.ejs
   ├─ dashboard.ejs
   ├─ projects.ejs
   ├─ project_detail.ejs
   ├─ assistants_evaluate.ejs
   ├─ assistants_design.ejs
   ├─ assistants_generate.ejs
   ├─ assistants_evolve.ejs
   ├─ learning.ejs
   ├─ uploads.ejs
   ├─ account.ejs
   └─ support.ejs
```

## Notes
- **Auth:** Simple "passwordless" mock login (enter name + choose tier).
- **Tier Gating:** Middleware enforces Basic/Pro/Elite visibility.
- **Guided Intake:** Seeds a first project and personalized roadmap.
- **Uploads:** Accepts CSV/XLS/XLSX but only stores metadata (no parsing).
- **Evolve:** Shows mock analysis/diagnostics to demonstrate UX.
- **Images:** Logo shipped as inline-friendly SVG to avoid broken assets in deployment.
