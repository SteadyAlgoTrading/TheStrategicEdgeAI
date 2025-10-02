const path = require('path');
const express = require('express');
const compression = require('compression');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      "default-src": ["'self'"],
      "img-src": ["'self'", "data:"],
      "font-src": ["'self'", "data:"],
      "script-src": ["'self'"],
      "style-src": ["'self'", "'unsafe-inline'"],
      "object-src": ["'none'"],
      "frame-ancestors": ["'none'"]
    }
  },
  referrerPolicy: { policy: 'no-referrer' },
  crossOriginEmbedderPolicy: false
}));

app.use('/api/', rateLimit({ windowMs: 60 * 1000, max: 120 }));
app.use(compression());

app.use('/public', express.static(path.join(__dirname, 'public')));
app.use('/landing/assets', express.static(path.join(__dirname, 'landing', 'assets')));

app.get('/api/health', (_req, res) => res.json({ ok: true, uptime: process.uptime(), ts: Date.now() }));

app.get(['/docs/terms', '/docs/privacy', '/about', '/customers', '/faq', '/contact', '/assistant'], (_req, res) => {
  res.sendFile(path.join(__dirname, 'stubs.html'));
});

app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get(['/login', '/signup', '/assistants'], (_req, res) => res.sendFile(path.join(__dirname, 'stubs.html')));

app.get('/checkout', (req, res) => {
  const { plan = 'pro', coupon = '' } = req.query;
  res.send(`<!doctype html><meta charset="utf-8">
    <link rel="stylesheet" href="/public/styles.css">
    <div class="container" style="padding:40px 0">
      <h1>Checkout</h1>
      <p>Plan: <strong>${plan}</strong></p>
      ${coupon ? `<p>Coupon: <strong>${coupon}</strong></p>` : ''}
      <p class="muted">Replace this stub with your Stripe Checkout or payment link integration.</p>
      <p><a class="btn btn-primary" href="/">← Back to site</a></p>
    </div>`);
});

app.use((req, res) => {
  res.status(404).send(`<!doctype html><meta charset="utf-8">
    <link rel="stylesheet" href="/public/styles.css">
    <div class="container" style="padding:40px 0">
      <h1>404</h1>
      <p>We couldn't find <code>${req.path}</code>.</p>
      <p><a class="btn btn-primary" href="/">Go home</a></p>
    </div>`);
});

app.listen(PORT, () => console.log(`TSEA webapp running on http://localhost:${PORT}`));