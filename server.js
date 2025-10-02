// server.js — Express app for TSEA landing + static assets
// Security & perf minded, minimal SSR. If you add APIs later, namespace them under /api.

const path = require('path');
const express = require('express');
const compression = require('compression');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3000;

// --- Security headers
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      "default-src": ["'self'"],
      "img-src": ["'self'", "data:"],
      "font-src": ["'self'", "data:"],
      "script-src": ["'self'"],
      "style-src": ["'self'", "'unsafe-inline'"], // allow inline for simplicity; consider hashing
      "object-src": ["'none'"],
      "frame-ancestors": ["'none'"]
    }
  },
  referrerPolicy: { policy: 'no-referrer' },
  crossOriginEmbedderPolicy: false
}));

// --- Basic rate limit for any future /api routes
app.use('/api/', rateLimit({ windowMs: 60 * 1000, max: 120 }));

// --- Compression
app.use(compression());

// --- Static files
const PUBLIC_DIR = path.join(__dirname, 'public');
app.use('/public', express.static(PUBLIC_DIR, {
  setHeaders: (res, filePath) => {
    // Cache immutable assets (fingerprint them if you add hashing)
    if (/\.(png|jpg|jpeg|svg|ico|css|js)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }
  }
}));

// --- Healthcheck
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, uptime: process.uptime(), ts: Date.now() });
});

// --- Simple docs stubs to avoid 404s from footer links (customize as needed)
app.get(['/docs/terms', '/docs/privacy', '/about', '/customers', '/faq', '/contact', '/assistant'], (_req, res) => {
  res.sendFile(path.join(__dirname, 'stubs.html'));
});

// --- Landing
app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// --- Auth/checkout stubs (wire these to your real auth/payments later)
app.get(['/login', '/signup', '/assistants'], (_req, res) => {
  res.sendFile(path.join(__dirname, 'stubs.html'));
});
app.get('/checkout', (req, res) => {
  // Accept ?plan=pro|elite and optional coupon
  const { plan = 'pro', coupon = '' } = req.query;
  res.send(`
    <!doctype html><meta charset="utf-8">
    <link rel="stylesheet" href="/public/styles.css">
    <div class="container" style="padding:40px 0">
      <h1>Checkout</h1>
      <p>Plan: <strong>${plan}</strong></p>
      ${coupon ? `<p>Coupon: <strong>${coupon}</strong></p>` : ''}
      <p class="muted">Replace this stub with your Stripe Checkout or payment link integration.</p>
      <p><a class="btn btn-primary" href="/">← Back to site</a></p>
    </div>
  `);
});

// --- 404
app.use((req, res) => {
  res.status(404).send(`
    <!doctype html><meta charset="utf-8">
    <link rel="stylesheet" href="/public/styles.css">
    <div class="container" style="padding:40px 0">
      <h1>404</h1>
      <p>We couldn't find <code>${req.path}</code>.</p>
      <p><a class="btn btn-primary" href="/">Go home</a></p>
    </div>
  `);
});

app.listen(PORT, () => {
  console.log(`TSEA webapp running on http://localhost:${PORT}`);
});
