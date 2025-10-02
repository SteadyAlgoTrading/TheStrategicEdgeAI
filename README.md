# The Strategic Edge AI — Webapp (Landing)

## Quick Start
```bash
npm ci || npm install
npm run start
# open http://localhost:3000
```

## Structure
```
.
├─ server.js
├─ index.html
├─ stubs.html
├─ package.json
└─ public/
   ├─ styles.css
   ├─ main.js
   ├─ favicon.ico
   ├─ logo.svg
   ├─ logo-mark.svg
   ├─ hero-bull-bear.png
   ├─ edge-screens.png
   ├─ feature-strategy.png
   ├─ feature-backtest.png
   ├─ feature-mentorship.png
   └─ og-image.png
```

## Notes
- Backtests are **not** run in-platform. Elite users can **upload** backtest results to **Evolve** for optimization.
- Evaluate provides **trend education** and **indicator fundamentals**.
- Pricing includes **Monthly/Annual** toggle; wire `/checkout` to Stripe when ready.
