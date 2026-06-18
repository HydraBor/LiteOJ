const path = require('path');

function setSecurityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');

  if (req.path.startsWith('/api/')) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  next();
}

function staticOptions(maxAge = '1h') {
  return {
    etag: true,
    maxAge,
    setHeaders(res, filePath) {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      const name = path.basename(filePath).toLowerCase();
      if (name === 'index.html' || name === 'app.js' || name === 'style.css') {
        res.setHeader('Cache-Control', 'no-cache');
      } else {
        res.setHeader('Cache-Control', 'public, max-age=3600');
      }
    },
  };
}

function createRateLimit({ windowMs = 60_000, max = 30, name = 'default' } = {}) {
  const hits = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const key = `${name}:${req.ip || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown'}`;
    const current = hits.get(key);
    if (!current || current.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }
    current.count += 1;
    if (current.count > max) {
      res.setHeader('Retry-After', String(Math.ceil((current.resetAt - now) / 1000)));
      return res.status(429).json({ error: '请求过于频繁，请稍后再试' });
    }
    if (hits.size > 5000) {
      for (const [itemKey, item] of hits.entries()) {
        if (item.resetAt <= now) hits.delete(itemKey);
      }
    }
    return next();
  };
}

module.exports = { setSecurityHeaders, staticOptions, createRateLimit };
