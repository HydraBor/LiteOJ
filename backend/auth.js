const jwt = require('jsonwebtoken');
const { db } = require('./db');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
if (process.env.NODE_ENV === 'production' && (!process.env.JWT_SECRET || JWT_SECRET === 'dev-secret-change-me' || JWT_SECRET.length < 32)) {
  throw new Error('JWT_SECRET must be set to a strong random value in production');
}
const COOKIE_NAME = 'liteoj_token';

function isTruthy(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').toLowerCase());
}

function isFalsy(value) {
  return ['0', 'false', 'no', 'off'].includes(String(value || '').toLowerCase());
}

function isHttpsRequest(req) {
  const forwardedProto = String(req?.headers?.['x-forwarded-proto'] || '')
    .split(',')[0]
    .trim()
    .toLowerCase();
  return Boolean(req?.secure || req?.protocol === 'https' || forwardedProto === 'https');
}

function cookieSecure(req) {
  // COOKIE_SECURE=1 forces Secure cookies, COOKIE_SECURE=0 disables them.
  // When unset or set to auto, LiteOJ follows the actual request protocol so
  // http://localhost:3000 works without DevTools warnings while HTTPS
  // deployments still receive Secure cookies.
  const setting = process.env.COOKIE_SECURE;
  if (isTruthy(setting)) return true;
  if (isFalsy(setting)) return false;
  return isHttpsRequest(req);
}

function cookieOptions(req, extra = {}) {
  const options = {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    ...extra,
  };
  if (cookieSecure(req)) options.secure = true;
  return options;
}


function signUser(user) {
  return jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
}

function getToken(req) {
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7);
  return req.cookies?.[COOKIE_NAME];
}

function authOptional(req, res, next) {
  const token = getToken(req);
  if (!token) return next();
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = db.prepare('SELECT id, username, role FROM users WHERE id = ?').get(payload.id);
    if (!user) {
      req.user = null;
      clearAuthCookie(req, res);
    } else {
      req.user = user;
    }
  } catch (_) {
    req.user = null;
    clearAuthCookie(req, res);
  }
  next();
}

function requireLogin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: '请先登录' });
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: '请先登录' });
  if (req.user.role !== 'admin') return res.status(403).json({ error: '需要管理员权限' });
  next();
}

function setAuthCookie(req, res, token) {
  res.cookie(COOKIE_NAME, token, cookieOptions(req, {
    maxAge: 7 * 24 * 60 * 60 * 1000,
  }));
}

function clearAuthCookie(req, res) {
  // Use a valid non-empty expired value and the same attributes as the login
  // cookie. This avoids Chrome DevTools warnings for an empty cookie value and
  // ensures logout clears the exact cookie scope.
  res.cookie(COOKIE_NAME, 'deleted', cookieOptions(req, {
    expires: new Date(0),
    maxAge: 0,
  }));
}

module.exports = {
  signUser,
  authOptional,
  requireLogin,
  requireAdmin,
  setAuthCookie,
  clearAuthCookie,
};
